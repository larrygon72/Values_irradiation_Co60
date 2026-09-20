// /api/conduccion — viajes del vehículo y repostajes de combustible
//
// action:"guardarViaje"      -> inserta un viaje (matrícula, km inicial/final)
// action:"listarViajes"      -> lista viajes, opcionalmente por fecha
// action:"eliminarViaje"     -> borra un viaje (propio, o cualquiera si admin)
// action:"guardarRepostaje"  -> inserta un repostaje
// action:"listarRepostajes"  -> lista repostajes, opcionalmente por fecha
// action:"eliminarRepostaje" -> borra un repostaje (propio, o cualquiera si admin)
// action:"ultimoKmVehiculo"  -> último km final de viaje y último km de
//                              repostaje conocidos para un vehículo (el de
//                              repostaje, filtrado también por tipo de
//                              combustible si se indica), para autorrellenar
//                              los formularios de Conducción

import { apiHandler, ErrorHttp } from "./_lib/http.js";
import { texto, numero, fecha, uuid } from "./_lib/validate.js";
import { auditar } from "./_lib/audit.js";

const TIPOS_COMBUSTIBLE = ["diesel_xtl", "diesel", "gasolina", "adblue"];
const KM_MAX = 5_000_000;

const matriculaNormal = (v) => texto(v, { max: 20, obligatorio: true, etiqueta: "La matrícula" }).replace(/\s+/g, " ").toUpperCase();

async function comprobarPropiedad(supabase, tabla, id, sesion, mensaje) {
  const { data, error } = await supabase.from(tabla).select("creado_por").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new ErrorHttp(404, "No encontrado");
  if (sesion.role !== "admin" && data.creado_por !== sesion.nick) throw new ErrorHttp(403, mensaje);
  return data;
}

