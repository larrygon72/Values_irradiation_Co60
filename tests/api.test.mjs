// Pruebas de las funciones de /api con una base de datos simulada en memoria.
// Ejecutar:  npm test
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createClient } from "./helpers/fakeSupabaseModule.mjs";
import { setMaxRows } from "./helpers/fakeSupabase.mjs";
import { callApi } from "./helpers/callApi.mjs";
import { invalidarSesion, firmarToken } from "../api/_lib/auth.js";
import { horaAhoraMadrid, fechaHoyMadrid, calcularHorasDeMas } from "../api/fichajes.js";

const db = createClient();
const PASS = "Clave-Segura-2026";
const HASH = bcrypt.hashSync(PASS, 4);

function sembrar(extra = []) {
  db.tables = {};
  db.missingColumns = {};
  invalidarSesion();
  const base = (nick, role, o = {}) => ({ id: "u-" + nick, nick, password_hash: HASH, nombre: nick, apellido1: "Test", apellido2: "", role, locked: false, intentos: 0, token_version: 0, must_change_password: false, bloqueado_hasta: null, created_at: new Date().toISOString(), codigo: "XTX", ...o });
  db.tables.usuarios = [base("Admin", "admin"), base("ana", "user"), base("bob", "user"), ...extra];
}
async function login(nick, pass = PASS) {
  const r = await callApi("auth", { action: "login", nick, pass });
  assert.equal(r.status, 200, `login ${nick}: ${JSON.stringify(r.body)}`);
  return r.body.token;
}
const api = (name, action, token, payload) => callApi(name, { action, token, payload });
beforeEach(() => { sembrar(); setMaxRows(1000); delete process.env.REGISTRO_ABIERTO; });

// ───────────────────────── AUTENTICACIÓN ─────────────────────────
test("register: valida nick, contraseña y respeta REGISTRO_ABIERTO", async () => {
  const mal = await callApi("auth", { action: "register", nick: '"><img src=x onerror=alert(1)>', pass: PASS, nombre: "A", apellido1: "B" });
  assert.equal(mal.status, 400);
  const corta = await callApi("auth", { action: "register", nick: "nuevo", pass: "abc", nombre: "A", apellido1: "B" });
  assert.equal(corta.status, 400);
  assert.match(corta.body.error, /8 caracteres/);
  const comun = await callApi("auth", { action: "register", nick: "nuevo", pass: "Aedes", nombre: "A", apellido1: "B" });
  assert.equal(comun.status, 400);
  const ok = await callApi("auth", { action: "register", nick: "nuevo", pass: PASS, nombre: "A", apellido1: "B" });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);
  process.env.REGISTRO_ABIERTO = "false";
  const cerrado = await callApi("auth", { action: "register", nick: "otro", pass: PASS, nombre: "A", apellido1: "B" });
  assert.equal(cerrado.status, 403);
  assert.equal(cerrado.body.code, "REGISTRO_CERRADO");
  const chk = await callApi("auth", { action: "check", nick: "otro" });
  assert.equal(chk.body.registroAbierto, false);
});

test("login: 3 fallos bloquean 15 min y el bloqueo caduca solo", async () => {
  for (let i = 0; i < 2; i++) assert.equal((await callApi("auth", { action: "login", nick: "ana", pass: "mala" + i })).status, 401);
  const tercero = await callApi("auth", { action: "login", nick: "ana", pass: "mala3" });
  assert.equal(tercero.status, 403);
  assert.match(tercero.body.error, /15 minutos/);
  assert.equal((await callApi("auth", { action: "login", nick: "ana", pass: PASS })).status, 403); // sigue bloqueada
  db.t("usuarios").find((u) => u.nick === "ana").bloqueado_hasta = new Date(Date.now() - 1000).toISOString();
  assert.equal((await callApi("auth", { action: "login", nick: "ana", pass: PASS })).status, 200);
});

test("login: un bloqueo permanente antiguo (sin fecha) solo lo quita un admin", async () => {
  db.t("usuarios").find((u) => u.nick === "ana").locked = true;
  assert.equal((await callApi("auth", { action: "login", nick: "ana", pass: PASS })).status, 403);
  const admin = await login("Admin");
  assert.equal((await api("usuarios", "desbloquear", admin, { nick: "ana" })).status, 200);
  assert.equal((await callApi("auth", { action: "login", nick: "ana", pass: PASS })).status, 200);
});

