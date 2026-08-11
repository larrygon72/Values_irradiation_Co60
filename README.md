# Values Irradiation WEB-210 — guía de puesta en marcha

Esta app sigue siendo la misma app HTML/CSS/JS de siempre (sin frameworks,
sin paso de compilación) — toda la lógica de física del Co-60, urnas,
exportación CSV/JSON/TXT, multi-dosis, tablas semanales/mensuales y temas
sigue funcionando exactamente igual que antes. Lo que se ha añadido es una
capa de conexión a la nube:

- **Supabase** guarda los usuarios y los registros del formulario.
- **Vercel** sirve la app y ejecuta las funciones que hablan con Supabase.
- **GitHub** aloja el código para que Vercel despliegue automáticamente
  cada vez que subas cambios.

La app funciona **igual sin conexión**: si no hay internet o Supabase
todavía no está configurado, sigue usando el almacenamiento local del
navegador (como hacía antes), y en cuanto vuelve la conexión sincroniza
solo lo que falte. Verás un indicador "☁" en el menú y en el login que
te dice si estás conectado, sin conexión, o si algo ha fallado.

> **¿Ya tienes cuenta en Supabase/Vercel/GitHub por otra app?** Perfecto,
> te sirve la misma cuenta — pero esta app necesita su **propio proyecto
> nuevo** en cada sitio (su propia base de datos en Supabase, su propio
> repositorio en GitHub, su propio proyecto en Vercel). No se reutiliza
> nada de otra app: solo la cuenta con la que entras.

---

## 1. Crear la base de datos en Supabase

1. Entra en **https://supabase.com** → crea un proyecto nuevo (o usa uno
   que ya tengas). Elige una contraseña de base de datos y guárdala.
2. Dentro del proyecto, ve a **SQL Editor** → **New query**.
3. Abre el archivo [`supabase/schema.sql`](./supabase/schema.sql) de este
   proyecto, copia **todo** su contenido y pégalo ahí. Pulsa **Run**.
   - Esto crea las tablas `usuarios` y `registros`.
   - Crea automáticamente el usuario **Admin** con la contraseña **Aedes**
     (ya con la contraseña cifrada, no en texto plano).
   - Activa la seguridad (RLS) para que **solo** el propio backend de la
     app pueda leer o escribir en esas tablas — el navegador nunca accede
     directamente a Supabase.
4. Ve a **Project Settings → API** y anota estos dos valores (los
   necesitarás en el paso 3):
   - **Project URL** (algo como `https://xxxxx.supabase.co`)
   - **service_role key** (¡es secreta! nunca la pongas en el código ni
     la subas a GitHub)

---

## 2. Subir el código a GitHub

Este proyecto ya está preparado como repositorio Git local (carpeta `.git`
incluida). Solo te falta conectarlo a un repositorio remoto:

1. Entra en **https://github.com** → **New repository** (por ejemplo,
   `values-irradiation-web210`). Puede ser privado.
2. En tu terminal, dentro de la carpeta del proyecto:
   ```bash
   git remote add origin https://github.com/TU-USUARIO/values-irradiation-web210.git
   git branch -M main
   git push -u origin main
   ```
   (Sustituye la URL por la de tu repositorio.)

Si prefieres no usar la terminal, también puedes arrastrar todos los
archivos a la web de GitHub con "uploading an existing file", pero se
recomienda usar `git` para futuras actualizaciones.

> **Importante:** el archivo `.gitignore` ya excluye `node_modules/` y
> `.env` para que nunca subas claves secretas por error.

---

## 3. Desplegar en Vercel

1. Entra en **https://vercel.com** → **Add New → Project**.
2. Elige **Import Git Repository** y selecciona el repositorio que acabas
   de subir a GitHub. Vercel detectará automáticamente que es un sitio
   estático con funciones en `/api` (no hace falta configurar ningún
   "build command").
3. Antes de darle a "Deploy", abre **Environment Variables** y añade:

   | Nombre | Valor |
   |---|---|
   | `SUPABASE_URL` | la Project URL de Supabase (paso 1.4) |
   | `SUPABASE_SERVICE_ROLE_KEY` | la service_role key de Supabase (paso 1.4) |
   | `AUTH_SECRET` | una frase larga y aleatoria inventada por ti (por ejemplo, generada con `openssl rand -base64 48`) |

