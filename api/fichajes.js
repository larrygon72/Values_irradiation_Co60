// /api/fichajes — control horario (fichar entrada/salida cada día)
//
// La hora de entrada y de salida se toman SIEMPRE del reloj del SERVIDOR
// (no del dispositivo del usuario), para que sean fiables. El servidor de
// Vercel corre en UTC, así que se formatean explícitamente en la zona
// horaria de España (Europe/Madrid) — si el complejo/equipo trabajase en
// otra zona horaria, cambia MADRID_TZ más abajo.
//
// La hora de entrada no se usa (todavía) para ningún cálculo, aunque el
// usuario entre antes de su horario. La hora de salida sí: al fichar la
// salida se guarda una FOTOGRAFÍA del horario de salida del usuario en
// ese momento ("horario_salida_esperado"), y aquí mismo (no en la base de
// datos: Postgres no permite castear texto a "time" dentro de una columna
// generada) se calculan las horas de más — PUEDEN SER NEGATIVAS si el
// usuario sale antes de su horario, y eso resta del acumulado. Así, si un
// admin cambia el horario de alguien más adelante, no se altera lo ya
// fichado.
//
// action:"hoy"           -> fichaje de HOY del usuario de la sesión (o null)
//                           + su horario de entrada/salida actual.
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

function horaAhoraMadrid() {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: MADRID_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}
// YYYY-MM-DD en la zona horaria de Madrid (no en UTC — importante cerca de
// medianoche, donde la fecha en UTC ya podría ser la del día siguiente).
function fechaHoyMadrid() {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: MADRID_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t) => partes.find((p) => p.type === t).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
// Diferencia en horas entre "horaSalida" y "horarioEsperado" (ambos
// "HH:MM"). Puede ser negativa (el usuario salió antes de su horario).
function calcularHorasDeMas(horaSalida, horarioEsperado) {
  if (!horaSalida || !horarioEsperado) return null;
  const [h1, m1] = horaSalida.split(":").map(Number);
  const [h2, m2] = horarioEsperado.split(":").map(Number);
  if ([h1, m1, h2, m2].some((n) => Number.isNaN(n))) return null;
  return ((h1 * 60 + m1) - (h2 * 60 + m2)) / 60;
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
        supabase.from("usuarios").select("horario_entrada, horario_salida").ilike("nick", sesion.nick).maybeSingle(),
      ]);
      if (errF) throw errF;
      if (errU) throw errU;
      return res.status(200).json({
        fichaje: fichaje || null,
        horarioEntrada: usuario?.horario_entrada || "07:00",
        horarioSalida: usuario?.horario_salida || "13:57",
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
        .from("usuarios").select("horario_salida").ilike("nick", sesion.nick).maybeSingle();
      if (errU) throw errU;
      const horaActual = horaAhoraMadrid();
      const horarioSalida = usuario?.horario_salida || "13:57";
      const { data: fichaje, error } = await supabase.from("fichajes")
        .update({
          hora_salida: horaActual,
          horario_salida_esperado: horarioSalida,
          horas_de_mas: calcularHorasDeMas(horaActual, horarioSalida),
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

      const cambios = { updated_at: new Date().toISOString() };
      if (horaEntrada !== undefined) cambios.hora_entrada = horaEntrada || null;
      if (horaSalida !== undefined) {
        cambios.hora_salida = horaSalida || null;
        if (horaSalida) {
          const { data: usuario } = await supabase
            .from("usuarios").select("horario_salida").ilike("nick", nickDestino).maybeSingle();
          const horarioSalida = usuario?.horario_salida || "13:57";
          cambios.horario_salida_esperado = horarioSalida;
          cambios.horas_de_mas = calcularHorasDeMas(horaSalida, horarioSalida);
        } else {
          cambios.horario_salida_esperado = null;
          cambios.horas_de_mas = null;
        }
      }

      const { data: existente, error: errE } = await supabase
        .from("fichajes").select("id").ilike("usuario_nick", nickDestino).eq("fecha", fecha).maybeSingle();
      if (errE) throw errE;

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
