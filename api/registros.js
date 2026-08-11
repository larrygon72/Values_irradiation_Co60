// /api/registros — guardar, consultar y eliminar los registros del formulario
//
// action:"guardar"  -> inserta un registro nuevo (requiere sesión válida)
// action:"listar"   -> devuelve registros, opcionalmente filtrados por
//                      fecha de irradiación (payload.desde / payload.hasta,
//                      formato YYYY-MM-DD)
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

import { getSupabaseAdmin } from "./_lib/supabaseAdmin.js";
import { verificarToken } from "./_lib/auth.js";

function filaDesdeRegistro(r) {
  return {
    fecha_irradiacion: r.fchIrr || null,
    semana_iso: r.semana ? parseInt(r.semana, 10) : null,
    tasa: r.tasa ? parseFloat(r.tasa) : null,
    tiempo_exposicion: r.texp ? parseFloat(r.texp) : null,
    n_urnas: r.nUrnas ? parseInt(r.nUrnas, 10) : null,
    urna1: r.u1 || null,
    urna2: r.u2 || null,
    urna3: r.u3 || null,
    conductor_nick: r.respNick || null,
    conductor_nombre: r.resp || null,
    conductor_codigo: r.respCodigo || null,
    h_ida_inicio: r.hII || null,
    h_ida_llegada: r.hIL || null,
    h_vuelta_inicio: r.hVI || null,
    h_vuelta_llegada: r.hVL || null,
    temp_inicial: r.ti !== "" && r.ti != null ? parseFloat(r.ti) : null,
    temp_final: r.tf !== "" && r.tf != null ? parseFloat(r.tf) : null,
    temp_media: r.tm !== "" && r.tm != null ? parseFloat(r.tm) : null,
    irradiador: r.irr || null,
    dosimetros: r.dos ? parseInt(r.dos, 10) : null,
    h_inicio_irr: r.hIni || null,
    h_fin_irr: r.hFin || null,
    observaciones: r.obs || null,
  };
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
    // ── GUARDAR ───────────────────────────────────────────
    if (action === "guardar") {
      const fila = { ...filaDesdeRegistro(payload || {}), creado_por: sesion.nick };
      const { data, error } = await supabase
        .from("registros")
        .insert(fila)
        .select("id, created_at")
        .single();
      if (error) throw error;
      return res.status(200).json({ ok: true, id: data.id, created_at: data.created_at });
    }

    // ── LISTAR ────────────────────────────────────────────
    if (action === "listar") {
      const { desde, hasta } = payload || {};
      let q = supabase
        .from("registros")
        .select("*")
        .order("fecha_irradiacion", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1000);
      if (desde) q = q.gte("fecha_irradiacion", desde);
      if (hasta) q = q.lte("fecha_irradiacion", hasta);
      const { data, error } = await q;
      if (error) throw error;
      return res.status(200).json({ registros: data });
    }

    // ── ELIMINAR ──────────────────────────────────────────
    if (action === "eliminar") {
      const { id } = payload || {};
      if (!id) return res.status(400).json({ error: "Falta el identificador del registro" });

      if (sesion.role !== "admin") {
        // un usuario normal solo puede borrar sus propios registros
        const { data: existente, error: errSel } = await supabase
          .from("registros")
          .select("id, creado_por")
          .eq("id", id)
          .maybeSingle();
        if (errSel) throw errSel;
        if (!existente) return res.status(404).json({ error: "Registro no encontrado" });
        if (existente.creado_por !== sesion.nick) {
          return res.status(403).json({ error: "Solo puedes eliminar tus propios registros" });
        }
      }
      const { error } = await supabase.from("registros").delete().eq("id", id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    // ── ACTUALIZAR (editar un registro existente) ─────────
    if (action === "actualizar") {
      const { id, registro } = payload || {};
      if (!id) return res.status(400).json({ error: "Falta el identificador del registro" });

      if (sesion.role !== "admin") {
        const { data: existente, error: errSel } = await supabase
          .from("registros")
          .select("id, creado_por")
          .eq("id", id)
          .maybeSingle();
        if (errSel) throw errSel;
        if (!existente) return res.status(404).json({ error: "Registro no encontrado" });
        if (existente.creado_por !== sesion.nick) {
          return res.status(403).json({ error: "Solo puedes editar tus propios registros" });
        }
      }
      const fila = filaDesdeRegistro(registro || {});
      const { error } = await supabase.from("registros").update(fila).eq("id", id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    // ── NUEVOS (para notificaciones) ───────────────────────
    if (action === "nuevos") {
      const { desde } = payload || {};
      if (!desde) return res.status(400).json({ error: "Falta la marca de tiempo 'desde'" });
      const { data, error } = await supabase
        .from("registros")
        .select("id, created_at, creado_por, conductor_nombre, fecha_irradiacion, semana_iso")
        .gt("created_at", desde)
        .order("created_at", { ascending: true })
        .limit(50);
      if (error) throw error;
      return res.status(200).json({ registros: data });
    }

    return res.status(400).json({ error: "Acción no reconocida" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Error inesperado" });
  }
}
