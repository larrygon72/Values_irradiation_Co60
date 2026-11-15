// Detalle de dosímetros (lote, hoja, lectura) en Chromium: el modal desde el formulario, el
// "ditto" de lote/hoja hacia adelante, el resumen en el propio formulario, y su uso en Informes
// (campos nuevos y el sumatorio por lote/hoja) — vista previa, CSV y los dos PDF (normal y Anuario).
// Uso:  node --import ./tests/helpers/register.mjs tests/e2e/dosimetros.e2e.mjs
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
const srv = await startServer(RAIZ);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true });
await ctx.addInitScript(() => { window.showSaveFilePicker = undefined; });
const page = await ctx.newPage();
page.setDefaultTimeout(8000);
const errores = [];
page.on("pageerror", (e) => errores.push(e.message.slice(0, 200)));
const w = (ms) => page.waitForTimeout(ms);
const ev = (f, a) => page.evaluate(f, a);
const fila = (i) => `#dosItemsBox .dos-item:nth-child(${i})`;

await page.goto(srv.url); await w(500);
await page.locator("#swelcome button").first().click();
await page.fill("#luser", "Admin"); await page.click("#lbtn"); await page.waitForSelector("#lpassF", { state: "visible" });
await page.fill("#lpass", PASS); await page.click("#lbtn"); await w(700);

// ═════════ Formulario: abrir sin indicar cantidad ═════════
await ev(() => go("form")); await w(400);
await ev(() => { stab("irradia", document.querySelector('.step[data-step="irradia"]')); }); await w(200);
await page.click(".dos-detalle-btn"); await w(200);
check("Sin indicar cuántos dosímetros son, el modal no se abre (avisa)", !(await ev(() => document.getElementById("dosModal").classList.contains("on"))));

// ═════════ Rellenar: "ditto" hacia adelante, tope en el primero distinto, Leído independiente ═════════
await page.fill("#fDos", "6");
await page.click(".dos-detalle-btn"); await w(200);
check("Se abre con tantas filas como dosímetros (6)", (await ev(() => document.querySelectorAll("#dosItemsBox .dos-item").length)) === 6);
check("«Observaciones» trae el texto por defecto", (await page.inputValue("#dosObs")) === "Nada reseñable");

await page.fill(`${fila(1)} input[data-campo=lote]`, "L-09");
await page.fill(`${fila(1)} input[data-campo=hoja]`, "12");
let items = await ev(() => S.dosDetalle.items.map((it) => `${it.lote}/${it.hoja}`));
check("Lote y hoja de la fila 1 se copian a TODAS las siguientes (estaban vacías)", items.every((v) => v === "L-09/12"), items.join(" | "));

await page.fill(`${fila(4)} input[data-campo=hoja]`, "13");
items = await ev(() => S.dosDetalle.items.map((it) => it.hoja));
check("Cambiar la hoja en la fila 4 se copia a la 4-6, pero NO a la 1-3 (cambio a mitad de serie)", items.join(",") === "12,12,12,13,13,13", items.join(","));
check("…y el campo visible de la fila 6 también se actualiza solo (no hace falta repetirlo a mano)", (await page.inputValue(`${fila(6)} input[data-campo=hoja]`)) === "13");

await page.check(`${fila(2)} input[type=checkbox]`);
await page.check(`${fila(5)} input[type=checkbox]`);
const leidos = await ev(() => S.dosDetalle.items.map((it) => it.leido).join(","));
check("«Leído» es independiente por dosímetro (no se copia)", leidos === "false,true,false,false,true,false", leidos);

