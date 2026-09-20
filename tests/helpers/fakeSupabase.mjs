// Mini-simulador en memoria de @supabase/supabase-js (PostgREST) — solo para pruebas.
// Implementa lo justo para ejecutar los handlers de /api sin una base de datos real,
// incluida la semántica de LIKE/ILIKE (con % y _ como comodines y \ como escape).
import { randomUUID } from "node:crypto";

export function likeToRegex(pattern, ci = true) {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "\\" && i + 1 < pattern.length) { re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); continue; }
    if (ch === "%") { re += "[\\s\\S]*"; continue; }
    if (ch === "_") { re += "[\\s\\S]"; continue; }
    re += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + re + "$", ci ? "i" : "");
}

const DEFAULTS = {
  usuarios: () => ({ role: "user", locked: false, intentos: 0, apellido2: "", horario_entrada: "07:00", horario_salida: "13:57", tipo_horario: "fijo", must_change_password: false, bloqueado_hasta: null }),
  irradiadores: () => ({ activo: true, apellido2: "" }),
  vehiculos: () => ({ activo: true, numero_obra: "" }),
  estaciones_servicio: () => ({ activo: true }),
};
const codigo = (r) => ((r.nombre?.[0] || "?") + (r.apellido1?.[0] || "?") + (r.apellido2 ? r.apellido2[0] : "X")).toUpperCase();
const GENERATED = {
  usuarios: (r) => { r.codigo = codigo(r); },
  irradiadores: (r) => { r.codigo = codigo(r); },
  vehiculo_viajes: (r) => { r.km_recorridos = r.km_final != null && r.km_inicial != null ? r.km_final - r.km_inicial : null; },
  repostajes: (r) => { r.litros = r.precio_litro > 0 && r.importe != null ? Math.round((r.importe / r.precio_litro) * 100) / 100 : null; },
};
// Índices únicos (para simular el error 23505)
const UNIQUE = {
  usuarios: [(a, b) => a.nick.toLowerCase() === b.nick.toLowerCase()],
  vehiculos: [(a, b) => a.matricula.toLowerCase() === b.matricula.toLowerCase()],
  estaciones_servicio: [(a, b) => a.nombre.toLowerCase() === b.nombre.toLowerCase()],
  fichajes: [(a, b) => a.usuario_nick.toLowerCase() === b.usuario_nick.toLowerCase() && a.fecha === b.fecha],
  registros: [(a, b) => a.client_uid != null && b.client_uid != null && a.creado_por === b.creado_por && a.client_uid === b.client_uid],
};

export function createFakeDb(opts = {}) {
  const db = { tables: {}, missingColumns: opts.missingColumns || {}, log: [] };
  const t = (n) => (db.tables[n] ||= []);
  db.from = (name) => new Query(db, name);
  db.t = t;
  return db;
}

