// ════════════════════════════════════════════════════
// VALUES IRRADIATION WEB-210 — app.js
// ════════════════════════════════════════════════════

// ── PHYSICS Co-60 ────────────────────────────────────
const REF   = new Date(2024, 9, 16);
const RR    = 0.27621757;
const LAM   = Math.LN2 / (5.271 * 365.25);
const msDay = 86400000;

function rate(d)    { return RR * Math.exp(-LAM * (d - REF) / msDay); }
function tExp(gy,d) { const r=rate(d); return r>0 ? gy/r : 0; }
function miercolesDeLaSemana(d) {
  const dt=new Date(d); dt.setHours(0,0,0,0);
  const dow=dt.getDay(); // 0=domingo…6=sábado
  const diff=3-(dow===0?7:dow); // ISO: miércoles=3, domingo tratado como 7
  dt.setDate(dt.getDate()+diff);
  return dt;
}

function isoWk(d) {
  const dt=new Date(d); dt.setHours(0,0,0,0);
  dt.setDate(dt.getDate()+3-(dt.getDay()+6)%7);
  const w1=new Date(dt.getFullYear(),0,4);
  return 1+Math.round(((dt-w1)/msDay-3+(w1.getDay()+6)%7)/7);
}
function fmt(d) {
  if(!d) return '';
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}
function pd(s)  { if(!s) return null; const[y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); }
function tod(d) { if(!d) return ''; return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

// ── Versión y ajustes generales ───────────────────────
const APP_VERSION = '2.0';
const RESTAURAR_SESION = true;   // al reabrir la app, seguir dentro si el token (12 h) sigue vigente

// ── SEGURIDAD: escape de HTML ─────────────────────────
// Todo texto que venga de la base de datos o de otros usuarios (nombres,
// matrículas, observaciones…) y se meta en un innerHTML DEBE pasar por esc().
// Sin esto, un usuario podía guardar código en "Observaciones" o en su nombre
// y ejecutarlo en el navegador de quien abriese el Historial (p. ej. un admin).
const _ESC_MAP = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => _ESC_MAP[c]); }
// Para poner un texto DENTRO de un onclick="fn('…')": se escapa como cadena JS y luego como HTML.
function escJs(s) { return esc(String(s ?? '').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/[\r\n]+/g,' ')); }
// Celda de CSV segura: comillas dobles escapadas y neutraliza las "fórmulas" (=, +, -, @) que Excel
// ejecutaría al abrir el archivo (inyección de fórmulas). Los números negativos y horas como -0:30 se respetan.
function csvCell(v) {
  let t = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(t) && !/^-?\d+([.,]\d+)?$/.test(t) && !/^-\d+:\d{2}$/.test(t)) t = "'" + t;
  return '"' + t.replace(/"/g,'""') + '"';
}
function csvFila(fila) { return fila.map(csvCell).join(','); }
function nuevoUid() {
  try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch {}
  return 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

// ── Carga de librerías bajo demanda (Chart.js, Excel, PDF) ──
// Están alojadas en /vendor y solo se descargan la primera vez que se usan.
const LIBS = {
  chart: ['vendor/chart-4.5.0.umd.min.js'],
  xlsx:  ['vendor/xlsx-0.18.5.full.min.js'],
  pdf:   ['vendor/jspdf-2.5.1.umd.min.js', 'vendor/jspdf-autotable-3.8.2.min.js'], // el plugin necesita jsPDF antes
};
const _libProm = {};
function cargarScript(src) {
  return new Promise((ok, ko) => {
    const el = document.createElement('script');
    el.src = src; el.async = false;
    el.onload = ok; el.onerror = () => ko(new Error('No se pudo cargar ' + src));
    document.head.appendChild(el);
  });
}
function cargarLib(nombre) {
  if (_libProm[nombre]) return _libProm[nombre];
  const p = (async () => { for (const src of LIBS[nombre]) await cargarScript(src); })();
  p.catch(() => { delete _libProm[nombre]; });   // si falla (sin conexión), se puede reintentar
  return (_libProm[nombre] = p);
}

// ── STATE ─────────────────────────────────────────────
const S = {
  user:null, isAdmin:false, dose:70, staged:[],
  urna1:{n:'',date:'',lote:''},
  urna2:{n:'',date:'',lote:''},
  urna3:{n:'',date:'',lote:''},
  md:[0,0,0,0,0,0],
  exCtx:'form',
  histVista:'lista', histRaw:[], histFiltered:[],
  informesRaw:[], informesTipo:'registros', informesTodo:[], informesBuscado:false, informesPeriodo:null,
  histSort:{campo:'fecha_irradiacion',dir:'desc'},
  editingId:null, detRegistro:null,
  dashRegs:[],
  lastCheck:null, offline:false, dashCache:null
};
let _systemThemeMQ=null;

const LS = {
  dose()   { return parseFloat(localStorage.getItem('vi_d')||'70')||70 },
  setD(d)  { localStorage.setItem('vi_d',String(d)) },
  staged() { try{return JSON.parse(localStorage.getItem('vi_s')||'[]')}catch{return []} },
  setS(s)  { localStorage.setItem('vi_s',JSON.stringify(s)) },
  md()     { try{return JSON.parse(localStorage.getItem('vi_md')||'[0,0,0,0,0,0]')}catch{return [0,0,0,0,0,0]} },
  setMD(m) { localStorage.setItem('vi_md',JSON.stringify(m)) },
  themePref(){
    const saved = localStorage.getItem('vi_theme');
    return (saved==='light'||saved==='dark'||saved==='system') ? saved : 'system';
  },
  setThemePref(t){ localStorage.setItem('vi_theme', (t==='light'||t==='dark')?t:'system') },
  // ── Sesión / nube ──
  token()     { return localStorage.getItem('vi_tok')||'' },
  setToken(t) { if(t) localStorage.setItem('vi_tok',t); else localStorage.removeItem('vi_tok') },
  session()   { try{return JSON.parse(localStorage.getItem('vi_sess')||'null')}catch{return null} },
  setSession(s){ if(s) localStorage.setItem('vi_sess',JSON.stringify(s)); else localStorage.removeItem('vi_sess') },
  driverCache() { try{return JSON.parse(localStorage.getItem('vi_drivers')||'[]')}catch{return []} },
  setDriverCache(d){ localStorage.setItem('vi_drivers',JSON.stringify(d||[])) },
  irradiadorCache() { try{return JSON.parse(localStorage.getItem('vi_irr')||'[]')}catch{return []} },
  setIrradiadorCache(d){ localStorage.setItem('vi_irr',JSON.stringify(d||[])) },
  vehiculoCache() { try{return JSON.parse(localStorage.getItem('vi_veh')||'[]')}catch{return []} },
  setVehiculoCache(d){ localStorage.setItem('vi_veh',JSON.stringify(d||[])) },
  estacionCache() { try{return JSON.parse(localStorage.getItem('vi_est')||'[]')}catch{return []} },
  setEstacionCache(d){ localStorage.setItem('vi_est',JSON.stringify(d||[])) },
  pending()   { try{return JSON.parse(localStorage.getItem('vi_pend')||'[]')}catch{return []} },
  setPending(p){ localStorage.setItem('vi_pend',JSON.stringify(p||[])) },
  // Registros que el servidor ha rechazado por datos no válidos (no se pierden: se avisa y se conservan aquí)
  rejected()  { try{return JSON.parse(localStorage.getItem('vi_rej')||'[]')}catch{return []} },
  setRejected(r){ localStorage.setItem('vi_rej',JSON.stringify(r||[])) },
  helpSeen()  { return localStorage.getItem('vi_help_v1')==='1' },
  setHelpSeen(){ localStorage.setItem('vi_help_v1','1') },
  // Credenciales para entrar SIN conexión: solo un "hash" (PBKDF2) de cada usuario que ya entró antes
  // con conexión en este dispositivo — nunca la contraseña en claro.
  off()       { try{return JSON.parse(localStorage.getItem('vi_off')||'{}')}catch{return {}} },
  setOff(o)   { localStorage.setItem('vi_off',JSON.stringify(o||{})) },
};

// ════════════════════════════════════════════════════
// CLOUD — comunicación con Supabase a través de /api/*
// Si no hay conexión (o Supabase aún no está configurado), todas las
// funciones que usan esto caen automáticamente en el almacenamiento
// local (localStorage), exactamente como funcionaba la app antes.
// ════════════════════════════════════════════════════
const API = '/api';

async function apiPost(path, body) {
  let res;
  const ctrl = new AbortController();
  const timeoutId = setTimeout(()=>ctrl.abort(), 12000);
  try {
    res = await fetch(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: ctrl.signal
    });
  } catch (e) {
    const err = new Error('Sin conexión con el servidor');
    err.isNetwork = true;
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error((data && data.error) || ('Error ' + res.status));
    err.status = res.status;
    err.code = data && data.code;
    // Sesión caducada o revocada (p. ej. cambio de contraseña): volver al login con un aviso claro
    if (res.status === 401 && err.code === 'SESION_CADUCADA' && body && body.token) manejarSesionCaducada();
    // Contraseña inicial sin cambiar: el servidor no deja hacer nada más hasta que se cambie
    else if (res.status === 403 && err.code === 'DEBE_CAMBIAR_PASS') abrirCambioPass(true);
    throw err;
  }
  return data || {};
}
let _sesionCaducadaEnCurso = false;
function manejarSesionCaducada() {
  if (!S.user && !LS.token()) return;
  if (_sesionCaducadaEnCurso) return;
  _sesionCaducadaEnCurso = true;
  logout();
  showErr('Tu sesión ha caducado. Vuelve a entrar para continuar.');
  setTimeout(() => { _sesionCaducadaEnCurso = false; }, 1500);
}

// Indicador visual de conexión con la nube (badge del menú + login)
function setCloudState(state) {
  const MAP = {
    ok:  { cls:'ok',  txt:'☁ Conectado' },
    off: { cls:'off', txt:'☁ Sin conexión (modo local)' },
    err: { cls:'err', txt:'☁ Error de sincronización' },
  };
  const info = MAP[state] || { cls:'', txt:'☁ …' };
  const b = document.getElementById('cloudbdg');
  if (b) { b.className = 'cloudbdg ' + info.cls; b.textContent = info.txt.split(' (')[0]; b.title = info.txt; }
  const l = document.getElementById('lcloud');
  if (l) { l.className = 'lcloud ' + info.cls; l.textContent = state ? info.txt : ''; }
}

// Código de 3 letras del conductor (igual algoritmo que en el backend)
function codigoConductor(nombre, ap1, ap2) {
  const l1 = (nombre||'').trim().charAt(0) || '?';
  const l2 = (ap1||'').trim().charAt(0) || '?';
  const l3 = (ap2||'').trim().charAt(0) || 'X';
  return (l1+l2+l3).toUpperCase();
}

// ── Desplegable de conductores (formulario) ──────────
async function refreshDrivers() {
  try {
    const data = await apiPost('/usuarios', { action:'listPublic', token: LS.token() });
    LS.setDriverCache(data.usuarios || []);
    setCloudState('ok');
  } catch (e) {
    // Sin conexión (o error): se sigue usando la última lista descargada.
    setCloudState(e.isNetwork ? 'off' : 'err');
  }
  return LS.driverCache();
}
function populateConductorSelect(drivers) {
  const sel = document.getElementById('fResp');
  if (!sel) return;
  const list = drivers || LS.driverCache();
  const current = sel.value;
  sel.innerHTML = '<option value="">— Selecciona conductor —</option>' +
    list.map(u => {
      const nombreCompleto = [u.nombre,u.apellido1,u.apellido2].filter(Boolean).join(' ') || u.nick;
      return `<option value="${esc(u.nick)}">${esc(nombreCompleto)}</option>`;
    }).join('');
  if (list.some(u => u.nick === current)) sel.value = current;
  onConductorChange();
}
function onConductorChange() {
  const sel = document.getElementById('fResp');
  const codEl = document.getElementById('fRespCod');
  if (!sel || !codEl) return;
  const u = LS.driverCache().find(x => x.nick === sel.value);
  codEl.value = u ? (u.codigo || codigoConductor(u.nombre,u.apellido1,u.apellido2)) : '';
  if(typeof updateStepperStatus==='function') updateStepperStatus();
}

// ── Desplegable de irradiadores (operadores) ─────────
async function refreshIrradiadores() {
  try {
    const data = await apiPost('/irradiadores', { action:'listPublic', token: LS.token() });
    LS.setIrradiadorCache(data.irradiadores || []);
    setCloudState('ok');
  } catch (e) {
    setCloudState(e.isNetwork ? 'off' : 'err');
  }
  return LS.irradiadorCache();
}
function populateIrradiadorSelect(list) {
  const sel = document.getElementById('fIrrSel');
  if (!sel) return;
  const items = list || LS.irradiadorCache();
  const current = sel.value;
  sel.innerHTML = '<option value="">— Selecciona irradiador —</option>' +
    items.map(u => {
      const nombreCompleto = [u.nombre,u.apellido1,u.apellido2].filter(Boolean).join(' ') || '—';
      return `<option value="${esc(u.id)}">${esc(nombreCompleto)}</option>`;
    }).join('');
  if (items.some(u => u.id === current)) sel.value = current;
  onIrradiadorChange();
}
function onIrradiadorChange() {
  const sel=document.getElementById('fIrrSel');
  const hid=document.getElementById('fIrr');
  if(!sel||!hid) return;
  const u=LS.irradiadorCache().find(x=>x.id===sel.value);
  hid.value = u ? [u.nombre,u.apellido1,u.apellido2].filter(Boolean).join(' ') : '';
  if(typeof updateStepperStatus==='function') updateStepperStatus();
}

// ── Desplegable de vehículos (matrícula, en Conducción) ──
// Gestión de vehículos disponibles: el campo "Matrícula" de Conducción
// es un desplegable alimentado por la tabla "vehiculos". Si el vehículo
// buscado no existe, se puede crear al vuelo indicando matrícula + obra.
async function refreshVehiculos() {
  try {
    const data = await apiPost('/vehiculos', { action:'listPublic', token: LS.token() });
    LS.setVehiculoCache(data.vehiculos || []);
    setCloudState('ok');
  } catch (e) {
    setCloudState(e.isNetwork ? 'off' : 'err');
  }
  return LS.vehiculoCache();
}
// prefix: 'v' (viaje) o 'r' (repostaje) — ids: {prefix}Matricula, {prefix}Obra, {prefix}NuevoVehiculo
function populateVehiculoSelect(prefix, list) {
  const sel = document.getElementById(prefix+'Matricula');
  if (!sel) return;
  const items = list || LS.vehiculoCache();
  const current = sel.value;
  sel.innerHTML = '<option value="">— Selecciona vehículo —</option>' +
    items.map(v => `<option value="${esc(v.id)}">${esc(v.matricula)}${v.numero_obra?' · Obra '+esc(v.numero_obra):''}</option>`).join('') +
    '<option value="__new__">+ Añadir vehículo nuevo…</option>';
  if (items.some(v => v.id === current)) sel.value = current;
  onVehiculoChange(prefix);
}
function onVehiculoChange(prefix) {
  const sel = document.getElementById(prefix+'Matricula');
  const obraEl = document.getElementById(prefix+'Obra');
  const nuevoBox = document.getElementById(prefix+'NuevoVehiculo');
  if (!sel) return;
  if (sel.value === '__new__') {
    if (nuevoBox) nuevoBox.style.display = 'flex';
    if (obraEl) obraEl.value = '';
    resetUltimoKm(prefix);
    return;
  }
  if (nuevoBox) nuevoBox.style.display = 'none';
  const v = LS.vehiculoCache().find(x => x.id === sel.value);
  if (obraEl) obraEl.value = v ? (v.numero_obra || '—') : '';
  if (v) cargarUltimoKm(prefix, v.id);
  else resetUltimoKm(prefix);
}

// ── Autorrelleno de kilometraje (último km conocido por vehículo) ──
// Para no reintroducir datos ya guardados: al elegir un vehículo en Viaje,
// "Km inicial" se rellena solo con el km final de su último viaje. En
// Repostaje se muestra el km de su último repostaje como referencia, y al
// teclear el km actual se calculan solos los km recorridos desde entonces.
// El "último km de repostaje" se busca SIEMPRE junto con el tipo de
// combustible seleccionado: un mismo vehículo reposta Diesel y AdBlue a
// kilometrajes muy distintos, así que no tiene sentido mezclarlos.
let _kmReqSeq = 0;
async function cargarUltimoKm(prefix, vehiculoId) {
  const reqId = ++_kmReqSeq;
  const tipoEl = prefix === 'r' ? document.getElementById('rTipo') : null;
  const tipoCombustible = tipoEl ? tipoEl.value : undefined;
  try {
    const data = await apiPost('/conduccion', { action:'ultimoKmVehiculo', token: LS.token(), payload:{ vehiculoId, tipoCombustible } });
    if (reqId !== _kmReqSeq) return; // se seleccionó otro vehículo mientras tanto
    if (prefix === 'v') aplicarKmIniAuto(data.ultimoKmViaje);
    if (prefix === 'r') aplicarUltimoKmRepostaje(data.ultimoKmRepostaje);
  } catch (e) {
    if (reqId !== _kmReqSeq) return;
    resetUltimoKm(prefix);
  }
}
// Al cambiar el tipo de combustible, "último km de repostaje" hay que
// recalcularlo para el vehículo ya elegido (si lo hay).
function onTipoCombustibleChange() {
  const sel = document.getElementById('rMatricula');
  if (!sel || !sel.value || sel.value === '__new__') { resetUltimoKm('r'); return; }
  const v = LS.vehiculoCache().find(x => x.id === sel.value);
  if (v) cargarUltimoKm('r', v.id); else resetUltimoKm('r');
}
function resetUltimoKm(prefix) {
  if (prefix === 'v') aplicarKmIniAuto(null);
  if (prefix === 'r') aplicarUltimoKmRepostaje(null);
}
function aplicarKmIniAuto(km) {
  const wrap = document.getElementById('vKmIniWrap');
  const label = document.getElementById('vKmIniLabel');
  const input = document.getElementById('vKmIni');
  const badge = document.getElementById('vKmIniBadge');
  if (!wrap || !input) return;
  const val = (km!=null && km!=='' && !isNaN(km)) ? km : null;
  if (val != null) {
    wrap.classList.add('auto-fl');
    if (label) label.textContent = '⚙ Km inicial';
    input.value = val;
    input.readOnly = true;
    input.placeholder = '';
    if (badge) badge.style.display = '';
  } else {
    wrap.classList.remove('auto-fl');
    if (label) label.textContent = 'Km inicial';
    input.value = '';
    input.readOnly = false;
    input.placeholder = '0';
    if (badge) badge.style.display = 'none';
  }
  calcKmRecorridos();
}
function aplicarUltimoKmRepostaje(km) {
  const el = document.getElementById('rUltimoKm');
  if (!el) return;
  el.value = (km!=null && km!=='' && !isNaN(km)) ? km : '';
  calcKmDesdeRepostaje();
}
function calcKmDesdeRepostaje() {
  const actual = parseFloat(document.getElementById('rKm').value);
  const anterior = parseFloat(document.getElementById('rUltimoKm').value);
  const el = document.getElementById('rKmRec');
  if (!el) return;
  el.value = (!isNaN(actual)&&!isNaN(anterior)&&actual>=anterior) ? (actual-anterior).toFixed(1) : '';
}
async function crearVehiculoInline(prefix) {
  const matEl = document.getElementById(prefix+'MatriculaNueva');
  const obraEl = document.getElementById(prefix+'ObraNueva');
  const matricula = matEl.value.trim();
  const numeroObra = obraEl.value.trim();
  if (!matricula) { toast('Introduce la matrícula del vehículo nuevo'); return; }
  if (!numeroObra) { toast('Introduce el número de obra del vehículo'); return; }
  try {
    const data = await apiPost('/vehiculos', { action:'crear', token: LS.token(), payload:{ matricula, numeroObra } });
    setCloudState('ok');
    toast(`✓ Vehículo "${matricula.toUpperCase()}" creado`);
    matEl.value = ''; obraEl.value = '';
    await refreshVehiculos();
    populateVehiculoSelect(prefix);
    const sel = document.getElementById(prefix+'Matricula');
    if (data.id) sel.value = data.id;
    onVehiculoChange(prefix);
  } catch (e) {
    toast(e.isNetwork ? '⚠ Sin conexión: no se ha podido crear el vehículo' : '⚠ '+e.message);
  }
}
function cancelarVehiculoNuevo(prefix) {
  const sel = document.getElementById(prefix+'Matricula');
  if (sel) sel.value = '';
  const nuevoBox = document.getElementById(prefix+'NuevoVehiculo');
  if (nuevoBox) nuevoBox.style.display = 'none';
  onVehiculoChange(prefix);
}

// ── Desplegable de estaciones de servicio (Repostaje) ────
// Gestión de estaciones de servicio: el campo "Estación de servicio" de
// Repostaje es un desplegable alimentado por la tabla "estaciones_servicio".
// Si la estación buscada no existe, se puede crear al vuelo indicando su
// nombre (de momento el único dato; se pueden añadir más campos más
// adelante sin tocar lo ya guardado).
async function refreshEstaciones() {
  try {
    const data = await apiPost('/estaciones', { action:'listPublic', token: LS.token() });
    LS.setEstacionCache(data.estaciones || []);
    setCloudState('ok');
  } catch (e) {
    setCloudState(e.isNetwork ? 'off' : 'err');
  }
  return LS.estacionCache();
}
// prefix: 'r' (repostaje) — ids: {prefix}Estacion, {prefix}NuevaEstacion
function populateEstacionSelect(prefix, list) {
  const sel = document.getElementById(prefix+'Estacion');
  if (!sel) return;
  const items = list || LS.estacionCache();
  const current = sel.value;
  sel.innerHTML = '<option value="">— Selecciona estación —</option>' +
    items.map(e => `<option value="${esc(e.id)}">${esc(e.nombre)}</option>`).join('') +
    '<option value="__new__">+ Añadir estación nueva…</option>';
  if (items.some(e => e.id === current)) sel.value = current;
  onEstacionChange(prefix);
}
function onEstacionChange(prefix) {
  const sel = document.getElementById(prefix+'Estacion');
  const nuevoBox = document.getElementById(prefix+'NuevaEstacion');
  if (!sel) return;
  if (nuevoBox) nuevoBox.style.display = sel.value === '__new__' ? 'flex' : 'none';
}
async function crearEstacionInline(prefix) {
  const nomEl = document.getElementById(prefix+'EstacionNombreNueva');
  const nombre = nomEl.value.trim();
  if (!nombre) { toast('Introduce el nombre de la estación nueva'); return; }
  try {
    const data = await apiPost('/estaciones', { action:'crear', token: LS.token(), payload:{ nombre } });
    setCloudState('ok');
    toast(`✓ Estación "${nombre}" creada`);
    nomEl.value = '';
    await refreshEstaciones();
    populateEstacionSelect(prefix);
    const sel = document.getElementById(prefix+'Estacion');
    if (data.id) sel.value = data.id;
    onEstacionChange(prefix);
  } catch (e) {
    toast(e.isNetwork ? '⚠ Sin conexión: no se ha podido crear la estación' : '⚠ '+e.message);
  }
}
function cancelarEstacionNueva(prefix) {
  const sel = document.getElementById(prefix+'Estacion');
  if (sel) sel.value = '';
  const nuevoBox = document.getElementById(prefix+'NuevaEstacion');
  if (nuevoBox) nuevoBox.style.display = 'none';
}

// ── Cola de registros pendientes de sincronizar ──────
// Un registro se guarda SIEMPRE primero en el dispositivo y después se envía a la nube:
//  · Sin conexión, sesión caducada o fallo del servidor -> queda «pendiente» y se reintenta solo.
//  · Si el servidor lo rechaza por datos no válidos NO se descarta en silencio (antes se perdía):
//    pasa a la lista de rechazados, se avisa y se conserva en este dispositivo.
//  · Cada registro lleva un identificador único (uid): si un envío llegó al servidor pero la respuesta
//    se perdió por mala cobertura, el reintento NO crea un registro duplicado.
const _RECHAZO_DEFINITIVO = [400, 404, 409, 413, 422];
function esRechazoDefinitivo(e) { return !e.isNetwork && _RECHAZO_DEFINITIVO.includes(e.status); }
function marcarRechazado(rec, motivo) {
  const rej = LS.rejected().filter(r => r.at !== rec.at);
  rej.push({ ...rec, rechazo: motivo || 'Datos no válidos' });
  LS.setRejected(rej);
}
function encolarPendiente(rec) {
  const pend = LS.pending();
  if (!pend.some(r => r.at === rec.at)) { pend.push(rec); LS.setPending(pend); }
}
async function syncRecordToCloud(rec) {
  // Sesión sin conexión (sin token): se guarda como pendiente y se envía al volver a entrar con internet.
  if (!LS.token()) { encolarPendiente(rec); return; }
  try {
    await apiPost('/registros', { action:'guardar', token: LS.token(), payload: rec });
    setCloudState('ok');
    invalidarCacheDashboard();
  } catch (e) {
    setCloudState(e.isNetwork ? 'off' : 'err');
    if (esRechazoDefinitivo(e)) {
      marcarRechazado(rec, e.message);
      toast('⚠ El servidor no ha aceptado el registro (' + e.message + '). Se conserva en este dispositivo.');
    } else {
      encolarPendiente(rec);
    }
  }
}
let _flushing = false;
async function flushPending() {
  if (!LS.token() || _flushing) return;
  if (!LS.pending().length) return;
  _flushing = true;
  try {
    const resueltos = new Set(); let synced = 0, rechazados = 0, parar = false;
    for (const rec of LS.pending()) {
      // Los registros hechos sin conexión por OTRO usuario esperan a que él vuelva a entrar (así no se le atribuyen a quien no es).
      if (parar || (rec.by && S.user && rec.by !== S.user)) continue;
      try {
        await apiPost('/registros', { action:'guardar', token: LS.token(), payload: rec });
        resueltos.add(rec.at); synced++;
      } catch (e) {
        if (esRechazoDefinitivo(e)) { marcarRechazado(rec, e.message); resueltos.add(rec.at); rechazados++; }
        else parar = true;   // red caída, sesión caducada o fallo del servidor: se reintenta más tarde
      }
    }
    // Se relee la cola por si se guardó algo nuevo mientras se enviaba.
    LS.setPending(LS.pending().filter(r => !resueltos.has(r.at)));
    if (synced > 0) {
      setCloudState('ok'); invalidarCacheDashboard();
      toast(`☁ ${synced} registro${synced===1?'':'s'} sincronizado${synced===1?'':'s'} con la nube`);
    }
    if (rechazados > 0) toast(`⚠ ${rechazados} registro${rechazados===1?'':'s'} no se ha${rechazados===1?'':'n'} podido enviar (datos no válidos). Revísalo${rechazados===1?'':'s'} en «Registros».`);
  } finally { _flushing = false; }
}
function invalidarCacheDashboard() { S.dashCache = null; }

