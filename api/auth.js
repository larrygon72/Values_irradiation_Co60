// /api/auth  — comprobar / registrar / entrar / cambiar contraseña
//
// La app llama a este endpoint en estos momentos:
//   action:"check"        -> ¿existe ya este nick? (y ¿está abierto el alta?)
//   action:"register"     -> crear un usuario nuevo (alta rápida desde el login)
//   action:"login"        -> comprobar la contraseña y abrir sesión
//   action:"cambiarPass"  -> cambiar la contraseña propia (requiere sesión)
//
// Seguridad:
//  · 3 contraseñas erróneas seguidas bloquean la cuenta durante 15 minutos
//    (se desbloquea sola; un administrador también puede hacerlo antes).
//    Así nadie puede dejar a otro —ni al Admin— fuera de forma indefinida.
//  · El alta desde el login se puede cerrar con REGISTRO_ABIERTO=false.
//  · Contraseña mínima de 8 caracteres.

import bcrypt from "bcryptjs";
import { apiHandler, ErrorHttp } from "./_lib/http.js";
import { firmarToken, codigoConductor, autenticar, invalidarSesion } from "./_lib/auth.js";
import { igualCI, esErrorEsquema, esViolacionUnica } from "./_lib/db.js";
import { validarNickNuevo, errorPassword, nombrePersona, ErrorValidacion } from "./_lib/validate.js";
import { auditar } from "./_lib/audit.js";

const MAX_INTENTOS = 3;
const BLOQUEO_MINUTOS = 15;
const BCRYPT_COSTE = 10;

const registroAbierto = () => String(process.env.REGISTRO_ABIERTO ?? "true").trim().toLowerCase() !== "false";

function usuarioPublico(u) {
  return {
    nick: u.nick,
    role: u.role,
    nombre: u.nombre || "",
    apellido1: u.apellido1 || "",
    apellido2: u.apellido2 || "",
    codigo: u.codigo || codigoConductor(u.nombre, u.apellido1, u.apellido2),
    mustChangePassword: !!u.must_change_password,
  };
}

// Actualiza un usuario; si el esquema aún no tiene alguna columna "opcional"
// (p. ej. bloqueado_hasta) reintenta sin ella en vez de fallar.
async function actualizarUsuario(supabase, id, cambios, opcionales = []) {
  let { error } = await supabase.from("usuarios").update(cambios).eq("id", id);
  if (esErrorEsquema(error) && opcionales.length) {
    const reducidos = { ...cambios };
    opcionales.forEach((c) => delete reducidos[c]);
    ({ error } = await supabase.from("usuarios").update(reducidos).eq("id", id));
  }
  if (error) throw error;
}

function minutosRestantes(u) {
  if (!u.bloqueado_hasta) return null;
  const ms = new Date(u.bloqueado_hasta).getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / 60000) : 0;
}

function mensajeBloqueo(u) {
  const min = minutosRestantes(u);
  if (min && min > 0) {
    return `Acceso bloqueado temporalmente por demasiados intentos. Inténtalo de nuevo en ${min} minuto${min === 1 ? "" : "s"} o contacta con el administrador.`;
  }
  return "Acceso bloqueado. Contacta con el administrador.";
}

// Si el bloqueo temporal ya venció, la cuenta se desbloquea sola.
async function desbloquearSiCaduco(supabase, u) {
  if (u.locked && u.bloqueado_hasta && new Date(u.bloqueado_hasta).getTime() <= Date.now()) {
    await actualizarUsuario(supabase, u.id, { locked: false, intentos: 0, bloqueado_hasta: null }, ["bloqueado_hasta"]);
    invalidarSesion(u.nick);
    return { ...u, locked: false, intentos: 0, bloqueado_hasta: null };
  }
  return u;
}

// Cuenta un intento fallido y bloquea al llegar al máximo. Lanza siempre un ErrorHttp.
async function registrarFallo(supabase, u, mensajeBase) {
  const intentos = (u.intentos || 0) + 1;
  if (intentos >= MAX_INTENTOS) {
    const hasta = new Date(Date.now() + BLOQUEO_MINUTOS * 60000).toISOString();
    await actualizarUsuario(supabase, u.id, { intentos, locked: true, bloqueado_hasta: hasta }, ["bloqueado_hasta"]);
    throw new ErrorHttp(403, mensajeBloqueo({ bloqueado_hasta: hasta }));
  }
  await actualizarUsuario(supabase, u.id, { intentos });
  const restantes = MAX_INTENTOS - intentos;
  throw new ErrorHttp(401, `${mensajeBase}. Quedan ${restantes} intento${restantes === 1 ? "" : "s"}.`, "CREDENCIALES");
}

async function buscarUsuario(supabase, nick, columnas = "*") {
  const { data, error } = await igualCI(supabase.from("usuarios").select(columnas), "nick", nick).maybeSingle();
  if (error) throw error;
  return data;
}