class Query {
  constructor(db, table) { this.db = db; this.table = table; this.filters = []; this.orders = []; this._limit = null; this._range = null; this.op = "select"; this.payload = null; this.returning = false; this.mode = "many"; }
  select() { if (this.op === "select") this.op = "select"; else this.returning = true; return this; }
  insert(p) { this.op = "insert"; this.payload = p; return this; }
  update(p) { this.op = "update"; this.payload = p; return this; }
  delete() { this.op = "delete"; return this; }
  _f(fn, desc) { this.filters.push({ fn, desc }); return this; }
  eq(c, v) { return this._f((r) => r[c] === v, `eq ${c}=${v}`); }
  neq(c, v) { return this._f((r) => r[c] !== v, `neq ${c}`); }
  gt(c, v) { return this._f((r) => r[c] != null && r[c] > v, `gt ${c}`); }
  gte(c, v) { return this._f((r) => r[c] != null && r[c] >= v, `gte ${c}`); }
  lt(c, v) { return this._f((r) => r[c] != null && r[c] < v, `lt ${c}`); }
  lte(c, v) { return this._f((r) => r[c] != null && r[c] <= v, `lte ${c}`); }
  ilike(c, p) { const re = likeToRegex(String(p), true); return this._f((r) => r[c] != null && re.test(String(r[c])), `ilike ${c} ${p}`); }
  like(c, p) { const re = likeToRegex(String(p), false); return this._f((r) => r[c] != null && re.test(String(r[c])), `like ${c} ${p}`); }
  not(c, op, v) { if (op === "is") return this._f((r) => (v === null ? r[c] != null : r[c] !== v), `not is ${c}`); throw new Error("fake: not " + op); }
  is(c, v) { return this._f((r) => (v === null ? r[c] == null : r[c] === v), `is ${c}`); }
  in(c, arr) { return this._f((r) => arr.includes(r[c]), `in ${c}`); }
  order(c, o = {}) { this.orders.push({ c, asc: o.ascending !== false }); return this; }
  limit(n) { this._limit = n; return this; }
  range(a, b) { this._range = [a, b]; return this; }
  single() { this.mode = "single"; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }
  then(res, rej) { return this._exec().then(res, rej); }
  async _exec() {
    const db = this.db, rows = db.t(this.table);
    db.log.push({ table: this.table, op: this.op, filters: this.filters.map((f) => f.desc) });
    const missing = db.missingColumns[this.table] || [];
    const payloads = this.payload == null ? [] : Array.isArray(this.payload) ? this.payload : [this.payload];
    for (const p of payloads) for (const k of Object.keys(p)) if (missing.includes(k))
      return { data: null, error: { code: "PGRST204", message: `Could not find the '${k}' column of '${this.table}' in the schema cache` } };
    let out = [];
    if (this.op === "insert") {
      for (const p of payloads) {
        const row = { id: randomUUID(), created_at: new Date().toISOString(), ...(DEFAULTS[this.table]?.() || {}), ...JSON.parse(JSON.stringify(p)) };
        for (const chk of UNIQUE[this.table] || []) if (rows.some((o) => chk(row, o)))
          return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint "${this.table}_uniq"` } };
        GENERATED[this.table]?.(row);
        rows.push(row); out.push(row);
      }
    } else {
      let m = rows.filter((r) => this.filters.every((f) => f.fn(r)));
      if (this.op === "update") {
        for (const r of m) { Object.assign(r, JSON.parse(JSON.stringify(this.payload))); GENERATED[this.table]?.(r); }
        out = m;
      } else if (this.op === "delete") {
        db.tables[this.table] = rows.filter((r) => !m.includes(r)); out = m;
      } else {
        for (const { c, asc } of [...this.orders].reverse()) m = [...m].sort((a, b) => (a[c] == null ? 1 : b[c] == null ? -1 : a[c] < b[c] ? (asc ? -1 : 1) : a[c] > b[c] ? (asc ? 1 : -1) : 0));
        if (this._range) m = m.slice(this._range[0], this._range[1] + 1);
        else if (this._limit != null) m = m.slice(0, Math.min(this._limit, opts_maxRows()));
        else m = m.slice(0, opts_maxRows());
        out = m;
      }
    }
    const clone = (x) => JSON.parse(JSON.stringify(x));
    if ((this.op === "insert" || this.op === "update" || this.op === "delete") && !this.returning) return { data: null, error: null };
    if (this.mode === "single") { if (out.length !== 1) return { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } }; return { data: clone(out[0]), error: null }; }
    if (this.mode === "maybe") { if (out.length > 1) return { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } }; return { data: out[0] ? clone(out[0]) : null, error: null }; }
    return { data: clone(out), error: null };
  }
}
let MAX_ROWS = 1000; // Supabase limita a 1000 filas por petición por defecto
export const setMaxRows = (n) => { MAX_ROWS = n; };
const opts_maxRows = () => MAX_ROWS;
