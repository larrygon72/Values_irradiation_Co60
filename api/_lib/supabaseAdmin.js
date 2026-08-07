// Cliente de Supabase con la clave "service_role". Esta clave puede saltarse
// cualquier restricción de seguridad (RLS), así que SOLO se usa aquí, en el
// servidor de Vercel, y nunca se envía al navegador.

import { createClient } from "@supabase/supabase-js";

let cached = null;

export function getSupabaseAdmin() {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Faltan las variables de entorno SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en Vercel."
    );
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