// «Marcar todos como leídos»: de golpe, y luego se puede desmarcar alguno suelto (estado intermedio)
const maestro = () => ev(() => ({ marcado: document.getElementById("dosLeidoTodos").checked, mezcla: document.getElementById("dosLeidoTodos").indeterminate }));
check("Con una mezcla de leídos y no leídos, la casilla general está en estado intermedio", (await maestro()).mezcla === true && (await maestro()).marcado === false);
await page.check("#dosLeidoTodos"); await w(100);
check("«Marcar todos como leídos» los marca TODOS de golpe", (await ev(() => S.dosDetalle.items.every((it) => it.leido))) && (await ev(() => [...document.querySelectorAll("#dosItemsBox input[type=checkbox]")].every((c) => c.checked))) && (await maestro()).marcado === true && (await maestro()).mezcla === false);
await page.uncheck(`${fila(3)} input[type=checkbox]`); await w(100);
check("…y se puede desmarcar uno suelto: solo ese queda sin leer y la general pasa a intermedia", (await ev(() => S.dosDetalle.items.map((it) => it.leido).join(","))) === "true,true,false,true,true,true" && (await maestro()).mezcla === true);
await page.check(`${fila(3)} input[type=checkbox]`); await w(100);
check("Al volver a marcar el último, la general vuelve a quedar marcada del todo", (await maestro()).marcado === true && (await maestro()).mezcla === false);
await page.uncheck("#dosLeidoTodos"); await w(100);
check("Desmarcar la general los deja TODOS sin leer", (await ev(() => S.dosDetalle.items.every((it) => !it.leido))) && (await maestro()).marcado === false && (await maestro()).mezcla === false);
await page.check(`${fila(2)} input[type=checkbox]`); await page.check(`${fila(5)} input[type=checkbox]`); await w(100);
check("Marcar sueltos de nuevo (2 y 5) deja el estado tal y como lo esperan las comprobaciones de abajo", (await ev(() => S.dosDetalle.items.map((it) => it.leido).join(","))) === "false,true,false,false,true,false");

await page.fill("#dosObs", "Dosímetro nº2 con humedad.");
await page.click("text=Hecho"); await w(200);
const resumen = await ev(() => document.getElementById("dosResumen").innerText);
check("El resumen del formulario refleja lo rellenado", resumen.includes("6") && resumen.includes("2 leídos") && resumen.includes("L-09") && /12.*13|13.*12/.test(resumen.replace(/\n/g, " ")), resumen.replace(/\n/g, " | "));

// ═════════ Guardar y comprobar lo que llega al servidor ═════════
await ev(() => { stab("urnas", document.querySelector('.step[data-step="urnas"]')); }); await w(200);
await page.fill("#fchIrr", "2026-03-02");
await ev(() => onFecha());
const antes = db.t("registros").length;
await ev(() => guardar()); await w(900);
check("El registro se guarda con el detalle completo", db.t("registros").length === antes + 1);
const guardado = db.t("registros")[db.t("registros").length - 1].dosimetros_detalle;
check("…con los 6 dosímetros, lotes y lectura correctos", guardado.items.length === 6 && guardado.items.filter((i) => i.leido).length === 2 && guardado.observaciones === "Dosímetro nº2 con humedad.", JSON.stringify(guardado));

// ═════════ Editar: el modal/resumen cargan lo ya guardado ═════════
await ev(() => go("hist")); await w(900);
const idGuardado = db.t("registros")[db.t("registros").length - 1].id;
await ev((id) => abrirDetalleRegistro(id), idGuardado); await w(300);
await ev(() => editarRegistroDesdeDetalle()); await w(400);
await ev(() => { stab("irradia", document.querySelector('.step[data-step="irradia"]')); }); await w(200);
const resumenEdicion = await ev(() => document.getElementById("dosResumen").innerText);
check("Al editar, el resumen ya muestra el detalle guardado sin tocar nada", resumenEdicion.includes("6") && resumenEdicion.includes("2 leídos"), resumenEdicion.replace(/\n/g, " | "));
await ev(() => limpiarForm());

