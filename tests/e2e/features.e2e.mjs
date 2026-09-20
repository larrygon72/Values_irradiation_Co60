// Prueba de extremo a extremo en Chromium: sesión, contraseña, validación, sincronización sin conexión,
// carga bajo demanda de librerías, exportaciones y cabeceras de seguridad.
// Uso:  node --import ./tests/helpers/register.mjs tests/e2e/features.e2e.mjs
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createClient } from "../helpers/fakeSupabaseModule.mjs";
import { startServer } from "./server.mjs";
import { sembrarBase, PASS } from "./seed.mjs";
import { invalidarSesion } from "../../api/_lib/auth.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CAPTURAS = process.env.CAPTURAS || "";
const db = createClient();
let fallos = 0;
const check = (nombre, ok, extra = "") => { console.log(`${ok ? "✓" : "✗"} ${nombre}${extra ? "  → " + extra : ""}`); if (!ok) fallos++; };

sembrarBase(db);
const srv = await startServer(RAIZ);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
await ctx.addInitScript(() => { window.showSaveFilePicker = undefined; });
const page = await ctx.newPage();
const externas = [], csp = [], erroresPagina = [];
page.on("request", (r) => { if (!r.url().startsWith(srv.url) && !r.url().startsWith("data:") && !r.url().startsWith("blob:")) externas.push(r.url()); });
page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text().slice(0, 200)); });
page.on("pageerror", (e) => erroresPagina.push(e.message.slice(0, 160)));
const esperar = (ms) => page.waitForTimeout(ms);
const S = (expr) => page.evaluate(expr);

async function entrar(nick, pass = PASS) {
  await S(() => { go("sl"); });
  await page.fill("#luser", nick); await page.click("#lbtn");
  await page.waitForSelector("#lpassF", { state: "visible", timeout: 4000 });
  await page.fill("#lpass", pass); await page.click("#lbtn");
  await esperar(700);
}
async function irAlLogin() { await page.goto(srv.url); await esperar(300); await page.locator("#swelcome button").first().click(); }

