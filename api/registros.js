// /api/registros — guardar, consultar y eliminar los registros del formulario
//
// action:"guardar"  -> inserta un registro nuevo (requiere sesión válida).
//                      Si el navegador envía un "uid" y ese registro ya se
//                      había guardado (p. ej. la respuesta se perdió por mala
//                      cobertura y se reintenta), NO se duplica.
// action:"listar"   -> devuelve registros, opcionalmente filtrados por
//                      fecha de irradiación (payload.desde / payload.hasta,
//                      formato YYYY-MM-DD). Devuelve todos los que coinciden
//                      (paginando por dentro, hasta 10 000) e indica si se
//                      ha tenido que recortar ("truncado").
// action:"eliminar" -> borra un registro. Puede hacerlo un admin sobre
//                      cualquier registro, o cualquier usuario sobre los
//                      registros que él mismo guardó.
// action:"nuevos"   -> devuelve los registros guardados por CUALQUIER
//                      usuario después de payload.desde (marca de tiempo
//                      ISO). Se usa para las notificaciones "alguien ha
//                      guardado un registro", consultando cada poco tiempo
//                      desde el navegador (sin exponer Supabase directamente).
// action:"actualizar" -> modifica un registro ya guardado (acción "Editar").
//                      Igual que eliminar: un admin puede editar cualquiera,
//                      un usuario normal solo los que él mismo guardó.

import { apiHandler, ErrorHttp } from "./_lib/http.js";
import { leerTodo, esErrorEsquema, esViolacionUnica } from "./_lib/db.js";
import { texto, numero, fecha, hora, uuid, esFecha, marcaTiempo } from "./_lib/validate.js";
import { auditar } from "./_lib/audit.js";

// Una "urna" es {n, date, lote}: se limpia campo a campo (no se guarda nada que no toque).
function urna(u) {
  if (!u || typeof u !== "object") return null;
  const date = typeof u.date === "string" && esFecha(u.date) ? u.date : "";
  return {
    n: texto(u.n ?? "", { max: 10, etiqueta: "El número de urnas" }),
    date,
    lote: texto(u.lote ?? "", { max: 20, etiqueta: "El lote" }),
  };
}

// Convierte el registro que envía el navegador en la fila de la tabla, validando cada campo.
function filaDesdeRegistro(r) {
  return {
    fecha_irradiacion: fecha(r.fchIrr, "La fecha de irradiación"),
    semana_iso: numero(r.semana, { min: 1, max: 53, entero: true, etiqueta: "La semana ISO" }),
    tasa: numero(r.tasa, { min: 0, max: 10, etiqueta: "La tasa" }),
    tiempo_exposicion: numero(r.texp, { min: 0, max: 1e7, etiqueta: "El tiempo de exposición" }),
    tiempo_exposicion_real: numero(r.texpReal, { min: 0, max: 1e7, etiqueta: "El tiempo de exposición real" }),
    exposicion_usv: numero(r.expUsv, { min: 0, max: 1e6, etiqueta: "La exposición (µSv)" }),
    n_urnas: numero(r.nUrnas, { min: 0, max: 100000, entero: true, etiqueta: "El número de urnas" }),
    urna1: urna(r.u1),
    urna2: urna(r.u2),
    urna3: urna(r.u3),
    conductor_nick: texto(r.respNick, { max: 60 }) || null,
    conductor_nombre: texto(r.resp, { max: 200 }) || null,
    conductor_codigo: texto(r.respCodigo, { max: 5 }) || null,
    h_ida_inicio: hora(r.hII, "La hora de inicio de la ida"),
    h_ida_llegada: hora(r.hIL, "La hora de llegada de la ida"),
    h_vuelta_inicio: hora(r.hVI, "La hora de inicio de la vuelta"),
    h_vuelta_llegada: hora(r.hVL, "La hora de llegada de la vuelta"),
    temp_inicial: numero(r.ti, { min: -100, max: 200, etiqueta: "La temperatura inicial" }),
    temp_final: numero(r.tf, { min: -100, max: 200, etiqueta: "La temperatura final" }),
    temp_media: numero(r.tm, { min: -100, max: 200, etiqueta: "La temperatura media" }),
    irradiador: texto(r.irr, { max: 200 }) || null,
    irradiador_id: uuid(r.irrId, "El irradiador"),
    irradiador_nombre: texto(r.irrNombre, { max: 200 }) || null,
    irradiador_codigo: texto(r.irrCodigo, { max: 5 }) || null,
    dosimetros: numero(r.dos, { min: 0, max: 10000, entero: true, etiqueta: "El número de dosímetros" }),
    h_inicio_irr: hora(r.hIni, "La hora de inicio de la irradiación"),
    h_fin_irr: hora(r.hFin, "La hora de fin de la irradiación"),
    observaciones: texto(r.obs, { max: 5000, multilinea: true, etiqueta: "Las observaciones" }) || null,
  };
}

