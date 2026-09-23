// Filtros de Informes (usuario, conductor, irradiador) en Chromium.
// Uso:  node --import ./tests/helpers/register.mjs tests/e2e/informes.e2e.mjs
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createClient } from "../helpers/fakeSupabaseModule.mjs";
import { startServer } from "./server.mjs";
import { sembrarBase, PASS } from "./seed.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const db = createClient();
let fallos = 0;
const check = (n, ok, x = "") => { console.log(`${ok ? "✓" : "✗"} ${n}${x ? "  → " + x : ""}`); if (!ok) fallos++; };

sembrarBase(db);
const AHORA = new Date().toISOString();
const dia = (atras) => new Date(Date.now() - atras * 864e5).toISOString().slice(0, 10);
const usr = (nick) => ({ ...db.t("usuarios")[1], id: "u-" + nick, nick, nombre: nick, apellido1: "Prueba", codigo: nick[0].toUpperCase() + "PX" });
db.t("usuarios").push(usr("bob"));
db.tables.irradiadores = [
  { id: crypto.randomUUID(), nombre: "Pepe", apellido1: "Gil", apellido2: "", codigo: "PGX", activo: true },
  { id: crypto.randomUUID(), nombre: "Luis", apellido1: "Mora", apellido2: "", codigo: "LMX", activo: true },
];
const reg = (o) => ({ id: crypto.randomUUID(), created_at: AHORA, fecha_irradiacion: dia(1), semana_iso: 38, ...o });
db.tables.registros = [
  reg({ conductor_nick: "ana", conductor_nombre: "ana Prueba", creado_por: "ana", irradiador_nombre: "Pepe Gil", h_inicio_irr: "08:00", h_fin_irr: "08:20", n_urnas: 3 }),
  reg({ conductor_nick: "bob", conductor_nombre: "bob Prueba", creado_por: "bob", irradiador_nombre: "Luis Mora", h_inicio_irr: "09:00", h_fin_irr: "10:45", n_urnas: 2 }),
  reg({ conductor_nick: "ana", conductor_nombre: "ana Prueba", creado_por: "bob", irradiador_nombre: "Pepe Gil", h_inicio_irr: "08:00", h_fin_irr: "08:40", n_urnas: 5 }),
];
const fich = (nick, atras, hm) => ({ id: crypto.randomUUID(), usuario_nick: nick, fecha: dia(atras), hora_entrada: "07:00", hora_salida: "14:00", horas_de_mas: hm, tipo_horario_aplicado: "fijo", created_at: AHORA });
db.tables.fichajes = [fich("ana", 1, 0.5), fich("ana", 2, 1.25), fich("bob", 1, -0.5), fich("bob", 2, 2)];

const srv = await startServer(RAIZ);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
await ctx.addInitScript(() => { window.showSaveFilePicker = undefined; });
const page = await ctx.newPage();
page.setDefaultTimeout(6000);
const errores = [];
page.on("pageerror", (e) => errores.push(e.message.slice(0, 200)));
const w = (ms) => page.waitForTimeout(ms);
const ev = (f, a) => page.evaluate(f, a);
async function entrar(nick) {
  await ev(() => { lReset(); go("sl"); }); await page.fill("#luser", nick); await page.click("#lbtn");
  await page.waitForSelector("#lpassF", { state: "visible" }); await page.fill("#lpass", PASS); await page.click("#lbtn"); await w(800);
}
const sumar = (ids) => ev((i) => document.querySelectorAll(".campoSumaChk").forEach((c) => { c.checked = i.includes(c.dataset.campo); }), ids);
const filas = () => ev(() => document.querySelectorAll("#vistaPreviaTabla tbody tr").length);
const pie = () => ev(() => [...document.querySelectorAll("#vistaPreviaTabla tfoot td")].map((t) => t.innerText.trim()).filter(Boolean).join("|"));
const nota = () => ev(() => document.getElementById("informesNote").textContent);
const opciones = (id) => ev((i) => [...document.getElementById(i).options].map((o) => o.textContent), id);
const descargar = async (fn) => { const d = page.waitForEvent("download"); await ev(fn); const dl = await d; return { nombre: dl.suggestedFilename(), texto: fs.readFileSync(await dl.path()) }; };
const cerrarDialogo = () => ev(() => { const o = document.getElementById("scov"); if (o) o.classList.remove("on"); });