// ═════════ La ficha del Historial muestra el detalle (no "desaparece" al entrar desde ahí) ═════════
await ev(() => go("hist")); await w(400);
await ev(() => { document.getElementById("hDesde").value = "2000-01-01"; document.getElementById("hHasta").value = "2100-12-31"; });
await ev(() => buscarHistorial()); await w(900);
await ev((id) => abrirDetalleRegistro(id), idGuardado); await w(300);
const ficha = await ev(() => document.getElementById("detBody").innerText);
check("La ficha del registro (Historial) muestra la sección de dosímetros con su lote, hoja y lectura", /lote, hoja y lectura/i.test(ficha) && /L-09/.test(ficha) && /Leído/.test(ficha) && /6 detallados/.test(ficha) && /2 leídos/.test(ficha), ficha.replace(/\n+/g, " | ").slice(ficha.search(/Dosímetros: lote/), ficha.search(/Dosímetros: lote/) + 160));
check("…y sus observaciones", /Dosímetro nº2 con humedad\./.test(ficha));
const filasFicha = await ev(() => document.querySelectorAll("#detBody .dtbl tbody tr").length);
check("Una fila por dosímetro en la ficha", filasFicha === 6, String(filasFicha));
// Un registro SIN detalle no enseña una sección vacía
db.tables.registros.push({ id: crypto.randomUUID(), created_at: new Date().toISOString(), fecha_irradiacion: "2026-03-05", semana_iso: 10, creado_por: "Admin", dosimetros: 2, dosimetros_detalle: null });
await ev(() => buscarHistorial()); await w(900);
await ev((id) => abrirDetalleRegistro(id), db.t("registros")[db.t("registros").length - 1].id); await w(300);
check("Un registro sin detalle de dosímetros no muestra la sección", !/lote, hoja y lectura/i.test(await ev(() => document.getElementById("detBody").innerText)));
await ev(() => cerrarDetalleRegistro()); await w(200);
// Exportaciones del Historial: columnas nuevas al final (las de siempre no se mueven)
const hdr = await ev(() => buildHistRows([S.histRaw.find((r) => r.id === S.detRegistro.id) || S.histRaw[0]]).header);
check("Las exportaciones del Historial ganan columnas de dosímetros al FINAL, sin mover las anteriores", hdr[hdr.length - 5] === "Calibración" && hdr[hdr.length - 4] === "Dosím. leídos" && hdr[hdr.length - 3] === "Lotes dosím." && hdr[hdr.length - 6] === "Observaciones", hdr.slice(-7).join(" | "));
const filaExp = await ev((id) => buildHistRows([S.histRaw.find((r) => r.id === id)]).rows[0], idGuardado);
check("…con los valores del registro (2 leídos, lote L-09, hojas 12 y 13)", filaExp[filaExp.length - 4] === 2 && filaExp[filaExp.length - 3] === "L-09" && /12, 13/.test(filaExp[filaExp.length - 2]), filaExp.slice(-5).join(" | "));

