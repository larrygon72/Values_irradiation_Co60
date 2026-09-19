// /api/fichajes — control horario (fichar entrada/salida cada día)
//
// La hora de entrada y de salida se toman SIEMPRE del reloj del SERVIDOR
// (no del dispositivo del usuario), para que sean fiables. El servidor de
// Vercel corre en UTC, así que se formatean explícitamente en la zona
// horaria de España (Europe/Madrid) — si el complejo/equipo trabajase en
// otra zona horaria, cambia MADRID_TZ más abajo.
//
// La hora de entrada y de salida se toman SIEMPRE del reloj del SERVIDOR
// (no del dispositivo del usuario), para que sean fiables. El servidor de
// Vercel corre en UTC, así que se formatean explícitamente en la zona
// horaria de España (Europe/Madrid) — si el complejo/equipo trabajase en
// otra zona horaria, cambia MADRID_TZ más abajo.
//
// Cada usuario tiene un TIPO DE HORARIO ("usuarios.tipo_horario"):
//  · "fijo"     -> solo importa la hora de SALIDA. Se compara contra el
//                  horario de salida esperado, con 15 minutos de cortesía:
//                  si la diferencia real (antes o después) es de 15 min o
//                  menos, no cuenta nada; si se supera, cuenta la
//                  diferencia COMPLETA desde la hora esperada, no solo el
//                  exceso sobre la cortesía.
//  · "flexible" -> importa la JORNADA trabajada (salida real - entrada
//                  real) frente a la jornada esperada (horario de salida
//                  - horario de entrada). Da igual a qué hora exacta se
//                  entre o se salga, mientras se cumplan las horas.
//
// Al fichar la salida (o corregir un fichaje) se guarda una FOTOGRAFÍA del
// horario y del tipo del usuario en ESE momento (no su horario/tipo
// actual), para que si un admin lo cambia más adelante no se reescriba el
// histórico ya fichado. Las horas de más PUEDEN SER NEGATIVAS (se ha
// trabajado de menos) y eso resta del acumulado.
//
// action:"hoy"           -> fichaje de HOY del usuario de la sesión (o null)
//                           + su horario/tipo de jornada actual.
// action:"ficharEntrada" -> registra la hora de entrada de hoy.
// action:"ficharSalida"  -> registra la hora de salida de hoy y calcula
//                           las horas de más.
// action:"resumenMes"    -> fichajes del usuario de la sesión en el mes en
//                           curso + total de horas de más acumuladas.
// action:"listar"        -> lista de fichajes por rango de fechas (para
//                           Informes). Un usuario normal solo ve los
//                           suyos; un admin puede ver los de cualquiera.
// action:"corregir"      -> corrige (o crea, si no existía) el fichaje de
//                           una fecha concreta — entrada y/o salida. No
//                           siempre se puede fichar justo al entrar o
//                           salir, así que cualquiera puede corregir los
//                           SUYOS; un admin puede corregir los de otro
//                           indicando "usuarioNick".
// action:"eliminar"      -> borra un fichaje. Solo admin.

import { getSupabaseAdmin } from "./_lib/supabaseAdmin.js";
import { verificarToken } from "./_lib/auth.js";

const MADRID_TZ = "Europe/Madrid";
const HORA_VALIDA = /^([01]\d|2[0-3]):[0-5]\d$/; // "HH:MM"
export const GRACIA_SALIDA_MIN = 15; // minutos de cortesía alrededor del horario de salida, solo para horario "fijo"

