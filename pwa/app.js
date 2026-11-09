'use strict';
/* ============================================================
   WT MOTOR PWA — cables de la aplicación
   ------------------------------------------------------------
   proto.js (cliente MT5 navegador) + motor.js (estrategia +
   Telegram)  →  UI: estado, log, señales, Wake Lock.
   Config y señales se guardan en localStorage del teléfono.
   Reconexión con backoff 3 s → 30 s.
   ============================================================ */
import { ClienteMT5Web } from './proto.js';
import { Estrategia, enviarTelegram, formatearSenal, MAX_VELAS_TF } from './motor.js';
import { abrirVelasDB, guardarVelas, cargarVelas, borrarTodasLasVelas } from './velas_db.js';
import { radiografiar } from './radio.js';
import { PanelVelas } from './velas_canvas.js';

/* ---------- referencias UI ---------- */
const $ = (id) => document.getElementById(id);
const ui = {
  chipCon: $('chip-conexion'), chipLock: $('chip-wakelock'),
  dTicks: $('d-ticks'), dSenales: $('d-senales'), dTn: $('d-tn'), dReconex: $('d-reconex'),
  senales: $('senales'), log: $('log'), resumen: $('resumen'),
  bCon: $('b-conectar'), bDes: $('b-desconectar'), bTestTg: $('b-test-telegram'),
  bTestNotif: $('b-test-notif'), bInstalar: $('b-instalar'), notaOrigen: $('nota-origen'),
  cLogin: $('c-login'), cPass: $('c-pass'), cHost: $('c-host'),
  cSimbolos: $('c-simbolos'), cScore: $('c-score'), cRecordar: $('c-recordar'),
  cTgToken: $('c-tgtoken'), cTgChat: $('c-tgchat'),
};

/* ---------- config persistente (segura por defecto) ----------
   Por defecto las credenciales viven SOLO en sessionStorage (mueren al
   cerrar la pestaña/app). Solo si marcas «Recordar en este dispositivo»
   se guardan en localStorage (persistente, menos seguro). */
const CLAVE_CONF = 'wt_pwa_config_v1';
function guardarConf() {
  const recordar = !!(ui.cRecordar && ui.cRecordar.checked);
  const datos = JSON.stringify({
    login: ui.cLogin.value.trim(),
    pass: ui.cPass.value,
    host: ui.cHost.value.trim(),
    simbolos: ui.cSimbolos.value.trim(),
    score: ui.cScore.value.trim(),
    tgToken: ui.cTgToken.value.trim(),
    tgChat: ui.cTgChat.value.trim(),
    recordar,
  });
  (recordar ? localStorage : sessionStorage).setItem(CLAVE_CONF, datos);
  (recordar ? sessionStorage : localStorage).removeItem(CLAVE_CONF);   // nunca en los dos
}
function cargarConf() {
  try {
    let cruda = sessionStorage.getItem(CLAVE_CONF);
    let origen = 'sesión';
    if (!cruda) { cruda = localStorage.getItem(CLAVE_CONF); origen = 'dispositivo'; }
    if (!cruda) return;
    const c = JSON.parse(cruda);
    if (c.login) ui.cLogin.value = c.login;
    if (c.pass) ui.cPass.value = c.pass;
    if (c.host) ui.cHost.value = c.host;
    if (c.simbolos !== undefined) ui.cSimbolos.value = c.simbolos;
    if (c.score) ui.cScore.value = c.score;
    if (c.tgToken) ui.cTgToken.value = c.tgToken;
    if (c.tgChat) ui.cTgChat.value = c.tgChat;
    if (ui.cRecordar) ui.cRecordar.checked = !!c.recordar;
    // migración de versiones antiguas: lo persistido sin «recordar» pasa a sesión
    if (origen === 'dispositivo' && !c.recordar) {
      sessionStorage.setItem(CLAVE_CONF, cruda);
      localStorage.removeItem(CLAVE_CONF);
      log('AVISO', 'credenciales migradas a sesión (más seguro); marca «Recordar» para persistirlas');
    }
  } catch (e) { /* config nueva */ }
}
cargarConf();
document.querySelectorAll('input').forEach((x) => x.addEventListener('change', guardarConf));

