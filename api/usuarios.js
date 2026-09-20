// /api/usuarios — gestión de usuarios
//
// action:"listPublic" -> lista mínima (nick, nombre, apellidos, código) para
//                        rellenar el desplegable de "Conductor" del formulario.
//                        La puede pedir cualquier usuario con sesión iniciada.
// action:"list"        -> lista completa (incluye rol, bloqueado, horario y
//                         tipo de jornada). Solo admin.
// action:"crear"       -> da de alta un usuario nuevo (con su horario de
//                         entrada/salida y tipo de jornada —fijo o
//                         flexible—, para el fichaje). Solo admin.
// action:"eliminar"    -> borra un usuario. Solo admin, y a "Admin" solo
//                         puede borrarlo el propio "Admin". Nunca se puede
//                         borrar al último administrador.
// action:"desbloquear" -> desbloquea un usuario tras 3 intentos fallidos. Solo admin.
// action:"editar"      -> modifica nombre/apellidos/rol/contraseña/horario/
//                         tipo de jornada de un usuario existente. Solo
//                         admin. El rol de "Admin" solo puede cambiarlo el
//                         propio "Admin". Nunca se puede dejar la app sin
//                         ningún administrador.

import bcrypt from "bcryptjs";
import { apiHandler, ErrorHttp, exigirAdmin } from "./_lib/http.js";
import { invalidarSesion } from "./_lib/auth.js";
import { igualCI, esErrorEsquema, esViolacionUnica } from "./_lib/db.js";
import { validarNickNuevo, errorPassword, nombrePersona, hora, ErrorValidacion } from "./_lib/validate.js";
import { auditar } from "./_lib/audit.js";

const NICK_PROTEGIDO = "admin"; // en minúsculas, para comparar sin distinguir mayúsculas
const TIPOS_HORARIO = ["fijo", "flexible"];

async function actualizarConTolerancia(supabase, filtrar, cambios, opcionales = []) {
  let { error } = await filtrar(supabase.from("usuarios").update(cambios));
  if (esErrorEsquema(error) && opcionales.length) {
    const reducidos = { ...cambios };
    opcionales.forEach((c) => delete reducidos[c]);
    ({ error } = await filtrar(supabase.from("usuarios").update(reducidos)));
  }
  if (error) throw error;
}

async function contarAdmins(supabase, exceptoNick) {
  const { data, error } = await supabase.from("usuarios").select("nick").eq("role", "admin");
  if (error) throw error;
  return (data || []).filter((u) => !exceptoNick || u.nick.toLowerCase() !== exceptoNick.toLowerCase()).length;
}