await page.goto(srv.url); await w(500);
await page.locator("#swelcome button").first().click();
await entrar("Admin");

// ═════════ Informe de REGISTROS ═════════
await ev(() => go("informes")); await w(900);
const conductores = await opciones("iConductor"), irradiadores = await opciones("iIrradiador"), guardadores = await opciones("iUsuario");
check("Filtros de registros: conductor, guardado por e irradiador con sus opciones", conductores.includes("ana Prueba") && conductores.includes("bob Prueba") && irradiadores.includes("Pepe Gil") && irradiadores.includes("Luis Mora") && guardadores.some((t) => t.startsWith("bob")), JSON.stringify({ conductores, irradiadores }));
check("Con «registros» solo se ven los filtros de registros", (await ev(() => document.getElementById("iFiltrosRegistros").style.display)) === "flex" && (await ev(() => document.getElementById("iFiltrosFichajes").style.display)) === "none");
await sumar(["nUrnas", "duracionIrr"]);
await ev(() => buscarInformes()); await w(900);
check("Sin filtros: los 3 registros y el total de todos (10 urnas, 2:45)", (await filas()) === 3 && /10/.test(await pie()) && /2:45/.test(await pie()), await pie());
await page.selectOption("#iConductor", "ana"); await w(300);
check("Filtro por conductor ana: 2 registros y el total solo de ana (8 urnas, 1:00)", (await filas()) === 2 && /8/.test(await pie()) && /1:00/.test(await pie()) && /Conductor: ana Prueba/.test(await nota()), (await pie()) + " | " + (await nota()));
await page.selectOption("#iIrradiador", "Pepe Gil"); await page.selectOption("#iUsuario", "bob"); await w(300);
check("Conductor ana + irradiador Pepe Gil + guardado por bob: 1 registro (5 urnas, 0:40)", (await filas()) === 1 && /5/.test(await pie()) && /0:40/.test(await pie()), await pie());
await page.selectOption("#iUsuario", ""); await page.selectOption("#iIrradiador", ""); await page.selectOption("#iConductor", "bob"); await w(300);
await ev(async () => { await cargarLib("pdf"); window.__pdfTexts = []; const Orig = window.jspdf.jsPDF; window.jspdf.jsPDF = function (...a) { const d = new Orig(...a); const t = d.text.bind(d); d.text = (x, ...r) => { window.__pdfTexts.push(String(x)); return t(x, ...r); }; return d; }; });
const csv = await descargar(() => exportInformeCSV());
check("CSV filtrado: solo el conductor elegido y el nombre del archivo lo indica", csv.nombre.startsWith("informe_registros_bob_") && /bob Prueba/.test(csv.texto.toString()) && !/ana Prueba/.test(csv.texto.toString()), csv.nombre);
await cerrarDialogo();
const pdf = await descargar(() => exportInformePDF());
const textosPdf = await ev(() => window.__pdfTexts);
check("PDF: el nombre incluye el filtro y la cabecera muestra periodo y filtro", pdf.nombre.startsWith("informe_registros_bob_") && textosPdf.some((t) => /Periodo: .* – .*Conductor: bob Prueba/.test(t)), textosPdf.filter((t) => /Periodo/.test(t)).join(" ; "));
await cerrarDialogo();
await ev(() => limpiarFiltrosInforme()); await w(300);
check("«Quitar filtros» vuelve a mostrar todo", (await filas()) === 3 && (await ev(() => document.getElementById("iConductor").value)) === "");