/* ---------- log ---------- */
let logLineas = 0;
function log(nivel, msg) {
  const t = new Date().toLocaleTimeString();
  const d = document.createElement('div');
  d.className = 'log-' + nivel;
  d.textContent = `[${t}] [${nivel}] ${msg}`;
  ui.log.appendChild(d);
  if (++logLineas > 300) { ui.log.removeChild(ui.log.firstChild); logLineas--; }
  ui.log.scrollTop = ui.log.scrollHeight;
}
/* evita volcar token/contraseña al log si algún mensaje los contiene */
const scrub = (s) => String(s).replace(/[A-Za-z0-9_-]{20,}/g, (m) => m.slice(0, 6) + '…');

/* errores que antes morían en silencio en el teléfono (stability): ahora
   quedan en el registro con la marca de tiempo para poder depurar */
window.addEventListener('unhandledrejection', (ev) => {
  const r = ev.reason;
  log('AVISO', 'error interno: ' + scrub(String((r && r.message) || r || 'desconocido')).slice(0, 160));
});
window.addEventListener('error', (ev) => {
  log('AVISO', 'error: ' + scrub(String(ev.message || 'desconocido')).slice(0, 160));
});

/* ---------- señales (persistidas) ---------- */
const CLAVE_SEN = 'wt_pwa_senales_v1';
function guardarSenales(arr) { localStorage.setItem(CLAVE_SEN, JSON.stringify(arr.slice(0, 30))); }

function mostrarSenal(s) {
  const ph = [...ui.senales.children].find((x) => x.textContent.includes('sin señales todavía'));
  if (ph) ph.remove();
  const d = document.createElement('div');
  d.className = 'senal';
  const lado = document.createElement('span');
  lado.className = 'lado l-' + s.lado;
  lado.textContent = s.lado;
  const meta = document.createElement('span');
  meta.className = 'meta';
  meta.textContent = `${s.simbolo} · ${s.fase} · score ${s.score} · ${new Date(s.horaPared).toLocaleString()}`;
  d.appendChild(lado); d.appendChild(meta);
  ui.senales.prepend(d);
  while (ui.senales.querySelectorAll('.senal').length > 30) ui.senales.removeChild(ui.senales.lastChild);
}

let tablaSenales = [];
try { tablaSenales = JSON.parse(localStorage.getItem(CLAVE_SEN) || '[]'); } catch (e) { tablaSenales = []; }
tablaSenales.forEach(mostrarSenal);

/* ---------- stats refrescados cada 2 s ---------- */
const stats = { ticksUltimoMin: [], senalesHoy: 0, tn: 0, reconexiones: 0 };

setInterval(() => {
  stats.ticksUltimoMin = stats.ticksUltimoMin.filter((t) => t > Date.now() - 60e3);
  ui.dTicks.textContent = String(stats.ticksUltimoMin.length);
  ui.dSenales.textContent = String(stats.senalesHoy);
  ui.dTn.textContent = String(stats.tn);
  ui.dReconex.textContent = String(stats.reconexiones);
  if (cliente && estrategia) {
    const r = estrategia.resumen();
    const entradas = Object.entries(r);
    if (!entradas.length) { ui.resumen.textContent = 'sembrando historial…'; }
    else {
      ui.resumen.textContent = entradas.map(([sim, e]) =>
        `${sim}: sesgo ${e.sesgo} · ATR ${e.atr} · ${e.zonasActivas} zonas · velas ${e.velas.M5}/${e.velas.M15}/${e.velas.H1}`).join('\n');
    }
  }
  refrescarPanel();   // el gráfico de velas se repinta también cada 2 s
}, 2000);

