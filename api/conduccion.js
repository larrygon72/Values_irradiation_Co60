// /api/conduccion — viajes del vehículo y repostajes de combustible
//
// action:"guardarViaje"      -> inserta un viaje (matrícula, km inicial/final)
// action:"listarViajes"      -> lista viajes, opcionalmente por fecha
// action:"eliminarViaje"     -> borra un viaje (propio, o cualquiera si admin)
// action:"guardarRepostaje"  -> inserta un repostaje
// action:"listarRepostajes"  -> lista repostajes, opcionalmente por fecha
// action:"eliminarRepostaje" -> borra un repostaje (propio, o cualquiera si admin)

import { getSupabaseAdmin } from "./_lib/supabaseAdmin.js";
import { verificarToken } from "./_lib/auth.js";

const TIPOS_COMBUSTIBLE = ["diesel_xtl", "diesel", "gasolina", "adblue"];

async function puedeModificar(supabase, tabla, id, sesion) {
  if (sesion.role === "admin") return true;
  const { data } = await supabase.from(tabla).select("creado_por").eq("id", id).maybeSingle();
  return !!data && data.creado_por === sesion.nick;
}

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
    // ── VIAJES ────────────────────────────────────────────
    if (action === "guardarViaje") {
      const { matricula, fecha, kmInicial, kmFinal } = payload || {};
      if (!matricula) return res.status(400).json({ error: "Falta la matrícula" });
      const { data, error } = await supabase
        .from("vehiculo_viajes")
        .insert({
          matricula: matricula.trim().toUpperCase(),
          fecha: fecha || null,
          km_inicial: kmInicial !== "" && kmInicial != null ? parseFloat(kmInicial) : null,
          km_final: kmFinal !== "" && kmFinal != null ? parseFloat(kmFinal) : null,
          creado_por: sesion.nick,
        })
        .select("id")
        .single();
      if (error) throw error;
      return res.status(200).json({ ok: true, id: data.id });
    }

    if (action === "listarViajes") {
      const { desde, hasta } = payload || {};
      let q = supabase.from("vehiculo_viajes").select("*").order("fecha", { ascending: false }).order("created_at", { ascending: false }).limit(500);
      if (desde) q = q.gte("fecha", desde);
      if (hasta) q = q.lte("fecha", hasta);
      const { data, error } = await q;
      if (error) throw error;
      return res.status(200).json({ viajes: data });
    }

    if (action === "eliminarViaje") {
      const { id } = payload || {};
      if (!id) return res.status(400).json({ error: "Falta el identificador" });
      if (!(await puedeModificar(supabase, "vehiculo_viajes", id, sesion))) {
        return res.status(403).json({ error: "Solo puedes eliminar tus propios viajes" });
      }
      const { error } = await supabase.from("vehiculo_viajes").delete().eq("id", id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    // ── REPOSTAJES ────────────────────────────────────────
    if (action === "guardarRepostaje") {
      const { matricula, fecha, km, importe, precioLitro, tipoCombustible, estacionServicio } = payload || {};
      if (!matricula) return res.status(400).json({ error: "Falta la matrícula" });
      if (tipoCombustible && !TIPOS_COMBUSTIBLE.includes(tipoCombustible)) {
        return res.status(400).json({ error: "Tipo de combustible no válido" });
      }
      const { data, error } = await supabase
        .from("repostajes")
        .insert({
          matricula: matricula.trim().toUpperCase(),
          fecha: fecha || null,
          km: km !== "" && km != null ? parseFloat(km) : null,
          importe: importe !== "" && importe != null ? parseFloat(importe) : null,
          precio_litro: precioLitro !== "" && precioLitro != null ? parseFloat(precioLitro) : null,
          tipo_combustible: tipoCombustible || null,
          estacion_servicio: estacionServicio || null,
          creado_por: sesion.nick,
        })
        .select("id")
        .single();
      if (error) throw error;
      return res.status(200).json({ ok: true, id: data.id });
    }

    if (action === "listarRepostajes") {
      const { desde, hasta } = payload || {};
      let q = supabase.from("repostajes").select("*").order("fecha", { ascending: false }).order("created_at", { ascending: false }).limit(500);
      if (desde) q = q.gte("fecha", desde);
      if (hasta) q = q.lte("fecha", hasta);
      const { data, error } = await q;
      if (error) throw error;
      return res.status(200).json({ repostajes: data });
    }

    if (action === "eliminarRepostaje") {
      const { id } = payload || {};
      if (!id) return res.status(400).json({ error: "Falta el identificador" });
      if (!(await puedeModificar(supabase, "repostajes", id, sesion))) {
        return res.status(403).json({ error: "Solo puedes eliminar tus propios repostajes" });
      }
      const { error } = await supabase.from("repostajes").delete().eq("id", id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "Acción no reconocida" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Error inesperado" });
  }
}