export default apiHandler(async ({ res, action, payload, sesion, supabase }) => {
  // ── VIAJES ────────────────────────────────────────────
  if (action === "guardarViaje") {
    const matricula = matriculaNormal(payload.matricula ? payload.matricula : "");
    const kmInicial = numero(payload.kmInicial, { min: 0, max: KM_MAX, etiqueta: "El km inicial" });
    const kmFinal = numero(payload.kmFinal, { min: 0, max: KM_MAX, etiqueta: "El km final" });
    if (kmInicial != null && kmFinal != null && kmFinal < kmInicial) {
      throw new ErrorHttp(400, "El km final no puede ser menor que el km inicial");
    }
    const { data, error } = await supabase
      .from("vehiculo_viajes")
      .insert({
        matricula,
        vehiculo_id: uuid(payload.vehiculoId, "El vehículo"),
        fecha: fecha(payload.fecha),
        km_inicial: kmInicial,
        km_final: kmFinal,
        creado_por: sesion.nick,
      })
      .select("id")
      .single();
    if (error) throw error;
    return res.status(200).json({ ok: true, id: data.id });
  }

  if (action === "listarViajes") {
    const desde = fecha(payload.desde, "La fecha «desde»");
    const hasta = fecha(payload.hasta, "La fecha «hasta»");
    let q = supabase.from("vehiculo_viajes").select("*, vehiculos(numero_obra)").order("fecha", { ascending: false }).order("created_at", { ascending: false }).limit(500);
    if (desde) q = q.gte("fecha", desde);
    if (hasta) q = q.lte("fecha", hasta);
    const { data, error } = await q;
    if (error) throw error;
    return res.status(200).json({ viajes: data });
  }

  if (action === "eliminarViaje") {
    const id = uuid(payload.id);
    if (!id) throw new ErrorHttp(400, "Falta el identificador");
    await comprobarPropiedad(supabase, "vehiculo_viajes", id, sesion, "Solo puedes eliminar tus propios viajes");
    const { error } = await supabase.from("vehiculo_viajes").delete().eq("id", id);
    if (error) throw error;
    await auditar(supabase, sesion, "eliminar", "viaje", id);
    return res.status(200).json({ ok: true });
  }

  // ── REPOSTAJES ────────────────────────────────────────
  if (action === "guardarRepostaje") {
    const matricula = matriculaNormal(payload.matricula ? payload.matricula : "");
    const { tipoCombustible } = payload;
    if (tipoCombustible && !TIPOS_COMBUSTIBLE.includes(tipoCombustible)) {
      throw new ErrorHttp(400, "Tipo de combustible no válido");
    }
    const { data, error } = await supabase
      .from("repostajes")
      .insert({
        matricula,
        vehiculo_id: uuid(payload.vehiculoId, "El vehículo"),
        fecha: fecha(payload.fecha),
        km: numero(payload.km, { min: 0, max: KM_MAX, etiqueta: "El km" }),
        importe: numero(payload.importe, { min: 0, max: 100000, etiqueta: "El importe" }),
        precio_litro: numero(payload.precioLitro, { min: 0, max: 100, etiqueta: "El precio por litro" }),
        tipo_combustible: tipoCombustible || null,
        estacion_servicio: texto(payload.estacionServicio, { max: 80, etiqueta: "La estación de servicio" }) || null,
        estacion_id: uuid(payload.estacionId, "La estación"),
        creado_por: sesion.nick,
      })
      .select("id")
      .single();
    if (error) throw error;
    return res.status(200).json({ ok: true, id: data.id });
  }

  if (action === "listarRepostajes") {
    const desde = fecha(payload.desde, "La fecha «desde»");
    const hasta = fecha(payload.hasta, "La fecha «hasta»");
    let q = supabase.from("repostajes").select("*, vehiculos(numero_obra), estaciones_servicio(nombre)").order("fecha", { ascending: false }).order("created_at", { ascending: false }).limit(500);
    if (desde) q = q.gte("fecha", desde);
    if (hasta) q = q.lte("fecha", hasta);
    const { data, error } = await q;
    if (error) throw error;
    return res.status(200).json({ repostajes: data });
  }

  if (action === "eliminarRepostaje") {
    const id = uuid(payload.id);
    if (!id) throw new ErrorHttp(400, "Falta el identificador");
    await comprobarPropiedad(supabase, "repostajes", id, sesion, "Solo puedes eliminar tus propios repostajes");
    const { error } = await supabase.from("repostajes").delete().eq("id", id);
    if (error) throw error;
    await auditar(supabase, sesion, "eliminar", "repostaje", id);
    return res.status(200).json({ ok: true });
  }

  // ── ÚLTIMO KM CONOCIDO (autorrelleno) ──────────────────
  // Para no tener que volver a teclear kilometrajes: al elegir un vehículo,
  // se busca el km final de su último viaje (para precargar "Km inicial"
  // del viaje de hoy) y el km de su último repostaje (para mostrarlo como
  // referencia y calcular los km recorridos desde entonces).
  //
  // El km del último repostaje se filtra ADEMÁS por tipo de combustible
  // cuando se indica: un mismo vehículo puede repostar Diesel y AdBlue en
  // kilometrajes muy distintos (el AdBlue se añade mucho menos a menudo),
  // así que mezclarlos daría una referencia sin sentido.
  if (action === "ultimoKmVehiculo") {
    const vehiculoId = uuid(payload.vehiculoId, "El vehículo");
    if (!vehiculoId) throw new ErrorHttp(400, "Falta el vehículo");
    const tipoValido = TIPOS_COMBUSTIBLE.includes(payload.tipoCombustible) ? payload.tipoCombustible : null;

    const [{ data: ultimoViaje, error: errV }, { data: ultimoRepostaje, error: errR }] = await Promise.all([
      supabase
        .from("vehiculo_viajes")
        .select("km_final")
        .eq("vehiculo_id", vehiculoId)
        .not("km_final", "is", null)
        .order("fecha", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      (() => {
        let q = supabase.from("repostajes").select("km").eq("vehiculo_id", vehiculoId).not("km", "is", null);
        if (tipoValido) q = q.eq("tipo_combustible", tipoValido);
        return q.order("fecha", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle();
      })(),
    ]);
    if (errV) throw errV;
    if (errR) throw errR;

    return res.status(200).json({
      ultimoKmViaje: ultimoViaje ? ultimoViaje.km_final : null,
      ultimoKmRepostaje: ultimoRepostaje ? ultimoRepostaje.km : null,
    });
  }

  throw new ErrorHttp(400, "Acción no reconocida");
});
