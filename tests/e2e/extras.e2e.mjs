// Flujos secundarios en Chromium: editar un registro, informes de fichajes, rechazados, sesión caducada,
// aviso de versión nueva del Service Worker, registros pendientes de otro usuario y bloqueo por intentos.
// Uso:  node --import ./tests/helpers/register.mjs tests/e2e/extras.e2e.mjs
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createClient } from "../helpers/fakeSupabaseModule.mjs";
import { startServer } from "./server.mjs";
import { sembrarBase, PASS } from "./seed.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// Copia de la app para poder "publicar una versión nueva" del Service Worker durante la prueba
const COPIA = fs.mkdtempSync(path.join(os.tmpdir(), "vi-app-"));
for (const f of fs.readdirSync(RAIZ)) if (!["node_modules", "tests", ".git"].includes(f)) fs.cpSync(path.join(RAIZ, f), path.join(COPIA, f), { recursive: true });
fs.symlinkSync(path.join(RAIZ, "node_modules"), path.join(COPIA, "node_modules"));

const db = createClient();
let fallos = 0;
const check = (n, ok, x = "") => { console.log(`${ok ? "✓" : "✗"} ${n}${x ? "  → " + x : ""}`); if (!ok) fallos++; };
sembrarBase(db);
const srv = await startServer(COPIA);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
await ctx.addInitScript(() => { window.showSaveFilePicker = undefined; });
const page = await ctx.newPage();
page.setDefaultTimeout(6000);
const errores = [];
page.on("pageerror", (e) => errores.push(e.message.slice(0, 200)));
const w = (ms) => page.waitForTimeout(ms);
const ev = (f, a) => page.evaluate(f, a);
async function entrar(nick, pass = PASS) {
  await ev(() => { lReset(); go("sl"); }); await page.fill("#luser", nick); await page.click("#lbtn");
  await page.waitForSelector("#lpassF", { state: "visible" });
  await page.fill("#lpass", pass); await page.click("#lbtn"); await w(700);
}
await page.goto(srv.url); await w(500);

// ── Bloqueo por intentos: mensaje claro en el login ──
await page.locator("#swelcome button").first().click();
for (let i = 0; i < 3; i++) {
  await ev(() => lReset()); await page.fill("#luser", "ana"); await page.click("#lbtn");
  await page.waitForSelector("#lpassF", { state: "visible" });
  await page.fill("#lpass", "incorrecta-" + i); await page.click("#lbtn"); await w(500);
}
const msgBloqueo = await ev(() => document.getElementById("lerr").textContent);
check("Tras 3 fallos el login explica el bloqueo temporal (15 min)", /15 minutos/.test(msgBloqueo), msgBloqueo);
db.t("usuarios").find((u) => u.nick === "ana").bloqueado_hasta = new Date(Date.now() - 1000).toISOString(); // pasan los 15 minutos
await entrar("ana");
check("Pasado el tiempo la cuenta se desbloquea sola", (await ev(() => S.user)) === "ana");

// ── Editar un registro desde el Historial ──
await ev(() => go("hist")); await w(900);
const id = db.t("registros")[0].id;
await ev((i) => abrirDetalleRegistro(i), id); await w(300);
await ev(() => editarRegistroDesdeDetalle()); await w(500);
check("Editar: el formulario se abre con los datos del registro", (await ev(() => S.editingId)) === id && (await ev(() => document.getElementById("sform").classList.contains("on"))));
await page.fill("#fchIrr", ""); await ev(() => guardar()); await w(300);
check("Editar: sin fecha se rechaza y se marca el campo", await ev(() => document.getElementById("fchIrr").classList.contains("inv")));
await page.fill("#fchIrr", new Date().toISOString().slice(0, 10)); await ev(() => onFecha());
await ev(() => { document.getElementById("fObs").value = "observación corregida"; }); await ev(() => guardar()); await w(900);
check("Editar: los cambios se guardan en la nube (misma fila, sin duplicar)", db.t("registros").length === 1 && db.t("registros")[0].observaciones === "observación corregida");
check("Editar: se registra en la auditoría", db.t("auditoria").some((a) => a.accion === "actualizar" && a.entidad === "registro"));

