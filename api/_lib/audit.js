// Registro de auditoría: quién hizo qué y cuándo (borrados, ediciones,
// cambios de usuarios…). Es "de mejor esfuerzo": si falla (p. ej. porque la
// tabla "auditoria" aún no existe) NUNCA rompe la operación principal.

export async function auditar(supabase, sesion, accion, entidad, entidadId, detalle) {
  try {
    const { error } = await supabase.from("auditoria").insert({
      usuario_nick: sesion?.nick || null,
      accion,
      entidad,
      entidad_id: entidadId != null ? String(entidadId) : null,
      detalle: detalle || null,
    });
    if (error && !["42P01", "PGRST205"].includes(String(error.code))) {
      console.warn("Auditoría no registrada:", error.message);
    }
  } catch (err) {
    console.warn("Auditoría no registrada:", err?.message || err);
  }
}