test("un bloqueo temporal NO expulsa a quien ya tiene sesión", async () => {
  const tok = await login("ana");
  for (let i = 0; i < 3; i++) await callApi("auth", { action: "login", nick: "ana", pass: "x" + i });
  invalidarSesion();
  assert.equal((await api("usuarios", "listPublic", tok)).status, 200);
});

test("nicks con _ o % se comparan de forma literal (sin comodines)", async () => {
  db.t("usuarios").push({ ...db.t("usuarios")[1], id: "x1", nick: "ana_1" }, { ...db.t("usuarios")[1], id: "x2", nick: "anaX1" });
  const t = await login("ana_1");
  const r = await api("fichajes", "ficharEntrada", t);
  assert.equal(r.status, 200);
  assert.equal(db.t("fichajes")[0].usuario_nick, "ana_1");
  assert.equal((await callApi("auth", { action: "login", nick: "%", pass: PASS })).status, 404);
});

test("cambiarPass: exige la actual, aplica la política y revoca los tokens antiguos", async () => {
  const viejo = await login("ana");
  assert.equal((await callApi("auth", { action: "cambiarPass", token: viejo, payload: { passActual: "no-es", passNueva: "Otra-Clave-77" } })).status, 401);
  assert.equal((await callApi("auth", { action: "cambiarPass", token: viejo, payload: { passActual: PASS, passNueva: "corta" } })).status, 400);
  const ok = await callApi("auth", { action: "cambiarPass", token: viejo, payload: { passActual: PASS, passNueva: "Otra-Clave-77" } });
  assert.equal(ok.status, 200);
  assert.equal((await api("usuarios", "listPublic", ok.body.token)).status, 200, "el token nuevo funciona");
  const r = await api("usuarios", "listPublic", viejo);
  assert.equal(r.status, 401, "el token antiguo queda revocado");
  assert.equal((await callApi("auth", { action: "login", nick: "ana", pass: "Otra-Clave-77" })).status, 200);
});

test("contraseña por defecto: obliga a cambiarla antes de hacer nada más", async () => {
  db.t("usuarios").find((u) => u.nick === "Admin").must_change_password = true;
  const r = await callApi("auth", { action: "login", nick: "Admin", pass: PASS });
  assert.equal(r.body.usuario.mustChangePassword, true);
  const bloqueado = await api("registros", "listar", r.body.token, {});
  assert.equal(bloqueado.status, 403);
  assert.equal(bloqueado.body.code, "DEBE_CAMBIAR_PASS");
  const cambio = await callApi("auth", { action: "cambiarPass", token: r.body.token, payload: { passActual: PASS, passNueva: "Admin-Nueva-2026" } });
  assert.equal(cambio.status, 200);
  assert.equal(cambio.body.usuario.mustChangePassword, false);
  assert.equal((await api("registros", "listar", cambio.body.token, {})).status, 200);
});

test("una caché de sesión obsoleta (otra instancia) nunca echa a quien acaba de cambiar su contraseña", async () => {
  const ana = db.t("usuarios").find((u) => u.nick === "ana");
  const t1 = await login("ana");
  assert.equal((await api("usuarios", "listPublic", t1)).status, 200); // esta instancia cachea: token_version 0
  // Otra instancia cambia la contraseña: en la base de datos ya hay token_version 1, pero aquí la caché sigue con 0
  ana.token_version = 1;
  const tokenNuevo = firmarToken(ana);
  assert.equal((await api("usuarios", "listPublic", tokenNuevo)).status, 200, "se confirma en la base de datos antes de rechazar");
  assert.equal((await api("usuarios", "listPublic", t1)).status, 401, "el token antiguo sí queda revocado");
  // Lo mismo con el cambio obligatorio ya resuelto en otra instancia
  ana.must_change_password = true; invalidarSesion();
  const t2 = firmarToken(ana);
  assert.equal((await api("registros", "listar", t2, {})).status, 403);
  ana.must_change_password = false; // resuelto en otra instancia
  assert.equal((await api("registros", "listar", t2, {})).status, 200);
});

