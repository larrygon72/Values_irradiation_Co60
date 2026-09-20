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

import { apiHandler, ErrorHttp, exigirAdmin } from "./_lib/http.js";
import { igualCI, esViolacionUnica } from "./_lib/db.js";
import { texto, uuid } from "./_lib/validate.js";
import { auditar } from "./_lib/audit.js";

const nombreEstacion = (v) => texto(v, { max: 80, obligatorio: true, etiqueta: "El nombre de la estación" }).replace(/\s+/g, " ");

export default apiHandler(async ({ res, action, payload, sesion, supabase }) => {
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
    const nombreNorm = nombreEstacion(payload.nombre);
    const { data: existente, error: errBusq } = await igualCI(supabase.from("estaciones_servicio").select("id, activo"), "nombre", nombreNorm).maybeSingle();
    if (errBusq) throw errBusq;
    if (existente) {
      throw new ErrorHttp(
        400,
        existente.activo
          ? "Ya existe una estación con ese nombre. Selecciónala en el desplegable."
          : "Ya existe una estación con ese nombre, pero está desactivada. Pide a un administrador que la reactive."
      );
    }
    const { data, error } = await supabase
      .from("estaciones_servicio")
      .insert({ nombre: nombreNorm, activo: true, creado_por: sesion.nick })
      .select("id, nombre")
      .single();
    if (esViolacionUnica(error)) throw new ErrorHttp(400, "Ya existe una estación con ese nombre. Selecciónala en el desplegable.");
    if (error) throw error;
    return res.status(200).json({ ok: true, id: data.id, estacion: data });
  }

  // A partir de aquí, todas las acciones son solo para administradores.
  exigirAdmin(sesion, "No tienes permiso para gestionar estaciones de servicio.");

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
    const id = uuid(payload.id);
    if (!id) throw new ErrorHttp(400, "Falta el identificador");
    const { nombre, activo } = payload;
    const cambios = {};
    if (nombre !== undefined) cambios.nombre = nombreEstacion(nombre);
    if (activo !== undefined) cambios.activo = !!activo;
    if (Object.keys(cambios).length === 0) throw new ErrorHttp(400, "No hay ningún cambio que guardar");
    if (cambios.nombre) {
      const { data: existente, error: errBusq } = await igualCI(supabase.from("estaciones_servicio").select("id"), "nombre", cambios.nombre)
        .neq("id", id)
        .maybeSingle();
      if (errBusq) throw errBusq;
      if (existente) throw new ErrorHttp(400, "Ya existe otra estación con ese nombre");
    }
    const { error } = await supabase.from("estaciones_servicio").update(cambios).eq("id", id);
    if (error) throw error;
    await auditar(supabase, sesion, "editar", "estacion", id, { campos: Object.keys(cambios) });
    return res.status(200).json({ ok: true });
  }

  // ── ELIMINAR ──────────────────────────────────────────
  if (action === "eliminar") {
    const id = uuid(payload.id);
    if (!id) throw new ErrorHttp(400, "Falta el identificador");
    const { error } = await supabase.from("estaciones_servicio").delete().eq("id", id);
    if (error) throw error;
    await auditar(supabase, sesion, "eliminar", "estacion", id);
    return res.status(200).json({ ok: true });
  }

  throw new ErrorHttp(400, "Acción no reconocida");
});