// ═════════ Informe de FICHAJES (administrador) ═════════
await page.selectOption("#informeTipo", "fichajes"); await w(500);
const usuariosF = await opciones("iUsuarioFich");
check("Fichajes: filtro «Usuario» con todos los usuarios", usuariosF[0] === "Todos los usuarios" && usuariosF.some((t) => t.startsWith("ana")) && usuariosF.some((t) => t.startsWith("bob")), usuariosF.join(","));
check("Con «fichajes» solo se ve el filtro de usuario", (await ev(() => document.getElementById("iFiltrosFichajes").style.display)) === "flex" && (await ev(() => document.getElementById("iFiltrosRegistros").style.display)) === "none");
await sumar(["horasDeMas"]);
await ev(() => buscarInformes()); await w(900);
check("Todos los usuarios: 4 fichajes y el total de todos (0:30 + 1:15 − 0:30 + 2:00 = 3:15)", (await filas()) === 4 && /3:15/.test(await pie()), await pie());
await page.selectOption("#iUsuarioFich", "ana"); await w(900);
check("Usuario ana: solo sus 2 fichajes y su total (1:45), no la suma de todos", (await filas()) === 2 && /1:45/.test(await pie()) && !/3:15/.test(await pie()) && /Usuario: ana/.test(await nota()), (await pie()) + " | " + (await nota()));
const usuariosVistos = await ev(() => [...document.querySelectorAll("#vistaPreviaTabla tbody tr")].map((r) => r.innerText).join(" ").match(/\bbob\b/g));
check("…y no aparece ningún fichaje de bob", usuariosVistos === null);
const csvF = await descargar(() => exportInformeCSV());
check("CSV de fichajes: solo ana, con su nombre en el archivo", /^informe_fichajes_ana_/.test(csvF.nombre) && !/bob/.test(csvF.texto.toString()) && /"1:45"/.test(csvF.texto.toString()), csvF.nombre);
await cerrarDialogo();
await page.selectOption("#iUsuarioFich", "bob"); await w(900);
check("Cambiar a bob recalcula: 2 fichajes, total 1:30", (await filas()) === 2 && /1:30/.test(await pie()), await pie());
await page.selectOption("#iUsuarioFich", ""); await w(900);
check("Volver a «Todos los usuarios»", (await filas()) === 4 && /3:15/.test(await pie()));

// ═════════ Informe de CONDUCCIÓN — Viajes ═════════
db.tables.vehiculos = [
  { id: crypto.randomUUID(), matricula: "1234 ABC", numero_obra: "OB-1", activo: true },
  { id: crypto.randomUUID(), matricula: "9999 ZZZ", numero_obra: "OB-2", activo: true },
];
const [veh1, veh2] = db.tables.vehiculos;
const viaje = (o) => ({ id: crypto.randomUUID(), created_at: AHORA, fecha: dia(1), ...o });
db.tables.vehiculo_viajes = [
  viaje({ matricula: veh1.matricula, vehiculo_id: veh1.id, km_inicial: 100, km_final: 150, km_recorridos: 50, creado_por: "ana" }),
  viaje({ matricula: veh1.matricula, vehiculo_id: veh1.id, km_inicial: 150, km_final: 210, km_recorridos: 60, creado_por: "bob" }),
  viaje({ matricula: veh2.matricula, vehiculo_id: veh2.id, km_inicial: 500, km_final: 545, km_recorridos: 45, creado_por: "ana" }),
];
await ev(() => go("informes")); await w(600);
await page.selectOption("#informeTipo", "viajes"); await w(700);
check("Con «viajes» solo se ve el filtro de conducción", (await ev(() => document.getElementById("iFiltrosConduccion").style.display)) === "flex" && (await ev(() => document.getElementById("iFiltrosRegistros").style.display)) === "none");
const vehiculosOpt = await opciones("iVehiculo");
check("Filtro de vehículo con la flota (incluye vehículos sin viajes en el periodo)", vehiculosOpt.some((t) => t.startsWith("1234 ABC")) && vehiculosOpt.some((t) => t.startsWith("9999 ZZZ")));
await sumar(["kmRecorridos"]);
await ev(() => buscarInformes()); await w(900);
check("Sin filtro: 3 viajes y el total de todos (155 km)", (await filas()) === 3 && /155/.test(await pie()), await pie());
await page.selectOption("#iVehiculo", "1234 ABC"); await w(300);
check("Filtro por vehículo 1234 ABC: 2 viajes, total parcial+total = 110 km (no la suma de toda la flota)", (await filas()) === 2 && /110/.test(await pie()) && !/155/.test(await pie()) && /Vehículo: 1234 ABC/.test(await nota()), (await pie()) + " | " + (await nota()));
const filaKm = await ev(() => [...document.querySelectorAll("#vistaPreviaTabla tbody tr")].map((r) => r.innerText));
check("Cada fila muestra su km «parcial» (50 y 60), no solo el total", filaKm.some((t) => /\b50\b/.test(t)) && filaKm.some((t) => /\b60\b/.test(t)), filaKm.join(" | "));
await page.selectOption("#iUsuarioCond", "ana"); await w(300);
check("Vehículo 1234 ABC + guardado por ana: 1 viaje, 50 km", (await filas()) === 1 && /\b50\b/.test(await pie()), await pie());
const csvV = await descargar(() => exportInformeCSV());
check("CSV de viajes: nombre con el vehículo y el usuario filtrados", /^informe_viajes_1234-abc_ana_/.test(csvV.nombre), csvV.nombre);
await cerrarDialogo();
await ev(() => limpiarFiltrosInforme()); await w(300);