// ── NOTIFICACIONES — "alguien ha guardado un registro" ──
// Sondeo periódico (no websocket): cada poco tiempo se pregunta al backend
// (con el mismo token de sesión, sin exponer Supabase al navegador) si hay
// registros nuevos desde la última comprobación. Es casi al instante para
// el uso normal de esta app y no cambia el modelo de seguridad ya montado.
let notifTimer=null, notifActivo=false;
const NOTIF_INTERVALO_MS=25000;          // con la app a la vista
const NOTIF_INTERVALO_SEGUNDO_PLANO_MS=60000;   // con la pestaña oculta: menos consultas al servidor
function programarSondeo() {
  if(!notifActivo) return;
  notifTimer=setTimeout(async()=>{
    await checkNuevosRegistros();
    programarSondeo();
  }, document.hidden?NOTIF_INTERVALO_SEGUNDO_PLANO_MS:NOTIF_INTERVALO_MS);
}
function startNotifPolling() {
  if(notifActivo) return;
  notifActivo=true; programarSondeo();
}
function stopNotifPolling() {
  notifActivo=false;
  if(notifTimer){ clearTimeout(notifTimer); notifTimer=null; }
}
async function checkNuevosRegistros() {
  if(!LS.token()||!S.lastCheck) return;
  if(navigator.onLine===false) return;
  try{
    const data=await apiPost('/registros',{action:'nuevos',token:LS.token(),payload:{desde:S.lastCheck}});
    const regs=data.registros||[];
    if(!regs.length) return;
    S.lastCheck=regs[regs.length-1].created_at;
    invalidarCacheDashboard();
    regs.filter(r=>r.creado_por!==S.user).forEach(mostrarNotificacionRegistro);
  }catch(e){
    // Sondeo en segundo plano: si falla (sin conexión, etc.) no molestamos
    // al usuario, ya se reintentará en la siguiente vuelta.
  }
}
function mostrarNotificacionRegistro(r) {
  const fIrr=r.fecha_irradiacion?fmt(pd(r.fecha_irradiacion)):'sin fecha';
  const msg=`🔔 ${r.creado_por} ha guardado un registro (${fIrr}${r.conductor_nombre?' · '+r.conductor_nombre:''})`;
  toast(msg);
  if(typeof Notification!=='undefined' && Notification.permission==='granted' && document.hidden){
    try{ new Notification('Values Irradiation WEB-210', {body:msg, icon:'img/mosquito_icon.png'}); }catch(e){}
  }
}
function notifPermisoEstado() {
  if(typeof Notification==='undefined') return 'no-soportado';
  return Notification.permission; // 'granted' | 'denied' | 'default'
}
async function pedirPermisoNotificaciones() {
  if(typeof Notification==='undefined'){ toast('Tu navegador no soporta notificaciones'); return; }
  const r=await Notification.requestPermission();
  actualizarEstadoNotifUI();
  if(r==='granted') toast('🔔 Notificaciones activadas');
  else if(r==='denied') toast('Notificaciones bloqueadas por el navegador');
}
function actualizarEstadoNotifUI() {
  const el=document.getElementById('notifEstado');
  const btn=document.getElementById('notifBtn');
  if(!el||!btn) return;
  const estado=notifPermisoEstado();
  const MAP={granted:'✅ Activadas',denied:'🚫 Bloqueadas (cámbialo en los ajustes del navegador)','no-soportado':'⚠ No disponibles en este navegador',default:'Desactivadas'};
  el.textContent=MAP[estado]||estado;
  btn.style.display=(estado==='default')?'':'none';
}

function registrarServiceWorker() {
  if(!('serviceWorker' in navigator)) return;
  const habiaControlador=!!navigator.serviceWorker.controller;
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').then(reg=>{ try{ reg.update(); }catch{} }).catch(()=>{});
  });
  // Cuando llega una versión nueva de la app se avisa (la primera instalación no avisa)
  navigator.serviceWorker.addEventListener('controllerchange', ()=>{
    if(habiaControlador){ const b=document.getElementById('updBar'); if(b) b.classList.add('on'); }
  });
}
function boot() {
  // Almacén local antiguo de usuarios: guardaba contraseñas en texto claro y una cuenta Admin con la
  // contraseña de fábrica. Se elimina; para entrar sin conexión ahora se usa un hash (ver más abajo).
  try{ localStorage.removeItem('vi_u'); }catch{}
  S.dose=LS.dose(); S.staged=LS.staged(); S.md=LS.md();
  applyTheme(LS.themePref());
  updStagedUI();
  setCloudState(null);
  window.addEventListener('online', flushPending);
  document.addEventListener('visibilitychange', ()=>{
    if(!document.hidden && S.user){ flushPending(); checkNuevosRegistros(); }
  });
  setInterval(flushPending, 60000);
  registrarServiceWorker();
  restaurarSesion();
}

// ── NAVIGATION ───────────────────────────────────────
function go(id) {
  document.querySelectorAll('.sc').forEach(s=>s.classList.remove('on'));
  const elId=(id==='sl')?'sl':('s'+id); // la pantalla de login usa el id "sl" tal cual
  document.getElementById(elId).classList.add('on');
  if(id==='menu')       renderMenu();
  if(id==='month')      renderMonth();
  if(id==='weekly')     renderWeekly();
  if(id==='multidosis') renderMD();
  if(id==='settings')   renderSettings();
  if(id==='users')      renderUsersScreen();
  if(id==='records')    renderRecs();
  if(id==='hist')       { cambiarVistaHistorial('lista'); filtroHistorialRapido(); }
  if(id==='informes')   {
    S.informesTipo='registros';
    const tipoSel=document.getElementById('informeTipo'); if(tipoSel) tipoSel.value='registros';
    renderCamposInforme();
    const hoy=new Date(), hace30=new Date(); hace30.setDate(hoy.getDate()-30);
    const iso=tod;
    document.getElementById('iDesde').value=iso(hace30);
    document.getElementById('iHasta').value=iso(hoy);
    S.informesRaw=[]; S.informesTodo=[]; S.informesBuscado=false; S.informesPeriodo=null;
    document.getElementById('informesNote').textContent='';
    ocultarVistaPreviaInforme();
    iniciarFiltrosInforme();
  }
  if(id==='form')       { populateConductorSelect(); refreshDrivers().then(populateConductorSelect); populateIrradiadorSelect(); refreshIrradiadores().then(populateIrradiadorSelect); renderUrnaCards(); updateStepperStatus(); }
  if(id==='irradiadores') renderIrradiadoresScreen();
  if(id==='vehiculos')    renderVehiculosScreen();
  if(id==='estaciones')   renderEstacionesScreen();
  if(id==='conduccion')   {
    document.getElementById('vFecha').value=tod(new Date());
    document.getElementById('rFecha').value=tod(new Date());
    populateVehiculoSelect('v'); populateVehiculoSelect('r');
    populateEstacionSelect('r');
    refreshVehiculos().then(()=>{ populateVehiculoSelect('v'); populateVehiculoSelect('r'); });
    refreshEstaciones().then(()=>populateEstacionSelect('r'));
    cambiarVistaConduccion('viaje');
  }
  if(id==='fichaje')      {
    cargarFichajeHoy(); cargarResumenMesFichaje();
    document.getElementById('fichajeCorregirFecha').value=tod(new Date());
    cargarFichajeParaCorregir();
  }
  if(id==='sl')         { setLogo(0); startLogoRotation(); } else { stopLogoRotation(); }

  document.getElementById('app').classList.toggle('authed', id!=='sl' && id!=='welcome' && id!=='welcome2');
  document.querySelectorAll('[data-nav]').forEach(b=>b.classList.toggle('active', b.dataset.nav===id));
  document.getElementById('sidebarAdmin').style.display=S.isAdmin?'block':'none';
  document.getElementById('drawerAdminLbl').style.display=S.isAdmin?'block':'none';
  document.getElementById('drawerUsersLink').style.display=S.isAdmin?'block':'none';
  document.getElementById('drawerIrradiadoresLink').style.display=S.isAdmin?'block':'none';
  document.getElementById('drawerVehiculosLink').style.display=S.isAdmin?'block':'none';
  document.getElementById('drawerEstacionesLink').style.display=S.isAdmin?'block':'none';
  closeDrawer();
}
function nuevoRegistro() {
  S.editingId=null;
  go('form');
  limpiarForm();
}
function logout() {
  LS.setToken(''); LS.setSession(null);
  S.user=null; S.isAdmin=false; S.offline=false;
  S.dashCache=null; S.dashRegs=[]; S.histRaw=[]; S.histFiltered=[]; S.informesRaw=[]; S.informesTodo=[]; S.informesBuscado=false; S.detRegistro=null; S.editingId=null;
  stopNotifPolling();
  cerrarTodosLosDialogos();
  // Antes el usuario y la contraseña seguían escritos en el login tras cerrar sesión: el siguiente en usar el equipo entraba con un clic.
  lReset();
  go('sl');
}
function cerrarTodosLosDialogos() {
  ['confirmOv','passOv','detOv','camposOv','exov','scov','rdiag','urnaModal'].forEach(id=>{ const el=document.getElementById(id); if(el) el.classList.remove('on'); });
  _passObligatorio=false; _confirmResolve=null;
  closeDrawer();
}
function toggleDrawer(){ document.getElementById('drawer').classList.toggle('on'); document.getElementById('drawerOv').classList.toggle('on'); }
function closeDrawer(){ document.getElementById('drawer').classList.remove('on'); document.getElementById('drawerOv').classList.remove('on'); }

// ── LOGIN ─────────────────────────────────────────────
// Paso 1: se comprueba en Supabase si el "nick" ya existe.
//   - Si existe          -> se pide la contraseña (lSubmit)
//   - Si no existe        -> se muestra un mini-formulario de alta con
//                            nombre y apellidos (lRegister), necesarios
//                            para poder calcular el código de conductor
//                            (si el administrador ha cerrado el alta, se avisa).
//   - Si no hay conexión  -> solo entran quienes ya hayan entrado antes con
//                            conexión en este dispositivo (ver "Credenciales sin conexión").
let _registroAbierto = true;
async function lStep() {
  const name=document.getElementById('luser').value.trim();
  if(!name){showErr('Introduce un nombre de usuario');return;}
  showErr('');
  setBtnLoading('lbtn', true, 'Comprobando…');
  let existe=false, bloqueado=false, msgBloqueo='';
  try{
    const data=await apiPost('/auth',{action:'check',nick:name});
    existe=!!data.existe; bloqueado=!!data.bloqueado; msgBloqueo=data.mensajeBloqueo||'';
    _registroAbierto=data.registroAbierto!==false;
    setCloudState('ok');
  }catch(e){
    if(!e.isNetwork){ setCloudState('err'); setBtnLoading('lbtn', false); showErr(e.message); return; }
    setCloudState('off');
    existe=!!credencialOffline(name);
    if(!existe){
      setBtnLoading('lbtn', false);
      showErr('Sin conexión: no puedo comprobar ese usuario. Conéctate a internet para entrar o crear una cuenta.');
      return;
    }
  }
  setBtnLoading('lbtn', false);
  if(bloqueado){showErr(msgBloqueo||'Acceso bloqueado. Contacta con el administrador.');return;}
  if(!existe && !_registroAbierto){
    showErr('Ese usuario no existe. Pide al administrador que te dé de alta.');
    return;
  }

  document.getElementById('luser').disabled=true;
  document.getElementById('lchg').style.display='block';
  if(existe){
    document.getElementById('lregF').style.display='none';
    document.getElementById('lpassF').style.display='flex';
    document.getElementById('lbtn').textContent='Entrar';
    document.getElementById('lbtn').onclick=lSubmit;
    document.getElementById('lpass').focus();
  } else {
    document.getElementById('lpassF').style.display='none';
    document.getElementById('lregF').style.display='flex';
    document.getElementById('lbtn').textContent='Crear cuenta';
    document.getElementById('lbtn').onclick=lRegister;
    showOk(`"${name}" no existe todavía. Rellena tus datos para crear la cuenta.`);
    document.getElementById('rNombre').focus();
  }
}
async function lSubmit() {
  const name=document.getElementById('luser').value.trim();
  const pass=document.getElementById('lpass').value;
  if(!pass){showErr('Introduce la contraseña');return;}
  setBtnLoading('lbtn', true, 'Entrando…');
  try{
    const data=await apiPost('/auth',{action:'login',nick:name,pass});
    setCloudState('ok');
    setBtnLoading('lbtn', false);
    guardarCredencialOffline(data.usuario, pass).catch(()=>{});
    document.getElementById('lpass').value='';
    onAuthSuccess(data.usuario,data.token);
  }catch(e){
    setBtnLoading('lbtn', false);
    if(e.isNetwork){ setCloudState('off'); await loginOffline(name,pass); return; }
    setCloudState('err'); showErr(e.message);
    document.getElementById('lpass').value='';
  }
}
async function lRegister() {
  const name=document.getElementById('luser').value.trim();
  const nombre=document.getElementById('rNombre').value.trim();
  const ap1=document.getElementById('rAp1').value.trim();
  const ap2=document.getElementById('rAp2').value.trim();
  const pass=document.getElementById('rPass').value;
  const pass2=document.getElementById('rPass2').value;
  if(!nombre||!ap1){showErr('Introduce al menos el nombre y el primer apellido');return;}
  if(!pass||pass.length<8){showErr('La contraseña debe tener al menos 8 caracteres');return;}
  if(pass!==pass2){showErr('Las contraseñas no coinciden');return;}
  setBtnLoading('lbtn', true, 'Creando cuenta…');
  try{
    const data=await apiPost('/auth',{action:'register',nick:name,pass,nombre,apellido1:ap1,apellido2:ap2});
    setCloudState('ok');
    setBtnLoading('lbtn', false);
    guardarCredencialOffline(data.usuario, pass).catch(()=>{});
    ['rPass','rPass2'].forEach(id=>{document.getElementById(id).value='';});
    onAuthSuccess(data.usuario,data.token);
  }catch(e){
    setBtnLoading('lbtn', false);
    if(e.isNetwork){ setCloudState('off'); showErr('Sin conexión: para crear una cuenta necesitas internet.'); return; }
    showErr(e.message);
  }
}

// ── Credenciales sin conexión ─────────────────────────
// Tras cada inicio de sesión CON conexión se guarda en este dispositivo un "hash" de la contraseña
// (PBKDF2-SHA256, sal aleatoria): nunca la contraseña. Sin conexión solo puede entrar quien ya lo
// hizo antes aquí; tras 5 fallos se espera 5 minutos. La sesión sin conexión no tiene permisos de
// administrador y no puede consultar la nube: solo trabaja con los datos de este dispositivo.
const OFF_ITER=150000, OFF_MAX_FALLOS=5, OFF_BLOQUEO_MS=5*60*1000;
const _b64=(bytes)=>{ let t=''; bytes.forEach(b=>{t+=String.fromCharCode(b);}); return btoa(t); };
const _unb64=(t)=>Uint8Array.from(atob(t),c=>c.charCodeAt(0));
async function derivarClaveOffline(pass, salt, iter) {
  const key=await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2', salt, iterations:iter, hash:'SHA-256'}, key, 256);
  return _b64(new Uint8Array(bits));
}
const hayCripto=()=>!!(window.crypto && crypto.subtle && crypto.getRandomValues);
function credencialOffline(nick) { return LS.off()[String(nick||'').trim().toLowerCase()]||null; }
async function guardarCredencialOffline(usuario, pass) {
  if(!hayCripto()||!usuario||!usuario.nick) return;
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const hash=await derivarClaveOffline(pass, salt, OFF_ITER);
  const o=LS.off();
  o[usuario.nick.toLowerCase()]={ nick:usuario.nick, nombre:usuario.nombre||'', apellido1:usuario.apellido1||'', apellido2:usuario.apellido2||'',
    codigo:usuario.codigo||'', salt:_b64(salt), iter:OFF_ITER, hash, fallos:0, hasta:0 };
  LS.setOff(o);
}
async function verificarCredencialOffline(nick, pass) {
  const o=LS.off(), c=o[String(nick||'').trim().toLowerCase()];
  if(!c) return {ok:false, mensaje:'Sin conexión: no puedo comprobar ese usuario. Conéctate a internet para entrar.'};
  if(!hayCripto()) return {ok:false, mensaje:'Este navegador no permite entrar sin conexión. Conéctate a internet.'};
  if(c.hasta && c.hasta>Date.now()){
    const min=Math.ceil((c.hasta-Date.now())/60000);
    return {ok:false, mensaje:`Demasiados intentos. Vuelve a probar en ${min} minuto${min===1?'':'s'}.`};
  }
  const hash=await derivarClaveOffline(pass, _unb64(c.salt), c.iter||OFF_ITER);
  if(hash===c.hash){ c.fallos=0; c.hasta=0; LS.setOff(o); return {ok:true, usuario:c}; }
  c.fallos=(c.fallos||0)+1;
  if(c.fallos>=OFF_MAX_FALLOS){ c.fallos=0; c.hasta=Date.now()+OFF_BLOQUEO_MS; }
  LS.setOff(o);
  return {ok:false, mensaje:'Contraseña incorrecta.'};
}
async function loginOffline(name, pass) {
  const r=await verificarCredencialOffline(name, pass);
  document.getElementById('lpass').value='';
  if(!r.ok){ showErr(r.mensaje); return; }
  LS.setToken(''); LS.setSession(null);
  S.user=r.usuario.nick; S.isAdmin=false; S.offline=true; S.dose=LS.dose();
  toast('☁ Sin conexión: sesión solo en este dispositivo');
  go('welcome2');
}

// ── Sesión ────────────────────────────────────────────
function jwtExp(token) {
  try{
    const b=token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
    return JSON.parse(atob(b)).exp||0;
  }catch{ return 0; }
}
// Al reabrir la app se sigue dentro mientras el token (12 h) siga vigente; el servidor lo vuelve a
// comprobar en cada petición, así que si la cuenta se borró o cambió, se vuelve al login con aviso.
function restaurarSesion() {
  if(!RESTAURAR_SESION) return false;
  const tok=LS.token(), ses=LS.session();
  if(!tok||!ses||!ses.nick) return false;
  if(jwtExp(tok)*1000 < Date.now()+60000){ LS.setToken(''); LS.setSession(null); return false; }
  onAuthSuccess(ses, tok, {restaurada:true});
  return true;
}
function onAuthSuccess(usuario, token, opts) {
  LS.setToken(token); LS.setSession(usuario);
  S.user=usuario.nick; S.isAdmin=usuario.role==='admin'; S.offline=false; S.dose=LS.dose();
  S.lastCheck=new Date().toISOString(); S.dashCache=null;
  go(opts&&opts.restaurada?'menu':'welcome2');
  flushPending();
  refreshDrivers().then(()=>populateConductorSelect());
  startNotifPolling();
  if(usuario.mustChangePassword) abrirCambioPass(true);
}
function lReset() {
  delete _btnOrigLabel['lbtn'];
  document.getElementById('luser').disabled=false;
  document.getElementById('luser').value='';
  document.getElementById('lpass').value='';
  document.getElementById('lpassF').style.display='none';
  document.getElementById('lregF').style.display='none';
  ['rNombre','rAp1','rAp2','rPass','rPass2'].forEach(id=>{const e=document.getElementById(id); if(e)e.value='';});
  document.getElementById('lchg').style.display='none';
  const b=document.getElementById('lbtn'); b.disabled=false; b.classList.remove('loading');
  b.textContent='Continuar'; b.onclick=lStep;
  showErr(''); document.getElementById('lok').style.display='none';
}
function showErr(m){const e=document.getElementById('lerr');if(!m){e.style.display='none';return;}e.textContent=m;e.style.display='block';document.getElementById('lok').style.display='none';}
function showOk(m){const e=document.getElementById('lok');e.textContent=m;e.style.display='block';document.getElementById('lerr').style.display='none';}

// ── Cambio de contraseña ──────────────────────────────
let _passObligatorio=false;
function abrirCambioPass(obligatorio) {
  // Si el diálogo obligatorio ya está abierto no se reinicia (lo que se está escribiendo se perdería).
  if(obligatorio && _passObligatorio && document.getElementById('passOv').classList.contains('on')) return;
  if(!LS.token()){ toast('Para cambiar la contraseña necesitas haber entrado con conexión a internet.'); return; }
  _passObligatorio=!!obligatorio;
  ['passActual','passNueva','passNueva2'].forEach(id=>{document.getElementById(id).value='';});
  const err=document.getElementById('passErr'); err.style.display='none'; err.textContent='';
  document.getElementById('passMsg').textContent = obligatorio
    ? 'Por seguridad tienes que cambiar tu contraseña antes de continuar. Elige una nueva de al menos 8 caracteres.'
    : 'Elige una contraseña nueva de al menos 8 caracteres.';
  document.getElementById('passCancelBtn').style.display = obligatorio ? 'none' : '';
  document.getElementById('passOv').classList.add('on');
  setTimeout(()=>{ const f=document.getElementById('passActual'); if(f) f.focus(); },50);
}
function cerrarCambioPass() {
  if(_passObligatorio) return;
  document.getElementById('passOv').classList.remove('on');
}
async function guardarCambioPass() {
  const actual=document.getElementById('passActual').value;
  const n1=document.getElementById('passNueva').value;
  const n2=document.getElementById('passNueva2').value;
  const fallo=(m)=>{ const e=document.getElementById('passErr'); e.textContent=m; e.style.display='block'; };
  if(!actual){ fallo('Escribe tu contraseña actual'); return; }
  if(n1.length<8){ fallo('La contraseña nueva debe tener al menos 8 caracteres'); return; }
  if(n1!==n2){ fallo('Las contraseñas nuevas no coinciden'); return; }
  if(n1===actual){ fallo('La contraseña nueva debe ser distinta de la actual'); return; }
  setBtnLoading('passOkBtn', true, 'Guardando…');
  try{
    const data=await apiPost('/auth',{action:'cambiarPass',token:LS.token(),payload:{passActual:actual,passNueva:n1}});
    LS.setToken(data.token); LS.setSession(data.usuario);
    guardarCredencialOffline(data.usuario, n1).catch(()=>{});
    _passObligatorio=false;
    document.getElementById('passOv').classList.remove('on');
    ['passActual','passNueva','passNueva2'].forEach(id=>{document.getElementById(id).value='';});
    toast('✓ Contraseña cambiada');
  }catch(e){
    fallo(e.isNetwork ? 'Sin conexión: no se ha podido cambiar la contraseña' : e.message);
  }
  setBtnLoading('passOkBtn', false);
}

