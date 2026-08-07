-- ════════════════════════════════════════════════════════════
-- VALUES IRRADIATION WEB-210 — esquema de Supabase
-- ════════════════════════════════════════════════════════════
-- Cómo usar este archivo:
-- 1. Entra en tu proyecto de https://supabase.com
-- 2. Ve a "SQL Editor" → "New query"
-- 3. Pega TODO este archivo y pulsa "Run"
-- Se puede ejecutar varias veces sin problema (usa IF NOT EXISTS).
-- ════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── TABLA: usuarios ──────────────────────────────────────────
-- Cada usuario se identifica con un "nick" (no un email). La contraseña
-- nunca se guarda en texto plano, solo su hash (bcrypt), y el hash solo
-- lo maneja el backend (funciones /api/*.js de Vercel), nunca el navegador.
create table if not exists usuarios (
  id             uuid primary key default gen_random_uuid(),
  nick           text not null,
  password_hash  text not null,
  nombre         text not null default '',
  apellido1      text not null default '',
  apellido2      text default '',
  role           text not null default 'user' check (role in ('user','admin')),
  locked         boolean not null default false,
  intentos       int not null default 0,
  created_at     timestamptz not null default now()
);

-- Nick único, sin distinguir mayúsculas/minúsculas ("Admin" = "admin")
create unique index if not exists usuarios_nick_lower_idx on usuarios (lower(nick));

-- Columna calculada con el código de 3 letras del conductor:
-- 1ª letra del nombre + 1ª letra del primer apellido + 1ª letra del
-- segundo apellido (o "X" si no tiene segundo apellido).
-- Ej: Josep Navarro Navarro -> JNN · Josep Navarro (sin 2º apellido) -> JNX
alter table usuarios drop column if exists codigo;
alter table usuarios add column codigo text generated always as (
  upper(
    coalesce(nullif(left(nombre,1),''),'?') ||
    coalesce(nullif(left(apellido1,1),''),'?') ||
    case when coalesce(apellido2,'') = '' then 'X' else left(apellido2,1) end
  )
) stored;

-- ── TABLA: registros ─────────────────────────────────────────
-- Un registro por cada entrada guardada desde el formulario de la app.
create table if not exists registros (
  id                 uuid primary key default gen_random_uuid(),
  creado_por         text not null,          -- nick de quien lo guardó
  fecha_irradiacion  date,
  semana_iso         int,
  tasa               numeric,
  tiempo_exposicion  numeric,
  n_urnas            int,
  urna1              jsonb,
  urna2              jsonb,
  urna3              jsonb,
  conductor_nick     text,
  conductor_nombre   text,
  conductor_codigo   text,
  h_ida_inicio       text,
  h_ida_llegada      text,
  h_vuelta_inicio    text,
  h_vuelta_llegada   text,
  temp_inicial       numeric,
  temp_final         numeric,
  temp_media         numeric,
  irradiador         text,
  dosimetros         int,
  h_inicio_irr       text,
  h_fin_irr          text,
  observaciones      text,
  created_at         timestamptz not null default now()
);

create index if not exists registros_fecha_idx on registros (fecha_irradiacion desc);
create index if not exists registros_creado_por_idx on registros (creado_por);

-- ── SEGURIDAD (RLS) ──────────────────────────────────────────
-- Activamos Row Level Security y NO añadimos ninguna "policy".
-- Esto bloquea el acceso a estas tablas desde el navegador (clave "anon"),
-- incluso si alguien llegara a ver esa clave pública. Solo las funciones
-- serverless de /api (que usan la clave secreta "service_role") pueden
-- leer y escribir aquí. Es la forma más segura de hacerlo sin tener que
-- diseñar políticas RLS complejas para un login basado en "nick".
alter table usuarios enable row level security;
alter table registros enable row level security;

-- ── USUARIO ADMIN POR DEFECTO ────────────────────────────────
-- nick: Admin · contraseña: Aedes
-- (el hash de abajo corresponde exactamente a la contraseña "Aedes")
-- Este usuario NO se puede borrar excepto por sí mismo (esa regla vive
-- en /api/usuarios.js, a nivel de código, igual que en la app original).
insert into usuarios (nick, password_hash, nombre, apellido1, apellido2, role, locked, intentos)
select 'Admin', '$2b$10$g3dxTMRKRu9jRJcc4d/Mi.IoeqRQlMYSBpmttJshwdHjEbf9u0.xm', 'Admin', 'Admin', '', 'admin', false, 0
where not exists (select 1 from usuarios where lower(nick) = 'admin');