test("tokens: manipulados, sin firma, de usuarios borrados o con rol cambiado", async () => {
  const tok = await login("Admin");
  assert.equal((await api("usuarios", "list", tok + "x")).status, 401);
  assert.equal((await api("usuarios", "list", "")).status, 401);
  const sinFirma = jwt.sign({ nick: "Admin", role: "admin" }, "", { algorithm: "none" });
  assert.equal((await api("usuarios", "list", sinFirma)).status, 401);
  const otraClave = jwt.sign({ nick: "Admin", role: "admin", tv: 0 }, "otra-clave-cualquiera-de-32-caracteres!!");
  assert.equal((await api("usuarios", "list", otraClave)).status, 401);
  // el rol lo decide la base de datos, no lo que diga el token
  const tokAna = await login("ana");
  const falso = jwt.sign({ nick: "ana", role: "admin", tv: 0 }, process.env.AUTH_SECRET);
  assert.equal((await api("usuarios", "list", falso)).status, 403);
  assert.equal((await api("usuarios", "list", tokAna)).status, 403);
  // usuario borrado -> su token deja de valer
  await api("usuarios", "eliminar", tok, { nick: "bob" });
  const tokBob = jwt.sign({ nick: "bob", role: "user", tv: 0 }, process.env.AUTH_SECRET);
  assert.equal((await api("usuarios", "listPublic", tokBob)).status, 401);
});

// ───────────────────────── USUARIOS ─────────────────────────
test("usuarios: el comodín % no afecta a nadie", async () => {
  const admin = await login("Admin");
  const antes = db.t("usuarios").length;
  assert.equal((await api("usuarios", "eliminar", admin, { nick: "%" })).status, 404);
  assert.equal((await api("usuarios", "editar", admin, { nick: "%", nuevaPass: "Nueva-Clave-123" })).status, 404);
  assert.equal((await api("usuarios", "desbloquear", admin, { nick: "%" })).status, 404);
  assert.equal(db.t("usuarios").length, antes);
  assert.ok(db.t("usuarios").every((u) => bcrypt.compareSync(PASS, u.password_hash)));
});

test("usuarios: protecciones de Admin y del último administrador", async () => {
  const admin = await login("Admin");
  await api("usuarios", "crear", admin, { nick: "jefe", pass: PASS, nombre: "J", apellido1: "F", role: "admin" });
  const jefe = await login("jefe");
  const r = await api("usuarios", "eliminar", jefe, { nick: "Admin" });
  assert.equal(r.status, 403);
  assert.equal((await api("usuarios", "editar", jefe, { nick: "Admin", role: "user" })).status, 403);
  // Admin se quita a sí mismo el rol -> permitido porque queda "jefe"; después, "jefe" es el último
  assert.equal((await api("usuarios", "editar", admin, { nick: "Admin", role: "user" })).status, 200);
  const r2 = await api("usuarios", "editar", jefe, { nick: "jefe", role: "user" });
  assert.equal(r2.status, 400);
  assert.match(r2.body.error, /último administrador/);
  const r3 = await api("usuarios", "eliminar", jefe, { nick: "jefe" });
  assert.equal(r3.status, 400);
});

test("usuarios: un usuario normal no puede gestionar; crear valida y audita", async () => {
  const ana = await login("ana");
  assert.equal((await api("usuarios", "crear", ana, { nick: "zzz", pass: PASS })).status, 403);
  const admin = await login("Admin");
  assert.equal((await api("usuarios", "crear", admin, { nick: "x", pass: PASS })).status, 400);
  assert.equal((await api("usuarios", "crear", admin, { nick: "nuevo", pass: "corta" })).status, 400);
  assert.equal((await api("usuarios", "crear", admin, { nick: "nuevo", pass: PASS, horarioEntrada: "25:00" })).status, 400);
  assert.equal((await api("usuarios", "crear", admin, { nick: "Nuevo", pass: PASS, nombre: "N", apellido1: "U" })).status, 200);
  assert.equal((await api("usuarios", "crear", admin, { nick: "nuevo", pass: PASS })).status, 409);
  assert.ok(db.t("auditoria").some((a) => a.accion === "crear" && a.entidad === "usuario"));
});

test("usuarios: restablecer contraseña o cambiar el rol cierra las sesiones abiertas de ese usuario", async () => {
  const admin = await login("Admin");
  const tokBob = await login("bob");
  assert.equal((await api("usuarios", "listPublic", tokBob)).status, 200);
  assert.equal((await api("usuarios", "editar", admin, { nick: "bob", nuevaPass: "Restablecida-88" })).status, 200);
  assert.equal((await api("usuarios", "listPublic", tokBob)).status, 401);
  assert.equal((await callApi("auth", { action: "login", nick: "bob", pass: "Restablecida-88" })).status, 200);
});