// ── 1. Arranque, recursos y cabeceras ─────────────────────────────
const resp = await page.goto(srv.url);
await esperar(500);
const h = resp.headers();
check("CSP estricta enviada", /script-src 'self'/.test(h["content-security-policy"] || "") && /connect-src 'self'/.test(h["content-security-policy"] || ""));
check("Cabeceras: nosniff, X-Frame-Options, HSTS, Permissions-Policy", h["x-content-type-options"] === "nosniff" && h["x-frame-options"] === "DENY" && !!h["strict-transport-security"] && !!h["permissions-policy"]);
check("Ninguna petición a servidores externos (Google Fonts / CDN)", externas.length === 0, externas.join(", "));
const fuentes = await S(async () => { await document.fonts.ready; return [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/"/g, "")); });
check("Tipografías propias cargadas", fuentes.some((f) => /Manrope/.test(f)) && fuentes.some((f) => /Inter/.test(f)), fuentes.join(","));
const scriptsIniciales = await S(() => [...document.scripts].map((s) => s.src.replace(location.origin, "")));
check("Al arrancar solo se carga js/app.js (Chart/Excel/PDF bajo demanda)", scriptsIniciales.length === 1 && scriptsIniciales[0].endsWith("js/app.js"), scriptsIniciales.join(","));
if (CAPTURAS) { await page.locator("#swelcome button").first().click(); await esperar(300); await page.screenshot({ path: path.join(CAPTURAS, "01-login.png") }); }

// ── 2. Registro de usuarios: política de contraseñas y alta cerrada ──
await irAlLogin().catch(() => {});
await S(() => { go("sl"); });
await page.fill("#luser", "nuevo.user"); await page.click("#lbtn");
await page.waitForSelector("#lregF", { state: "visible", timeout: 4000 });
await page.fill("#rNombre", "Nuevo"); await page.fill("#rAp1", "Usuario"); await page.fill("#rPass", "corta"); await page.fill("#rPass2", "corta");
await page.click("#lbtn"); await esperar(300);
check("Alta: contraseña de <8 caracteres rechazada", /8 caracteres/.test(await S(() => document.getElementById("lerr").textContent)));
process.env.REGISTRO_ABIERTO = "false";
await S(() => { lReset(); });
await page.fill("#luser", "otro.nuevo"); await page.click("#lbtn"); await esperar(500);
check("Alta cerrada por el administrador: aviso claro y sin formulario", /no existe.*administrador/i.test(await S(() => document.getElementById("lerr").textContent)) && (await S(() => document.getElementById("lregF").style.display)) !== "flex");
delete process.env.REGISTRO_ABIERTO;
await S(() => { lReset(); });

// ── 3. Sesión de un usuario normal ────────────────────────────────
await entrar("ana");
check("Login de usuario normal", (await S(() => S.user)) === "ana");
await S(() => go("welcome2")); await S(() => go("menu")); await esperar(400);
check("Guía rápida visible la primera vez", await S(() => document.getElementById("helpCard").style.display !== "none"));
check("«Ajustes» accesible para usuarios normales en la barra lateral", await page.locator('.sidebar-link[data-nav="settings"]').isVisible());
if (CAPTURAS) await page.screenshot({ path: path.join(CAPTURAS, "02-menu.png") });
await S(() => cerrarGuiaRapida()); await page.reload(); await esperar(700);
check("Al recargar la app se mantiene la sesión (va directa al menú)", (await S(() => S.user)) === "ana" && (await S(() => document.getElementById("smenu").classList.contains("on"))));
check("La guía rápida no vuelve a salir tras cerrarla", await S(() => document.getElementById("helpCard").style.display === "none"));

// ── 4. Ajustes y cambio voluntario de contraseña ──────────────────
await S(() => go("settings")); await esperar(300);
check("Ajustes muestra usuario y rol", (await S(() => document.getElementById("acctNick").textContent)) === "ana");
if (CAPTURAS) await page.screenshot({ path: path.join(CAPTURAS, "03-ajustes.png"), fullPage: true });
await S(() => abrirCambioPass(false)); await esperar(200);
await page.fill("#passActual", PASS); await page.fill("#passNueva", "corta"); await page.fill("#passNueva2", "corta"); await page.click("#passOkBtn"); await esperar(200);
check("Cambio de contraseña: valida longitud mínima", /8 caracteres/.test(await S(() => document.getElementById("passErr").textContent)));
await page.fill("#passNueva", "Otra-Clave-2027"); await page.fill("#passNueva2", "Otra-Clave-2027"); await page.click("#passOkBtn"); await esperar(900);
check("Cambio de contraseña correcto y sesión sigue activa", !(await S(() => document.getElementById("passOv").classList.contains("on"))) && (await S(() => LS.token().length)) > 20);
await S(() => go("hist")); await esperar(700);
check("Tras cambiar la contraseña el nuevo token funciona", (await S(() => S.user)) === "ana" && !(await S(() => document.getElementById("sl").classList.contains("on"))));
const nuevaPass = "Otra-Clave-2027";

// ── 5. Validación del formulario ──────────────────────────────────
await S(() => go("form")); await esperar(300);
const antes = db.t("registros").length;
await S(() => guardar()); await esperar(300);
check("Guardar sin fecha: se marca el campo y no se guarda", (await S(() => document.getElementById("fchIrr").classList.contains("inv"))) && db.t("registros").length === antes);
if (CAPTURAS) await page.screenshot({ path: path.join(CAPTURAS, "04-validacion.png") });
await page.fill("#fchIrr", new Date().toISOString().slice(0, 10)); await S(() => onFecha());
await S(() => { document.getElementById("fDos").value = "2.5"; }); await S(() => guardar()); await esperar(200);
check("Dosímetros no enteros: rechazado en el formulario", (await S(() => document.getElementById("fDos").classList.contains("inv"))) && db.t("registros").length === antes);
await S(() => { document.getElementById("fDos").value = "2"; document.getElementById("fObs").value = "=HYPERLINK(\"http://evil\",\"x\")"; });
await S(() => guardar()); await esperar(900);
const reg = db.t("registros").find((r) => r.observaciones?.startsWith("=HYPERLINK"));
check("Registro válido guardado en la nube con su identificador único", !!reg && !!reg.client_uid && reg.creado_por === "ana");

// ── 6. Sin conexión: cola de pendientes y sin duplicados ──────────
await ctx.setOffline(true);
await S(() => go("form")); await esperar(200);
await page.fill("#fchIrr", new Date().toISOString().slice(0, 10)); await S(() => { document.getElementById("fObs").value = "hecho sin cobertura"; guardar(); });
await esperar(1500);
check("Sin conexión: el registro queda pendiente en el dispositivo", (await S(() => LS.pending().length)) === 1 && !db.t("registros").some((r) => r.observaciones === "hecho sin cobertura"));
await ctx.setOffline(false);
await S(() => flushPending()); await esperar(900);
check("Al volver la conexión se sincroniza solo, una vez", (await S(() => LS.pending().length)) === 0 && db.t("registros").filter((r) => r.observaciones === "hecho sin cobertura").length === 1);
await S(() => flushPending()); await esperar(300);
check("Reenviar no crea duplicados", db.t("registros").filter((r) => r.observaciones === "hecho sin cobertura").length === 1);

// Respuesta perdida: el servidor guarda pero el navegador no se entera → reintento sin duplicar
let interceptado = false;
await page.route("**/api/registros", async (route) => {
  const body = JSON.parse(route.request().postData() || "{}");
  if (!interceptado && body.action === "guardar") { interceptado = true; await route.fetch(); await route.abort("connectionreset"); } else await route.continue();
});
await S(() => go("form")); await esperar(200);
await page.fill("#fchIrr", new Date().toISOString().slice(0, 10)); await S(() => { document.getElementById("fObs").value = "respuesta perdida"; guardar(); });
await esperar(1500);
check("Respuesta perdida: el servidor lo guardó y el navegador lo deja pendiente", db.t("registros").filter((r) => r.observaciones === "respuesta perdida").length === 1 && (await S(() => LS.pending().length)) === 1);
await S(() => flushPending()); await esperar(900);
await page.unroute("**/api/registros");
check("…y el reintento NO lo duplica", db.t("registros").filter((r) => r.observaciones === "respuesta perdida").length === 1 && (await S(() => LS.pending().length)) === 0);

// Rechazo del servidor: no se pierde en silencio
await S(() => { const r = { at: new Date().toISOString(), uid: "uid-rechazo-123", by: "ana", fchIrr: "no-es-una-fecha", obs: "datos malos" }; S.staged.push(r); LS.setS(S.staged); LS.setPending([r]); });
await S(() => flushPending()); await esperar(700);
check("Un registro rechazado por datos no válidos se conserva y se avisa (antes se perdía)", (await S(() => LS.pending().length)) === 0 && (await S(() => LS.rejected().length)) === 1);

// ── 7. Cerrar sesión limpia el login ──────────────────────────────
await S(() => logout()); await esperar(300);
const login = await S(() => ({ user: document.getElementById("luser").value, dis: document.getElementById("luser").disabled, pass: document.getElementById("lpass").value, btn: document.getElementById("lbtn").textContent, visible: document.getElementById("sl").classList.contains("on") }));
check("Cerrar sesión deja el login limpio (usuario y contraseña vacíos)", login.visible && login.user === "" && !login.dis && login.pass === "" && login.btn === "Continuar", JSON.stringify(login));
await page.reload(); await esperar(600);
check("Tras cerrar sesión, recargar NO vuelve a entrar", (await S(() => S.user)) === null);

// ── 8. Entrar sin conexión (solo quien ya entró antes, con hash) ──
const off = await S(() => JSON.stringify(LS.off()));
check("Credenciales sin conexión guardadas solo como hash PBKDF2 con sal", /"ana"/.test(off) && /"salt":"/.test(off) && /"hash":"/.test(off) && /"iter":150000/.test(off));
check("El almacenamiento local no contiene contraseñas en claro", !off.includes(PASS) && !off.includes(nuevaPass) && !(await S(() => localStorage.getItem("vi_u"))));
await S(async () => { await navigator.serviceWorker.ready; });
await ctx.setOffline(true);
await page.reload().catch(() => {}); await esperar(700);
const cargoSinRed = await S(() => !!document.getElementById("app"));
check("La app arranca sin conexión gracias al Service Worker", cargoSinRed);
await page.locator("#swelcome button").first().click().catch(() => {});
await page.fill("#luser", "nadie"); await page.click("#lbtn"); await esperar(500);
check("Sin conexión, un usuario que nunca entró aquí no puede entrar", /Sin conexión/.test(await S(() => document.getElementById("lerr").textContent)));
await S(() => lReset());
await page.fill("#luser", "ana"); await page.click("#lbtn"); await page.waitForSelector("#lpassF", { state: "visible", timeout: 4000 });
await page.fill("#lpass", "mala-clave-99"); await page.click("#lbtn"); await esperar(600);
check("Sin conexión: contraseña incorrecta rechazada", /incorrecta/.test(await S(() => document.getElementById("lerr").textContent)));
await page.fill("#lpass", nuevaPass); await page.click("#lbtn"); await esperar(800);
check("Sin conexión: entra con la contraseña correcta, sin privilegios de admin", (await S(() => S.user)) === "ana" && (await S(() => S.offline)) === true && (await S(() => S.isAdmin)) === false);
await S(() => logout());
await ctx.setOffline(false);

// ── 9. Contraseña por defecto: cambio obligatorio ─────────────────
db.t("usuarios").find((u) => u.nick === "Admin").must_change_password = true;
await irAlLogin();
await entrar("Admin");
check("Admin con contraseña de fábrica: diálogo de cambio obligatorio (sin botón cancelar)", (await S(() => document.getElementById("passOv").classList.contains("on"))) && (await S(() => document.getElementById("passCancelBtn").style.display)) === "none");
await page.keyboard.press("Escape"); await esperar(150);
check("…y Escape no lo cierra", await S(() => document.getElementById("passOv").classList.contains("on")));
if (CAPTURAS) await page.screenshot({ path: path.join(CAPTURAS, "05-cambio-obligatorio.png") });
await page.fill("#passActual", PASS); await page.fill("#passNueva", "Admin-Nueva-2027"); await page.fill("#passNueva2", "Admin-Nueva-2027"); await page.click("#passOkBtn"); await esperar(900);
check("Cambio obligatorio completado: la app queda desbloqueada", !(await S(() => document.getElementById("passOv").classList.contains("on"))) && db.t("usuarios").find((u) => u.nick === "Admin").must_change_password === false);

// ── 10. Administrador: pantallas, exportaciones y librerías bajo demanda ──
await S(() => go("users")); await esperar(600);
if (CAPTURAS) await page.screenshot({ path: path.join(CAPTURAS, "06-usuarios.png") });
db.t("registros").push({ id: crypto.randomUUID(), created_at: new Date().toISOString(), creado_por: "ana", fecha_irradiacion: new Date().toISOString().slice(0, 10), semana_iso: 38, n_urnas: 2, conductor_nombre: "Ana", observaciones: "=cmd|' /C calc'!A0", tasa: 0.27, tiempo_exposicion: 100 });
await S(() => go("hist")); await esperar(900);
const pedidosLib = () => srv.peticiones.filter((p) => p.includes("/vendor/")).map((p) => p.split("/").pop());
check("Antes de exportar no se ha descargado ninguna librería pesada", pedidosLib().every((f) => !/xlsx|jspdf/.test(f)), pedidosLib().join(","));
const dCsv = page.waitForEvent("download");
await S(() => exportHistCSV());
const csv = fs.readFileSync(await (await dCsv).path(), "utf8");
check("CSV: las «fórmulas» se neutralizan (inyección de fórmulas)", /"'=cmd\|/.test(csv) && /"'=HYPERLINK/.test(csv) && !/(^|,)"=cmd/.test(csv));
await S(() => { const o = document.getElementById("scov"); if (o) o.classList.remove("on"); });
const dXls = page.waitForEvent("download"); await S(() => exportHistXLSX()); const xlsx = await dXls;
check("Excel: la librería se descarga solo al exportar y el archivo se genera", pedidosLib().some((f) => /xlsx/.test(f)) && fs.statSync(await xlsx.path()).size > 4000, pedidosLib().join(","));
await S(() => { const o = document.getElementById("scov"); if (o) o.classList.remove("on"); });
const dPdf = page.waitForEvent("download"); await S(() => exportHistPDF()); const pdf = await dPdf;
const pdfKb = Math.round(fs.statSync(await pdf.path()).size / 1024);
check("PDF: la librería se descarga solo al exportar; el archivo pesa poco (logo reducido)", pedidosLib().some((f) => /jspdf-2/.test(f)) && pdfKb < 120, pdfKb + " KB");

// ── 11. Sesión revocada en el servidor ────────────────────────────
await S(() => go("menu"));
db.t("usuarios").find((u) => u.nick === "Admin").token_version = 99;
invalidarSesion(); // (en producción la caché del servidor caduca sola a los 30 s)
await page.evaluate(() => { S.dashCache = null; });
await S(() => go("hist")); await esperar(1200);
check("Sesión revocada en el servidor: vuelve al login con un aviso claro", (await S(() => document.getElementById("sl").classList.contains("on"))) && /caducado/.test(await S(() => document.getElementById("lerr").textContent)));
if (CAPTURAS) await page.screenshot({ path: path.join(CAPTURAS, "07-sesion-caducada.png") });

check("Sin violaciones de la Content-Security-Policy durante toda la prueba", csp.length === 0, csp.slice(0, 2).join(" | "));
check("Sin errores de JavaScript en la página", erroresPagina.length === 0, erroresPagina.slice(0, 3).join(" | "));
await browser.close(); srv.close();
console.log(fallos ? `\n${fallos} comprobación(es) fallida(s)` : "\nTodas las comprobaciones correctas");
process.exit(fallos ? 1 : 0);