function setChip(activo, texto, cls) {
  ui[activo].textContent = texto;
  ui[activo].className = 'chip' + (cls ? ' ' + cls : '');
}

/* ---------- Wake Lock (pantalla encendida = motor vivo) ---------- */
let lock = null;
async function pedirWakeLock() {
  try {
    if (lock) return;   // ya hay uno vivo: no pedir otro en cada reconexión (chip parpadeaba)
    if (!('wakeLock' in navigator)) { setChip('chipLock', 'pantalla: no soportada', ''); return; }
    lock = await navigator.wakeLock.request('screen');
    setChip('chipLock', 'pantalla: encendida', 'verde');
    lock.addEventListener('release', () => { lock = null; setChip('chipLock', 'pantalla: liberada', 'ambar'); });
  } catch (e) { setChip('chipLock', 'pantalla: error', 'rojo'); }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (cliente && !lock) pedirWakeLock();
  /* Android congela la app y puede matar el WebSocket SIN disparar
     onclose: al volver, si no hay datos frescos, reconexión inmediata
     en vez de esperar a que el usuario note el chip muerto */
  if (cliente && cliente.etapa === 'listo' && Date.now() - ultimoDatoAt > 15000) {
    log('AVISO', 'al volver a la app no hay datos frescos — reconectando ya');
    stats.reconexiones++;
    conectarInternal();
  }
});
/* watchdog en primer plano: sesión 'listo' sin ticks 45 s = socket muerto */
setInterval(() => {
  if (cliente && estrategia && cliente.etapa === 'listo' && Date.now() - ultimoDatoAt > 45000) {
    log('AVISO', '45 s sin ticks con sesión abierta — reconexión forzada');
    stats.reconexiones++;
    conectarInternal();
  }
}, 15000);

/* ---------- notificaciones locales (sin push, no requiere servidor) ---------- */
async function notificar(titulo, cuerpo) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (navigator.serviceWorker?.controller) {
      await navigator.serviceWorker.controller.showNotification(titulo, { body: cuerpo, icon: 'icono-192.png' });
    } else {
      new Notification(titulo, { body: cuerpo, icon: 'icono-192.png' });
    }
  } catch (e) { /* silencioso */ }
}

/* ---------- motor: instancia, cableado y reconexión ----------
   El backoff (3 s → 30 s) es SOLO para fallos de transporte. Un login
   rechazado no se reintenta en bucle: a los 3 intentos se para y se
   exige acción manual (evita martillear el servidor y bloqueos). */
const MAX_FALLOS_LOGIN = 3;
let cliente = null, estrategia = null, paradoManual = false, espera = 3000;
let fallosLogin = 0;
let velasDBok = false, idxGuardado = 0;
let tReconexion = null;                     // UN solo temporizador de reconexión
let ultimoDatoAt = 0;                       // llegada del último tick (watchdog)
const firmasGuardadas = new Map();          // "SIM|TF" -> t de la última vela escrita
const SEG_TF = { M5: 300, M15: 900, H1: 3600 };   // segundos por vela
const LIMITE_SIMBOLOS = 40;                 // tope al suscribir con el filtro genérico

function crearCliente() {
  const simbolos = ui.cSimbolos.value.split(',').map((s) => s.trim()).filter(Boolean);
  return new ClienteMT5Web({
    login: ui.cLogin.value.trim(),
    pass: ui.cPass.value,
    host: ui.cHost.value.trim() || 'mt5.demo.weltrade.org',
    filtro: simbolos.length
      /* escapar TODOS los meta-caracteres de regex (la clase anterior
         no escapaba nada: un símbolo con ( ) . + construía un patrón
         que nunca coincidía — y con [ moría en new RegExp sin aviso,
         dejando el chip en «conectando…» para siempre) */
      ? new RegExp('^(' + simbolos.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')$', 'i')
      : undefined,
    limite: simbolos.length ? 0 : LIMITE_SIMBOLOS,   // sin lista explícita: tope por memoria
  });
}

