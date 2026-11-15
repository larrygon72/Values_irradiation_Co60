// Calibraciones (varios aparatos de irradiación) en Chromium: el aparato de fábrica sigue dando EXACTAMENTE
// los mismos números de siempre, se pueden dar de alta otros (tasa en Gy/h -> Gy/s), cambiar de uno a otro y
// volver al original, y — lo más delicado — un registro ya guardado NO cambia sus números en silencio
// aunque después se cambie el aparato activo.
// Uso:  node --import ./tests/helpers/register.mjs tests/e2e/calibraciones.e2e.mjs
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
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(8000);
const errores = [];
page.on("pageerror", (e) => errores.push(e.message.slice(0, 200)));
const w = (ms) => page.waitForTimeout(ms);
const ev = (f, a) => page.evaluate(f, a);
async function entrar(nick) {
  await ev(() => { lReset(); go("sl"); }); await page.fill("#luser", nick); await page.click("#lbtn");
  await page.waitForSelector("#lpassF", { state: "visible" }); await page.fill("#lpass", PASS); await page.click("#lbtn"); await w(800);
}
// Las acciones abren un diálogo de confirmación y esperan a que se pulse: hay que lanzarlas SIN esperar su
// resultado (si no, evaluate se queda esperando para siempre a que alguien pulse «Aceptar»).
const confirmar = async (accion) => { await page.evaluate(`(() => { ${accion}; })()`); await w(250); await page.click("#confirmOkBtn"); await w(800); };

await page.goto(srv.url); await w(500);
await page.locator("#swelcome button").first().click();
await entrar("Admin");

// ═════════ El aparato de fábrica NO cambia nada de lo de siempre ═════════
const FECHAS = [new Date(2024, 9, 16), new Date(2025, 5, 1), new Date(2026, 2, 4), new Date(2027, 0, 15), new Date(2030, 11, 31)];
const identico = await ev((fechas) => fechas.every((f) => {
  const d = new Date(f);
  const antes = 0.27621757 * Math.exp(-LAM * (d - new Date(2024, 9, 16)) / msDay); // la fórmula exacta de antes (REF y RR fijos)
  return rate(d) === antes && tExp(70, d) === 70 / antes;
}), FECHAS.map((f) => f.toISOString()));
check("Con el aparato de fábrica activo, rate() y tExp() dan EXACTAMENTE lo mismo que antes (bit a bit, 5 fechas)", identico);
check("Por defecto el aparato activo es el de fábrica", (await ev(() => calibracionActiva().original)) === true);

// ═════════ Pantalla de administración ═════════
await ev(() => go("calibraciones")); await w(600);
let lista = await ev(() => document.getElementById("calList").innerText);
check("La pantalla lista el aparato de fábrica, marcado «en uso» y con su tasa en Gy/h", /fábrica/.test(lista) && /en uso/.test(lista) && /994,38/.test(lista), lista.replace(/\n/g, " | ").slice(0, 160));
check("El aparato de fábrica no tiene botones de editar ni eliminar", !/Editar|Eliminar/.test(lista));

await page.fill("#calTasa", "720");
check("Al escribir la tasa en Gy/h se ve ya su equivalente en Gy/s", /0,2 Gy\/s/.test(await ev(() => document.getElementById("calConversion").textContent)), await ev(() => document.getElementById("calConversion").textContent));
await page.fill("#calNombre", "Aparato B"); await page.fill("#calFecha", "2027-01-15");
await ev(() => addCalibracion()); await w(800);
check("Se da de alta el aparato B (y no se activa solo)", db.t("calibraciones_irradiacion").length === 1 && db.t("calibraciones_irradiacion")[0].tasa_gy_h === 720 && !db.t("calibraciones_irradiacion")[0].activa);
check("Los campos del alta se vacían tras añadir", (await page.inputValue("#calNombre")) === "" && (await page.inputValue("#calTasa")) === "");
await ev(() => addCalibracion()); await w(200);
check("Sin rellenar nada no se crea otro", db.t("calibraciones_irradiacion").length === 1);
check("El aparato de fábrica sigue siendo el que está en uso", (await ev(() => calibracionActiva().original)) === true);

