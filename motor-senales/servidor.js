'use strict';
/* Servidor HTTP mínimo (sin dependencias):
     GET /salud   -> "ok" (para Render y el pinger externo)
     GET /estado  -> JSON con métricas del motor
   Se quitaron /, /importar y /estrategia/*: el panel de importación y el
   documento de estrategia ya no existen — el motor corre las reglas del
   vídeo 03, no un JSON editable.
   IMPORTANTE (Render free): el servicio se duerme tras 15 min sin
   tráfico ENTRANTE; el WebSocket saliente NO cuenta como actividad.
   Configura un pinger externo (cron-job.org / UptimeRobot) que
   golpee /salud cada 5-10 min. */
const http = require('http');
const crypto = require('crypto');
const memoria = require('./memoria');
const escaner = require('./escaner');
const { zonasDe } = require('./zonas');
const sugerencia = require('./sugerencia');

/* Autenticación opcional para /estado.
   Sin ESTADO_TOKEN todo queda abierto (correcto en localhost).
   Si expones esto en Internet (Render...), define ESTADO_TOKEN:
     curl -H "x-estado-token: $ESTADO_TOKEN" https://.../estado
   o con query:  /estado?token=... */
const ESTADO_TOKEN = process.env.ESTADO_TOKEN || '';

/* El motor solo devuelve texto/JSON: la política más estricta no rompe nada
   y evita sniffing, framing, fugas de referer y caché de estado. */
const CABECERAS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'Cache-Control': 'no-store',
};

const _json = (res, codigo, obj) => {
  const extra = codigo === 413 ? { Connection: 'close' } : {};
  res.writeHead(codigo, { ...CABECERAS, ...extra, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj, null, 2));
};

/* Allowlist de Host: el motor escucha en loopback, pero un dominio del
   atacante puede resolver a 127.0.0.1 (DNS rebinding) y leer /estado desde
   el navegador de la víctima. Se acepta localhost, IPs privadas y los hosts
   declarados por entorno (Render). */
const HOSTS_EXTRA = String(process.env.MS_HOSTS_PERMITIDOS || process.env.RENDER_EXTERNAL_HOSTNAME || '')
  .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
function _hostPermitido(host) {
  if (!host) return true;   // HTTP/1.0 sin Host: ningún navegador lo usa
  const h = String(host).toLowerCase().replace(/:\d+$/, '');
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]') return true;
  if (HOSTS_EXTRA.includes(h)) return true;
  if (/^(10\.|127\.|192\.168\.|169\.254\.)/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  return false;
}

/* Ventana fija por IP: 120 peticiones/min cubre varias pestañas de la
   gráfica (1 cada 5 s) y corta bucles y floods. */
const MS_RATE_LIMITE = Number(process.env.MS_RATE_LIMITE) || 120;
const MS_RATE_VENTANA_MS = Number(process.env.MS_RATE_VENTANA_MS) || 60000;
const _golpes = new Map();
function _rateExcedido(ip) {
  const ahora = Date.now();
  const k = String(ip || '?');
  let v = _golpes.get(k);
  if (!v || ahora - v.t >= MS_RATE_VENTANA_MS) { v = { t: ahora, n: 0 }; _golpes.set(k, v); }
  v.n++;
  if (_golpes.size > 1000) _golpes.clear();   // no crecer sin tope
  return v.n > MS_RATE_LIMITE;
}

/* comparación en tiempo constante: un `!==` normal filtra el token
   carácter a carácter por timing en un despliegue público */