function crearEstrategia() {
  return new Estrategia({ scoreMin: Number(ui.cScore.value) || 60 });
}

function cablear() {
  cliente.on('aviso', (m) => log('INFO', scrub(m)));
  cliente.on('login_rechazado', ({ dd }) => {
    fallosLogin++;
    setChip('chipCon', `credenciales rechazadas (${fallosLogin}/${MAX_FALLOS_LOGIN})`, 'rojo');
    log('AVISO', `login rechazado (dd=${dd}) — revisa cuenta/contraseña/servidor en Configuración`);
  });
  cliente.on('cerrar', () => {
    setChip('chipCon', 'cerrada', 'rojo');
    log('AVISO', 'sesión cerrada');
    if (paradoManual) return;   // cierre manual: no cuenta como reconexión
    if (fallosLogin >= MAX_FALLOS_LOGIN) {
      setChip('chipCon', 'credenciales rechazadas — corrige y pulsa Conectar', 'rojo');
      log('AVISO', `paro tras ${fallosLogin} logins rechazados: corrige Configuración y pulsa Conectar`);
      return;                   // sin reintento automático con credenciales inválidas
    }
    stats.reconexiones++;       // solo reconexiones automáticas de transporte
    clearTimeout(tReconexion);  // UN solo temporizador aunque 'cerrar' llegue por varias vías
    log('AVISO', `reconectando en ${(espera / 1000).toFixed(0)} s…`);
    tReconexion = setTimeout(() => { espera = Math.min(30000, espera * 1.5); conectarInternal(); }, espera);
  });
  cliente.on('listo', ({ simbolos }) => {
    fallosLogin = 0;            // login correcto: el contador de rechazos se limpia
    espera = 3000;
    ultimoDatoAt = Date.now();
    setChip('chipCon', 'listo · ' + simbolos.length + ' símbolos', 'verde');
    llenarSelectorSimbolos(simbolos);
    sembrar(simbolos);
  });
  cliente.on('tick', (t) => {
    ultimoDatoAt = Date.now();
    stats.ticksUltimoMin.push(t.t);
    estrategia.onTick(t.simbolo, t.bid, t.ask, t.t);
  });

  estrategia.on('senal', async (s) => {
    stats.senalesHoy++;
    s.horaPared = Date.now();
    log('SENAL', `${s.lado} ${s.simbolo} fase=${s.fase} score=${s.score} nivel=${s.nivel}`);
    tablaSenales.unshift(s);
    tablaSenales = tablaSenales.slice(0, 30);
    guardarSenales(tablaSenales);
    mostrarSenal(s);
    await notificar(`${s.lado} · ${s.simbolo}`, `score ${s.score} · ${s.fase}`);
    await telEnviar(formatearSenal(s));
  });
  estrategia.on('tn', (ev) => {
    stats.tn++;
    log('TN', `${ev.simbolo} zona ${ev.zona.tipo} ${ev.zona.nivel} cancelada (${ev.motivo})`);
  });
  estrategia.on('toque', (ev) => log('INFO', `toque ${ev.fase} ${ev.simbolo} en ${ev.zona.tipo} ${ev.zona.nivel}`));
}

/* arranque interno reutilizado por la reconexión con backoff */
function conectarInternal() {
  clearTimeout(tReconexion); tReconexion = null;   // nunca dos reconexiones en carrera
  if (cliente) { try { cliente.cerrar(); } catch (e) { } }
  paradoManual = false;
  ui.bDes.disabled = false;   // hay sesión (o reconexión en curso) que se puede detener
  setChip('chipCon', 'conectando…', 'ambar');
  estrategia = crearEstrategia();
  cliente = crearCliente();
  cablear();
  cliente.conectar();
  pedirWakeLock();
}