// ── DASHBOARD ─────────────────────────────────────────
function saludoHora() {
  const h=new Date().getHours();
  if(h<12) return 'Buenos días';
  if(h<20) return 'Buenas tardes';
  return 'Buenas noches';
}
async function renderMenu() {
  document.getElementById('dashGreet').textContent=`${saludoHora()}, ${S.user||''}`;
  document.getElementById('dbdg').textContent=S.dose+' Gy';
  document.getElementById('kpiDose').innerHTML=S.dose+' <span class="kpi-unit">Gy</span>';
  document.getElementById('sdose').value=S.dose;
  document.getElementById('mdate').value=tod(new Date());
  const n=S.staged.length;
  const b=document.getElementById('nbfSb');
  if(b){ b.textContent=n; b.style.display=n>0?'inline-flex':'none'; }
  const helpCard=document.getElementById('helpCard'); if(helpCard) helpCard.style.display=LS.helpSeen()?'none':'';
  const muserSb=document.getElementById('muserSb'); if(muserSb) muserSb.textContent=S.user||'—';
  const muserAvSb=document.getElementById('muserAvSb'); if(muserAvSb) muserAvSb.textContent=(S.user||'?').charAt(0).toUpperCase();
  await actualizarDashboardKPIs();
}
async function actualizarDashboardKPIs() {
  document.getElementById('kpiPend').textContent=LS.pending().length;
  const hoy=tod(new Date());
  if(!LS.token()){ renderDashboardLocal(hoy); return; }
  const inicioMes=hoy.slice(0,7)+'-01';
  try{
    // Caché de 30 s: volver al menú desde otra pantalla ya no repite la consulta al servidor cada vez.
    let regs;
    const c=S.dashCache;
    if(c && c.hoy===hoy && Date.now()-c.t<30000) regs=c.regs;
    else{
      const data=await apiPost('/registros',{action:'listar',token:LS.token(),payload:{desde:inicioMes,hasta:hoy}});
      regs=data.registros||[];
      S.dashCache={t:Date.now(),hoy,regs};
    }
    const regsHoy=regs.filter(r=>r.fecha_irradiacion===hoy);
    document.getElementById('kpiHoy').textContent=regsHoy.length;
    document.getElementById('kpiCompletas').textContent=regsHoy.filter(r=>r.h_fin_irr).length;
    renderActividadReciente(regs.slice(0,6).map(r=>({
      hora:r.created_at?new Date(r.created_at).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}):'',
      urnas:r.n_urnas, dosis:dosisRegistro(r)||S.dose, sync:true, conductor:r.conductor_nombre
    })));
    renderResumenDosis(regs, hoy);
  }catch(e){ renderDashboardLocal(hoy); }
}
function renderResumenDosis(regs, hoy) {
  const hoyD=pd(hoy);
  const diaSemana=hoyD.getDay(); // 0=domingo
  const inicioSemana=new Date(hoyD); inicioSemana.setDate(hoyD.getDate()-(diaSemana===0?6:diaSemana-1));
  const isoInicioSemana=tod(inicioSemana);
  let dHoy=0, dSemana=0, dMes=0;
  regs.forEach(r=>{
    const d=dosisRegistro(r)||0;
    dMes+=d;
    if(r.fecha_irradiacion>=isoInicioSemana) dSemana+=d;
    if(r.fecha_irradiacion===hoy) dHoy+=d;
  });
  document.getElementById('resHoy').textContent=dHoy;
  document.getElementById('resSemana').textContent=dSemana;
  document.getElementById('resMes').textContent=dMes;
  S.dashRegs=regs;
  dibujarTendenciaDashboard();
}
let dashChartInstance=null;
async function dibujarTendenciaDashboard() {
  const regs=S.dashRegs||[];
  const wrap=document.getElementById('dashChartWrap');
  const canvas=document.getElementById('dashChart');
  if(!wrap||!canvas||!regs.length){ if(wrap) wrap.style.display='none'; return; }
  if(!window.Chart){ try{ await cargarLib('chart'); }catch{ wrap.style.display='none'; return; } }
  wrap.style.display='block';
  if(dashChartInstance){ dashChartInstance.destroy(); dashChartInstance=null; }

  const tipo=document.getElementById('dashChartTipo')?.value||'dosis';
  const valorDe=(r)=>{
    if(tipo==='dosis') return dosisRegistro(r)||0;
    if(tipo==='urnas') return r.n_urnas||0;
    if(tipo==='temp') return r.temp_media||0;
    if(tipo==='expUsv') return r.exposicion_usv||0;
    if(tipo==='tiempoOperador') return minutosEntre(r.h_inicio_irr,r.h_fin_irr);
    if(tipo==='texpReal') return r.tiempo_exposicion_real||0;
    return 0;
  };
  const UNIDADES={dosis:'Gy',urnas:'urnas',temp:'°C',expUsv:'µSv',tiempoOperador:'h:mm',texpReal:'s'};
  const ETIQUETAS={dosis:'Dosis',urnas:'Nº urnas',temp:'Tª media',expUsv:'Exposición',tiempoOperador:'Tiempo operador',texpReal:'Tiempo exp. real'};
  const ES_SUMA=['dosis','urnas','expUsv','tiempoOperador'];
  const unidad=UNIDADES[tipo]||''; const label=ETIQUETAS[tipo]||'Valor';
  // Los datos de "tiempo operador" se guardan en minutos, pero se muestran como h:mm (ejes y aviso al pasar el ratón)
  const esDuracion=(tipo==='tiempoOperador');
  const ticksY={};
  if(esDuracion) ticksY.callback=(v)=>formatMinutos(v);

  const porDia={};
  regs.forEach(r=>{
    if(!r.fecha_irradiacion) return;
    const v=valorDe(r);
    if(!v && v!==0) return;
    (porDia[r.fecha_irradiacion]=porDia[r.fecha_irradiacion]||[]).push(v);
  });
  const dias=Object.keys(porDia).sort();
  const esSuma=ES_SUMA.includes(tipo);
  const valores=dias.map(d=>{
    const arr=porDia[d];
    const suma=arr.reduce((a,b)=>a+b,0);
    return esSuma?Math.round(suma*100)/100:Math.round((suma/arr.length)*100)/100;
  });

  const cPrimary=temaColor('--blue-l'), cGrid=temaColor('--brd'), cTick=temaColor('--txt3');
  ticksY.color=cTick;
  dashChartInstance=new Chart(canvas.getContext('2d'),{
    type:'bar',
    data:{labels:dias.map(d=>fmt(pd(d))), datasets:[{label,data:valores,backgroundColor:cPrimary,borderRadius:4}]},
    options:{responsive:true,animation:{duration:250},
      plugins:{legend:{display:false},tooltip:{callbacks:{label:(ctx)=>esDuracion?formatMinutos(ctx.parsed.y):`${ctx.formattedValue} ${unidad}`}}},
      scales:{x:{ticks:{color:cTick,maxRotation:60},grid:{display:false}},
              y:{ticks:ticksY,grid:{color:cGrid},title:{display:true,text:unidad,color:cTick}}}}
  });
}
function renderDashboardLocal(hoy) {
  const regsHoy=stagedVisible().filter(r=>r.fchIrr===hoy);
  document.getElementById('kpiHoy').textContent=regsHoy.length;
  document.getElementById('kpiCompletas').textContent=regsHoy.filter(r=>r.hFin).length;
  const pendAt=new Set(LS.pending().map(p=>p.at));
  renderActividadReciente([...regsHoy].reverse().slice(0,6).map(r=>({
    hora:r.at?new Date(r.at).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'}):'',
    urnas:r.nUrnas, dosis:S.dose, sync:!pendAt.has(r.at), conductor:r.resp
  })));
}
function renderActividadReciente(items) {
  const el=document.getElementById('dashActividad');
  if(!items.length){ el.innerHTML='<div class="remp">Sin actividad todavía hoy</div>'; return; }
  el.innerHTML=items.map(it=>`
    <div class="act-item" onclick="go('hist')">
      <div class="act-time">${esc(it.hora)||'--:--'}</div>
      <div class="act-body">
        <div class="act-title">${esc(it.urnas)||'—'} urna${it.urnas===1?'':'s'} · ${esc(it.dosis)||'—'} Gy${it.conductor?' · '+esc(it.conductor):''}</div>
      </div>
      <span class="badge ${it.sync?'badge-success':'badge-warning'}">${it.sync?'✓ Sincronizado':'⚠ Pendiente'}</span>
    </div>`).join('');
}
function calcMenu() {
  const s=document.getElementById('mdate').value;
  if(!s){toast('Selecciona una fecha');return;}
  const d=pd(s); const t=tExp(S.dose,d);
  document.getElementById('rTime').textContent=t.toFixed(1);
  document.getElementById('rSub').textContent=`${fmt(d)} · Dosis: ${S.dose} Gy · Tasa: ${rate(d).toFixed(6)} Gy/s`;
  document.getElementById('rdiag').classList.add('on');
}
function closeR(){document.getElementById('rdiag').classList.remove('on');}

// ── FORM TABS ─────────────────────────────────────────
function stab(name,btn) {
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));
  document.querySelectorAll('.tp').forEach(p=>p.classList.remove('on'));
  btn.classList.add('on');
  document.getElementById('tp-'+name).classList.add('on');
  updateStepperStatus();
}
function updateStepperStatus() {
  const done={
    urnas:   !!document.getElementById('fchIrr').value,
    transp:  !!document.getElementById('fResp').value,
    temp:    !!(document.getElementById('fTi').value && document.getElementById('fTf').value),
    irradia: !!document.getElementById('fIrr').value,
    obs:     false
  };
  const numMap={urnas:1,transp:2,temp:3,irradia:4,obs:5};
  document.querySelectorAll('.step').forEach(btn=>{
    const step=btn.dataset.step;
    const circle=btn.querySelector('.step-circle');
    if(!circle) return;
    const isActive=btn.classList.contains('on');
    btn.classList.remove('done');
    if(done[step] && !isActive){
      circle.textContent='✓'; btn.classList.add('done');
    } else {
      circle.textContent=numMap[step];
    }
  });
}

// ── FORM CALCULATIONS ─────────────────────────────────
function onFecha() {
  const v=document.getElementById('fchIrr').value;
  const d=pd(v);
  if(!d){['semana','tasa','fTexp','fTexpReal'].forEach(id=>document.getElementById(id).value='');updateStepperStatus();return;}
  const r=rate(d);
  document.getElementById('semana').value=isoWk(d);
  document.getElementById('tasa').value=r.toFixed(8);
  document.getElementById('fTexp').value=r>0?(S.dose/r).toFixed(1):'';
  const rw=rate(miercolesDeLaSemana(d));
  document.getElementById('fTexpReal').value=rw>0?(S.dose/rw).toFixed(1):'';
  updateStepperStatus();
}
function calcTm() {
  const a=parseFloat(document.getElementById('fTi').value);
  const b=parseFloat(document.getElementById('fTf').value);
  document.getElementById('fTm').value=(!isNaN(a)&&!isNaN(b))?((a+b)/2).toFixed(1):'';
  updateStepperStatus();
}

// ── URNAS ─────────────────────────────────────────────
const UCFG=[
  {key:'urna1',label:'Urna 1',color:'#4C6EF5'},
  {key:'urna2',label:'Urna 2',color:'#2FB344'},
  {key:'urna3',label:'Urna 3',color:'#BE4BDB'}
];
let _urnaTab='urna1';

function renderUrnaPanel(key,color) {
  const u=S[key];
  return `
    <div style="display:flex;flex-direction:column;gap:18px">
      <div class="fl"><label>Número de urnas</label>
        <input type="number" id="${key}N" min="0" value="${esc(u.n||'')}" placeholder="0"
          style="font-size:17px;padding:12px 14px;border-color:${color}66"
          oninput="uNum('${key}')"></div>
      <div class="fl"><label>Fecha de sexado</label>
        <input type="date" id="${key}D" value="${u.date?tod(new Date(u.date)):''}"
          style="font-size:16px;padding:12px 14px;border-color:${color}66"
          oninput="uDate('${key}')"></div>
      <div class="fl"><label>Lote — sexado menos 6 días (auto)</label>
        <div class="cfr">
          <input type="text" id="${key}L" readonly value="${esc(u.lote||'')}"
            placeholder="Selecciona fecha de sexado"
            style="font-size:16px;padding:12px 14px;border-color:${color}88;
                   color:#E0E6FF;background:#0D1020;padding-right:58px">
          <span class="aut" style="color:${color};font-size:11px">auto</span>
        </div></div>
      ${u.n||u.date?`
      <div style="background:${color}18;border:1px solid ${color}44;border-radius:var(--rsm);
        padding:12px 14px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:13px;color:rgba(255,255,255,.6)">Urnas en esta entrada</span>
        <span style="font-family:var(--fh);font-size:22px;font-weight:700;color:${color}">${esc(u.n||'0')}</span>
      </div>`:''}
    </div>`;
}

function openUrna(startKey) {
  _urnaTab=startKey||'urna1';
  UCFG.forEach(({key,color})=>{
    document.getElementById('upanel-'+key).innerHTML=renderUrnaPanel(key,color);
    document.getElementById('upanel-'+key).classList.remove('on');
  });
  document.getElementById('upanel-'+_urnaTab).classList.add('on');
  UCFG.forEach(({key})=>{
    const tab=document.getElementById('utab-'+key);
    tab.classList.remove('on','filled');
    if(S[key].n||S[key].date) tab.classList.add('filled');
  });
  document.getElementById('utab-'+_urnaTab).classList.add('on');
  updNavBtns(); updMpill(); updChips();
  document.getElementById('urnaModal').classList.add('on');
}
function switchUrna(key) {
  _urnaTab=key;
  UCFG.forEach(({key:k})=>{
    document.getElementById('upanel-'+k).classList.remove('on');
    document.getElementById('utab-'+k).classList.remove('on');
  });
  document.getElementById('upanel-'+key).classList.add('on');
  document.getElementById('utab-'+key).classList.add('on');
  updNavBtns();
}
function prevUrna() { const i=UCFG.findIndex(u=>u.key===_urnaTab); if(i>0) switchUrna(UCFG[i-1].key); }
function nextUrna() {
  const i=UCFG.findIndex(u=>u.key===_urnaTab);
  if(i<UCFG.length-1) switchUrna(UCFG[i+1].key);
  else closeUrna();
}
function updNavBtns() {
  const idx=UCFG.findIndex(u=>u.key===_urnaTab);
  const prevBtn=document.querySelector('#urnaModal .btn.bo');
  const nextBtn=document.getElementById('urnaNextBtn');
  if(prevBtn) prevBtn.style.display=idx===0?'none':'flex';
  if(nextBtn){
    if(idx===UCFG.length-1){
      nextBtn.textContent='✓ Confirmar'; nextBtn.className='btn bg';
      nextBtn.style.flex='1';
    } else {
      nextBtn.textContent='Siguiente →'; nextBtn.className='btn bp';
      nextBtn.style.flex='2'; nextBtn.style.padding='11px';
    }
  }
}
function closeUrna() { document.getElementById('urnaModal').classList.remove('on'); updUrnaSum(); }
function uNum(key) {
  S[key].n=document.getElementById(key+'N').value;
  updMpill(); updChips();
  const {color}=UCFG.find(u=>u.key===key);
  document.getElementById('upanel-'+key).innerHTML=renderUrnaPanel(key,color);
  document.getElementById('upanel-'+key).classList.add('on');
  const inp=document.getElementById(key+'N');
  if(inp){inp.focus(); const v=inp.value; inp.value=''; inp.value=v;}
}
function uDate(key) {
  const v=document.getElementById(key+'D').value; S[key].date=v;
  if(v){ const d=pd(v); const l=new Date(d); l.setDate(l.getDate()-6); S[key].lote=fmt(l); }
  else { S[key].lote=''; }
  updMpill(); updChips();
  const {color}=UCFG.find(u=>u.key===key);
  document.getElementById('upanel-'+key).innerHTML=renderUrnaPanel(key,color);
  document.getElementById('upanel-'+key).classList.add('on');
  const inp=document.getElementById(key+'D'); if(inp) inp.focus();
}
function urnaTotal() {
  return (parseInt(S.urna1.n||0)||0)+(parseInt(S.urna2.n||0)||0)+(parseInt(S.urna3.n||0)||0);
}
function renderUrnaCards() {
  const wrap=document.getElementById('urnaCards');
  if(!wrap) return;
  wrap.innerHTML=UCFG.map(({key,color,label},i)=>{
    const u=S[key];
    const filled=!!(u.n||u.date);
    return `
    <button type="button" class="urna-card ${filled?'filled':''}" style="--ucolor:${color}" onclick="openUrna('${key}')">
      <div class="urna-card-top">
        <span class="urna-card-num">${String(i+1).padStart(2,'0')}</span>
        <span class="urna-card-status">${filled?'✓':'—'}</span>
      </div>
      <div class="urna-card-qty">${u.n?esc(u.n)+' unidades':'Sin datos'}</div>
      ${u.lote?`<div class="urna-card-lote">Lote ${esc(u.lote)}</div>`:''}
    </button>`;
  }).join('');
}
function updMpill() {
  const t=urnaTotal();
  const p=document.getElementById('mpill');
  if(p){p.textContent=`Total: ${t}`;p.style.display=t>0?'inline-block':'none';}
  UCFG.forEach(({key})=>{
    const tab=document.getElementById('utab-'+key);
    if(tab){tab.classList.remove('filled');if(S[key].n||S[key].date)tab.classList.add('filled');}
  });
  renderUrnaCards();
}
function updChips() {
  UCFG.forEach(({key,color,label})=>{
    const chip=document.getElementById('chip-'+key); if(!chip) return;
    const u=S[key];
    if(u.n||u.date){
      chip.className='uchip filled';
      chip.style.cssText=`background:${color}22;border-color:${color}88;color:#fff`;
      chip.innerHTML=`<span style="width:7px;height:7px;border-radius:50%;background:${color};flex-shrink:0"></span>${label}: ${esc(u.n||'0')}`;
    } else {
      chip.className='uchip empty'; chip.style.cssText='';
      chip.innerHTML=`<span style="width:7px;height:7px;border-radius:50%;background:${color};flex-shrink:0;opacity:.4"></span>${label}`;
    }
  });
}
function updUrnaSum() {
  const t=urnaTotal();
  const ban=document.getElementById('totBan');
  if(t>0){
    document.getElementById('totVal').textContent=t; ban.style.display='flex';
    const dos=Math.ceil(t/14);
    const inp=document.getElementById('fDos'); inp.value=dos; inp.readOnly=true;
    const wrap=document.getElementById('dosWrap');
    if(!wrap.querySelector('.aut')){
      const b=document.createElement('span'); b.className='aut'; b.textContent='auto'; wrap.appendChild(b);
    }
  } else {
    ban.style.display='none';
    const inp=document.getElementById('fDos'); inp.readOnly=false; inp.value='';
    const b=document.getElementById('dosWrap').querySelector('.aut'); if(b) b.remove();
  }
}

// ── FORM SAVE ─────────────────────────────────────────
// ── Estado de carga en botones (spinner + deshabilitado) ──
const _btnOrigLabel={};
function setBtnLoading(id, loading, loadingText) {
  const btn=document.getElementById(id);
  if(!btn) return;
  if(loading){
    if(_btnOrigLabel[id]===undefined) _btnOrigLabel[id]=btn.innerHTML;
    btn.disabled=true; btn.classList.add('loading');
    btn.innerHTML=`<span class="spin"></span>${loadingText||'Espera…'}`;
  } else {
    btn.disabled=false; btn.classList.remove('loading');
    if(_btnOrigLabel[id]!==undefined){ btn.innerHTML=_btnOrigLabel[id]; delete _btnOrigLabel[id]; }
  }
}

// Validación antes de guardar: solo la fecha es obligatoria (lo demás se puede completar luego),
// pero lo que se escriba debe tener sentido. Se marca el campo y se lleva al paso donde está.
function limpiarInvalidos() { document.querySelectorAll('.inv').forEach(e=>e.classList.remove('inv')); }
function marcarInvalido(id, paso, mensaje) {
  const el=document.getElementById(id);
  const btn=document.querySelector(`.step[data-step="${paso}"]`);
  if(btn) stab(paso, btn);
  if(el){
    el.classList.add('inv');
    try{ el.focus(); }catch{}
    el.addEventListener('input',()=>el.classList.remove('inv'),{once:true});
  }
  toast('⚠ '+mensaje);
}
function validarFormularioRegistro() {
  limpiarInvalidos();
  if(!document.getElementById('fchIrr').value){ marcarInvalido('fchIrr','urnas','Indica la fecha de irradiación para guardar'); return false; }
  const dos=document.getElementById('fDos').value;
  if(dos!=='' && !/^\d+$/.test(dos)){ marcarInvalido('fDos','irradia','Los dosímetros deben ser un número entero'); return false; }
  const rangos=[['fTi','temp','La temperatura inicial',-100,200],['fTf','temp','La temperatura final',-100,200],['fExpUsv','irradia','La exposición (µSv)',0,1e6]];
  for(const [id,paso,etiqueta,min,max] of rangos){
    const v=document.getElementById(id).value;
    if(v==='') continue;
    const n=parseFloat(v);
    if(isNaN(n)||n<min||n>max){ marcarInvalido(id,paso,`${etiqueta} no es válida`); return false; }
  }
  return true;
}
async function guardar() {
  if(!validarFormularioRegistro()) return;
  const t=urnaTotal();
  const tiV=parseFloat(document.getElementById('fTi').value);
  const tfV=parseFloat(document.getElementById('fTf').value);
  const tm=(!isNaN(tiV)&&!isNaN(tfV))?((tiV+tfV)/2).toFixed(1):'';
  const respSel=document.getElementById('fResp');
  const respNick=respSel?respSel.value:'';
  const respNombre=(respSel&&respSel.selectedOptions[0])?respSel.selectedOptions[0].textContent:'';
  const respCodigo=document.getElementById('fRespCod').value;
  const irrSel=document.getElementById('fIrrSel');
  const irrId=irrSel?irrSel.value:'';
  const irrNombre=(irrSel&&irrSel.selectedOptions[0]&&irrId)?irrSel.selectedOptions[0].textContent:'';
  const irrItem=irrId?LS.irradiadorCache().find(x=>x.id===irrId):null;
  const irrCodigo=irrItem?irrItem.codigo:'';
  const rec={
    // Campos de usuario
    fchIrr: document.getElementById('fchIrr').value,
    resp:   respNick?respNombre:'',
    respNick, respCodigo,
    hII:    document.getElementById('fHII').value,
    hIL:    document.getElementById('fHIL').value,
    hVI:    document.getElementById('fHVI').value,
    hVL:    document.getElementById('fHVL').value,
    ti:     document.getElementById('fTi').value,
    tf:     document.getElementById('fTf').value,
    irr:    irrNombre,
    irrId, irrNombre, irrCodigo,
    expUsv: document.getElementById('fExpUsv').value,
    dos:    document.getElementById('fDos').value,
    hIni:   document.getElementById('fHini').value,
    hFin:   document.getElementById('fHfin').value,
    obs:    document.getElementById('fObs').value,
    // Datos de urnas
    nUrnas: t||'',
    u1:{...S.urna1}, u2:{...S.urna2}, u3:{...S.urna3},
    // Calculados automáticamente
    semana: document.getElementById('semana').value,
    tasa:   document.getElementById('tasa').value,
    texp:   document.getElementById('fTexp').value,
    texpReal: document.getElementById('fTexpReal').value,
    tm,
    // Metadatos
    at: new Date().toISOString(),
    uid: nuevoUid(),          // evita duplicados si hay que reintentar el envío
    by: S.user,               // quién lo hizo en este dispositivo
  };
  setBtnLoading('gbtn', true, S.editingId?'Actualizando…':'Guardando…');

  if(S.editingId){
    try{
      await apiPost('/registros',{action:'actualizar',token:LS.token(),payload:{id:S.editingId,registro:rec}});
      setCloudState('ok');
      invalidarCacheDashboard();
      toast('✓ Registro actualizado');
    }catch(e){
      setCloudState(e.isNetwork?'off':'err');
      toast('⚠ No se pudo actualizar: '+e.message);
      setBtnLoading('gbtn', false);
      return;
    }
    S.editingId=null;
    limpiarForm();
    setBtnLoading('gbtn', false);
    document.getElementById('gbtn').innerHTML='Guardar <span id="gcnt"></span>';
    updStagedUI();
    return;
  }

  S.staged.push(rec); LS.setS(S.staged);
  await syncRecordToCloud(rec);
  limpiarForm();
  setBtnLoading('gbtn', false);
  updStagedUI();
  toast('✓ Registro guardado');
}
function limpiarForm() {
  ['fchIrr','semana','tasa','fTexp','fTexpReal','fResp','fRespCod','fHII','fHIL','fHVI','fHVL',
   'fTi','fTf','fTm','fIrr','fExpUsv','fDos','fHini','fHfin','fDuracionIrr','fObs']
    .forEach(id=>{const e=document.getElementById(id);if(e){e.value='';if(id==='fDos')e.readOnly=false;}});
  onConductorChange();
  const irrSel=document.getElementById('fIrrSel'); if(irrSel) irrSel.value='';
  onIrradiadorChange();
  S.urna1={n:'',date:'',lote:''}; S.urna2={n:'',date:'',lote:''}; S.urna3={n:'',date:'',lote:''};
  document.getElementById('totBan').style.display='none';
  const b=document.getElementById('dosWrap').querySelector('.aut'); if(b) b.remove();
  renderUrnaCards();
  stab('urnas', document.querySelector('.step[data-step="urnas"]'));
}
// Los registros guardados en este dispositivo solo los ve quien los hizo (en equipos compartidos).
function stagedVisible() { return S.staged.filter(r=>!r.by || !S.user || r.by===S.user); }
function updStagedUI() {
  const n=stagedVisible().length;
  const sb=document.getElementById('sbdg'),be=document.getElementById('bexp'),
        rc=document.getElementById('rcnt'),gc=document.getElementById('gcnt');
  if(n>0){
    sb.style.display='inline-block'; sb.textContent=n+' guardado'+(n===1?'':'s');
    be.disabled=false; rc.textContent=` (${n})`; gc.textContent=` (${n})`;
  } else {
    sb.style.display='none'; be.disabled=true; rc.textContent=''; gc.textContent='';
  }
}

// ── EXPORT ────────────────────────────────────────────
const EX_LABELS={form:'Formulario',month:'Dosis mensual',weekly:'Tabla anual',hist:'Historial',informes:'Informes'};

function openExDlg(ctx) {
  if(ctx==='form'&&!stagedVisible().length){toast('No hay registros para exportar');return;}
  S.exCtx=ctx;
  document.getElementById('exctx').textContent=EX_LABELS[ctx]||'';
  document.getElementById('exov').classList.add('on');
}
function closeExDlg(){document.getElementById('exov').classList.remove('on');}

async function doExport(fmt_) {
  closeExDlg();
  const ctx=S.exCtx;
  let filename='', content='', mime='', bytes=0;
  if(ctx==='form'){
    if(fmt_==='csv')       {[content,mime]=buildFormCSV();  filename=`irradiacion_${dateStamp()}.csv`;}
    else if(fmt_==='json') {content=JSON.stringify(stagedVisible().map(({by,uid,...r})=>r),null,2);mime='application/json';filename=`irradiacion_${dateStamp()}.json`;}
    else                   {content=buildFormTXT();mime='text/plain;charset=utf-8;';filename=`irradiacion_${dateStamp()}.txt`;}
  } else if(ctx==='month'){
    if(fmt_==='csv')       {[content,mime]=buildMonthCSV(); filename=`dosis_mensual_${dateStamp()}.csv`;}
    else if(fmt_==='json') {content=buildMonthJSON();mime='application/json';filename=`dosis_mensual_${dateStamp()}.json`;}
    else                   {content=buildMonthTXT();mime='text/plain;charset=utf-8;';filename=`dosis_mensual_${dateStamp()}.txt`;}
  } else if(ctx==='weekly'){
    if(fmt_==='csv')       {[content,mime]=buildWeeklyCSV();filename=`dosis_semanal_${dateStamp()}.csv`;}
    else if(fmt_==='json') {content=buildWeeklyJSON();mime='application/json';filename=`dosis_semanal_${dateStamp()}.json`;}
    else                   {content=buildWeeklyTXT();mime='text/plain;charset=utf-8;';filename=`dosis_semanal_${dateStamp()}.txt`;}
  }
  bytes=new Blob(['\uFEFF'+content]).size;
  const result=await dlFile(filename,content,mime);
  if(result===null) return;
  showSaveDlg(filename,fmt_,bytes,ctx,result);
}

