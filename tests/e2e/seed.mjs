import bcrypt from "bcryptjs";
export const PASS = "Clave-Segura-2026";
const HASH = bcrypt.hashSync(PASS, 4);
const AHORA = () => new Date().toISOString();

export function sembrarBase(db, { malicioso = false, adminMustChange = false, adminPass = PASS } = {}) {
  db.tables = {};
  const u = (nick, role, o = {}) => ({ id: "u-" + nick, nick, password_hash: bcrypt.hashSync(adminPass === PASS || nick !== "Admin" ? PASS : adminPass, 4), nombre: nick, apellido1: "Prueba", apellido2: "", role, locked: false, intentos: 0, token_version: 0, must_change_password: nick === "Admin" ? adminMustChange : false, bloqueado_hasta: null, created_at: AHORA(), codigo: (nick[0] + "PX").toUpperCase(), horario_entrada: "07:00", horario_salida: "13:57", tipo_horario: "fijo", ...o });
  db.tables.usuarios = [u("Admin", "admin"), u("ana", "user")];
  const hoy = new Date().toISOString().slice(0, 10);
  const reg = (o) => ({ id: crypto.randomUUID(), created_at: AHORA(), creado_por: "ana", fecha_irradiacion: hoy, semana_iso: 38, tasa: 0.27, tiempo_exposicion: 300, n_urnas: 3, conductor_nick: "ana", conductor_nombre: "Ana Prueba", conductor_codigo: "APX", dosimetros: 1, temp_media: 22, observaciones: "ok", ...o });
  db.tables.registros = [reg({})];
  db.tables.vehiculos = [];
  db.tables.estaciones_servicio = [];
  db.tables.irradiadores = [];
  if (malicioso) {
    const P = (n) => `<img src=x onerror="window.__pwned=(window.__pwned||0)+${n}">`;
    db.tables.usuarios.push(
      u("evil1", "user", { nombre: P(1), apellido1: '"><svg onload="window.__pwned=(window.__pwned||0)+2">', apellido2: P(3) }),
      u('x" onmouseover="window.__pwned=(window.__pwned||0)+4" data-x="', "user", { nombre: "Comilla" }),
      u("y');window.__pwned=(window.__pwned||0)+5;('", "user", { nombre: "Apostrofo" }),
    );
    db.tables.registros.push(reg({ creado_por: P(10), conductor_nombre: P(11), conductor_codigo: P(12), observaciones: P(13) + "\n=HYPERLINK(\"http://evil\",\"x\")", irradiador: P(14), irradiador_nombre: P(15) }));
    db.tables.vehiculos.push({ id: crypto.randomUUID(), matricula: P(20), numero_obra: P(21), activo: true, creado_por: "ana", created_at: AHORA() });
    db.tables.estaciones_servicio.push({ id: crypto.randomUUID(), nombre: P(30), activo: true, creado_por: "ana", created_at: AHORA() });
    db.tables.irradiadores.push({ id: crypto.randomUUID(), nombre: P(40), apellido1: P(41), apellido2: "", codigo: "IRX", activo: true, created_at: AHORA() });
    const vid = db.tables.vehiculos[0].id;
    db.tables.vehiculo_viajes = [{ id: crypto.randomUUID(), created_at: AHORA(), matricula: P(50), vehiculo_id: vid, fecha: hoy, km_inicial: 1, km_final: 5, km_recorridos: 4, creado_por: P(51) }];
    db.tables.repostajes = [{ id: crypto.randomUUID(), created_at: AHORA(), matricula: P(60), vehiculo_id: vid, fecha: hoy, km: 3, importe: 10, precio_litro: 1, litros: 10, tipo_combustible: "diesel", estacion_servicio: P(61), creado_por: P(62) }];
  } else {
    db.tables.vehiculo_viajes = []; db.tables.repostajes = [];
  }
  db.tables.fichajes = []; db.tables.auditoria = [];
}