const UID_RE = /^[A-Za-z0-9_.:-]{8,64}$/;

async function comprobarPropiedad(supabase, id, sesion, verbo) {
  const { data: existente, error } = await supabase
    .from("registros")
    .select("id, creado_por, fecha_irradiacion")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!existente) throw new ErrorHttp(404, "Registro no encontrado");
  if (sesion.role !== "admin" && existente.creado_por !== sesion.nick) {
    throw new ErrorHttp(403, `Solo puedes ${verbo} tus propios registros`);
  }
  return existente;
}

export default apiHandler(async ({ res, action, payload, sesion, supabase }) => {
  // ── GUARDAR ───────────────────────────────────────────
  if (action === "guardar") {
    const fila = { ...filaDesdeRegistro(payload), creado_por: sesion.nick };
    const uid = typeof payload.uid === "string" && UID_RE.test(payload.uid) ? payload.uid : null;
    if (uid) fila.client_uid = uid;

    let { data, error } = await supabase.from("registros").insert(fila).select("id, created_at").single();
    if (uid && esErrorEsquema(error)) {
      // Esquema sin actualizar (falta client_uid): se guarda igualmente, sin protección anti-duplicados.
      delete fila.client_uid;
      ({ data, error } = await supabase.from("registros").insert(fila).select("id, created_at").single());
    } else if (uid && esViolacionUnica(error)) {
      const { data: previo } = await supabase
        .from("registros")
        .select("id, created_at")
        .eq("creado_por", sesion.nick)
        .eq("client_uid", uid)
        .maybeSingle();
      if (previo) return res.status(200).json({ ok: true, id: previo.id, created_at: previo.created_at, duplicado: true });
    }
    if (error) throw error;
    return res.status(200).json({ ok: true, id: data.id, created_at: data.created_at });
  }

  // ── LISTAR ────────────────────────────────────────────
  if (action === "listar") {
    const desde = fecha(payload.desde, "La fecha «desde»");
    const hasta = fecha(payload.hasta, "La fecha «hasta»");
    const { filas, truncado } = await leerTodo(() => {
      let q = supabase
        .from("registros")
        .select("*")
        .order("fecha_irradiacion", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id", { ascending: true }); // desempate: las páginas de 1000 no se solapan ni se saltan filas
      if (desde) q = q.gte("fecha_irradiacion", desde);
      if (hasta) q = q.lte("fecha_irradiacion", hasta);
      return q;
    });
    return res.status(200).json({ registros: filas, truncado });
  }

  // ── ELIMINAR ──────────────────────────────────────────
  if (action === "eliminar") {
    const id = uuid(payload.id);
    if (!id) throw new ErrorHttp(400, "Falta el identificador del registro");
    const existente = await comprobarPropiedad(supabase, id, sesion, "eliminar");
    const { error } = await supabase.from("registros").delete().eq("id", id);
    if (error) throw error;
    await auditar(supabase, sesion, "eliminar", "registro", id, { fecha: existente.fecha_irradiacion, creado_por: existente.creado_por });
    return res.status(200).json({ ok: true });
  }

  // ── ACTUALIZAR (editar un registro existente) ─────────
  if (action === "actualizar") {
    const id = uuid(payload.id);
    if (!id) throw new ErrorHttp(400, "Falta el identificador del registro");
    const existente = await comprobarPropiedad(supabase, id, sesion, "editar");
    const fila = filaDesdeRegistro(payload.registro && typeof payload.registro === "object" ? payload.registro : {});
    const { error } = await supabase.from("registros").update(fila).eq("id", id);
    if (error) throw error;
    await auditar(supabase, sesion, "actualizar", "registro", id, { fecha: existente.fecha_irradiacion, creado_por: existente.creado_por });
    return res.status(200).json({ ok: true });
  }

  // ── NUEVOS (para notificaciones) ───────────────────────
  if (action === "nuevos") {
    if (!payload.desde) throw new ErrorHttp(400, "Falta la marca de tiempo 'desde'");
    const desde = marcaTiempo(payload.desde, "La marca de tiempo 'desde'");
    const { data, error } = await supabase
      .from("registros")
      .select("id, created_at, creado_por, conductor_nombre, fecha_irradiacion, semana_iso")
      .gt("created_at", desde)
      .order("created_at", { ascending: true })
      .limit(50);
    if (error) throw error;
    return res.status(200).json({ registros: data });
  }

  throw new ErrorHttp(400, "Acción no reconocida");
});
