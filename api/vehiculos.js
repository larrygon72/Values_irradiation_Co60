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

import { apiHandler, ErrorHttp, exigirAdmin } from "./_lib/http.js";
import { igualCI, esViolacionUnica } from "./_lib/db.js";
import { texto, uuid } from "./_lib/validate.js";
import { auditar } from "./_lib/audit.js";

const matriculaNormal = (v, obligatorio = true) =>
  texto(v, { max: 20, obligatorio, etiqueta: "La matrícula" }).replace(/\s+/g, " ").toUpperCase();

export default apiHandler(async ({ res, action, payload, sesion, supabase }) => {
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
    const matriculaNorm = matriculaNormal(payload.matricula);
    const numeroObra = texto(payload.numeroObra, { max: 40, obligatorio: true, etiqueta: "El número de obra" });

    const { data: existente, error: errBusq } = await igualCI(supabase.from("vehiculos").select("id, activo"), "matricula", matriculaNorm).maybeSingle();
    if (errBusq) throw errBusq;
    if (existente) {
      throw new ErrorHttp(
        400,
        existente.activo
          ? "Ya existe un vehículo con esa matrícula. Selecciónalo en el desplegable."
          : "Ya existe un vehículo con esa matrícula, pero está desactivado. Pide a un administrador que lo reactive."
      );
    }

    const { data, error } = await supabase
      .from("vehiculos")
      .insert({ matricula: matriculaNorm, numero_obra: numeroObra, activo: true, creado_por: sesion.nick })
      .select("id, matricula, numero_obra")
      .single();
    if (esViolacionUnica(error)) throw new ErrorHttp(400, "Ya existe un vehículo con esa matrícula. Selecciónalo en el desplegable.");
    if (error) throw error;
    return res.status(200).json({ ok: true, id: data.id, vehiculo: data });
  }

  // A partir de aquí, todas las acciones son solo para administradores.
  exigirAdmin(sesion, "No tienes permiso para gestionar vehículos.");

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
    const id = uuid(payload.id);
    if (!id) throw new ErrorHttp(400, "Falta el identificador");
    const { matricula, numeroObra, activo } = payload;
    const cambios = {};
    if (matricula !== undefined) cambios.matricula = matriculaNormal(matricula);
    if (numeroObra !== undefined) cambios.numero_obra = texto(numeroObra, { max: 40, etiqueta: "El número de obra" });
    if (activo !== undefined) cambios.activo = !!activo;
    if (Object.keys(cambios).length === 0) throw new ErrorHttp(400, "No hay ningún cambio que guardar");
    if (cambios.matricula) {
      const { data: existente, error: errBusq } = await igualCI(supabase.from("vehiculos").select("id"), "matricula", cambios.matricula)
        .neq("id", id)
        .maybeSingle();
      if (errBusq) throw errBusq;
      if (existente) throw new ErrorHttp(400, "Ya existe otro vehículo con esa matrícula");
    }
    const { error } = await supabase.from("vehiculos").update(cambios).eq("id", id);
    if (error) throw error;
    await auditar(supabase, sesion, "editar", "vehiculo", id, { campos: Object.keys(cambios) });
    return res.status(200).json({ ok: true });
  }

  // ── ELIMINAR ──────────────────────────────────────────
  if (action === "eliminar") {
    const id = uuid(payload.id);
    if (!id) throw new ErrorHttp(400, "Falta el identificador");
    const { error } = await supabase.from("vehiculos").delete().eq("id", id);
    if (error) throw error;
    await auditar(supabase, sesion, "eliminar", "vehiculo", id);
    return res.status(200).json({ ok: true });
  }

  throw new ErrorHttp(400, "Acción no reconocida");
});
