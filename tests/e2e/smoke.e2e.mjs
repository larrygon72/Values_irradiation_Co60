// Recorrido completo por la interfaz (Chromium): todas las pantallas y los flujos principales.
// Uso:  node --import ./tests/helpers/register.mjs tests/e2e/smoke.e2e.mjs
import path from "node:path";
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
const srv = await startServer(RAIZ);
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })).newPage();
page.setDefaultTimeout(6000);
const errores = [];
page.on("pageerror", (e) => errores.push(e.message.slice(0, 200)));
const w = (ms) => page.waitForTimeout(ms);
const ev = (f, a) => page.evaluate(f, a);

await page.goto(srv.url); await w(400);
await page.locator("#swelcome button").first().click();
await page.fill("#luser", "Admin"); await page.click("#lbtn"); await page.waitForSelector("#lpassF", { state: "visible" });
await page.fill("#lpass", PASS); await page.click("#lbtn"); await w(700);
await page.locator("#swelcome2 button").click(); await w(500);

const pantallas = ["menu", "form", "records", "hist", "multidosis", "today", "month", "weekly", "informes", "users", "irradiadores", "vehiculos", "estaciones", "conduccion", "fichaje", "settings"];
for (const p of pantallas) {
  await ev((id) => go(id), p); await w(350);
  const activa = await ev(() => document.querySelector(".sc.on")?.id);
  check(`Pantalla «${p}» se muestra`, activa === "s" + p, activa);
}

// ── Administración: usuarios ──
await ev(() => go("users")); await w(500);
check("Usuarios: lista con Admin y ana", /Admin/.test(await ev(() => document.getElementById("usrList").innerText)) && /ana/.test(await ev(() => document.getElementById("usrList").innerText)));
await page.fill("#nusr", "carlos.r"); await page.fill("#nnombre", "Carlos"); await page.fill("#nap1", "Ruiz"); await page.fill("#npass", "corta");
await ev(() => addUsr()); await w(300);
check("Crear usuario con contraseña corta: no se crea", !db.t("usuarios").some((u) => u.nick === "carlos.r"));
await page.fill("#npass", "Clave-Carlos-77"); await ev(() => addUsr()); await w(700);
const carlos = db.t("usuarios").find((u) => u.nick === "carlos.r");
check("Crear usuario desde la interfaz", !!carlos && carlos.codigo === "CRX", carlos?.codigo);
await ev(() => editarUsrInicio("carlos.r")); await w(500);
await page.fill("#eu_nombre", "Carlos Alberto"); await ev(() => editarUsrGuardar("carlos.r")); await w(700);
check("Editar usuario", db.t("usuarios").find((u) => u.nick === "carlos.r").nombre === "Carlos Alberto");
await ev(() => { delUsr("carlos.r"); }); await w(300);
await page.click("#confirmOkBtn"); await w(700);
check("Eliminar usuario (con confirmación)", !db.t("usuarios").some((u) => u.nick === "carlos.r"));

// ── Catálogos ──
await ev(() => go("vehiculos")); await w(300);
await page.fill("#vehMatricula", "1234 abc"); await page.fill("#vehObra", "OB-9"); await ev(() => addVehiculo()); await w(700);
check("Crear vehículo (matrícula normalizada)", db.t("vehiculos")[0]?.matricula === "1234 ABC");
await ev(() => go("estaciones")); await w(300);
await page.fill("#estNombre", "Repsol Norte"); await ev(() => addEstacion()); await w(700);
check("Crear estación", db.t("estaciones_servicio")[0]?.nombre === "Repsol Norte");
await ev(() => go("irradiadores")); await w(300);
await page.fill("#irrNombre", "Pepe"); await page.fill("#irrAp1", "Gil"); await ev(() => addIrradiador()); await w(700);
check("Crear irradiador", db.t("irradiadores")[0]?.codigo === "PGX");

// ── Conducción ──
await ev(() => go("conduccion")); await w(900);
const vid = db.t("vehiculos")[0].id;
await page.selectOption("#vMatricula", vid); await w(500);
await page.fill("#vKmIni", "100"); await page.fill("#vKmFin", "90"); await ev(() => guardarViaje()); await w(300);
check("Viaje con km final menor que el inicial: rechazado", db.t("vehiculo_viajes").length === 0);
await page.fill("#vKmFin", "150"); await ev(() => guardarViaje()); await w(700);
check("Viaje guardado", db.t("vehiculo_viajes").length === 1 && db.t("vehiculo_viajes")[0].km_recorridos === 50);
check("La lista de viajes se muestra", /1234 ABC/.test(await ev(() => document.body.innerText)));

// ── Fichaje ──
await ev(() => go("fichaje")); await w(800);
await ev(() => ficharEntrada()); await w(900);
check("Fichar entrada", db.t("fichajes").length === 1 && !!db.t("fichajes")[0].hora_entrada);
await ev(() => { ficharEntrada(); ficharEntrada(); }); await w(700);
check("Doble toque: sigue habiendo un solo fichaje", db.t("fichajes").length === 1);
await ev(() => ficharSalida()); await w(900);
check("Fichar salida y calcular horas de más", !!db.t("fichajes")[0].hora_salida && db.t("fichajes")[0].horas_de_mas !== undefined);

// ── Historial y detalle ──
await ev(() => go("hist")); await w(900);
const filas = await ev(() => document.querySelectorAll("#histTableBody tr[onclick], #histList .ritem").length);
check("Historial lista los registros", filas >= 1, String(filas));
await ev(() => { const r = document.querySelector("#histTableBody tr[onclick], #histList .ritem"); r && r.click(); }); await w(400);
check("Se abre el detalle del registro", await ev(() => document.getElementById("detOv").classList.contains("on")));
await page.keyboard.press("Escape"); await w(200);
check("Escape cierra el detalle", !(await ev(() => document.getElementById("detOv").classList.contains("on"))));

// ── Informes ──
await ev(() => go("informes")); await w(400);
await ev(() => buscarInformes()); await w(900);
check("Informes: vista previa con datos", (await ev(() => document.getElementById("informesNote").textContent)).includes("registro"));

// ── Formulario completo ──
await ev(() => go("form")); await w(500);
await page.fill("#fchIrr", new Date().toISOString().slice(0, 10)); await ev(() => onFecha());
await ev(() => { document.getElementById("fTi").value = "22"; document.getElementById("fTf").value = "23"; });
const n0 = db.t("registros").length;
await ev(() => guardar()); await w(900);
check("Guardar un registro completo desde el formulario", db.t("registros").length === n0 + 1);
check("Sin errores de JavaScript en todo el recorrido", errores.length === 0, errores.slice(0, 3).join(" | "));
await browser.close(); srv.close();
console.log(fallos ? `\n${fallos} comprobación(es) fallida(s)` : "\nTodas las comprobaciones correctas");
process.exit(fallos ? 1 : 0);
