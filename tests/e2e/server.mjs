// Servidor local de pruebas: sirve la app estática (con las cabeceras de vercel.json,
// incluida la CSP) y ejecuta los handlers de /api contra una base de datos simulada.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".webp": "image/webp" };

export function startServer(root, port = 0) {
  let headersGlobales = [];
  try {
    const v = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
    headersGlobales = (v.headers || []).find((h) => h.source === "/(.*)")?.headers || [];
  } catch {}
  const peticiones = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    peticiones.push(req.method + " " + url.pathname);
    if (url.pathname.startsWith("/api/")) {
      const name = url.pathname.slice(5);
      let raw = ""; for await (const c of req) raw += c;
      let body = {}; try { body = JSON.parse(raw || "{}"); } catch {}
      const shim = {
        statusCode: 200, _h: {},
        status(c) { this.statusCode = c; return this; },
        setHeader(k, v) { this._h[k] = v; },
        json(o) { res.writeHead(this.statusCode, { "Content-Type": "application/json", ...this._h }); res.end(JSON.stringify(o)); return this; },
      };
      try {
        const mod = await import(pathToFileURL(path.join(root, "api", name + ".js")).href + "?v=" + Date.now().toString(36).slice(0, 0));
        await mod.default({ method: req.method, body, headers: req.headers }, shim);
      } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: String(e) })); }
      return;
    }
    let f = decodeURIComponent(url.pathname); if (f === "/") f = "/index.html";
    const file = path.join(root, f);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("no"); return; }
    const h = { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" };
    for (const { key, value } of headersGlobales) h[key] = value;
    res.writeHead(200, h); res.end(fs.readFileSync(file));
  });
  return new Promise((ok) => server.listen(port, "127.0.0.1", () => ok({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close(), peticiones })));
}
