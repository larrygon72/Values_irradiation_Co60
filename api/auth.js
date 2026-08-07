// /api/auth  — comprobar / registrar / entrar
//
// La app llama a este endpoint en tres momentos:
//   action:"check"    -> ¿existe ya este nick?
//   action:"register" -> crear un usuario nuevo (alta rápida desde el login)
//   action:"login"     -> comprobar la contraseña y abrir sesión

import bcrypt from "bcryptjs";
import { getSupabaseAdmin } from "./_lib/supabaseAdmin.js";
import { firmarToken, codigoConductor } from "./_lib/auth.js";

const MAX_INTENTOS = 3;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  const { action, nick, pass, nombre, apellido1, apellido2 } = req.body || {};
  const nickLimpio = (nick || "").trim();
  if (!nickLimpio) return res.status(400).json({ error: "Falta el usuario" });

  try {
    // ── ¿EXISTE? ──────────────────────────────────────────
    if (action === "check") {
      const { data, error } = await supabase
        .from("usuarios")
        .select("nick, locked")
        .ilike("nick", nickLimpio)
        .maybeSingle();
      if (error) throw error;
      return res.status(200).json({
        existe: !!data,
        bloqueado: data?.locked || false,
      });
    }

    // ── REGISTRO (alta rápida de un usuario nuevo) ───────
    if (action === "register") {
      if (!pass || pass.length < 4) {
        return res
          .status(400)
          .json({ error: "La contraseña debe tener al menos 4 caracteres" });
      }
      const { data: existente } = await supabase
        .from("usuarios")
        .select("id")
        .ilike("nick", nickLimpio)
        .maybeSingle();
      if (existente) {
        return res.status(409).json({ error: "Ese usuario ya existe" });
      }
      const hash = await bcrypt.hash(pass, 10);
      const { data: creado, error } = await supabase
        .from("usuarios")
        .insert({
          nick: nickLimpio,
          password_hash: hash,
          nombre: (nombre || "").trim(),
          apellido1: (apellido1 || "").trim(),
          apellido2: (apellido2 || "").trim(),
          role: "user",
          locked: false,
          intentos: 0,
        })
        .select()
        .single();
      if (error) throw error;

      const token = firmarToken(creado);
      return res.status(200).json({ ok: true, token, usuario: usuarioPublico(creado) });
    }

    // ── LOGIN ─────────────────────────────────────────────
    if (action === "login") {
      if (!pass) return res.status(400).json({ error: "Falta la contraseña" });

      const { data: u, error } = await supabase
        .from("usuarios")
        .select("*")
        .ilike("nick", nickLimpio)
        .maybeSingle();
      if (error) throw error;
      if (!u) return res.status(404).json({ error: "Usuario no encontrado" });
      if (u.locked) {
        return res
          .status(403)
          .json({ error: "Acceso bloqueado. Contacta con el administrador." });
      }

      const ok = await bcrypt.compare(pass, u.password_hash);
      if (!ok) {
        const intentos = (u.intentos || 0) + 1;
        const seBloquea = intentos >= MAX_INTENTOS;
        await supabase
          .from("usuarios")
          .update({ intentos, locked: seBloquea })
          .eq("id", u.id);
        if (seBloquea) {
          return res
            .status(403)
            .json({ error: "Bloqueado. Demasiados intentos fallidos." });
        }
        const restantes = MAX_INTENTOS - intentos;
        return res.status(401).json({
          error: `Contraseña incorrecta. Quedan ${restantes} intento${
            restantes === 1 ? "" : "s"
          }.`,
        });
      }

      if (u.intentos > 0) {
        await supabase.from("usuarios").update({ intentos: 0 }).eq("id", u.id);
      }

      const token = firmarToken(u);
      return res.status(200).json({ ok: true, token, usuario: usuarioPublico(u) });
    }

    return res.status(400).json({ error: "Acción no reconocida" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || "Error inesperado" });
  }
}

function usuarioPublico(u) {
  return {
    nick: u.nick,
    role: u.role,
    nombre: u.nombre || "",
    apellido1: u.apellido1 || "",
    apellido2: u.apellido2 || "",
    codigo:
      u.codigo || codigoConductor(u.nombre, u.apellido1, u.apellido2),
  };
}
