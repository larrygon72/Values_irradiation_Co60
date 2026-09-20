// Prueba en navegador real (Chromium): datos hostiles guardados en la base de datos NO deben ejecutarse.
// Uso:  node --import ./tests/helpers/register.mjs tests/e2e/xss.e2e.mjs [ruta-de-la-app]
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createClient } from "../helpers/fakeSupabaseModule.mjs";
import { startServer } from "./server.mjs";
import { sembrarBase, PASS } from "./seed.mjs";

const RAIZ = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const db = createClient();
const esOriginal = process.argv[3] === "original";
sembrarBase(db, { malicioso: true, adminPass: esOriginal ? "Aedes" : PASS });
if (esOriginal) db.tables.usuarios[0].password_hash = "$2b$10$g3dxTMRKRu9jRJcc4d/Mi.IoeqRQlMYSBpmttJshwdHjEbf9u0.xm";
const srv = await startServer(RAIZ);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const csp = [];
page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text().slice(0, 160)); });
page.on("pageerror", (e) => console.log("  pageerror:", e.message.slice(0, 140)));
await page.goto(srv.url);
await page.waitForTimeout(400);

await page.click("text=Continuar", { timeout: 3000 }).catch(() => {});
// Ir al login (pantalla de bienvenida → botón)
const btnEntrar = page.locator("#swelcome button").first();
if (await btnEntrar.count()) await btnEntrar.click();
await page.fill("#luser", "Admin");
await page.click("#lbtn");
await page.waitForSelector("#lpassF", { state: "visible" });
await page.fill("#lpass", esOriginal ? "Aedes" : PASS);
await page.click("#lbtn");
await page.waitForTimeout(800);
if (!esOriginal) await page.waitForSelector("#smenu.on", { timeout: 4000 }).catch(() => {});
else await page.evaluate(() => go("menu"));

let literales = 0;
const pantallas = ["menu", "records", "hist", "informes", "users", "vehiculos", "estaciones", "irradiadores", "conduccion", "fichaje"];
for (const p of pantallas) {
  await page.evaluate((id) => { try { go(id); } catch (e) {} }, p).catch(() => {});
  await page.waitForTimeout(500);
  if (p === "hist") { await page.evaluate(() => { try { buscarHistorial(); } catch (e) {} }); await page.waitForTimeout(500); await page.evaluate(() => { const r = document.querySelector("#histTableBody tr[onclick], #histList .ritem"); if (r) r.click(); }); await page.waitForTimeout(300); await page.evaluate(() => { try { cerrarDetalleRegistro(); } catch (e) {} }); }
  if (p === "informes") { await page.evaluate(() => { try { buscarInformes(); } catch (e) {} }); await page.waitForTimeout(500); }
  if (p === "conduccion") { await page.evaluate(() => { try { cargarListaConduccion?.(); } catch (e) {} }); await page.waitForTimeout(300); }
  // Simular el ratón / clics sobre los elementos con manejadores inline (por si el payload va en un atributo)
  await page.evaluate(() => {
    document.querySelectorAll("[onmouseover]").forEach((el) => el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    document.querySelectorAll("button[onclick*='editarUsrInicio']").forEach((b) => { try { b.click(); } catch (e) {} });
  });
  await page.waitForTimeout(150);
  literales = Math.max(literales, await page.evaluate(() => (document.body.innerText.match(/<img src=x/g) || []).length));
}
const conSesion = await page.evaluate(() => (typeof S !== "undefined" ? S.user : null));
const res = await page.evaluate(() => ({ pwned: window.__pwned || 0, imgX: document.querySelectorAll('img[src="x"]').length, svgOnload: document.querySelectorAll("svg[onload]").length, onmouse: document.querySelectorAll("[onmouseover]").length }));
console.log(esOriginal ? "ORIGINAL" : "NUEVA   ", JSON.stringify(res), "| sesión:", conSesion, "| textos hostiles mostrados como texto plano (máx. por pantalla):", literales, "| violaciones CSP:", csp.length);
if (!conSesion) { console.log("  ✗ no se pudo iniciar sesión: la prueba no es válida"); process.exit(2); }
if (csp.length) console.log("  ", csp.slice(0, 3));
await browser.close(); srv.close();
process.exit(res.pwned === 0 && res.imgX === 0 && res.svgOnload === 0 && res.onmouse === 0 && (esOriginal || literales > 0) ? 0 : 3);
