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

// ── STATE ─────────────────────────────────────────────
const S = {
  user:null, isAdmin:false, dose:70, staged:[],
  urna1:{n:'',date:'',lote:''},
  urna2:{n:'',date:'',lote:''},
  urna3:{n:'',date:'',lote:''},
  md:[0,0,0,0,0,0],
  exCtx:'form',
  histVista:'lista', histRaw:[], histFiltered:[],
  lastCheck:null
};
let _systemThemeMQ=null;

const LS = {
  users()  { try{return JSON.parse(localStorage.getItem('vi_u')||'[]')}catch{return []} },
  setU(u)  { localStorage.setItem('vi_u',JSON.stringify(u)) },
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
  pending()   { try{return JSON.parse(localStorage.getItem('vi_pend')||'[]')}catch{return []} },
  setPending(p){ localStorage.setItem('vi_pend',JSON.stringify(p||[])) },
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
    throw err;
  }
  return data || {};
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
    setCloudState(e.isNetwork ? 'off' : 'err');
    if (e.isNetwork) {
      // Sin conexión: construimos la lista de conductores con los usuarios
      // que haya en este dispositivo, para que el desplegable siga
      // funcionando (aunque no incluya usuarios dados de alta en otros
      // dispositivos hasta que vuelva la conexión).
      const local = LS.users().map(u => ({
        nick: u.name, nombre: u.nombre||'', apellido1: u.apellido1||'', apellido2: u.apellido2||'',
        codigo: codigoConductor(u.nombre||u.name, u.apellido1||'', u.apellido2||'')
      }));
      LS.setDriverCache(local);
    }
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
      return `<option value="${u.nick}">${nombreCompleto}</option>`;
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
}

// ── Cola de registros pendientes de sincronizar ──────
async function syncRecordToCloud(rec) {
  if (!LS.token()) return; // sesión solo local (login sin conexión): no intentamos la nube
  try {
    await apiPost('/registros', { action:'guardar', token: LS.token(), payload: rec });
    setCloudState('ok');
  } catch (e) {
    setCloudState(e.isNetwork ? 'off' : 'err');
    const pend = LS.pending(); pend.push(rec); LS.setPending(pend);
  }
}
async function flushPending() {
  if (!LS.token()) return;
  const pend = LS.pending();
  if (!pend.length) return;
  const kept = []; let synced = 0; let networkDown = false;
  for (const rec of pend) {
    if (networkDown) { kept.push(rec); continue; }
    try {
      await apiPost('/registros', { action:'guardar', token: LS.token(), payload: rec });
      synced++;
    } catch (e) {
      if (e.isNetwork) { networkDown = true; kept.push(rec); }
      // si el error es del propio registro (no de red), se descarta y no se reintenta
    }
  }
  LS.setPending(kept);
  if (synced > 0) {
    setCloudState('ok');
    toast(`☁ ${synced} registro${synced===1?'':'s'} sincronizado${synced===1?'':'s'} con la nube`);
  }
}