function conectar() {
  if (cliente && ['conectando', 'handshake', 'login', 'catalogo', 'listo'].includes(cliente.etapa)) {
    log('AVISO', 'ya hay una sesión activa');
    return;
  }
  if (!ui.cLogin.value.trim() || !ui.cPass.value) { log('AVISO', 'falta cuenta o contraseña en Configuración'); return; }
  guardarConf();
  fallosLogin = 0;   // intento manual: el contador de rechazos se limpia
  stats.ticksUltimoMin.length = 0; stats.senalesHoy = 0; stats.tn = 0; stats.reconexiones = 0;
  ui.senales.querySelectorAll('.senal').forEach((x) => x.remove());
  conectarInternal();
}

function desconectar() {
  paradoManual = true;
  clearTimeout(tReconexion); tReconexion = null;
  ui.bDes.disabled = true;
  if (cliente) { cliente.cerrar(); cliente = null; }
  estrategia = null;
  setChip('chipCon', 'apagado', 'rojo');
  setChip('chipLock', 'pantalla: n/a', '');
  log('INFO', 'motor apagado');
}

ui.bCon.addEventListener('click', conectar);
ui.bDes.addEventListener('click', desconectar);

/* ---------- siembra de historial (cmd 11 velas) ---------- */
/* Rango pedido al servidor por TF, ajustado al búfer del motor
   (MAX_VELAS_TF) con un pequeño margen para no descargar de más:
   H1 45 d ≈ 1080 velas · M15 22 d ≈ 2112 · M5 11 d ≈ 3168. */
const PLAN = [['H1', 45], ['M15', 22], ['M5', 11]];

/* Une histórico guardado + velas nuevas por timestamp, sin duplicados. */
function unirVelas(viejas, nuevas) {
  const m = new Map();
  for (const v of viejas) m.set(v.t, v);
  for (const v of nuevas) m.set(v.t, v);   // si repite t, manda la del servidor
  return [...m.values()].sort((a, b) => a.t - b.t);
}

/* El servidor manda la vela EN FORMACIÓN al final: si entra en la
   siembra queda congelada (mismo t que el cierre real la bloquea) y
   se persiste corrupta. Se recorta aquí, ANTES de unir y guardar. */
function quitarVelaFormando(velas, tf) {
  const arr = velas.slice();
  const seg = (SEG_TF[tf] || 0) * 1000;
  while (arr.length && arr[arr.length - 1].t + seg > Date.now()) arr.pop();
  return arr;
}

/* el motor puede apagarse a mitad de siembra: TODO acceso a cliente/
   estrategia tras un await pasa por aquí (antes daba TypeError mudo) */
const sembraViva = () => !!(cliente && estrategia && cliente.etapa === 'listo');

