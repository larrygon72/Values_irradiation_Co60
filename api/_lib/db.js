// Utilidades de base de datos compartidas por todas las funciones de /api.

// PostgREST/Postgres tratan "%" y "_" como comodines en ilike/like. Si el nick
// (o cualquier texto) que llega del navegador se pasa tal cual, un valor como
// "%" coincide con TODOS los registros — y con ello un "eliminar" o "editar"
// podría afectar a todos los usuarios. Esta función los "escapa" para que la
// comparación sea literal (aunque siga sin distinguir mayúsculas/minúsculas).
export function escapeLike(valor) {
  return String(valor ?? "").replace(/[\\%_]/g, "\\$&");
}

// Comparación literal, sin distinguir mayúsculas, de una columna de texto.
export function igualCI(query, columna, valor) {
  return query.ilike(columna, escapeLike(valor));
}

// ¿El error de Supabase se debe a que la columna/tabla todavía no existe
// (esquema sin actualizar)? Así las funciones críticas pueden seguir
// funcionando mientras el administrador ejecuta el SQL nuevo.
export function esErrorEsquema(error) {
  if (!error) return false;
  const code = String(error.code || "");
  const msg = String(error.message || "").toLowerCase();
  return (
    code === "42703" || // undefined_column
    code === "42P01" || // undefined_table
    code === "PGRST204" || // columna no encontrada en la caché del esquema
    code === "PGRST205" || // tabla no encontrada en la caché del esquema
    (msg.includes("column") && (msg.includes("does not exist") || msg.includes("schema cache"))) ||
    (msg.includes("relation") && msg.includes("does not exist"))
  );
}

export function esViolacionUnica(error) {
  return !!error && String(error.code) === "23505";
}

// Lee TODAS las filas de una consulta paginando de 1000 en 1000 (Supabase
// devuelve como máximo 1000 filas por petición: un .limit(5000) no lo evita).
// `construir` debe devolver una consulta NUEVA en cada llamada, ya ordenada.
export async function leerTodo(construir, { pagina = 1000, maximo = 10000 } = {}) {
  const filas = [];
  for (let desde = 0; desde < maximo; desde += pagina) {
    const { data, error } = await construir().range(desde, desde + pagina - 1);
    if (error) throw error;
    filas.push(...(data || []));
    if (!data || data.length < pagina) return { filas, truncado: false };
  }
  return { filas, truncado: true };
}