// ───────────────────────── REGISTROS ─────────────────────────
const registro = (o = {}) => ({ fchIrr: "2026-09-16", semana: "38", tasa: "0.2", texp: "350.5", texpReal: "351", expUsv: "1.5", nUrnas: 3, u1: { n: "3", date: "2026-09-10", lote: "04/09/2026" }, u2: { n: "", date: "", lote: "" }, u3: null, resp: "Ana Test", respNick: "ana", respCodigo: "ATX", hII: "07:30", ti: "22.5", tf: "23", tm: "22.8", irrId: "", dos: "1", hIni: "08:00", hFin: "08:20", obs: "Todo bien", ...o });

test("registros: guardar valida los datos y no filtra errores internos", async () => {
  const ana = await login("ana");
  assert.equal((await api("registros", "guardar", ana, registro())).status, 200);
  for (const [campo, valor] of [["fchIrr", "no-es-fecha"], ["fchIrr", "2026-02-31"], ["ti", "abc"], ["ti", "999"], ["hII", "7:5"], ["nUrnas", -1], ["dos", "2.5"], ["irrId", "xx"], ["obs", "x".repeat(6000)]]) {
    const r = await api("registros", "guardar", ana, registro({ [campo]: valor }));
    assert.equal(r.status, 400, `${campo}=${String(valor).slice(0, 10)} debería rechazarse`);
  }
  db.missingColumns = { registros: ["exposicion_usv"] };
  const r = await api("registros", "guardar", ana, registro());
  assert.equal(r.status, 500);
  assert.doesNotMatch(JSON.stringify(r.body), /schema cache|exposicion_usv|PGRST/, "no se filtran detalles internos");
  assert.match(r.body.error, /ref\./);
});

test("registros: reintentar con el mismo uid no duplica; sin la columna client_uid sigue guardando", async () => {
  const ana = await login("ana");
  const a = await api("registros", "guardar", ana, registro({ uid: "abc12345-def" }));
  const b = await api("registros", "guardar", ana, registro({ uid: "abc12345-def" }));
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(b.body.duplicado, true);
  assert.equal(b.body.id, a.body.id);
  assert.equal(db.t("registros").length, 1);
  db.missingColumns = { registros: ["client_uid"] };
  const c = await api("registros", "guardar", ana, registro({ uid: "otro-uid-999" }));
  assert.equal(c.status, 200);
  assert.equal(db.t("registros").length, 2);
});

test("registros: listar devuelve TODOS los que hay (más de 1000) y avisa si recorta", async () => {
  const ana = await login("ana");
  const filas = Array.from({ length: 2300 }, (_, i) => ({ id: "r" + i, creado_por: "ana", fecha_irradiacion: "2026-09-" + String(1 + (i % 28)).padStart(2, "0"), created_at: new Date(2026, 8, 1, 0, 0, i).toISOString() }));
  db.tables.registros = filas;
  const r = await api("registros", "listar", ana, { desde: "2026-09-01", hasta: "2026-09-30" });
  assert.equal(r.body.registros.length, 2300);
  assert.equal(r.body.truncado, false);
  db.tables.registros = Array.from({ length: 10500 }, (_, i) => ({ id: "q" + i, creado_por: "ana", fecha_irradiacion: "2026-09-01", created_at: new Date(2026, 8, 1, 0, 0, i % 60).toISOString() }));
  const g = await api("registros", "listar", ana, {});
  assert.equal(g.body.registros.length, 10000);
  assert.equal(g.body.truncado, true);
  assert.equal((await api("registros", "listar", ana, { desde: "ayer" })).status, 400);
});

test("registros: cada usuario solo edita/borra los suyos; admin todos; queda auditado", async () => {
  const ana = await login("ana"), bob = await login("bob"), admin = await login("Admin");
  const { body } = await api("registros", "guardar", ana, registro());
  assert.equal((await api("registros", "eliminar", bob, { id: body.id })).status, 403);
  assert.equal((await api("registros", "actualizar", bob, { id: body.id, registro: registro() })).status, 403);
  assert.equal((await api("registros", "actualizar", ana, { id: body.id, registro: registro({ obs: "editado" }) })).status, 200);
  assert.equal(db.t("registros")[0].observaciones, "editado");
  assert.equal((await api("registros", "eliminar", admin, { id: body.id })).status, 200);
  assert.equal(db.t("registros").length, 0);
  assert.equal((await api("registros", "eliminar", admin, { id: "no-uuid" })).status, 400);
  assert.deepEqual(db.t("auditoria").map((a) => a.accion), ["actualizar", "eliminar"]);
});

