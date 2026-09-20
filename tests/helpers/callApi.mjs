// Llama a un handler de /api como lo haría Vercel (sin red ni base de datos reales).
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export async function callApi(name, body, root = RAIZ) {
  const mod = await import(pathToFileURL(path.join(root, "api", name + ".js")).href);
  const res = {
    statusCode: 200, headers: {}, body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    end() { return this; },
  };
  await mod.default({ method: "POST", body, headers: {} }, res);
  return { status: res.statusCode, body: res.body, headers: res.headers };
}
export { RAIZ };
