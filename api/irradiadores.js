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

import { apiHandler, ErrorHttp, exigirAdmin } from "./_lib/http.js";
import { nombrePersona, uuid } from "./_lib/validate.js";
import { auditar } from "./_lib/audit.js";

export default apiHandler(async ({ res, action, payload, sesion, supabase }) => {
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
  exigirAdmin(sesion, "No tienes permiso para gestionar irradiadores.");

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
    const nombre = nombrePersona(payload.nombre, "El nombre", true);
    const apellido1 = nombrePersona(payload.apellido1, "El primer apellido", true);
    const apellido2 = nombrePersona(payload.apellido2, "El segundo apellido");
    const { data, error } = await supabase
      .from("irradiadores")
      .insert({ nombre, apellido1, apellido2, activo: true })
      .select("id")
      .single();
    if (error) throw error;
    await auditar(supabase, sesion, "crear", "irradiador", data?.id, { nombre, apellido1 });
    return res.status(200).json({ ok: true });
  }

  // ── EDITAR ────────────────────────────────────────────
  if (action === "editar") {
    const id = uuid(payload.id);
    if (!id) throw new ErrorHttp(400, "Falta el identificador");
    const { nombre, apellido1, apellido2, activo } = payload;
    const cambios = {};
    if (nombre !== undefined) cambios.nombre = nombrePersona(nombre, "El nombre", true);
    if (apellido1 !== undefined) cambios.apellido1 = nombrePersona(apellido1, "El primer apellido", true);
    if (apellido2 !== undefined) cambios.apellido2 = nombrePersona(apellido2, "El segundo apellido");
    if (activo !== undefined) cambios.activo = !!activo;
    if (Object.keys(cambios).length === 0) throw new ErrorHttp(400, "No hay ningún cambio que guardar");
    const { error } = await supabase.from("irradiadores").update(cambios).eq("id", id);
    if (error) throw error;
    await auditar(supabase, sesion, "editar", "irradiador", id, { campos: Object.keys(cambios) });
    return res.status(200).json({ ok: true });
  }

  // ── ELIMINAR ──────────────────────────────────────────
  if (action === "eliminar") {
    const id = uuid(payload.id);
    if (!id) throw new ErrorHttp(400, "Falta el identificador");
    const { error } = await supabase.from("irradiadores").delete().eq("id", id);
    if (error) throw error;
    await auditar(supabase, sesion, "eliminar", "irradiador", id);
    return res.status(200).json({ ok: true });
  }

  throw new ErrorHttp(400, "Acción no reconocida");
});