async function sembrar(simbolos) {
  try {
    await abrirVelasDB();
    velasDBok = true;
    try { await navigator.storage?.persist?.(); } catch (e) { }   // que el SO no borre las velas
  } catch (e) {
    velasDBok = false;
    log('AVISO', `sin histórico persistente (${(e && e.name) || 'error'}) — solo memoria`);
  }
  log('INFO', `sembrando ${simbolos.length} símbolos · H1 45 d / M15 22 d / M5 11 d` +
    (velasDBok ? ' · histórico guardado en el teléfono' : ''));

  for (const s of simbolos) {
    for (const [tf, dias] of PLAN) {
      if (!sembraViva()) return; // se cerró a mitad

      let previas = [];
      if (velasDBok) { try { previas = await cargarVelas(s, tf); } catch (e) { previas = []; } }
      if (!sembraViva()) return;
      const ultima = previas.length ? previas[previas.length - 1].t : 0;

      // Caché al día: no hay nada nuevo que pedir, arranca con lo guardado.
      if (previas.length && Date.now() - ultima < SEG_TF[tf] * 1000) {
        estrategia.setHistoria(s, tf, previas);
        continue;
      }

      // Petición incremental: desde la vela siguiente a la última guardada.
      const desde = ultima ? Math.floor(ultima / 1000) + 1 : 0;
      let r = await cliente.pedirVelas(s, { tf, dias, desde, timeoutMs: desde ? 4000 : 10000 });
      if (!sembraViva()) return;
      let nuevas = r && r.velas.length ? quitarVelaFormando(r.velas, tf) : [];

      // Reintento único si la petición incremental volvió vacía
      if (!nuevas.length && desde) {
        r = await cliente.pedirVelas(s, { tf, dias, desde, timeoutMs: 6000 });
        if (!sembraViva()) return;
        if (r && r.velas.length) nuevas = quitarVelaFormando(r.velas, tf);
      }

      // Relleno hacia atrás si la caché es más corta que el búfer
      // (primera vez, o justo después de ampliar el rango).
      if (previas.length && previas.length < MAX_VELAS_TF[tf]) {
        const r2 = await cliente.pedirVelas(s, { tf, dias });
        if (!sembraViva()) return;
        if (r2 && r2.velas.length) nuevas = nuevas.concat(quitarVelaFormando(r2.velas, tf));
        await new Promise((ok) => setTimeout(ok, 350));
      }

      const velas = unirVelas(previas, nuevas);
      if (velas.length) {
        estrategia.setHistoria(s, tf, velas);
        if (velasDBok) {
          try {
            await guardarVelas(s, tf, velas, MAX_VELAS_TF[tf]);
            firmasGuardadas.set(s + '|' + tf, velas[velas.length - 1].t);
          } catch (e) { /* cuota llena: se sigue en memoria */ }
        }
        if (previas.length) log('INFO', `${s} ${tf}: ${previas.length} guardadas + ${nuevas.length} nuevas`);
      } else {
        log('AVISO', `${s} ${tf}: sin velas (timeout o respuesta vacía)`);
      }

      await new Promise((r2) => setTimeout(r2, 350)); // espaciado entre peticiones
    }
  }
  if (sembraViva()) log('INFO', 'sembrado terminado — motor en marcha');
  refrescarPanel();   // primer pintado del gráfico con datos reales
}

/* ---------- guardado de las velas que cierra el motor ----------
   Un símbolo cada 3 s y solo los TF cuya última vela cambió: se escribe
   ~1 vez por vela cerrada, no en cada ciclo. */
setInterval(async () => {
  if (!velasDBok || !estrategia) return;
  const nombres = Object.keys(estrategia.resumen());
  if (!nombres.length) return;
  const simbolo = nombres[idxGuardado++ % nombres.length];
  const hist = estrategia.historia(simbolo);
  if (!hist) return;
  for (const tf of ['H1', 'M15', 'M5']) {
    const arr = hist[tf];
    const ult = arr[arr.length - 1];
    if (!ult || firmasGuardadas.get(simbolo + '|' + tf) === ult.t) continue;
    try {
      await guardarVelas(simbolo, tf, arr, MAX_VELAS_TF[tf]);
      firmasGuardadas.set(simbolo + '|' + tf, ult.t);
    } catch (e) { /* cuota llena: se reintenta más tarde */ }
  }
}, 3000);

/* ---------- telegram directo desde el navegador ---------- */
async function telEnviar(texto) {
  const token = ui.cTgToken.value.trim(), chat = ui.cTgChat.value.trim();
  if (!token || !chat) return { ok: false, motivo: 'sin configurar' };
  const r = await enviarTelegram(token, chat, texto);
  if (!r.ok) log('AVISO', 'telegram falló: ' + (r.motivo || r.error || ''));
  return r;
}

/* ---------- pruebas ---------- */
ui.bTestTg.addEventListener('click', async () => {
  guardarConf();
  log('INFO', 'probando telegram…');
  const r = await telEnviar('✅ <b>WT Motor</b> conectado a tu Telegram');
  if (r.ok) log('INFO', 'telegram OK — revisa tu chat');
  else log('AVISO', 'telegram falló: ' + (r.motivo || r.error || 'desconocido'));   // antes solo «telegram falló»
});

