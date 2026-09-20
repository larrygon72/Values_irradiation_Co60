// Validación y limpieza de los datos que llegan del navegador. Nada de lo que
// envía el cliente se da por bueno: aquí se comprueba tipo, formato y rango.

export class ErrorValidacion extends Error {
  constructor(mensaje) { super(mensaje); this.name = "ErrorValidacion"; this.status = 400; }
}

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

// Texto libre: recorta, quita caracteres de control y limita la longitud.
export function texto(valor, { max = 200, obligatorio = false, etiqueta = "El campo", multilinea = false } = {}) {
  if (valor === undefined || valor === null) valor = "";
  if (typeof valor !== "string") {
    if (typeof valor === "number" && Number.isFinite(valor)) valor = String(valor);
    else throw new ErrorValidacion(`${etiqueta} no es válido`);
  }
  let t = valor.replace(CONTROL, "");
  if (!multilinea) t = t.replace(/[\r\n\t]+/g, " ");
  t = t.trim();
  if (obligatorio && !t) throw new ErrorValidacion(`Falta ${etiqueta.charAt(0).toLowerCase()}${etiqueta.slice(1)}`);
  if (t.length > max) throw new ErrorValidacion(`${etiqueta} es demasiado largo (máximo ${max} caracteres)`);
  return t;
}

// Nombres y apellidos: además se eliminan < > (nunca son legítimos aquí).
export function nombrePersona(valor, etiqueta, obligatorio = false) {
  return texto(String(valor ?? "").replace(/[<>]/g, ""), { max: 60, obligatorio, etiqueta }).replace(/\s+/g, " ");
}

const NICK_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{1,39}$/u;
export function normalizarNick(valor) {
  return String(valor ?? "").normalize("NFC").replace(CONTROL, "").trim().replace(/\s+/g, " ");
}
// Solo para ALTAS de usuarios nuevos (los nicks ya existentes siguen valiendo).
export function validarNickNuevo(valor) {
  const nick = normalizarNick(valor);
  if (!nick) throw new ErrorValidacion("Falta el usuario");
  if (!NICK_RE.test(nick)) {
    throw new ErrorValidacion("El usuario debe tener entre 2 y 40 caracteres: letras, números, espacios, punto, guion o guion bajo");
  }
  return nick;
}

const CONTRASENAS_COMUNES = new Set([
  "aedes", "aedes123", "12345678", "123456789", "1234567890", "password", "password1", "contraseña",
  "contrasena", "admin123", "administrador", "qwerty123", "abcd1234", "11111111", "00000000", "irradiation",
]);
export const PASS_MIN = 8;
// Devuelve un texto de error o null si la contraseña es aceptable.
export function errorPassword(pass, nick) {
  if (typeof pass !== "string" || !pass) return "Falta la contraseña";
  if (pass.length < PASS_MIN) return `La contraseña debe tener al menos ${PASS_MIN} caracteres`;
  if (Buffer.byteLength(pass, "utf8") > 72) return "La contraseña es demasiado larga (máximo 72 caracteres)";
  if (nick && pass.toLowerCase() === String(nick).toLowerCase()) return "La contraseña no puede ser igual al usuario";
  if (CONTRASENAS_COMUNES.has(pass.toLowerCase())) return "Esa contraseña es demasiado común. Elige otra";
  return null;
}

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
export function esFecha(s) {
  if (typeof s !== "string" || !FECHA_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && y >= 2000 && y <= 2100;
}
export function fecha(valor, etiqueta = "La fecha") {
  if (valor === undefined || valor === null || valor === "") return null;
  if (!esFecha(valor)) throw new ErrorValidacion(`${etiqueta} no es válida`);
  return valor;
}

const HORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export function esHora(s) { return typeof s === "string" && HORA_RE.test(s); }
export function hora(valor, etiqueta = "La hora") {
  if (valor === undefined || valor === null || valor === "") return null;
  if (!esHora(valor)) throw new ErrorValidacion(`${etiqueta} debe tener formato HH:MM`);
  return valor;
}

export function numero(valor, { min = -Infinity, max = Infinity, etiqueta = "El valor", entero = false } = {}) {
  if (valor === undefined || valor === null || valor === "") return null;
  let n;
  if (typeof valor === "number") n = valor;
  else if (typeof valor === "string" && /^-?\d+([.,]\d+)?$/.test(valor.trim())) n = parseFloat(valor.trim().replace(",", "."));
  else throw new ErrorValidacion(`${etiqueta} debe ser un número`);
  if (!Number.isFinite(n)) throw new ErrorValidacion(`${etiqueta} debe ser un número`);
  if (entero && !Number.isInteger(n)) throw new ErrorValidacion(`${etiqueta} debe ser un número entero`);
  if (n < min || n > max) throw new ErrorValidacion(`${etiqueta} está fuera del rango permitido`);
  return n;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function uuid(valor, etiqueta = "El identificador") {
  if (valor === undefined || valor === null || valor === "") return null;
  if (typeof valor !== "string" || !UUID_RE.test(valor)) throw new ErrorValidacion(`${etiqueta} no es válido`);
  return valor;
}

// Marca de tiempo ISO (para el sondeo de notificaciones)
export function marcaTiempo(valor, etiqueta = "La marca de tiempo") {
  if (typeof valor !== "string" || Number.isNaN(Date.parse(valor))) throw new ErrorValidacion(`${etiqueta} no es válida`);
  return new Date(valor).toISOString();
}