4. Pulsa **Deploy**. En un par de minutos tendrás una URL tipo
   `https://values-irradiation-web210.vercel.app` con la app funcionando
   y conectada a Supabase.

A partir de ahora, cada vez que hagas `git push` a la rama `main`, Vercel
volverá a desplegar automáticamente la app con los cambios.

---

## 4. Primeras pruebas

1. Abre la URL de Vercel. Entra con usuario **Admin** y contraseña
   **Aedes**.
2. Ve a **Ajustes → Gestión de usuarios** y da de alta algún conductor
   real: nick, **nombre**, **1er apellido**, (2º apellido opcional) y
   contraseña.
3. Ve al **Formulario → pestaña TRANSP**: el desplegable "Conductor /
   Responsable" ya debería mostrar a las personas dadas de alta, y al
   elegir una aparece automáticamente su código de 3 letras (por ejemplo,
   *Josep Navarro Navarro* → **JNN**; si solo tiene un apellido, la
   tercera letra es una **X**).
4. Guarda un registro de prueba: se guarda localmente (como siempre) y
   además se envía a Supabase. Puedes comprobarlo en Supabase → **Table
   Editor → registros**.

---

## Cómo funciona la gestión de usuarios

- El usuario **Admin** (contraseña inicial `Aedes`) **no puede ser
  eliminado por nadie excepto por sí mismo**. Cualquier otro
  administrador que intente borrarlo verá un mensaje de error y, en la
  lista de usuarios, el botón de eliminar se sustituye por un candado
  🔒 "protegido".
- Los usuarios se identifican con un **nick** (no un email). Al crear una
  cuenta —ya sea desde el login (alta rápida) o desde Ajustes (como
  admin)— se pide también **nombre y apellidos**, que son los que se
  usan para calcular el código de 3 letras del conductor.
- Las contraseñas nunca se guardan en texto plano en Supabase: se cifran
  con *bcrypt* en el servidor antes de guardarlas.

## Modo sin conexión