function dateStamp() {
  const d=new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`;
}

// ── DOWNLOAD (File System Access API + fallback) ───────
function isMobile() {
  return /Android|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(navigator.userAgent)
      || (navigator.maxTouchPoints>1 && window.innerWidth<1024);
}
async function dlFile(name, content, mime) {
  const blob=new Blob(['\uFEFF'+content],{type:mime});
  return dlBlob(name, blob, mime);
}
async function dlBlob(name, blob, acceptMime) {
  const mimeForPicker=(acceptMime||blob.type||'application/octet-stream').split(';')[0];
  if(!isMobile()&&window.showSaveFilePicker){
    try {
      const ext=name.split('.').pop().toLowerCase();
      const handle=await window.showSaveFilePicker({
        suggestedName:name,
        types:[{description:ext.toUpperCase()+' file',accept:{[mimeForPicker]:['.' +ext]}}]
      });
      const writable=await handle.createWritable();
      await writable.write(blob); await writable.close();
      return {method:'picker',path:handle.name};
    } catch(e) { if(e.name==='AbortError') return null; }
  }
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=name;
  if(/iPad|iPhone|iPod/.test(navigator.userAgent)&&!window.MSStream){a.target='_blank';a.rel='noopener';}
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),10000);
  return {method:'download'};
}

// ── SAVE CONFIRM DIALOG ───────────────────────────────
function showSaveDlg(filename,fmt_,bytes,ctx,result) {
  const fmtU=fmt_.toUpperCase();
  const kbSize=(bytes/1024).toFixed(1);
  const now=new Date();
  const ts=`${String(now.getDate()).padStart(2,'0')}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  // El navegador no dice dónde deja el archivo descargado: solo se muestra una ruta si el usuario la eligió.
  let fullPath, saveMethod;
  if(result&&result.method==='picker'){
    fullPath=result.path||filename; saveMethod='📁 Guardado en la ubicación elegida';
  } else {
    fullPath=`Carpeta de descargas de tu ${isMobile()?'dispositivo':'navegador'} → ${filename}`;
    saveMethod='📥 Descargado por el navegador';
  }
  const extEl=document.getElementById('scFext');
  extEl.textContent=fmtU; extEl.className=`fext ${fmt_}`;
  document.getElementById('scFname').textContent=filename;
  document.getElementById('scFmeta').textContent=`${fmtU} · ${kbSize} KB · ${EX_LABELS[ctx]} · ${ts}`;
  document.getElementById('scTerm').innerHTML=`
    <div class="term-line"><span class="term-prompt">$</span><span class="term-cmd">vi-export --format ${fmt_} --source ${ctx}</span></div>
    <div class="term-line" style="margin-top:4px"><span class="term-prompt"> </span><span class="term-out">[INFO] Generando ${fmtU} · ${bytes.toLocaleString()} bytes · UTF-8 BOM</span></div>
    <div class="term-line" style="margin-top:4px"><span class="term-prompt"> </span><span class="term-out">[INFO] ${esc(saveMethod)}</span></div>
    <div class="term-line" style="margin-top:4px"><span class="term-prompt">$</span><span class="term-cmd">ruta → <span class="term-path">${esc(fullPath)}</span></span></div>
    <div class="term-line" style="margin-top:4px"><span class="term-prompt"> </span><span class="term-ok">✔ Archivo guardado correctamente</span></div>
    <div class="term-line" style="margin-top:4px"><span class="term-prompt"> </span><span class="term-dim">${ts}<span class="term-cursor"></span></span></div>`;
  document.getElementById('scov').classList.add('on');
}
function closeScDlg(){document.getElementById('scov').classList.remove('on');}

// ── EXPORT BUILDERS — FORM ────────────────────────────
function buildFormCSV() {
  const h=[
    'Fecha Irradiación','Semana ISO','Tasa Gy/s','Tiempo Exp.(s)',
    'Nº Urnas Total',
    'Urna1 Nº','Urna1 F.Sexado','Urna1 Lote',
    'Urna2 Nº','Urna2 F.Sexado','Urna2 Lote',
    'Urna3 Nº','Urna3 F.Sexado','Urna3 Lote',
    'Conductor','H.Ida Ini','H.Ida Lle','H.Vta Ini','H.Vta Lle',
    'Tª Ini(°C)','Tª Fin(°C)','Tª Media(°C)',
    'Irradiador','Dosímetros','H.Ini Irr.','H.Fin Irr.','Observaciones'
  ];
  const rows=stagedVisible().map(r=>[
    r.fchIrr?fmt(pd(r.fchIrr)):'', r.semana||'',
    r.tasa?parseFloat(r.tasa).toFixed(8):'', r.texp||'',
    r.nUrnas||'',
    r.u1?.n||'', r.u1?.date?fmt(pd(r.u1.date)):'', r.u1?.lote||'',
    r.u2?.n||'', r.u2?.date?fmt(pd(r.u2.date)):'', r.u2?.lote||'',
    r.u3?.n||'', r.u3?.date?fmt(pd(r.u3.date)):'', r.u3?.lote||'',
    r.resp||'', r.hII||'', r.hIL||'', r.hVI||'', r.hVL||'',
    r.ti||'', r.tf||'', r.tm||'',
    r.irr||'', r.dos||'', r.hIni||'', r.hFin||'', r.obs||''
  ]);
  return [[h,...rows].map(csvFila).join('\r\n'),'text/csv;charset=utf-8;'];
}

function buildFormTXT() {
  return stagedVisible().map((r,i)=>{
    const sep='─'.repeat(48);
    const fIrr=r.fchIrr?fmt(pd(r.fchIrr)):'—';
    return [
      sep, `REGISTRO ${i+1}  [${new Date(r.at).toLocaleString()}]`, sep,
      `Fecha irradiación : ${fIrr}`,
      `Semana ISO        : ${r.semana||'—'}`,
      `Tasa Co-60        : ${r.tasa?parseFloat(r.tasa).toFixed(8):'—'} Gy/s`,
      `Tiempo exposición : ${r.texp||'—'} s`,
      '',
      `── URNAS ──────────────────────────────`,
      `Total urnas       : ${r.nUrnas||'—'}`,
      `Dosímetros        : ${r.dos||'—'}`,
      `Urna 1            : ${r.u1?.n||'—'} uds · Sexado: ${r.u1?.date?fmt(pd(r.u1.date)):'—'} · Lote: ${r.u1?.lote||'—'}`,
      `Urna 2            : ${r.u2?.n||'—'} uds · Sexado: ${r.u2?.date?fmt(pd(r.u2.date)):'—'} · Lote: ${r.u2?.lote||'—'}`,
      `Urna 3            : ${r.u3?.n||'—'} uds · Sexado: ${r.u3?.date?fmt(pd(r.u3.date)):'—'} · Lote: ${r.u3?.lote||'—'}`,
      '',
      `── TRANSPORTE ─────────────────────────`,
      `Conductor         : ${r.resp||'—'}`,
      `H. ida inicio     : ${r.hII||'—'}    H. ida llegada  : ${r.hIL||'—'}`,
      `H. vta inicio     : ${r.hVI||'—'}    H. vta llegada  : ${r.hVL||'—'}`,
      '',
      `── TEMPERATURA ────────────────────────`,
      `Tª inicial        : ${r.ti||'—'} °C`,
      `Tª final          : ${r.tf||'—'} °C`,
      `Tª media          : ${r.tm||'—'} °C`,
      '',
      `── IRRADIACIÓN ────────────────────────`,
      `Irradiador        : ${r.irr||'—'}`,
      `H. inicio irr.    : ${r.hIni||'—'}    H. fin irr.     : ${r.hFin||'—'}`,
      r.obs?`\nObservaciones:\n${r.obs}`:'',
    ].filter(l=>l!==null).join('\n');
  }).join('\n\n');
}

// ── EXPORT BUILDERS — MONTH ───────────────────────────
function getMonthData() {
  const today=new Date(); const y=today.getFullYear(); const m=today.getMonth();
  const days=new Date(y,m+1,0).getDate(); const rows=[];
  for(let d=1;d<=days;d++){const dt=new Date(y,m,d);const r=rate(dt);rows.push({date:dt,r,t:S.dose/r});}
  return rows;
}
function buildMonthCSV() {
  const rows=[['Día','Tasa Gy/s','Tiempo (s)'],...getMonthData().map(x=>[fmt(x.date),x.r.toFixed(6),x.t.toFixed(1)])];
  return [rows.map(r=>r.join(',')).join('\r\n'),'text/csv;charset=utf-8;'];
}
function buildMonthJSON() {
  return JSON.stringify(getMonthData().map(x=>({fecha:fmt(x.date),tasa:x.r.toFixed(6),tiempo_s:x.t.toFixed(1)})),null,2);
}
function buildMonthTXT() {
  const d=new Date();
  const MES=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const hdr=`DOSIS MENSUAL — ${MES[d.getMonth()]} ${d.getFullYear()} — Dosis activa: ${S.dose} Gy\n${'═'.repeat(52)}\n`;
  return hdr+getMonthData().map(x=>`${fmt(x.date).padEnd(12)} ${String(x.r.toFixed(6)).padStart(12)} Gy/s   ${String(x.t.toFixed(1)).padStart(10)} s`).join('\n');
}

// ── EXPORT BUILDERS — WEEKLY ──────────────────────────
function getWeeklyData() {
  const today=new Date(); const y=today.getFullYear();
  const jan4=new Date(y,0,4); const fm=new Date(jan4);
  fm.setDate(jan4.getDate()-(jan4.getDay()+6)%7); const rows=[];
  for(let wk=1;wk<=52;wk++){
    const mon=new Date(fm); mon.setDate(fm.getDate()+(wk-1)*7);
    const sun=new Date(mon); sun.setDate(mon.getDate()+6);
    const wed=new Date(mon); wed.setDate(mon.getDate()+2);
    rows.push({wk,mon,sun,t:S.dose/rate(wed)});
  }
  return rows;
}
function buildWeeklyCSV() {
  const rows=[['Semana','Rango','Tiempo (s)'],...getWeeklyData().map(x=>[x.wk,`${fmt(x.mon)} - ${fmt(x.sun)}`,x.t.toFixed(1)])];
  return [rows.map(r=>r.join(',')).join('\r\n'),'text/csv;charset=utf-8;'];
}
function buildWeeklyJSON() {
  return JSON.stringify(getWeeklyData().map(x=>({semana:x.wk,desde:fmt(x.mon),hasta:fmt(x.sun),tiempo_s:x.t.toFixed(1)})),null,2);
}
function buildWeeklyTXT() {
  const y=new Date().getFullYear();
  const hdr=`TABLA ANUAL ${y} — Dosis activa: ${S.dose} Gy\n${'═'.repeat(52)}\n`;
  return hdr+getWeeklyData().map(x=>`Sem ${String(x.wk).padStart(2,'0')}   ${fmt(x.mon)} – ${fmt(x.sun)}   ${String(x.t.toFixed(1)).padStart(10)} s`).join('\n');
}

// ── RECORDS ───────────────────────────────────────────
function renderRecs() {
  const list=document.getElementById('recList');
  const locales=stagedVisible();
  if(!locales.length){list.innerHTML='<div class="remp">No hay registros guardados</div>';return;}
  const pendAt=new Set(LS.pending().map(p=>p.at));
  const rechazos=new Map(LS.rejected().map(r=>[r.at,r.rechazo]));
  list.innerHTML=locales.map((r,i)=>{
    const fIrr=r.fchIrr?fmt(pd(r.fchIrr)):'Sin fecha';
    let sync='';
    if(rechazos.has(r.at)) sync=`<span class="cloudbdg err" style="margin-left:8px" title="${esc(rechazos.get(r.at))}">⚠ rechazado por el servidor</span>`;
    else if(LS.token()||pendAt.has(r.at)) sync=pendAt.has(r.at)?'<span class="cloudbdg off" style="margin-left:8px">⏳ pendiente</span>':'<span class="cloudbdg ok" style="margin-left:8px">☁ sincronizado</span>';
    const motivo=rechazos.has(r.at)?`<div class="robs">⚠ ${esc(rechazos.get(r.at))} — corrígelo y vuelve a guardarlo.</div>`:'';
    return `<div class="ritem">
      <div class="rdate">📋 ${esc(fIrr)} — Sem. ${esc(r.semana||'?')}${sync}</div>
      <div class="rdets">
        <span>Urnas: <strong>${esc(r.nUrnas||'—')}</strong></span>
        <span>Tiempo: <strong>${esc(r.texp||'—')} s</strong></span>
        <span>Tasa: <strong>${r.tasa?esc(parseFloat(r.tasa).toFixed(5)):'—'} Gy/s</strong></span>
        <span>Dosím.: <strong>${esc(r.dos||'—')}</strong></span>
        <span>Conductor: <strong>${esc(r.resp||'—')}${r.respCodigo?` (${esc(r.respCodigo)})`:''}</strong></span>
        <span>Tª media: <strong>${esc(r.tm||'—')} °C</strong></span>
      </div>
      ${motivo}
      ${r.obs?`<div class="robs">📝 ${esc(r.obs.substring(0,100))}${r.obs.length>100?'…':''}</div>`:''}</div>`;
  }).join('<div style="height:8px"></div>');
}
async function clearRecs() {
  const ok=await confirmDialog('¿Eliminar los registros guardados en este dispositivo? Los que ya estén sincronizados seguirán en la nube; los pendientes de enviar se enviarán igualmente.',
    {title:'Eliminar registros',okText:'Eliminar todos',okClass:'br'});
  if(!ok) return;
  const visibles=new Set(stagedVisible());
  S.staged=S.staged.filter(r=>!visibles.has(r)); LS.setS(S.staged);
  const vis=new Set([...visibles].map(r=>r.at));
  LS.setRejected(LS.rejected().filter(r=>!vis.has(r.at)));
  updStagedUI(); renderRecs(); toast('Registros eliminados de este dispositivo');
}

// ── HISTORIAL (registros guardados en Supabase, filtrables por fecha y otros campos) ──
async function buscarHistorial() {
  const desde=document.getElementById('hDesde').value;
  const hasta=document.getElementById('hHasta').value;
  const box=document.getElementById('histList');
  const note=document.getElementById('histNote');
  box.innerHTML='<div class="remp"><span class="spin"></span>Buscando…</div>';
  S.histRaw=[]; S.histFiltered=[];
  if(!LS.token()){
    box.innerHTML='<div class="remp">Inicia sesión con conexión a internet para consultar el historial de la nube.</div>';
    note.textContent='';
    return;
  }
  try{
    const data=await apiPost('/registros',{action:'listar',token:LS.token(),payload:{desde,hasta}});
    setCloudState('ok');
    S.histRaw=data.registros||[];
    S.histTruncado=!!data.truncado;
    poblarFiltrosHistorial(S.histRaw);
    aplicarFiltrosHistorial();
  }catch(e){
    setCloudState(e.isNetwork?'off':'err');
    box.innerHTML='<div class="remp">No se ha podido consultar el historial (sin conexión o error del servidor).</div>';
    note.textContent='';
  }
}
function filtroHistorialRapido() {
  const hoy=new Date();
  const hace30=new Date(); hace30.setDate(hoy.getDate()-30);
  const iso=tod;
  document.getElementById('hDesde').value=iso(hace30);
  document.getElementById('hHasta').value=iso(hoy);
  buscarHistorial();
}
function poblarFiltrosHistorial(regs) {
  const condSel=document.getElementById('hConductor');
  const usrSel=document.getElementById('hUsuario');
  const irrSel=document.getElementById('hIrradiador');
  const condActual=condSel.value, usrActual=usrSel.value, irrActual=irrSel.value;
  const conductores=[...new Map(regs.filter(r=>r.conductor_nick).map(r=>[r.conductor_nick,r.conductor_nombre||r.conductor_nick])).entries()];
  const usuarios=[...new Set(regs.map(r=>r.creado_por).filter(Boolean))].sort();
  const irradiadores=[...new Set(regs.map(r=>r.irradiador_nombre||r.irradiador).filter(Boolean))].sort();
  condSel.innerHTML='<option value="">Todos</option>'+conductores.map(([nick,nom])=>`<option value="${esc(nick)}">${esc(nom)}</option>`).join('');
  usrSel.innerHTML='<option value="">Todos</option>'+usuarios.map(u=>`<option value="${esc(u)}">${esc(u)}</option>`).join('');
  irrSel.innerHTML='<option value="">Todos</option>'+irradiadores.map(i=>`<option value="${esc(i)}">${esc(i)}</option>`).join('');
  if(conductores.some(([nick])=>nick===condActual)) condSel.value=condActual;
  if(usuarios.includes(usrActual)) usrSel.value=usrActual;
  if(irradiadores.includes(irrActual)) irrSel.value=irrActual;
}
function dosisRegistro(r) {
  const d=(r.tasa&&r.tiempo_exposicion)?Math.round(parseFloat(r.tasa)*parseFloat(r.tiempo_exposicion)):null;
  return d;
}
function estadoRegistro(r) { return r.h_fin_irr ? 'completa' : 'incompleta'; }
function aplicarFiltrosHistorial() {
  const cond=document.getElementById('hConductor').value;
  const usr=document.getElementById('hUsuario').value;
  const irr=document.getElementById('hIrradiador').value;
  const est=document.getElementById('hEstado').value;
  const sem=document.getElementById('hSemana').value.trim();
  const txt=document.getElementById('hTexto').value.trim().toLowerCase();
  let regs=S.histRaw||[];
  if(cond) regs=regs.filter(r=>r.conductor_nick===cond);
  if(usr)  regs=regs.filter(r=>r.creado_por===usr);
  if(irr)  regs=regs.filter(r=>(r.irradiador_nombre||r.irradiador)===irr);
  if(est)  regs=regs.filter(r=>estadoRegistro(r)===est);
  if(sem)  regs=regs.filter(r=>String(r.semana_iso||'')===sem);
  if(txt)  regs=regs.filter(r=>
    (r.irradiador_nombre||r.irradiador||'').toLowerCase().includes(txt) ||
    (r.observaciones||'').toLowerCase().includes(txt) ||
    (r.conductor_nombre||'').toLowerCase().includes(txt) ||
    (r.creado_por||'').toLowerCase().includes(txt));
  regs=ordenarRegistros(regs);
  S.histFiltered=regs;
  renderHistorial(regs);
  calcularTotalesHistorial(regs);
  if(S.histVista==='graf') dibujarGraficaHistorial();
  const note=document.getElementById('histNote');
  if(note) note.textContent=`${regs.length} registro(s) encontrado(s)`+(S.histTruncado?' — hay más de 10 000 en este periodo: acota las fechas para verlos todos':'');
}
function minutosEntre(hIni, hFin) {
  if(!hIni||!hFin) return 0;
  const [h1,m1]=hIni.split(':').map(Number);
  const [h2,m2]=hFin.split(':').map(Number);
  if(isNaN(h1)||isNaN(m1)||isNaN(h2)||isNaN(m2)) return 0;
  let mins=(h2*60+m2)-(h1*60+m1);
  if(mins<0) mins+=24*60; // por si cruza medianoche
  return mins;
}
// Campo calculado del paso "Irradiación": diferencia entre H. inicio y H.
// fin de irradiación, en formato h:mm (p. ej. 0:20).
function calcDuracionIrr() {
  const el=document.getElementById('fDuracionIrr');
  if(!el) return;
  const hIni=document.getElementById('fHini').value;
  const hFin=document.getElementById('fHfin').value;
  if(!hIni||!hFin){ el.value=''; return; }
  const mins=minutosEntre(hIni,hFin);
  el.value=formatHorasHM(mins/60);
}
// Minutos -> "h:mm" (mismo formato que en Fichaje e Informes): 80 -> "1:20"
function formatMinutos(mins) {
  return formatHorasHM((parseFloat(mins)||0)/60);
}
function calcularTotalesHistorial(regs) {
  const wrap=document.getElementById('histTotalesWrap');
  if(!wrap) return;
  if(!regs.length){ wrap.style.display='none'; return; }
  wrap.style.display='grid';
  let totalUsv=0, totalIda=0, totalVuelta=0;
  regs.forEach(r=>{
    totalUsv+=parseFloat(r.exposicion_usv)||0;
    totalIda+=minutosEntre(r.h_ida_inicio,r.h_ida_llegada);
    totalVuelta+=minutosEntre(r.h_vuelta_inicio,r.h_vuelta_llegada);
  });
  document.getElementById('totExpUsv').textContent=totalUsv?totalUsv.toFixed(2):'0';
  document.getElementById('totIda').textContent=formatMinutos(totalIda);
  document.getElementById('totVuelta').textContent=formatMinutos(totalVuelta);
  document.getElementById('totViaje').textContent=formatMinutos(totalIda+totalVuelta);
}
function ordenarHistorial(campo) {
  if(S.histSort.campo===campo) S.histSort.dir=(S.histSort.dir==='asc')?'desc':'asc';
  else { S.histSort.campo=campo; S.histSort.dir=(campo==='fecha_irradiacion')?'desc':'asc'; }
  S.histFiltered=ordenarRegistros(S.histFiltered);
  renderHistorial(S.histFiltered);
}
function ordenarRegistros(regs) {
  const {campo,dir}=S.histSort;
  const mul=dir==='asc'?1:-1;
  const val=(r)=>{
    if(campo==='dosis') return dosisRegistro(r)||0;
    if(campo==='estado') return estadoRegistro(r);
    return r[campo];
  };
  return [...regs].sort((a,b)=>{
    let va=val(a), vb=val(b);
    if(va==null&&vb==null) return 0;
    if(va==null) return 1; if(vb==null) return -1;
    if(typeof va==='string') return va.localeCompare(vb)*mul;
    return (va-vb)*mul;
  });
}
function renderHistorial(regs) {
  document.querySelectorAll('.hist-table th[data-sort]').forEach(th=>{
    const ico=th.querySelector('.sort-ico');
    if(th.dataset.sort===S.histSort.campo){
      th.classList.add('sorted'); ico.textContent=S.histSort.dir==='asc'?'▲':'▼';
    } else { th.classList.remove('sorted'); ico.textContent=''; }
  });

  const tbody=document.getElementById('histTableBody');
  const box=document.getElementById('histList');
  if(!regs.length){
    tbody.innerHTML='<tr><td colspan="5" class="remp">No hay registros con estos filtros</td></tr>';
    box.innerHTML='<div class="remp">No hay registros con estos filtros</div>';
    return;
  }

  tbody.innerHTML=regs.map(r=>{
    const fIrr=r.fecha_irradiacion?fmt(pd(r.fecha_irradiacion)):'Sin fecha';
    const dosis=dosisRegistro(r);
    const completa=estadoRegistro(r)==='completa';
    return `<tr onclick="abrirDetalleRegistro('${escJs(r.id)}')">
      <td>${esc(fIrr)}</td>
      <td>${r.conductor_nombre?esc(r.conductor_nombre):'<span class="td-muted">—</span>'}</td>
      <td>${esc(r.n_urnas||'—')}</td>
      <td>${dosis?dosis+' Gy':'<span class="td-muted">—</span>'}</td>
      <td><span class="badge ${completa?'badge-success':'badge-caution'}">${completa?'✓ Completada':'! Incompleta'}</span></td>
    </tr>`;
  }).join('');

  box.innerHTML=regs.map(r=>{
    const fIrr=r.fecha_irradiacion?fmt(pd(r.fecha_irradiacion)):'Sin fecha';
    const completa=estadoRegistro(r)==='completa';
    return `<div class="ritem" style="cursor:pointer" onclick="abrirDetalleRegistro('${escJs(r.id)}')">
      <div class="rdate">📋 ${esc(fIrr)} — Sem. ${esc(r.semana_iso||'?')} <span style="color:var(--txt3);font-weight:400">· guardado por ${esc(r.creado_por||'—')}</span></div>
      <div class="rdets">
        <span>Urnas: <strong>${esc(r.n_urnas||'—')}</strong></span>
        <span>Tiempo: <strong>${esc(r.tiempo_exposicion||'—')} s</strong></span>
        <span>Tasa: <strong>${r.tasa?esc(parseFloat(r.tasa).toFixed(5)):'—'} Gy/s</strong></span>
        <span>Dosím.: <strong>${esc(r.dosimetros||'—')}</strong></span>
        <span>Conductor: <strong>${esc(r.conductor_nombre||'—')}${r.conductor_codigo?` (${esc(r.conductor_codigo)})`:''}</strong></span>
        <span>Tª media: <strong>${esc(r.temp_media||'—')} °C</strong></span>
      </div>
      ${r.observaciones?`<div class="robs">📝 ${esc(r.observaciones.substring(0,100))}${r.observaciones.length>100?'…':''}</div>`:''}
      <div style="margin-top:8px"><span class="badge ${completa?'badge-success':'badge-caution'}">${completa?'✓ Completada':'! Incompleta'}</span></div>
      </div>`;
  }).join('<div style="height:8px"></div>');
}
async function eliminarHistorialRegistro(id) {
  const ok=await confirmDialog('¿Eliminar este registro de la nube? No se puede deshacer.',
    {title:'Eliminar registro',okText:'Eliminar',okClass:'br'});
  if(!ok) return;
  try{
    await apiPost('/registros',{action:'eliminar',token:LS.token(),payload:{id}});
    setCloudState('ok');
    invalidarCacheDashboard();
    toast('Registro eliminado');
    buscarHistorial();
  }catch(e){
    toast('⚠ '+e.message);
  }
}