// Más de 500 viajes en el periodo: antes se recortaban en silencio (límite de 500 en la API); ahora se traen todos.
const muchos = Array.from({ length: 620 }, (_, i) => viaje({ id: "auto-" + i, matricula: veh1.matricula, vehiculo_id: veh1.id, km_inicial: 0, km_final: 10, km_recorridos: 10, creado_por: "ana", created_at: new Date(Date.now() - i * 1000).toISOString() }));
db.tables.vehiculo_viajes = muchos;
await ev(() => buscarInformes()); await w(1500);
check("Periodo con 620 viajes: el informe los trae TODOS (antes se cortaba en 500) y el total es exacto (6200 km)", (await ev(() => S.informesRaw.length)) === 620 && /6200/.test(await pie()) && !/Hay más de 10/.test(await nota()), (await ev(() => S.informesRaw.length)) + " | " + (await pie()));
db.tables.vehiculo_viajes = [
  { id: crypto.randomUUID(), created_at: AHORA, fecha: dia(1), matricula: veh1.matricula, vehiculo_id: veh1.id, km_inicial: 100, km_final: 150, km_recorridos: 50, creado_por: "ana" },
  { id: crypto.randomUUID(), created_at: AHORA, fecha: dia(1), matricula: veh1.matricula, vehiculo_id: veh1.id, km_inicial: 150, km_final: 210, km_recorridos: 60, creado_por: "bob" },
  { id: crypto.randomUUID(), created_at: AHORA, fecha: dia(1), matricula: veh2.matricula, vehiculo_id: veh2.id, km_inicial: 500, km_final: 545, km_recorridos: 45, creado_por: "ana" },
];

