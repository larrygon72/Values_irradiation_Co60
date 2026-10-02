// Informe "Anuario" (diseño profesional para dirección, en formato ficha por registro) en
// Chromium: año completo por defecto, exportación solo en PDF, filtros compartidos con
// "Registros", y contenido real del PDF generado (se lee con pdftotext, el mismo binario que usa
// el propio sistema, para comprobar el texto tal cual queda en el archivo — no solo lo que hace
// el navegador antes de descargarlo).
// Uso:  node --import ./tests/helpers/register.mjs tests/e2e/anuario.e2e.mjs
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
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
const anio = new Date().getFullYear();
const AHORA = new Date().toISOString();
const irr = { id: crypto.randomUUID(), nombre: "Pepe", apellido1: "Gil", apellido2: "", codigo: "PGX", activo: true };
db.tables.irradiadores = [irr];
db.tables.registros = [
  { id: crypto.randomUUID(), created_at: AHORA, fecha_irradiacion: `${anio}-01-10`, semana_iso: 2, creado_por: "ana", conductor_nick: "ana", conductor_nombre: "Ana López", conductor_codigo: "ALX", irradiador_nombre: "Pepe Gil", irradiador_codigo: "PGX", n_urnas: 3, tiempo_exposicion: 900, h_inicio_irr: "08:00", h_fin_irr: "08:20", exposicion_usv: 1.5, dosimetros: 2, tasa: 0.00027 },
  { id: crypto.randomUUID(), created_at: AHORA, fecha_irradiacion: `${anio}-06-15`, semana_iso: 24, creado_por: "bob", conductor_nick: "bob", conductor_nombre: "Bob Ruiz", conductor_codigo: "BRX", irradiador_nombre: "Pepe Gil", irradiador_codigo: "PGX", n_urnas: 5, tiempo_exposicion: 1200, h_inicio_irr: "09:00", h_fin_irr: "09:40", exposicion_usv: 2.1, dosimetros: 1, tasa: 0.00027 },
  { id: crypto.randomUUID(), created_at: AHORA, fecha_irradiacion: `${anio - 1}-12-20`, semana_iso: 51, creado_por: "ana", conductor_nick: "ana", conductor_nombre: "Ana López", conductor_codigo: "ALX", irradiador_nombre: "Pepe Gil", irradiador_codigo: "PGX", n_urnas: 9, tiempo_exposicion: 500, h_inicio_irr: "08:00", h_fin_irr: "08:10", exposicion_usv: 0.9, dosimetros: 1, tasa: 0.00027 }, // año anterior: no debe salir
];
db.tables.usuarios.push({ ...db.tables.usuarios[1], id: "u-bob", nick: "bob", nombre: "bob", codigo: "BPX" });

const srv = await startServer(RAIZ);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
await ctx.addInitScript(() => { window.showSaveFilePicker = undefined; });
const page = await ctx.newPage();
page.setDefaultTimeout(8000);
const errores = [];
const peticiones = [];
page.on("pageerror", (e) => errores.push(e.message.slice(0, 200)));
page.on("request", (r) => { const u = r.url(); if (u.includes("/img/")) peticiones.push(u.split("/img/")[1]); });
const w = (ms) => page.waitForTimeout(ms);
const ev = (f, a) => page.evaluate(f, a);

await page.goto(srv.url); await w(500);
await page.locator("#swelcome button").first().click();
await page.fill("#luser", "Admin"); await page.click("#lbtn"); await page.waitForSelector("#lpassF", { state: "visible" });
await page.fill("#lpass", PASS); await page.click("#lbtn"); await w(700);

await ev(() => go("informes")); await w(500);
const opciones = await ev(() => [...document.getElementById("informeTipo").options].map((o) => o.value));
check("El selector de Informes tiene un único «anuario» (sin variantes)", opciones.filter((o) => o.toLowerCase().startsWith("anuario")).length === 1 && opciones.includes("anuario"), opciones.join(","));