// ── DETALLE DE REGISTRO ────────────────────────────────
function abrirDetalleRegistro(id) {
  const r=(S.histRaw||[]).find(x=>x.id===id);
  if(!r) return;
  S.detRegistro=r;
  const fIrr=r.fecha_irradiacion?fmt(pd(r.fecha_irradiacion)):'Sin fecha';
  const completa=estadoRegistro(r)==='completa';
  const dosis=dosisRegistro(r);
  document.getElementById('detSub').textContent=`${fIrr} · guardado por ${r.creado_por||'—'} el ${r.created_at?new Date(r.created_at).toLocaleString('es-ES'):'—'}`;

  const item=(lbl,val)=>`<div><div class="det-item-lbl">${esc(lbl)}</div><div class="det-item-val">${val!=null&&val!==''?esc(val):'—'}</div></div>`;

  document.getElementById('detBody').innerHTML=`
    <div class="det-sect">
      <div class="det-sect-hd">Identificación</div>
      <div class="det-grid">
        ${item('Fecha irradiación',fIrr)}
        ${item('Semana ISO',r.semana_iso)}
        ${item('Estado','')}
      </div>
      <div style="margin-top:8px"><span class="badge ${completa?'badge-success':'badge-caution'}">${completa?'✓ Completada':'! Incompleta'}</span>
      <span class="badge badge-info" style="margin-left:6px">☁ Sincronizado</span></div>
    </div>
    <div class="det-sect">
      <div class="det-sect-hd">Datos de irradiación</div>
      <div class="det-grid">
        ${item('Tasa (Gy/s)', r.tasa?parseFloat(r.tasa).toFixed(8):null)}
        ${item('Tiempo exp. teórico (s)', r.tiempo_exposicion)}
        ${item('Tiempo exp. real (s)', r.tiempo_exposicion_real)}
        ${item('Dosis aplicada', dosis?dosis+' Gy':null)}
        ${item('Nº urnas', r.n_urnas)}
        ${item('Dosímetros', r.dosimetros)}
        ${item('Irradiador', r.irradiador_nombre||r.irradiador)}
        ${item('Exposición operador', r.exposicion_usv!=null?r.exposicion_usv+' µSv':null)}
      </div>
    </div>
    <div class="det-sect">
      <div class="det-sect-hd">Transporte</div>
      <div class="det-grid">
        ${item('Conductor', r.conductor_nombre)}
        ${item('Código', r.conductor_codigo)}
        ${item('H. ida', (r.h_ida_inicio||'—')+' → '+(r.h_ida_llegada||'—'))}
        ${item('H. vuelta', (r.h_vuelta_inicio||'—')+' → '+(r.h_vuelta_llegada||'—'))}
      </div>
    </div>
    <div class="det-sect">
      <div class="det-sect-hd">Temperatura</div>
      <div class="det-grid">
        ${item('Inicial (°C)', r.temp_inicial)}
        ${item('Final (°C)', r.temp_final)}
        ${item('Media (°C)', r.temp_media)}
        ${item('H. inicio irr.', r.h_inicio_irr)}
        ${item('H. fin irr.', r.h_fin_irr)}
      </div>
    </div>
    ${r.observaciones?`<div class="det-sect"><div class="det-sect-hd">Observaciones</div><div class="det-obs">${esc(r.observaciones)}</div></div>`:''}
  `;
  document.getElementById('detOv').classList.add('on');
}
function cerrarDetalleRegistro() {
  document.getElementById('detOv').classList.remove('on');
}
function cargarRegistroEnFormulario(r) {
  document.getElementById('fchIrr').value=r.fecha_irradiacion||'';
  onFecha();
  document.getElementById('fResp').value=r.conductor_nick||'';
  onConductorChange();
  document.getElementById('fHII').value=r.h_ida_inicio||'';
  document.getElementById('fHIL').value=r.h_ida_llegada||'';
  document.getElementById('fHVI').value=r.h_vuelta_inicio||'';
  document.getElementById('fHVL').value=r.h_vuelta_llegada||'';
  document.getElementById('fTi').value=r.temp_inicial??'';
  document.getElementById('fTf').value=r.temp_final??'';
  calcTm();
  const irrSel=document.getElementById('fIrrSel');
  if(irrSel) irrSel.value=r.irradiador_id||'';
  onIrradiadorChange();
  document.getElementById('fExpUsv').value=r.exposicion_usv??'';
  document.getElementById('fDos').value=r.dosimetros??'';
  document.getElementById('fHini').value=r.h_inicio_irr||'';
  document.getElementById('fHfin').value=r.h_fin_irr||'';
  calcDuracionIrr();
  document.getElementById('fObs').value=r.observaciones||'';
  S.urna1=r.urna1&&typeof r.urna1==='object'?{...r.urna1}:{n:'',date:'',lote:''};
  S.urna2=r.urna2&&typeof r.urna2==='object'?{...r.urna2}:{n:'',date:'',lote:''};
  S.urna3=r.urna3&&typeof r.urna3==='object'?{...r.urna3}:{n:'',date:'',lote:''};
  renderUrnaCards(); updMpill();
  go('form');
  stab('urnas', document.querySelector('.step[data-step="urnas"]'));
}
function editarRegistroDesdeDetalle() {
  const r=S.detRegistro; if(!r) return;
  if(!S.isAdmin && r.creado_por!==S.user){ toast('Solo puedes editar tus propios registros'); return; }
  S.editingId=r.id;
  cargarRegistroEnFormulario(r);
  const gbtn=document.getElementById('gbtn'); if(gbtn) gbtn.innerHTML='💾 Actualizar registro';
  cerrarDetalleRegistro();
  toast('Editando registro — los cambios sustituirán al original al guardar');
}
function duplicarRegistroDesdeDetalle() {
  const r=S.detRegistro; if(!r) return;
  S.editingId=null;
  cargarRegistroEnFormulario(r);
  cerrarDetalleRegistro();
  toast('Registro duplicado en el formulario — revisa los datos antes de guardar');
}
async function exportarRegistroDesdeDetalle() {
  const r=S.detRegistro; if(!r) return;
  const {header,rows}=buildHistRows([r]);
  const content=[header,...rows].map(csvFila).join('\r\n');
  const filename=`registro_${r.id.slice(0,8)}.csv`;
  const result=await dlFile(filename,content,'text/csv;charset=utf-8;');
  if(result===null) return;
  showSaveDlg(filename,'csv',new Blob(['\uFEFF'+content]).size,'hist',result);
}
async function eliminarRegistroDesdeDetalle() {
  const r=S.detRegistro; if(!r) return;
  cerrarDetalleRegistro();
  await eliminarHistorialRegistro(r.id);
}

// ── GRÁFICAS DEL HISTORIAL ─────────────────────────────
let histChartInstance=null;
async function cambiarVistaHistorial(vista) {
  S.histVista=vista;
  document.getElementById('hTabLista').className='btn bs '+(vista==='lista'?'bp':'bo');
  document.getElementById('hTabGraf').className='btn bs '+(vista==='graf'?'bp':'bo');
  document.getElementById('histList').style.display=vista==='lista'?'':'none';
  document.getElementById('histChartWrap').style.display=vista==='graf'?'':'none';
  document.getElementById('hGrafSelWrap').style.display=vista==='graf'?'':'none';
  if(vista==='graf'){
    if(!window.Chart){ try{ await cargarLib('chart'); }catch{ toast('⚠ No se pudo cargar la librería de gráficas (revisa tu conexión a internet)'); return; } }
    dibujarGraficaHistorial();
  }
}
function temaColor(varName) {
  return getComputedStyle(document.body).getPropertyValue(varName).trim() || '#4C6EF5';
}
function dibujarGraficaHistorial() {
  const canvas=document.getElementById('histChart');
  if(!canvas||!window.Chart) return;
  if(histChartInstance){ histChartInstance.destroy(); histChartInstance=null; }

  const regs=[...(S.histFiltered||[])].filter(r=>r.fecha_irradiacion)
    .sort((a,b)=>a.fecha_irradiacion.localeCompare(b.fecha_irradiacion));
  if(!regs.length) return;

  // Paleta del tema activo: Royal/Sky/Turquesa en claro, Navy/Lavanda/Berenjena en oscuro
  const cPrimary=temaColor('--blue-l'), cSecondary=temaColor('--sky')||temaColor('--purple-l'),
        cTertiary=temaColor('--teal-l'), cGrid=temaColor('--brd'), cTick=temaColor('--txt3');

  const tipo=document.getElementById('hChartTipo').value;
  let type='line', labels, datasets, yTitle='', unidad='';

  if(tipo==='temp'){
    labels=regs.map(r=>fmt(pd(r.fecha_irradiacion)));
    datasets=[
      {label:'Tª inicial',data:regs.map(r=>r.temp_inicial),borderColor:cPrimary,backgroundColor:cPrimary,tension:.3,spanGaps:true},
      {label:'Tª final',data:regs.map(r=>r.temp_final),borderColor:cSecondary,backgroundColor:cSecondary,tension:.3,spanGaps:true},
      {label:'Tª media',data:regs.map(r=>r.temp_media),borderColor:cTertiary,backgroundColor:cTertiary,tension:.3,spanGaps:true},
    ];
    yTitle='°C'; unidad=' °C';
  } else if(tipo==='tasa'){
    labels=regs.map(r=>fmt(pd(r.fecha_irradiacion)));
    datasets=[{label:'Tasa',data:regs.map(r=>r.tasa),borderColor:cPrimary,backgroundColor:cPrimary,tension:.3,spanGaps:true}];
    yTitle='Gy/s'; unidad=' Gy/s';
  } else if(tipo==='texp'){
    labels=regs.map(r=>fmt(pd(r.fecha_irradiacion)));
    datasets=[{label:'Tiempo exposición teórico',data:regs.map(r=>r.tiempo_exposicion),borderColor:cPrimary,backgroundColor:cPrimary,tension:.3,spanGaps:true}];
    yTitle='s'; unidad=' s';
  } else if(tipo==='texpReal'){
    labels=regs.map(r=>fmt(pd(r.fecha_irradiacion)));
    datasets=[{label:'Tiempo exposición real',data:regs.map(r=>r.tiempo_exposicion_real),borderColor:cSecondary,backgroundColor:cSecondary,tension:.3,spanGaps:true}];
    yTitle='s'; unidad=' s';
  } else if(tipo==='expUsv'){
    labels=regs.map(r=>fmt(pd(r.fecha_irradiacion)));
    datasets=[{label:'Exposición operador',data:regs.map(r=>r.exposicion_usv),borderColor:cTertiary,backgroundColor:cTertiary,tension:.3,spanGaps:true}];
    yTitle='µSv'; unidad=' µSv';
  } else if(tipo==='urnas'){
    labels=regs.map(r=>fmt(pd(r.fecha_irradiacion)));
    datasets=[{label:'Nº urnas',data:regs.map(r=>r.n_urnas),borderColor:cTertiary,backgroundColor:cTertiary,tension:.3,spanGaps:true}];
    yTitle='urnas'; unidad=' urnas';
  } else if(tipo==='semana'){
    type='bar';
    const porSemana={};
    regs.forEach(r=>{const k=r.semana_iso||'?'; porSemana[k]=(porSemana[k]||0)+1;});
    labels=Object.keys(porSemana).sort((a,b)=>(+a)-(+b)).map(k=>'Sem. '+k);
    datasets=[{label:'Registros',data:Object.keys(porSemana).sort((a,b)=>(+a)-(+b)).map(k=>porSemana[k]),
      backgroundColor:cPrimary,borderRadius:4}];
    yTitle='registros'; unidad=' registros';
  }

  histChartInstance=new Chart(canvas.getContext('2d'),{
    type, data:{labels,datasets},
    options:{
      responsive:true,
      animation:{duration:250},
      plugins:{
        legend:{labels:{color:cTick,usePointStyle:true,boxWidth:8,font:{family:"Inter"}}},
        tooltip:{callbacks:{label:(ctx)=>`${ctx.dataset.label}: ${ctx.formattedValue}${unidad}`}}
      },
      scales:{
        x:{ticks:{color:cTick,maxRotation:60,minRotation:0},grid:{display:false}},
        y:{ticks:{color:cTick},grid:{color:cGrid},title:{display:true,text:yTitle,color:cTick}}
      }
    }
  });
}

// ── EXPORT HISTORIAL — CSV / Excel / PDF ──────────────
function buildHistRows(regs) {
  const header=['Fecha Irradiación','Semana ISO','Guardado por','Conductor','Código','Tasa Gy/s',
    'Tiempo Exp. Teórico(s)','Tiempo Exp. Real(s)','Nº Urnas','Dosímetros',
    'H.Ida Ini','H.Ida Lle','H.Vta Ini','H.Vta Lle','Tª Ini(°C)','Tª Fin(°C)','Tª Media(°C)',
    'Irradiador','Código Irr.','H.Ini Irr.','H.Fin Irr.','Exposición(µSv)','Observaciones'];
  const rows=regs.map(r=>[
    r.fecha_irradiacion?fmt(pd(r.fecha_irradiacion)):'',
    r.semana_iso||'', r.creado_por||'', r.conductor_nombre||'', r.conductor_codigo||'',
    r.tasa?parseFloat(r.tasa).toFixed(8):'', r.tiempo_exposicion||'', r.tiempo_exposicion_real||'',
    r.n_urnas||'', r.dosimetros||'',
    r.h_ida_inicio||'', r.h_ida_llegada||'', r.h_vuelta_inicio||'', r.h_vuelta_llegada||'',
    r.temp_inicial||'', r.temp_final||'', r.temp_media||'',
    r.irradiador_nombre||r.irradiador||'', r.irradiador_codigo||'', r.h_inicio_irr||'', r.h_fin_irr||'',
    r.exposicion_usv||'', r.observaciones||''
  ]);
  return {header,rows};
}
async function exportHistCSV() {
  const regs=S.histFiltered||[];
  if(!regs.length){toast('No hay registros para exportar');return;}
  const {header,rows}=buildHistRows(regs);
  const content=[header,...rows].map(csvFila).join('\r\n');
  const filename=`historial_${dateStamp()}.csv`;
  const result=await dlFile(filename,content,'text/csv;charset=utf-8;');
  if(result===null) return;
  showSaveDlg(filename,'csv',new Blob(['\uFEFF'+content]).size,'hist',result);
}
async function exportHistXLSX() {
  const regs=S.histFiltered||[];
  if(!regs.length){toast('No hay registros para exportar');return;}
  if(!window.XLSX){ try{ await cargarLib('xlsx'); }catch{ toast('⚠ No se pudo cargar la librería de Excel (revisa tu conexión a internet)'); return; } }
  const {header,rows}=buildHistRows(regs);
  const ws=XLSX.utils.aoa_to_sheet([header,...rows]);
  ws['!cols']=header.map(()=>({wch:16}));
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Historial');
  const arrBuf=XLSX.write(wb,{type:'array',bookType:'xlsx'});
  const blob=new Blob([arrBuf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
  const filename=`historial_${dateStamp()}.xlsx`;
  const result=await dlBlob(filename,blob);
  if(result===null) return;
  showSaveDlg(filename,'xlsx',blob.size,'hist',result);
}
// ── Logo para la cabecera de los PDF (Historial e Informes) ────
// jsPDF necesita la imagen ya cargada como dataURL (no basta con darle la
// ruta), así que se precarga una sola vez POR IMAGEN y se reutiliza en cada
// export (Historial y el generador de Informes usan logos distintos).
const _logoInformeCache = new Map();
function cargarLogoInforme(ruta) {
  if (_logoInformeCache.has(ruta)) return _logoInformeCache.get(ruta);
  const promesa = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        // Se dibuja como mucho a 256 px de ancho: de sobra para los 64 pt que ocupa en el PDF.
        const esc_ = Math.min(1, 256 / img.naturalWidth);
        const w = Math.max(1, Math.round(img.naturalWidth * esc_)), h = Math.max(1, Math.round(img.naturalHeight * esc_));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve({ dataURL: canvas.toDataURL('image/png'), w, h });
      } catch (e) { resolve(null); } // p.ej. restricciones de lienzo en algunos navegadores
    };
    img.onerror = () => resolve(null); // sin conexión / imagen no disponible: el PDF se genera igualmente
    img.src = ruta;
  });
  _logoInformeCache.set(ruta, promesa);
  return promesa;
}
// Cabecera común de todos los PDF de la app: logo arriba a la izquierda +
// texto de crédito debajo (SIEMPRE se dibuja, cargue o no la imagen), título
// y fecha de generación a la derecha del logo. El hueco reservado para el
// logo es siempre el mismo (misma proporción 3:2), para que el resto del
// informe no salte de sitio según haya o no haya conexión. Devuelve dónde
// puede empezar el contenido (tablaY) para que nada se solape.
function dibujarCabeceraPDF(doc, logo, titulo, detalle) {
  const logoX=40, logoY=14, logoW=64;
  const logoH = logo ? logoW*(logo.h/logo.w) : logoW*(2/3);
  if (logo) doc.addImage(logo.dataURL,'PNG',logoX,logoY,logoW,logoH);
  doc.setFontSize(6.5); doc.setTextColor(140);
  doc.text(`by Heute schöne Tag · © ${new Date().getFullYear()}`, logoX, logoY+logoH+10);
  doc.setTextColor(0);
  const textX=logoX+logoW+14;
  const tablaY=Math.max(55, logoY+logoH+22);
  doc.setFontSize(14); doc.text(titulo,textX,32);
  doc.setFontSize(9);  doc.text(`Generado: ${new Date().toLocaleString()}`,textX,47);
  if(detalle){ doc.text(detalle,textX,61); }   // p. ej. «Periodo: 01/09/2026 – 20/09/2026 · Usuario: ana»
  return {textX, tablaY};
}
async function exportHistPDF() {
  const regs=S.histFiltered||[];
  if(!regs.length){toast('No hay registros para exportar');return;}
  if(!window.jspdf){ try{ await cargarLib('pdf'); }catch{ toast('⚠ No se pudo cargar la librería de PDF (revisa tu conexión a internet)'); return; } }
  const {header,rows}=buildHistRows(regs);
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({orientation:'landscape',unit:'pt',compress:true});
  const logo=await cargarLogoInforme('img/logo_tie_mosquito.png');
  const {tablaY}=dibujarCabeceraPDF(doc, logo, 'Values Irradiation WEB-210 — Historial');
  doc.autoTable({head:[header],body:rows,startY:tablaY,styles:{fontSize:7,cellPadding:3},headStyles:{fillColor:[76,110,245]}});
  const blob=doc.output('blob');
  const filename=`historial_${dateStamp()}.pdf`;
  const result=await dlBlob(filename,blob);
  if(result===null) return;
  showSaveDlg(filename,'pdf',blob.size,'hist',result);
}

// ── INFORMES (informes personalizados: elegir campos + exportar) ──
// Formatea una urna ({n, date, lote}) como una sola celda legible.
function fmtUrna(u) {
  if(!u||typeof u!=='object') return '';
  const partes=[u.n?`Nº ${u.n}`:'', u.date?fmt(pd(u.date)):'', u.lote?`Lote ${u.lote}`:''].filter(Boolean);
  return partes.join(' · ');
}
// Catálogo de TODOS los campos disponibles en los formularios, agrupados
// igual que la ficha de detalle del historial, para que el usuario elija
// cuáles quiere ver en su informe.
const CAMPOS_INFORME=[
  {id:'fecha',        label:'Fecha irradiación',        grupo:'Identificación', get:r=>r.fecha_irradiacion?fmt(pd(r.fecha_irradiacion)):''},
  {id:'semana',       label:'Semana ISO',                grupo:'Identificación', get:r=>r.semana_iso??''},
  {id:'creadoPor',    label:'Guardado por',              grupo:'Identificación', get:r=>r.creado_por||''},
  {id:'conductor',    label:'Conductor',                 grupo:'Transporte', get:r=>r.conductor_nombre||''},
  {id:'conductorCod', label:'Código conductor',          grupo:'Transporte', get:r=>r.conductor_codigo||''},
  {id:'hIdaIni',      label:'H. ida inicio',             grupo:'Transporte', get:r=>r.h_ida_inicio||''},
  {id:'hIdaLle',      label:'H. ida llegada',            grupo:'Transporte', get:r=>r.h_ida_llegada||''},
  {id:'hVtaIni',      label:'H. vuelta inicio',          grupo:'Transporte', get:r=>r.h_vuelta_inicio||''},
  {id:'hVtaLle',      label:'H. vuelta llegada',         grupo:'Transporte', get:r=>r.h_vuelta_llegada||''},
  {id:'tempIni',      label:'Temperatura inicial (°C)',  grupo:'Temperatura', get:r=>r.temp_inicial??''},
  {id:'tempFin',      label:'Temperatura final (°C)',    grupo:'Temperatura', get:r=>r.temp_final??''},
  {id:'tempMedia',    label:'Temperatura media (°C)',    grupo:'Temperatura', get:r=>r.temp_media??''},
  {id:'irradiador',   label:'Irradiador',                grupo:'Irradiación', get:r=>r.irradiador_nombre||r.irradiador||''},
  {id:'irradiadorCod',label:'Código irradiador',         grupo:'Irradiación', get:r=>r.irradiador_codigo||''},
  {id:'tasa',         label:'Tasa (Gy/s)',               grupo:'Irradiación', get:r=>r.tasa?parseFloat(r.tasa).toFixed(8):''},
  {id:'texp',         label:'Tiempo exposición teórico (s)', grupo:'Irradiación', get:r=>r.tiempo_exposicion??'', sumable:true},
  {id:'texpReal',     label:'Tiempo exposición real (s)',    grupo:'Irradiación', get:r=>r.tiempo_exposicion_real??'', sumable:true},
  {id:'hIniIrr',      label:'H. inicio irradiación',     grupo:'Irradiación', get:r=>r.h_inicio_irr||''},
  {id:'hFinIrr',      label:'H. fin irradiación',        grupo:'Irradiación', get:r=>r.h_fin_irr||''},
  {id:'duracionIrr',  label:'Duración irradiación (h:mm)', grupo:'Irradiación', sumable:true, formato:'hm',
    get:r=>{
      if(!r.h_inicio_irr||!r.h_fin_irr) return '';
      return formatHorasHM(minutosEntre(r.h_inicio_irr,r.h_fin_irr)/60);
    },
    sum:r=>(r.h_inicio_irr&&r.h_fin_irr)?minutosEntre(r.h_inicio_irr,r.h_fin_irr)/60:0},
  {id:'expUsv',       label:'Exposición operador (µSv)', grupo:'Irradiación', get:r=>r.exposicion_usv??'', sumable:true},
  {id:'dosimetros',   label:'Nº dosímetros',             grupo:'Irradiación', get:r=>r.dosimetros??'', sumable:true},
  {id:'nUrnas',       label:'Nº urnas',                  grupo:'Urnas', get:r=>r.n_urnas??'', sumable:true},
  {id:'urna1',        label:'Urna 1 (nº · fecha · lote)',grupo:'Urnas', get:r=>fmtUrna(r.urna1)},
  {id:'urna2',        label:'Urna 2 (nº · fecha · lote)',grupo:'Urnas', get:r=>fmtUrna(r.urna2)},
  {id:'urna3',        label:'Urna 3 (nº · fecha · lote)',grupo:'Urnas', get:r=>fmtUrna(r.urna3)},
  {id:'obs',          label:'Observaciones',             grupo:'Observaciones', get:r=>r.observaciones||''},
];
// Campos disponibles cuando el informe es de Fichajes (control horario) en
// vez de Registros de irradiación — son entidades distintas, así que cada
// una tiene su propio catálogo de campos.
const CAMPOS_INFORME_FICHAJES=[
  {id:'fecha',            label:'Fecha',                        grupo:'Fichaje', get:r=>r.fecha?fmt(pd(r.fecha)):''},
  {id:'usuario',          label:'Usuario',                      grupo:'Fichaje', get:r=>r.usuario_nick||''},
  {id:'tipoHorario',      label:'Tipo de jornada',               grupo:'Fichaje', get:r=>r.tipo_horario_aplicado==='flexible'?'Flexible':(r.tipo_horario_aplicado==='fijo'?'Fija':'')},
  {id:'horaEntrada',      label:'Hora entrada',                 grupo:'Fichaje', get:r=>r.hora_entrada||''},
  {id:'horaSalida',       label:'Hora salida',                  grupo:'Fichaje', get:r=>r.hora_salida||''},
  {id:'horarioEntradaEsp',label:'Horario de entrada esperado',  grupo:'Fichaje', get:r=>r.horario_entrada_esperado||''},
  {id:'horarioEsperado',  label:'Horario de salida esperado',   grupo:'Fichaje', get:r=>r.horario_salida_esperado||''},
  {id:'horasDeMas',       label:'Horas de más (h:mm)',          grupo:'Fichaje', sumable:true, formato:'hm',
    get:r=>(r.horas_de_mas!=null&&r.horas_de_mas!=='')?formatHorasHM(r.horas_de_mas):'',
    sum:r=>parseFloat(r.horas_de_mas)||0},
];
// Campos disponibles para el informe de Conducción — Viajes. "Km recorridos" es el
// dato "parcial" de cada viaje; su Σ suma es el "total" de kilómetros del periodo (y del filtro elegido).
const CAMPOS_INFORME_VIAJES=[
  {id:'fecha',        label:'Fecha',            grupo:'Viaje', get:r=>r.fecha?fmt(pd(r.fecha)):''},
  {id:'matricula',    label:'Vehículo (matrícula)', grupo:'Viaje', get:r=>r.matricula||''},
  {id:'obra',         label:'Obra',             grupo:'Viaje', get:r=>(r.vehiculos&&r.vehiculos.numero_obra)||''},
  {id:'guardadoPor',  label:'Guardado por',     grupo:'Viaje', get:r=>r.creado_por||''},
  {id:'kmInicial',    label:'Km inicial',       grupo:'Kilómetros', get:r=>r.km_inicial??''},
  {id:'kmFinal',      label:'Km final',         grupo:'Kilómetros', get:r=>r.km_final??''},
  {id:'kmRecorridos', label:'Km recorridos (parcial)', grupo:'Kilómetros', get:r=>r.km_recorridos??'', sumable:true},
];
// Campos disponibles para el informe de Conducción — Repostajes.
const CAMPOS_INFORME_REPOSTAJES=[
  {id:'fecha',          label:'Fecha',              grupo:'Repostaje', get:r=>r.fecha?fmt(pd(r.fecha)):''},
  {id:'matricula',      label:'Vehículo (matrícula)', grupo:'Repostaje', get:r=>r.matricula||''},
  {id:'obra',           label:'Obra',               grupo:'Repostaje', get:r=>(r.vehiculos&&r.vehiculos.numero_obra)||''},
  {id:'guardadoPor',    label:'Guardado por',       grupo:'Repostaje', get:r=>r.creado_por||''},
  {id:'estacion',       label:'Estación',           grupo:'Repostaje', get:r=>(r.estaciones_servicio&&r.estaciones_servicio.nombre)||r.estacion_servicio||''},
  {id:'tipoCombustible',label:'Combustible',        grupo:'Repostaje', get:r=>FUEL_LABELS[r.tipo_combustible]||''},
  {id:'km',             label:'Km de repostaje (cuentakilómetros)', grupo:'Kilómetros', get:r=>r.km??''},
  {id:'litros',         label:'Litros',             grupo:'Importe', get:r=>r.litros??'', sumable:true},
  {id:'precioLitro',    label:'Precio/L (€)',       grupo:'Importe', get:r=>r.precio_litro??''},
  {id:'importe',        label:'Importe (€)',        grupo:'Importe', get:r=>r.importe??'', sumable:true},
];
// Catálogo de campos activo según el tipo de informe elegido.
function camposInformeCatalogo() {
  if(S.informesTipo==='fichajes')   return CAMPOS_INFORME_FICHAJES;
  if(S.informesTipo==='viajes')     return CAMPOS_INFORME_VIAJES;
  if(S.informesTipo==='repostajes') return CAMPOS_INFORME_REPOSTAJES;
  return CAMPOS_INFORME;
}
function esInformeConduccion() { return S.informesTipo==='viajes'||S.informesTipo==='repostajes'; }
function cambiarTipoInforme() {
  S.informesTipo=document.getElementById('informeTipo').value;
  S.informesRaw=[]; S.informesTodo=[]; S.informesBuscado=false; S.informesPeriodo=null;
  document.getElementById('informesNote').textContent='';
  ocultarVistaPreviaInforme();
  renderCamposInforme();
  iniciarFiltrosInforme();
}