Si el dispositivo no tiene internet (o Supabase no está configurado
todavía), la app **no se bloquea**: seguirá dejando iniciar sesión, dar de
alta usuarios, elegir conductor y guardar registros, usando el
almacenamiento local del navegador — tal y como funcionaba la versión
original. En cuanto vuelva la conexión:
- Los registros guardados mientras estabas sin conexión se sincronizan
  solos con Supabase (lo verás en la pantalla de Registros como "⏳
  pendiente" y luego "☁ sincronizado").
- Los usuarios y conductores dados de alta sin conexión quedan solo en
  ese dispositivo hasta que se puedan volver a crear con conexión (esto
  es una limitación conocida: sin servidor no hay forma segura de repartir
  esas altas a otros dispositivos).

## Estructura de archivos añadidos/modificados

```
index.html          → pantallas: login con alta (nombre/apellidos),
                       indicador de nube, desplegable de conductor,
                       gestión de usuarios ampliada
css/app.css          → estilos nuevos (indicador de nube, formulario de alta)
js/app.js            → toda la lógica original intacta + capa de nube
                       (login/registro, sync de registros, gestión de
                       usuarios, código de conductor)
api/auth.js           → comprobar usuario / registrar / login
api/usuarios.js       → listar, crear, eliminar, desbloquear usuarios
api/registros.js      → guardar y listar registros en Supabase
api/_lib/              → utilidades compartidas (token de sesión, cliente
                       de Supabase con permisos de servidor)
supabase/schema.sql   → esquema completo de la base de datos
package.json          → dependencias de las funciones de Vercel
vercel.json           → cabeceras de seguridad
.env.example          → referencia de variables de entorno necesarias
```

## Historial de registros (nube, filtrado y exportable)

Desde el menú principal → icono **Historial** se abre una pantalla nueva
que consulta directamente Supabase (no el almacenamiento local):

- Al entrar, carga automáticamente los **últimos 30 días**.
- Puedes elegir cualquier rango con **Desde / Hasta** y pulsar **Buscar**.
- Filtros adicionales sobre esos resultados: **conductor**, **usuario que
  lo guardó**, **semana ISO** y una **búsqueda de texto libre** (mira en
  irradiador, observaciones, conductor y usuario). Los desplegables de
  conductor/usuario se rellenan solos con los valores que aparecen en los
  resultados de la búsqueda por fechas.
- **Exportar** el resultado filtrado a **CSV**, **Excel (.xlsx)** o
  **PDF** con un botón — usa las mismas librerías (SheetJS y jsPDF,
  cargadas desde CDN) y el mismo diálogo de confirmación "Exportación
  completada" que ya usaba el resto de la app.
- Cada registro muestra quién lo guardó. Se puede **eliminar**: cualquier
  usuario puede borrar los que él mismo guardó, y un **Admin puede borrar
  cualquiera**.

> Nota de diseño: la búsqueda por fechas se hace en Supabase (rápido,
> aunque haya miles de registros); los filtros adicionales (conductor,
> usuario, semana, texto) se aplican después, sobre esos resultados ya
> descargados. Para un cuaderno de irradiación de este tipo (decenas o
> cientos de registros al mes) es más que suficiente y evita tener que
> mantener una consulta dinámica compleja en el backend.

## Varios usuarios, varios dispositivos, a la vez

La app ya está preparada para esto por diseño, sin nada que activar:

- Cada usuario inicia sesión de forma independiente (móvil, tablet, PC…)
  y recibe su propio token de sesión. No hay "un solo usuario a la vez"
  en ningún sitio del código.
- Cada acción (guardar un registro, dar de alta un usuario, consultar el
  historial…) es una petición independiente a `/api/*`, que a su vez
  escribe directamente en Supabase. Dos personas guardando registros al
  mismo tiempo desde dispositivos distintos no chocan entre sí: cada
  registro es una fila nueva en la tabla `registros`.
- El único caso de "quien llega último gana" es si dos personas editan
  **el mismo** usuario a la vez desde Ajustes — un caso raro y sin
  consecuencias graves (se aplica el último guardado).
- La interfaz ya es responsive: en el móvil ocupa toda la pantalla, y en
  PC/tablet se centra en una tarjeta de hasta 680px de ancho — no hace
  falta ninguna versión "de escritorio" aparte.

## Edición de usuarios existentes

En **Ajustes → Gestión de usuarios**, cada usuario tiene ahora un botón
**✏️ Editar** que abre un pequeño formulario para cambiar su nombre,
apellidos, rol o asignarle una nueva contraseña (dejar el campo de
contraseña en blanco si no quieres cambiarla). Al guardar, el código de
conductor de 3 letras se recalcula automáticamente si cambian el nombre o
los apellidos.

Igual que con el borrado, el **rol** del usuario "Admin" solo puede
cambiarlo el propio "Admin" — ningún otro administrador puede quitarle o
darle el rol de administrador a esa cuenta, para evitar quedarse sin
ningún admin por accidente.

## Gráficas del historial

En la pantalla **Historial**, junto al botón "📋 Lista" hay otro "📊
Gráficas". Al activarlo puedes elegir qué representar (con un
desplegable) sobre los registros que tengas filtrados en ese momento:

- **Temperaturas** (inicial, final y media) a lo largo de las fechas
- **Tasa de dosis** (Gy/s)
- **Tiempo de exposición** (s)
- **Nº de urnas**
- **Registros por semana** (para ver el volumen de trabajo)