// ═════════ Cambiar de aparato ═════════
const idB = db.t("calibraciones_irradiacion")[0].id;
await confirmar(`activarCalibracion("${idB}")`);
check("Activar B: queda marcado en el servidor y la app calcula ya con él", db.t("calibraciones_irradiacion")[0].activa === true && (await ev(() => calibracionActiva().nombre)) === "Aparato B");
const tasaB = await ev(() => rate(new Date(2027, 0, 15)));
check("720 Gy/h = 0,2 Gy/s en su fecha de referencia (conversión correcta)", Math.abs(tasaB - 0.2) < 1e-12, String(tasaB));
const decaimiento = await ev(() => { const d = new Date(2027, 0, 15 + 365); return [rate(d), 0.2 * Math.exp(-LAM * (d - new Date(2027, 0, 15)) / msDay)]; });
check("Con el tiempo decae con la misma ley del Co-60 que antes", Math.abs(decaimiento[0] - decaimiento[1]) < 1e-15, decaimiento.join(" vs "));
lista = await ev(() => document.getElementById("calList").innerText);
check("La lista ahora marca B «en uso» y ofrece «Volver a usar» el original", /Aparato B[\s\S]*en uso/.test(lista) && /Volver a usar este/.test(lista));
check("La calibración activa se ve en Ajustes", (await (async () => { await ev(() => go("settings")); await w(300); return ev(() => document.getElementById("ajCalibracionActiva").textContent); })()).includes("Aparato B"));

// ═════════ Un registro nuevo se calcula con B y lo anota ═════════
await ev(() => go("form")); await w(500);
await ev(() => { stab("urnas", document.querySelector('.step[data-step="urnas"]')); }); await w(200);
await page.fill("#fchIrr", "2027-01-15"); await ev(() => onFecha()); await w(300);
check("En el formulario, la tasa sale con el aparato B (0,2 Gy/s) y lo indica debajo", (await page.inputValue("#tasa")) === "0.20000000" && /Aparato B/.test(await ev(() => document.getElementById("tasaCalibHint").textContent)), await ev(() => document.getElementById("tasaCalibHint").textContent));
const n0 = db.t("registros").length;
await ev(() => guardar()); await w(900);
const regB = db.t("registros")[n0];
check("El registro guardado lleva la calibración usada y su tasa", regB && regB.calibracion_nombre === "Aparato B" && Math.abs(regB.tasa - 0.2) < 1e-9, regB && `${regB.calibracion_nombre} / ${regB.tasa}`);

// ═════════ Volver al aparato original ═════════
await ev(() => go("calibraciones")); await w(500);
await confirmar("activarCalibracionOriginal()");
check("Volver al original: ninguna activa en el servidor y la app vuelve a los valores de fábrica", db.t("calibraciones_irradiacion").every((c) => !c.activa) && (await ev(() => calibracionActiva().original)) === true);
check("…y los números vuelven a ser exactamente los de siempre", await ev(() => rate(new Date(2024, 9, 16)) === 0.27621757));

await ev(() => go("form")); await w(400);
await ev(() => { stab("urnas", document.querySelector('.step[data-step="urnas"]')); }); await w(200);
await page.fill("#fchIrr", "2024-10-16"); await ev(() => onFecha()); await w(300);
check("Un registro nuevo vuelve a calcularse con la tasa original", (await page.inputValue("#tasa")) === "0.27621757");
const n1 = db.t("registros").length;
await ev(() => guardar()); await w(900);
check("…y se anota como del aparato de fábrica (calibración vacía)", db.t("registros")[n1].calibracion_nombre === null && Math.abs(db.t("registros")[n1].tasa - 0.27621757) < 1e-9);

// ═════════ LO DELICADO: editar un registro antiguo no cambia sus números en silencio ═════════
await ev(() => go("hist")); await w(400);
await ev(() => { document.getElementById("hDesde").value = "2000-01-01"; document.getElementById("hHasta").value = "2100-12-31"; });
await ev(() => buscarHistorial()); await w(900);
await ev((id) => abrirDetalleRegistro(id), regB.id); await w(300);
const detalle = await ev(() => document.getElementById("detBody").innerText);
check("La ficha del registro muestra con qué aparato se calculó", /Aparato B/.test(detalle));
await ev(() => editarRegistroDesdeDetalle()); await w(500);
await ev(() => { stab("urnas", document.querySelector('.step[data-step="urnas"]')); }); await w(200);
const texpGuardado = regB.tiempo_exposicion;
check("Al editarlo (con el aparato ORIGINAL activo) la tasa sigue siendo la que tenía (0,2), no la del activo", (await page.inputValue("#tasa")) === "0.20000000", await page.inputValue("#tasa"));
check("…y el formulario avisa de con qué aparato está calculado y cuál es el activo ahora", /Calculado con «Aparato B»/.test(await ev(() => document.getElementById("tasaCalibHint").textContent)) && /original/i.test(await ev(() => document.getElementById("tasaCalibHint").textContent)), await ev(() => document.getElementById("tasaCalibHint").textContent));
await ev(() => guardar()); await w(900);
const trasEditar = db.t("registros").find((r) => r.id === regB.id);
check("Guardar la edición sin tocar la fecha conserva la calibración y la tasa originales", trasEditar.calibracion_nombre === "Aparato B" && Math.abs(trasEditar.tasa - 0.2) < 1e-9 && trasEditar.tiempo_exposicion === texpGuardado, `${trasEditar.calibracion_nombre} / ${trasEditar.tasa} / ${trasEditar.tiempo_exposicion} (antes ${texpGuardado})`);

