// /api/estaciones — gestión de estaciones de servicio (repostajes)
//
// Las estaciones se eligen en un desplegable al registrar un repostaje en
// la pantalla de Conducción. Si la estación buscada no existe todavía,
// CUALQUIER usuario con sesión iniciada puede darla de alta (de momento
// solo con el nombre — es el mismo flujo de "si no está, se crea" que en
// vehículos). Editar, desactivar o eliminar una estación ya existente es
// una acción solo para administradores (pantalla "Estaciones").
//
// action:"listPublic" -> lista de estaciones activas (para el desplegable).
//                        La puede pedir cualquier usuario con sesión.
// action:"list"        -> lista completa (incluye inactivas). Solo admin.
// action:"crear"       -> da de alta una estación nueva (nombre).
//                        Cualquier usuario con sesión iniciada.
// action:"editar"      -> modifica nombre/activo. Solo admin.
// action:"eliminar"    -> borra una estación. Solo admin.

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
    // ── LISTA PÚBLICA (desplegable en Conducción) ────────
    if (action === "listPublic") {
      const { data, error } = await supabase
        .from("estaciones_servicio")
        .select("id, nombre")
        .eq("activo", true)
        .order("nombre", { ascending: true });
      if (error) throw error;
      return res.status(200).json({ estaciones: data });
    }

    // ── CREAR ─────────────────────────────────────────────
    // Disponible para cualquier usuario con sesión iniciada: es el
    // flujo de "estación no encontrada -> se crea al vuelo" desde
    // la pantalla de Conducción.
    if (action === "crear") {
      const { nombre } = payload || {};
      if (!nombre || !nombre.trim()) {
        return res.status(400).json({ error: "Falta el nombre de la estación" });
      }
      const nombreNorm = nombre.trim();

      const { data: existente, error: errBusq } = await supabase
        .from("estaciones_servicio")
        .select("id, activo")
        .ilike("nombre", nombreNorm)
        .maybeSingle();
      if (errBusq) throw errBusq;
      if (existente) {
        return res.status(400).json({
          error: existente.activo
            ? "Ya existe una estación con ese nombre. Selecciónala en el desplegable."
            : "Ya existe una estación con ese nombre, pero está desactivada. Pide a un administrador que la reactive.",
        });
      }

      const { data, error } = await supabase
        .from("estaciones_servicio")
        .insert({
          nombre: nombreNorm,
          activo: true,
          creado_por: sesion.nick,
        })
        .select("id, nombre")
        .single();
      if (error) throw error;
      return res.status(200).json({ ok: true, id: data.id, estacion: data });
    }

    // A partir de aquí, todas las acciones son solo para administradores.
    if (sesion.role !== "admin") {
      return res.status(403).json({ error: "No tienes permiso para gestionar estaciones de servicio." });
    }

    // ── LISTA COMPLETA ────────────────────────────────────
    if (action === "list") {
      const { data, error } = await supabase
        .from("estaciones_servicio")
        .select("id, nombre, activo, creado_por, created_at")
        .order("nombre", { ascending: true });
      if (error) throw error;
      return res.status(200).json({ estaciones: data });
    }

    // ── EDITAR ────────────────────────────────────────────
    if (action === "editar") {
      const { id, nombre, activo } = payload || {};
      if (!id) return res.status(400).json({ error: "Falta el identificador" });
      const cambios = {};
      if (nombre !== undefined) {
        if (!nombre.trim()) return res.status(400).json({ error: "El nombre no puede quedar vacío" });
        cambios.nombre = nombre.trim();
      }
      if (activo !== undefined) cambios.activo = !!activo;
      if (Object.keys(cambios).length === 0) {
        return res.status(400).json({ error: "No hay ningún cambio que guardar" });
      }
      if (cambios.nombre) {
        const { data: existente, error: errBusq } = await supabase
          .from("estaciones_servicio")
          .select("id")
          .ilike("nombre", cambios.nombre)
          .neq("id", id)
          .maybeSingle();
        if (errBusq) throw errBusq;
        if (existente) {
          return res.status(400).json({ error: "Ya existe otra estación con ese nombre" });
        }
      }
      const { error } = await supabase.from("estaciones_servicio").update(cambios).eq("id", id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    // ── ELIMINAR ──────────────────────────────────────────
    if (action === "eliminar") {
      const { id } = payload || {};
      if (!id) return res.status(400).json({ error: "Falta el identificador" });
      const { error } = await supabase.from("estaciones_servicio").delete().eq("id", id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "Acción no reconocida" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Error inesperado" });
  }
}