export default apiHandler(async ({ res, action, payload, body, supabase }) => {
  // Este endpoint usa campos "planos" (nick, pass…) salvo cambiarPass.
  const { nick, pass, nombre, apellido1, apellido2, token } = body;
  const nickBusqueda = String(nick ?? "").trim().slice(0, 100);

  // ── CAMBIAR CONTRASEÑA (requiere sesión) ─────────────
  if (action === "cambiarPass") {
    const r = await autenticar(supabase, token);
    if (!r.ok) throw new ErrorHttp(r.status, r.error, r.code);
    const { passActual, passNueva } = payload;
    if (!passActual || !passNueva) throw new ErrorHttp(400, "Escribe la contraseña actual y la nueva");
    const u = await buscarUsuario(supabase, r.sesion.nick);
    if (!u) throw new ErrorHttp(401, "Sesión no válida o caducada", "SESION_CADUCADA");
    const ok = await bcrypt.compare(String(passActual), u.password_hash);
    if (!ok) await registrarFallo(supabase, u, "La contraseña actual no es correcta");
    const errPass = errorPassword(String(passNueva), u.nick);
    if (errPass) throw new ErrorHttp(400, errPass);
    if (passNueva === passActual) throw new ErrorHttp(400, "La contraseña nueva debe ser distinta de la actual");

    const hash = await bcrypt.hash(String(passNueva), BCRYPT_COSTE);
    const tv = (u.token_version || 0) + 1;
    await actualizarUsuario(
      supabase,
      u.id,
      { password_hash: hash, intentos: 0, must_change_password: false, token_version: tv },
      ["must_change_password", "token_version"]
    );
    invalidarSesion(u.nick);
    await auditar(supabase, r.sesion, "cambiar_password", "usuario", u.nick);
    const actualizado = { ...u, must_change_password: false, token_version: tv };
    return res.status(200).json({ ok: true, token: firmarToken(actualizado), usuario: usuarioPublico(actualizado) });
  }

  if (!nickBusqueda) throw new ErrorHttp(400, "Falta el usuario");

  // ── ¿EXISTE? ──────────────────────────────────────────
  if (action === "check") {
    let u = await buscarUsuario(supabase, nickBusqueda, "id, nick, locked, bloqueado_hasta").catch(async (e) => {
      if (!esErrorEsquema(e)) throw e;
      return buscarUsuario(supabase, nickBusqueda, "id, nick, locked");
    });
    if (u) u = await desbloquearSiCaduco(supabase, u);
    return res.status(200).json({
      existe: !!u,
      bloqueado: u?.locked || false,
      mensajeBloqueo: u?.locked ? mensajeBloqueo(u) : undefined,
      registroAbierto: registroAbierto(),
    });
  }

  // ── REGISTRO (alta rápida de un usuario nuevo) ───────
  if (action === "register") {
    if (!registroAbierto()) {
      throw new ErrorHttp(403, "El alta de usuarios desde el login está cerrada. Pide al administrador que te dé de alta.", "REGISTRO_CERRADO");
    }
    const nickNuevo = validarNickNuevo(nick);
    const errPass = errorPassword(pass, nickNuevo);
    if (errPass) throw new ErrorHttp(400, errPass);
    const nom = nombrePersona(nombre, "El nombre", true);
    const ap1 = nombrePersona(apellido1, "El primer apellido", true);
    const ap2 = nombrePersona(apellido2, "El segundo apellido");

    if (await buscarUsuario(supabase, nickNuevo, "id")) throw new ErrorHttp(409, "Ese usuario ya existe");
    const hash = await bcrypt.hash(pass, BCRYPT_COSTE);
    const { data: creado, error } = await supabase
      .from("usuarios")
      .insert({
        nick: nickNuevo,
        password_hash: hash,
        nombre: nom,
        apellido1: ap1,
        apellido2: ap2,
        role: "user",
        locked: false,
        intentos: 0,
      })
      .select()
      .single();
    if (esViolacionUnica(error)) throw new ErrorHttp(409, "Ese usuario ya existe");
    if (error) throw error;

    await auditar(supabase, { nick: nickNuevo }, "registro", "usuario", nickNuevo);
    return res.status(200).json({ ok: true, token: firmarToken(creado), usuario: usuarioPublico(creado) });
  }

  // ── LOGIN ─────────────────────────────────────────────
  if (action === "login") {
    if (!pass) throw new ErrorHttp(400, "Falta la contraseña");
    let u = await buscarUsuario(supabase, nickBusqueda);
    if (!u) throw new ErrorHttp(404, "Usuario no encontrado");
    u = await desbloquearSiCaduco(supabase, u);
    if (u.locked) throw new ErrorHttp(403, mensajeBloqueo(u), "BLOQUEADO");

    const ok = await bcrypt.compare(String(pass), u.password_hash);
    if (!ok) await registrarFallo(supabase, u, "Contraseña incorrecta");

    if (u.intentos > 0) await actualizarUsuario(supabase, u.id, { intentos: 0 });
    return res.status(200).json({ ok: true, token: firmarToken(u), usuario: usuarioPublico(u) });
  }

  throw new ErrorHttp(400, "Acción no reconocida");
}, { publico: true });