test("registros: 'nuevos' valida la marca de tiempo", async () => {
  const ana = await login("ana");
  assert.equal((await api("registros", "nuevos", ana, {})).status, 400);
  assert.equal((await api("registros", "nuevos", ana, { desde: "basura" })).status, 400);
  assert.equal((await api("registros", "nuevos", ana, { desde: new Date(0).toISOString() })).status, 200);
});

// ───────────────────────── FICHAJES ─────────────────────────
test("fichajes: hora y fecha de Madrid, también cerca de medianoche y con cambio horario", () => {
  assert.equal(horaAhoraMadrid(new Date("2026-01-10T23:05:00Z")), "00:05");
  assert.equal(fechaHoyMadrid(new Date("2026-01-10T23:05:00Z")), "2026-01-11");
  assert.equal(horaAhoraMadrid(new Date("2026-07-10T22:05:00Z")), "00:05");
  assert.equal(fechaHoyMadrid(new Date("2026-07-10T21:59:00Z")), "2026-07-10");
  assert.equal(horaAhoraMadrid(new Date("2026-01-10T06:05:00Z")), "07:05");
});

test("fichajes: cálculo de horas de más (fijo con cortesía y flexible)", () => {
  assert.equal(calcularHorasDeMas("fijo", "07:00", "14:10", "07:00", "13:57"), 0);
  assert.equal(calcularHorasDeMas("fijo", "07:00", "13:42", "07:00", "13:57"), 0);
  assert.equal(calcularHorasDeMas("fijo", "07:00", "14:27", "07:00", "13:57"), 0.5);
  assert.equal(calcularHorasDeMas("fijo", "07:00", "13:00", "07:00", "13:57"), -57 / 60);
  assert.equal(calcularHorasDeMas("flexible", "08:00", "15:00", "07:00", "13:57"), (420 - 417) / 60);
  assert.equal(calcularHorasDeMas("flexible", null, "15:00", "07:00", "13:57"), null);
});

test("fichajes: no se puede fichar dos veces y cada usuario solo ve lo suyo", async () => {
  const ana = await login("ana"), bob = await login("bob"), admin = await login("Admin");
  assert.equal((await api("fichajes", "ficharSalida", ana)).status, 400);
  assert.equal((await api("fichajes", "ficharEntrada", ana)).status, 200);
  const doble = await api("fichajes", "ficharEntrada", ana);
  assert.equal(doble.status, 400);
  assert.match(doble.body.error, /Ya has fichado/);
  assert.equal((await api("fichajes", "ficharEntrada", bob)).status, 200);
  const propios = await api("fichajes", "listar", ana, { usuarioNick: "bob" });
  assert.deepEqual(propios.body.fichajes.map((f) => f.usuario_nick), ["ana"]);
  const todos = await api("fichajes", "listar", admin, {});
  assert.equal(todos.body.fichajes.length, 2);
  assert.equal((await api("fichajes", "eliminar", ana, { id: todos.body.fichajes[0].id })).status, 403);
});

test("fichajes: corregir valida fecha, orden de horas y usuario", async () => {
  const ana = await login("ana"), admin = await login("Admin");
  const hoy = fechaHoyMadrid();
  assert.equal((await api("fichajes", "corregir", ana, { fecha: "2026-13-40", horaEntrada: "07:00" })).status, 400);
  assert.equal((await api("fichajes", "corregir", ana, { fecha: "2099-01-01", horaEntrada: "07:00" })).status, 400);
  assert.equal((await api("fichajes", "corregir", ana, { fecha: "2026-09-01", horaEntrada: "14:00", horaSalida: "13:00" })).status, 400);
  assert.equal((await api("fichajes", "corregir", ana, { fecha: "2026-09-01", horaEntrada: "7:00" })).status, 400);
  const ok = await api("fichajes", "corregir", ana, { fecha: "2026-09-01", horaEntrada: "07:00", horaSalida: "14:27" });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.fichaje.horas_de_mas, 0.5);
  // solo entrada sobre un día con salida ya guardada: se recalcula (tipo flexible depende de la entrada)
  db.t("usuarios").find((u) => u.nick === "ana").tipo_horario = "flexible";
  const re = await api("fichajes", "corregir", ana, { fecha: "2026-09-01", horaEntrada: "08:00" });
  assert.equal(re.body.fichaje.tipo_horario_aplicado, "flexible");
  assert.ok(Math.abs(re.body.fichaje.horas_de_mas - (387 - 417) / 60) < 1e-9);
  assert.equal((await api("fichajes", "corregir", admin, { fecha: hoy, horaEntrada: "07:00", usuarioNick: "fantasma" })).status, 404);
  const deBob = await api("fichajes", "corregir", admin, { fecha: hoy, horaEntrada: "07:05", usuarioNick: "BOB" });
  assert.equal(deBob.status, 200);
  assert.equal(deBob.body.fichaje.usuario_nick, "bob", "se usa el nick tal como está guardado");
  assert.equal((await api("fichajes", "corregir", ana, { fecha: hoy, horaEntrada: "07:05", usuarioNick: "bob" })).body.fichaje.usuario_nick, "ana", "un usuario normal no puede corregir a otro");
});