await ev(() => { go("hist"); }); await w(300);
await ev(() => buscarHistorial()); await w(900);
await ev((id) => abrirDetalleRegistro(id), regB.id); await w(300);
await ev(() => editarRegistroDesdeDetalle()); await w(500);
await ev(() => { stab("urnas", document.querySelector('.step[data-step="urnas"]')); }); await w(200);
await page.fill("#fchIrr", "2024-10-16"); await ev(() => onFecha()); await w(300);
check("Si al editar se CAMBIA la fecha, ahí sí se recalcula con el aparato activo (el original)", (await page.inputValue("#tasa")) === "0.27621757" && !/Calculado con/.test(await ev(() => document.getElementById("tasaCalibHint").textContent)));
await ev(() => guardar()); await w(900);
check("…y el registro pasa a anotarse como del aparato de fábrica", db.t("registros").find((r) => r.id === regB.id).calibracion_nombre === null);

// ═════════ Informes ═════════
await ev(() => go("informes")); await w(500);
await ev(() => { document.getElementById("iDesde").value = "2000-01-01"; document.getElementById("iHasta").value = "2100-12-31"; });
check("«Calibración (aparato)» es un campo elegible en los informes", (await ev(() => [...document.querySelectorAll(".campoInformeChk")].map((c) => c.value))).includes("calibracion"));
db.t("registros")[n0 + 1].calibracion_nombre = null; // el de fábrica
db.t("registros").push({ ...db.t("registros")[n0], id: crypto.randomUUID(), calibracion_nombre: "Aparato B", fecha_irradiacion: "2027-01-16" });
await ev(() => buscarInformes()); await w(900);
const nombresInforme = await ev(() => S.informesRaw.map((r) => CAMPOS_INFORME.find((c) => c.id === "calibracion").get(r)));
check("En el informe, los registros antiguos/de fábrica salen con el nombre del aparato original y los otros con el suyo", nombresInforme.includes("Aparato B") && nombresInforme.some((n) => /fábrica/.test(n)) && nombresInforme.every(Boolean), nombresInforme.join(" | "));

// ═════════ Sin conexión: la calibración activa se recuerda ═════════
await ev(() => go("calibraciones")); await w(500);
await confirmar(`activarCalibracion("${idB}")`);
await ctx.route("**/api/**", (r) => r.abort("internetdisconnected"));
await page.reload(); await w(900);
check("Al reabrir la app SIN conexión se sigue calculando con el aparato activo (no vuelve en silencio al de fábrica)", (await ev(() => calibracionActiva().nombre)) === "Aparato B");
await ctx.unroute("**/api/**");

// ═════════ Usuario normal ═════════
await entrar("ana");
await ev(() => go("settings")); await w(400);
check("Un usuario normal ve la calibración activa en Ajustes pero NO el botón para gestionarla", (await ev(() => document.getElementById("ajCalibracionActiva").textContent)).includes("Aparato B") && (await ev(() => getComputedStyle(document.getElementById("ajCalibracionBtn")).display)) === "none");
await ev(() => go("calibraciones")); await w(500);
check("…y si intenta abrir la pantalla de calibraciones, vuelve al menú", !(await ev(() => document.getElementById("scalibraciones").classList.contains("on"))));
check("Para él los cálculos también usan el aparato activo (es global)", (await ev(() => calibracionActiva().nombre)) === "Aparato B");

check("Sin errores de JavaScript en todo el recorrido", errores.length === 0, errores.slice(0, 3).join(" | "));
await browser.close(); srv.close();
console.log(fallos ? `\n${fallos} comprobación(es) fallida(s)` : "\nTodas las comprobaciones correctas");
process.exit(fallos ? 1 : 0);