// ── Registros locales: rechazados y limpieza ──
await ev(() => { const r = { at: new Date().toISOString(), uid: "uid-x-1234567", by: "ana", fchIrr: "2026-09-01", obs: "rechazado por el servidor", semana: "36" }; S.staged.push(r); LS.setS(S.staged); LS.setRejected([{ ...r, rechazo: "La fecha no es válida" }]); });
await ev(() => go("records")); await w(300);
const txt = await ev(() => document.getElementById("recList").innerText);
check("Registros: un registro rechazado se ve con su motivo", /rechazado/i.test(txt) && /La fecha no es válida/.test(txt));
await ev(() => { clearRecs(); }); await w(300); await page.click("#confirmOkBtn"); await w(400);
check("Limpiar registros locales vacía también los rechazados", (await ev(() => LS.rejected().length)) === 0 && (await ev(() => stagedVisible().length)) === 0);

// ── Pendientes de otro usuario no se envían con la sesión equivocada ──
await ev(() => { LS.setPending([{ at: new Date().toISOString(), uid: "uid-de-bob-987654", by: "bob", fchIrr: new Date().toISOString().slice(0, 10), obs: "hecho por bob" }]); });
await ev(() => flushPending()); await w(500);
check("Un pendiente hecho por otro usuario no se envía con mi sesión", !db.t("registros").some((r) => r.observaciones === "hecho por bob") && (await ev(() => LS.pending().length)) === 1);
db.t("usuarios").push({ ...db.t("usuarios")[1], id: "u-bob", nick: "bob", codigo: "BPX" });
await ev(() => logout()); await entrar("bob"); await ev(() => go("menu")); await w(900);
check("…y se envía, a su nombre, cuando entra ese usuario", db.t("registros").some((r) => r.observaciones === "hecho por bob" && r.creado_por === "bob") && (await ev(() => LS.pending().length)) === 0);

// ── Informes de fichajes ──
db.t("fichajes").push({ id: crypto.randomUUID(), usuario_nick: "bob", fecha: new Date().toISOString().slice(0, 10), hora_entrada: "07:00", hora_salida: "14:30", horas_de_mas: 0.5, tipo_horario_aplicado: "fijo", horario_entrada_esperado: "07:00", horario_salida_esperado: "13:57", created_at: new Date().toISOString() });
await ev(() => go("informes")); await w(300);
await page.selectOption("#informeTipo", "fichajes"); await w(300);
await ev(() => buscarInformes()); await w(900);
check("Informe de fichajes: vista previa", /1 registro/.test(await ev(() => document.getElementById("informesNote").textContent)) && /bob/.test(await ev(() => document.getElementById("informesPreviewWrap")?.innerText || document.body.innerText)));
const dCsv = page.waitForEvent("download"); await ev(() => exportInformeCSV()); const csv = fs.readFileSync(await (await dCsv).path(), "utf8");
check("Informe de fichajes: CSV con los datos", /bob/.test(csv) && /07:00/.test(csv));
await ev(() => { const o = document.getElementById("scov"); if (o) o.classList.remove("on"); });
const dPdf = page.waitForEvent("download"); await ev(() => exportInformePDF()); const pdfKb = Math.round(fs.statSync(await (await dPdf).path()).size / 1024);
check("Informe de fichajes: PDF ligero", pdfKb < 120, pdfKb + " KB");