// ── Filtros de Informes ───────────────────────────────
// Registros: Conductor, Guardado por (usuario) e Irradiador — se aplican sobre lo descargado (igual que en el Historial).
// Fichajes:  Usuario — lo aplica el servidor (un administrador puede elegir cualquiera; los demás solo ven los suyos).
// Los totales Σ, la vista previa y las exportaciones (CSV/PDF) usan siempre solo lo filtrado.
const nombreCompletoDe = (u) => [u.nombre,u.apellido1,u.apellido2].filter(Boolean).join(' ');
function valoresFiltrosInforme() {
  const v=id=>{ const e=document.getElementById(id); return e?e.value:''; };
  return { conductor:v('iConductor'), usuario:v('iUsuario'), irradiador:v('iIrradiador'), usuarioFich:v('iUsuarioFich'),
           vehiculo:v('iVehiculo'), usuarioCond:v('iUsuarioCond') };
}
function textoSeleccionado(id) {
  const e=document.getElementById(id);
  return (e&&e.value&&e.selectedOptions[0])?e.selectedOptions[0].textContent:'';
}
function descripcionFiltrosInforme() {
  const partes=[];
  if(S.informesTipo==='fichajes'){
    const u=textoSeleccionado('iUsuarioFich'); if(u) partes.push('Usuario: '+u.split(' — ')[0]);
  } else if(esInformeConduccion()){
    const v=textoSeleccionado('iVehiculo'), u=textoSeleccionado('iUsuarioCond');
    if(v) partes.push('Vehículo: '+v); if(u) partes.push('Guardado por: '+u.split(' — ')[0]);
  } else {
    const c=textoSeleccionado('iConductor'), u=textoSeleccionado('iUsuario'), i=textoSeleccionado('iIrradiador');
    if(c) partes.push('Conductor: '+c); if(u) partes.push('Guardado por: '+u.split(' — ')[0]); if(i) partes.push('Irradiador: '+i);
  }
  return partes.join(' · ');
}
// Rellena los desplegables con el catálogo (usuarios, irradiadores) más lo que aparezca en los datos descargados.
function poblarFiltrosInforme(items) {
  items=items||[];
  const es=(a,b)=>a[1].localeCompare(b[1],'es');
  const set=(id,pares,todos)=>{
    const el=document.getElementById(id); if(!el) return;
    const actual=el.value;
    el.innerHTML=`<option value="">${esc(todos)}</option>`+pares.map(([v,t])=>`<option value="${esc(v)}">${esc(t)}</option>`).join('');
    if(pares.some(([v])=>v===actual)) el.value=actual;
  };
  const usuarios=LS.driverCache();
  if(S.informesTipo==='fichajes'){
    if(!S.isAdmin){
      // Un usuario normal solo puede ver sus propios fichajes.
      const el=document.getElementById('iUsuarioFich');
      if(el){ el.innerHTML=`<option value="${esc(S.user||'')}">${esc(S.user||'')}</option>`; el.value=S.user||''; el.disabled=true; }
    } else {
      const m=new Map(usuarios.map(u=>{ const n=nombreCompletoDe(u); return [u.nick, n&&n!==u.nick?`${u.nick} — ${n}`:u.nick]; }));
      items.forEach(f=>{ if(f.usuario_nick&&!m.has(f.usuario_nick)) m.set(f.usuario_nick,f.usuario_nick); });
      const el=document.getElementById('iUsuarioFich'); if(el) el.disabled=false;
      set('iUsuarioFich',[...m.entries()].sort(es),'Todos los usuarios');
    }
    return;
  }
  const cond=new Map(usuarios.map(u=>[u.nick,nombreCompletoDe(u)||u.nick]));
  items.forEach(r=>{ if(r.conductor_nick&&!cond.has(r.conductor_nick)) cond.set(r.conductor_nick,r.conductor_nombre||r.conductor_nick); });
  const guard=new Map(usuarios.map(u=>[u.nick, (nombreCompletoDe(u)&&nombreCompletoDe(u)!==u.nick)?`${u.nick} — ${nombreCompletoDe(u)}`:u.nick]));
  items.forEach(r=>{ if(r.creado_por&&!guard.has(r.creado_por)) guard.set(r.creado_por,r.creado_por); });
  if(esInformeConduccion()){
    // Clave = matrícula (es única y ya viene normalizada en mayúsculas): así el filtro también
    // encuentra vehículos que ya no están activos, siempre que aparezcan en los datos del periodo.
    const veh=new Map();
    LS.vehiculoCache().forEach(v=>veh.set(v.matricula, v.matricula+(v.numero_obra?' · Obra '+v.numero_obra:'')));
    items.forEach(r=>{
      if(!r.matricula||veh.has(r.matricula)) return;
      const obra=r.vehiculos&&r.vehiculos.numero_obra;
      veh.set(r.matricula, r.matricula+(obra?' · Obra '+obra:''));
    });
    const guardCond=new Map(usuarios.map(u=>[u.nick, (nombreCompletoDe(u)&&nombreCompletoDe(u)!==u.nick)?`${u.nick} — ${nombreCompletoDe(u)}`:u.nick]));
    items.forEach(r=>{ if(r.creado_por&&!guardCond.has(r.creado_por)) guardCond.set(r.creado_por,r.creado_por); });
    set('iVehiculo',[...veh.entries()].sort(es),'Todos los vehículos');
    set('iUsuarioCond',[...guardCond.entries()].sort(es),'Todos');
    return;
  }
  const irr=new Set(LS.irradiadorCache().map(nombreCompletoDe).filter(Boolean));
  items.forEach(r=>{ const n=r.irradiador_nombre||r.irradiador; if(n) irr.add(n); });
  set('iConductor',[...cond.entries()].sort(es),'Todos');
  set('iUsuario',[...guard.entries()].sort(es),'Todos');
  set('iIrradiador',[...irr].sort((a,b)=>a.localeCompare(b,'es')).map(n=>[n,n]),'Todos');
}
function mostrarFiltrosSegunTipo() {
  const fich=S.informesTipo==='fichajes', cond=esInformeConduccion();
  const grupoVisible={iFiltrosRegistros:!fich&&!cond, iFiltrosFichajes:fich, iFiltrosConduccion:cond};
  Object.entries(grupoVisible).forEach(([id,visible])=>{ const el=document.getElementById(id); if(el) el.style.display=visible?'flex':'none'; });
  const hint=document.getElementById('informeFiltrosHint');
  if(hint) hint.textContent = fich
    ? (S.isAdmin?'Elige un usuario para ver solo sus fichajes; si lo dejas en «Todos los usuarios» el total suma a todos.':'Aquí solo aparecen tus propios fichajes.')
    : cond
      ? 'Elige un vehículo o un usuario para ver solo lo suyo; los totales Σ (kilómetros, litros, importe) se calculan solo con lo filtrado.'
      : 'Elige un conductor, un usuario o un irradiador para ver solo sus registros; los totales Σ se calculan solo con lo filtrado.';
}
function iniciarFiltrosInforme() {
  ['iConductor','iUsuario','iIrradiador','iUsuarioFich','iVehiculo','iUsuarioCond'].forEach(id=>{ const e=document.getElementById(id); if(e) e.value=''; });
  mostrarFiltrosSegunTipo();
  poblarFiltrosInforme([]);
  // Catálogos actualizados (si hay conexión) para que aparezcan también usuarios/irradiadores/vehículos nuevos
  refreshDrivers().then(()=>poblarFiltrosInforme(S.informesTodo));
  if(S.informesTipo==='registros') refreshIrradiadores().then(()=>poblarFiltrosInforme(S.informesTodo));
  if(esInformeConduccion()) refreshVehiculos().then(()=>poblarFiltrosInforme(S.informesTodo));
}
function filtrarRegistrosInforme(items) {
  const f=valoresFiltrosInforme();
  const igual=(a,b)=>String(a||'').toLowerCase()===String(b||'').toLowerCase();
  let regs=items||[];
  if(f.conductor)  regs=regs.filter(r=>igual(r.conductor_nick,f.conductor));
  if(f.usuario)    regs=regs.filter(r=>igual(r.creado_por,f.usuario));
  if(f.irradiador) regs=regs.filter(r=>(r.irradiador_nombre||r.irradiador)===f.irradiador);
  return regs;
}
function filtrarConduccionInforme(items) {
  const f=valoresFiltrosInforme();
  const igual=(a,b)=>String(a||'').toLowerCase()===String(b||'').toLowerCase();
  let regs=items||[];
  if(f.vehiculo)    regs=regs.filter(r=>igual(r.matricula,f.vehiculo));
  if(f.usuarioCond) regs=regs.filter(r=>igual(r.creado_por,f.usuarioCond));
  return regs;
}
function filtrarSegunTipoInforme(items) {
  if(S.informesTipo==='fichajes') return items;               // el filtro de usuario ya lo aplica el servidor
  if(esInformeConduccion()) return filtrarConduccionInforme(items);
  return filtrarRegistrosInforme(items);
}
function actualizarResultadoInforme() {
  const note=document.getElementById('informesNote');
  const n=S.informesRaw.length, f=descripcionFiltrosInforme();
  note.textContent=`${n} registro(s) encontrado(s)`+(f?` — ${f}`:'')+(S.informesTruncado?' — hay más de 10 000 en este periodo: acota las fechas para incluirlos todos':'');
  if(n) renderVistaPreviaInforme(); else ocultarVistaPreviaInforme();
}
function aplicarFiltrosInforme() {
  if(!S.informesBuscado) return;                       // se aplicará al pulsar Buscar
  if(S.informesTipo==='fichajes') { buscarInformes(); return; }   // el filtro de usuario lo aplica el servidor
  S.informesRaw=filtrarSegunTipoInforme(S.informesTodo);
  actualizarResultadoInforme();
}
function limpiarFiltrosInforme() {
  ['iConductor','iUsuario','iIrradiador','iVehiculo','iUsuarioCond'].forEach(id=>{ const e=document.getElementById(id); if(e) e.value=''; });
  const u=document.getElementById('iUsuarioFich'); if(u&&!u.disabled) u.value='';
  aplicarFiltrosInforme();
}
// Nombre del archivo exportado: incluye el filtro elegido (p. ej. informe_fichajes_ana_20260920.pdf)
function nombreArchivoInforme(ext) {
  const f=valoresFiltrosInforme();
  const tipoArchivo=S.informesTipo==='fichajes'?'fichajes':S.informesTipo==='viajes'?'viajes':S.informesTipo==='repostajes'?'repostajes':'registros';
  const partes=S.informesTipo==='fichajes'?[f.usuarioFich]:esInformeConduccion()?[f.vehiculo,f.usuarioCond]:[f.conductor,f.usuario,f.irradiador];
  const slug=partes.filter(Boolean).map(x=>String(x).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')).filter(Boolean).join('_').slice(0,50);
  return `informe_${tipoArchivo}${slug?'_'+slug:''}_${dateStamp()}.${ext}`;
}
function renderCamposInforme() {
  const box=document.getElementById('camposInformeBox');
  if(!box) return;
  const catalogo=camposInformeCatalogo();
  const grupos=[...new Set(catalogo.map(c=>c.grupo))];
  box.innerHTML=grupos.map(g=>`
    <div style="margin-bottom:10px">
      <div style="font-size:12px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:.03em;margin-bottom:4px">${g}</div>
      ${catalogo.filter(c=>c.grupo===g).map(c=>`
        <div style="display:flex;align-items:center;gap:8px;padding:4px 0">
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;flex:1">
            <input type="checkbox" class="campoInformeChk" value="${c.id}" checked onchange="actualizarResumenCampos()" style="width:auto">
            ${c.label}
          </label>
          ${c.sumable?`<label style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--green-l);font-weight:600;flex-shrink:0" title="Sumar esta columna en la vista previa y en el informe exportado">
            <input type="checkbox" class="campoSumaChk" data-campo="${c.id}" style="width:auto">
            Σ suma
          </label>`:''}
        </div>`).join('')}
    </div>`).join('');
  actualizarResumenCampos();
}
function marcarTodosCampos(marcar) {
  document.querySelectorAll('.campoInformeChk').forEach(chk=>{chk.checked=marcar;});
  actualizarResumenCampos();
}
function camposInformeSeleccionados() {
  const ids=[...document.querySelectorAll('.campoInformeChk:checked')].map(chk=>chk.value);
  return camposInformeCatalogo().filter(c=>ids.includes(c.id));
}
// Campos marcados con "Σ suma" que además están incluidos en el informe
// (si se desmarca un campo, su suma deja de tenerse en cuenta aunque el
// interruptor Σ siga marcado).
function camposASumar() {
  const marcados=[...document.querySelectorAll('.campoSumaChk:checked')].map(chk=>chk.dataset.campo);
  const incluidos=camposInformeSeleccionados().map(c=>c.id);
  return marcados.filter(id=>incluidos.includes(id));
}
// Los campos con formato:'hm' son duraciones (horas decimales internamente) y se muestran SIEMPRE como
// h:mm — en las filas y también en el total: 0.5 -> "0:30", 7.75 -> "7:45", -0.62 -> "-0:37".
function formatearSuma(campo, valor) { return campo.formato==='hm' ? formatHorasHM(valor) : valor.toFixed(2); }
function sumarCampo(campo, regs) {
  return regs.reduce((acc,r)=>{
    const bruto=campo.sum?campo.sum(r):campo.get(r);
    const v=parseFloat(bruto);
    return acc+(isNaN(v)?0:v);
  },0);
}
// ── Selector de campos: ventana emergente para no saturar la pantalla ──
function abrirSelectorCampos() {
  document.getElementById('camposOv').classList.add('on');
}
function cerrarSelectorCampos() {
  document.getElementById('camposOv').classList.remove('on');
  actualizarResumenCampos();
  if((S.informesRaw||[]).length) renderVistaPreviaInforme();
}
function actualizarResumenCampos() {
  const el=document.getElementById('camposResumen');
  if(!el) return;
  const total=camposInformeCatalogo().length;
  const marcados=camposInformeSeleccionados().length;
  el.textContent=`(${marcados} de ${total})`;
}
// ── Vista previa: se ve antes de poder exportar o imprimir ──
const VISTA_PREVIA_LIMITE=50;
function renderVistaPreviaInforme() {
  const wrap=document.getElementById('vistaPreviaWrap');
  const exportWrap=document.getElementById('informesExportWrap');
  const tabla=document.getElementById('vistaPreviaTabla');
  const nota=document.getElementById('vistaPreviaNota');
  const regs=S.informesRaw||[];
  if(!regs.length){ ocultarVistaPreviaInforme(); return; }
  const campos=camposInformeSeleccionados();
  wrap.style.display='';
  if(!campos.length){
    tabla.innerHTML='';
    nota.textContent='Selecciona al menos un campo para ver la vista previa.';
    if(exportWrap) exportWrap.style.display='none';
    return;
  }
  const filas=regs.slice(0,VISTA_PREVIA_LIMITE);
  const sumIds=camposASumar();
  let tfoot='';
  if(sumIds.length){
    // El total SIEMPRE suma todos los registros encontrados, no solo los
    // que se ven en la vista previa (que puede estar recortada).
    const celdas=campos.map((c,i)=>{
      const suma=sumIds.includes(c.id);
      if(i===0) return `<td style="font-weight:700">${suma?`Total: ${formatearSuma(c,sumarCampo(c,regs))}`:'Total'}</td>`;
      return suma?`<td class="tdSuma">${formatearSuma(c,sumarCampo(c,regs))}</td>`:'<td></td>';
    });
    tfoot=`<tfoot><tr>${celdas.join('')}</tr></tfoot>`;
  }
  tabla.innerHTML=`<thead><tr>${campos.map(c=>`<th>${c.label}</th>`).join('')}</tr></thead>`+
    `<tbody>${filas.map(r=>`<tr>${campos.map(c=>`<td>${esc(c.get(r))}</td>`).join('')}</tr>`).join('')}</tbody>`+tfoot;
  const notaRecorte = regs.length>VISTA_PREVIA_LIMITE
    ? `Mostrando los primeros ${VISTA_PREVIA_LIMITE} de ${regs.length} registros (el informe exportado incluye todos).`
    : `${regs.length} registro(s)`;
  nota.textContent = sumIds.length && regs.length>VISTA_PREVIA_LIMITE
    ? `${notaRecorte} El total suma TODOS los registros encontrados, no solo los mostrados.`
    : notaRecorte;
  if(exportWrap) exportWrap.style.display='flex';
}
function ocultarVistaPreviaInforme() {
  const wrap=document.getElementById('vistaPreviaWrap');
  const exportWrap=document.getElementById('informesExportWrap');
  if(wrap) wrap.style.display='none';
  if(exportWrap) exportWrap.style.display='none';
}
async function buscarInformes() {
  const desde=document.getElementById('iDesde').value;
  const hasta=document.getElementById('iHasta').value;
  const note=document.getElementById('informesNote');
  S.informesRaw=[];
  note.textContent='Buscando…';
  ocultarVistaPreviaInforme();
  if(!LS.token()){
    note.textContent='Inicia sesión con conexión a internet para generar informes.';
    return;
  }
  try{
    let items;
    if(S.informesTipo==='fichajes'){
      const usuarioNick=valoresFiltrosInforme().usuarioFich||undefined;
      const data=await apiPost('/fichajes',{action:'listar',token:LS.token(),payload:{desde,hasta,usuarioNick}});
      items=data.fichajes||[]; S.informesTruncado=!!data.truncado;
    }else if(S.informesTipo==='viajes'){
      const data=await apiPost('/conduccion',{action:'listarViajes',token:LS.token(),payload:{desde,hasta,completo:true}});
      items=data.viajes||[]; S.informesTruncado=!!data.truncado;
    }else if(S.informesTipo==='repostajes'){
      const data=await apiPost('/conduccion',{action:'listarRepostajes',token:LS.token(),payload:{desde,hasta,completo:true}});
      items=data.repostajes||[]; S.informesTruncado=!!data.truncado;
    }else{
      const data=await apiPost('/registros',{action:'listar',token:LS.token(),payload:{desde,hasta}});
      items=data.registros||[]; S.informesTruncado=!!data.truncado;
    }
    setCloudState('ok');
    S.informesTodo=items; S.informesBuscado=true; S.informesPeriodo={desde,hasta};
    poblarFiltrosInforme(items);
    S.informesRaw=filtrarSegunTipoInforme(items);
    actualizarResultadoInforme();
  }catch(e){
    setCloudState(e.isNetwork?'off':'err');
    note.textContent='No se ha podido consultar (sin conexión o error del servidor).';
  }
}
// Fila de totales compartida por CSV y PDF: "Total" en la primera columna,
// la suma bajo cada columna marcada con "Σ suma", vacío en el resto.
function filaTotalesInforme(campos, regs, sumIds) {
  return campos.map((c,i)=>{
    const suma=sumIds.includes(c.id);
    if(i===0) return suma?`Total: ${formatearSuma(c,sumarCampo(c,regs))}`:'Total';
    return suma?formatearSuma(c,sumarCampo(c,regs)):'';
  });
}
async function exportInformeCSV() {
  const regs=S.informesRaw||[];
  if(!regs.length){toast('Busca primero un periodo con registros');return;}
  const campos=camposInformeSeleccionados();
  if(!campos.length){toast('Selecciona al menos un campo para el informe');return;}
  const header=campos.map(c=>c.label);
  const rows=regs.map(r=>campos.map(c=>c.get(r)));
  const sumIds=camposASumar();
  if(sumIds.length) rows.push(filaTotalesInforme(campos,regs,sumIds));
  const content=[header,...rows].map(csvFila).join('\r\n');
  const filename=nombreArchivoInforme('csv');
  const result=await dlFile(filename,content,'text/csv;charset=utf-8;');
  if(result===null) return;
  showSaveDlg(filename,'csv',new Blob(['\uFEFF'+content]).size,'informes',result);
}
async function exportInformePDF() {
  const regs=S.informesRaw||[];
  if(!regs.length){toast('Busca primero un periodo con registros');return;}
  const campos=camposInformeSeleccionados();
  if(!campos.length){toast('Selecciona al menos un campo para el informe');return;}
  if(!window.jspdf){ try{ await cargarLib('pdf'); }catch{ toast('⚠ No se pudo cargar la librería de PDF (revisa tu conexión a internet)'); return; } }
  const header=campos.map(c=>c.label);
  const rows=regs.map(r=>campos.map(c=>c.get(r)));
  const sumIds=camposASumar();
  const foot=sumIds.length?[filaTotalesInforme(campos,regs,sumIds)]:null;
  const sumIdxs=campos.map((c,i)=>sumIds.includes(c.id)?i:-1).filter(i=>i>=0);
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({orientation:'landscape',unit:'pt',compress:true});
  const logo=await cargarLogoInforme('img/mosquito_logo_team.png');
  const TITULOS_INFORME={fichajes:'Informe de fichajes', viajes:'Informe de viajes', repostajes:'Informe de repostajes', registros:'Informe'};
  const titulo=`Values Irradiation WEB-210 — ${TITULOS_INFORME[S.informesTipo]||TITULOS_INFORME.registros}`;
  const per=S.informesPeriodo;
  const periodo=(per&&(per.desde||per.hasta))?`Periodo: ${per.desde?fmt(pd(per.desde)):'…'} – ${per.hasta?fmt(pd(per.hasta)):'…'}`:'';
  const detalle=[periodo,descripcionFiltrosInforme()].filter(Boolean).join('   ·   ');
  const {tablaY}=dibujarCabeceraPDF(doc, logo, titulo, detalle);
  doc.autoTable({
    head:[header], body:rows, foot, startY:tablaY,
    styles:{fontSize:7,cellPadding:3}, headStyles:{fillColor:[76,110,245]},
    footStyles:{fontStyle:'bold'},
    didParseCell:(data)=>{
      if(data.section==='foot' && sumIdxs.includes(data.column.index)){
        data.cell.styles.fillColor=[209,250,219];
        data.cell.styles.textColor=[16,122,64];
      }
    },
  });
  const blob=doc.output('blob');
  const filename=nombreArchivoInforme('pdf');
  const result=await dlBlob(filename,blob);
  if(result===null) return;
  showSaveDlg(filename,'pdf',blob.size,'informes',result);
}

// ── TODAY ─────────────────────────────────────────────
function calcToday() {
  const v=parseFloat(document.getElementById('tdose').value);
  if(isNaN(v)||v<=0){toast('Introduce una dosis válida');return;}
  const today=new Date(); const t=tExp(v,today);
  document.getElementById('tdresT').textContent=t.toFixed(1);
  document.getElementById('tdresD').textContent=`${fmt(today)} · Dosis: ${v} Gy · Tasa: ${rate(today).toFixed(6)} Gy/s`;
  document.getElementById('todayRes').style.display='block';
}

// ── MONTHLY ───────────────────────────────────────────
const MES=['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
function renderMonth() {
  const today=new Date(); const y=today.getFullYear(); const m=today.getMonth();
  document.getElementById('mthTitle').textContent=`${MES[m]} ${y}`;
  const days=new Date(y,m+1,0).getDate(); let html='';
  for(let d=1;d<=days;d++){
    const dt=new Date(y,m,d); const r=rate(dt); const t=(S.dose/r).toFixed(1);
    const hl=dt.toDateString()===today.toDateString();
    html+=`<tr class="${hl?'hl':''}"><td>${fmt(dt)}</td><td>${r.toFixed(4)}</td><td>${t}</td></tr>`;
  }
  document.getElementById('monBody').innerHTML=html;
}

// ── WEEKLY ────────────────────────────────────────────
function renderWeekly() {
  const today=new Date(); const y=today.getFullYear(); const curWk=isoWk(today);
  document.getElementById('wkTitle').textContent=`Tabla anual ${y}`;
  const jan4=new Date(y,0,4); const fm=new Date(jan4);
  fm.setDate(jan4.getDate()-(jan4.getDay()+6)%7); let html='';
  for(let wk=1;wk<=52;wk++){
    const mon=new Date(fm); mon.setDate(fm.getDate()+(wk-1)*7);
    const sun=new Date(mon); sun.setDate(mon.getDate()+6);
    const wed=new Date(mon); wed.setDate(mon.getDate()+2);
    const t=(S.dose/rate(wed)).toFixed(1); const hl=wk===curWk;
    html+=`<tr class="${hl?'hl':''}"><td><b>${wk}</b></td><td style="font-size:11px">${fmt(mon)}–${fmt(sun)}</td><td>${t}</td></tr>`;
  }
  document.getElementById('wkBody').innerHTML=html;
}

// ── MULTIDOSIS ────────────────────────────────────────
function renderMD() {
  const today=new Date(); const r=rate(today);
  document.getElementById('mdCont').innerHTML=S.md.map((dosis,i)=>{
    const act=dosis>0; const tStr=act?(dosis/r).toFixed(1)+' s':'—';
    return `<div class="dc ${act?'on':''}" id="mdc${i}">
      <div class="dch">
        <div class="dnum">${i+1}</div>
        <div class="dtit">Entrada ${i+1}</div>
        <div class="apill">Activa</div>
      </div>
      <div class="dcb">
        <div>
          <div class="srow"><span class="slbl">Dosis</span><span class="sval" id="mdv${i}">${dosis} Gy</span></div>
          <input type="range" min="0" max="150" step="1" value="${dosis}" oninput="upMD(${i},this.value)">
        </div>
        <div class="tres">
          <span class="treslbl">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            Tiempo de irradiación
          </span>
          <span class="tresval" id="mdt${i}">${tStr}</span>
        </div>
      </div>
    </div>`;
  }).join('');
  updMDSummary();
}
function upMD(i,v) {
  S.md[i]=parseInt(v); LS.setMD(S.md);
  const today=new Date(); const r=rate(today); const act=S.md[i]>0;
  document.getElementById('mdv'+i).textContent=S.md[i]+' Gy';
  document.getElementById('mdt'+i).textContent=act?(S.md[i]/r).toFixed(1)+' s':'—';
  document.getElementById('mdc'+i).classList.toggle('on',act);
  updMDSummary();
}
function updMDSummary() {
  const a=S.md.filter(d=>d>0).length; const s=document.getElementById('mdSumm');
  if(a>0){s.style.display='flex';document.getElementById('mdSummTxt').textContent=`${a} entrada${a===1?'':'s'} configurada${a===1?'':'s'}`;}
  else s.style.display='none';
}
function clearMD(){S.md=[0,0,0,0,0,0];LS.setMD(S.md);renderMD();toast('Entradas limpiadas');}

// ── SETTINGS ──────────────────────────────────────────
function renderSettings() {
  applyTheme(LS.themePref());
  document.getElementById('sdose').value=S.dose;
  actualizarEstadoNotifUI();
  document.getElementById('acctNick').textContent=S.user||'—';
  document.getElementById('acctRol').textContent=S.offline?'sesión sin conexión':(S.isAdmin?'Administrador':'Usuario');
  const v=document.getElementById('appVersionNote'); if(v) v.textContent=`Values Irradiation WEB-210 · versión ${APP_VERSION}`;
}
function cerrarGuiaRapida() {
  LS.setHelpSeen();
  const c=document.getElementById('helpCard'); if(c) c.style.display='none';
}
function renderUsersScreen() {
  if(!S.isAdmin){ go('menu'); toast('Solo un administrador puede ver esta pantalla'); return; }
  renderUsrs();
}
function saveDose() {
  const v=parseFloat(document.getElementById('sdose').value);
  if(isNaN(v)||v<=0){toast('Dosis inválida');return;}
  S.dose=v; LS.setD(v);
  document.getElementById('dbdg').textContent=v+' Gy';
  const kd=document.getElementById('kpiDose'); if(kd) kd.innerHTML=v+' <span class="kpi-unit">Gy</span>';
  if(document.getElementById('fchIrr').value) onFecha();
  toast('✓ Dosis actualizada a '+v+' Gy');
}
async function addUsr() {
  const nick=document.getElementById('nusr').value.trim();
  const nombre=document.getElementById('nnombre').value.trim();
  const ap1=document.getElementById('nap1').value.trim();
  const ap2=document.getElementById('nap2').value.trim();
  const pass=document.getElementById('npass').value;
  const role=document.getElementById('nrole').value;
  const horarioEntrada=document.getElementById('nHorarioEntrada').value||'07:00';
  const horarioSalida=document.getElementById('nHorarioSalida').value||'13:57';
  const tipoHorario=document.getElementById('nTipoHorario').value||'fijo';
  if(!nick||!pass){toast('Rellena usuario y contraseña');return;}
  if(pass.length<8){toast('La contraseña debe tener al menos 8 caracteres');return;}
  try{
    await apiPost('/usuarios',{action:'crear',token:LS.token(),payload:{nick,pass,nombre,apellido1:ap1,apellido2:ap2,role,horarioEntrada,horarioSalida,tipoHorario}});
    setCloudState('ok');
    toast(`✓ Usuario "${nick}" creado`);
  }catch(e){
    toast(e.isNetwork?'⚠ Sin conexión: no se ha podido crear el usuario':'⚠ '+e.message);
    return;
  }
  ['nusr','nnombre','nap1','nap2','npass'].forEach(id=>{document.getElementById(id).value='';});
  document.getElementById('nHorarioEntrada').value='07:00';
  document.getElementById('nHorarioSalida').value='13:57';
  document.getElementById('nTipoHorario').value='fijo';
  renderUsrs();
  refreshDrivers().then(()=>populateConductorSelect());
}
let editUserNick = null;
async function renderUsrs() {
  const box=document.getElementById('usrList');
  const note=document.getElementById('usrSyncNote');
  let users=[];
  try{
    const data=await apiPost('/usuarios',{action:'list',token:LS.token()});
    users=(data.usuarios||[]).map(u=>({
      name:u.nick, role:u.role, locked:u.locked,
      nombre:u.nombre||'', apellido1:u.apellido1||'', apellido2:u.apellido2||'',
      codigo:u.codigo||codigoConductor(u.nombre,u.apellido1,u.apellido2),
      horarioEntrada:u.horario_entrada||'07:00', horarioSalida:u.horario_salida||'13:57',
      tipoHorario:u.tipo_horario||'fijo'
    }));
    setCloudState('ok');
    if(note) note.textContent='';
  }catch(e){
    setCloudState(e.isNetwork?'off':'err');
    box.innerHTML='<div class="remp">No se ha podido cargar la lista de usuarios (hace falta conexión con la nube).</div>';
    return;
  }
  box.innerHTML=users.length===0
    ?'<div style="font-size:13px;color:var(--txt3)">No hay usuarios</div>'
    :users.map(u=>{
      const nickSeguro=escJs(u.name);
      if(editUserNick && u.name.toLowerCase()===editUserNick.toLowerCase()){
        return filaUsrEdicion(u, nickSeguro);
      }
      const esAdmin=u.name.toLowerCase()==='admin';
      const puedeBorrar=!esAdmin||(S.user||'').toLowerCase()==='admin';
      const nombreCompleto=[u.nombre,u.apellido1,u.apellido2].filter(Boolean).join(' ');
      return `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px solid var(--brd);font-size:13px;flex-wrap:wrap">
        <span style="font-family:var(--fh);font-size:11px;font-weight:700;background:rgba(76,110,245,.18);color:var(--blue-l);padding:2px 6px;border-radius:4px;flex-shrink:0">${esc(u.codigo)}</span>
        <span style="flex:1;font-weight:600">${esc(u.name)}${nombreCompleto?` <span style="color:var(--txt3);font-weight:400">— ${esc(nombreCompleto)}</span>`:''}</span>
        <span style="color:var(--txt3);font-size:11px">⏰ ${esc(u.horarioEntrada||'07:00')}–${esc(u.horarioSalida||'13:57')} · ${u.tipoHorario==='flexible'?'flexible':'fija'}</span>
        <span style="color:var(--txt3)">${esc(u.role)}</span>
        <button class="btn bo bs" style="padding:3px 8px;font-size:11px" onclick="editarUsrInicio('${nickSeguro}')">✏️ Editar</button>
        ${u.locked
          ?`<span style="color:var(--red-l);font-size:11px">Bloqueado</span>
            <button class="btn bo bs" style="padding:3px 8px;font-size:11px" onclick="unlock('${nickSeguro}')">Desbloquear</button>`
          :(puedeBorrar
            ?`<button class="btn br bs" style="padding:3px 8px;font-size:11px" onclick="delUsr('${nickSeguro}')">Eliminar</button>`
            :`<span style="font-size:11px;color:var(--txt3)" title='Solo "Admin" puede eliminarse a sí mismo'>🔒 protegido</span>`)}
      </div>`;
    }).join('');
}
function filaUsrEdicion(u, nickSeguro) {
  const esAdmin=u.name.toLowerCase()==='admin';
  const puedeEditarRol=!esAdmin||(S.user||'').toLowerCase()==='admin';
  return `
  <div style="padding:10px;margin-top:8px;border:1px solid var(--brd3);border-radius:10px;background:rgba(76,110,245,.06);display:flex;flex-direction:column;gap:10px">
    <div style="font-weight:700;font-family:var(--fh)">Editando: ${esc(u.name)}</div>
    <div class="fr2">
      <div class="fl"><label>Nombre</label><input type="text" id="eu_nombre" value="${esc(u.nombre)}"></div>
      <div class="fl"><label>1er apellido</label><input type="text" id="eu_ap1" value="${esc(u.apellido1)}"></div>
    </div>
    <div class="fl"><label>2º apellido</label><input type="text" id="eu_ap2" value="${esc(u.apellido2)}"></div>
    <div class="fl"><label>Rol</label>
      <select id="eu_role" ${puedeEditarRol?'':'disabled'}>
        <option value="user" ${u.role==='user'?'selected':''}>Usuario</option>
        <option value="admin" ${u.role==='admin'?'selected':''}>Admin</option>
      </select></div>
    ${puedeEditarRol?'':'<div class="lft" style="text-align:left">Solo "Admin" puede cambiar su propio rol.</div>'}
    <div class="fr2">
      <div class="fl"><label>Horario entrada</label><input type="time" id="eu_horarioEntrada" value="${esc(u.horarioEntrada||'07:00')}"></div>
      <div class="fl"><label>Horario salida</label><input type="time" id="eu_horarioSalida" value="${esc(u.horarioSalida||'13:57')}"></div>
    </div>
    <div class="fl"><label>Tipo de jornada</label>
      <select id="eu_tipoHorario">
        <option value="fijo" ${u.tipoHorario!=='flexible'?'selected':''}>Fija (cortesía de 15 min en la salida)</option>
        <option value="flexible" ${u.tipoHorario==='flexible'?'selected':''}>Flexible (importan las horas trabajadas)</option>
      </select></div>
    <div class="fl"><label>Nueva contraseña (opcional)</label><input type="password" id="eu_pass" placeholder="Déjalo en blanco para no cambiarla"></div>
    <div style="display:flex;gap:8px">
      <button class="btn bp bs" style="flex:1" onclick="editarUsrGuardar('${nickSeguro}')">Guardar cambios</button>
      <button class="btn bo bs" onclick="editarUsrCancelar()">Cancelar</button>
    </div>
  </div>`;
}
function editarUsrInicio(nick){ editUserNick=nick; renderUsrs(); }
function editarUsrCancelar(){ editUserNick=null; renderUsrs(); }
async function editarUsrGuardar(nick) {
  const nombre=document.getElementById('eu_nombre').value.trim();
  const ap1=document.getElementById('eu_ap1').value.trim();
  const ap2=document.getElementById('eu_ap2').value.trim();
  const roleSel=document.getElementById('eu_role');
  const role=roleSel.disabled?undefined:roleSel.value;
  const nuevaPass=document.getElementById('eu_pass').value;
  const horarioEntrada=document.getElementById('eu_horarioEntrada').value;
  const horarioSalida=document.getElementById('eu_horarioSalida').value;
  const tipoHorario=document.getElementById('eu_tipoHorario').value;
  if(nuevaPass && nuevaPass.length<8){ toast('La contraseña nueva debe tener al menos 8 caracteres'); return; }
  try{
    await apiPost('/usuarios',{action:'editar',token:LS.token(),payload:{nick,nombre,apellido1:ap1,apellido2:ap2,role,nuevaPass:nuevaPass||undefined,horarioEntrada,horarioSalida,tipoHorario}});
    setCloudState('ok');
    toast('✓ Usuario actualizado');
  }catch(e){
    toast(e.isNetwork?'⚠ Sin conexión: no se han podido guardar los cambios':'⚠ '+e.message);
    return;
  }
  editUserNick=null;
  renderUsrs();
  refreshDrivers().then(()=>populateConductorSelect());
}
async function delUsr(nick) {
  if(nick.toLowerCase()==='admin' && (S.user||'').toLowerCase()!=='admin'){
    toast('El usuario "Admin" solo puede eliminarse a sí mismo'); return;
  }
  const ok=await confirmDialog(`¿Eliminar el usuario "${nick}"? No se puede deshacer.`,
    {title:'Eliminar usuario',okText:'Eliminar',okClass:'br'});
  if(!ok) return;
  try{
    await apiPost('/usuarios',{action:'eliminar',token:LS.token(),payload:{nick}});
    setCloudState('ok');
    toast('Usuario eliminado');
  }catch(e){
    toast(e.isNetwork?'⚠ Sin conexión: no se ha podido eliminar':'⚠ '+e.message);
  }
  renderUsrs();
  refreshDrivers().then(()=>populateConductorSelect());
}
async function unlock(nick) {
  try{
    await apiPost('/usuarios',{action:'desbloquear',token:LS.token(),payload:{nick}});
    setCloudState('ok');
    toast('✓ Usuario desbloqueado');
  }catch(e){
    toast(e.isNetwork?'⚠ Sin conexión: no se ha podido desbloquear':'⚠ '+e.message);
  }
  renderUsrs();
}

// ── GESTIÓN DE IRRADIADORES (operadores) ───────────────
let editIrrId=null;
async function renderIrradiadoresScreen() {
  if(!S.isAdmin){ go('menu'); toast('Solo un administrador puede ver esta pantalla'); return; }
  const box=document.getElementById('irrList');
  const note=document.getElementById('irrSyncNote');
  let items=[], enNube=true;
  try{
    const data=await apiPost('/irradiadores',{action:'list',token:LS.token()});
    items=data.irradiadores||[];
    setCloudState('ok');
  }catch(e){
    enNube=false;
    setCloudState(e.isNetwork?'off':'err');
    items=LS.irradiadorCache().map(u=>({...u,activo:true}));
  }
  if(note) note.textContent=enNube?'':'⚠ Mostrando la última lista descargada (sin conexión con la nube).';
  box.innerHTML=items.length===0
    ?'<div style="font-size:13px;color:var(--txt3)">No hay irradiadores dados de alta</div>'
    :items.map(u=>{
      if(editIrrId===u.id) return filaIrrEdicion(u);
      const nombreCompleto=[u.nombre,u.apellido1,u.apellido2].filter(Boolean).join(' ');
      return `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px solid var(--brd);font-size:13px;flex-wrap:wrap">
        <span style="font-family:var(--fmono);font-size:11px;font-weight:700;background:rgba(76,110,245,.18);color:var(--blue-l);padding:2px 6px;border-radius:4px;flex-shrink:0">${esc(u.codigo||'—')}</span>
        <span style="flex:1;font-weight:600">${esc(nombreCompleto)}${u.activo===false?' <span style="color:var(--txt3);font-weight:400">(inactivo)</span>':''}</span>
        <button class="btn bo bs" style="padding:3px 8px;font-size:11px" onclick="editarIrrInicio('${escJs(u.id)}')">✏️ Editar</button>
        <button class="btn br bs" style="padding:3px 8px;font-size:11px" onclick="delIrradiador('${escJs(u.id)}')">Eliminar</button>
      </div>`;
    }).join('');
}
function filaIrrEdicion(u) {
  return `
  <div style="padding:10px;margin-top:8px;border:1px solid var(--brd3);border-radius:10px;background:rgba(76,110,245,.06);display:flex;flex-direction:column;gap:10px">
    <div style="font-weight:700;font-family:var(--fh)">Editando irradiador</div>
    <div class="fr2">
      <div class="fl"><label>Nombre</label><input type="text" id="eu_irr_nombre" value="${esc(u.nombre)}"></div>
      <div class="fl"><label>1er apellido</label><input type="text" id="eu_irr_ap1" value="${esc(u.apellido1)}"></div>
    </div>
    <div class="fl"><label>2º apellido</label><input type="text" id="eu_irr_ap2" value="${esc(u.apellido2)}"></div>
    <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--txt2)">
      <input type="checkbox" id="eu_irr_activo" ${u.activo!==false?'checked':''} style="width:auto">
      Activo (aparece en el desplegable del formulario)
    </label>
    <div style="display:flex;gap:8px">
      <button class="btn bp bs" style="flex:1" onclick="editarIrrGuardar('${escJs(u.id)}')">Guardar cambios</button>
      <button class="btn bo bs" onclick="editarIrrCancelar()">Cancelar</button>
    </div>
  </div>`;
}
function editarIrrInicio(id){ editIrrId=id; renderIrradiadoresScreen(); }
function editarIrrCancelar(){ editIrrId=null; renderIrradiadoresScreen(); }
async function editarIrrGuardar(id) {
  const nombre=document.getElementById('eu_irr_nombre').value.trim();
  const ap1=document.getElementById('eu_irr_ap1').value.trim();
  const ap2=document.getElementById('eu_irr_ap2').value.trim();
  const activo=document.getElementById('eu_irr_activo').checked;
  try{
    await apiPost('/irradiadores',{action:'editar',token:LS.token(),payload:{id,nombre,apellido1:ap1,apellido2:ap2,activo}});
    setCloudState('ok');
    toast('✓ Irradiador actualizado');
  }catch(e){
    toast('⚠ '+e.message);
  }
  editIrrId=null;
  renderIrradiadoresScreen();
  refreshIrradiadores().then(()=>populateIrradiadorSelect());
}
async function addIrradiador() {
  const nombre=document.getElementById('irrNombre').value.trim();
  const ap1=document.getElementById('irrAp1').value.trim();
  const ap2=document.getElementById('irrAp2').value.trim();
  if(!nombre||!ap1){toast('Rellena al menos nombre y primer apellido');return;}
  try{
    await apiPost('/irradiadores',{action:'crear',token:LS.token(),payload:{nombre,apellido1:ap1,apellido2:ap2}});
    setCloudState('ok');
    toast(`✓ Irradiador "${nombre}" creado`);
  }catch(e){
    toast('⚠ '+e.message); return;
  }
  ['irrNombre','irrAp1','irrAp2'].forEach(id=>{document.getElementById(id).value='';});
  renderIrradiadoresScreen();
  refreshIrradiadores().then(()=>populateIrradiadorSelect());
}
async function delIrradiador(id) {
  const ok=await confirmDialog('¿Eliminar este irradiador? No se puede deshacer.',
    {title:'Eliminar irradiador',okText:'Eliminar',okClass:'br'});
  if(!ok) return;
  try{
    await apiPost('/irradiadores',{action:'eliminar',token:LS.token(),payload:{id}});
    setCloudState('ok');
    toast('Irradiador eliminado');
  }catch(e){
    toast('⚠ '+e.message);
  }
  renderIrradiadoresScreen();
  refreshIrradiadores().then(()=>populateIrradiadorSelect());
}

// ── GESTIÓN DE VEHÍCULOS (matrícula + número de obra) ──
let editVehId=null;
async function renderVehiculosScreen() {
  if(!S.isAdmin){ go('menu'); toast('Solo un administrador puede ver esta pantalla'); return; }
  const box=document.getElementById('vehList');
  const note=document.getElementById('vehSyncNote');
  let items=[], enNube=true;
  try{
    const data=await apiPost('/vehiculos',{action:'list',token:LS.token()});
    items=data.vehiculos||[];
    setCloudState('ok');
  }catch(e){
    enNube=false;
    setCloudState(e.isNetwork?'off':'err');
    items=LS.vehiculoCache().map(v=>({...v,activo:true}));
  }
  if(note) note.textContent=enNube?'':'⚠ Mostrando la última lista descargada (sin conexión con la nube).';
  box.innerHTML=items.length===0
    ?'<div style="font-size:13px;color:var(--txt3)">No hay vehículos dados de alta</div>'
    :items.map(v=>{
      if(editVehId===v.id) return filaVehEdicion(v);
      return `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px solid var(--brd);font-size:13px;flex-wrap:wrap">
        <span style="font-family:var(--fmono);font-size:11px;font-weight:700;background:rgba(76,110,245,.18);color:var(--blue-l);padding:2px 6px;border-radius:4px;flex-shrink:0">${esc(v.matricula)}</span>
        <span style="flex:1;font-weight:600">Obra: ${esc(v.numero_obra||'—')}${v.activo===false?' <span style="color:var(--txt3);font-weight:400">(inactivo)</span>':''}</span>
        <button class="btn bo bs" style="padding:3px 8px;font-size:11px" onclick="editarVehInicio('${escJs(v.id)}')">✏️ Editar</button>
        <button class="btn br bs" style="padding:3px 8px;font-size:11px" onclick="delVehiculo('${escJs(v.id)}')">Eliminar</button>
      </div>`;
    }).join('');
}
function filaVehEdicion(v) {
  return `
  <div style="padding:10px;margin-top:8px;border:1px solid var(--brd3);border-radius:10px;background:rgba(76,110,245,.06);display:flex;flex-direction:column;gap:10px">
    <div style="font-weight:700;font-family:var(--fh)">Editando vehículo</div>
    <div class="fl"><label>Matrícula</label><input type="text" id="eu_veh_matricula" value="${esc(v.matricula)}" style="text-transform:uppercase"></div>
    <div class="fl"><label>Número de obra</label><input type="text" id="eu_veh_obra" value="${esc(v.numero_obra)}"></div>
    <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--txt2)">
      <input type="checkbox" id="eu_veh_activo" ${v.activo!==false?'checked':''} style="width:auto">
      Activo (aparece en el desplegable de Conducción)
    </label>
    <div style="display:flex;gap:8px">
      <button class="btn bp bs" style="flex:1" onclick="editarVehGuardar('${escJs(v.id)}')">Guardar cambios</button>
      <button class="btn bo bs" onclick="editarVehCancelar()">Cancelar</button>
    </div>
  </div>`;
}
function editarVehInicio(id){ editVehId=id; renderVehiculosScreen(); }
function editarVehCancelar(){ editVehId=null; renderVehiculosScreen(); }
async function editarVehGuardar(id) {
  const matricula=document.getElementById('eu_veh_matricula').value.trim();
  const numeroObra=document.getElementById('eu_veh_obra').value.trim();
  const activo=document.getElementById('eu_veh_activo').checked;
  try{
    await apiPost('/vehiculos',{action:'editar',token:LS.token(),payload:{id,matricula,numeroObra,activo}});
    setCloudState('ok');
    toast('✓ Vehículo actualizado');
  }catch(e){
    toast('⚠ '+e.message);
  }
  editVehId=null;
  renderVehiculosScreen();
  refreshVehiculos().then(()=>{populateVehiculoSelect('v');populateVehiculoSelect('r');});
}
async function addVehiculo() {
  const matricula=document.getElementById('vehMatricula').value.trim();
  const numeroObra=document.getElementById('vehObra').value.trim();
  if(!matricula||!numeroObra){toast('Rellena la matrícula y el número de obra');return;}
  try{
    await apiPost('/vehiculos',{action:'crear',token:LS.token(),payload:{matricula,numeroObra}});
    setCloudState('ok');
    toast(`✓ Vehículo "${matricula.toUpperCase()}" creado`);
  }catch(e){
    toast('⚠ '+e.message); return;
  }
  ['vehMatricula','vehObra'].forEach(id=>{document.getElementById(id).value='';});
  renderVehiculosScreen();
  refreshVehiculos().then(()=>{populateVehiculoSelect('v');populateVehiculoSelect('r');});
}
async function delVehiculo(id) {
  const ok=await confirmDialog('¿Eliminar este vehículo? No se puede deshacer.',
    {title:'Eliminar vehículo',okText:'Eliminar',okClass:'br'});
  if(!ok) return;
  try{
    await apiPost('/vehiculos',{action:'eliminar',token:LS.token(),payload:{id}});
    setCloudState('ok');
    toast('Vehículo eliminado');
  }catch(e){
    toast('⚠ '+e.message);
  }
  renderVehiculosScreen();
  refreshVehiculos().then(()=>{populateVehiculoSelect('v');populateVehiculoSelect('r');});
}

// ── GESTIÓN DE ESTACIONES DE SERVICIO ──────────────────
let editEstId=null;
async function renderEstacionesScreen() {
  if(!S.isAdmin){ go('menu'); toast('Solo un administrador puede ver esta pantalla'); return; }
  const box=document.getElementById('estList');
  const note=document.getElementById('estSyncNote');
  let items=[], enNube=true;
  try{
    const data=await apiPost('/estaciones',{action:'list',token:LS.token()});
    items=data.estaciones||[];
    setCloudState('ok');
  }catch(e){
    enNube=false;
    setCloudState(e.isNetwork?'off':'err');
    items=LS.estacionCache().map(x=>({...x,activo:true}));
  }
  if(note) note.textContent=enNube?'':'⚠ Mostrando la última lista descargada (sin conexión con la nube).';
  box.innerHTML=items.length===0
    ?'<div style="font-size:13px;color:var(--txt3)">No hay estaciones dadas de alta</div>'
    :items.map(x=>{
      if(editEstId===x.id) return filaEstEdicion(x);
      return `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px solid var(--brd);font-size:13px;flex-wrap:wrap">
        <span style="flex:1;font-weight:600">${esc(x.nombre)}${x.activo===false?' <span style="color:var(--txt3);font-weight:400">(inactiva)</span>':''}</span>
        <button class="btn bo bs" style="padding:3px 8px;font-size:11px" onclick="editarEstInicio('${escJs(x.id)}')">✏️ Editar</button>
        <button class="btn br bs" style="padding:3px 8px;font-size:11px" onclick="delEstacion('${escJs(x.id)}')">Eliminar</button>
      </div>`;
    }).join('');
}
function filaEstEdicion(x) {
  return `
  <div style="padding:10px;margin-top:8px;border:1px solid var(--brd3);border-radius:10px;background:rgba(76,110,245,.06);display:flex;flex-direction:column;gap:10px">
    <div style="font-weight:700;font-family:var(--fh)">Editando estación</div>
    <div class="fl"><label>Nombre</label><input type="text" id="eu_est_nombre" value="${esc(x.nombre)}"></div>
    <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--txt2)">
      <input type="checkbox" id="eu_est_activo" ${x.activo!==false?'checked':''} style="width:auto">
      Activa (aparece en el desplegable de Conducción)
    </label>
    <div style="display:flex;gap:8px">
      <button class="btn bp bs" style="flex:1" onclick="editarEstGuardar('${escJs(x.id)}')">Guardar cambios</button>
      <button class="btn bo bs" onclick="editarEstCancelar()">Cancelar</button>
    </div>
  </div>`;
}
function editarEstInicio(id){ editEstId=id; renderEstacionesScreen(); }
function editarEstCancelar(){ editEstId=null; renderEstacionesScreen(); }
async function editarEstGuardar(id) {
  const nombre=document.getElementById('eu_est_nombre').value.trim();
  const activo=document.getElementById('eu_est_activo').checked;
  try{
    await apiPost('/estaciones',{action:'editar',token:LS.token(),payload:{id,nombre,activo}});
    setCloudState('ok');
    toast('✓ Estación actualizada');
  }catch(e){
    toast('⚠ '+e.message);
  }
  editEstId=null;
  renderEstacionesScreen();
  refreshEstaciones().then(()=>populateEstacionSelect('r'));
}
async function addEstacion() {
  const nombre=document.getElementById('estNombre').value.trim();
  if(!nombre){toast('Introduce el nombre de la estación');return;}
  try{
    await apiPost('/estaciones',{action:'crear',token:LS.token(),payload:{nombre}});
    setCloudState('ok');
    toast(`✓ Estación "${nombre}" creada`);
  }catch(e){
    toast('⚠ '+e.message); return;
  }
  document.getElementById('estNombre').value='';
  renderEstacionesScreen();
  refreshEstaciones().then(()=>populateEstacionSelect('r'));
}
async function delEstacion(id) {
  const ok=await confirmDialog('¿Eliminar esta estación? No se puede deshacer.',
    {title:'Eliminar estación',okText:'Eliminar',okClass:'br'});
  if(!ok) return;
  try{
    await apiPost('/estaciones',{action:'eliminar',token:LS.token(),payload:{id}});
    setCloudState('ok');
    toast('Estación eliminada');
  }catch(e){
    toast('⚠ '+e.message);
  }
  renderEstacionesScreen();
  refreshEstaciones().then(()=>populateEstacionSelect('r'));
}

// ── CONDUCCIÓN (viajes del vehículo + repostajes) ──────
const FUEL_LABELS={diesel_xtl:'Diesel (XTL)',diesel:'Diesel',gasolina:'Gasolina',adblue:'AdBlue'};
function cambiarVistaConduccion(vista) {
  document.getElementById('condTabViaje').className='btn bs '+(vista==='viaje'?'bp':'bo');
  document.getElementById('condTabRepostaje').className='btn bs '+(vista==='repostaje'?'bp':'bo');
  document.getElementById('condPanelViaje').style.display=vista==='viaje'?'':'none';
  document.getElementById('condPanelRepostaje').style.display=vista==='repostaje'?'':'none';
  if(vista==='viaje') renderViajesList(); else renderRepostajesList();
}
function calcKmRecorridos() {
  const ini=parseFloat(document.getElementById('vKmIni').value);
  const fin=parseFloat(document.getElementById('vKmFin').value);
  const el=document.getElementById('vKmRec');
  el.value=(!isNaN(ini)&&!isNaN(fin)&&fin>=ini)?(fin-ini).toFixed(1):'';
}
function calcLitros() {
  const importe=parseFloat(document.getElementById('rImporte').value);
  const precio=parseFloat(document.getElementById('rPrecio').value);
  const el=document.getElementById('rLitros');
  el.value=(!isNaN(importe)&&!isNaN(precio)&&precio>0)?(importe/precio).toFixed(2):'';
}
async function guardarViaje() {
  const sel=document.getElementById('vMatricula');
  const vehId=sel.value;
  if(!vehId||vehId==='__new__'){toast('Selecciona un vehículo (o créalo primero)');return;}
  const veh=LS.vehiculoCache().find(v=>v.id===vehId);
  if(!veh){toast('Vehículo no válido, actualiza la lista');refreshVehiculos().then(()=>populateVehiculoSelect('v'));return;}
  const payload={
    matricula: veh.matricula,
    vehiculoId: veh.id,
    fecha: document.getElementById('vFecha').value,
    kmInicial: document.getElementById('vKmIni').value,
    kmFinal: document.getElementById('vKmFin').value,
  };
  const kmI=parseFloat(payload.kmInicial), kmF=parseFloat(payload.kmFinal);
  if(!isNaN(kmI)&&!isNaN(kmF)&&kmF<kmI){ toast('⚠ El km final no puede ser menor que el km inicial'); document.getElementById('vKmFin').focus(); return; }
  setBtnLoading('vGuardarBtn', true, 'Guardando…');
  try{
    await apiPost('/conduccion',{action:'guardarViaje',token:LS.token(),payload});
    setCloudState('ok');
    toast('✓ Viaje guardado');
    document.getElementById('vMatricula').value='';
    document.getElementById('vKmFin').value='';
    aplicarKmIniAuto(null);
    const obraEl=document.getElementById('vObra'); if(obraEl) obraEl.value='';
    document.getElementById('vFecha').value=tod(new Date());
    renderViajesList();
  }catch(e){
    toast(e.isNetwork?'⚠ Sin conexión: no se ha podido guardar el viaje':'⚠ '+e.message);
  }
  setBtnLoading('vGuardarBtn', false);
}
async function renderViajesList() {
  const box=document.getElementById('viajesList');
  if(!LS.token()){ box.innerHTML='<div class="remp">Inicia sesión con conexión para ver los viajes guardados.</div>'; return; }
  box.innerHTML='<div class="remp"><span class="spin"></span>Cargando…</div>';
  try{
    const data=await apiPost('/conduccion',{action:'listarViajes',token:LS.token(),payload:{}});
    const viajes=data.viajes||[];
    if(!viajes.length){ box.innerHTML='<div class="remp">Sin viajes todavía</div>'; return; }
    box.innerHTML=viajes.slice(0,30).map(v=>{
      const puede=S.isAdmin||v.creado_por===S.user;
      return `<div class="ritem">
        <div class="rdate">🚗 ${esc(v.matricula)}${v.vehiculos&&v.vehiculos.numero_obra?' · Obra '+esc(v.vehiculos.numero_obra):''} ${v.fecha?'— '+esc(fmt(pd(v.fecha))):''} <span style="color:var(--txt3);font-weight:400">· ${esc(v.creado_por||'—')}</span></div>
        <div class="rdets">
          <span>Km inicial: <strong>${esc(v.km_inicial??'—')}</strong></span>
          <span>Km final: <strong>${esc(v.km_final??'—')}</strong></span>
          <span>Recorridos: <strong>${esc(v.km_recorridos??'—')} km</strong></span>
        </div>
        ${puede?`<div style="margin-top:8px;text-align:right"><button class="btn br bs" style="padding:3px 10px;font-size:11px" onclick="eliminarViaje('${escJs(v.id)}')">🗑 Eliminar</button></div>`:''}
      </div>`;
    }).join('<div style="height:8px"></div>');
  }catch(e){
    box.innerHTML='<div class="remp">No se ha podido consultar (sin conexión o error del servidor).</div>';
  }
}
async function eliminarViaje(id) {
  const ok=await confirmDialog('¿Eliminar este viaje? No se puede deshacer.',{title:'Eliminar viaje',okText:'Eliminar',okClass:'br'});
  if(!ok) return;
  try{
    await apiPost('/conduccion',{action:'eliminarViaje',token:LS.token(),payload:{id}});
    toast('Viaje eliminado');
  }catch(e){ toast('⚠ '+e.message); }
  renderViajesList();
}

async function guardarRepostaje() {
  const sel=document.getElementById('rMatricula');
  const vehId=sel.value;
  if(!vehId||vehId==='__new__'){toast('Selecciona un vehículo (o créalo primero)');return;}
  const veh=LS.vehiculoCache().find(v=>v.id===vehId);
  if(!veh){toast('Vehículo no válido, actualiza la lista');refreshVehiculos().then(()=>populateVehiculoSelect('r'));return;}
  const estSel=document.getElementById('rEstacion');
  const estId=estSel.value;
  if(estId==='__new__'){toast('Crea la estación nueva o cancélala antes de guardar');return;}
  const est=estId?LS.estacionCache().find(e=>e.id===estId):null;
  const payload={
    matricula: veh.matricula,
    vehiculoId: veh.id,
    fecha: document.getElementById('rFecha').value,
    km: document.getElementById('rKm').value,
    importe: document.getElementById('rImporte').value,
    precioLitro: document.getElementById('rPrecio').value,
    tipoCombustible: document.getElementById('rTipo').value,
    estacionServicio: est?est.nombre:'',
    estacionId: est?est.id:null,
  };
  setBtnLoading('rGuardarBtn', true, 'Guardando…');
  try{
    await apiPost('/conduccion',{action:'guardarRepostaje',token:LS.token(),payload});
    setCloudState('ok');
    toast('✓ Repostaje guardado');
    document.getElementById('rMatricula').value='';
    document.getElementById('rEstacion').value='';
    ['rKm','rImporte','rPrecio','rLitros'].forEach(id=>document.getElementById(id).value='');
    aplicarUltimoKmRepostaje(null);
    const obraEl=document.getElementById('rObra'); if(obraEl) obraEl.value='';
    document.getElementById('rFecha').value=tod(new Date());
    renderRepostajesList();
  }catch(e){
    toast(e.isNetwork?'⚠ Sin conexión: no se ha podido guardar el repostaje':'⚠ '+e.message);
  }
  setBtnLoading('rGuardarBtn', false);
}
async function renderRepostajesList() {
  const box=document.getElementById('repostajesList');
  if(!LS.token()){ box.innerHTML='<div class="remp">Inicia sesión con conexión para ver los repostajes guardados.</div>'; return; }
  box.innerHTML='<div class="remp"><span class="spin"></span>Cargando…</div>';
  try{
    const data=await apiPost('/conduccion',{action:'listarRepostajes',token:LS.token(),payload:{}});
    const rep=data.repostajes||[];
    if(!rep.length){ box.innerHTML='<div class="remp">Sin repostajes todavía</div>'; return; }
    box.innerHTML=rep.slice(0,30).map(r=>{
      const puede=S.isAdmin||r.creado_por===S.user;
      return `<div class="ritem">
        <div class="rdate">⛽ ${esc(r.matricula)}${r.vehiculos&&r.vehiculos.numero_obra?' · Obra '+esc(r.vehiculos.numero_obra):''} ${r.fecha?'— '+esc(fmt(pd(r.fecha))):''} <span style="color:var(--txt3);font-weight:400">· ${esc(FUEL_LABELS[r.tipo_combustible]||'—')}</span></div>
        <div class="rdets">
          <span>Km: <strong>${esc(r.km??'—')}</strong></span>
          <span>Importe: <strong>${esc(r.importe??'—')} €</strong></span>
          <span>€/L: <strong>${esc(r.precio_litro??'—')}</strong></span>
          <span>Litros: <strong>${esc(r.litros??'—')} L</strong></span>
          <span>Estación: <strong>${esc(r.estacion_servicio||'—')}</strong></span>
        </div>
        ${puede?`<div style="margin-top:8px;text-align:right"><button class="btn br bs" style="padding:3px 10px;font-size:11px" onclick="eliminarRepostaje('${escJs(r.id)}')">🗑 Eliminar</button></div>`:''}
      </div>`;
    }).join('<div style="height:8px"></div>');
  }catch(e){
    box.innerHTML='<div class="remp">No se ha podido consultar (sin conexión o error del servidor).</div>';
  }
}
async function eliminarRepostaje(id) {
  const ok=await confirmDialog('¿Eliminar este repostaje? No se puede deshacer.',{title:'Eliminar repostaje',okText:'Eliminar',okClass:'br'});
  if(!ok) return;
  try{
    await apiPost('/conduccion',{action:'eliminarRepostaje',token:LS.token(),payload:{id}});
    toast('Repostaje eliminado');
  }catch(e){ toast('⚠ '+e.message); }
  renderRepostajesList();
}

// ── FICHAJE (control horario: entrada/salida diaria) ────
// Necesita conexión siempre: la hora la pone el servidor (no el
// dispositivo), para que sea fiable — por eso no hay caché offline aquí.
// Formatea horas decimales como "H:MM" (no como número decimal: 0.5 -> "0:30",
// 1.75 -> "1:45"). No se envuelve a las 24h porque esto es un ACUMULADO de
// horas de más, no la hora del reloj — puede llegar a "100:00" o más sin
// problema. Los negativos (el usuario salió antes de su horario) llevan el
// signo delante de todo, ej. "-0:37".
function formatHorasHM(horas) {
  const h=parseFloat(horas)||0;
  const signo=h<0?'-':'';
  const totalMin=Math.round(Math.abs(h)*60);
  const horasEnteras=Math.floor(totalMin/60);
  const minutos=totalMin%60;
  return `${signo}${horasEnteras}:${String(minutos).padStart(2,'0')}`;
}
// Las horas de más pueden ser negativas (el usuario salió antes de su
// horario, y eso resta del acumulado) — se marcan en rojo para que se note
// a simple vista que van en contra, no a favor.
function colorHorasDeMas(horas) {
  const h=parseFloat(horas);
  if(isNaN(h)||h===0) return 'var(--txt3)';
  return h<0 ? 'var(--red-l)' : 'var(--teal-l)';
}
// Texto de referencia del horario/tipo de jornada del usuario, para que se
// vea siempre de dónde salen los cálculos de horas de más.
function notaHorarioTexto(data) {
  if(data.tipoHorario==='flexible'){
    const jornadaMin=minutosEntre(data.horarioEntrada,data.horarioSalida);
    return `Tu jornada: ${formatHorasHM(jornadaMin/60)} h (flexible, de referencia ${data.horarioEntrada} a ${data.horarioSalida} — importan las horas trabajadas, no la hora exacta de entrada/salida)`;
  }
  return `Tu horario: entrada ${data.horarioEntrada} · salida ${data.horarioSalida} (fijo, con 15 min de cortesía en la salida)`;
}
function renderFichajeHoy(data) {
  const cont=document.getElementById('fichajeEstadoContenido');
  const notaHorario=document.getElementById('fichajeHorarioNota');
  if(!cont) return;
  if(notaHorario) notaHorario.textContent=notaHorarioTexto(data);
  const f=data.fichaje;
  if(!f||!f.hora_entrada){
    cont.innerHTML=`
      <div style="text-align:center;padding:6px 0 2px">
        <div style="font-size:14px;color:var(--txt2);margin-bottom:14px">Aún no has fichado hoy</div>
        <button class="btn bp bw" onclick="ficharEntrada()">🟢 Fichar entrada</button>
      </div>`;
  }else if(!f.hora_salida){
    cont.innerHTML=`
      <div style="text-align:center;padding:6px 0 2px">
        <div style="font-size:14px;color:var(--txt2);margin-bottom:4px">Entrada: <strong>${esc(f.hora_entrada)}</strong></div>
        <div style="font-size:12px;color:var(--txt3);margin-bottom:14px">Todavía no has fichado la salida</div>
        <button class="btn bp bw" onclick="ficharSalida()">🔴 Fichar salida</button>
      </div>`;
  }else{
    cont.innerHTML=`
      <div style="text-align:center;padding:6px 0 2px">
        <div style="font-size:14px;color:var(--txt2)">Entrada: <strong>${esc(f.hora_entrada)}</strong> · Salida: <strong>${esc(f.hora_salida)}</strong></div>
        <div style="font-size:13px;color:var(--txt3);margin-top:4px">Horas de más hoy: <strong style="color:${colorHorasDeMas(f.horas_de_mas)}">${formatHorasHM(f.horas_de_mas)}</strong></div>
        <div class="lft" style="margin-top:10px">Ya has fichado hoy. Vuelve mañana.</div>
      </div>`;
  }
}
async function cargarFichajeHoy() {
  const cont=document.getElementById('fichajeEstadoContenido');
  if(!cont) return;
  if(!LS.token()){
    cont.innerHTML='<div class="lft">Necesitas conexión a internet para fichar.</div>';
    return;
  }
  try{
    const data=await apiPost('/fichajes',{action:'hoy',token:LS.token()});
    setCloudState('ok');
    renderFichajeHoy(data);
  }catch(e){
    setCloudState(e.isNetwork?'off':'err');
    cont.innerHTML='<div class="lft">No se ha podido consultar el fichaje de hoy (sin conexión o error del servidor).</div>';
  }
}
// Un doble toque (o un móvil lento) enviaba dos peticiones y la segunda daba un error confuso: ahora se bloquea el botón mientras se ficha.
let _fichando=false;
async function ficharAccion(accion, textoOk) {
  if(_fichando) return;
  if(!LS.token()){ toast('Necesitas conexión a internet para fichar'); return; }
  _fichando=true;
  document.querySelectorAll('#fichajeEstadoContenido button').forEach(b=>{ b.disabled=true; });
  try{
    await apiPost('/fichajes',{action:accion,token:LS.token()});
    setCloudState('ok');
    toast(textoOk);
  }catch(e){
    toast(e.isNetwork?'⚠ Sin conexión: no se ha podido fichar':'⚠ '+e.message);
  }finally{
    _fichando=false;
  }
  await cargarFichajeHoy();
  cargarResumenMesFichaje();
}
function ficharEntrada() { return ficharAccion('ficharEntrada','✓ Entrada fichada'); }
function ficharSalida()  { return ficharAccion('ficharSalida','✓ Salida fichada'); }
function renderFichajeHistorial(fichajes) {
  const box=document.getElementById('fichajeHistorial');
  if(!box) return;
  box.innerHTML=(!fichajes||fichajes.length===0)
    ?'<div style="font-size:13px;color:var(--txt3)">Sin fichajes este mes todavía</div>'
    :fichajes.map(f=>{
      const horas=parseFloat(f.horas_de_mas);
      return `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px solid var(--brd);font-size:13px;flex-wrap:wrap">
        <span style="flex:1;font-weight:600">${f.fecha?fmt(pd(f.fecha)):'—'}</span>
        <span style="color:var(--txt2)">${esc(f.hora_entrada||'—')} → ${esc(f.hora_salida||'—')}</span>
        <span style="font-weight:700;color:${colorHorasDeMas(horas)}">${!isNaN(horas)?formatHorasHM(horas):'—'}</span>
      </div>`;
    }).join('');
}
async function cargarResumenMesFichaje() {
  const totalEl=document.getElementById('fichajeTotalMes');
  if(!LS.token()){ if(totalEl) totalEl.textContent='—'; renderFichajeHistorial([]); return; }
  try{
    const data=await apiPost('/fichajes',{action:'resumenMes',token:LS.token()});
    setCloudState('ok');
    const total=data.totalHorasDeMas||0;
    if(totalEl){
      totalEl.textContent=formatHorasHM(total);
      totalEl.style.color=colorHorasDeMas(total);
    }
    renderFichajeHistorial(data.fichajes||[]);
  }catch(e){
    setCloudState(e.isNetwork?'off':'err');
    if(totalEl) totalEl.textContent='—';
  }
}
// ── Corregir un fichaje por fecha ───────────────────────
// No siempre se puede fichar justo al entrar o salir; esto deja elegir un
// día (de hoy o de cualquier fecha pasada) y corregir entrada y/o salida,
// creando el fichaje de ese día si todavía no existía.
async function cargarFichajeParaCorregir() {
  const fecha=document.getElementById('fichajeCorregirFecha').value;
  const nota=document.getElementById('fichajeCorregirNota');
  const inEntrada=document.getElementById('fichajeCorregirEntrada');
  const inSalida=document.getElementById('fichajeCorregirSalida');
  inEntrada.value=''; inSalida.value='';
  if(!nota) return;
  if(!fecha){ nota.textContent=''; return; }
  if(!LS.token()){ nota.textContent='Necesitas conexión a internet para corregir un fichaje.'; return; }
  nota.textContent='Cargando…';
  try{
    const data=await apiPost('/fichajes',{action:'listar',token:LS.token(),payload:{desde:fecha,hasta:fecha}});
    setCloudState('ok');
    const f=(data.fichajes||[])[0];
    if(f){
      inEntrada.value=f.hora_entrada||'';
      inSalida.value=f.hora_salida||'';
      nota.textContent='Fichaje de ese día cargado. Corrígelo y guarda.';
    }else{
      nota.textContent='Ese día no tiene fichaje todavía — puedes crearlo.';
    }
  }catch(e){
    setCloudState(e.isNetwork?'off':'err');
    nota.textContent='No se ha podido consultar ese día (sin conexión o error del servidor).';
  }
}
async function guardarCorreccionFichaje() {
  const fecha=document.getElementById('fichajeCorregirFecha').value;
  const nota=document.getElementById('fichajeCorregirNota');
  if(!fecha){ toast('Elige primero una fecha'); return; }
  if(!LS.token()){ toast('Necesitas conexión a internet para corregir un fichaje'); return; }
  const horaEntrada=document.getElementById('fichajeCorregirEntrada').value;
  const horaSalida=document.getElementById('fichajeCorregirSalida').value;
  try{
    await apiPost('/fichajes',{action:'corregir',token:LS.token(),payload:{fecha,horaEntrada,horaSalida}});
    setCloudState('ok');
    toast('✓ Fichaje corregido');
    if(nota) nota.textContent='Guardado.';
    // Por si la fecha corregida es hoy o cae en el mes en curso.
    cargarFichajeHoy();
    cargarResumenMesFichaje();
  }catch(e){
    toast(e.isNetwork?'⚠ Sin conexión: no se ha podido guardar la corrección':'⚠ '+e.message);
  }
}

// ── LOGO GALLERY ──────────────────────────────────────
let _logoIdx=0; const _logoCount=4; let _logoTimer=null;
function setLogo(idx) {
  for(let i=0;i<_logoCount;i++){
    const img=document.getElementById('llogo'+i);
    const dot=document.querySelectorAll('.ldot')[i];
    if(img)img.classList.remove('active');
    if(dot)dot.classList.remove('on');
  }
  _logoIdx=idx;
  const imgEl=document.getElementById('llogo'+idx);
  const dotEl=document.querySelectorAll('.ldot')[idx];
  if(imgEl)imgEl.classList.add('active');
  if(dotEl)dotEl.classList.add('on');
}
function startLogoRotation() {
  if(_logoTimer)clearInterval(_logoTimer);
  _logoTimer=setInterval(()=>setLogo((_logoIdx+1)%_logoCount),2800);
}
function stopLogoRotation() {
  if(_logoTimer){clearInterval(_logoTimer);_logoTimer=null;}
}

// ── TOAST ─────────────────────────────────────────────
// ── CONFIRMACIÓN (sustituye a confirm() nativo del navegador) ──
let _confirmResolve=null;
function confirmDialog(message, opts={}) {
  return new Promise(resolve=>{
    _confirmResolve=resolve;
    document.getElementById('confirmMsg').textContent=message;
    document.getElementById('confirmTitle').textContent=opts.title||'Confirmar';
    const okBtn=document.getElementById('confirmOkBtn');
    okBtn.textContent=opts.okText||'Eliminar';
    okBtn.className='btn bw '+(opts.okClass||'br');
    document.getElementById('confirmOv').classList.add('on');
  });
}
function _confirmClose(result) {
  document.getElementById('confirmOv').classList.remove('on');
  if(_confirmResolve){ const r=_confirmResolve; _confirmResolve=null; r(result); }
}
async function confirmLogout() {
  const ok=await confirmDialog('¿Seguro que quieres cerrar sesión?',
    {title:'Cerrar sesión',okText:'Cerrar sesión',okClass:'br'});
  if(ok) logout();
}

document.addEventListener('keydown', e=>{
  if(e.key!=='Escape') return;
  const abierto=id=>{ const el=document.getElementById(id); return !!el && el.classList.contains('on'); };
  if(abierto('confirmOv')) _confirmClose(false);
  else if(abierto('passOv')) cerrarCambioPass();
  else if(abierto('urnaModal')) closeUrna();
  else if(abierto('detOv')) cerrarDetalleRegistro();
  else if(abierto('camposOv')) cerrarSelectorCampos();
  else if(abierto('exov')) closeExDlg();
  else if(abierto('scov')) closeScDlg();
  else if(abierto('rdiag')) closeR();
  else if(abierto('drawer')) closeDrawer();
});

function toast(msg) {
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('on');
  setTimeout(()=>t.classList.remove('on'),2600);
}

// ── BOOT ──────────────────────────────────────────────
boot();


// ── THEME (diurno / nocturno) ────────────────────────
function resolveTheme(pref){
  if(pref==='light'||pref==='dark') return pref;
  // 'system': seguimos la preferencia del sistema operativo
  if(window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
  return 'dark';
}
function applyTheme(pref){
  const resolved=resolveTheme(pref);
  document.body.classList.toggle('theme-light', resolved==='light');
  const bL=document.getElementById('thLight'), bD=document.getElementById('thDark'), bS=document.getElementById('thSystem');
  if(bL) bL.setAttribute('aria-pressed', pref==='light'?'true':'false');
  if(bD) bD.setAttribute('aria-pressed', pref==='dark'?'true':'false');
  if(bS) bS.setAttribute('aria-pressed', pref==='system'?'true':'false');
  if(S.histVista==='graf' && document.getElementById('shist')?.classList.contains('on')){
    setTimeout(()=>dibujarGraficaHistorial(), 50);
  }

  // Si el modo es "Sistema", escuchamos cambios en vivo (p.ej. el móvil pasa
  // a modo oscuro por la noche) y actualizamos la app sin recargar.
  if(_systemThemeMQ){ _systemThemeMQ.onchange=null; _systemThemeMQ=null; }
  if(pref==='system' && window.matchMedia){
    _systemThemeMQ=window.matchMedia('(prefers-color-scheme: light)');
    _systemThemeMQ.onchange=()=>applyTheme('system');
  }
}
function setTheme(pref){
  const v=(pref==='light'||pref==='dark')?pref:'system';
  LS.setThemePref(v);
  applyTheme(v);
  if(typeof toast==='function'){
    const MAP={light:'☀ Tema claro activado',dark:'🌙 Tema oscuro activado',system:'⚙ Siguiendo el tema del sistema'};
    toast(MAP[v]);
  }
}
