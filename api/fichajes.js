// /api/fichajes — control horario (fichar entrada/salida cada día)
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

import { apiHandler, ErrorHttp, exigirAdmin } from "./_lib/http.js";
import { igualCI, leerTodo, esViolacionUnica } from "./_lib/db.js";
import { esFecha, esHora, uuid } from "./_lib/validate.js";
import { auditar } from "./_lib/audit.js";

const MADRID_TZ = "Europe/Madrid";
export const GRACIA_SALIDA_MIN = 15; // minutos de cortesía alrededor del horario de salida, solo para horario "fijo"

export function horaAhoraMadrid(ahora = new Date()) {
  const partes = new Intl.DateTimeFormat("en-GB", {
    timeZone: MADRID_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(ahora);
  const get = (t) => partes.find((p) => p.type === t).value;
  const h = get("hour") === "24" ? "00" : get("hour"); // algunas versiones de ICU devuelven "24" a medianoche
  return `${h}:${get("minute")}`;
}
// YYYY-MM-DD en la zona horaria de Madrid (no en UTC — importante cerca de
// medianoche, donde la fecha en UTC ya podría ser la del día siguiente).
export function fechaHoyMadrid(ahora = new Date()) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: MADRID_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(ahora);
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

// Horario y tipo de jornada de un usuario (con los valores por defecto de siempre).
async function horarioDe(supabase, nick) {
  const { data, error } = await igualCI(
    supabase.from("usuarios").select("nick, horario_entrada, horario_salida, tipo_horario"),
    "nick",
    nick
  ).maybeSingle();
  if (error) throw error;
  return {
    existe: !!data,
    nick: data?.nick || nick,
    horarioEntrada: data?.horario_entrada || "07:00",
    horarioSalida: data?.horario_salida || "13:57",
    tipoHorario: data?.tipo_horario || "fijo",
  };
}

async function fichajeDe(supabase, nick, fecha, columnas = "*") {
  const { data, error } = await igualCI(supabase.from("fichajes").select(columnas), "usuario_nick", nick).eq("fecha", fecha).maybeSingle();
  if (error) throw error;
  return data;
}

export default apiHandler(async ({ res, action, payload, sesion, supabase }) => {
  // ── HOY ───────────────────────────────────────────────
  if (action === "hoy") {
    const hoy = fechaHoyMadrid();
    const [fichaje, h] = await Promise.all([fichajeDe(supabase, sesion.nick, hoy), horarioDe(supabase, sesion.nick)]);
    return res.status(200).json({
      fichaje: fichaje || null,
      horarioEntrada: h.horarioEntrada,
      horarioSalida: h.horarioSalida,
      tipoHorario: h.tipoHorario,
    });
  }

  // ── FICHAR ENTRADA ────────────────────────────────────
  if (action === "ficharEntrada") {
    const hoy = fechaHoyMadrid();
    const existente = await fichajeDe(supabase, sesion.nick, hoy, "id, hora_entrada");
    if (existente?.hora_entrada) throw new ErrorHttp(400, "Ya has fichado la entrada hoy");
    const horaActual = horaAhoraMadrid();
    let fichaje;
    if (existente) {
      const { data, error } = await supabase
        .from("fichajes")
        .update({ hora_entrada: horaActual, updated_at: new Date().toISOString() })
        .eq("id", existente.id)
        .select("*")
        .single();
      if (error) throw error;
      fichaje = data;
    } else {
      const { data, error } = await supabase
        .from("fichajes")
        .insert({ usuario_nick: sesion.nick, fecha: hoy, hora_entrada: horaActual })
        .select("*")
        .single();
      // Doble toque / dos dispositivos a la vez: el índice único lo impide, y aquí se explica bien.
      if (esViolacionUnica(error)) throw new ErrorHttp(400, "Ya has fichado la entrada hoy");
      if (error) throw error;
      fichaje = data;
    }
    return res.status(200).json({ ok: true, fichaje });
  }

  // ── FICHAR SALIDA ─────────────────────────────────────
  if (action === "ficharSalida") {
    const hoy = fechaHoyMadrid();
    const existente = await fichajeDe(supabase, sesion.nick, hoy, "id, hora_entrada, hora_salida");
    if (!existente?.hora_entrada) throw new ErrorHttp(400, "Todavía no has fichado la entrada hoy");
    if (existente.hora_salida) throw new ErrorHttp(400, "Ya has fichado la salida hoy");
    const h = await horarioDe(supabase, sesion.nick);
    const horaActual = horaAhoraMadrid();
    const { data: fichaje, error } = await supabase
      .from("fichajes")
      .update({
        hora_salida: horaActual,
        horario_entrada_esperado: h.horarioEntrada,
        horario_salida_esperado: h.horarioSalida,
        tipo_horario_aplicado: h.tipoHorario,
        horas_de_mas: calcularHorasDeMas(h.tipoHorario, existente.hora_entrada, horaActual, h.horarioEntrada, h.horarioSalida),
        updated_at: new Date().toISOString(),
      })
      .eq("id", existente.id)
      .select("*")
      .single();
    if (error) throw error;
    return res.status(200).json({ ok: true, fichaje });
  }

  // ── RESUMEN DEL MES EN CURSO ──────────────────────────
  if (action === "resumenMes") {
    const hoy = fechaHoyMadrid();
    const inicioMes = hoy.slice(0, 8) + "01";
    const { data, error } = await igualCI(supabase.from("fichajes").select("*"), "usuario_nick", sesion.nick)
      .gte("fecha", inicioMes)
      .lte("fecha", hoy)
      .order("fecha", { ascending: false });
    if (error) throw error;
    const totalHorasDeMas = (data || []).reduce((acc, f) => acc + (parseFloat(f.horas_de_mas) || 0), 0);
    return res.status(200).json({ fichajes: data || [], totalHorasDeMas });
  }

  // ── LISTAR (para Informes) ────────────────────────────
  if (action === "listar") {
    const { desde, hasta, usuarioNick } = payload;
    if (desde && !esFecha(desde)) throw new ErrorHttp(400, "La fecha «desde» no es válida");
    if (hasta && !esFecha(hasta)) throw new ErrorHttp(400, "La fecha «hasta» no es válida");
    const { filas, truncado } = await leerTodo(() => {
      let q = supabase.from("fichajes").select("*").order("fecha", { ascending: false }).order("usuario_nick", { ascending: true });
      if (sesion.role === "admin") {
        if (usuarioNick) q = igualCI(q, "usuario_nick", String(usuarioNick));
      } else {
        // Un usuario normal solo puede ver sus propios fichajes, aunque
        // pida otro nick — el filtro real lo decide siempre el servidor.
        q = igualCI(q, "usuario_nick", sesion.nick);
      }
      if (desde) q = q.gte("fecha", desde);
      if (hasta) q = q.lte("fecha", hasta);
      return q;
    });
    return res.status(200).json({ fichajes: filas, truncado });
  }

  // ── CORREGIR (por fecha) ───────────────────────────────
  // No siempre se puede fichar justo al entrar o al salir, así que
  // cualquier usuario puede corregir SUS PROPIOS fichajes (entrada y/o
  // salida) eligiendo el día — incluye días sin fichaje todavía, que
  // se crean directamente. Un admin puede corregir los de cualquiera
  // indicando "usuarioNick".
  if (action === "corregir") {
    const { fecha, horaEntrada, horaSalida, usuarioNick } = payload;
    if (!fecha) throw new ErrorHttp(400, "Falta la fecha");
    if (!esFecha(fecha)) throw new ErrorHttp(400, "La fecha no es válida");
    if (fecha > fechaHoyMadrid()) throw new ErrorHttp(400, "No se puede fichar en una fecha futura");
    if ((horaEntrada && !esHora(horaEntrada)) || (horaSalida && !esHora(horaSalida))) {
      throw new ErrorHttp(400, "La hora debe tener formato HH:MM");
    }

    let nickDestino = sesion.nick;
    let h = null;
    if (sesion.role === "admin" && usuarioNick && String(usuarioNick).toLowerCase() !== sesion.nick.toLowerCase()) {
      h = await horarioDe(supabase, String(usuarioNick));
      if (!h.existe) throw new ErrorHttp(404, "Usuario no encontrado");
      nickDestino = h.nick; // nick tal como está guardado (mayúsculas incluidas)
    }

    const existente = await fichajeDe(supabase, nickDestino, fecha, "id, hora_entrada, hora_salida");
    const tocaEntrada = horaEntrada !== undefined;
    const tocaSalida = horaSalida !== undefined;
    const entradaFinal = tocaEntrada ? horaEntrada || null : existente?.hora_entrada || null;
    const salidaFinal = tocaSalida ? horaSalida || null : existente?.hora_salida || null;
    if (entradaFinal && salidaFinal && aMinutos(salidaFinal) <= aMinutos(entradaFinal)) {
      throw new ErrorHttp(400, "La hora de salida debe ser posterior a la de entrada");
    }

    const cambios = { updated_at: new Date().toISOString() };
    if (tocaEntrada) cambios.hora_entrada = entradaFinal;
    if (tocaSalida) cambios.hora_salida = salidaFinal;
    if (tocaEntrada || tocaSalida) {
      if (salidaFinal) {
        h = h || (await horarioDe(supabase, nickDestino));
        cambios.horario_entrada_esperado = h.horarioEntrada;
        cambios.horario_salida_esperado = h.horarioSalida;
        cambios.tipo_horario_aplicado = h.tipoHorario;
        cambios.horas_de_mas = calcularHorasDeMas(h.tipoHorario, entradaFinal, salidaFinal, h.horarioEntrada, h.horarioSalida);
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
      const { data, error } = await supabase
        .from("fichajes")
        .insert({ usuario_nick: nickDestino, fecha, ...cambios })
        .select("*")
        .single();
      if (error) throw error;
      fichaje = data;
    }
    await auditar(supabase, sesion, "corregir", "fichaje", fichaje.id, {
      usuario: nickDestino,
      fecha,
      antes: existente ? { entrada: existente.hora_entrada, salida: existente.hora_salida } : null,
      despues: { entrada: entradaFinal, salida: salidaFinal },
    });
    return res.status(200).json({ ok: true, fichaje });
  }

  // A partir de aquí, todas las acciones son solo para administradores.
  exigirAdmin(sesion, "No tienes permiso para gestionar fichajes.");

  // ── ELIMINAR ──────────────────────────────────────────
  if (action === "eliminar") {
    const id = uuid(payload.id);
    if (!id) throw new ErrorHttp(400, "Falta el identificador");
    const { error } = await supabase.from("fichajes").delete().eq("id", id);
    if (error) throw error;
    await auditar(supabase, sesion, "eliminar", "fichaje", id);
    return res.status(200).json({ ok: true });
  }

  throw new ErrorHttp(400, "Acción no reconocida");
});