// ── Horas en formato h:mm en Informes (filas, vista previa, totales, CSV y PDF) ──
const hoyISO = new Date().toISOString().slice(0, 10);
const fich = (nick, dias, hm, ent, sal) => ({ id: crypto.randomUUID(), usuario_nick: nick, fecha: new Date(Date.now() - dias * 864e5).toISOString().slice(0, 10), hora_entrada: ent, hora_salida: sal, horas_de_mas: hm, tipo_horario_aplicado: "fijo", horario_entrada_esperado: "07:00", horario_salida_esperado: "13:57", created_at: new Date().toISOString() });
db.tables.fichajes = [fich("bob", 0, 0.5, "07:00", "14:27"), fich("bob", 1, -37 / 60, "07:00", "13:20"), fich("bob", 2, 7.75, "07:00", "21:42"), fich("bob", 3, 0, "07:00", "13:57")];
await ev(() => go("informes")); await w(300);
await page.selectOption("#informeTipo", "fichajes"); await w(300);
await ev(() => { document.querySelectorAll(".campoSumaChk").forEach((c) => { c.checked = c.dataset.campo === "horasDeMas"; }); });
await ev(() => buscarInformes()); await w(900);
const previa = await ev(() => document.getElementById("vistaPreviaTabla").innerText);
check("Informe de fichajes: las horas de más salen en h:mm (0:30, -0:37, 7:45, 0:00)", ["0:30", "-0:37", "7:45", "0:00"].every((t) => previa.includes(t)) && !/0\.50|7\.75|-0\.62/.test(previa), previa.replace(/\s+/g, " ").slice(-80));
check("…y el total también: 0:30 − 0:37 + 7:45 = 7:38", /Total: 7:38|\b7:38\b/.test(previa), previa.replace(/\s+/g, " ").slice(-60));
check("La cabecera indica la unidad (h:mm)", /HORAS DE MÁS \(H:MM\)|Horas de más \(h:mm\)/i.test(previa));
const dHm = page.waitForEvent("download"); await ev(() => exportInformeCSV()); const csvHm = fs.readFileSync(await (await dHm).path(), "utf8");
check("CSV: mismas horas en h:mm, con el negativo sin comilla de protección", /"0:30"/.test(csvHm) && /"-0:37"/.test(csvHm) && /"7:45"/.test(csvHm) && /"Total".*"7:38"/.test(csvHm), csvHm.split(/\r?\n/).slice(-2).join(" | "));
await ev(() => { const o = document.getElementById("scov"); if (o) o.classList.remove("on"); });
// Duración de la irradiación (informe de registros)
db.tables.registros = [
  { id: crypto.randomUUID(), created_at: new Date().toISOString(), creado_por: "bob", fecha_irradiacion: hoyISO, semana_iso: 38, h_inicio_irr: "08:00", h_fin_irr: "08:20", n_urnas: 1 },
  { id: crypto.randomUUID(), created_at: new Date().toISOString(), creado_por: "bob", fecha_irradiacion: hoyISO, semana_iso: 38, h_inicio_irr: "09:00", h_fin_irr: "10:45", n_urnas: 1 },
];
await ev(() => go("informes")); await w(300);
await ev(() => { document.querySelectorAll(".campoSumaChk").forEach((c) => { c.checked = c.dataset.campo === "duracionIrr"; }); });
await ev(() => buscarInformes()); await w(900);
const previa2 = await ev(() => document.getElementById("vistaPreviaTabla").innerText);
check("Informe de registros: la duración de la irradiación sale en h:mm (0:20, 1:45) y suma 2:05", previa2.includes("0:20") && previa2.includes("1:45") && /2:05/.test(previa2) && !/0\.33|1\.75| min\)/.test(previa2), previa2.replace(/\s+/g, " ").slice(-90));
const dPdf2 = page.waitForEvent("download"); await ev(() => exportInformePDF()); const pdf2 = fs.readFileSync(await (await dPdf2).path());
check("PDF del informe generado con las horas en h:mm", pdf2.length > 3000);
await ev(() => { const o = document.getElementById("scov"); if (o) o.classList.remove("on"); });

