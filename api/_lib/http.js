// Envoltorio común de todas las funciones de /api: método, sesión, errores.
// Cada endpoint solo escribe su lógica; aquí se resuelve lo repetitivo y,
// sobre todo, lo delicado (autenticación y no filtrar errores internos).

import { randomBytes } from "node:crypto";
import { getSupabaseAdmin } from "./supabaseAdmin.js";
import { autenticar } from "./auth.js";
import { ErrorValidacion } from "./validate.js";

export class ErrorHttp extends Error {
  constructor(status, mensaje, code) {
    super(mensaje);
    this.name = "ErrorHttp";
    this.status = status;
    this.code = code;
  }
}

// Traduce errores de Postgres/PostgREST a respuestas comprensibles SIN
// enseñar al navegador los detalles internos (tablas, columnas, SQL…).
function traducirError(err) {
  if (err instanceof ErrorHttp || err instanceof ErrorValidacion) {
    return { status: err.status, error: err.message, code: err.code };
  }
  const code = String(err?.code || "");
  if (code === "23505") return { status: 409, error: "Ya existe un elemento igual." };
  if (code === "23503") return { status: 409, error: "No se puede completar la operación: hay datos relacionados." };
  if (["22P02", "22007", "22008", "22003", "22001", "23502", "23514"].includes(code)) {
    return { status: 400, error: "Alguno de los datos enviados no es válido." };
  }
  const ref = randomBytes(3).toString("hex");
  console.error(`[ref ${ref}]`, err);
  return { status: 500, error: `Error interno del servidor. Inténtalo de nuevo (ref. ${ref}).` };
}

export function enviarError(res, err) {
  const { status, error, code } = traducirError(err);
  return res.status(status).json(code ? { error, code } : { error });
}

function leerCuerpo(body) {
  if (body && typeof body === "object") return body;
  if (typeof body === "string") {
    try { return JSON.parse(body) || {}; } catch { return {}; }
  }
  return {};
}

// opciones:
//   publico: true                -> no exige sesión (solo /api/auth)
//   permitirCambioPendiente: true -> deja pasar aunque haya que cambiar la contraseña
export function apiHandler(logica, { publico = false, permitirCambioPendiente = false } = {}) {
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Método no permitido" });
    }
    const { action, token, payload } = leerCuerpo(req.body);

    let supabase;
    try {
      supabase = getSupabaseAdmin();
    } catch (err) {
      // Error de configuración del despliegue: el mensaje ayuda a quien administra (no contiene secretos).
      console.error(err);
      return res.status(500).json({ error: err.message });
    }

    try {
      let sesion = null;
      if (!publico) {
        const r = await autenticar(supabase, token);
        if (!r.ok) return res.status(r.status).json({ error: r.error, code: r.code });
        sesion = r.sesion;
        if (sesion.mustChange && !permitirCambioPendiente) {
          return res.status(403).json({
            error: "Debes cambiar tu contraseña antes de continuar.",
            code: "DEBE_CAMBIAR_PASS",
          });
        }
      }
      return await logica({ req, res, action, payload: payload && typeof payload === "object" ? payload : {}, body: leerCuerpo(req.body), sesion, supabase });
    } catch (err) {
      return enviarError(res, err);
    }
  };
}

export function exigirAdmin(sesion, mensaje = "No tienes permiso para realizar esta acción.") {
  if (sesion?.role !== "admin") throw new ErrorHttp(403, mensaje);
}
