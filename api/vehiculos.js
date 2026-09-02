// /api/vehiculos — gestión de vehículos disponibles (matrícula + obra)
//
// Los vehículos se eligen en un desplegable al registrar un viaje o un
// repostaje en la pantalla de Conducción. Si la matrícula buscada no
// existe todavía, CUALQUIER usuario con sesión iniciada puede darla de
// alta (indicando también el número de obra al que pertenece el
// vehículo) — es el mismo flujo de "si no está, se crea". Editar,
// desactivar o eliminar un vehículo ya existente es una acción solo
// para administradores (pantalla "Vehículos").
//
// action:"listPublic" -> lista de vehículos activos (para el desplegable).
//                        La puede pedir cualquier usuario con sesión.
// action:"list"        -> lista completa (incluye inactivos). Solo admin.
// action:"crear"       -> da de alta un vehículo nuevo (matrícula + obra).
//                        Cualquier usuario con sesión iniciada.
// action:"editar"      -> modifica matrícula/obra/activo. Solo admin.
// action:"eliminar"    -> borra un vehículo. Solo admin.

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
        .from("vehiculos")
        .select("id, matricula, numero_obra")
        .eq("activo", true)
        .order("matricula", { ascending: true });
      if (error) throw error;
      return res.status(200).json({ vehiculos: data });
    }

    // ── CREAR ─────────────────────────────────────────────
    // Disponible para cualquier usuario con sesión iniciada: es el
    // flujo de "matrícula no encontrada -> se crea al vuelo" desde
    // la pantalla de Conducción.
    if (action === "crear") {
      const { matricula, numeroObra } = payload || {};
      if (!matricula || !matricula.trim()) {
        return res.status(400).json({ error: "Falta la matrícula del vehículo" });
      }
      if (!numeroObra || !numeroObra.trim()) {
        return res.status(400).json({ error: "Falta el número de obra del vehículo" });
      }
      const matriculaNorm = matricula.trim().toUpperCase();

      const { data: existente, error: errBusq } = await supabase
        .from("vehiculos")
        .select("id, activo")
        .ilike("matricula", matriculaNorm)
        .maybeSingle();
      if (errBusq) throw errBusq;
      if (existente) {
        return res.status(400).json({
          error: existente.activo
            ? "Ya existe un vehículo con esa matrícula. Selecciónalo en el desplegable."
            : "Ya existe un vehículo con esa matrícula, pero está desactivado. Pide a un administrador que lo reactive.",
        });
      }

      const { data, error } = await supabase
        .from("vehiculos")
        .insert({
          matricula: matriculaNorm,
          numero_obra: numeroObra.trim(),
          activo: true,
          creado_por: sesion.nick,
        })
        .select("id, matricula, numero_obra")
        .single();
      if (error) throw error;
      return res.status(200).json({ ok: true, id: data.id, vehiculo: data });
    }

    // A partir de aquí, todas las acciones son solo para administradores.
    if (sesion.role !== "admin") {
      return res.status(403).json({ error: "No tienes permiso para gestionar vehículos." });
    }

    // ── LISTA COMPLETA ────────────────────────────────────
    if (action === "list") {
      const { data, error } = await supabase
        .from("vehiculos")
        .select("id, matricula, numero_obra, activo, creado_por, created_at")
        .order("matricula", { ascending: true });
      if (error) throw error;
      return res.status(200).json({ vehiculos: data });
    }

    // ── EDITAR ────────────────────────────────────────────
    if (action === "editar") {
      const { id, matricula, numeroObra, activo } = payload || {};
      if (!id) return res.status(400).json({ error: "Falta el identificador" });
      const cambios = {};
      if (matricula !== undefined) {
        if (!matricula.trim()) return res.status(400).json({ error: "La matrícula no puede quedar vacía" });
        cambios.matricula = matricula.trim().toUpperCase();
      }
      if (numeroObra !== undefined) cambios.numero_obra = (numeroObra || "").trim();
      if (activo !== undefined) cambios.activo = !!activo;
      if (Object.keys(cambios).length === 0) {
        return res.status(400).json({ error: "No hay ningún cambio que guardar" });
      }
      if (cambios.matricula) {
        const { data: existente, error: errBusq } = await supabase
          .from("vehiculos")
          .select("id")
          .ilike("matricula", cambios.matricula)
          .neq("id", id)
          .maybeSingle();
        if (errBusq) throw errBusq;
        if (existente) {
          return res.status(400).json({ error: "Ya existe otro vehículo con esa matrícula" });
        }
      }
      const { error } = await supabase.from("vehiculos").update(cambios).eq("id", id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    // ── ELIMINAR ──────────────────────────────────────────
    if (action === "eliminar") {
      const { id } = payload || {};
      if (!id) return res.status(400).json({ error: "Falta el identificador" });
      const { error } = await supabase.from("vehiculos").delete().eq("id", id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "Acción no reconocida" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Error inesperado" });
  }
}
