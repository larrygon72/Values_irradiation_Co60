// Firma y verifica el "token de sesión" que recibe el navegador al hacer
// login. No usamos Supabase Auth (esta app no funciona con email, sino con
// un "nick"), así que este token propio es lo que demuestra, en cada
// petición posterior, quién es la persona que la hace y qué rol tiene.

import jwt from "jsonwebtoken";

const DURACION = "12h";

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("Falta la variable de entorno AUTH_SECRET en Vercel.");
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
    },
    getSecret(),
    { expiresIn: DURACION }
  );
}

// Devuelve el contenido del token si es válido, o null si no lo es
// (caducado, manipulado, o inexistente).
export function verificarToken(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, getSecret());
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