// ───────────────────────── CONDUCCIÓN, VEHÍCULOS, ESTACIONES ─────────────────────────
test("conducción: valida km, combustible y propiedad de los datos", async () => {
  const ana = await login("ana"), bob = await login("bob");
  const veh = await api("vehiculos", "crear", ana, { matricula: "  1234  abc ", numeroObra: "OB-1" });
  assert.equal(veh.status, 200);
  assert.equal(veh.body.vehiculo.matricula, "1234 ABC");
  assert.equal((await api("vehiculos", "crear", bob, { matricula: "1234 abc", numeroObra: "X" })).status, 400);
  assert.equal((await api("conduccion", "guardarViaje", ana, { matricula: "1234 ABC", vehiculoId: veh.body.id, fecha: "2026-09-16", kmInicial: "100", kmFinal: "90" })).status, 400);
  const v = await api("conduccion", "guardarViaje", ana, { matricula: "1234 ABC", vehiculoId: veh.body.id, fecha: "2026-09-16", kmInicial: "100", kmFinal: "150" });
  assert.equal(v.status, 200);
  assert.equal((await api("conduccion", "guardarRepostaje", ana, { matricula: "1234 ABC", tipoCombustible: "agua" })).status, 400);
  await api("conduccion", "guardarRepostaje", ana, { matricula: "1234 ABC", vehiculoId: veh.body.id, fecha: "2026-09-16", km: "120", importe: "50", precioLitro: "1.5", tipoCombustible: "diesel" });
  await api("conduccion", "guardarRepostaje", ana, { matricula: "1234 ABC", vehiculoId: veh.body.id, fecha: "2026-09-16", km: "10", importe: "5", precioLitro: "1", tipoCombustible: "adblue" });
  const ult = await api("conduccion", "ultimoKmVehiculo", ana, { vehiculoId: veh.body.id, tipoCombustible: "adblue" });
  assert.deepEqual(ult.body, { ultimoKmViaje: 150, ultimoKmRepostaje: 10 });
  const viajes = await api("conduccion", "listarViajes", ana, {});
  assert.equal((await api("conduccion", "eliminarViaje", bob, { id: viajes.body.viajes[0].id })).status, 403);
  assert.equal((await api("conduccion", "eliminarViaje", ana, { id: viajes.body.viajes[0].id })).status, 200);
});

test("estaciones e irradiadores: solo admin gestiona; nombres validados", async () => {
  const ana = await login("ana"), admin = await login("Admin");
  assert.equal((await api("estaciones", "crear", ana, { nombre: "Repsol  Norte" })).status, 200);
  assert.equal(db.t("estaciones_servicio")[0].nombre, "Repsol Norte");
  assert.equal((await api("estaciones", "crear", ana, { nombre: "repsol norte" })).status, 400);
  assert.equal((await api("estaciones", "eliminar", ana, { id: db.t("estaciones_servicio")[0].id })).status, 403);
  assert.equal((await api("irradiadores", "crear", ana, { nombre: "A", apellido1: "B" })).status, 403);
  assert.equal((await api("irradiadores", "crear", admin, { nombre: "A", apellido1: "" })).status, 400);
  assert.equal((await api("irradiadores", "crear", admin, { nombre: "Pepe", apellido1: "Gil" })).status, 200);
  assert.equal((await api("irradiadores", "listPublic", ana)).body.irradiadores[0].codigo, "PGX");
});

test("la API rechaza métodos distintos de POST y nunca se guarda en caché", async () => {
  const mod = await import("../api/registros.js");
  const res = { statusCode: 0, headers: {}, status(c) { this.statusCode = c; return this; }, json(o) { this.body = o; return this; }, setHeader(k, v) { this.headers[k] = v; } };
  await mod.default({ method: "GET", body: {} }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers["Cache-Control"], "no-store");
});
