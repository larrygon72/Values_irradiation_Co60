// Firma y verifica el "token de sesión" que recibe el navegador al hacer
// login. No usamos Supabase Auth (esta app no funciona con email, sino con
// un "nick"), así que este token propio es lo que demuestra, en cada
// petición posterior, quién es la persona que la hace y qué rol tiene.
//
// Además de comprobar la firma, cada petición se contrasta con la base de
// datos (con una caché de 30 s) para que un usuario borrado, degradado de
// rol o con la contraseña cambiada pierda el acceso enseguida, en vez de
// seguir con su token durante las 12 h de vida del mismo.

import jwt from "jsonwebtoken";
import { escapeLike, esErrorEsquema } from "./db.js";

const DURACION = "12h";
const ALGORITMO = "HS256";
const CACHE_MS = 30_000;

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("Falta la variable de entorno AUTH_SECRET en Vercel.");
  }
  if (secret.length < 32 && !getSecret._avisado) {
    getSecret._avisado = true;
    console.warn("AUTH_SECRET es corto (<32 caracteres). Usa una frase larga y aleatoria: openssl rand -base64 48");
  }
  return secret;
}

export function firmarToken(usuario) {
  return jwt.sign(
    {
      nick: usuario.nick,
      role: usuario.role,
      nombre: usuario.nombre || "",
      apellido1: usuario.apellido1 || "",
      apellido2: usuario.apellido2 || "",
      codigo: usuario.codigo || "",
      tv: usuario.token_version || 0,
    },
    getSecret(),
    { expiresIn: DURACION, algorithm: ALGORITMO }
  );
}

// Devuelve el contenido del token si es válido, o null si no lo es
// (caducado, manipulado, o inexistente).
export function verificarToken(token) {
  if (!token || typeof token !== "string") return null;
  try {
    return jwt.verify(token, getSecret(), { algorithms: [ALGORITMO] });
  } catch {
    return null;
  }
}

// Código de 3 letras del conductor:
// 1ª letra del nombre + 1ª letra del 1er apellido + 1ª letra del 2º apellido
// (o "X" si no hay segundo apellido). Ej: Josep Navarro Navarro -> JNN
export function codigoConductor(nombre, apellido1, apellido2) {
  const l1 = (nombre || "").trim().charAt(0) || "?";
  const l2 = (apellido1 || "").trim().charAt(0) || "?";
  const l3 = (apellido2 || "").trim().charAt(0) || "X";
  return (l1 + l2 + l3).toUpperCase();
}

// ── Comprobación de la sesión contra la base de datos ─────────────────
const cache = new Map();
export function invalidarSesion(nick) {
  if (nick) cache.delete(String(nick).toLowerCase());
  else cache.clear();
}

async function cargarEstadoUsuario(supabase, nick) {
  const consulta = (columnas) =>
    supabase.from("usuarios").select(columnas).ilike("nick", escapeLike(nick)).maybeSingle();
  let { data, error } = await consulta("nick, role, locked, bloqueado_hasta, must_change_password, token_version");
  if (esErrorEsquema(error)) {
    // Esquema sin actualizar todavía: seguimos con lo básico en vez de romper el acceso.
    ({ data, error } = await consulta("nick, role, locked"));
  }
  if (error) throw error;
  return data || null;
}

// Decide, a partir del estado del usuario en la base de datos, si el token sirve.
function evaluar(u, t) {
  const caducada = { ok: false, status: 401, error: "Sesión no válida o caducada", code: "SESION_CADUCADA" };
  if (!u) return caducada;
  // Un bloqueo temporal por intentos fallidos (bloqueado_hasta) NO expulsa a quien ya
  // tiene sesión: si no, cualquiera podría echar a otros usuarios probando claves.
  if (u.locked && !u.bloqueado_hasta) {
    return { ok: false, status: 403, error: "Acceso bloqueado. Contacta con el administrador.", code: "BLOQUEADO" };
  }
  if ((u.token_version || 0) !== (t.tv || 0)) return caducada;
  return {
    ok: true,
    sesion: { ...t, nick: u.nick, role: u.role === "admin" ? "admin" : "user", mustChange: !!u.must_change_password },
  };
}

// Devuelve { ok:true, sesion } o { ok:false, status, error, code }.
//
// La caché (30 s) solo se usa para dar por buena una sesión. Antes de RECHAZAR una
// petición (o de exigir el cambio de contraseña) se confirma siempre en la base de
// datos: en Vercel puede haber varias instancias de la función y una podría tener
// guardado un estado antiguo justo después de que el usuario cambie su contraseña.
export async function autenticar(supabase, token) {
  const t = verificarToken(token);
  if (!t || !t.nick) return evaluar(null, {});

  const clave = String(t.nick).toLowerCase();
  const ahora = Date.now();
  let entrada = cache.get(clave);
  let reciente = false;
  if (!entrada || entrada.hasta < ahora) {
    entrada = { u: await cargarEstadoUsuario(supabase, t.nick), hasta: ahora + CACHE_MS };
    cache.set(clave, entrada);
    reciente = true;
  }
  let veredicto = evaluar(entrada.u, t);
  if (!reciente && (!veredicto.ok || veredicto.sesion.mustChange)) {
    entrada = { u: await cargarEstadoUsuario(supabase, t.nick), hasta: ahora + CACHE_MS };
    cache.set(clave, entrada);
    veredicto = evaluar(entrada.u, t);
  }
  return veredicto;
}