// ── NOTIFICACIONES — "alguien ha guardado un registro" ──
// Sondeo periódico (no websocket): cada poco tiempo se pregunta al backend
// (con el mismo token de sesión, sin exponer Supabase al navegador) si hay
// registros nuevos desde la última comprobación. Es casi al instante para
// el uso normal de esta app y no cambia el modelo de seguridad ya montado.
let notifTimer=null;
const NOTIF_INTERVALO_MS=25000;
function startNotifPolling() {
  if(notifTimer) return;
  notifTimer=setInterval(checkNuevosRegistros, NOTIF_INTERVALO_MS);
}
function stopNotifPolling() {
  if(notifTimer){ clearInterval(notifTimer); notifTimer=null; }
}
async function checkNuevosRegistros() {
  if(!LS.token()||!S.lastCheck) return;
  try{
    const data=await apiPost('/registros',{action:'nuevos',token:LS.token(),payload:{desde:S.lastCheck}});
    const regs=data.registros||[];
    if(!regs.length) return;
    S.lastCheck=regs[regs.length-1].created_at;
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

function boot() {
  if(LS.users().length===0)
    LS.setU([{name:'Admin',pass:'Aedes',role:'admin',att:0,locked:false,nombre:'Admin',apellido1:'Admin',apellido2:''}]);
  S.dose=LS.dose(); S.staged=LS.staged(); S.md=LS.md();
  applyTheme(LS.themePref());
  updStagedUI();
  setCloudState(null);
  window.addEventListener('online', flushPending);
  setInterval(flushPending, 60000);
  if('serviceWorker' in navigator){
    window.addEventListener('load', ()=>{
      navigator.serviceWorker.register('sw.js').catch(()=>{});
    });
  }
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
  if(id==='records')    renderRecs();
  if(id==='hist')       { cambiarVistaHistorial('lista'); filtroHistorialRapido(); }
  if(id==='form')       { populateConductorSelect(); refreshDrivers().then(populateConductorSelect); }
  if(id==='sl')         { setLogo(0); startLogoRotation(); }
  else                  { stopLogoRotation(); }
}
function logout() {
  LS.setToken(''); LS.setSession(null);
  S.user=null; S.isAdmin=false;
  stopNotifPolling();
  go('sl');
}

// ── LOGIN ─────────────────────────────────────────────
// Paso 1: se comprueba en Supabase si el "nick" ya existe.
//   - Si existe          -> se pide la contraseña (lSubmit)
//   - Si no existe        -> se muestra un mini-formulario de alta con
//                            nombre y apellidos (lRegister), necesarios
//                            para poder calcular el código de conductor.
//   - Si no hay conexión  -> se usa el almacén local (igual que antes).
async function lStep() {
  const name=document.getElementById('luser').value.trim();
  if(!name){showErr('Introduce un nombre de usuario');return;}
  showErr('');
  setBtnLoading('lbtn', true, 'Comprobando…');
  let existe=false, bloqueado=false;
  try{
    const data=await apiPost('/auth',{action:'check',nick:name});
    existe=!!data.existe; bloqueado=!!data.bloqueado;
    setCloudState('ok');
  }catch(e){
    if(!e.isNetwork){ setCloudState('err'); setBtnLoading('lbtn', false); showErr(e.message); return; }
    setCloudState('off');
    const u=LS.users().find(u=>u.name.toLowerCase()===name.toLowerCase());
    existe=!!u; bloqueado=u?!!u.locked:false;
  }
  setBtnLoading('lbtn', false);
  if(bloqueado){showErr('Acceso bloqueado. Contacta con el administrador.');return;}

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
    onAuthSuccess(data.usuario,data.token);
  }catch(e){
    setBtnLoading('lbtn', false);
    if(e.isNetwork){ setCloudState('off'); loginLocalFallback(name,pass); return; }
    setCloudState('err'); showErr(e.message);
    document.getElementById('lpass').value='';
  }
}
function loginLocalFallback(name,pass) {
  const users=LS.users();
  const i=users.findIndex(u=>u.name.toLowerCase()===name.toLowerCase());
  if(i<0){showErr('Usuario no encontrado (sin conexión con la nube)');return;}
  const u=users[i];
  if(u.locked){showErr('Acceso bloqueado.');return;}
  if(u.pass===pass){
    u.att=0; LS.setU(users);
    LS.setToken(''); LS.setSession(null);
    S.user=u.name; S.isAdmin=u.role==='admin'; S.dose=LS.dose();
    toast('☁ Sin conexión: sesión solo local');
    go('menu');
  } else {
    u.att=(u.att||0)+1; const rem=3-u.att;
    if(rem<=0){u.locked=true;LS.setU(users);showErr('Bloqueado. Demasiados intentos.');}
    else{LS.setU(users);showErr(`Contraseña incorrecta. Quedan ${rem} intento${rem===1?'':'s'}.`);}
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
  if(!pass||pass.length<4){showErr('La contraseña debe tener al menos 4 caracteres');return;}
  if(pass!==pass2){showErr('Las contraseñas no coinciden');return;}
  setBtnLoading('lbtn', true, 'Creando cuenta…');
  try{
    const data=await apiPost('/auth',{action:'register',nick:name,pass,nombre,apellido1:ap1,apellido2:ap2});
    setCloudState('ok');
    setBtnLoading('lbtn', false);
    onAuthSuccess(data.usuario,data.token);
  }catch(e){
    setBtnLoading('lbtn', false);
    if(!e.isNetwork){ showErr(e.message); return; }
    setCloudState('off');
    const users=LS.users();
    if(users.find(u=>u.name.toLowerCase()===name.toLowerCase())){showErr('Ese usuario ya existe');return;}
    users.push({name,pass,role:'user',att:0,locked:false,nombre,apellido1:ap1,apellido2:ap2});
    LS.setU(users);
    LS.setToken(''); LS.setSession(null);
    S.user=name; S.isAdmin=false; S.dose=LS.dose();
    toast('☁ Sin conexión: cuenta creada solo en este dispositivo');
    go('menu');
  }
}
function onAuthSuccess(usuario, token) {
  LS.setToken(token); LS.setSession(usuario);
  S.user=usuario.nick; S.isAdmin=usuario.role==='admin'; S.dose=LS.dose();
  S.lastCheck=new Date().toISOString();
  go('menu');
  flushPending();
  refreshDrivers().then(()=>populateConductorSelect());
  startNotifPolling();
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
  document.getElementById('lbtn').textContent='Continuar';
  document.getElementById('lbtn').onclick=lStep;
  showErr(''); document.getElementById('lok').style.display='none';
}
function showErr(m){const e=document.getElementById('lerr');if(!m){e.style.display='none';return;}e.textContent=m;e.style.display='block';document.getElementById('lok').style.display='none';}
function showOk(m){const e=document.getElementById('lok');e.textContent=m;e.style.display='block';document.getElementById('lerr').style.display='none';}

// ── MENU ──────────────────────────────────────────────
function renderMenu() {
  document.getElementById('muser').textContent=S.user||'—';
  document.getElementById('dbdg').textContent=S.dose+' Gy';
  document.getElementById('mdose').textContent=S.dose;
  document.getElementById('sdose').value=S.dose;
  document.getElementById('mdate').value=tod(new Date());
  const n=S.staged.length;
  const b=document.getElementById('nbf');
  b.textContent=n; b.style.display=n>0?'flex':'none';
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
}

// ── FORM CALCULATIONS ─────────────────────────────────
function onFecha() {
  const v=document.getElementById('fchIrr').value;
  const d=pd(v);
  if(!d){['semana','tasa','fTexp'].forEach(id=>document.getElementById(id).value='');return;}
  const r=rate(d);
  document.getElementById('semana').value=isoWk(d);
  document.getElementById('tasa').value=r.toFixed(8);
  document.getElementById('fTexp').value=r>0?(S.dose/r).toFixed(1):'';
}
function calcTm() {
  const a=parseFloat(document.getElementById('fTi').value);
  const b=parseFloat(document.getElementById('fTf').value);
  document.getElementById('fTm').value=(!isNaN(a)&&!isNaN(b))?((a+b)/2).toFixed(1):'';
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
        <input type="number" id="${key}N" min="0" value="${u.n||''}" placeholder="0"
          style="font-size:17px;padding:12px 14px;border-color:${color}66"
          oninput="uNum('${key}')"></div>
      <div class="fl"><label>Fecha de sexado</label>
        <input type="date" id="${key}D" value="${u.date?tod(new Date(u.date)):''}"
          style="font-size:16px;padding:12px 14px;border-color:${color}66"
          oninput="uDate('${key}')"></div>
      <div class="fl"><label>Lote — sexado menos 6 días (auto)</label>
        <div class="cfr">
          <input type="text" id="${key}L" readonly value="${u.lote||''}"
            placeholder="Selecciona fecha de sexado"
            style="font-size:16px;padding:12px 14px;border-color:${color}88;
                   color:#E0E6FF;background:#0D1020;padding-right:58px">
          <span class="aut" style="color:${color};font-size:11px">auto</span>
        </div></div>
      ${u.n||u.date?`
      <div style="background:${color}18;border:1px solid ${color}44;border-radius:var(--rsm);
        padding:12px 14px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:13px;color:rgba(255,255,255,.6)">Urnas en esta entrada</span>
        <span style="font-family:var(--fh);font-size:22px;font-weight:700;color:${color}">${u.n||'0'}</span>
      </div>`:''}
    </div>`;
}

function openUrna() {
  _urnaTab='urna1';
  UCFG.forEach(({key,color})=>{
    document.getElementById('upanel-'+key).innerHTML=renderUrnaPanel(key,color);
    document.getElementById('upanel-'+key).classList.remove('on');
  });
  document.getElementById('upanel-urna1').classList.add('on');
  UCFG.forEach(({key})=>{
    const tab=document.getElementById('utab-'+key);
    tab.classList.remove('on','filled');
    if(S[key].n||S[key].date) tab.classList.add('filled');
  });
  document.getElementById('utab-urna1').classList.add('on');
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
function updMpill() {
  const t=urnaTotal();
  const p=document.getElementById('mpill');
  if(p){p.textContent=`Total: ${t}`;p.style.display=t>0?'inline-block':'none';}
  UCFG.forEach(({key})=>{
    const tab=document.getElementById('utab-'+key);
    if(tab){tab.classList.remove('filled');if(S[key].n||S[key].date)tab.classList.add('filled');}
  });
}
function updChips() {
  UCFG.forEach(({key,color,label})=>{
    const chip=document.getElementById('chip-'+key); if(!chip) return;
    const u=S[key];
    if(u.n||u.date){
      chip.className='uchip filled';
      chip.style.cssText=`background:${color}22;border-color:${color}88;color:#fff`;
      chip.innerHTML=`<span style="width:7px;height:7px;border-radius:50%;background:${color};flex-shrink:0"></span>${label}: ${u.n||'0'}`;
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

async function guardar() {
  const t=urnaTotal();
  const tiV=parseFloat(document.getElementById('fTi').value);
  const tfV=parseFloat(document.getElementById('fTf').value);
  const tm=(!isNaN(tiV)&&!isNaN(tfV))?((tiV+tfV)/2).toFixed(1):'';
  const respSel=document.getElementById('fResp');
  const respNick=respSel?respSel.value:'';
  const respNombre=(respSel&&respSel.selectedOptions[0])?respSel.selectedOptions[0].textContent:'';
  const respCodigo=document.getElementById('fRespCod').value;
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
    irr:    document.getElementById('fIrr').value,
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
    tm,
    // Metadatos
    at: new Date().toISOString(),
  };
  setBtnLoading('gbtn', true, 'Guardando…');
  S.staged.push(rec); LS.setS(S.staged);
  await syncRecordToCloud(rec);
  limpiarForm();
  setBtnLoading('gbtn', false);
  updStagedUI();
  toast('✓ Registro guardado');
}
function limpiarForm() {
  ['fchIrr','semana','tasa','fTexp','fResp','fRespCod','fHII','fHIL','fHVI','fHVL',
   'fTi','fTf','fTm','fIrr','fDos','fHini','fHfin','fObs']
    .forEach(id=>{const e=document.getElementById(id);if(e){e.value='';if(id==='fDos')e.readOnly=false;}});
  onConductorChange();
  S.urna1={n:'',date:'',lote:''}; S.urna2={n:'',date:'',lote:''}; S.urna3={n:'',date:'',lote:''};
  document.getElementById('totBan').style.display='none';
  const b=document.getElementById('dosWrap').querySelector('.aut'); if(b) b.remove();
}
function updStagedUI() {
  const n=S.staged.length;
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
const EX_LABELS={form:'Formulario',month:'Dosis mensual',weekly:'Tabla anual',hist:'Historial'};

function openExDlg(ctx) {
  if(ctx==='form'&&!S.staged.length){toast('No hay registros para exportar');return;}
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
    else if(fmt_==='json') {content=JSON.stringify(S.staged,null,2);mime='application/json';filename=`irradiacion_${dateStamp()}.json`;}
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
  let fullPath, saveMethod;
  if(result&&result.method==='picker'){
    fullPath=result.path||filename; saveMethod='📁 Guardado en ubicación elegida';
  } else if(isMobile()){
    const isA=/Android/i.test(navigator.userAgent), isI=/iPad|iPhone|iPod/.test(navigator.userAgent);
    fullPath=isA?`/sdcard/Download/${filename}`:isI?`Archivos → En mi iPhone → Descargas`:`Carpeta Descargas`;
    saveMethod='📥 Descargado automáticamente';
  } else {
    const osF=navigator.userAgent.includes('Win')?`C:\\Users\\${S.user||'Usuario'}\\Downloads\\`:
               navigator.userAgent.includes('Mac')?`/Users/${S.user||'usuario'}/Downloads/`:
               `/home/${(S.user||'usuario').toLowerCase()}/Downloads/`;
    fullPath=osF+filename; saveMethod='📥 Guardado en Descargas';
  }
  const extEl=document.getElementById('scFext');
  extEl.textContent=fmtU; extEl.className=`fext ${fmt_}`;
  document.getElementById('scFname').textContent=filename;
  document.getElementById('scFmeta').textContent=`${fmtU} · ${kbSize} KB · ${EX_LABELS[ctx]} · ${ts}`;
  document.getElementById('scTerm').innerHTML=`
    <div class="term-line"><span class="term-prompt">$</span><span class="term-cmd">vi-export --format ${fmt_} --source ${ctx}</span></div>
    <div class="term-line" style="margin-top:4px"><span class="term-prompt"> </span><span class="term-out">[INFO] Generando ${fmtU} · ${bytes.toLocaleString()} bytes · UTF-8 BOM</span></div>
    <div class="term-line" style="margin-top:4px"><span class="term-prompt"> </span><span class="term-out">[INFO] ${saveMethod}</span></div>
    <div class="term-line" style="margin-top:4px"><span class="term-prompt">$</span><span class="term-cmd">ruta → <span class="term-path">${fullPath}</span></span></div>
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
  const rows=S.staged.map(r=>[
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
  return [[h,...rows].map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\r\n'),'text/csv;charset=utf-8;'];
}

function buildFormTXT() {
  return S.staged.map((r,i)=>{
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
  if(!S.staged.length){list.innerHTML='<div class="remp">No hay registros guardados</div>';return;}
  const pendAt=new Set(LS.pending().map(p=>p.at));
  list.innerHTML=S.staged.map((r,i)=>{
    const fIrr=r.fchIrr?fmt(pd(r.fchIrr)):'Sin fecha';
    const sync=!LS.token()?'':(pendAt.has(r.at)?'<span class="cloudbdg off" style="margin-left:8px">⏳ pendiente</span>':'<span class="cloudbdg ok" style="margin-left:8px">☁ sincronizado</span>');
    return `<div class="ritem">
      <div class="rdate">📋 ${fIrr} — Sem. ${r.semana||'?'}${sync}</div>
      <div class="rdets">
        <span>Urnas: <strong>${r.nUrnas||'—'}</strong></span>
        <span>Tiempo: <strong>${r.texp||'—'} s</strong></span>
        <span>Tasa: <strong>${r.tasa?parseFloat(r.tasa).toFixed(5):'—'} Gy/s</strong></span>
        <span>Dosím.: <strong>${r.dos||'—'}</strong></span>
        <span>Conductor: <strong>${r.resp||'—'}${r.respCodigo?` (${r.respCodigo})`:''}</strong></span>
        <span>Tª media: <strong>${r.tm||'—'} °C</strong></span>
      </div>
      ${r.obs?`<div class="robs">📝 ${r.obs.substring(0,100)}${r.obs.length>100?'…':''}</div>`:''}</div>`;
  }).join('<div style="height:8px"></div>');
}
async function clearRecs() {
  const ok=await confirmDialog('¿Eliminar todos los registros guardados en este dispositivo?',
    {title:'Eliminar registros',okText:'Eliminar todos',okClass:'br'});
  if(!ok) return;
  S.staged=[]; LS.setS([]); updStagedUI(); renderRecs(); toast('Registros eliminados');
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
  const iso=d=>d.toISOString().slice(0,10);
  document.getElementById('hDesde').value=iso(hace30);
  document.getElementById('hHasta').value=iso(hoy);
  buscarHistorial();
}
function poblarFiltrosHistorial(regs) {
  const condSel=document.getElementById('hConductor');
  const usrSel=document.getElementById('hUsuario');
  const condActual=condSel.value, usrActual=usrSel.value;
  const conductores=[...new Map(regs.filter(r=>r.conductor_nick).map(r=>[r.conductor_nick,r.conductor_nombre||r.conductor_nick])).entries()];
  const usuarios=[...new Set(regs.map(r=>r.creado_por).filter(Boolean))].sort();
  condSel.innerHTML='<option value="">Todos</option>'+conductores.map(([nick,nom])=>`<option value="${nick}">${nom}</option>`).join('');
  usrSel.innerHTML='<option value="">Todos</option>'+usuarios.map(u=>`<option value="${u}">${u}</option>`).join('');
  if(conductores.some(([nick])=>nick===condActual)) condSel.value=condActual;
  if(usuarios.includes(usrActual)) usrSel.value=usrActual;
}
function aplicarFiltrosHistorial() {
  const cond=document.getElementById('hConductor').value;
  const usr=document.getElementById('hUsuario').value;
  const sem=document.getElementById('hSemana').value.trim();
  const txt=document.getElementById('hTexto').value.trim().toLowerCase();
  let regs=S.histRaw||[];
  if(cond) regs=regs.filter(r=>r.conductor_nick===cond);
  if(usr)  regs=regs.filter(r=>r.creado_por===usr);
  if(sem)  regs=regs.filter(r=>String(r.semana_iso||'')===sem);
  if(txt)  regs=regs.filter(r=>
    (r.irradiador||'').toLowerCase().includes(txt) ||
    (r.observaciones||'').toLowerCase().includes(txt) ||
    (r.conductor_nombre||'').toLowerCase().includes(txt) ||
    (r.creado_por||'').toLowerCase().includes(txt));
  S.histFiltered=regs;
  renderHistorial(regs);
  if(S.histVista==='graf') dibujarGraficaHistorial();
  const note=document.getElementById('histNote');
  if(note) note.textContent=`${regs.length} registro(s) encontrado(s)`;
}
function renderHistorial(regs) {
  const box=document.getElementById('histList');
  if(!regs.length){box.innerHTML='<div class="remp">No hay registros con estos filtros</div>';return;}
  box.innerHTML=regs.map(r=>{
    const fIrr=r.fecha_irradiacion?fmt(pd(r.fecha_irradiacion)):'Sin fecha';
    const puedeBorrar=S.isAdmin||r.creado_por===S.user;
    return `<div class="ritem">
      <div class="rdate">📋 ${fIrr} — Sem. ${r.semana_iso||'?'} <span style="color:var(--txt3);font-weight:400">· guardado por ${r.creado_por||'—'}</span></div>
      <div class="rdets">
        <span>Urnas: <strong>${r.n_urnas||'—'}</strong></span>
        <span>Tiempo: <strong>${r.tiempo_exposicion||'—'} s</strong></span>
        <span>Tasa: <strong>${r.tasa?parseFloat(r.tasa).toFixed(5):'—'} Gy/s</strong></span>
        <span>Dosím.: <strong>${r.dosimetros||'—'}</strong></span>
        <span>Conductor: <strong>${r.conductor_nombre||'—'}${r.conductor_codigo?` (${r.conductor_codigo})`:''}</strong></span>
        <span>Tª media: <strong>${r.temp_media||'—'} °C</strong></span>
      </div>
      ${r.observaciones?`<div class="robs">📝 ${r.observaciones.substring(0,100)}${r.observaciones.length>100?'…':''}</div>`:''}
      ${puedeBorrar?`<div style="margin-top:8px;text-align:right"><button class="btn br bs" style="padding:3px 10px;font-size:11px" onclick="eliminarHistorialRegistro('${r.id}')">🗑 Eliminar</button></div>`:''}
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
    toast('Registro eliminado');
    buscarHistorial();
  }catch(e){
    toast('⚠ '+e.message);
  }
}

// ── GRÁFICAS DEL HISTORIAL ─────────────────────────────
let histChartInstance=null;
function cambiarVistaHistorial(vista) {
  S.histVista=vista;
  document.getElementById('hTabLista').className='btn bs '+(vista==='lista'?'bp':'bo');
  document.getElementById('hTabGraf').className='btn bs '+(vista==='graf'?'bp':'bo');
  document.getElementById('histList').style.display=vista==='lista'?'':'none';
  document.getElementById('histChartWrap').style.display=vista==='graf'?'':'none';
  document.getElementById('hGrafSelWrap').style.display=vista==='graf'?'':'none';
  if(vista==='graf'){
    if(!window.Chart){ toast('⚠ No se pudo cargar la librería de gráficas (revisa tu conexión a internet)'); return; }
    dibujarGraficaHistorial();
  }
}
function dibujarGraficaHistorial() {
  const canvas=document.getElementById('histChart');
  if(!canvas||!window.Chart) return;
  if(histChartInstance){ histChartInstance.destroy(); histChartInstance=null; }

  const regs=[...(S.histFiltered||[])].filter(r=>r.fecha_irradiacion)
    .sort((a,b)=>a.fecha_irradiacion.localeCompare(b.fecha_irradiacion));
  if(!regs.length) return;

  const tipo=document.getElementById('hChartTipo').value;
  const gridCol='rgba(255,255,255,.08)', tickCol='#8890A6';
  let type='line', labels, datasets, yTitle='';

  if(tipo==='temp'){
    labels=regs.map(r=>fmt(pd(r.fecha_irradiacion)));
    datasets=[
      {label:'Tª inicial',data:regs.map(r=>r.temp_inicial),borderColor:'#748FFC',backgroundColor:'#748FFC',tension:.3,spanGaps:true},
      {label:'Tª final',data:regs.map(r=>r.temp_final),borderColor:'#FF6B6B',backgroundColor:'#FF6B6B',tension:.3,spanGaps:true},
      {label:'Tª media',data:regs.map(r=>r.temp_media),borderColor:'#69DB7C',backgroundColor:'#69DB7C',tension:.3,spanGaps:true},
    ];
    yTitle='°C';
  } else if(tipo==='tasa'){
    labels=regs.map(r=>fmt(pd(r.fecha_irradiacion)));
    datasets=[{label:'Tasa',data:regs.map(r=>r.tasa),borderColor:'#FFA94D',backgroundColor:'#FFA94D',tension:.3,spanGaps:true}];
    yTitle='Gy/s';
  } else if(tipo==='texp'){
    labels=regs.map(r=>fmt(pd(r.fecha_irradiacion)));
    datasets=[{label:'Tiempo exposición',data:regs.map(r=>r.tiempo_exposicion),borderColor:'#748FFC',backgroundColor:'#748FFC',tension:.3,spanGaps:true}];
    yTitle='s';
  } else if(tipo==='urnas'){
    labels=regs.map(r=>fmt(pd(r.fecha_irradiacion)));
    datasets=[{label:'Nº urnas',data:regs.map(r=>r.n_urnas),borderColor:'#69DB7C',backgroundColor:'#69DB7C',tension:.3,spanGaps:true}];
    yTitle='urnas';
  } else if(tipo==='semana'){
    type='bar';
    const porSemana={};
    regs.forEach(r=>{const k=r.semana_iso||'?'; porSemana[k]=(porSemana[k]||0)+1;});
    labels=Object.keys(porSemana).sort((a,b)=>(+a)-(+b));
    datasets=[{label:'Registros',data:labels.map(k=>porSemana[k]),backgroundColor:'#4C6EF5'}];
    yTitle='registros';
  }

  histChartInstance=new Chart(canvas.getContext('2d'),{
    type, data:{labels,datasets},
    options:{
      responsive:true,
      plugins:{legend:{labels:{color:tickCol}}},
      scales:{
        x:{ticks:{color:tickCol,maxRotation:60,minRotation:0},grid:{color:gridCol}},
        y:{ticks:{color:tickCol},grid:{color:gridCol},title:{display:true,text:yTitle,color:tickCol}}
      }
    }
  });
}

// ── EXPORT HISTORIAL — CSV / Excel / PDF ──────────────
function buildHistRows(regs) {
  const header=['Fecha Irradiación','Semana ISO','Guardado por','Conductor','Código','Tasa Gy/s','Tiempo Exp.(s)','Nº Urnas','Dosímetros',
    'H.Ida Ini','H.Ida Lle','H.Vta Ini','H.Vta Lle','Tª Ini(°C)','Tª Fin(°C)','Tª Media(°C)','Irradiador','H.Ini Irr.','H.Fin Irr.','Observaciones'];
  const rows=regs.map(r=>[
    r.fecha_irradiacion?fmt(pd(r.fecha_irradiacion)):'',
    r.semana_iso||'', r.creado_por||'', r.conductor_nombre||'', r.conductor_codigo||'',
    r.tasa?parseFloat(r.tasa).toFixed(8):'', r.tiempo_exposicion||'', r.n_urnas||'', r.dosimetros||'',
    r.h_ida_inicio||'', r.h_ida_llegada||'', r.h_vuelta_inicio||'', r.h_vuelta_llegada||'',
    r.temp_inicial||'', r.temp_final||'', r.temp_media||'',
    r.irradiador||'', r.h_inicio_irr||'', r.h_fin_irr||'', r.observaciones||''
  ]);
  return {header,rows};
}
async function exportHistCSV() {
  const regs=S.histFiltered||[];
  if(!regs.length){toast('No hay registros para exportar');return;}
  const {header,rows}=buildHistRows(regs);
  const content=[header,...rows].map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\r\n');
  const filename=`historial_${dateStamp()}.csv`;
  const result=await dlFile(filename,content,'text/csv;charset=utf-8;');
  if(result===null) return;
  showSaveDlg(filename,'csv',new Blob(['\uFEFF'+content]).size,'hist',result);
}
async function exportHistXLSX() {
  const regs=S.histFiltered||[];
  if(!regs.length){toast('No hay registros para exportar');return;}
  if(!window.XLSX){toast('⚠ No se pudo cargar la librería de Excel (revisa tu conexión a internet)');return;}
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
async function exportHistPDF() {
  const regs=S.histFiltered||[];
  if(!regs.length){toast('No hay registros para exportar');return;}
  if(!window.jspdf){toast('⚠ No se pudo cargar la librería de PDF (revisa tu conexión a internet)');return;}
  const {header,rows}=buildHistRows(regs);
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF({orientation:'landscape',unit:'pt'});
  doc.setFontSize(14); doc.text('Values Irradiation WEB-210 — Historial',40,30);
  doc.setFontSize(9);  doc.text(`Generado: ${new Date().toLocaleString()}`,40,45);
  doc.autoTable({head:[header],body:rows,startY:55,styles:{fontSize:7,cellPadding:3},headStyles:{fillColor:[76,110,245]}});
  const blob=doc.output('blob');
  const filename=`historial_${dateStamp()}.pdf`;
  const result=await dlBlob(filename,blob);
  if(result===null) return;
  showSaveDlg(filename,'pdf',blob.size,'hist',result);
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
  document.getElementById('admSec').style.display=S.isAdmin?'flex':'none';
  if(S.isAdmin) renderUsrs();
  actualizarEstadoNotifUI();
}
function saveDose() {
  const v=parseFloat(document.getElementById('sdose').value);
  if(isNaN(v)||v<=0){toast('Dosis inválida');return;}
  S.dose=v; LS.setD(v);
  document.getElementById('dbdg').textContent=v+' Gy';
  document.getElementById('mdose').textContent=v;
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
  if(!nick||!pass){toast('Rellena usuario y contraseña');return;}
  try{
    await apiPost('/usuarios',{action:'crear',token:LS.token(),payload:{nick,pass,nombre,apellido1:ap1,apellido2:ap2,role}});
    setCloudState('ok');
    toast(`✓ Usuario "${nick}" creado`);
  }catch(e){
    if(!e.isNetwork){ toast('⚠ '+e.message); return; }
    setCloudState('off');
    const users=LS.users();
    if(users.find(u=>u.name.toLowerCase()===nick.toLowerCase())){toast('El usuario ya existe');return;}
    users.push({name:nick,pass,role,att:0,locked:false,nombre,apellido1:ap1,apellido2:ap2});
    LS.setU(users);
    toast(`✓ Usuario "${nick}" creado (local, sin conexión)`);
  }
  ['nusr','nnombre','nap1','nap2','npass'].forEach(id=>{document.getElementById(id).value='';});
  renderUsrs();
  refreshDrivers().then(()=>populateConductorSelect());
}
let editUserNick = null;
async function renderUsrs() {
  const box=document.getElementById('usrList');
  const note=document.getElementById('usrSyncNote');
  let users=[], enNube=true;
  try{
    const data=await apiPost('/usuarios',{action:'list',token:LS.token()});
    users=(data.usuarios||[]).map(u=>({
      name:u.nick, role:u.role, locked:u.locked,
      nombre:u.nombre||'', apellido1:u.apellido1||'', apellido2:u.apellido2||'',
      codigo:u.codigo||codigoConductor(u.nombre,u.apellido1,u.apellido2)
    }));
    setCloudState('ok');
  }catch(e){
    enNube=false;
    setCloudState(e.isNetwork?'off':'err');
    users=LS.users().map(u=>({
      name:u.name, role:u.role, locked:u.locked,
      nombre:u.nombre||'', apellido1:u.apellido1||'', apellido2:u.apellido2||'',
      codigo:codigoConductor(u.nombre||u.name,u.apellido1||'',u.apellido2||'')
    }));
  }
  if(note) note.textContent = enNube ? '' : '⚠ Mostrando usuarios de este dispositivo (sin conexión con la nube).';
  box.innerHTML=users.length===0
    ?'<div style="font-size:13px;color:var(--txt3)">No hay usuarios</div>'
    :users.map(u=>{
      const nickSeguro=u.name.replace(/'/g,"\\'");
      if(editUserNick && u.name.toLowerCase()===editUserNick.toLowerCase()){
        return filaUsrEdicion(u, nickSeguro);
      }
      const esAdmin=u.name.toLowerCase()==='admin';
      const puedeBorrar=!esAdmin||(S.user||'').toLowerCase()==='admin';
      const nombreCompleto=[u.nombre,u.apellido1,u.apellido2].filter(Boolean).join(' ');
      return `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px solid var(--brd);font-size:13px;flex-wrap:wrap">
        <span style="font-family:var(--fh);font-size:11px;font-weight:700;background:rgba(76,110,245,.18);color:var(--blue-l);padding:2px 6px;border-radius:4px;flex-shrink:0">${u.codigo}</span>
        <span style="flex:1;font-weight:600">${u.name}${nombreCompleto?` <span style="color:var(--txt3);font-weight:400">— ${nombreCompleto}</span>`:''}</span>
        <span style="color:var(--txt3)">${u.role}</span>
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
  const esc=s=>(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  return `
  <div style="padding:10px;margin-top:8px;border:1px solid var(--brd3);border-radius:10px;background:rgba(76,110,245,.06);display:flex;flex-direction:column;gap:10px">
    <div style="font-weight:700;font-family:var(--fh)">Editando: ${u.name}</div>
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
  try{
    await apiPost('/usuarios',{action:'editar',token:LS.token(),payload:{nick,nombre,apellido1:ap1,apellido2:ap2,role,nuevaPass:nuevaPass||undefined}});
    setCloudState('ok');
    toast('✓ Usuario actualizado');
  }catch(e){
    if(!e.isNetwork){ toast('⚠ '+e.message); return; }
    setCloudState('off');
    const users=LS.users();
    const u=users.find(u=>u.name.toLowerCase()===nick.toLowerCase());
    if(u){
      u.nombre=nombre; u.apellido1=ap1; u.apellido2=ap2;
      if(role!==undefined) u.role=role;
      if(nuevaPass) u.pass=nuevaPass;
      LS.setU(users);
      toast('✓ Usuario actualizado (local, sin conexión)');
    }
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
    if(!e.isNetwork){ toast('⚠ '+e.message); renderUsrs(); return; }
    setCloudState('off');
    const users=LS.users();
    const idx=users.findIndex(u=>u.name.toLowerCase()===nick.toLowerCase());
    if(idx>=0){ users.splice(idx,1); LS.setU(users); toast('Usuario eliminado (local, sin conexión)'); }
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
    if(!e.isNetwork){ toast('⚠ '+e.message); renderUsrs(); return; }
    setCloudState('off');
    const users=LS.users();
    const u=users.find(u=>u.name.toLowerCase()===nick.toLowerCase());
    if(u){ u.locked=false; u.att=0; LS.setU(users); toast('✓ Usuario desbloqueado (local, sin conexión)'); }
  }
  renderUsrs();
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

function toast(msg) {
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('on');
  setTimeout(()=>t.classList.remove('on'),2600);
}

// ── BOOT ──────────────────────────────────────────────
boot();
setLogo(0);
startLogoRotation();


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
