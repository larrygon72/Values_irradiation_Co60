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

## Próximos pasos

Con esto ya tienes: nube conectada, despliegue automático, gestión de
usuarios completa (alta, edición, borrado protegido, desbloqueo) y un
historial consultable por fechas. A partir de aquí se puede seguir
mejorando poco a poco: por ejemplo, exportar directamente el resultado
del historial filtrado a CSV/TXT, añadir más filtros (por conductor, por
semana), o estadísticas/gráficas sobre los registros guardados.