// ═════════ Cambiar el nº de dosímetros DESPUÉS de rellenar el detalle: lo guardado cuadra con el nº ═════════
await ev(() => go("form")); await w(400);
await ev(() => { stab("irradia", document.querySelector('.step[data-step="irradia"]')); }); await w(200);
await page.fill("#fDos", "4"); await page.click(".dos-detalle-btn"); await w(200);
await page.fill(`${fila(1)} input[data-campo=lote]`, "L-77"); await page.fill(`${fila(1)} input[data-campo=hoja]`, "5");
await page.click("text=Hecho"); await w(200);
await page.fill("#fDos", "2"); // menos dosímetros que filas de detalle
await ev(() => { stab("urnas", document.querySelector('.step[data-step="urnas"]')); }); await w(200);
await page.fill("#fchIrr", "2026-03-09"); await ev(() => onFecha());
await ev(() => guardar()); await w(900);
const recortado = db.t("registros").find((r) => r.fecha_irradiacion === "2026-03-09");
check("Si se baja el nº de dosímetros tras rellenar el detalle, se guarda recortado a ese nº", recortado && recortado.dosimetros === 2 && recortado.dosimetros_detalle.items.length === 2 && recortado.dosimetros_detalle.items[0].lote === "L-77", JSON.stringify(recortado?.dosimetros_detalle?.items));
await ev(() => go("form")); await w(300);
await ev(() => { stab("irradia", document.querySelector('.step[data-step="irradia"]')); }); await w(200);
await page.fill("#fDos", "2"); await page.click(".dos-detalle-btn"); await w(200);
await page.fill(`${fila(2)} input[data-campo=lote]`, "L-88"); await page.fill(`${fila(2)} input[data-campo=hoja]`, "6");
await page.click("text=Hecho"); await w(200);
await page.fill("#fDos", "4"); // más dosímetros que filas de detalle
await ev(() => { stab("urnas", document.querySelector('.step[data-step="urnas"]')); }); await w(200);
await page.fill("#fchIrr", "2026-03-10"); await ev(() => onFecha());
await ev(() => guardar()); await w(900);
const ampliado = db.t("registros").find((r) => r.fecha_irradiacion === "2026-03-10");
check("Si se sube el nº de dosímetros, el detalle se completa copiando lote/hoja del último y sin marcar como leídos", ampliado && ampliado.dosimetros_detalle.items.length === 4 && ampliado.dosimetros_detalle.items[3].lote === "L-88" && ampliado.dosimetros_detalle.items[3].hoja === "6" && ampliado.dosimetros_detalle.items[3].leido === false, JSON.stringify(ampliado?.dosimetros_detalle?.items));

// ═════════ Más datos para probar Informes (varios registros, con y sin detalle) ═════════
const AHORA = new Date().toISOString();
const reg = (fecha, items, obs) => ({ id: crypto.randomUUID(), created_at: AHORA, fecha_irradiacion: fecha, semana_iso: 10, creado_por: "ana", conductor_nick: "ana", conductor_nombre: "Ana", n_urnas: 2, dosimetros: items.length, dosimetros_detalle: items.length ? { observaciones: obs || "Nada reseñable", items } : null });
db.tables.registros = [
  reg("2026-04-02", [{ lote: "L-20", hoja: "1", leido: true }, { lote: "L-20", hoja: "1", leido: false }]),
  reg("2026-04-04", [{ lote: "L-20", hoja: "2", leido: true }, { lote: "L-21", hoja: "2", leido: true }, { lote: "L-21", hoja: "3", leido: false }]),
  reg("2026-04-06", []),
];

// ═════════ Informes: campos nuevos, vista previa con el sumatorio ═════════
await ev(() => go("informes")); await w(500);
await ev(() => { document.getElementById("iDesde").value = "2000-01-01"; document.getElementById("iHasta").value = "2100-12-31"; });
const camposDos = await ev(() => [...document.querySelectorAll(".campoInformeChk")].map((c) => c.value));
check("Los campos nuevos de dosímetros están en el selector de Registros", ["dosLeidos", "dosLotes", "dosHojas", "dosObsCampo"].every((id) => camposDos.includes(id)));
await ev(() => buscarInformes()); await w(900);
check("El bloque de totales por lote/hoja aparece en la vista previa", (await ev(() => getComputedStyle(document.getElementById("vistaPreviaDosimetros")).display)) === "block");
const textoPreview = await ev(() => document.getElementById("vistaPreviaDosimetros").innerText);
check("…con las cantidades correctas por lote (L-20: 3, L-21: 2) y por hoja (1:2, 2:2, 3:1)", /L-20[\s\S]*3/.test(textoPreview) && /L-21[\s\S]*2/.test(textoPreview) && /\b1\b[\s\S]*2/.test(textoPreview), textoPreview.replace(/\n/g, " | "));