await page.selectOption("#informeTipo", "anuario"); await w(500);
const periodo = await ev(() => [document.getElementById("iDesde").value, document.getElementById("iHasta").value]);
check("Al elegir Anuario, el periodo se fija al año completo actual", periodo[0] === `${anio}-01-01` && periodo[1] === `${anio}-12-31`, periodo.join(" – "));
check("El botón CSV se oculta (el anuario solo se exporta en PDF)", (await ev(() => getComputedStyle(document.getElementById("btnInformeCSV")).display)) === "none");
check("El botón PDF sigue visible", (await ev(() => getComputedStyle(document.querySelector('[onclick="exportInformePDF()"]')).display)) !== "none");

const nCamposAnuario = await ev(() => document.querySelectorAll(".campoInformeChk").length);
await page.selectOption("#informeTipo", "registros"); await w(300);
const nCamposRegistros = await ev(() => document.querySelectorAll(".campoInformeChk").length);
await page.selectOption("#informeTipo", "anuario"); await w(300);
check("Usa el mismo catálogo de campos que «Registros» (mismo bloque de irradiación)", nCamposAnuario === nCamposRegistros && nCamposAnuario > 0, `${nCamposAnuario} vs ${nCamposRegistros}`);
check("Los filtros de Registros (conductor/usuario/irradiador) siguen disponibles", (await ev(() => document.getElementById("iFiltrosRegistros").style.display)) === "flex");

// Selección de campos "de verdad" (pocos, como en un anuario)
const LEAN = ["fecha", "conductor", "irradiador", "nUrnas", "duracionIrr", "expUsv"];
await ev((ids) => {
  document.querySelectorAll(".campoInformeChk").forEach((c) => { c.checked = ids.includes(c.value); });
  actualizarResumenCampos();
}, LEAN);
await ev(() => buscarInformes()); await w(900);
check("Solo trae los registros del año en curso (2 de 3 — el del año anterior queda fuera)", (await ev(() => S.informesRaw.length)) === 2, String(await ev(() => S.informesRaw.length)));

await page.selectOption("#iConductor", "ana"); await w(300);
const infoConductor = await ev(() => ({ n: S.informesRaw.length, nota: document.getElementById("informesNote").textContent }));
check("El filtro por conductor funciona igual que en «Registros»", infoConductor.n === 1 && /Conductor: /.test(infoConductor.nota), JSON.stringify(infoConductor));
await ev(() => limpiarFiltrosInforme()); await w(300);

// ── Genera el PDF y comprueba su contenido REAL con pdftotext ──
peticiones.length = 0; // solo interesan las imágenes pedidas AL EXPORTAR (antes puede haberse visto mosquito_logo_team.png en otras pantallas)
const descarga = page.waitForEvent("download");
await ev(() => exportInformePDF());
const dl = await descarga;
const pdfPath = "/tmp/anuario_check.pdf";
fs.copyFileSync(await dl.path(), pdfPath);
check("El nombre del archivo es el del anuario", dl.suggestedFilename().startsWith("informe_anuario_"), dl.suggestedFilename());
check("La imagen usada es logo_tie_mosquito.png (no mosquito_logo_team.png)", peticiones.includes("logo_tie_mosquito.png") && !peticiones.includes("mosquito_logo_team.png"), peticiones.join(","));
check("También se carga el logo de GrupoTragsa", peticiones.includes("grupo-tragsa-logo.png"));

const texto = execFileSync("pdftotext", ["-layout", pdfPath, "-"], { encoding: "utf8" });
check("Cabecera: título con el nº de obra (ya no «Proyecto piloto»)", texto.includes("TRAGSA-Obra: 0734346 TIE Aedes albopictus") && !texto.includes("Proyecto piloto"));
check("Cabecera: subtítulo", texto.includes("Sexado, dosificación, transporte e irradiación"));
check("Cabecera: periodo y nº de registros", /Periodo:\s*01\/01\/\d{4}\s*–\s*31\/12\/\d{4}/.test(texto) && /Registros:\s*2/.test(texto));
check("Ya NO aparece el rótulo «Informe anuario» en ningún sitio del PDF", !texto.includes("Informe anuario"));
check("Cada tarjeta lleva solo su fecha, sin la palabra «Registro»", (texto.includes("10/01/") || texto.includes(`10/01/${anio}`)) && !/Registro\s+\d/.test(texto), texto.split("\n").find((l) => /\d{2}\/\d{2}\/\d{4}/.test(l)));
check("Las tarjetas salen en orden cronológico: enero antes que junio", texto.indexOf(`10/01/${anio}`) !== -1 && texto.indexOf(`10/01/${anio}`) < texto.indexOf(`15/06/${anio}`));
check("Barras de bloque por tarjeta: IDENTIFICACIÓN / TRANSPORTE / IRRADIACIÓN", texto.includes("IDENTIFICACIÓN") && texto.includes("TRANSPORTE") && texto.includes("IRRADIACIÓN"));
check("El símbolo µ se sustituye por una «u» segura para PDF (evita el hueco en blanco de algunos lectores)", texto.includes("(uSv)") && !texto.includes("µ"));
check("Firma para dirección al final del informe", texto.includes("Fdo.:") && texto.includes("Dirección"));
check("El PDF no queda limitado al conductor filtrado antes (Ana): Bob también aparece", texto.includes("Bob Ruiz"));

