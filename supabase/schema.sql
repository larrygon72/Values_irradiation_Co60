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

-- ════════════════════════════════════════════════════════════
-- AMPLIACIÓN — Irradiadores (operadores) + tiempo de exposición
-- real (miércoles de la semana) + exposición del operador en µSv
-- ════════════════════════════════════════════════════════════

-- ── TABLA: irradiadores ──────────────────────────────────────
-- Personas que operan el equipo de irradiación. Son distintas de los
-- conductores/usuarios: no inician sesión en la app, solo se eligen en
-- un desplegable al rellenar un registro. Solo un Admin puede darlos de
-- alta, editarlos o eliminarlos.
create table if not exists irradiadores (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null default '',
  apellido1  text not null default '',
  apellido2  text default '',
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table irradiadores drop column if exists codigo;
alter table irradiadores add column codigo text generated always as (
  upper(
    coalesce(nullif(left(nombre,1),''),'?') ||
    coalesce(nullif(left(apellido1,1),''),'?') ||
    case when coalesce(apellido2,'') = '' then 'X' else left(apellido2,1) end
  )
) stored;
alter table irradiadores enable row level security;

-- ── NUEVAS COLUMNAS EN registros ─────────────────────────────
-- tiempo_exposicion       -> ya existía: el tiempo TEÓRICO (tasa del día exacto)
-- tiempo_exposicion_real  -> NUEVO: el tiempo real, calculado con la tasa
--                            del MIÉRCOLES de esa semana (referencia oficial)
-- exposicion_usv          -> NUEVO: lo que ha marcado el dosímetro del
--                            operador durante la irradiación, en microsieverts
-- irradiador_id/_nombre/_codigo -> NUEVO: referencia al operador elegido
--                            en el desplegable (la columna "irradiador" de
--                            texto libre se mantiene por compatibilidad
--                            con registros antiguos, pero ya no se usa)
alter table registros add column if not exists tiempo_exposicion_real numeric;
alter table registros add column if not exists exposicion_usv numeric;
alter table registros add column if not exists irradiador_id uuid references irradiadores(id) on delete set null;
alter table registros add column if not exists irradiador_nombre text;
alter table registros add column if not exists irradiador_codigo text;

-- ════════════════════════════════════════════════════════════
-- AMPLIACIÓN — Pantalla de Conducción: viajes del vehículo y
-- repostajes de combustible, para cálculos y consultas futuras.
-- ════════════════════════════════════════════════════════════

-- ── TABLA: vehiculo_viajes ────────────────────────────────────
create table if not exists vehiculo_viajes (
  id             uuid primary key default gen_random_uuid(),
  matricula      text not null,
  fecha          date,
  km_inicial     numeric,
  km_final       numeric,
  creado_por     text not null,
  created_at     timestamptz not null default now()
);
alter table vehiculo_viajes drop column if exists km_recorridos;
alter table vehiculo_viajes add column km_recorridos numeric generated always as (
  case when km_final is not null and km_inicial is not null then km_final - km_inicial else null end
) stored;
alter table vehiculo_viajes enable row level security;

-- ── TABLA: repostajes ─────────────────────────────────────────
-- tipo_combustible: 'diesel_xtl' | 'diesel' | 'gasolina' | 'adblue'
create table if not exists repostajes (
  id                 uuid primary key default gen_random_uuid(),
  matricula          text not null,
  fecha              date,
  km                 numeric,
  importe            numeric,
  precio_litro       numeric,
  tipo_combustible   text check (tipo_combustible in ('diesel_xtl','diesel','gasolina','adblue')),
  estacion_servicio  text,
  creado_por         text not null,
  created_at         timestamptz not null default now()
);
alter table repostajes drop column if exists litros;
alter table repostajes add column litros numeric generated always as (
  case when precio_litro is not null and precio_litro > 0 and importe is not null
       then round((importe/precio_litro)::numeric,2) else null end
) stored;
alter table repostajes enable row level security;

-- ════════════════════════════════════════════════════════════
-- AMPLIACIÓN — Gestión de vehículos disponibles (matrícula +
-- número de obra). El campo "Matrícula" de Conducción pasa a ser
-- un desplegable que se rellena desde esta tabla; si la matrícula
-- buscada no existe todavía, cualquier usuario con sesión iniciada
-- puede darla de alta indicando también el número de obra. Editar,
-- desactivar o eliminar un vehículo ya existente es solo para
-- administradores (pantalla "Vehículos").
-- ════════════════════════════════════════════════════════════

-- ── TABLA: vehiculos ─────────────────────────────────────────
create table if not exists vehiculos (
  id           uuid primary key default gen_random_uuid(),
  matricula    text not null,
  numero_obra  text not null default '',
  activo       boolean not null default true,
  creado_por   text,
  created_at   timestamptz not null default now()
);
-- Matrícula única, sin distinguir mayúsculas/minúsculas
create unique index if not exists vehiculos_matricula_lower_idx on vehiculos (lower(matricula));
alter table vehiculos enable row level security;

-- ── Enlace con viajes y repostajes ───────────────────────────
-- Se mantiene la columna "matricula" de texto libre en ambas tablas
-- por compatibilidad con registros antiguos y para que el historial
-- siga mostrándose sin depender de un JOIN, pero además se guarda la
-- referencia al vehículo elegido en el desplegable (vehiculo_id),
-- que permite mostrar el número de obra junto a cada viaje/repostaje.
alter table vehiculo_viajes add column if not exists vehiculo_id uuid references vehiculos(id) on delete set null;
alter table repostajes add column if not exists vehiculo_id uuid references vehiculos(id) on delete set null;

-- ════════════════════════════════════════════════════════════
-- AMPLIACIÓN — Gestión de estaciones de servicio. El campo
-- "Estación de servicio" de Repostaje pasa a ser un desplegable
-- que se rellena desde esta tabla; si la estación buscada no
-- existe todavía, cualquier usuario con sesión iniciada puede
-- darla de alta (de momento solo con el nombre; se pueden añadir
-- más campos más adelante sin romper lo ya guardado). Editar,
-- desactivar o eliminar una estación ya existente es solo para
-- administradores (pantalla "Estaciones").
-- ════════════════════════════════════════════════════════════

-- ── TABLA: estaciones_servicio ───────────────────────────────
create table if not exists estaciones_servicio (
  id           uuid primary key default gen_random_uuid(),
  nombre       text not null,
  activo       boolean not null default true,
  creado_por   text,
  created_at   timestamptz not null default now()
);
-- Nombre único, sin distinguir mayúsculas/minúsculas
create unique index if not exists estaciones_servicio_nombre_lower_idx on estaciones_servicio (lower(nombre));
alter table estaciones_servicio enable row level security;

-- ── Enlace con repostajes ─────────────────────────────────────
-- Se mantiene la columna "estacion_servicio" de texto libre por
-- compatibilidad con registros antiguos; estacion_id es la nueva
-- referencia a la estación elegida en el desplegable.
alter table repostajes add column if not exists estacion_id uuid references estaciones_servicio(id) on delete set null;
