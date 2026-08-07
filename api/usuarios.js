// /api/usuarios — gestión de usuarios
//
// action:"listPublic" -> lista mínima (nick, nombre, apellidos, código) para
//                        rellenar el desplegable de "Conductor" del formulario.
//                        La puede pedir cualquier usuario con sesión iniciada.
// action:"list"        -> lista completa (incluye rol y bloqueado). Solo admin.
// action:"crear"       -> da de alta un usuario nuevo. Solo admin.
// action:"eliminar"    -> borra un usuario. Solo admin, y a "Admin" solo
//                         puede borrarlo el propio "Admin".
// action:"desbloquear" -> desbloquea un usuario tras 3 intentos fallidos. Solo admin.
// action:"editar"      -> modifica nombre/apellidos/rol/contraseña de un
//                         usuario existente. Solo admin. El rol de "Admin"
//                         solo puede cambiarlo el propio "Admin".

import bcrypt from "bcryptjs";
import { getSupabaseAdmin } from "./_lib/supabaseAdmin.js";
import { verificarToken } from "./_lib/auth.js";

const NICK_PROTEGIDO = "admin"; // en minúsculas, para comparar sin distinguir mayúsculas

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  const { action, token, payload } = req.body || {};
  const sesion = verificarToken(token);
  if (!sesion) return res.status(401).json({ error: "Sesión no válida o caducada" });

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  try {
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
    if (sesion.role !== "admin") {
      return res.status(403).json({ error: "No tienes permiso para gestionar usuarios." });
    }

    // ── LISTA COMPLETA ────────────────────────────────────
    if (action === "list") {
      const { data, error } = await supabase
        .from("usuarios")
        .select("nick, nombre, apellido1, apellido2, codigo, role, locked, created_at")
        .order("nick", { ascending: true });
      if (error) throw error;
      return res.status(200).json({ usuarios: data });
    }

    // ── CREAR ─────────────────────────────────────────────
    if (action === "crear") {
      const { nick, pass, nombre, apellido1, apellido2, role } = payload || {};
      const nickLimpio = (nick || "").trim();
      if (!nickLimpio || !pass) {
        return res.status(400).json({ error: "Usuario y contraseña son obligatorios" });
      }
      if (pass.length < 4) {
        return res.status(400).json({ error: "La contraseña debe tener al menos 4 caracteres" });
      }
      const { data: existente } = await supabase
        .from("usuarios")
        .select("id")
        .ilike("nick", nickLimpio)
        .maybeSingle();
      if (existente) return res.status(409).json({ error: "Ese usuario ya existe" });

      const hash = await bcrypt.hash(pass, 10);
      const { error } = await supabase.from("usuarios").insert({
        nick: nickLimpio,
        password_hash: hash,
        nombre: (nombre || "").trim(),
        apellido1: (apellido1 || "").trim(),
        apellido2: (apellido2 || "").trim(),
        role: role === "admin" ? "admin" : "user",
        locked: false,
        intentos: 0,
      });
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    // A partir de aquí necesitamos saber sobre qué usuario se actúa.
    const nickDestino = (payload?.nick || "").trim();
    if (!nickDestino) return res.status(400).json({ error: "Falta el usuario" });
    const esElProtegido = nickDestino.toLowerCase() === NICK_PROTEGIDO;
    const loPideElProtegido = sesion.nick.toLowerCase() === NICK_PROTEGIDO;

    // ── ELIMINAR ──────────────────────────────────────────
    if (action === "eliminar") {
      if (esElProtegido && !loPideElProtegido) {
        return res
          .status(403)
          .json({ error: 'El usuario "Admin" solo puede eliminarse a sí mismo.' });
      }
      const { error } = await supabase
        .from("usuarios")
        .delete()
        .ilike("nick", nickDestino);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    // ── DESBLOQUEAR ───────────────────────────────────────
    if (action === "desbloquear") {
      const { error } = await supabase
        .from("usuarios")
        .update({ locked: false, intentos: 0 })
        .ilike("nick", nickDestino);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    // ── EDITAR ────────────────────────────────────────────
    if (action === "editar") {
      const { nombre, apellido1, apellido2, role, nuevaPass } = payload || {};
      const cambios = {};
      if (nombre !== undefined) cambios.nombre = (nombre || "").trim();
      if (apellido1 !== undefined) cambios.apellido1 = (apellido1 || "").trim();
      if (apellido2 !== undefined) cambios.apellido2 = (apellido2 || "").trim();

      if (role !== undefined) {
        if (esElProtegido && !loPideElProtegido) {
          return res
            .status(403)
            .json({ error: 'El rol de "Admin" solo puede cambiarlo el propio "Admin".' });
        }
        cambios.role = role === "admin" ? "admin" : "user";
      }

      if (nuevaPass) {
        if (nuevaPass.length < 4) {
          return res.status(400).json({ error: "La contraseña debe tener al menos 4 caracteres" });
        }
        cambios.password_hash = await bcrypt.hash(nuevaPass, 10);
      }

      if (Object.keys(cambios).length === 0) {
        return res.status(400).json({ error: "No hay ningún cambio que guardar" });
      }

      const { error } = await supabase
        .from("usuarios")
        .update(cambios)
        .ilike("nick", nickDestino);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "Acción no reconocida" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Error inesperado" });
  }
}