ui.bTestNotif.addEventListener('click', async () => {
  if (!('Notification' in window)) { log('AVISO', 'este navegador no soporta notificaciones'); return; }
  const permiso = await Notification.requestPermission();
  if (permiso === 'granted') {
    notificar('WT Motor', 'notificaciones activadas — las señales avisarán aquí');
    log('INFO', 'permiso de notificaciones concedido');
  } else {
    log('AVISO', 'permiso de notificaciones denegado');
  }
});

/* ---------- radiografía de bots MT5 (100 % local, sin servidor) ---------- */
const escRadio = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const filaRadio = (k, v) => `<div class="radio-fila"><span class="k">${escRadio(k)}</span><span class="v">${escRadio(v)}</span></div>`;

function pintarRadio(inf) {
  const est = inf.ok ? `<span class="ok">✓ ${escRadio(inf.resumen)}</span>` : `<span class="mal">✗ ${escRadio(inf.resumen)}</span>`;
  document.getElementById('r-estado').innerHTML = est;
  const h = inf.hallazgos || {};
  const filas = [];
  if (h.tipo) filas.push(filaRadio('Formato', h.tipo));
  if (h.versionFormato !== undefined) filas.push(filaRadio('Versión de formato', h.versionFormato));
  if (h.autor) filas.push(filaRadio('Autor', h.autor));
  if (h.link) filas.push(filaRadio('Link', h.link));
  if (h.versionPrograma) filas.push(filaRadio('Versión del programa', h.versionPrograma));
  if (h.compilado) filas.push(filaRadio('Compilado', h.compilado));
  if (h.tamanoBytes) filas.push(filaRadio('Tamaño', h.tamanoBytes.toLocaleString('es') + ' bytes'));
  if (h.fronteraCifrada >= 0) filas.push(filaRadio('Zona clara', `0x0 – 0x${h.fronteraCifrada.toString(16)}`));
  if (h.entropia !== undefined) filas.push(filaRadio('Entropía del cuerpo', h.entropia + ' bits/byte'));
  if (h.cripto) filas.push(filaRadio('Criptoanálisis', `bloques16 ${h.cripto.bloques16} · χ² ${h.cripto.chi2} — ${h.cripto.lectura}`));
  if (h.camposCabecera) filas.push(filaRadio('Cabecera (candidatos)', JSON.stringify(h.camposCabecera)));
  if (h.documentoEstrategia) filas.push(filaRadio('Documento de estrategia', h.documentoEstrategia.nombre));
  if (h.simbolo) filas.push(filaRadio('Símbolo de la plantilla', h.simbolo));
  if (h.entradas && h.entradas.length) filas.push(filaRadio('Inputs', h.entradas.join(' · ')));
  if (h.indicadores && h.indicadores.length) filas.push(filaRadio('Indicadores', h.indicadores.join(' · ')));
  if (h.ordenes) filas.push(filaRadio('Órdenes C/V', `${h.ordenes.compra} compra · ${h.ordenes.venta} venta`));
  if (h.pares && h.pares.length) filas.push(filaRadio('Pares clave=valor', h.pares.slice(0, 12).join(' · ') + (h.pares.length > 12 ? ` (+${h.pares.length - 12})` : '')));
  if (h.stringsTexto && h.stringsTexto.length) filas.push(filaRadio('Strings legibles', h.stringsTexto.slice(0, 10).join(' · ')));
  if (h.stringsExtra && h.stringsExtra.length) filas.push(filaRadio('Strings extra', h.stringsExtra.slice(0, 10).join(' · ')));
  if (h.veredicto) filas.push(filaRadio('Veredicto', h.veredicto));
  document.getElementById('r-informe').innerHTML = filas.length
    ? `<div style="margin-top:8px;border:1px solid var(--borde);border-radius:8px;padding:8px 10px">${filas.join('')}</div>`
    : '';
}