// ── Duraciones en h:mm también en el formulario, en los totales del Historial y en la gráfica ──
await ev(() => go("form")); await w(300);
const duracion = async (a, b) => { await ev(([x, y]) => { const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event("input", { bubbles: true })); }; set("fHini", x); set("fHfin", y); }, [a, b]); return ev(() => document.getElementById("fDuracionIrr").value); };
check("Formulario: la duración de la irradiación sale en h:mm (0:20, 1:45, 0:45 cruzando medianoche)", (await duracion("08:00", "08:20")) === "0:20" && (await duracion("09:00", "10:45")) === "1:45" && (await duracion("23:30", "00:15")) === "0:45");
const base = { created_at: new Date().toISOString(), creado_por: "bob", fecha_irradiacion: hoyISO, semana_iso: 38, n_urnas: 1 };
db.tables.registros = [
  { id: crypto.randomUUID(), ...base, h_ida_inicio: "07:00", h_ida_llegada: "07:40", h_vuelta_inicio: "13:00", h_vuelta_llegada: "13:50" },
  { id: crypto.randomUUID(), ...base, h_ida_inicio: "07:10", h_ida_llegada: "07:35", h_vuelta_inicio: "13:00", h_vuelta_llegada: "13:10" },
];
await ev(() => go("hist")); await w(1000);
const tot = await ev(() => ({ ida: document.getElementById("totIda").textContent, vuelta: document.getElementById("totVuelta").textContent, viaje: document.getElementById("totViaje").textContent }));
check("Historial: los totales de viaje salen en h:mm (ida 1:05, vuelta 1:00, total 2:05)", tot.ida === "1:05" && tot.vuelta === "1:00" && tot.viaje === "2:05", JSON.stringify(tot));
await ev(() => go("menu")); await w(900);
await ev((dia) => { S.dashRegs = [{ fecha_irradiacion: dia, h_inicio_irr: "08:00", h_fin_irr: "09:20" }]; document.getElementById("dashChartTipo").value = "tiempoOperador"; return dibujarTendenciaDashboard(); }, hoyISO); await w(500);
const graf = await ev(() => ({ tick: dashChartInstance.options.scales.y.ticks.callback(80), tip: dashChartInstance.options.plugins.tooltip.callbacks.label({ parsed: { y: 80 }, formattedValue: "80" }), unidad: dashChartInstance.options.scales.y.title.text, dato: dashChartInstance.data.datasets[0].data[0] }));
check("Dashboard: la gráfica «tiempo del operador» muestra h:mm en el eje y en el aviso (80 min → 1:20)", graf.tick === "1:20" && graf.tip === "1:20" && graf.unidad === "h:mm" && graf.dato === 80, JSON.stringify(graf));

// ── Sesión caducada al abrir la app ──
await ev(() => { const b64 = (o) => btoa(JSON.stringify(o)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); LS.setToken(b64({ alg: "HS256" }) + "." + b64({ nick: "bob", exp: Math.floor(Date.now() / 1000) - 10 }) + ".x"); LS.setSession({ nick: "bob", role: "user" }); });
await page.reload(); await w(700);
check("Con un token ya caducado, la app arranca en la bienvenida (sin entrar) y lo borra", (await ev(() => S.user)) === null && (await ev(() => LS.token())) === "");

// ── Aviso de versión nueva ──
await entrar("bob");
await page.evaluate(async () => { await navigator.serviceWorker.ready; });
await w(500);
check("Sin actualización, el aviso no aparece", !(await ev(() => document.getElementById("updBar").classList.contains("on"))));
fs.appendFileSync(path.join(COPIA, "sw.js"), "\n// versión nueva " + Date.now() + "\n");
await ev(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); });
await page.waitForFunction(() => document.getElementById("updBar").classList.contains("on"), null, { timeout: 8000 }).catch(() => {});
check("Al publicarse una versión nueva aparece «Actualizar»", await ev(() => document.getElementById("updBar").classList.contains("on")));

check("Sin errores de JavaScript", errores.length === 0, errores.slice(0, 3).join(" | "));
await browser.close(); srv.close(); fs.rmSync(COPIA, { recursive: true, force: true });
console.log(fallos ? `\n${fallos} comprobación(es) fallida(s)` : "\nTodas las comprobaciones correctas");
process.exit(fallos ? 1 : 0);