export function horaAhoraMadrid() {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: MADRID_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}
// YYYY-MM-DD en la zona horaria de Madrid (no en UTC — importante cerca de
// medianoche, donde la fecha en UTC ya podría ser la del día siguiente).
export function fechaHoyMadrid() {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: MADRID_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t) => partes.find((p) => p.type === t).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function aMinutos(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}
// Calcula las horas de más según el tipo de horario del usuario. Puede
// devolver null si faltan datos para calcular (p. ej. horario flexible sin
// hora de entrada todavía).
export function calcularHorasDeMas(tipoHorario, horaEntradaReal, horaSalidaReal, horarioEntradaEsperado, horarioSalidaEsperado) {
  if (tipoHorario === "flexible") {
    const eReal = aMinutos(horaEntradaReal);
    const sReal = aMinutos(horaSalidaReal);
    const eEsp = aMinutos(horarioEntradaEsperado);
    const sEsp = aMinutos(horarioSalidaEsperado);
    if (eReal == null || sReal == null || eEsp == null || sEsp == null) return null;
    const trabajadoMin = sReal - eReal;
    const jornadaMin = sEsp - eEsp;
    return (trabajadoMin - jornadaMin) / 60;
  }
  // "fijo" (por defecto)
  const sReal = aMinutos(horaSalidaReal);
  const sEsp = aMinutos(horarioSalidaEsperado);
  if (sReal == null || sEsp == null) return null;
  const diffMin = sReal - sEsp;
  if (Math.abs(diffMin) <= GRACIA_SALIDA_MIN) return 0;
  return diffMin / 60;
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
    // ── HOY ───────────────────────────────────────────────
    if (action === "hoy") {
      const hoy = fechaHoyMadrid();
      const [{ data: fichaje, error: errF }, { data: usuario, error: errU }] = await Promise.all([
        supabase.from("fichajes").select("*").ilike("usuario_nick", sesion.nick).eq("fecha", hoy).maybeSingle(),
        supabase.from("usuarios").select("horario_entrada, horario_salida, tipo_horario").ilike("nick", sesion.nick).maybeSingle(),
      ]);
      if (errF) throw errF;
      if (errU) throw errU;
      return res.status(200).json({
        fichaje: fichaje || null,
        horarioEntrada: usuario?.horario_entrada || "07:00",
        horarioSalida: usuario?.horario_salida || "13:57",
        tipoHorario: usuario?.tipo_horario || "fijo",
      });
    }

    // ── FICHAR ENTRADA ────────────────────────────────────
    if (action === "ficharEntrada") {
      const hoy = fechaHoyMadrid();
      const { data: existente, error: errE } = await supabase
        .from("fichajes").select("id, hora_entrada").ilike("usuario_nick", sesion.nick).eq("fecha", hoy).maybeSingle();
      if (errE) throw errE;
      if (existente?.hora_entrada) {
        return res.status(400).json({ error: "Ya has fichado la entrada hoy" });
      }
      const horaActual = horaAhoraMadrid();
      let fichaje;
      if (existente) {
        const { data, error } = await supabase.from("fichajes")
          .update({ hora_entrada: horaActual, updated_at: new Date().toISOString() })
          .eq("id", existente.id).select("*").single();
        if (error) throw error;
        fichaje = data;
      } else {
        const { data, error } = await supabase.from("fichajes")
          .insert({ usuario_nick: sesion.nick, fecha: hoy, hora_entrada: horaActual })
          .select("*").single();
        if (error) throw error;
        fichaje = data;
      }
      return res.status(200).json({ ok: true, fichaje });
    }

    // ── FICHAR SALIDA ─────────────────────────────────────
    if (action === "ficharSalida") {
      const hoy = fechaHoyMadrid();
      const { data: existente, error: errE } = await supabase
        .from("fichajes").select("id, hora_entrada, hora_salida").ilike("usuario_nick", sesion.nick).eq("fecha", hoy).maybeSingle();
      if (errE) throw errE;
      if (!existente?.hora_entrada) {
        return res.status(400).json({ error: "Todavía no has fichado la entrada hoy" });
      }
      if (existente.hora_salida) {
        return res.status(400).json({ error: "Ya has fichado la salida hoy" });
      }
      const { data: usuario, error: errU } = await supabase
        .from("usuarios").select("horario_entrada, horario_salida, tipo_horario").ilike("nick", sesion.nick).maybeSingle();
      if (errU) throw errU;
      const horaActual = horaAhoraMadrid();
      const horarioEntrada = usuario?.horario_entrada || "07:00";
      const horarioSalida = usuario?.horario_salida || "13:57";
      const tipoHorario = usuario?.tipo_horario || "fijo";
      const { data: fichaje, error } = await supabase.from("fichajes")
        .update({
          hora_salida: horaActual,
          horario_entrada_esperado: horarioEntrada,
          horario_salida_esperado: horarioSalida,
          tipo_horario_aplicado: tipoHorario,
          horas_de_mas: calcularHorasDeMas(tipoHorario, existente.hora_entrada, horaActual, horarioEntrada, horarioSalida),
          updated_at: new Date().toISOString(),
        })
        .eq("id", existente.id).select("*").single();
      if (error) throw error;
      return res.status(200).json({ ok: true, fichaje });
    }

    // ── RESUMEN DEL MES EN CURSO ──────────────────────────
    if (action === "resumenMes") {
      const hoy = fechaHoyMadrid();
      const inicioMes = hoy.slice(0, 8) + "01";
      const { data, error } = await supabase
        .from("fichajes")
        .select("*")
        .ilike("usuario_nick", sesion.nick)
        .gte("fecha", inicioMes)
        .lte("fecha", hoy)
        .order("fecha", { ascending: false });
      if (error) throw error;
      const totalHorasDeMas = (data || []).reduce((acc, f) => acc + (parseFloat(f.horas_de_mas) || 0), 0);
      return res.status(200).json({ fichajes: data || [], totalHorasDeMas });
    }

    // ── LISTAR (para Informes) ────────────────────────────
    if (action === "listar") {
      const { desde, hasta, usuarioNick } = payload || {};
      let q = supabase.from("fichajes").select("*").order("fecha", { ascending: false }).limit(1000);
      if (sesion.role === "admin") {
        if (usuarioNick) q = q.ilike("usuario_nick", usuarioNick);
      } else {
        // Un usuario normal solo puede ver sus propios fichajes, aunque
        // pida otro nick — el filtro real lo decide siempre el servidor.
        q = q.ilike("usuario_nick", sesion.nick);
      }
      if (desde) q = q.gte("fecha", desde);
      if (hasta) q = q.lte("fecha", hasta);
      const { data, error } = await q;
      if (error) throw error;
      return res.status(200).json({ fichajes: data });
    }

    // ── CORREGIR (por fecha) ───────────────────────────────
    // No siempre se puede fichar justo al entrar o al salir, así que
    // cualquier usuario puede corregir SUS PROPIOS fichajes (entrada y/o
    // salida) eligiendo el día — incluye días sin fichaje todavía, que
    // se crean directamente. Un admin puede corregir los de cualquiera
    // indicando "usuarioNick".
    if (action === "corregir") {
      const { fecha, horaEntrada, horaSalida, usuarioNick } = payload || {};
      if (!fecha) return res.status(400).json({ error: "Falta la fecha" });
      if ((horaEntrada && !HORA_VALIDA.test(horaEntrada)) || (horaSalida && !HORA_VALIDA.test(horaSalida))) {
        return res.status(400).json({ error: "La hora debe tener formato HH:MM" });
      }
      const nickDestino = sesion.role === "admin" && usuarioNick ? usuarioNick : sesion.nick;

      const { data: existente, error: errE } = await supabase
        .from("fichajes").select("id, hora_entrada").ilike("usuario_nick", nickDestino).eq("fecha", fecha).maybeSingle();
      if (errE) throw errE;

      const cambios = { updated_at: new Date().toISOString() };
      if (horaEntrada !== undefined) cambios.hora_entrada = horaEntrada || null;
      if (horaSalida !== undefined) {
        cambios.hora_salida = horaSalida || null;
        if (horaSalida) {
          const { data: usuario } = await supabase
            .from("usuarios").select("horario_entrada, horario_salida, tipo_horario").ilike("nick", nickDestino).maybeSingle();
          const horarioEntrada = usuario?.horario_entrada || "07:00";
          const horarioSalida = usuario?.horario_salida || "13:57";
          const tipoHorario = usuario?.tipo_horario || "fijo";
          // La hora de entrada para el cálculo: la que se esté guardando
          // ahora mismo en esta misma corrección si se ha tocado, o si no
          // la que ya hubiera en el fichaje de ese día.
          const horaEntradaCalculo = horaEntrada !== undefined ? (horaEntrada || null) : (existente?.hora_entrada || null);
          cambios.horario_entrada_esperado = horarioEntrada;
          cambios.horario_salida_esperado = horarioSalida;
          cambios.tipo_horario_aplicado = tipoHorario;
          cambios.horas_de_mas = calcularHorasDeMas(tipoHorario, horaEntradaCalculo, horaSalida, horarioEntrada, horarioSalida);
        } else {
          cambios.horario_entrada_esperado = null;
          cambios.horario_salida_esperado = null;
          cambios.tipo_horario_aplicado = null;
          cambios.horas_de_mas = null;
        }
      }

      let fichaje;
      if (existente) {
        const { data, error } = await supabase.from("fichajes").update(cambios).eq("id", existente.id).select("*").single();
        if (error) throw error;
        fichaje = data;
      } else {
        const { data, error } = await supabase.from("fichajes")
          .insert({ usuario_nick: nickDestino, fecha, ...cambios })
          .select("*").single();
        if (error) throw error;
        fichaje = data;
      }
      return res.status(200).json({ ok: true, fichaje });
    }

    // A partir de aquí, todas las acciones son solo para administradores.
    if (sesion.role !== "admin") {
      return res.status(403).json({ error: "No tienes permiso para gestionar fichajes." });
    }

    // ── ELIMINAR ──────────────────────────────────────────
    if (action === "eliminar") {
      const { id } = payload || {};
      if (!id) return res.status(400).json({ error: "Falta el identificador" });
      const { error } = await supabase.from("fichajes").delete().eq("id", id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "Acción no reconocida" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Error inesperado" });
  }
}