Las gráficas se generan con [Chart.js](https://www.chartjs.org/) cargado
desde CDN, y se redibujan solas si cambias los filtros mientras estás en
esa vista.

## Notificaciones: "alguien ha guardado un registro"

Con la app abierta (en cualquier pantalla, no hace falta estar en
Historial), cada usuario comprueba cada 25 segundos si **algún otro
usuario** ha guardado un registro nuevo, y si es así:

- Aparece un aviso dentro de la app (toast) con quién lo guardó y de qué
  fecha/conductor.
- Si además el usuario ha activado las notificaciones del navegador
  (**Ajustes → Notificaciones → Activar**) y la pestaña está en segundo
  plano, también salta una notificación nativa del sistema operativo.

> **Cómo funciona por dentro:** en vez de una conexión en tiempo real
> (websocket) directa a Supabase, usamos un sondeo periódico contra
> nuestro propio backend (`/api/registros`, acción `nuevos`), protegido
> por el mismo login de siempre. Se ha elegido así a propósito: mantiene
> exactamente el mismo modelo de seguridad que el resto de la app (el
> navegador nunca habla directamente con Supabase) y es más que
> suficiente para este uso — no hace falta saber al milisegundo que
> alguien ha guardado un registro. Si en el futuro quieres notificaciones
> push de verdad (que lleguen aunque tengas la app cerrada, como una app
> del móvil), es una mejora aparte que requiere activar permisos del
> navegador y un pequeño servicio adicional — lo podemos montar cuando
> quieras.

## Mejoras de experiencia de usuario

- **Diálogos de confirmación propios**: los "¿Eliminar...?" ya no usan la
  ventana gris del navegador — tienen el mismo estilo que el resto de la
  app, y funcionan igual en modo diurno y nocturno.
- **Textos de ayuda**: los campos que se calculan solos (tasa, código de
  conductor, temperatura media, tiempo de exposición) tienen ahora una
  pequeña explicación debajo, pensada para quien usa la app por primera vez.
- **App instalable (PWA)**: en el móvil se puede "Añadir a pantalla de
  inicio" y se abre a pantalla completa, sin la barra del navegador, como
  una app normal. También se puede instalar en PC (Chrome/Edge: icono de
  instalar en la barra de direcciones). Además, un Service Worker guarda
  una copia de la propia app (HTML/CSS/JS) para que cargue incluso sin
  conexión desde el primer segundo — los datos siguen funcionando igual
  que siempre (Supabase + localStorage), esto solo afecta a "la app en sí".
- **Tema automático**: si nunca has tocado el interruptor de tema, la app
  arranca con el modo claro u oscuro que ya tengas configurado en tu
  móvil u ordenador. En cuanto lo cambias manualmente una vez, se queda
  fijo con tu elección.
- **Estados de carga**: la búsqueda del Historial y el botón "Entrar" del
  login muestran un pequeño spinner mientras esperan respuesta del
  servidor, en vez de quedarse "parados" sin más.
- **Sin duplicados por doble clic**: el botón "Guardar" del formulario se
  desactiva y muestra "Guardando…" mientras se sincroniza con la nube, y
  se reactiva solo al terminar.

## Fase 1 del rediseño profesional — Sistema de diseño base

A partir de un encargo detallado de rediseño completo ("plataforma SaaS
científica profesional"), se está aplicando en fases. La Fase 1 (sistema
de diseño base) ya está lista:

- **Paleta exacta**: Light = Royal Blue `#2563EB` → Sky `#38BDF8` →
  Turquoise `#14B8A6`. Dark = Navy `#172554` → Lavender `#A78BFA` →
  Aubergine `#6D28D9`. Los tonos más claros (Sky, Turquoise, Lavender)
  tienen una variante "profunda" calculada por contraste WCAG para uso en
  botones/badges con texto blanco — el color puro se reserva para
  detalles, texto en degradado y acentos, tal y como pide el criterio de
  "no abusar del degradado".
- **Tipografía nueva**: Manrope (títulos), Inter (texto), IBM Plex Mono
  (valores numéricos y campos automáticos — tasa, código de conductor,
  temperaturas).
- **Menos "HUD"**: se ha quitado el uppercase+tracking agresivo y los
  resplandores de neón de botones, títulos y tablas, dejando sombras
  suaves y texto en caja normal, como pide el punto 3-4 del encargo.
- **Fondo neutro**: el degradado ya NO cubre toda la pantalla — se
  reserva para el botón principal, el título de marca y algún acento
  puntual (login), y el resto de la interfaz vuelve a ser blanca/neutra
  en claro y navy suave en oscuro.
- **Selector de tema de 3 vías**: Claro / Oscuro / **Sistema** (nuevo) en
  Ajustes. En modo Sistema, si cambias el tema del móvil mientras tienes
  la app abierta, se actualiza sola sin recargar.
- Jerarquía de botones ampliada con la variante **Ghost** (sin fondo).

**Quedan pendientes** las fases 2 a 5 del encargo (Dashboard + navegación
con sidebar/bottom-nav, formulario con stepper y urnas como tarjetas,
historial como tabla profesional con panel de detalle, y estadísticas/
microinteracciones/accesibilidad) — son cambios estructurales grandes que
se están abordando por partes para poder probar cada uno a fondo.

## Fase 2 del rediseño profesional — Dashboard + navegación

- **Dashboard nuevo** como pantalla de inicio tras el login: saludo según
  la hora del día, 4 tarjetas KPI (dosis configurada, registros de hoy,
  irradiaciones completadas, pendientes de sincronizar — con datos reales
  de Supabase cuando hay conexión, o del dispositivo si no la hay) y
  actividad reciente con badges de estado, clicable.
- **Sidebar en escritorio** (≥900px): logo, navegación agrupada
  (Principal / Operación / Análisis / Administración — este último solo
  visible para administradores), usuario actual, estado de conexión y
  cerrar sesión.
- **Barra inferior + menú "Más" en móvil**: Inicio, Nuevo registro,
  Historial siempre visibles; el resto de secciones en un panel lateral
  deslizante.
- **Usuarios** ahora es su propia pantalla (antes vivía dentro de
  Ajustes), protegida: si alguien sin rol de administrador intenta entrar
  por URL o navegación, se le redirige al Dashboard.
- El antiguo menú (con la calculadora de tiempo de irradiación) no se ha
  perdido — vive ahora dentro de "Herramientas rápidas", plegado, en el
  propio Dashboard.

> Nota sobre las capturas: se han generado renderizando el CSS/HTML real
> de la app con un motor de renderizado antiguo (no soporta CSS Grid), así
> que en esas imágenes concretas las tarjetas KPI se ven apiladas en una
> columna en vez de en cuadrícula — en cualquier navegador actual
> (Chrome, Safari, Firefox, Edge) se ven correctamente en cuadrícula.

**Quedan pendientes** las fases 3 a 5 (formulario con stepper y urnas
como tarjetas, historial como tabla con panel de detalle, estadísticas/
gráficos/microinteracciones/accesibilidad).

## Fase 3 del rediseño profesional — Formulario con stepper + Urnas como tarjetas

- **Stepper numerado** en el formulario: ① Datos → ② Transporte →
  ③ Temperatura → ④ Irradiación → ⑤ Observaciones. Cada paso muestra si
  está pendiente (número), activo (resaltado) o completado (✓ verde),
  calculado en tiempo real según lo que ya has rellenado — nunca se
  pierde nada al cambiar de sección.
- **Urnas como tarjetas**, visibles directamente en el primer paso (antes
  había que pulsar un botón para verlas): cada tarjeta muestra el número
  de urna, si tiene datos (✓) o no (—), las unidades y el lote. Al tocar
  una tarjeta se abre el mismo editor de siempre, directamente en esa
  urna. El total de unidades sigue mostrándose igual que antes.
- **Campos automáticos más reconocibles**: además de la etiqueta "auto"
  ya existente, ahora llevan un icono ⚙ y un borde de color a la
  izquierda para distinguirlos de un vistazo de los campos que hay que
  rellenar a mano.

**Quedan pendientes** las fases 4 y 5 (historial como tabla profesional
con panel de detalle y acciones editar/duplicar, y estadísticas/gráficos/
microinteracciones/accesibilidad).

## Fase 4 del rediseño profesional — Historial como tabla + panel de detalle

- **Historial ahora es una tabla de verdad** en escritorio (Fecha,
  Conductor, Urnas, Dosis, Estado — las columnas se pueden ordenar
  pulsando su cabecera), y sigue siendo tarjetas en móvil, tal como pide
  el encargo.
- **Barra de búsqueda** destacada arriba del todo, y los filtros
  (fechas, conductor, usuario, **irradiador** y **estado** — estos dos
  últimos son nuevos) ahora están plegados dentro de "Filtros" para no
  saturar la pantalla.
- **Estado Completada/Incompleta**: un registro se considera completado
  si tiene registrada la hora de fin de irradiación. Se ve como badge en
  la tabla, en las tarjetas y se puede filtrar por él.
- **Panel de detalle**: al tocar cualquier fila o tarjeta se abre una
  ficha completa del registro (identificación, datos de irradiación,
  transporte, temperatura, observaciones, quién y cuándo lo guardó), con
  4 acciones:
  - **Editar** — carga el registro en el formulario; al guardar,
    actualiza ese mismo registro en vez de crear uno nuevo.
  - **Duplicar** — carga los mismos datos en el formulario para crear un
    registro nuevo a partir de uno existente.
  - **Exportar** — descarga ese registro concreto en CSV.
  - **Eliminar** — igual que antes, con confirmación.
  - Por permisos: un usuario normal solo puede editar/eliminar sus
    propios registros; un Admin puede hacerlo con cualquiera.
- La "Dosis" de la tabla se calcula a partir de la tasa y el tiempo de
  exposición guardados (no existía como campo propio) — es la dosis real
  que se programó ese día, no un valor fijo.

**Queda pendiente** la Fase 5, la última: estadísticas/gráficos más
pulidos, microinteracciones y una pasada de accesibilidad.

## Fase 5 del rediseño profesional — Estadísticas, microinteracciones y accesibilidad

Con esto se completan las 5 fases del encargo de rediseño.

- **Resumen de dosis en el Dashboard**: 3 tarjetas (Hoy / Semana / Mes)
  con la dosis realmente irradiada, calculada a partir de los registros
  guardados (no un número fijo) — más una gráfica de barras con la
  tendencia de los últimos días.
- **Gráficas con la paleta del tema activo de verdad**: antes tenían
  colores fijos; ahora leen los colores en el momento de dibujarse, así
  que en modo claro usan Royal/Sky/Turquesa y en modo oscuro Navy/
  Lavanda/Berenjena automáticamente — y si cambias de tema estando en la
  pantalla de gráficas, se redibujan solas con los colores correctos.
  También se ha quitado la cuadrícula vertical (queda solo la horizontal,
  más limpia) y los tooltips ahora indican la unidad (Gy, °C, s...).
- **Microinteracciones**: las tarjetas (KPIs, urnas, resumen, actividad,
  filas de tabla) aparecen con una animación muy sutil (~200ms) en vez de
  aparecer de golpe; cambiar de tema ya no "salta" bruscamente entre
  colores. Quien tenga activado "reducir movimiento" en su dispositivo no
  ve ninguna de estas animaciones (se respeta esa preferencia).
- **Accesibilidad**: anillo de foco visible y consistente en todos los
  botones/campos al navegar con teclado (antes dependía del estilo por
  defecto del navegador); los botones que solo tenían un icono (✕ cerrar
  detalle, ✕ cerrar menú) ahora llevan una descripción para lectores de
  pantalla. El contraste de color ya se validó matemáticamente en la
  Fase 1, y los estados (Completada/Pendiente/Error...) siempre se
  comunican con icono + texto, nunca solo con color.

## Resumen del rediseño completo

| Fase | Contenido |
|---|---|
| 1 | Paleta exacta, tipografía, menos "HUD", tema de 3 vías |
| 2 | Dashboard, sidebar/bottom-nav, navegación agrupada, pantalla Usuarios |
| 3 | Stepper del formulario, urnas como tarjetas |
| 4 | Historial como tabla + panel de detalle (editar/duplicar/exportar) |
| 5 | Resumen de dosis, gráficas con tema dinámico, microinteracciones, accesibilidad |

Todo lo anterior mantiene el 100% de la lógica y funcionalidad que ya
existía (Supabase, offline, exportaciones, notificaciones, cálculos
automáticos...) — solo se ha rediseñado la experiencia visual y de
navegación, tal y como se pidió.

## Próximos pasos

Con esto ya tienes: nube conectada, despliegue automático, gestión de
usuarios completa (alta, edición, borrado protegido, desbloqueo) y un
historial consultable por fechas. A partir de aquí se puede seguir
mejorando poco a poco: por ejemplo, exportar directamente el resultado
del historial filtrado a CSV/TXT, añadir más filtros (por conductor, por
semana), o estadísticas/gráficas sobre los registros guardados.