// ═════════ Informe de CONDUCCIÓN — Repostajes ═════════
db.tables.estaciones_servicio = [{ id: crypto.randomUUID(), nombre: "Repsol Norte", activo: true }];
const repo = (o) => ({ id: crypto.randomUUID(), created_at: AHORA, fecha: dia(1), estacion_id: db.tables.estaciones_servicio[0].id, estaciones_servicio: { nombre: "Repsol Norte" }, ...o });
db.tables.repostajes = [
  repo({ matricula: veh1.matricula, vehiculo_id: veh1.id, km: 150, importe: 60.5, precio_litro: 1.5, litros: 40, tipo_combustible: "diesel", creado_por: "ana" }),
  repo({ matricula: veh1.matricula, vehiculo_id: veh1.id, km: 310, importe: 39.5, precio_litro: 1.58, litros: 25, tipo_combustible: "diesel", creado_por: "bob" }),
  repo({ matricula: veh2.matricula, vehiculo_id: veh2.id, km: 545, importe: 20, precio_litro: 2, litros: 10, tipo_combustible: "adblue", creado_por: "ana" }),
];
await ev(() => go("informes")); await w(600);
await page.selectOption("#informeTipo", "repostajes"); await w(700);
await sumar(["importe", "litros"]);
await ev(() => buscarInformes()); await w(900);
check("Repostajes sin filtro: 3 y el total de gasto (120 €) y litros (75 L) de todos", (await filas()) === 3 && /120\.00/.test(await pie()) && /75\.00/.test(await pie()), await pie());
await page.selectOption("#iVehiculo", "1234 ABC"); await w(300);
check("Filtro por vehículo 1234 ABC: gasto 100 € (60.5+39.5), no los 120 € de toda la flota", (await filas()) === 2 && /100\.00/.test(await pie()) && !/120\.00/.test(await pie()), await pie());
const kmRepo = await ev(() => [...document.querySelectorAll("#vistaPreviaTabla tbody tr")].map((r) => r.innerText).join(" "));
check("El km de repostaje se ve por fila (150, 310) pero no se suma (es un cuentakilómetros, no una distancia)", /\b150\b/.test(kmRepo) && /\b310\b/.test(kmRepo));
await page.selectOption("#iUsuarioCond", "bob"); await w(300);
check("Vehículo 1234 ABC + guardado por bob: 1 repostaje, 39.50 €", (await filas()) === 1 && /39\.50/.test(await pie()), await pie());
const csvR = await descargar(() => exportInformeCSV());
check("CSV de repostajes: nombre del archivo con los filtros aplicados", /^informe_repostajes_1234-abc_bob_/.test(csvR.nombre) && /39[.,]5/.test(csvR.texto.toString()), csvR.nombre);
await cerrarDialogo();
const pdfR = await descargar(() => exportInformePDF());
check("PDF de repostajes: se genera y la cabecera indica «Informe de repostajes»", pdfR.texto.length > 3000 && (await ev(() => window.__pdfTexts || [])).some((t) => /Informe de repostajes/.test(t)));
await cerrarDialogo();
await ev(() => limpiarFiltrosInforme()); await w(300);
check("«Quitar filtros» en repostajes vuelve a los 3 / 120 €", (await filas()) === 3 && /120\.00/.test(await pie()));

// ═════════ Usuario normal ═════════
await ev(() => logout()); await entrar("ana");
await ev(() => go("informes")); await w(800);
await page.selectOption("#informeTipo", "fichajes"); await w(500);
const bloqueado = await ev(() => { const e = document.getElementById("iUsuarioFich"); return { dis: e.disabled, val: e.value, opts: [...e.options].map((o) => o.textContent) }; });
check("Usuario normal: el filtro de fichajes queda fijado en él mismo (no puede ver a otros)", bloqueado.dis && bloqueado.val === "ana" && bloqueado.opts.length === 1, JSON.stringify(bloqueado));
await sumar(["horasDeMas"]); await ev(() => buscarInformes()); await w(900);
check("…y el informe solo trae sus fichajes (2, total 1:45)", (await filas()) === 2 && /1:45/.test(await pie()), await pie());
await page.selectOption("#informeTipo", "registros"); await w(500);
await page.selectOption("#iIrradiador", "Luis Mora"); await ev(() => buscarInformes()); await w(900);
check("Usuario normal en «registros»: también puede filtrar por irradiador", (await filas()) === 1);
check("Sin errores de JavaScript", errores.length === 0, errores.slice(0, 3).join(" | "));
await browser.close(); srv.close();
console.log(fallos ? `\n${fallos} comprobación(es) fallida(s)` : "\nTodas las comprobaciones correctas");
process.exit(fallos ? 1 : 0);