document.getElementById('b-radiografia').addEventListener('click', async () => {
  const f = document.getElementById('r-archivo').files[0];
  const est = document.getElementById('r-estado');
  const infDiv = document.getElementById('r-informe');
  if (!f) { est.innerHTML = '<span class="mal">elige un archivo primero</span>'; return; }
  est.textContent = 'radiografiando en el teléfono…';
  infDiv.innerHTML = '';
  try {
    const inf = radiografiar(f.name, await f.arrayBuffer());
    pintarRadio(inf);
    log(inf.ok ? 'INFO' : 'AVISO', `radiografía ${f.name}: ${inf.resumen}`);
  } catch (e) {
    est.innerHTML = `<span class="mal">error al radiografiar: ${escRadio(e.message)}</span>`;
  }
});

/* ---------- instalación PWA ---------- */
let promptInstal = null;
window.addEventListener('beforeinstallprompt', (ev) => {
  ev.preventDefault();
  promptInstal = ev;
  ui.bInstalar.disabled = false;
  log('INFO', 'app instalable — pulsa «Instalar app»');
});
ui.bInstalar.addEventListener('click', async () => {
  if (!promptInstal) return;
  promptInstal.prompt();
  const { outcome } = await promptInstal.userChoice;
  log('INFO', `instalación: ${outcome}`);
  promptInstal = null;
  ui.bInstalar.disabled = true;
});

/* ---------- panel de velas en <canvas> ---------- */
const panelVelas = new PanelVelas($('g-canvas'));
let tfPanel = 'M15';

function llenarSelectorSimbolos(simbolos) {
  const sel = $('g-simbolo');
  const previo = sel.value;
  sel.innerHTML = '';
  for (const s of simbolos) {
    const o = document.createElement('option');
    o.value = s;
    o.textContent = s;
    sel.appendChild(o);
  }
  if (previo && simbolos.includes(previo)) sel.value = previo;   // conserva la elección
}

function refrescarPanel() {
  const sim = $('g-simbolo').value;
  const info = $('g-info');
  if (!estrategia || !sim) { info.textContent = '— conecta el motor para ver velas —'; return; }
  const hist = estrategia.historia(sim);
  const r = estrategia.resumen()[sim];
  panelVelas.actualizar({
    velas: hist ? hist[tfPanel] : [],
    formando: estrategia.velaActual(sim, tfPanel),
    zonas: estrategia.zonasDe(sim),
    senales: tablaSenales.filter((x) => x.simbolo === sim).slice(0, 6),
  });
  info.textContent = r
    ? `${sim} · ${tfPanel} · sesgo ${r.sesgo} · ATR ${r.atr} · ${r.zonasActivas} zonas activas · ${r.velas[tfPanel] || 0} velas`
    : `${sim} · ${tfPanel} · sembrando historial…`;
}

for (const [id, tf] of [['g-tf-m5', 'M5'], ['g-tf-m15', 'M15'], ['g-tf-h1', 'H1']]) {
  $(id).addEventListener('click', () => {
    tfPanel = tf;
    for (const otro of ['g-tf-m5', 'g-tf-m15', 'g-tf-h1']) $(otro).classList.toggle('activo', otro === id);
    refrescarPanel();
  });
}
$('g-simbolo').addEventListener('change', refrescarPanel);

/* ---------- borrado de datos locales (credenciales + señales + velas) ---------- */
$('b-borrar').addEventListener('click', async () => {
  if (!confirm('¿Borrar de este dispositivo las credenciales guardadas, las señales y todo el histórico de velas?')) return;
  try { await borrarTodasLasVelas(); } catch (e) { /* la BD quizá ni existía */ }
  localStorage.removeItem(CLAVE_CONF); sessionStorage.removeItem(CLAVE_CONF);
  localStorage.removeItem(CLAVE_SEN);
  log('INFO', 'datos locales borrados — recargando…');
  setTimeout(() => location.reload(), 400);
});

/* ---------- service worker ---------- */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });

log('INFO', 'WT Motor listo — configura cuenta/contraseña y pulsa Conectar');