const _tokenValido = (dado, esperado) => {
  const a = Buffer.from(String(dado || ''));
  const b = Buffer.from(String(esperado || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const GRAFICA_HTML = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>Gráfica - herramientas de dibujo (MT5-style)</title>
<style>
  :root { --bg:#0b0e14; --panel:#131824; --border:#2a3142; --txt:#e6e6e6; --acc:#ffd166; --man:#4fc3f7; --sel:#ff4081; }
  body { font-family: system-ui, sans-serif; margin: 8px; background:var(--bg); color:var(--txt); }
  .toolbar { display:flex; gap:4px; align-items:center; margin-bottom:6px; flex-wrap:wrap; padding:6px; background:var(--panel); border:1px solid var(--border); border-radius:6px; }
  .toolbar button { background:#1a1f2b; color:var(--txt); border:1px solid var(--border); padding:4px 8px; border-radius:4px; cursor:pointer; font-size:12px; }
  .toolbar button.activo { background:var(--acc); color:#000; border-color:var(--acc); }
  .toolbar button.toggle.on { background:#26a69a; color:#000; border-color:#26a69a; }
  .toolbar .sep { width:1px; height:22px; background:var(--border); margin:0 4px; }
  .toolbar select { background:#1a1f2b; color:var(--txt); border:1px solid var(--border); padding:4px 6px; border-radius:4px; }
  .toolbar label { font-size:12px; opacity:.8; }
  .layout { display:flex; gap:8px; align-items:flex-start; }
  .scan { width:250px; background:var(--panel); border:1px solid var(--border); border-radius:6px; padding:8px; font-size:12px; }
  .scan h3 { margin:0 0 6px; font-size:12px; font-weight:600; opacity:.85; }
  .scan .row { display:flex; justify-content:space-between; padding:3px 0; border-bottom:1px solid #1c2231; }
  .scan .row i { font-style:normal; opacity:.7; }
  .canvasWrap { position:relative; }
  canvas { background:var(--bg); border:1px solid var(--border); display:block; cursor:crosshair; }
  .sidebar { width:260px; background:var(--panel); border:1px solid var(--border); border-radius:6px; padding:8px; font-size:12px; max-height:620px; overflow:auto; }
  .sidebar h3 { margin:4px 0 6px; font-size:13px; color:var(--acc); }
  .objrow { display:flex; align-items:center; gap:4px; padding:3px 2px; border-bottom:1px solid #1f2533; }
  .objrow.sel { background:#1f2a3a; }
  .objrow button { padding:2px 5px; font-size:11px; }
  .statusbar { display:flex; gap:12px; margin-top:6px; font-size:12px; opacity:.9; flex-wrap:wrap; }
  .statusbar .k { color:var(--acc); }
  .modal { position:fixed; inset:0; background:rgba(0,0,0,.6); display:none; align-items:center; justify-content:center; z-index:50; }
  .modal.show { display:flex; }
  .modal .box { background:var(--panel); border:1px solid var(--border); border-radius:8px; padding:14px; width:360px; }
  .modal .box h3 { margin:0 0 10px; color:var(--acc); }
  .modal .row { display:flex; gap:8px; align-items:center; margin:6px 0; }
  .modal .row label { width:110px; font-size:12px; }
  .modal input, .modal select { background:#1a1f2b; color:var(--txt); border:1px solid var(--border); padding:4px 6px; border-radius:4px; flex:1; }
  .modal .btns { display:flex; gap:8px; justify-content:flex-end; margin-top:10px; }
  .ctxmenu { position:fixed; background:var(--panel); border:1px solid var(--border); border-radius:6px; padding:4px 0; z-index:60; min-width:160px; display:none; }
  .ctxmenu.show { display:block; }
  .ctxmenu .item { padding:6px 12px; cursor:pointer; font-size:12px; }
  .ctxmenu .item:hover { background:#1f2a3a; }
  .ctxmenu .sep { height:1px; background:var(--border); margin:4px 0; }
  .tooltip { position:absolute; pointer-events:none; background:rgba(0,0,0,.75); color:#fff; font-size:11px; padding:3px 6px; border-radius:3px; white-space:nowrap; }
  .info { font-size:12px; margin-top:4px; opacity:.85; }
</style></head><body>
<div class="toolbar">
  <select id="sim"></select>
  <select id="tf"><option>M1</option><option selected>M5</option><option>M15</option><option>H1</option></select>
  <button id="ref">Actualizar</button>
  <div class="sep"></div>
  <button id="tSelect" class="activo" title="Seleccionar (V)">↖ Seleccionar</button>  <button id="tTrend" title="Línea de tendencia (T) — clic en el inicio, clic en el final">/ Tendencia</button>
  <button id="tRect" title="Rectángulo (R) — clic en una esquina, clic en la opuesta">▭ Rectángulo</button>
  <button id="tDel" title="Borrar (D) — o selecciona y pulsa Supr">✕ Borrar</button>
  <div class="sep"></div>
  <button id="btnUndo" title="Deshacer (Ctrl+Z)">↶</button>
  <button id="btnRedo" title="Rehacer (Ctrl+Y)">↷</button>
  <button id="btnClear" title="Borrar todas">Borrar todas</button>
  <button id="btnList" title="Lista de objetos">Lista</button>
  <button id="btnProps" title="Propiedades">Props</button>
  <button id="btnMem" title="Guardar la línea seleccionada en la memoria del servidor">Guardar en memoria</button>
  <button id="btnSug" title="Buscar casos parecidos (no dibuja hasta aceptar)">Sugerir</button>
  <button id="btnAcep" title="Aplicar la línea fantasma">Aceptar</button>
  <button id="btnApr" title="Aprobar el último caso guardado">Aprobar</button>
  <button id="btnRech" title="Rechazar el último caso guardado">Rechazar</button>
  <button id="btnExport" title="Exportar JSON">Export</button>
  <button id="btnImport" title="Importar JSON">Import</button>
  <div class="sep"></div>
  <button id="btnMag" class="toggle on" title="Imán: cuerpo en líneas, OHLC en rectángulos (M)">Imán: ON</button>
  <button id="btnGrid" class="toggle on" title="Cuadrícula (G)">Grid: ON</button>
  <button id="btnAuto" class="toggle on" title="Mostrar/ocultar el abanico automático del motor">Auto: ON</button>
  <button id="btnCross" class="toggle on" title="Mira (X)">Mira: ON</button>
  <button id="btnZoomIn" title="Zoom +">+</button>
  <button id="btnZoomOut" title="Zoom -">−</button>
  <button id="btnFit" title="Ajustar">Fit</button>
  <span id="msg" class="info"></span>
</div>
<div class="layout">
  <div class="canvasWrap">
    <canvas id="c" width="1280" height="640"></canvas>
    <div id="tip" class="tooltip" style="display:none"></div>
  </div>
  <div class="scan" id="scan">
    <h3>Tendencia · <span id="scanSesgo">—</span></h3>
    <div id="scanRows"><div class="row"><span>cargando…</span></div></div>
  </div>
  <div class="scan" id="scanRaptor">
    <h3>RAPTOR · señales</h3>
    <div id="scanRaptorRows"><div class="row"><span>cargando…</span></div></div>
  </div>
  <div class="sidebar" id="sidebar" style="display:none">
    <h3>Objetos (<span id="objCount">0</span>)</h3>
    <div id="objList"></div>
  </div>
</div>
<div class="statusbar">
  <span>Herramienta: <span class="k" id="stTool">Seleccionar</span></span>
  <span>Imán: <span class="k" id="stMag">ON</span></span>
  <span>Zoom: <span class="k" id="stZoom">—</span></span>
  <span>Cursor: <span class="k" id="stCursor">—</span></span>
  <span>Seleccionado: <span class="k" id="stSel">—</span></span>
  <span>Líneas: <span class="k" id="stCount">0</span></span>
  <span>Aviso: <span class="k" id="stAviso">—</span></span>
</div>
<div id="info" class="info"></div>

<div id="ctxMenu" class="ctxmenu"></div>

<div id="propsModal" class="modal">
  <div class="box">
    <h3>Propiedades</h3>
    <div class="row"><label>Nombre</label><input id="pName" type="text"></div>
    <div class="row"><label>Tipo</label><input id="pType" type="text" disabled></div>
    <div class="row"><label>Color</label><input id="pColor" type="color"></div>
    <div class="row"><label>Grosor</label><input id="pWidth" type="number" min="1" max="6"></div>
    <div class="row"><label>Estilo</label><select id="pStyle"><option value="solid">Sólido</option><option value="dash">Discontinuo</option><option value="dot">Punteado</option></select></div>
    <div class="row"><label>Extender izq.</label><input id="pExtL" type="checkbox"></div>
    <div class="row"><label>Extender der.</label><input id="pExtR" type="checkbox"></div>
    <div class="row"><label>Mostrar ángulo</label><input id="pAngle" type="checkbox"></div>
    <div class="row"><label>Bloqueado</label><input id="pLock" type="checkbox"></div>
    <div class="row"><label>Visible</label><input id="pVis" type="checkbox"></div>
    <div class="btns">
      <button id="pDel">Eliminar</button>
      <button id="pCancel">Cancelar</button>
      <button id="pApply">Aplicar</button>
    </div>
  </div>
</div>

<script>
'use strict';
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const tip = document.getElementById('tip');
const pad = { l:56, r:14, t:12, b:28 };

let DATA = null;
let tool = 'select';
let magnet = true;
let gridOn = true;
let crossOn = true;
let autoOn = true;
/* Legado visual apagado: patas/canal/eventos del módulo de rayas y las
   marcas históricas (marca/ref). La política en vivo (btb-live.js) deja en
   el lienzo solo la trendline vigente y el nivel vigente. */
const LEGADO = false;
let manualLines = [];
let selected = -1;
let drawing = null;
let dragging = null;
let panning = null;
let viewStart = 0;
let viewCount = 120;
let viewInit = false;
let history = [];
let future = [];
let hovered = -1;
let cursorInfo = { i:0, p:0 };
let fantasma = null;
let ultimoCasoId = null;
let ultimaSugerencia = null;

const KEY = (sim,tf) => 'manualLines:'+sim+':'+tf;
function uid() { return 'o'+Math.random().toString(36).slice(2,9); }
function deepClone(o){ return JSON.parse(JSON.stringify(o)); }

function loadLines() {
  try { manualLines = JSON.parse(localStorage.getItem(KEY(document.getElementById('sim').value, document.getElementById('tf').value)) || '[]'); }
  catch(e){ manualLines = []; }
  if (!Array.isArray(manualLines)) manualLines = [];
  manualLines.forEach(L => { if (!L.id) L.id = uid(); });
  selected = -1; history = []; future = [];
  viewInit = false;
  pushHistory();
}
function saveLines() {
  localStorage.setItem(KEY(document.getElementById('sim').value, document.getElementById('tf').value), JSON.stringify(manualLines));
}
function pushHistory() {
  history.push(deepClone(manualLines));
  if (history.length > 60) history.shift();
  future = [];
}
function undo() {
  if (history.length <= 1) return;
  future.push(history.pop());
  manualLines = deepClone(history[history.length-1]);
  selected = -1; saveLines(); if (DATA) draw(DATA);
}
function redo() {
  if (!future.length) return;
  const s = future.pop();
  history.push(deepClone(s));
  manualLines = deepClone(s);
  selected = -1; saveLines(); if (DATA) draw(DATA);
}
function commitChange() { pushHistory(); saveLines(); if (DATA) draw(DATA); }

function defaultView() {
  if (!DATA) return;
  const n = DATA.velas.length;
  viewCount = Math.min(n, 600);
  viewStart = Math.max(0, n - viewCount);
}

async function fetchVelas() {
  const sim = document.getElementById('sim').value;
  const tf = document.getElementById('tf').value;
  const r = await fetch('/velas?simbodo=' + encodeURIComponent(sim) + '&tf=' + encodeURIComponent(tf));
  if (!r.ok) {
    /* el motor dice exactamente qué falta; se muestra su mensaje, no un código */
    let txt = 'sin datos (' + r.status + ')';
    try { const j = await r.json(); if (j && j.error) txt = j.error; } catch (e) {}
    document.getElementById('msg').textContent = txt + ' — prueba otro TF';
    return null;
  }
  return r.json();
}

function visibleRange() {
  const s = Math.max(0, viewStart);
  const e = Math.min(DATA.velas.length, viewStart + viewCount);
  return { s, e };
}

function computeBounds() {
  const { s, e } = visibleRange();
  const velas = DATA.velas;
  let mn = Infinity, mx = -Infinity;
  for (let i=s;i<e;i++){ const v=velas[i]; mn=Math.min(mn,v.l); mx=Math.max(mx,v.h); }
  // auto fan
  const patas = [];   // legado (rayas.js) apagado: no encuadra lo que no se pinta
  for (const r of patas) {
    if (!r) continue;
    const idx0 = velas.findIndex(v => v.t === r.desde);
    if (idx0 < 0) continue;
    // segment within visible
    const iA = idx0;
    const m = r.pendiente;
    const n = velas.length;
    const iEnd = Math.min(n-1, viewStart+viewCount-1);
    const y0 = r.valorDesde + m*(iA - iA);
    const y1 = r.valorDesde + m*(iEnd - iA);
    if (iA <= iEnd && iA >= s-5) { mn=Math.min(mn,y0,y1); mx=Math.max(mx,y0,y1); }
  }
  /* Geometría viva de BodyTrend: el nivel protegido y la trendline vigente
     sí forman parte de lo que se ve, así que entran en el encuadre. */
  if (autoOn && DATA.bodyTrend && Array.isArray(DATA.bodyTrend.liveDrawList)) {
    for (const g of DATA.bodyTrend.liveDrawList) {
      const from = Math.max(g.x1Bar, s), to = Math.min(g.x2Bar, e - 1);
      if (to < from) continue;
      const pA = g.p1 === g.p2 ? g.p1 : g.p1 + (g.p2 - g.p1) * (from - g.x1Bar) / ((g.x2Bar - g.x1Bar) || 1);
      const pB = g.p1 === g.p2 ? g.p1 : g.p1 + (g.p2 - g.p1) * (to - g.x1Bar) / ((g.x2Bar - g.x1Bar) || 1);
      mn = Math.min(mn, pA, pB); mx = Math.max(mx, pA, pB);
    }
  }
  if (false) { /* rayas UI desactivada */
  // manual lines
  for (const L of manualLines) {
    if (L.visible === false) continue;
    if (L.type === 'horizontal') { mn=Math.min(mn,L.p1); mx=Math.max(mx,L.p1); continue; }
    if (L.type === 'vertical') continue;
    if (L.type === 'cycle') { mn=Math.min(mn,L.p1); mx=Math.max(mx,L.p1); continue; }
    if (Math.max(L.i1, L.i2) < s || Math.min(L.i1, L.i2) > e) continue;
    mn = Math.min(mn, L.p1, L.p2); mx = Math.max(mx, L.p1, L.p2);
  }
  }
  // referencias del propietario visibles: se incluyen en el encuadre, pero
  // como mucho un 30% del rango de velas (si están muy lejos, no aplastan).
  const refs = LEGADO && Array.isArray(DATA.referencias) ? DATA.referencias : [];
  for (const r of refs) {
    const i1 = velas.findIndex(v => v.t === r.t1), i2 = velas.findIndex(v => v.t === r.t2);
    if (i1 < 0 || i2 < 0) continue;
    if (Math.max(i1, i2) < viewStart || Math.min(i1, i2) >= viewStart + viewCount) continue;
    const rng0 = mx - mn;
    const lo = Math.max(Math.min(r.p1, r.p2), mn - 0.3 * rng0);
    const hi = Math.min(Math.max(r.p1, r.p2), mx + 0.3 * rng0);
    mn = Math.min(mn, lo); mx = Math.max(mx, hi);
  }
  // zonas RAPTOR y señales en el rango visible: que no se recorten.
  if (Array.isArray(DATA.zonas)) {
    for (const z of DATA.zonas) {
      if (!Number.isFinite(z.precio)) continue;
      if (z.iHasta < viewStart || z.iDesde > viewStart + viewCount - 1) continue;
      mn = Math.min(mn, z.precio); mx = Math.max(mx, z.precio);
    }
  }
  if (Array.isArray(DATA.senales)) {
    for (const s of DATA.senales) {
      if (!Number.isFinite(s.precio)) continue;
      let idx = s.barIndex;
      if (!Number.isFinite(idx) && s.t != null) {
        const f = DATA.velas.findIndex((v) => v.t === s.t);
        if (f >= 0) idx = f;
      }
      if (!Number.isFinite(idx) || idx < viewStart || idx >= viewStart + viewCount) continue;
      mn = Math.min(mn, s.precio); mx = Math.max(mx, s.precio);
    }
  }
  if (!isFinite(mn)) { mn=0; mx=1; }
  if (mx - mn < 1e-9) { mx = mn + 1; }
  const margin = (mx-mn)*0.05;
  return { mn: mn-margin, mx: mx+margin };
}

function getPatas() {
  const r = DATA.raya;
  if (!r) return [];
  if (Array.isArray(r.patas) && r.patas.length) return r.patas;
  return [r];
}

function geom() {
  const velas = DATA.velas;
  const { s, e } = visibleRange();
  const W = canvas.width - pad.l - pad.r;
  const H = canvas.height - pad.t - pad.b;
  const { mn, mx } = computeBounds();
  const rng = mx - mn;
  const barStep = W / viewCount;
  const xOf = (i) => pad.l + (i - viewStart + 0.5) * barStep;
  const yOf = (p) => pad.t + (mx - p) / rng * H;
  const iOf = (x) => {
    const idx = Math.round(viewStart + (x - pad.l) / barStep - 0.5);
    return Math.max(0, Math.min(velas.length-1, idx));
  };
  const pOf = (y) => mx - (y - pad.t) / H * rng;
  const candleW = Math.max(1.5, barStep * 0.62);
  return { velas, pad, W, H, mn, mx, rng, xOf, yOf, iOf, pOf, barStep, candleW, s, e };
}

function magnetPoint(i, p) {
  if (!magnet) return { i, p };
  const v = DATA.velas[i];
  if (!v) return { i, p };
  const opts = [v.o, v.h, v.l, v.c];
  let bestP = p, bestD = Infinity;
  for (const q of opts) { const d = Math.abs(q - p); if (d < bestD) { bestD = d; bestP = q; } }
  const g = geom();
  const px = Math.abs(g.yOf(p) - g.yOf(bestP));
  if (px <= 9) p = bestP;
  return { i, p };
}

function atrLocal(i, periodo = 14) {
  const vs = DATA.velas; let s = 0, n = 0;
  for (let k = Math.max(1, i - periodo + 1); k <= Math.min(i, vs.length - 1); k++) {
    s += Math.max(vs[k].h - vs[k].l, Math.abs(vs[k].h - vs[k-1].c), Math.abs(vs[k].l - vs[k-1].c)); n++;
  }
  return n ? s / n : 1;
}

// Imán de líneas: pega el punto al CUERPO (open/close), nunca a la mecha.
// Con pivote=true (primer punto) además corre la vela a la del extremo real del tramo.
function magnetCuerpo(i, p, conPivote) {
  if (!magnet) return { i, p };
  const vs = DATA.velas, v = vs[i];
  if (!v) return { i, p };
  const g = geom();
  const yp = g.yOf(p), yH = g.yOf(v.h), yL = g.yOf(v.l);
  if (yp < yH - 9 || yp > yL + 9) return { i, p };   // apuntando fuera de la vela: punto libre
  const bl = Math.min(v.o, v.c), bh = Math.max(v.o, v.c);
  const dBl = Math.abs(yp - g.yOf(bl)), dBh = Math.abs(yp - g.yOf(bh));
  const bajo = dBl <= dBh;
  let bar = i, nivel = bajo ? bl : bh;
  if (conPivote) {
    const base = nivel, tol = 0.35 * atrLocal(i);
    for (let j = Math.max(0, i - 4); j <= Math.min(vs.length - 1, i + 4); j++) {
      const c = vs[j];
      const q = bajo ? Math.min(c.o, c.c) : Math.max(c.o, c.c);
      if (Math.abs(q - base) > tol) continue;           // otro nivel: no es este pivote
      if (bajo ? q < nivel : q > nivel) { bar = j; nivel = q; }
    }
  }
  return { i: bar, p: nivel };
}

function rayoValido(i1, p1, i2, p2, velas) {
  return true;
}

function velasCruzadasDe(i1, p1, i2, p2, velas) {
  return 0;
}

function reanclarLineas() {
  if (!DATA || !DATA.velas) return;
  const vs = DATA.velas;
  for (const L of manualLines) {
    let fuera = false;
    if (L.t1 != null) {
      const idx = vs.findIndex(v => v.t === L.t1);
      if (idx >= 0) L.i1 = idx; else fuera = true;
    }
    if (L.t2 != null) {
      const idx = vs.findIndex(v => v.t === L.t2);
      if (idx >= 0) L.i2 = idx; else fuera = true;
    }
    L.fueraDeVentana = fuera;
  }
}

function draw(data) {
  DATA = data;
  reanclarLineas();
  if (viewCount === 0) defaultView();
  const g = geom();
  const { velas, pad, W, H, xOf, yOf, candleW, mn, mx } = g;
  ctx.clearRect(0,0,canvas.width,canvas.height);

  // grid
  if (gridOn) {
    ctx.strokeStyle = '#1a1f2b'; ctx.lineWidth = 1;
    for (let i=0;i<=6;i++){ const y = pad.t + i*H/6; ctx.beginPath(); ctx.moveTo(pad.l,y); ctx.lineTo(pad.l+W,y); ctx.stroke(); }
    for (let i=0;i<=8;i++){ const x = pad.l + i*W/8; ctx.beginPath(); ctx.moveTo(x,pad.t); ctx.lineTo(x,pad.t+H); ctx.stroke(); }
  }
  // axes labels
  ctx.fillStyle = '#888'; ctx.font = '10px system-ui';
  for (let i=0;i<=6;i++){ const p = mx - (mx-mn)*i/6; const y = pad.t + i*H/6; ctx.fillText(p.toFixed(4), 2, y+3); }
  // time labels
  const step = Math.max(1, Math.floor(viewCount/8));
  for (let vi=0; vi<viewCount; vi+=step) {
    const i = viewStart + vi;
    if (i >= velas.length) break;
    const v = velas[i];
    const x = xOf(i);
    const d = new Date(v.t);
    const lbl = d.toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit'}) + ' ' + d.toLocaleDateString('es',{day:'2-digit',month:'2-digit'});
    ctx.fillText(lbl, x-28, pad.t+H+14);
  }

  // candles
  for (let vi=0; vi<viewCount; vi++) {
    const i = viewStart + vi;
    if (i < 0 || i >= velas.length) continue;
    const v = velas[i]; const x = xOf(i);
    ctx.strokeStyle = v.c >= v.o ? '#26a69a' : '#ef5350';
    ctx.beginPath(); ctx.moveTo(x, yOf(v.h)); ctx.lineTo(x, yOf(v.l)); ctx.stroke();
    ctx.fillStyle = v.c >= v.o ? '#26a69a' : '#ef5350';
    const top = yOf(Math.max(v.o, v.c)); const bot = yOf(Math.min(v.o, v.c));
    ctx.fillRect(x - candleW/2, top, candleW, Math.max(1, bot - top));
  }

  // zonas horizontales RAPTOR (pivotes swing, fuerza 3) — se agrupan por
  // nivel (tolerancia 0.15 %) para no pintar miles de líneas solapadas.
  if (Array.isArray(DATA.zonas)) {
    const clusters = new Map();
    for (const z of DATA.zonas) {
      const from = Math.max(z.iDesde, viewStart);
      const to = Math.min(z.iHasta, viewStart + viewCount - 1);
      if (to < viewStart || from > viewStart + viewCount - 1) continue;
      const key = Math.round(z.precio / Math.max(1, z.precio * 0.0015));
      const prev = clusters.get(key);
      if (!prev || z.iHasta > prev.z.iHasta) clusters.set(key, { z, from, to });
    }
    const lista = Array.from(clusters.values()).slice(0, 40);
    for (const { z, from, to } of lista) {
      const y = yOf(z.precio);
      const xa = xOf(from), xb = xOf(to);
      ctx.strokeStyle = z.color || '#888';
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.45;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(xa, y); ctx.lineTo(xb, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  }

  // etiquetas de señal RAPTOR (1, 1R, 2, 2R, 2B, 2RB, 3, 3R, 3B, 3RB)
  if (Array.isArray(DATA.senales)) {
    ctx.font = 'bold 9px Consolas, monospace';
    for (const s of DATA.senales) {
      let idx = s.barIndex;
      if (!Number.isFinite(idx) && s.t != null) {
        const f = DATA.velas.findIndex((v) => v.t === s.t);
        if (f >= 0) idx = f;
      }
      if (!Number.isFinite(idx) || idx < viewStart || idx >= viewStart + viewCount) continue;
      const x = xOf(idx);
      const y = yOf(s.precio != null ? s.precio : DATA.velas[idx].c);
      const compra = (s.lado === 'COMPRA' || s.lado === 'alcista' || s.lado === 'bull' || s.lado === 'ALCISTA');
      const col = compra ? '#448aff' : '#ff5252';
      ctx.fillStyle = col;
      const txt = String(s.patron || '');
      const w = ctx.measureText(txt).width;
      ctx.fillRect(x - w/2 - 2, y - 14, w + 4, 13);
      ctx.fillStyle = '#fff';
      ctx.fillText(txt, x - w/2, y - 3);
    }
  }

  // auto fan
  if (LEGADO && autoOn) for (const r of getPatas()) {
    if (!r) continue;
    const idx0 = velas.findIndex(v => v.t === r.desde);
    if (idx0 < 0) continue;
    const iA = idx0;
    const m = r.pendiente;
    const iEnd = Math.min(velas.length-1, viewStart+viewCount-1);
    const x0 = xOf(iA), y0 = yOf(r.valorDesde);
    const x1 = xOf(iEnd), y1 = yOf(r.valorDesde + m*(iEnd - iA));
    ctx.strokeStyle = r.rota ? '#ff6b6b' : '#ffd166';
    ctx.lineWidth = r.rota ? 1.5 : 2;
    ctx.setLineDash(r.rota ? [6,4] : []);
    ctx.beginPath(); ctx.moveTo(x0,y0); ctx.lineTo(x1,y1); ctx.stroke();
    ctx.setLineDash([]);
    /* Etiqueta: lo que el motor sabe de ESTA raya, sin adornos. */
    if (x0 >= pad.l && x0 <= canvas.width - pad.r) {
      ctx.fillStyle = r.rota ? '#ff9e9e' : '#ffd166';
      ctx.font = '9px system-ui';
      const lado = r.tipo === 'alcista' ? 'soporte' : 'resistencia';
      const toq = (r.toquesTotales != null ? r.toquesTotales : (r.toques||0) + 2);
      const est = r.validada === false ? 'provisional' : 'validada';
      const texto = lado + ' · ' + toq + ' toques · ' + est;
      /* si la etiqueta se sale por la derecha, se dibuja hacia dentro */
      const w = ctx.measureText(texto).width;
      const lx = (x0 + 4 + w > pad.l + W) ? (pad.l + W - w - 2) : (x0 + 4);
      ctx.fillText(texto, lx, y0 - 4);
    }
    if (r.ruptura) {
      const ri = velas.findIndex(v => v.t === r.ruptura.t);
      if (ri >= 0 && ri >= viewStart && ri < viewStart+viewCount) { ctx.fillStyle='#ff6b6b'; ctx.beginPath(); ctx.arc(xOf(ri), yOf(velas[ri].c), 4, 0, Math.PI*2); ctx.fill(); }
    }
  }
  // línea de canal (paralela por el lado opuesto): sobre-extensión
  if (LEGADO && autoOn && DATA.canal) {
    const c = DATA.canal;
    const idx0 = velas.findIndex(v => v.t === c.desde);
    if (idx0 >= 0) {
      const iEnd = Math.min(velas.length-1, viewStart+viewCount-1);
      ctx.strokeStyle = 'rgba(0,188,212,0.85)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(xOf(idx0), yOf(c.valorDesde));
      ctx.lineTo(xOf(iEnd), yOf(c.valorDesde + c.pendiente*(iEnd - idx0)));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(0,188,212,0.95)'; ctx.font = '9px system-ui';
      ctx.fillText('canal', xOf(idx0) + 4, yOf(c.valorDesde) - 4);
    }
  }
  if (LEGADO && autoOn && getPatas().length && getPatas()[0]) {
    const r0 = getPatas()[0];
    const oIdx = velas.findIndex(v => v.t === r0.desde);
    if (oIdx >= 0 && oIdx >= viewStart && oIdx < viewStart+viewCount) { ctx.fillStyle='#ffd166'; ctx.beginPath(); ctx.arc(xOf(oIdx), yOf(r0.valorDesde), 5, 0, Math.PI*2); ctx.fill(); ctx.strokeStyle='#fff'; ctx.lineWidth=1; ctx.stroke(); }
  }

  // eventos del motor (cambio / engaño / toque): todo visible en la web
  const evs = LEGADO && Array.isArray(DATA.eventos) ? DATA.eventos : [];
  const ocupados = [];   // etiquetas ya puestas: se evita que se pisen
  for (const e of evs) {
    const i = e.iEv;
    if (i == null || i < viewStart || i >= viewStart + viewCount) continue;
    const x = xOf(i), y = yOf(velas[i].c);
    const col = e.clase === 'cambio' ? '#ff7043' : (e.clase === 'engano' ? '#ab47bc' : '#66bb6a');
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI*2); ctx.fill();
    ctx.font = 'bold 10px system-ui';
    const lbl = e.clase === 'cambio' ? 'CAMBIO' : (e.clase === 'engano' ? 'ENGAÑO' : 'TOQUE');
    let ly = y - 6;
    for (let k = 0; k < 8; k++) {
      if (ocupados.some(o => Math.abs(o.x - x) < 54 && Math.abs(o.y - ly) < 11)) ly -= 12;
      else break;
    }
    ocupados.push({ x: x, y: ly });
    ctx.fillText(lbl, x + 6, ly);
  }

  // marcaciones aprobadas del propietario (incluye los 2 engaños), para
  // compararlas a simple vista con la raya que dibuja el motor.
  const casos = LEGADO && Array.isArray(DATA.casos) ? DATA.casos : [];
  for (const c of casos) {
    const i1 = velas.findIndex(v => v.t === c.t1);
    const i2 = velas.findIndex(v => v.t === c.t2);
    if (i1 < 0 || i2 < 0) continue;
    if (Math.max(i1, i2) < viewStart || Math.min(i1, i2) >= viewStart + viewCount) continue;
    ctx.strokeStyle = '#4fc3f7'; ctx.lineWidth = 1.2; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(xOf(i1), yOf(c.p1)); ctx.lineTo(xOf(i2), yOf(c.p2)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#4fc3f7'; ctx.font = '9px system-ui';
    const iMid = Math.round((i1 + i2) / 2);
    const pMid = c.p1 + (c.p2 - c.p1) * ((iMid - i1) / Math.max(1, i2 - i1));
    ctx.fillText('marca ' + String(c.id).slice(-9), xOf(iMid) + 3, yOf(pMid) - 3);
  }

  // marcaciones manuales de REFERENCIA (azul sólido, etiqueta "ref"):
  // el propietario las guardó para compararlas con lo que dibuja el motor.
  const refsDibujo = LEGADO && Array.isArray(DATA.referencias) ? DATA.referencias : [];
  for (const c of refsDibujo) {
    const i1 = velas.findIndex(v => v.t === c.t1);
    const i2 = velas.findIndex(v => v.t === c.t2);
    if (i1 < 0 || i2 < 0) continue;
    if (Math.max(i1, i2) < viewStart || Math.min(i1, i2) >= viewStart + viewCount) continue;
    ctx.strokeStyle = '#2196f3'; ctx.lineWidth = 1.6; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(xOf(i1), yOf(c.p1)); ctx.lineTo(xOf(i2), yOf(c.p2)); ctx.stroke();
    ctx.fillStyle = '#2196f3'; ctx.font = 'bold 9px system-ui';
    const iMid = Math.round((i1 + i2) / 2);
    const pMid = c.p1 + (c.p2 - c.p1) * ((iMid - i1) / Math.max(1, i2 - i1));
    ctx.fillText('ref ' + String(c.id).split('-').pop(), xOf(iMid) + 3, yOf(pMid) - 3);
  }

  // ── BodyTrend (btb-core.js): nivel protegido, fan lines, pivotes, markers
  if (autoOn && DATA.bodyTrend) {
    const bt = DATA.bodyTrend;
    const colBull = '#ff5252';   // alcista
    const colBear = '#448aff';   // bajista
    const colBroken = '#78909c';
    const colWarn = '#ff9800';
    const isBull = (bt.tendencia === 1 || bt.tendencia === 'ALCISTA');
    const col = isBull ? colBull : colBear;

    /* POLÍTICA EN VIVO (btb-live.js): el lienzo solo lleva la trendline
       vigente y el nivel horizontal vigente. El abanico histórico, los
       pivotes y los marcadores de eventos ya NO se pintan: cada refresco
       reemplaza, no acumula. */
    const R = viewStart + viewCount - 1;
    /* Las líneas nacen en su ancla, que puede quedar fuera de la vista: al
       recortar a la izquierda hay que interpolar el precio en el borde. */
    const priceAt = (s, x) => (s.p1 === s.p2 ? s.p1
      : s.p1 + (s.p2 - s.p1) * (x - s.x1Bar) / ((s.x2Bar - s.x1Bar) || 1));
    const live = Array.isArray(bt.liveDrawList) ? bt.liveDrawList : [];

    for (const s of live) {
      const x1 = Math.max(s.x1Bar, viewStart);
      const x2 = Math.min(s.x2Bar, R);
      if (x2 < viewStart || x1 > R) continue;
      const px1 = xOf(x1), px2 = xOf(x2);
      const py1 = yOf(priceAt(s, x1)), py2 = yOf(priceAt(s, x2));
      let stroke = col;
      if (s.colorRole === 'level') stroke = s.role === 'S' ? colBull : colBear;
      else if (s.colorRole === 'warn') stroke = colWarn;
      else if (s.colorRole === 'bull') stroke = colBull;
      else if (s.colorRole === 'bear') stroke = colBear;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = s.width || 2;
      ctx.setLineDash(s.style === 'dash' ? [6, 4] : []);
      ctx.beginPath();
      ctx.moveTo(px1, py1); ctx.lineTo(px2, py2); ctx.stroke();
      ctx.setLineDash([]);
      /* El nivel vigente se extiende a la derecha hasta el último cierre. */
      if (s.kind === 'level' && s.active) {
        /* etiqueta a la izquierda: el borde derecho queda para la trendline */
        ctx.fillStyle = stroke;
        ctx.font = 'bold 10px system-ui';
        const ly = py1 - 5 > pad.t + 150 ? py1 - 5 : py1 + 14;
        ctx.fillText(s.label || '', pad.l + 6, ly);
      } else if (x1 > viewStart) {
        const tag = s.label || '';
        if (tag) {
          ctx.fillStyle = stroke; ctx.font = 'bold 9px system-ui';
          const w = ctx.measureText(tag).width;
          /* si el ancla queda pegada al borde derecho, la etiqueta se mete
             hacia dentro para que no se salga del lienzo. */
          const dentro = px1 + 4 + w > pad.l + W - 4;
          ctx.fillText(tag, dentro ? pad.l + W - 4 - w : px1 + 4, py1 - 5);
        }
      }
    }

    // aviso de ruptura de diagonal
    if (bt.warned) {
      ctx.fillStyle = colWarn;
      ctx.font = 'bold 10px system-ui';
      ctx.fillText('⚠ diagonal rota', pad.l + 4, pad.t + 32);
    }

    // panel del cerebro (BodyTrendBrain)
    if (bt.brain) {
      const b = bt.brain;
      const mode = b.ready ? 'ONLINE' : 'BASE';
      const tierStr = bt.lastTag || 'BASE';
      const panelLines = [
        'BodyTrendBrain v2 | ' + (isBull ? 'ALCISTA' : 'BAJISTA') + ' | ' + mode,
        'Tendencia: ' + (isBull ? 'ALCISTA' : 'BAJISTA') + ' | Modo: ' + mode,
        'Muestras: ' + b.samples + ' | Ultima p: ' + (typeof b.p === 'number' ? b.p.toFixed(2) : b.p),
        'Margen adaptativo x' + (typeof b.bufFactor === 'number' ? b.bufFactor.toFixed(2) : b.bufFactor) + ' | Nivel prot: ' + (typeof bt.protectedLevel === 'number' ? bt.protectedLevel.toFixed(2) : bt.protectedLevel),
        'Origen: ' + (typeof bt.originP === 'number' ? bt.originP.toFixed(2) : bt.originP) + ' | Tier: ' + tierStr,
        'Pivotes: ' + (Array.isArray(bt.pivots) ? bt.pivots.length : 0) + ' | Fan: ' + (Array.isArray(bt.fan) ? bt.fan.length : 0) + (bt.warned ? ' | ⚠' : ''),
        'En pantalla: ' + live.length + '/2' + (bt.liveSelfTest ? ' · política ' + (bt.liveSelfTest.max2 && bt.liveSelfTest.clip ? 'OK' : 'FAIL') : ''),
        'MTF: ' + (bt.mtf ? bt.mtf.label + ' (' + bt.mtf.match + '/' + bt.mtf.total + ')' : '—'),
        'SelfTest: ' + (bt.selfTest ? (bt.selfTest.deterministic && bt.selfTest.incrementalMatches && bt.selfTest.noBackProjection && bt.selfTest.bodyOnly && bt.selfTest.clipOk && bt.selfTest.votesCoherent ? 'OK' : 'FAIL') : '—'),
      ];
      ctx.font = '10px system-ui';
      let py = pad.t + 4;
      for (const line of panelLines) {
        ctx.fillStyle = 'rgba(0,0,0,.6)';
        ctx.fillRect(pad.l + 4, py, ctx.measureText(line).width + 14, 14);
        ctx.fillStyle = isBull ? '#ff5252' : '#448aff';
        ctx.fillText(line, pad.l + 11, py + 11);
        py += 16;
      }
    } else {
      const txt = 'BodyTrend ' + (isBull ? 'ALCISTA' : 'BAJISTA')
        + ' · pivotes ' + (Array.isArray(bt.pivots) ? bt.pivots.length : 0)
        + ' · fan ' + (Array.isArray(bt.fan) ? bt.fan.length : 0)
        + (bt.warned ? ' · ⚠' : '');
      ctx.font = '10px system-ui';
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(pad.l + 4, pad.t + 4, ctx.measureText(txt).width + 14, 16);
      ctx.fillStyle = isBull ? '#ff5252' : '#448aff';
      ctx.fillText(txt, pad.l + 11, pad.t + 16);
    }
  }

  // estado de la raya vigente del motor (legado)
  if (LEGADO && autoOn && DATA.raya) {
    const r = DATA.raya;
    const iNow = velas.length - 1;
    const aNow = atrLocal(Math.max(1, iNow), 14) || 1;
    const pendAtr = (r.pendiente || 0) / aNow;
    const d = new Date(r.desde);
    const txt = (r.tipo || '?').toUpperCase()
      + ' · ' + (getPatas().length || 1) + ' pata(s)'
      + ' · toques ' + (r.toques || 0)
      + ' · ' + (r.rota ? 'ROTA' : 'VIVA')
      + ' · pend ' + pendAtr.toFixed(3) + ' ATR/vela'
      + ' · inicio ' + d.toLocaleDateString('es', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
    ctx.font = '11px system-ui';
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fillRect(pad.l + 4, pad.t + 4, ctx.measureText(txt).width + 14, 18);
    ctx.fillStyle = r.rota ? '#ff8a80' : '#ffd166';
    ctx.fillText(txt, pad.l + 11, pad.t + 17);
  }

  if (false) { /* rayas UI desactivada */
  // manual objects
  manualLines.forEach((L, idx) => {
    if (L.visible === false) return;
    if (L.fueraDeVentana) return;
    const sel = idx === selected;
    const color = L.color || '#4fc3f7';
    ctx.strokeStyle = sel ? '#ff4081' : color;
    ctx.fillStyle = sel ? '#ff4081' : color;
    ctx.lineWidth = L.width || (sel ? 2.5 : 2);
    ctx.setLineDash(L.style === 'dash' ? [8,5] : (L.style === 'dot' ? [2,4] : []));

    if (L.type === 'horizontal') {
      const y = yOf(L.p1);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l+W, y); ctx.stroke();
      ctx.setLineDash([]);
      drawHandle(xOf(L.i1 ?? viewStart), y, sel);
      if (L.showAngle) drawLabel(xOf(L.i1 ?? viewStart)+6, y-6, 'H ' + L.p1.toFixed(4), color);
    } else if (L.type === 'vertical') {
      const x = xOf(L.i1);
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t+H); ctx.stroke();
      ctx.setLineDash([]);
      drawHandle(x, yOf(L.p1|| (mn+mx)/2), sel);
    } else if (L.type === 'rect') {
      const xa = xOf(Math.min(L.i1, L.i2)), xb = xOf(Math.max(L.i1, L.i2));
      const ya = yOf(Math.max(L.p1, L.p2)), yb = yOf(Math.min(L.p1, L.p2));
      const w = Math.max(1, xb - xa), h = Math.max(1, yb - ya);
      ctx.strokeRect(xa, ya, w, h);
      ctx.save(); ctx.globalAlpha = 0.10; ctx.fillRect(xa, ya, w, h); ctx.restore();
      drawHandle(xOf(L.i1), yOf(L.p1), sel);
      drawHandle(xOf(L.i2), yOf(L.p2), sel);
    } else if (L.type === 'cycle') {
      const interval = Math.max(1, Math.abs(L.i2 - L.i1));
      const start = Math.min(L.i1, L.i2);
      ctx.setLineDash([]);
      for (let i = start; i <= viewStart+viewCount; i += interval) {
        if (i < 0 || i >= velas.length) continue;
        if (i < viewStart || i > viewStart+viewCount) continue;
        const x = xOf(i);
        ctx.strokeStyle = sel ? '#ff4081' : color;
        ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t+H); ctx.stroke();
      }
      drawHandle(xOf(L.i1), yOf(L.p1), sel);
    } else if (L.type === 'channel') {
      drawTrendSegment(L, g, sel, color, false, L.extendLeft, L.extendRight);
      // parallel
      const dx = L.i2 - L.i1 || 1;
      const dy = L.p2 - L.p1;
      // offset in price stored as L.offset
      const off = L.offset || 0;
      const L2 = { i1:L.i1, p1:L.p1+off, i2:L.i2, p2:L.p2+off };
      drawTrendSegment(L2, g, sel, color, true, L.extendLeft, L.extendRight);
    } else {
      // trendline, ray, arrow, angle
      const extendR = L.type === 'ray' ? true : !!L.extendRight;
      const extendL = !!L.extendLeft;
      drawTrendSegment(L, g, sel, color, L.type === 'arrow', extendL, extendR);
    }
    ctx.setLineDash([]);

    // angle label
    if ((L.showAngle || L.type === 'angle') && L.type !== 'horizontal' && L.type !== 'vertical' && L.type !== 'cycle' && L.type !== 'channel') {
      const dx = L.i2 - L.i1;
      const dy = L.p2 - L.p1;
      const ang = Math.atan2(dy, dx) * 180 / Math.PI;
      const xm = xOf((L.i1+L.i2)/2), ym = yOf((L.p1+L.p2)/2);
      drawLabel(xm+6, ym-6, ang.toFixed(1) + '°', color);
    }
    // name label
    if (L.name) {
      const xm = (L.type==='horizontal') ? pad.l+4 : xOf((L.i1+L.i2)/2);
      const ym = (L.type==='horizontal') ? yOf(L.p1)-6 : yOf((L.p1+L.p2)/2)-6;
      drawLabel(xm, ym, L.name, color);
    }
  });

  // línea fantasma: solo se pinta, no es una línea manual
  if (fantasma) {
    ctx.strokeStyle = '#ffd166'; ctx.fillStyle = '#ffd166';
    ctx.lineWidth = 2; ctx.setLineDash([10,6]);
    ctx.beginPath();
    ctx.moveTo(xOf(fantasma.i1), yOf(fantasma.p1));
    ctx.lineTo(xOf(fantasma.i2), yOf(fantasma.p2));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '11px system-ui';
    ctx.fillText('sugerencia ' + Math.round((fantasma.confianza || 0) * 100) + '%', xOf(fantasma.i2) + 6, yOf(fantasma.p2) - 6);
  }

  // drawing in progress
  if (drawing) {
    ctx.strokeStyle = '#4fc3f7'; ctx.lineWidth = 2; ctx.setLineDash([5,4]);
    const x1 = xOf(drawing.p0.i), y1 = yOf(drawing.p0.p);
    const i2 = drawing.cur.i, p2 = drawing.cur.p;
    const x2 = xOf(i2), y2 = yOf(p2);
    if (drawing.tool === 'rect') {
      ctx.strokeRect(Math.min(x1,x2), Math.min(y1,y2), Math.abs(x2-x1), Math.abs(y2-y1));
    } else {
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
    }
    ctx.setLineDash([]);
    // live tooltip
    const db = i2 - drawing.p0.i;
    const dp = p2 - drawing.p0.p;
    const ang = Math.atan2(dp, db).toFixed(1);
    showTip(x2+10, y2-10, 'Δbarras: ' + db + '  Δprecio: ' + dp.toFixed(4) + (drawing.tool === 'rect' ? '' : '  ángulo: ' + ang + '°')
      + (drawing.armed ? '  · clic para cerrar' : ''));
  }

  // control points for selected
  if (selected >= 0) {
    const L = manualLines[selected];
    if (L && L.type !== 'cycle') {
      if (L.type === 'horizontal') {
        drawHandle(xOf(L.i1 ?? viewStart), yOf(L.p1), true, 'move');
      } else if (L.type === 'vertical') {
        drawHandle(xOf(L.i1), yOf(L.p1|| (mn+mx)/2), true, 'move');
      } else {
        drawHandle(xOf(L.i1), yOf(L.p1), true, 'a');
        drawHandle(xOf(L.i2), yOf(L.p2), true, 'b');
        const mx_ = (L.i1+L.i2)/2, my_ = (L.p1+L.p2)/2;
        drawHandle(xOf(mx_), yOf(my_), true, 'm', 'move');
      }
    }
  }

  }
  // crosshair
  if (crossOn && hovered >= 0) {
    const v = velas[hovered];
    if (v) {
      const x = xOf(hovered), y = yOf(v.c);
      ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1; ctx.setLineDash([3,3]);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l+W, y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t+H); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#fff'; ctx.font='10px system-ui';
      ctx.fillText(v.c.toFixed(4), pad.l+W+2, y+3);
      const d = new Date(v.t);
      ctx.fillText(d.toLocaleString('es'), x-40, pad.t-2);
    }
  }

  // status
  document.getElementById('stTool').textContent = toolName(tool);
  document.getElementById('stMag').textContent = magnet ? 'ON' : 'OFF';
  document.getElementById('stZoom').textContent = viewCount + ' barras';
  document.getElementById('stCursor').textContent = isFinite(cursorInfo.p) ? cursorInfo.i + ' / ' + cursorInfo.p.toFixed(4) : '—';
  document.getElementById('stSel').textContent = selected >= 0 ? (manualLines[selected].name || manualLines[selected].type || selected) : '—';
  document.getElementById('stCount').textContent = manualLines.length;
  /* El motor fecha el nacimiento de la tendencia por ÍNDICE de vela:
     aquí se traduce a fecha/hora de esa vela para leerlo de un vistazo. */
  function fmtInicio(v) {
    let t = null;
    if (typeof v === 'number') { const i = Math.round(v); if (velas[i]) t = velas[i].t; }
    else if (typeof v === 'string' || v instanceof Date) { const d = new Date(v); if (!isNaN(d)) t = d.getTime(); }
    if (t == null) return String(v);
    const d = new Date(t);
    return d.toLocaleDateString('es', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  }
  document.getElementById('info').innerHTML =
    '<span class="raya">' + (DATA.bodyTrend ? ('BTB ' + DATA.bodyTrend.trendStr + (DATA.bodyTrend.liveDrawList ? ' · en pantalla ' + DATA.bodyTrend.liveDrawList.length + '/2' : '')) : '—') + '</span>' +
    (DATA.bodyTrend ? ' · <span style="color:#8ce99a">nivel ' + (DATA.bodyTrend.protectedLevel != null ? Number(DATA.bodyTrend.protectedLevel).toFixed(2) : '—') + ' · pivotes ' + ((DATA.bodyTrend.pivots||[]).length) + '</span>' : '') +
    (DATA.bodyTrend && DATA.bodyTrend.liveSelfTest ? ' · política viva ' + (DATA.bodyTrend.liveSelfTest.max2 && DATA.bodyTrend.liveSelfTest.clip ? 'OK' : 'FAIL') : '') +
    ' · velas ' + velas.length + ' (vista ' + viewStart + '-' + (viewStart+viewCount-1) + ')' +
    ' · último cierre ' + (velas.length ? velas[velas.length-1].c : '—') +     ' · <span class="manual">manuales: ' + manualLines.length + (manualLines.some(L=>L.fueraDeVentana) ? (' (' + manualLines.filter(L=>L.fueraDeVentana).length + ' fuera de ventana)') : '') + '</span>';
  document.getElementById('msg').textContent = 'actualizado ' + new Date().toLocaleTimeString() + ' · ' + toolName(tool);
  updateObjList();
}

function drawTrendSegment(L, g, sel, color, arrow, extL, extR) {
  const { xOf, yOf, velas, W } = g;
  const padL = g.pad.l;
  const x1 = xOf(L.i1), y1 = yOf(L.p1);
  const x2 = xOf(L.i2), y2 = yOf(L.p2);
  let sx = x1, sy = y1, ex = x2, ey = y2;
  if (extL) {
    // extend to left edge
    const dx = x2-x1, dy = y2-y1;
    const t = (padL - x1)/ (dx||1);
    sx = padL; sy = y1 + dy*t;
  }
  if (extR) {
    const dx = x2-x1, dy = y2-y1;
    const t = (padL+W - x1)/ (dx||1);
    ex = padL+W; ey = y1 + dy*t;
  }
  ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(ex,ey); ctx.stroke();
  if (arrow) {
    // arrowhead at end
    const dx = ex-sx, dy = ey-sy;
    const ang = Math.atan2(dy,dx);
    const len = 10;
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - len*Math.cos(ang-0.4), ey - len*Math.sin(ang-0.4));
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex - len*Math.cos(ang+0.4), ey - len*Math.sin(ang+0.4));
    ctx.stroke();
  }
}

function drawHandle(x, y, sel, cursor) {
  ctx.fillStyle = sel ? '#ff4081' : '#4fc3f7';
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(x, y, sel ? 6 : 4, 0, Math.PI*2); ctx.fill(); ctx.stroke();
}

function drawLabel(x, y, text, color) {
  ctx.fillStyle = 'rgba(0,0,0,.6)';
  const w = ctx.measureText(text).width + 6;
  ctx.fillRect(x, y-11, w, 13);
  ctx.fillStyle = color || '#fff';
  ctx.font = '10px system-ui';
  ctx.fillText(text, x+3, y-1);
}

function showTip(x, y, text) {
  tip.style.display = 'block';
  tip.style.left = Math.min(x, canvas.width-200) + 'px';
  tip.style.top = Math.max(0, y) + 'px';
  tip.textContent = text;
}
function hideTip() { tip.style.display = 'none'; }

function toolName(t) {
  return { select:'Seleccionar', trend:'Tendencia', rect:'Rectángulo', delete:'Borrar' }[t] || t;
}

function setTool(t) {
  tool = t;
  const map = { select:'tSelect', trend:'tTrend', rect:'tRect', delete:'tDel' };
  Object.values(map).forEach(id => document.getElementById(id).classList.remove('activo'));
  if (map[t]) document.getElementById(map[t]).classList.add('activo');
  canvas.style.cursor = (t==='delete') ? 'not-allowed' : (t==='select' ? 'pointer' : 'crosshair');
  document.getElementById('stTool').textContent = toolName(t);
  if (drawing) { drawing = null; if (DATA) draw(DATA); }
}

function hitHandle(g, x, y) {
  if (selected < 0) return null;
  const L = manualLines[selected];
  if (!L) return null;    if (L.type === 'horizontal') {
      const hx = g.xOf(L.i1 ?? viewStart), hy = g.yOf(L.p1);
    if (Math.hypot(x-hx, y-hy) <= 8) return { line:selected, handle:'m' };
    return null;
  }
  if (L.type === 'vertical') {
    const hx = g.xOf(L.i1), hy = g.yOf(L.p1|| (g.mn+g.mx)/2);
    if (Math.hypot(x-hx, y-hy) <= 8) return { line:selected, handle:'m' };
    return null;
  }
  if (L.type === 'cycle') {
    const hx = g.xOf(L.i1), hy = g.yOf(L.p1);
    if (Math.hypot(x-hx, y-hy) <= 8) return { line:selected, handle:'a' };
    return null;
  }
  // trend-like
  const hx1 = g.xOf(L.i1), hy1 = g.yOf(L.p1);
  const hx2 = g.xOf(L.i2), hy2 = g.yOf(L.p2);
  if (Math.hypot(x-hx1, y-hy1) <= 8) return { line:selected, handle:'a' };
  if (Math.hypot(x-hx2, y-hy2) <= 8) return { line:selected, handle:'b' };
  const mx_ = (L.i1+L.i2)/2, my_ = (L.p1+L.p2)/2;
  const hmx = g.xOf(mx_), hmy = g.yOf(my_);
  if (Math.hypot(x-hmx, y-hmy) <= 8) return { line:selected, handle:'m' };
  return null;
}

function hitLine(g, x, y) {
  let best = -1, bestD = 7;
  manualLines.forEach((L, idx) => {
    if (L.visible === false) return;
    if (L.fueraDeVentana) return;
    if (L.locked) return;
    let d = Infinity;
    if (L.type === 'horizontal') {
      d = Math.abs(y - g.yOf(L.p1));
      if (Math.abs(x - g.xOf(L.i1||viewStart)) < 40) {} // whole row
    } else if (L.type === 'vertical') {
      d = Math.abs(x - g.xOf(L.i1));
    } else if (L.type === 'rect') {
      const xa = g.xOf(Math.min(L.i1,L.i2)), xb = g.xOf(Math.max(L.i1,L.i2));
      const ya = g.yOf(Math.max(L.p1,L.p2)), yb = g.yOf(Math.min(L.p1,L.p2));
      if (x >= xa-4 && x <= xb+4 && y >= ya-4 && y <= yb+4) d = 0;
    } else if (L.type === 'cycle') {
      // hit any vertical
      const interval = Math.max(1, Math.abs(L.i2 - L.i1));
      const start = Math.min(L.i1, L.i2);
      for (let i = start; i <= viewStart+viewCount; i += interval) {
        if (i < viewStart || i > viewStart+viewCount) continue;
        d = Math.min(d, Math.abs(x - g.xOf(i)));
      }
    } else {
      const x1=g.xOf(L.i1), y1=g.yOf(L.p1), x2=g.xOf(L.i2), y2=g.yOf(L.p2);
      const dx=x2-x1, dy=y2-y1;
      const len2 = dx*dx+dy*dy || 1;
      let t = ((x-x1)*dx + (y-y1)*dy)/len2;
      t = Math.max(0, Math.min(1, t));
      const px = x1 + t*dx, py = y1 + t*dy;
      d = Math.hypot(x-px, y-py);
    }
    if (d < bestD) { bestD = d; best = idx; }
  });
  return best;
}

function finalizarDibujo(mp) {
  if (!drawing) return;
  const t = drawing.tool;
  const p0 = drawing.p0;
  if (p0.i === mp.i && Math.abs(p0.p - mp.p) < 1e-12) { hideTip(); return; }
  let obj;
  if (t === 'rect') {
    obj = {
      id: uid(), type: 'rect',
      i1: Math.min(p0.i, mp.i), p1: Math.max(p0.p, mp.p),
      i2: Math.max(p0.i, mp.i), p2: Math.min(p0.p, mp.p),
      t1: DATA && DATA.velas ? DATA.velas[Math.min(p0.i, mp.i)].t : null,
      t2: DATA && DATA.velas ? DATA.velas[Math.max(p0.i, mp.i)].t : null,
      color: '#4fc3f7', width: 2, style: 'solid',
      extendLeft: false, extendRight: false, showAngle: false,
      locked: false, visible: true, name: ''
    };
  } else {
    obj = {
      id: uid(), type: 'trend',
      i1: p0.i, p1: p0.p, i2: mp.i, p2: mp.p,
      t1: DATA && DATA.velas ? DATA.velas[p0.i].t : null,
      t2: DATA && DATA.velas ? DATA.velas[mp.i].t : null,
      color: '#4fc3f7', width: 2, style: 'solid',
      extendLeft: false, extendRight: false, showAngle: false,
      locked: false, visible: true, name: ''
    };
    const A = atrLocal(obj.i1);
    const cruz = (DATA && DATA.velas) ? velasCruzadasDe(obj.i1, obj.p1, obj.i2, obj.p2, DATA.velas) : 0;
    const gemela = manualLines.find(L =>
      L.type === 'trend' && Math.abs(L.i1 - obj.i1) <= 8 && Math.abs(L.p1 - obj.p1) <= 0.35 * A);
    const partes = [];
    partes.push(cruz === 0 ? 'raya válida' : ('cruza ' + cruz + ' velas — inválida'));
    if (gemela) partes.push('mismo origen que ' + (gemela.name || gemela.id) + ' · ¿duplicada?');
    document.getElementById('stAviso').textContent = partes.join(' · ');
  }
  manualLines.push(obj);
  selected = manualLines.length - 1;
  commitChange();
  drawing = null;
  hideTip();
  if (DATA) draw(DATA);
}

canvas.addEventListener('mousedown', (e) => {
  if (!DATA) return;
  const g = geom();
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  // right click handled by contextmenu event
  if (e.button === 2) return;

  if (tool === 'delete') {
    const idx = hitLine(g, x, y);
    if (idx >= 0) { manualLines.splice(idx,1); selected=-1; commitChange(); }
    return;
  }

  // herramientas de marcación: primer clic fija, segundo clic cierra (o arrastre)
  const isDragTool = ['trend','rect'].includes(tool);
  if (isDragTool) {
    const primerPunto = !(drawing && drawing.armed && drawing.tool === tool);
    const mp = tool === 'trend' ? magnetCuerpo(g.iOf(x), g.pOf(y), primerPunto) : magnetPoint(g.iOf(x), g.pOf(y));
    if (drawing && drawing.armed && drawing.tool === tool) { finalizarDibujo(mp); return; }
    document.getElementById('stAviso').textContent = '—';
    drawing = { tool, p0: { i: mp.i, p: mp.p }, cur: { i: mp.i, p: mp.p }, x0:x, y0:y, armed: false };
    if (DATA) draw(DATA);
    return;
  }

  // select mode
  // handle hit first (if selected)
  const hh = hitHandle(g, x, y);
  if (hh) {
    selected = hh.line;
    dragging = { lineIdx: hh.line, handle: hh.handle, lastX: x, lastY: y };
    draw(DATA);
    return;
  }
  const idx = hitLine(g, x, y);
  if (idx >= 0) {
    selected = idx;
    dragging = { lineIdx: idx, handle: 'body', lastX: x, lastY: y, orig: deepClone(manualLines[idx]) };
    draw(DATA);
    return;
  }
  // background drag = pan
  selected = -1;
  panning = { startX: x, startView: viewStart };
  draw(DATA);
});

canvas.addEventListener('mousemove', (e) => {
  if (!DATA) return;
  const g = geom();
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  const i = g.iOf(x), p = g.pOf(y);
  cursorInfo = { i, p };
  hovered = i;

  if (drawing) {
    const mp = tool === 'trend' ? magnetCuerpo(i, p, false) : magnetPoint(i, p);
    drawing.cur = { i: mp.i, p: mp.p };
    if (tool === 'trend' && DATA && DATA.velas) {
      const cruz = velasCruzadasDe(drawing.p0.i, drawing.p0.p, mp.i, mp.p, DATA.velas);
      document.getElementById('stAviso').textContent = cruz === 0
        ? 'raya válida'
        : ('cruza ' + cruz + ' velas — inválida, coordinar origen');
    }
    draw(DATA);
    return;
  }
  if (dragging) {
    const L = manualLines[dragging.lineIdx];
    if (!L || L.locked) return;
    if (dragging.handle === 'a') {
      const mp = magnetPoint(g.iOf(x), g.pOf(y));
      L.i1 = mp.i; L.p1 = mp.p;
    } else if (dragging.handle === 'b') {
      const mp = magnetPoint(g.iOf(x), g.pOf(y));
      L.i2 = mp.i; L.p2 = mp.p;
    } else {
      // body or m: move whole object
      if (dragging.prevI === undefined) { dragging.prevI = g.iOf(dragging.lastX); dragging.prevP = g.pOf(dragging.lastY); }
      const di = g.iOf(x) - dragging.prevI;
      const dp = g.pOf(y) - dragging.prevP;
      if (di !== 0 || dp !== 0) {
        L.i1 += di; L.p1 += dp; L.i2 += di; L.p2 += dp;
        if (L.type === 'horizontal') { L.p2 = L.p1; L.i2 = L.i1; }
        if (L.type === 'vertical') { L.i2 = L.i1; L.p2 = L.p1; }
        dragging.prevI = g.iOf(x); dragging.prevP = g.pOf(y);
      }
    }
    dragging.lastX = x; dragging.lastY = y;
    const Ld = manualLines[dragging.lineIdx];
    if (Ld && DATA && DATA.velas) {
      if (Ld.t1 !== undefined && Ld.t1 !== null) Ld.t1 = DATA.velas[Ld.i1] ? DATA.velas[Ld.i1].t : Ld.t1;
      if (Ld.t2 !== undefined && Ld.t2 !== null) Ld.t2 = DATA.velas[Ld.i2] ? DATA.velas[Ld.i2].t : Ld.t2;
    }
    draw(DATA);
    return;
  }
  if (panning) {
    const bars = Math.round((panning.startX - x) / g.barStep);
    let ns = panning.startView + bars;
    ns = Math.max(0, Math.min(DATA.velas.length - viewCount, ns));
    if (ns !== viewStart) { viewStart = ns; draw(DATA); }
    return;
  }
  draw(DATA);
});

canvas.addEventListener('mouseup', (e) => {
  if (!DATA) return;
  if (drawing) {
    const g = geom();
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const mp = tool === 'trend' ? magnetCuerpo(g.iOf(x), g.pOf(y), false) : magnetPoint(g.iOf(x), g.pOf(y));
    if (drawing.armed) return; // el segundo clic se atiende en mousedown
    if (Math.hypot(x - drawing.x0, y - drawing.y0) < 4) {
      // clic sin arrastre: queda el primer punto fijado y se espera el segundo
      drawing.armed = true;
      showTip(x + 12, y - 12, 'primer punto fijado · clic en el segundo');
      if (DATA) draw(DATA);
      return;
    }
    finalizarDibujo(mp);
    return;
  }
  if (dragging) {
    commitChange();
    dragging = null;
  }
  if (panning) {
    panning = null;
  }
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (!DATA) return;
  const g = geom();
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const factor = e.deltaY > 0 ? 1.15 : 0.85;
  const oldCount = viewCount;
  let newCount = Math.round(viewCount * factor);
  newCount = Math.max(80, Math.min(DATA.velas.length, newCount));
  if (newCount === viewCount) return;
  const centerBar = viewStart + (x - pad.l) / g.barStep - 0.5;
  viewCount = newCount;
  viewStart = Math.round(centerBar - (x - pad.l) / ( (canvas.width-pad.l-pad.r)/viewCount ) + 0.5);
  viewStart = Math.max(0, Math.min(DATA.velas.length - viewCount, viewStart));
  if (DATA) draw(DATA);
}, { passive: false });

canvas.addEventListener('mouseleave', () => { hovered = -1; hideTip(); if (DATA) draw(DATA); });

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (!DATA) return;
  const g = geom();
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  const menu = document.getElementById('ctxMenu');
  // find target
  let targetIdx = hitLine(g, x, y);
  // handle hit overrides
  const hh = (selected>=0) ? hitHandle(g,x,y) : null;
  if (hh) targetIdx = hh.line;
  let html = '';
  if (targetIdx >= 0) {
    const L = manualLines[targetIdx];
    selected = targetIdx;
    html += '<div class="item" data-a="props">Propiedades…</div>';
    html += '<div class="item" data-a="dup">Duplicar</div>';
    html += '<div class="item" data-a="front">Traer al frente</div>';
    html += '<div class="item" data-a="back">Enviar atrás</div>';
    html += '<div class="sep"></div>';
    html += '<div class="item" data-a="lock">' + (L.locked ? 'Desbloquear' : 'Bloquear') + '</div>';
    html += '<div class="item" data-a="vis">' + (L.visible===false ? 'Mostrar' : 'Ocultar') + '</div>';
    html += '<div class="item" data-a="del">Eliminar</div>';
  } else {
    html += '<div class="item" data-a="fit">Ajustar vista</div>';
    html += '<div class="item" data-a="clear">Borrar todas</div>';
  }
  menu.innerHTML = html;
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  menu.classList.add('show');
  menu.querySelectorAll('.item').forEach(it => {
    it.addEventListener('click', () => {
      const a = it.getAttribute('data-a');
      handleCtx(a, targetIdx);
      menu.classList.remove('show');
    });
  });
});

document.addEventListener('click', (e) => {
  const menu = document.getElementById('ctxMenu');
  if (!menu.contains(e.target)) menu.classList.remove('show');
});

function handleCtx(a, idx) {
  if (a === 'props') { openProps(idx); return; }
  if (a === 'del') { if (idx>=0) { manualLines.splice(idx,1); selected=-1; commitChange(); } return; }
  if (a === 'dup') {
    if (idx>=0) {
      const c = deepClone(manualLines[idx]); c.id = uid(); c.name = (c.name||'') + ' (copia)';
      // offset slightly
      c.i1 += 2; c.i2 += 2; c.p1 += 0; 
      manualLines.push(c); selected = manualLines.length-1; commitChange();
    }
    return;
  }
  if (a === 'front') { if (idx>=0) { const o = manualLines.splice(idx,1)[0]; manualLines.push(o); selected=manualLines.length-1; commitChange(); } return; }
  if (a === 'back') { if (idx>=0) { const o = manualLines.splice(idx,1)[0]; manualLines.unshift(o); selected=0; commitChange(); } return; }
  if (a === 'lock') { if (idx>=0) { manualLines[idx].locked = !manualLines[idx].locked; commitChange(); } return; }
  if (a === 'vis') { if (idx>=0) { manualLines[idx].visible = manualLines[idx].visible === false ? true : false; commitChange(); } return; }
  if (a === 'fit') { defaultView(); if (DATA) draw(DATA); return; }
  if (a === 'clear') { if (confirm('¿Borrar todas las líneas manuales?')) { manualLines=[]; selected=-1; commitChange(); } return; }
}

function openProps(idx) {
  if (idx < 0) idx = selected;
  if (idx < 0) return;
  selected = idx;
  const L = manualLines[idx];
  document.getElementById('pName').value = L.name || '';
  document.getElementById('pType').value = L.type;
  document.getElementById('pColor').value = L.color || '#4fc3f7';
  document.getElementById('pWidth').value = L.width || 2;
  document.getElementById('pStyle').value = L.style || 'solid';
  document.getElementById('pExtL').checked = !!L.extendLeft;
  document.getElementById('pExtR').checked = !!L.extendRight;
  document.getElementById('pAngle').checked = !!L.showAngle;
  document.getElementById('pLock').checked = !!L.locked;
  document.getElementById('pVis').checked = L.visible !== false;
  document.getElementById('propsModal').classList.add('show');
  document.getElementById('pDel').onclick = () => { manualLines.splice(idx,1); selected=-1; closeProps(); commitChange(); };
  document.getElementById('pCancel').onclick = closeProps;
  document.getElementById('pApply').onclick = () => {
    const L = manualLines[idx];
    L.name = document.getElementById('pName').value;
    L.color = document.getElementById('pColor').value;
    L.width = Number(document.getElementById('pWidth').value) || 2;
    L.style = document.getElementById('pStyle').value;
    L.extendLeft = document.getElementById('pExtL').checked;
    L.extendRight = document.getElementById('pExtR').checked;
    L.showAngle = document.getElementById('pAngle').checked;
    L.locked = document.getElementById('pLock').checked;
    L.visible = document.getElementById('pVis').checked;
    closeProps(); commitChange();
  };
}
function closeProps() { document.getElementById('propsModal').classList.remove('show'); }

document.addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
  if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
  if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (selected >= 0) { manualLines.splice(selected,1); selected=-1; commitChange(); }
    return;
  }
  if (e.key === 'Escape') { drawing = null; selected = -1; hideTip(); if (DATA) draw(DATA); return; }
  const k = e.key.toLowerCase();
  if (k === 'v' || e.key === 'Escape') setTool('select');
  else if (k === 't') setTool('trend');
  else if (k === 'r') setTool('rect');
  else if (k === 'd') setTool('delete');
  else if (k === 'm') { magnet = !magnet; document.getElementById('btnMag').classList.toggle('on', magnet); document.getElementById('btnMag').textContent = 'Imán: ' + (magnet?'ON':'OFF'); if (DATA) draw(DATA); }
  else if (k === 'g') { gridOn = !gridOn; document.getElementById('btnGrid').classList.toggle('on', gridOn); document.getElementById('btnGrid').textContent = 'Grid: ' + (gridOn?'ON':'OFF'); if (DATA) draw(DATA); }
  else if (k === 'x') { crossOn = !crossOn; document.getElementById('btnCross').classList.toggle('on', crossOn); document.getElementById('btnCross').textContent = 'Mira: ' + (crossOn?'ON':'OFF'); if (DATA) draw(DATA); }
  else if (e.key === '+' || e.key === '=') { /* zoom in */ const g=geom(); /* noop placeholder */ }
});

/* ---------- panel del escáner (solo contexto, no avisa) ---------- */
async function cargarEscaner() {
  const cont = document.getElementById('scanRows');
  if (!cont) return;
  const sim = document.getElementById('sim').value;
  const tok = new URL(location.href).searchParams.get('token') || '';
  try {
    const r = await fetch('/escaner?simbodo=' + encodeURIComponent(sim) + (tok ? '&token=' + encodeURIComponent(tok) : ''));
    if (!r.ok) {
      let why = 'escáner sin datos (' + r.status + ')';
      try { const j = await r.json(); if (j && j.error) why = j.error; } catch (e) {}
      cont.textContent = why;
      return;
    }
    const j = await r.json();
    const color = (e) => e === 'TENDENCIA' ? '#26a69a' : (e === 'DEBIL' ? '#ffd166' : (e === 'AGOTAMIENTO' ? '#ff8a65' : '#888'));
    const flecha = (d) => d === 'alcista' ? '▲' : (d === 'bajista' ? '▼' : '·');
    cont.innerHTML = ['H1', 'M15', 'M5', 'M1'].map((tf) => {
      const s = j.series ? j.series[tf] : null;
      if (!s) return '<div class="row"><b>' + tf + '</b><span>—</span></div>';
      return '<div class="row"><b>' + tf + '</b><span style="color:' + color(s.estado) + '">'
        + s.estado + ' ' + flecha(s.direccion) + '</span><i>' + Math.round(s.fuerza * 100) + '</i></div>';
    }).join('');
    const m = j.matriz || {};
    document.getElementById('scanSesgo').textContent = (m.sesgo || 'sin datos') + ' · ' + (m.alineacion || 0) + '/4';
  } catch (e) {
    cont.textContent = 'escáner no disponible';
  }
}

/* ---------- panel RAPTOR: TF | señal | dirección (velas) ---------- */
async function cargarScanRaptor() {
  const cont = document.getElementById('scanRaptorRows');
  if (!cont) return;
  const sim = document.getElementById('sim').value;
  const tok = new URL(location.href).searchParams.get('token') || '';
  const tfs = ['H1', 'M15', 'M5', 'M1'];
  const filas = await Promise.all(tfs.map(async (tf) => {
    try {
      const r = await fetch('/velas?simbodo=' + encodeURIComponent(sim) + '&tf=' + encodeURIComponent(tf) + (tok ? '&token=' + encodeURIComponent(tok) : ''));
      if (!r.ok) return { tf, senal: '—', velas: '—' };
      const j = await r.json();
      const senales = Array.isArray(j.senales) ? j.senales : [];
      const ult = senales.length ? senales[senales.length - 1] : null;
      if (!ult) return { tf, senal: '—', velas: '—' };
      const n = Array.isArray(j.velas) ? j.velas.length : 0;
      const bars = (n && Number.isFinite(ult.barIndex)) ? Math.max(0, n - 1 - ult.barIndex) : '—';
      return { tf, senal: ult.patron || '—', velas: bars, lado: ult.lado || '' };
    } catch (e) {
      return { tf, senal: '—', velas: '—' };
    }
  }));
  cont.innerHTML = filas.map((f) => {
    const col = f.lado === 'alcista' || f.lado === 'bull' || f.lado === 'ALCISTA' ? '#ff5252' : (f.lado ? '#448aff' : '#888');
    return '<div class="row"><b>' + f.tf + '</b><span style="color:' + col + '">' + f.senal + '</span><i>' + f.velas + '</i></div>';
  }).join('');
}

function tokHeader() {
  const tok = new URL(location.href).searchParams.get('token') || '';
  return tok ? { 'x-estado-token': tok } : {};
}

/* ---------- memoria: guardar la línea seleccionada ---------- */
async function guardarEnMemoria() {
  const msg = document.getElementById('msg');
  if (!DATA) { msg.textContent = 'sin datos que guardar'; return; }
  if (selected < 0) { msg.textContent = 'selecciona una línea primero'; return; }
  const sim = document.getElementById('sim').value;
  const tf = document.getElementById('tf').value;
  const L = manualLines[selected];
  msg.textContent = 'guardando...';
  let r, j = null;
  try {
    r = await fetch('/marcas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...tokHeader() },
      body: JSON.stringify({
        simbolo: sim, tf, linea: L, nota: L.name || '',
        estado: ultimaSugerencia && ultimaSugerencia.aceptada ? 'aprobado' : 'borrador',
        sugerencia: ultimaSugerencia || null
      })
    });
    j = await r.json();
  } catch (e) {
    msg.textContent = 'no guardado: sin conexión con el servidor';
    return;
  }    if (r.ok && j && j.ok) {
    ultimoCasoId = j.caso.id;
    const valida = !j.caso.geometria || j.caso.geometria.valida !== false;
    msg.textContent = 'guardado: ' + j.caso.id
      + (valida ? '' : ' · raya INVÁLIDA (cruza ' + (j.caso.geometria.velasCruzadas || 0) + ' velas)')
      + (j.caso.etiqueta.estado === 'aprobado' ? ' (aprobado)' : ' · apruébalo para que cuente');
    ultimaSugerencia = null;
  } else {
    msg.textContent = 'no guardado: ' + ((j && j.error) || r.status);
  }
}

async function sugerirDesdeSeleccion() {
  const msg = document.getElementById('msg');
  if (!DATA) { msg.textContent = 'sin datos'; return; }
  if (selected < 0) { msg.textContent = 'selecciona una línea primero'; return; }
  msg.textContent = 'buscando casos parecidos...';
  try {
    const r = await fetch('/sugerencias', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...tokHeader() },
      body: JSON.stringify({ simbolo: document.getElementById('sim').value, tf: document.getElementById('tf').value, linea: manualLines[selected] })
    });
    const j = await r.json();
    if (!r.ok || !j.ok) {
      fantasma = null; msg.textContent = 'sin sugerencia: ' + ((j && j.error) || r.status);
      if (DATA) draw(DATA);
      return;
    }
    fantasma = j.hay ? j.fantasma : null;
    ultimaSugerencia = { vecinos: (j.vecinos || []).map((v) => v.id), confianza: j.confianza, motivo: j.motivo };
    msg.textContent = j.hay
      ? 'sugerencia ' + Math.round(j.confianza * 100) + '% · ' + (j.explicacion || '')
      : 'sin sugerencia: ' + (j.motivo || 'confianza baja');
    if (DATA) draw(DATA);
  } catch (e) {
    msg.textContent = 'sin conexión con el servidor';
  }
}

function aceptarSugerencia() {
  const msg = document.getElementById('msg');
  if (!fantasma) { msg.textContent = 'no hay sugerencia que aceptar'; return; }
  if (selected < 0) { msg.textContent = 'selecciona la línea'; return; }
  const L = manualLines[selected];
  L.i2 = fantasma.i2;
  L.p2 = fantasma.p2;
  fantasma = null;
  ultimaSugerencia = { ...(ultimaSugerencia || {}), aceptada: true };
  commitChange();
  msg.textContent = 'sugerencia aceptada · guárdala para aprender';
}

async function etiquetar(estado) {
  const msg = document.getElementById('msg');
  if (!ultimoCasoId) { msg.textContent = 'no hay un caso recién guardado'; return; }
  try {
    const r = await fetch('/casos/' + encodeURIComponent(ultimoCasoId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...tokHeader() },
      body: JSON.stringify({ estado })
    });
    const j = await r.json();
    msg.textContent = r.ok ? 'caso ' + ultimoCasoId + ' → ' + estado : 'no etiquetado: ' + ((j && j.error) || r.status);
  } catch (e) {
    msg.textContent = 'sin conexión con el servidor';
  }
}

// wire toolbar
function bind(id, fn) { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); }
bind('tSelect', () => setTool('select'));
bind('tTrend', () => setTool('trend'));
bind('tRect', () => setTool('rect'));
bind('tDel', () => setTool('delete'));
bind('btnUndo', undo);
bind('btnRedo', redo);
bind('btnClear', () => { if (confirm('¿Borrar todas las líneas manuales?')) { manualLines=[]; selected=-1; commitChange(); } });
bind('btnList', () => {
  const sb = document.getElementById('sidebar');
  sb.style.display = sb.style.display === 'none' ? 'block' : 'none';
});
bind('btnProps', () => openProps(selected));
bind('btnMem', guardarEnMemoria);
bind('btnSug', sugerirDesdeSeleccion);
bind('btnAcep', aceptarSugerencia);
bind('btnApr', () => etiquetar('aprobado'));
bind('btnRech', () => etiquetar('rechazado'));
bind('btnExport', () => {
  const blob = new Blob([JSON.stringify(manualLines, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'lineas-manuales.json'; a.click(); URL.revokeObjectURL(url);
});
bind('btnImport', () => {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json';
  inp.onchange = () => {
    const f = inp.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => { try { const arr = JSON.parse(r.result); if (Array.isArray(arr)) { manualLines = arr; manualLines.forEach(L=>{if(!L.id)L.id=uid();}); selected=-1; commitChange(); } } catch(e){ alert('JSON inválido'); } };
    r.readAsText(f);
  };
  inp.click();
});
bind('btnMag', () => { magnet = !magnet; document.getElementById('btnMag').classList.toggle('on', magnet); document.getElementById('btnMag').textContent = 'Imán: ' + (magnet?'ON':'OFF'); if (DATA) draw(DATA); });
bind('btnGrid', () => { gridOn = !gridOn; document.getElementById('btnGrid').classList.toggle('on', gridOn); document.getElementById('btnGrid').textContent = 'Grid: ' + (gridOn?'ON':'OFF'); if (DATA) draw(DATA); });
bind('btnAuto', () => { autoOn = !autoOn; document.getElementById('btnAuto').classList.toggle('on', autoOn); document.getElementById('btnAuto').textContent = 'Auto: ' + (autoOn?'ON':'OFF'); if (DATA) draw(DATA); });
bind('btnCross', () => { crossOn = !crossOn; document.getElementById('btnCross').classList.toggle('on', crossOn); document.getElementById('btnCross').textContent = 'Mira: ' + (crossOn?'ON':'OFF'); if (DATA) draw(DATA); });
bind('btnZoomIn', () => { if (!DATA) return; const g=geom(); const x=canvas.width/2; const factor=0.8;  let nc=Math.round(viewCount*factor); nc=Math.max(80,Math.min(DATA.velas.length,nc)); if(nc===viewCount)return; const centerBar=viewStart+(x-pad.l)/g.barStep-0.5; viewCount=nc; viewStart=Math.round(centerBar-(x-pad.l)/((canvas.width-pad.l-pad.r)/viewCount)+0.5); viewStart=Math.max(0,Math.min(DATA.velas.length-viewCount,viewStart)); if(DATA)draw(DATA); });
bind('btnZoomOut', () => { if (!DATA) return; const g=geom(); const x=canvas.width/2; const factor=1.25;  let nc=Math.round(viewCount*factor); nc=Math.max(80,Math.min(DATA.velas.length,nc)); if(nc===viewCount)return; const centerBar=viewStart+(x-pad.l)/g.barStep-0.5; viewCount=nc; viewStart=Math.round(centerBar-(x-pad.l)/((canvas.width-pad.l-pad.r)/viewCount)+0.5); viewStart=Math.max(0,Math.min(DATA.velas.length-viewCount,viewStart)); if(DATA)draw(DATA); });
bind('btnFit', () => { if (!DATA) return; viewCount = DATA.velas.length; viewStart = 0; viewInit = true; if (DATA) draw(DATA); });
bind('ref', async () => { const d = await fetchVelas(); if (d) draw(d); });
bind('btnMem', guardarEnMemoria);

/* el panel se refresca solo; no bloquea la gráfica si el endpoint falla */
cargarEscaner();
setInterval(cargarEscaner, 30000);
cargarScanRaptor();
setInterval(cargarScanRaptor, 30000);
const selSim = document.getElementById('sim');
if (selSim) selSim.addEventListener('change', cargarEscaner);
const selTf = document.getElementById('tf');
if (selTf) selTf.addEventListener('change', cargarEscaner);
if (selSim) selSim.addEventListener('change', cargarScanRaptor);
if (selTf) selTf.addEventListener('change', cargarScanRaptor);

function updateObjList() {
  const list = document.getElementById('objList');
  const cnt = document.getElementById('objCount');
  if (!list) return;
  cnt.textContent = manualLines.length;
  list.innerHTML = manualLines.map((L, idx) => {
    const sel = idx === selected;
    return '<div class="objrow ' + (sel?'sel':'') + '">' +
      '<span style="color:' + (L.color||'#4fc3f7') + '">■</span> ' +
      '<span style="flex:1;cursor:pointer" data-idx="' + idx + '">' + (L.name || L.type) + (L.locked?' 🔒':'') + (L.visible===false?' 👁‍🗨':'') + '</span>' +
      '<button data-act="sel" data-idx="' + idx + '">Sel</button>' +
      '<button data-act="del" data-idx="' + idx + '">✕</button>' +
      '</div>';
  }).join('');
  list.querySelectorAll('[data-act="sel"]').forEach(b => b.addEventListener('click', () => { selected = Number(b.getAttribute('data-idx')); if (DATA) draw(DATA); }));
  list.querySelectorAll('[data-act="del"]').forEach(b => b.addEventListener('click', () => { const i = Number(b.getAttribute('data-idx')); manualLines.splice(i,1); selected=-1; commitChange(); }));
  list.querySelectorAll('span[data-idx]').forEach(s => s.addEventListener('click', () => { selected = Number(s.getAttribute('data-idx')); if (DATA) draw(DATA); }));
}

document.getElementById('sim').addEventListener('change', () => { pintarConteoTf(); elegirTfConDatos(); loadLines(); refrescar(); });
document.getElementById('tf').addEventListener('change', () => { loadLines(); refrescar(); });

async function refrescar() {
  const data = await fetchVelas();
  if (data) {
    DATA = data;
    if (!viewInit) { defaultView(); viewInit = true; }
    else if (viewStart + viewCount > data.velas.length) { viewStart = Math.max(0, data.velas.length - viewCount); }
    draw(data);
  }
  cargarScanRaptor();
}

/* El motor no tiene velas en todos los TF: /estado dice cuántas hay por
   símbolo y TF. La página usa ese dato tal cual, sin suponer nada. */
function velasDe(sim, tf) {
  const s = window._estado && window._estado.simbolos && window._estado.simbolos[sim];
  return (s && s.velas && Number(s.velas[tf])) || 0;
}
function pintarConteoTf() {
  const sim = document.getElementById('sim').value;
  const sel = document.getElementById('tf');
  if (!window._estado) return;
  for (const o of sel.options) {
    /* el TF va en el atributo value: si solo estuviera en el texto, el
       select enviaría "M5 (8589)" y el motor devolvería 404 */
    const tf = String(o.value || o.textContent || '').split(/[\s(]/)[0];
    if (!tf) continue;
    o.value = tf;
    o.textContent = tf + ' (' + velasDe(sim, tf) + ')';
  }
}
function elegirTfConDatos() {
  const sim = document.getElementById('sim').value;
  const sel = document.getElementById('tf');
  if (velasDe(sim, sel.value) > 0) return false;
  let mejor = null, max = 0;
  for (const o of sel.options) { const n = velasDe(sim, o.value); if (n > max) { max = n; mejor = o.value; } }
  if (!mejor) return false;
  sel.value = mejor;
  return true;
}

async function initSim() {
  const qp = new URLSearchParams(location.search);
  const wantTf = (qp.get('tf') || '').toUpperCase();
  const wantSim = qp.get('simbodo') || '';
  if (wantTf) {
    const t = document.getElementById('tf');
    if ([...t.options].some(o => o.value === wantTf)) t.value = wantTf;
  }
  try {
    const r = await fetch('/estado');
    const j = await r.json();
    window._estado = j;
    const sel = document.getElementById('sim');
    const fromEstado = (j['simbolos'] && typeof j['simbolos'] === 'object') ? Object.keys(j['simbolos']) : [];
    const final = fromEstado.length ? fromEstado : ['FX Vol 20','FX Vol 40','SFX Vol 20','SFX Vol 40'];
    /* El símbolo llega de /estado: se escapa antes de meterlo en HTML. */
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    sel.innerHTML = final.map(s => '<option>' + esc(s) + '</option>').join('');
  } catch (e) {
    document.getElementById('sim').innerHTML = '<option>FX Vol 20</option><option>FX Vol 40</option><option>SFX Vol 20</option><option>SFX Vol 40</option>';
  }
  if (wantSim) {
    const sel = document.getElementById('sim');
    if ([...sel.options].some(o => o.textContent === wantSim)) sel.value = wantSim;
  }
  pintarConteoTf();
  /* El panel necesita el símbolo ya elegido: se refresca al terminar de cargar. */
  cargarEscaner();
  /* TF pedido por URL o por defecto: si el motor no tiene velas ahí, se abre
     en el que sí las tiene, para no quedarse mirando una gráfica vacía. */
  elegirTfConDatos();
  loadLines();
  refrescar();
  if (window._timer) clearInterval(window._timer);
  window._timer = setInterval(refrescar, 5000);
}
initSim();
</script></body></html>`;

/* Cuerpo JSON con límite de tamaño: nada de buffers sin tope. */
function _leerCuerpo(req, limite = 64 * 1024) {
  return new Promise((resolver, rechazar) => {
    let bytes = 0;
    const trozos = [];
    req.on('data', (trozo) => {
      bytes += trozo.length;
      if (bytes > limite) {
        /* pause() en vez de destroy(): el 413 llega al cliente y la conexión
           se cierra limpia con Connection: close (destroy cortaba el socket
           antes de que la respuesta saliera). */
        req.pause();
        rechazar(Object.assign(new Error('cuerpo demasiado grande'), { codigo: 413 }));
        return;
      }
      trozos.push(trozo);
    });
    req.on('end', () => {
      try {
        resolver(trozos.length ? JSON.parse(Buffer.concat(trozos).toString('utf8')) : {});
      } catch (e) {
        rechazar(Object.assign(new Error('JSON inválido'), { codigo: 400 }));
      }
    });
    req.on('error', (e) => rechazar(Object.assign(e, { codigo: 400 })));
  });
}

function crearServidor(getEstado, port = Number(process.env.PORT || 3000), getVelas = null, opciones = {}) {
  const mem = opciones.memoria || memoria;
  /* el escáner se compila una vez al arrancar, no en el primer /escaner */
  if (typeof getVelas === 'function') escaner.calentar();
  if (!ESTADO_TOKEN) {
    console.log('[servidor] AVISO: ESTADO_TOKEN no definido — /estado queda SIN autenticación (solo seguro en localhost).');
  }
  /* Sin ESTADO_TOKEN el servidor escucha SOLO en loopback. */
  const HOST = process.env.MS_HOST || (ESTADO_TOKEN || process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const ruta = url.pathname;
    const q = url.searchParams;
    try {
      if (!_hostPermitido(req.headers.host)) {
        return _json(res, 403, { ok: false, error: 'Host no permitido' });
      }
      if (_rateExcedido(req.socket.remoteAddress)) {
        res.setHeader('Retry-After', String(Math.ceil(MS_RATE_VENTANA_MS / 1000)));
        return _json(res, 429, { ok: false, error: 'demasiadas peticiones' });
      }
      /* Los navegadores piden /favicon.ico solos; 204 evita el 404 inútil. */
      if (req.method === 'GET' && ruta === '/favicon.ico') {
        res.writeHead(204, CABECERAS);
        return res.end();
      }
      if (ESTADO_TOKEN && ruta !== '/salud') {
        const dado = req.headers['x-estado-token'] || q.get('token') || '';
        if (!_tokenValido(dado, ESTADO_TOKEN)) return _json(res, 401, { ok: false, error: 'token ausente o incorrecto (ESTADO_TOKEN)' });
      }
      if (req.method === 'GET' && ruta === '/salud') {
        res.writeHead(200, { ...CABECERAS, 'Content-Type': 'text/plain' });
        return res.end('ok\n');
      }
      if (req.method === 'GET' && ruta === '/estado') return _json(res, 200, getEstado());

      if (req.method === 'GET' && ruta === '/velas') {
        const simbodo = q.get('simbodo') || '';
        const tf = (q.get('tf') || '').toUpperCase();
        if (!simbodo || !tf) return _json(res, 400, { ok: false, error: 'falta simbodo o tf' });
        const data = (typeof getVelas === 'function') ? getVelas(simbodo, tf) : null;
        if (!data) return _json(res, 404, { ok: false, error: 'sin datos para ' + simbodo + ' ' + tf });
        return _json(res, 200, data);
      }

      if (req.method === 'POST' && ruta === '/marcas') {
        const cuerpo = await _leerCuerpo(req);
        const simbodo = typeof cuerpo.simbolo === 'string' ? cuerpo.simbolo.trim() : '';
        const tf = typeof cuerpo.tf === 'string' ? cuerpo.tf.toUpperCase() : '';
        const linea = cuerpo.linea && typeof cuerpo.linea === 'object' ? cuerpo.linea : null;
        if (!simbodo || !tf || !linea) {
          return _json(res, 400, { ok: false, error: 'faltan simbolo, tf o linea' });
        }
        const datos = (typeof getVelas === 'function') ? getVelas(simbodo, tf) : null;
        if (!datos || !Array.isArray(datos.velas) || !datos.velas.length) {
          return _json(res, 409, { ok: false, error: 'sin velas para ' + simbodo + ' ' + tf });
        }
        let caso;
        try {
          caso = mem.crear({ simbolo: simbodo, tf, linea, velas: datos.velas, nota: cuerpo.nota });
          mem.guardar(caso);
        } catch (e) {
          return _json(res, e.codigo || 422, { ok: false, error: e.message });
        }
        res.setHeader('Location', '/casos/' + caso.id);
        return _json(res, 201, { ok: true, caso });
      }

      if (req.method === 'GET' && ruta === '/escaner') {
        const simbodo = q.get('simbodo') || '';
        if (!simbodo) return _json(res, 400, { ok: false, error: 'falta simbodo' });
        if (typeof getVelas !== 'function') {
          return _json(res, 409, { ok: false, error: 'sin velas para ' + simbodo });
        }
        const series = {};
        const faltan = [];
        for (const tf of escaner.TFS_ESCANER) {
          const datos = getVelas(simbodo, tf);
          if (datos && Array.isArray(datos.velas) && datos.velas.length >= 120) series[tf] = datos.velas;
          else faltan.push(tf);
        }
        if (!Object.keys(series).length) {
          return _json(res, 404, { ok: false, error: 'sin velas para ' + simbodo });
        }
        const t0 = process.hrtime.bigint();
        const salida = escaner.escanearSeries(series);
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        return _json(res, 200, {
          ok: true, simbodo,
          matriz: salida.matriz,
          series: salida.series,
          faltan,
          ms: Number(ms.toFixed(2)),
        });
      }

      if (req.method === 'GET' && ruta === '/casos') {
        const limite = Math.min(500, Math.max(1, Number(q.get('limite') || 100)));
        const filtros = {
          simbolo: q.get('simbolo') || undefined,
          tf: (q.get('tf') || '').toUpperCase() || undefined,
          estado: q.get('estado') || undefined,
        };
        const todos = mem.listar(filtros);
        return _json(res, 200, { ok: true, total: todos.length, casos: todos.slice(-limite) });
      }

      if (req.method === 'GET' && ruta.startsWith('/casos/')) {
        const id = decodeURIComponent(ruta.slice('/casos/'.length));
        const caso = id ? mem.obtener(id) : null;
        if (!caso) return _json(res, 404, { ok: false, error: 'caso no encontrado' });
        return _json(res, 200, { ok: true, caso });
      }

      if (req.method === 'POST' && ruta === '/sugerencias') {
        const cuerpo = await _leerCuerpo(req);
        const simbodo = typeof cuerpo.simbolo === 'string' ? cuerpo.simbolo.trim() : '';
        const tf = typeof cuerpo.tf === 'string' ? cuerpo.tf.toUpperCase() : '';
        const linea = cuerpo.linea && typeof cuerpo.linea === 'object' ? cuerpo.linea : null;
        if (!simbodo || !tf || !linea) {
          return _json(res, 400, { ok: false, error: 'faltan simbolo, tf o linea' });
        }
        const datos = (typeof getVelas === 'function') ? getVelas(simbodo, tf) : null;
        if (!datos || !Array.isArray(datos.velas) || !datos.velas.length) {
          return _json(res, 409, { ok: false, error: 'sin velas para ' + simbodo + ' ' + tf });
        }
        let consulta;
        try {
          consulta = mem.crear({ simbolo: simbodo, tf, linea, velas: datos.velas });
        } catch (e) {
          return _json(res, e.codigo || 422, { ok: false, error: e.message });
        }
        return _json(res, 200, { ok: true, ...sugerencia.sugerir(consulta, mem.listar()) });
      }

      if (req.method === 'PATCH' && ruta.startsWith('/casos/')) {
        const id = decodeURIComponent(ruta.slice('/casos/'.length));
        const cuerpo = await _leerCuerpo(req);
        try {
          return _json(res, 200, { ok: true, caso: mem.cambiarEstado(id, String(cuerpo.estado || '')) });
        } catch (e) {
          return _json(res, e.codigo || 422, { ok: false, error: e.message });
        }
      }

      if (req.method === 'GET' && ruta === '/grafica') {
        res.writeHead(200, {
          ...CABECERAS,
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src data:",
        });
        return res.end(GRAFICA_HTML);
      }

      res.writeHead(404, { ...CABECERAS, 'Content-Type': 'text/plain' });
      res.end('ruta no encontrada\n');
    } catch (e) {
      _json(res, e.codigo || 400, { ok: false, error: e.message });
    }
  });
  return new Promise((resolver, rechazar) => {
    srv.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[servidor] ERROR: el puerto ${port} ya está ocupado por otro proceso.`);
        console.error('[servidor] Cierra la instancia anterior (pkill -f "node app.js") y vuelve a arrancar.');
        process.exit(1);
      }
      rechazar(err);
    });
    srv.listen(port, HOST, () => resolver(srv));
  });
}

module.exports = { crearServidor };