// /api/calibraciones — aparatos de irradiación (tasa de emisión en Gy/h a una fecha de referencia)
//
// Hasta ahora la app calculaba el tiempo de exposición con UNA tasa fija, pensada para un único
// aparato. Esta API permite dar de alta OTROS aparatos (p. ej. uno nuevo con otra actividad y otra
// fecha de calibración) y elegir cuál está activo ahora mismo. El aparato "de fábrica" —el que ya
// usaba la app— no es una fila de esta tabla: vive en el propio código del navegador como opción
// siempre disponible, así que esta lista puede estar vacía sin que nada deje de funcionar; "activar"
// ese aparato de fábrica se hace con action:"activarOriginal", que simplemente apaga las demás.
//
// Cambiar qué calibración está activa afecta a los cálculos de dosis/tiempo de TODA la app para
// TODOS los usuarios, así que —a diferencia de vehículos o estaciones— esto es enteramente cosa de
// administradores: los demás usuarios solo pueden leer la lista (listPublic), para saber con qué
// aparato se está trabajando ahora mismo y verlo reflejado en el formulario.
//
// action:"listPublic"      -> lista completa (cualquier usuario con sesión).
// action:"crear"           -> da de alta un aparato nuevo. Solo admin.
// action:"editar"          -> modifica nombre/fecha/tasa. Solo admin.
// action:"activar"         -> marca un aparato como el activo (apaga los demás). Solo admin.
// action:"activarOriginal" -> vuelve al aparato de fábrica (apaga todos los de la tabla). Solo admin.
// action:"eliminar"        -> borra un aparato (no se puede borrar el que esté activo). Solo admin.

import { apiHandler, ErrorHttp, exigirAdmin } from "./_lib/http.js";
import { texto, numero, fecha, uuid, ErrorValidacion } from "./_lib/validate.js";
import { auditar } from "./_lib/audit.js";

function validarCalibracion(payload, { requerirTodo }) {
  const cambios = {};
  if (requerirTodo || payload.nombre !== undefined) cambios.nombre = texto(payload.nombre, { max: 80, obligatorio: true, etiqueta: "El nombre del aparato" });
  if (requerirTodo || payload.fechaReferencia !== undefined) {
    const f = fecha(payload.fechaReferencia, "La fecha de referencia");
    if (!f) throw new ErrorValidacion("Falta la fecha de referencia");
    cambios.fecha_referencia = f;
  }
  if (requerirTodo || payload.tasaGyH !== undefined) {
    cambios.tasa_gy_h = numero(payload.tasaGyH, { min: 0.000001, max: 1000000, etiqueta: "La tasa de emisión (Gy/h)" });
    if (cambios.tasa_gy_h == null) throw new ErrorValidacion("Falta la tasa de emisión (Gy/h)");
  }
  return cambios;
}

export default apiHandler(async ({ res, action, payload, sesion, supabase }) => {
  // ── LISTA (cualquier usuario con sesión) ─────────────
  if (action === "listPublic") {
    const { data, error } = await supabase
      .from("calibraciones_irradiacion")
      .select("id, nombre, fecha_referencia, tasa_gy_h, activa, created_at")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return res.status(200).json({ calibraciones: data });
  }

  // A partir de aquí, todas las acciones son solo para administradores.
  exigirAdmin(sesion, "No tienes permiso para gestionar las calibraciones de irradiación.");

  // ── CREAR ─────────────────────────────────────────────
  if (action === "crear") {
    const cambios = validarCalibracion(payload, { requerirTodo: true });
    const { data, error } = await supabase
      .from("calibraciones_irradiacion")
      .insert({ ...cambios, activa: false, creado_por: sesion.nick })
      .select("id")
      .single();
    if (error) throw error;
    await auditar(supabase, sesion, "crear", "calibracion", data?.id, { nombre: cambios.nombre });
    return res.status(200).json({ ok: true, id: data.id });
  }

  // ── EDITAR ────────────────────────────────────────────
  if (action === "editar") {
    const id = uuid(payload.id);
    if (!id) throw new ErrorHttp(400, "Falta el identificador");
    const cambios = validarCalibracion(payload, { requerirTodo: false });
    if (Object.keys(cambios).length === 0) throw new ErrorHttp(400, "No hay ningún cambio que guardar");
    const { error } = await supabase.from("calibraciones_irradiacion").update(cambios).eq("id", id);
    if (error) throw error;
    await auditar(supabase, sesion, "editar", "calibracion", id, { campos: Object.keys(cambios) });
    return res.status(200).json({ ok: true });
  }

  // ── ACTIVAR ───────────────────────────────────────────
  if (action === "activar") {
    const id = uuid(payload.id);
    if (!id) throw new ErrorHttp(400, "Falta el identificador");
    const { data: existente, error: errBusq } = await supabase.from("calibraciones_irradiacion").select("id").eq("id", id).maybeSingle();
    if (errBusq) throw errBusq;
    if (!existente) throw new ErrorHttp(404, "Esa calibración no existe");
    // Primero se apagan todas, luego se enciende la elegida: así nunca hay un instante con dos activas.
    const { error: e1 } = await supabase.from("calibraciones_irradiacion").update({ activa: false }).eq("activa", true);
    if (e1) throw e1;
    const { error: e2 } = await supabase.from("calibraciones_irradiacion").update({ activa: true }).eq("id", id);
    if (e2) throw e2;
    await auditar(supabase, sesion, "activar", "calibracion", id);
    return res.status(200).json({ ok: true });
  }

  // ── ACTIVAR EL APARATO DE FÁBRICA ─────────────────────
  if (action === "activarOriginal") {
    const { error } = await supabase.from("calibraciones_irradiacion").update({ activa: false }).eq("activa", true);
    if (error) throw error;
    await auditar(supabase, sesion, "activar", "calibracion", "original");
    return res.status(200).json({ ok: true });
  }

  // ── ELIMINAR ──────────────────────────────────────────
  if (action === "eliminar") {
    const id = uuid(payload.id);
    if (!id) throw new ErrorHttp(400, "Falta el identificador");
    const { data: existente, error: errBusq } = await supabase.from("calibraciones_irradiacion").select("activa").eq("id", id).maybeSingle();
    if (errBusq) throw errBusq;
    if (existente?.activa) throw new ErrorHttp(400, "No se puede eliminar la calibración activa: activa primero otra (o el aparato de fábrica).");
    const { error } = await supabase.from("calibraciones_irradiacion").delete().eq("id", id);
    if (error) throw error;
    await auditar(supabase, sesion, "eliminar", "calibracion", id);
    return res.status(200).json({ ok: true });
  }

  throw new ErrorHttp(400, "Acción no reconocida");
});
