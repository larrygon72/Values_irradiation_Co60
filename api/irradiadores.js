// /api/irradiadores — gestión de irradiadores (operadores del equipo)
//
// Son personas distintas de los conductores/usuarios: no tienen cuenta ni
// contraseña, solo se eligen en un desplegable al rellenar un registro.
//
// action:"listPublic" -> lista mínima (nombre, apellidos, código), para
//                        rellenar el desplegable. La puede pedir cualquier
//                        usuario con sesión iniciada.
// action:"list"        -> lista completa (incluye activo/inactivo). Solo admin.
// action:"crear"       -> da de alta un irradiador. Solo admin.
// action:"editar"      -> modifica nombre/apellidos/activo. Solo admin.
// action:"eliminar"    -> borra un irradiador. Solo admin.

import { getSupabaseAdmin } from "./_lib/supabaseAdmin.js";
import { verificarToken } from "./_lib/auth.js";

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
    // ── LISTA PÚBLICA (desplegable en Irradiación) ───────
    if (action === "listPublic") {
      const { data, error } = await supabase
        .from("irradiadores")
        .select("id, nombre, apellido1, apellido2, codigo")
        .eq("activo", true)
        .order("nombre", { ascending: true });
      if (error) throw error;
      return res.status(200).json({ irradiadores: data });
    }

    // A partir de aquí, todas las acciones son solo para administradores.
    if (sesion.role !== "admin") {
      return res.status(403).json({ error: "No tienes permiso para gestionar irradiadores." });
    }

    // ── LISTA COMPLETA ────────────────────────────────────
    if (action === "list") {
      const { data, error } = await supabase
        .from("irradiadores")
        .select("id, nombre, apellido1, apellido2, codigo, activo, created_at")
        .order("nombre", { ascending: true });
      if (error) throw error;
      return res.status(200).json({ irradiadores: data });
    }

    // ── CREAR ─────────────────────────────────────────────
    if (action === "crear") {
      const { nombre, apellido1, apellido2 } = payload || {};
      if (!nombre || !apellido1) {
        return res.status(400).json({ error: "El nombre y el primer apellido son obligatorios" });
      }
      const { error } = await supabase.from("irradiadores").insert({
        nombre: nombre.trim(),
        apellido1: apellido1.trim(),
        apellido2: (apellido2 || "").trim(),
        activo: true,
      });
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    // ── EDITAR ────────────────────────────────────────────
    if (action === "editar") {
      const { id, nombre, apellido1, apellido2, activo } = payload || {};
      if (!id) return res.status(400).json({ error: "Falta el identificador" });
      const cambios = {};
      if (nombre !== undefined) cambios.nombre = (nombre || "").trim();
      if (apellido1 !== undefined) cambios.apellido1 = (apellido1 || "").trim();
      if (apellido2 !== undefined) cambios.apellido2 = (apellido2 || "").trim();
      if (activo !== undefined) cambios.activo = !!activo;
      if (Object.keys(cambios).length === 0) {
        return res.status(400).json({ error: "No hay ningún cambio que guardar" });
      }
      const { error } = await supabase.from("irradiadores").update(cambios).eq("id", id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    // ── ELIMINAR ──────────────────────────────────────────
    if (action === "eliminar") {
      const { id } = payload || {};
      if (!id) return res.status(400).json({ error: "Falta el identificador" });
      const { error } = await supabase.from("irradiadores").delete().eq("id", id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "Acción no reconocida" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Error inesperado" });
  }
}