const pageCount = execFileSync("pdfinfo", [pdfPath], { encoding: "utf8" }).match(/Pages:\s*(\d+)/)[1];
check("El PDF tiene páginas", Number(pageCount) >= 1, pageCount);

// ── Orientación del PDF (vertical por defecto en el anuario; se puede cambiar a horizontal) ──
const clasesDefecto = await ev(() => [document.getElementById("btnOrientVertical").className, document.getElementById("btnOrientHorizontal").className]);
check("Anuario: «Vertical» viene activo por defecto", /\bbp\b/.test(clasesDefecto[0]) && /\bbo\b/.test(clasesDefecto[1]), clasesDefecto.join(" | "));
const tamanoPdf = (ruta) => execFileSync("pdfinfo", [ruta], { encoding: "utf8" }).match(/Page size:\s*([\d.]+) x ([\d.]+)/).slice(1, 3).map(Number);
const [wV, hV] = tamanoPdf(pdfPath);
check("El PDF por defecto sale en vertical (más alto que ancho)", hV > wV, `${wV} x ${hV}`);

await ev(() => { const o = document.getElementById("scov"); if (o) o.classList.remove("on"); });
await page.click("#btnOrientHorizontal"); await w(200);
const clasesTrasElegir = await ev(() => [document.getElementById("btnOrientVertical").className, document.getElementById("btnOrientHorizontal").className]);
check("…y cambia de botón activo al elegir Horizontal", /\bbo\b/.test(clasesTrasElegir[0]) && /\bbp\b/.test(clasesTrasElegir[1]), clasesTrasElegir.join(" | "));
const descargaH = page.waitForEvent("download");
await ev(() => exportInformePDF());
const pdfPathH = "/tmp/anuario_check_h.pdf";
fs.copyFileSync(await (await descargaH).path(), pdfPathH);
const [wH, hH] = tamanoPdf(pdfPathH);
check("…y el PDF sale en horizontal (más ancho que alto)", wH > hH, `${wH} x ${hH}`);

await ev(() => { const o = document.getElementById("scov"); if (o) o.classList.remove("on"); });
await page.selectOption("#informeTipo", "registros"); await w(400);
const clasesRegistros = await ev(() => [document.getElementById("btnOrientVertical").className, document.getElementById("btnOrientHorizontal").className]);
check("«Registros» por defecto viene en Horizontal (cambia de tipo, cambia el defecto)", /\bbo\b/.test(clasesRegistros[0]) && /\bbp\b/.test(clasesRegistros[1]), clasesRegistros.join(" | "));
await page.selectOption("#informeTipo", "anuario"); await w(400);
const clasesVuelta = await ev(() => [document.getElementById("btnOrientVertical").className, document.getElementById("btnOrientHorizontal").className]);
check("Al volver a Anuario, la elección anterior se olvida y vuelve a Vertical", /\bbp\b/.test(clasesVuelta[0]) && /\bbo\b/.test(clasesVuelta[1]), clasesVuelta.join(" | "));

check("Sin errores de JavaScript", errores.length === 0, errores.slice(0, 3).join(" | "));
await browser.close(); srv.close();
console.log(fallos ? `\n${fallos} comprobación(es) fallida(s)` : "\nTodas las comprobaciones correctas");
process.exit(fallos ? 1 : 0);