// ═════════ CSV: lleva el mismo sumatorio al final ═════════
const d1 = page.waitForEvent("download");
await ev(() => exportInformeCSV());
const csv = fs.readFileSync(await (await d1).path(), "utf8");
check("El CSV incluye «Total de dosímetros por lote» y «…por hoja»", csv.includes("Total de dos\u00edmetros por lote") && csv.includes("Total de dos\u00edmetros por hoja") && csv.includes('"L-20","3"') && csv.includes('"L-21","2"'));
await ev(() => { const o = document.getElementById("scov"); if (o) o.classList.remove("on"); });

// ═════════ PDF normal: tablas de totales al final ═════════
const d2 = page.waitForEvent("download");
await ev(() => exportInformePDF());
const pdfPath = "/tmp/dos_registros_check.pdf";
fs.copyFileSync(await (await d2).path(), pdfPath);
const textoPdf = execFileSync("pdftotext", ["-layout", pdfPath, "-"], { encoding: "utf8" });
check("El PDF normal también lleva las dos tablas de totales", textoPdf.includes("Total de dos\u00edmetros por lote") && textoPdf.includes("Total de dos\u00edmetros por hoja") && /L-20\s+3/.test(textoPdf) && /L-21\s+2/.test(textoPdf), textoPdf.split("\n").filter((l) => /^(L-2|Hoja|Lote|\d)/.test(l.trim())).join(" | "));
await ev(() => { const o = document.getElementById("scov"); if (o) o.classList.remove("on"); });

// ═════════ Anuario: bloque "DOSÍMETROS" por ficha + totales antes de la firma ═════════
await page.selectOption("#informeTipo", "anuario"); await w(500);
await ev(() => { document.getElementById("iDesde").value = "2000-01-01"; document.getElementById("iHasta").value = "2100-12-31"; });
await ev((ids) => {
  document.querySelectorAll(".campoInformeChk").forEach((c) => { c.checked = ids.includes(c.value); });
  actualizarResumenCampos();
}, ["fecha", "conductor", "dosLeidos", "dosLotes", "dosHojas"]);
await ev(() => buscarInformes()); await w(900);
const d3 = page.waitForEvent("download");
await ev(() => exportInformePDF());
const pdfPathAnuario = "/tmp/dos_anuario_check.pdf";
fs.copyFileSync(await (await d3).path(), pdfPathAnuario);
const textoAnuario = execFileSync("pdftotext", ["-layout", pdfPathAnuario, "-"], { encoding: "utf8" });
check("Cada ficha del Anuario lleva su propio bloque «DOSÍMETROS»", textoAnuario.includes("DOS\u00cdMETROS"));
check("El Anuario también lleva el sumatorio por lote y por hoja, antes de la firma", textoAnuario.includes("Total de dos\u00edmetros por lote") && textoAnuario.includes("Total de dos\u00edmetros por hoja") && textoAnuario.indexOf("Total de dos\u00edmetros") < textoAnuario.indexOf("Fdo.:"));

// ═════════ Sin ningún detalle en el periodo: el bloque no aparece (ni vacío) ═════════
db.tables.registros = [{ id: crypto.randomUUID(), created_at: AHORA, fecha_irradiacion: "2026-05-01", semana_iso: 18, creado_por: "ana", conductor_nick: "ana", conductor_nombre: "Ana", n_urnas: 1, dosimetros: 0, dosimetros_detalle: null }];
await page.selectOption("#informeTipo", "registros"); await w(500);
await ev(() => buscarInformes()); await w(900);
check("Sin detalle de dosímetros en el periodo, el bloque de totales se queda oculto", (await ev(() => getComputedStyle(document.getElementById("vistaPreviaDosimetros")).display)) === "none");

check("Sin errores de JavaScript en todo el recorrido", errores.length === 0, errores.slice(0, 3).join(" | "));
await browser.close(); srv.close();
console.log(fallos ? `\n${fallos} comprobación(es) fallida(s)` : "\nTodas las comprobaciones correctas");
process.exit(fallos ? 1 : 0);