export default apiHandler(async ({ res, action, payload, sesion, supabase }) => {
  // ── LISTA PÚBLICA (desplegable de conductor) ─────────
  if (action === "listPublic") {
    const { data, error } = await supabase
      .from("usuarios")
      .select("nick, nombre, apellido1, apellido2, codigo")
      .order("nombre", { ascending: true });
    if (error) throw error;
    return res.status(200).json({ usuarios: data });
  }

  // A partir de aquí, todas las acciones son solo para administradores.
  exigirAdmin(sesion, "No tienes permiso para gestionar usuarios.");

  // ── LISTA COMPLETA ────────────────────────────────────
  if (action === "list") {
    const { data, error } = await supabase
      .from("usuarios")
      .select("nick, nombre, apellido1, apellido2, codigo, role, locked, created_at, horario_entrada, horario_salida, tipo_horario")
      .order("nick", { ascending: true });
    if (error) throw error;
    return res.status(200).json({ usuarios: data });
  }

  // ── CREAR ─────────────────────────────────────────────
  if (action === "crear") {
    const { nick, pass, nombre, apellido1, apellido2, role, horarioEntrada, horarioSalida, tipoHorario } = payload;
    const nickLimpio = validarNickNuevo(nick);
    const errPass = errorPassword(pass, nickLimpio);
    if (errPass) throw new ErrorHttp(400, errPass);
    const hEntrada = hora(horarioEntrada, "El horario de entrada");
    const hSalida = hora(horarioSalida, "El horario de salida");
    if (tipoHorario && !TIPOS_HORARIO.includes(tipoHorario)) {
      throw new ErrorHttp(400, 'El tipo de horario debe ser "fijo" o "flexible"');
    }
    const { data: existente, error: errBusq } = await igualCI(supabase.from("usuarios").select("id"), "nick", nickLimpio).maybeSingle();
    if (errBusq) throw errBusq;
    if (existente) throw new ErrorHttp(409, "Ese usuario ya existe");

    const hash = await bcrypt.hash(pass, 10);
    const { error } = await supabase.from("usuarios").insert({
      nick: nickLimpio,
      password_hash: hash,
      nombre: nombrePersona(nombre, "El nombre"),
      apellido1: nombrePersona(apellido1, "El primer apellido"),
      apellido2: nombrePersona(apellido2, "El segundo apellido"),
      role: role === "admin" ? "admin" : "user",
      locked: false,
      intentos: 0,
      horario_entrada: hEntrada || "07:00",
      horario_salida: hSalida || "13:57",
      tipo_horario: tipoHorario === "flexible" ? "flexible" : "fijo",
    });
    if (esViolacionUnica(error)) throw new ErrorHttp(409, "Ese usuario ya existe");
    if (error) throw error;
    await auditar(supabase, sesion, "crear", "usuario", nickLimpio, { role: role === "admin" ? "admin" : "user" });
    return res.status(200).json({ ok: true });
  }

  // A partir de aquí necesitamos saber sobre qué usuario se actúa.
  const nickDestino = String(payload.nick ?? "").trim();
  if (!nickDestino) throw new ErrorHttp(400, "Falta el usuario");
  const esElProtegido = nickDestino.toLowerCase() === NICK_PROTEGIDO;
  const loPideElProtegido = sesion.nick.toLowerCase() === NICK_PROTEGIDO;

  // Comprobamos que existe y cogemos su rol actual (la comparación es LITERAL: sin comodines).
  const { data: destino, error: errDestino } = await igualCI(supabase.from("usuarios").select("id, nick, role"), "nick", nickDestino).maybeSingle();
  if (errDestino) throw errDestino;
  if (!destino) throw new ErrorHttp(404, "Usuario no encontrado");
  const filtrarDestino = (q) => q.eq("id", destino.id);

  // ── ELIMINAR ──────────────────────────────────────────
  if (action === "eliminar") {
    if (esElProtegido && !loPideElProtegido) {
      throw new ErrorHttp(403, 'El usuario "Admin" solo puede eliminarse a sí mismo.');
    }
    if (destino.role === "admin" && (await contarAdmins(supabase, destino.nick)) === 0) {
      throw new ErrorHttp(400, "No se puede eliminar al último administrador: la app se quedaría sin nadie que la gestione.");
    }
    const { error } = await supabase.from("usuarios").delete().eq("id", destino.id);
    if (error) throw error;
    invalidarSesion(destino.nick);
    await auditar(supabase, sesion, "eliminar", "usuario", destino.nick);
    return res.status(200).json({ ok: true });
  }

  // ── DESBLOQUEAR ───────────────────────────────────────
  if (action === "desbloquear") {
    await actualizarConTolerancia(supabase, filtrarDestino, { locked: false, intentos: 0, bloqueado_hasta: null }, ["bloqueado_hasta"]);
    invalidarSesion(destino.nick);
    await auditar(supabase, sesion, "desbloquear", "usuario", destino.nick);
    return res.status(200).json({ ok: true });
  }

  // ── EDITAR ────────────────────────────────────────────
  if (action === "editar") {
    const { nombre, apellido1, apellido2, role, nuevaPass, horarioEntrada, horarioSalida, tipoHorario } = payload;
    const cambios = {};
    const detalle = {};
    if (nombre !== undefined) cambios.nombre = nombrePersona(nombre, "El nombre");
    if (apellido1 !== undefined) cambios.apellido1 = nombrePersona(apellido1, "El primer apellido");
    if (apellido2 !== undefined) cambios.apellido2 = nombrePersona(apellido2, "El segundo apellido");

    let subirVersion = false;
    if (role !== undefined) {
      if (esElProtegido && !loPideElProtegido) {
        throw new ErrorHttp(403, 'El rol de "Admin" solo puede cambiarlo el propio "Admin".');
      }
      const nuevoRol = role === "admin" ? "admin" : "user";
      if (destino.role === "admin" && nuevoRol !== "admin" && (await contarAdmins(supabase, destino.nick)) === 0) {
        throw new ErrorHttp(400, "No se puede quitar el rol al último administrador.");
      }
      if (nuevoRol !== destino.role) { cambios.role = nuevoRol; detalle.role = nuevoRol; subirVersion = true; }
    }

    if (nuevaPass) {
      const errPass = errorPassword(nuevaPass, destino.nick);
      if (errPass) throw new ErrorHttp(400, errPass);
      cambios.password_hash = await bcrypt.hash(nuevaPass, 10);
      cambios.intentos = 0;
      detalle.password = "restablecida";
      subirVersion = true;
    }

    if (horarioEntrada !== undefined || horarioSalida !== undefined) {
      const hE = hora(horarioEntrada, "El horario de entrada");
      const hS = hora(horarioSalida, "El horario de salida");
      if (hE) cambios.horario_entrada = hE;
      if (hS) cambios.horario_salida = hS;
    }

    if (tipoHorario !== undefined) {
      if (!TIPOS_HORARIO.includes(tipoHorario)) {
        throw new ErrorHttp(400, 'El tipo de horario debe ser "fijo" o "flexible"');
      }
      cambios.tipo_horario = tipoHorario;
    }

    if (Object.keys(cambios).length === 0) throw new ErrorHttp(400, "No hay ningún cambio que guardar");

    if (subirVersion) {
      // Invalida las sesiones abiertas de ese usuario (cambio de contraseña o de rol).
      const { data: actual } = await supabase.from("usuarios").select("token_version").eq("id", destino.id).maybeSingle();
      cambios.token_version = ((actual && actual.token_version) || 0) + 1;
    }
    await actualizarConTolerancia(supabase, filtrarDestino, cambios, ["token_version"]);
    invalidarSesion(destino.nick);
    await auditar(supabase, sesion, "editar", "usuario", destino.nick, { campos: Object.keys(cambios).filter((c) => c !== "password_hash" && c !== "token_version"), ...detalle });
    return res.status(200).json({ ok: true });
  }

  throw new ErrorHttp(400, "Acción no reconocida");
});
