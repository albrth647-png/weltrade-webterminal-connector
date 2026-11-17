'use strict';
/* ============================================================
   MOTOR DE SEÑALES — punto de entrada
   ------------------------------------------------------------
   cliente_mt5 (ticks + velas) → nucleo (reglas del vídeo 03)
     → consola + Telegram + carril urgente + HTTP /estado
   Sin documento de estrategia, sin panel de importación, sin
   zonas ni fases: lo que corre es el catálogo del vídeo.

   Uso:  node app.js     (lee .env de esta carpeta)
   ============================================================ */
const { ClienteMT5 } = require('./cliente_mt5');
const { Nucleo, TFS, TF_ESCANEO } = require('./nucleo');
const { Vigia, TFS_RAYA } = require('./rayas');
const { crearServidor } = require('./servidor');
const { zonasDe } = require('./zonas');
const { enviarTelegram, formatearSenal, formatearAviso, formatearRaya, telegramConfigurado, estadoTelegram } = require('./telegram');
const { horaHabana } = require('./tiempo');
const { enviarEntradaUrgente, ntfyConfigurado, estadoUrgente } = require('./urgente');
const outbox = require('./outbox');

/* ── Cuerpo portado de BodyTrendAuto (mismo algoritmo, JS puro) ──────────── */
const NFEAT = 8;
const BTB = require("./btb-core.js");
const BTBLive = require("./btb-live.js");
const BTB_CONFIG = {
  pivL: 3, pivR: 3, atrPeriod: 14, marginATR: 0.10, tolATR: 0.15,
  engN: 10, keepFan: true, emitLegs: false, emitPivots: true,
  closedOnly: true, brain: true, nOut: 20, kATR: 1.0, warmup: 60,
  lr: 0.05, decay: 0.995, thHigh: 0.60, thLow: 0.45,
  suppressLow: false, adaptMargin: true, kappa: 0.5,
  voteStrength: 0.06, voteFactors: [1, 2, 4, 8]
};

function bodyTrendCore(velas) {
  const eng = BTB.createEngine(BTB_CONFIG);
  eng.setCandles(velas);
  const res = eng.result();
  const draw = BTB.buildDrawList(res, { leftBar: 0, rightBar: Math.max(0, res.stats.lastClosed) });
  /* Política en vivo: como mucho la trendline vigente + el nivel vigente. */
  const liveView = { leftBar: 0, rightBar: Math.max(0, res.stats.lastClosed) };
  return {
    tendencia: res.trend,
    originT: res.origin ? res.origin.t : null,
    originP: res.origin ? res.origin.p : null,
    prot: res.protected,
    protectedLevel: res.protectedLevel ? res.protectedLevel.price : res.protected,
    pivots: res.pivots,
    warned: res.lines.some(l => l.warn),
    fan: res.lines,
    fanLines: res.lines,
    originBar: res.origin ? res.origin.bar : null,
    brain: res.brain,
    lastTier: res.brain.ready ? (res.brain.p >= 0.60 ? 2 : res.brain.p >= 0.45 ? 1 : 0) : 2,
    lastTag: res.brain.ready ? (res.brain.p >= 0.60 ? "CONF" : res.brain.p >= 0.45 ? "PROV" : "DEBIL") : "BASE",
    lastTip: res.brain.p,
    trendStr: res.trend > 0 ? "ALCISTA" : res.trend < 0 ? "BAJISTA" : "RANGO",
    drawList: draw,
    liveDrawList: BTBLive.buildLiveDrawList(res, liveView),
    liveSelfTest: BTBLive.liveSelfTest(res, liveView),
    mtf: null,
    stats: res.stats,
    events: res.events,
    touches: res.touches,
    levels: res.levels,
    lines: res.lines
  };
}

const SIMBOLOS_ENV = (process.env.MS_SIMBOLOS || '').split(',').map((s) => s.trim()).filter(Boolean);
const SIN_TELEGRAM = process.env.MS_SIN_TELEGRAM === '1';
/* Temporalidades que se escanean y las que se envían al móvil. */
const TFS_ESCANEO = (process.env.MS_TF || TF_ESCANEO.join(','))
  .split(',').map((x) => x.trim().toUpperCase()).filter((x) => TFS[x]);
/* Por defecto se envía a Telegram TODO lo que se escanea: cada señal
   lleva su propia temporalidad en el mensaje (M5/M15/M30/H1), así que
   no tiene sentido filtrar por un único TF vivo. El usuario puede seguir
   restringiendo con MS_TF_VIVO=M5 si quiere solo ese carril. */
const TF_VIVO = process.env.MS_TF_VIVO || TFS_ESCANEO.join(',');
const TFS_TELEGRAM = TF_VIVO.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
const DIAS_HISTORIA = 30;
const VERBOSO = process.env.MS_VERBOSO === '1';

const log = (nivel, msg, extra) => {
  const linea = `[${horaHabana()}] [${nivel}] ${msg}`;
  console.log(extra !== undefined ? linea + ' ' + JSON.stringify(extra) : linea);
};

const stats = {
  iniciado: Date.now(), ticks: 0, ticksUltimoMin: [], senales: 0,
  reconexiones: 0, latencias: [], filtradas: 0, revisionesContradictorias: 0,
  ultimaSenal: null, simbolos: 0, resembrando: false, sembrado: false,
};

const cliente = new ClienteMT5({
  filtro: SIMBOLOS_ENV.length
    ? new RegExp('^(' + SIMBOLOS_ENV.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')$', 'i')
    : undefined,
});

/* Modo rayas-only: desactiva Yoel/Estructura (señales y avisos) para probar
   y mejorar solo la estrategia de rayas. Apagado por defecto; MS_SOLO_RAYAS=1
   lo enciende. Las rayas también están apagadas salvo MS_RAYAS=1. */
const SOLO_RAYAS = process.env.MS_SOLO_RAYAS === '1';
const RAYAS_ENABLED = process.env.MS_RAYAS === '1';
/* Anclaje del histórico del bróker al precio vivo. Por defecto sigue
   activo (compatibilidad); MS_ANCLAR_AL_VIVO=0 lo desactiva para que las
   señales y las EMAs coincidan con el gráfico del bróker. */
const ANCLAR_AL_VIVO = process.env.MS_ANCLAR_AL_VIVO !== '0';
log('INFO', `anclaje al precio vivo: ${ANCLAR_AL_VIVO ? 'ACTIVO' : 'DESACTIVADO (precios crudos del bróker)'}`);
/* Patrones que son AVISO, no entrada: solo las variantes de estructura
   2E/3E. Las 2/3/2R/3R ya son entradas al toque. */
const PATRONES_AVISO = new Set(['2E', '2ER', '3E', '3ER']);
/* El lado se bloquea en la capa de ENVÍO, después de los filtros de tendencia.
   Así una señal descartada por H1 no impide que una revisión válida del bróker
   mande el lado contrario. La gráfica conserva todas las señales crudas. */
const ladoPorVela = new Map();
function puedeEnviarLado(s) {
  const k = `${s.simbolo}|${s.tfZona}|${s.t}`;
  const previo = ladoPorVela.get(k);
  if (previo && previo !== s.lado) {
    stats.revisionesContradictorias++;
    log('INFO', `señal ${s.lado} ${s.simbolo} ${s.patron} ${s.tfZona} descartada: la vela ${horaHabana(s.t)} ya envió ${previo}`);
    return false;
  }
  if (!previo) ladoPorVela.set(k, s.lado);
  return true;
}
const estrategia = new Nucleo({ tfs: TFS_ESCANEO, soloRayas: SOLO_RAYAS, bloqueoLado: false, anclaje: ANCLAR_AL_VIVO });
let simbolosActivos = [];
/* Último tick POR SÍMBOLO. Un contador global no basta: si un instrumento
   deja de tickear y otro sigue, el motor podría emitir señales del congelado
   anclando su histórico a un precio de hace minutos (M2). */
const ultimoTickPorSimbolo = new Map();

/* Caché de /velas. La web pide la serie cada pocos segundos y cada llamada
   recorre las ~43.000 velas M1 del histórico. Zonas y señales solo cambian
   cuando cambia la última vela, así que se reutilizan durante 5 s. */
const MS_CACHE_VELAS_MS = Number(process.env.MS_CACHE_VELAS_MS) || 5000;
const cacheVelas = new Map();   // clave (símbolo|tf|n|última) → { t, zonas, senales }

/* ---------- rayas de tendencia (M5/M15/M30/H1) ---------- */
const TF_RAYA_SET = new Set(TFS_RAYA);
const vigias = new Map();
function vigiaDe(s, tf) {
  const k = s + '|' + tf;
  if (!vigias.has(k)) vigias.set(k, new Vigia({ simbodo: s, tf }));
  return vigias.get(k);
}

/* ---------- eventos del núcleo ---------- */
if (!SOLO_RAYAS) estrategia.on('senal', async (s) => {
  /* Guard de feed muerto POR SÍMBOLO: si ese instrumento no manda ticks, sus
     velas están congeladas y cualquier señal sería sobre datos viejos. */
  const ultimoTick = ultimoTickPorSimbolo.get(s.simbolo) || 0;
  const edadFeed = ultimoTick ? Date.now() - ultimoTick : Infinity;
  if (edadFeed > 90000) {
    stats.filtradas++;
    const edadTxt = Number.isFinite(edadFeed) ? `${Math.round(edadFeed / 1000)} s` : 'nunca';
    log('AVISO', `señal ${s.simbolo} ${s.patron} ${s.tfZona} descartada: sin ticks de ${s.simbolo} en ${edadTxt} (feed congelado)`);
    return;
  }
  stats.senales++;
  stats.ultimaSenal = s;
  if (Number.isFinite(s.latenciaMs)) {
    stats.latencias.push(s.latenciaMs);
    if (stats.latencias.length > 500) stats.latencias.shift();
  }
  log(PATRONES_AVISO.has(s.patron) ? 'AVISO' : 'SEÑAL', `${s.lado} ${s.simbolo} ${s.patron} tendencia=${s.tendencia || '—'}${s.tendenciaMayor ? ` ${s.tfTendencia}=${s.tendenciaMayor}` : ''} precio=${s.precio} invalida=${s.invalida ?? '—'} ${s.tfZona} vela=${horaHabana(s.tVela ?? s.t)} latencia=${Number.isFinite(s.latenciaMs) ? s.latenciaMs + ' ms' : '—'}`);

  /* Frescura: una señal de una vela ya cerrada hace horas no es operable.
     Por defecto se acepta hasta 1 vela del TF + 15 s (MS_MAX_LATENCIA_MS lo cambia). */
  const maxLatenciaMs = Number(process.env.MS_MAX_LATENCIA_MS) || ((TFS[s.tfZona] || 300) * 1000 + 15000);
  if (Number.isFinite(s.latenciaMs) && s.latenciaMs > maxLatenciaMs) {
    stats.filtradas++;
    log('INFO', `señal ${s.simbolo} ${s.patron} ${s.tfZona} descartada: ${Math.round(s.latenciaMs / 1000)} s de antigüedad (máx ${Math.round(maxLatenciaMs / 1000)} s)`);
    return;
  }

  /* Candado anti-retraso: si la vela queda en el futuro respecto al reloj del
     VPS (reloj atrasado) o es demasiado vieja, no se envía. */
  const desfaseReloj = Date.now() - s.t;
  if (desfaseReloj < -60000) {
    stats.filtradas++;
    log('AVISO', `señal ${s.simbolo} ${s.patron} ${s.tfZona} descartada: vela en el futuro (${Math.round(-desfaseReloj / 1000)} s) — reloj del VPS atrasado o NTP desincronizado`);
    return;
  }

  if (s.tfZona && !TFS_TELEGRAM.includes(s.tfZona)) {
    stats.filtradas++;
    if (VERBOSO) log('INFO', `señal ${s.tfZona} no enviada (MS_TF_VIVO=${TF_VIVO})`);
    return;
  }

  /* La tendencia manda: ALCISTA solo admite COMPRA y BAJISTA solo VENTA.
     LATERAL no se envía. Cubre también Estructura (M5), que puede disparar
     contra la pila de EMAs aunque su impulso estructural vaya al otro lado. */
  const ladoTendencia = s.tendencia === 'ALCISTA' ? 'COMPRA'
    : s.tendencia === 'BAJISTA' ? 'VENTA' : null;
  if (!ladoTendencia || ladoTendencia !== s.lado) {
    stats.filtradas++;
    log('INFO', `señal ${s.simbolo} ${s.patron} ${s.tfZona} descartada: ${s.lado} contra tendencia ${s.tendencia || '—'}`);
    return;
  }
  /* Tendencia mayor (H1 por defecto): si H1 es bajista no se manda ninguna
     COMPRA, aunque el M1/M5 esté alcista. Si H1 está LATERAL, se permite la
     señal del TF menor porque no hay contradicción. */
  const mayorContraria = (s.tendenciaMayor === 'ALCISTA' && s.lado === 'VENTA')
    || (s.tendenciaMayor === 'BAJISTA' && s.lado === 'COMPRA');
  if (mayorContraria) {
    stats.filtradas++;
    log('INFO', `señal ${s.simbolo} ${s.patron} ${s.tfZona} descartada: ${s.lado} contra ${s.tfTendencia || 'TF mayor'} ${s.tendenciaMayor}`);
    return;
  }
  /* Si el TF de referencia está configurado pero aún no tiene velas, no se
     manda la señal del TF menor: no se puede comprobar la tendencia mayor. */
  if (!s.tendenciaMayor && s.tfZona !== estrategia.tfTendencia
      && TFS_ESCANEO.includes(estrategia.tfTendencia)) {
    stats.filtradas++;
    log('INFO', `señal ${s.simbolo} ${s.patron} ${s.tfZona} descartada: sin ${estrategia.tfTendencia} para verificar tendencia`);
    return;
  }

  /* 2E/3E son avisos de Estructura. Las 2/3/2R/3R ya son entradas.
     MS_TELEGRAM_TOQUES=0 solo deja fuera los avisos E. */
  if (PATRONES_AVISO.has(s.patron)) {
    if (SIN_TELEGRAM || process.env.MS_TELEGRAM_TOQUES === '0') return;
    if (!puedeEnviarLado(s)) { stats.filtradas++; return; }
    const texto = formatearAviso({ ...s, origen: 'cierre', tfZona: s.tfZona, nivelRoto: s.nivelRoto });
    enviarTelegram(texto, { prioridad: 1 })
      .then((r) => { if (!r.ok) log('AVISO', 'telegram aviso falló: ' + (r.motivo || r.error)); })
      .catch((e) => log('AVISO', 'telegram aviso: ' + e.message));
    return;
  }

  if (!puedeEnviarLado(s)) { stats.filtradas++; return; }

  if (!SIN_TELEGRAM) {
    const texto = formatearSenal(s);
    try {
      outbox.marcarEmitida(s.clave);
      outbox.pendiente(s.clave, texto, 0);
      const r = await enviarTelegram(texto, { prioridad: 0 });
      if (r.ok) { outbox.entregada(s.clave); log('ENVÍO', `entregada (message_id ${r.messageId ?? '—'})`); }
      else log('AVISO', 'telegram falló: ' + (r.motivo || r.error) + ' — queda en outbox');
    } catch (err) {
      log('ERROR', `telegram excepción: ${err.message}`);
    }
  }

  enviarEntradaUrgente(s).then((r) => {
    if (r.ok) log('ENVÍO', 'carril urgente entregado (ntfy)');
    else if (ntfyConfigurado()) log('AVISO', `carril urgente falló: ${r.motivo || r.error}`);
  });
});

if (!SOLO_RAYAS) estrategia.on('aviso', (m) => log('AVISO', m));

/* ---------- siembra / refresco de velas ---------- */
/* El terminal a veces devuelve un bloque de velas de OTRO instrumento dentro
   de la misma serie (se vio en SFX Vol 40: 168 velas a ~127.000 en una serie
   de ~35.000). Eso rompe el ATR y la raya, así que se descarta cualquier vela
   cuyo cierre se aleje más de MAX_SALTO del último cierre aceptado. */
const MAX_SALTO_REL = 0.05;
const depurarEscala = (velas) => {
  const out = [];
  let fuera = 0;
  for (const v of velas) {
    if (!out.length) { out.push(v); continue; }
    const ref = out[out.length - 1].c;
    if (!Number.isFinite(v.c) || !Number.isFinite(ref) || ref <= 0) { fuera++; continue; }
    if (Math.abs(v.c - ref) / ref > MAX_SALTO_REL) { fuera++; continue; }
    out.push(v);
  }
  return { velas: out, fuera };
};

/* Coherencia por marca de tiempo: la MISMA vela (mismo t) debe tener el mismo
   cierre. Si el solape discrepa en masa, el lote es de otro instrumento y se
   rechaza en vez de envenenar la serie (así se cruzaron los 21 casos). */
const consistenteCon = (previas, nuevas, tol = 0.10) => {
  if (!previas.length || !nuevas.length) return true;
  const m = new Map(previas.map((v) => [v.t, v.c]));
  let comparadas = 0, malas = 0;
  for (const v of nuevas) {
    const c = m.get(v.t);
    if (c === undefined || !(c > 0) || !(v.c > 0)) continue;
    comparadas++;
    if (Math.abs(v.c - c) / c > tol) malas++;
  }
  return !(comparadas >= 10 && malas / comparadas > 0.5);
};

/* El histórico del WebTerminal de estos índices NO pertenece a la misma serie
   que su stream de ticks: contrastado en sesión real, FX Vol 20 cotizaba
   109.907 en el tick (y lo mismo en MT5) mientras cmd 11 devolvía cierres de
   110.348, y la brecha crecía ~0,1 % por minuto. Mezclar ambas series deja el
   histórico 0,4-0,7 % por encima del mercado y las señales se calculan sobre
   precios que no existen. Aquí el lote del bróker se reescala al precio vivo
   antes de entrar en la serie: la forma (movimientos relativos) se conserva y
   el nivel queda anclado a lo que realmente se puede operar. */
const _ultimoAvisoAnclaje = new Map();
const anclarAlVivo = (s, velas) => {
  if (!ANCLAR_AL_VIVO) return velas;
  const vivo = cliente._ultimoPrecio?.[s];
  if (!Array.isArray(velas) || !velas.length) return velas;
  /* Sin tick fresco del símbolo no se ancla: se estaría desplazando el
     histórico a un precio que ya no existe (M2). */
  const ultimo = ultimoTickPorSimbolo.get(s) || 0;
  if (!ultimo || Date.now() - ultimo > 90000) return velas;
  if (!(Number.isFinite(vivo) && vivo > 0)) return velas;
  const ref = velas[velas.length - 1].c;
  if (!(Number.isFinite(ref) && ref > 0)) return velas;
  const f = vivo / ref;
  if (Math.abs(f - 1) < 0.001) return velas;   // <0,1 %: ruido normal, no tocar
  /* Un factor de este tamaño solo sale de un lote de otro instrumento o de un
     precio vivo medio congelado que pasó el guard de frescura por poco.
     Anclar con él dejaría la serie a años luz del mercado, así que el lote se
     descarta y se reintenta en el siguiente ciclo. */
  if (Math.abs(f - 1) > 0.05) {
    log('AVISO', `${s}: lote del bróker descartado — ${(Math.abs(f - 1) * 100).toFixed(2)} % fuera del precio vivo`);
    return [];
  }
  /* La desviación es permanente, así que el aviso se limita a uno cada
     10 min por símbolo en vez de 4 por minuto. */
  const ahora = Date.now();
  if (ahora - (_ultimoAvisoAnclaje.get(s) || 0) > 600000) {
    _ultimoAvisoAnclaje.set(s, ahora);
    log('AVISO', `${s}: histórico del bróker ${(Math.abs(f - 1) * 100).toFixed(2)} % desviado del precio vivo — anclado`);
  }
  return velas.map((v) => ({ ...v, o: v.o * f, h: v.h * f, l: v.l * f, c: v.c * f }));
};

const unirVelas = (viejas, nuevas) => {
  const m = new Map();
  for (const v of viejas) m.set(v.t, v);
  for (const v of nuevas) m.set(v.t, v);
  const { velas, fuera } = depurarEscala([...m.values()].sort((a, b) => a.t - b.t));
  if (fuera) log('AVISO', `descartadas ${fuera} velas con precio de otro instrumento`);
  return velas;
};

/* Recalcula la raya de un (símbolo, TF). Se llama al sembrar y, sobre todo,
   cada vez que CIERRA una vela de esa temporalidad: así la raya va naciendo y
   corriéndose con el mercado sin parpadear con cada tick. */
function revisarRayas(s, tf) {
  if (!RAYAS_ENABLED) return;
  const hist = (estrategia.historia(s) || {})[tf] || [];
  if (hist.length < 60) return;
  const v = vigiaDe(s, tf);
  const { eventos } = v.revisar(hist);
  stats.velasRayadas = (stats.velasRayadas || 0) + 1;
  for (const ev of eventos) {
    log('RAYA', `${ev.clase} ${ev.lado} ${s} ${tf} precio=${ev.precio}`);
    if (!SIN_TELEGRAM && telegramConfigurado() && TFS_TELEGRAM.includes(tf)) {
      const texto = formatearRaya(ev);
      const prioridad = ev.clase === 'toque' ? 0 : 1;
      enviarTelegram(texto, { prioridad }).catch((e) => log('AVISO', 'telegram raya: ' + e.message));
    }
  }
}

/* `opts.tfs`   limita el ciclo a esas temporalidades (el ciclo rápido usa M1/M5).
   `opts.quiet`  silencia el ruido de un ciclo que no trae velas nuevas.
   `opts.pausa`  separación entre peticiones: 2 s en el pase completo (lotes
                 grandes), 300 ms en el rápido (respuestas incrementales). */
async function resembrar(opts = {}) {
  if (stats.resembrando) return;
  /* Si el feed está caído, no resembrar: pedirVelas devuelve null y solo
     se generan logs engañosos de «sembrado terminado — motor en marcha».
     El resembrar se reanuda solo cuando el bróker vuelva a estar listo. */
  if (cliente.etapa !== 'listo') { log('AVISO', 'motor desconectado — se omite resembrar hasta reconectar'); return; }
  const QUIET = opts.quiet === true;
  const PAUSA = Number.isFinite(opts.pausa) ? opts.pausa : 2000;
  stats.resembrando = true;
  let huboBackfill = false;
  try {
    if (!QUIET) log('INFO', `sembrando ${simbolosActivos.length} símbolos (${TFS_ESCANEO.join('/')})...`);
    /* TF-major: primero el M5 de todos los símbolos (el que antes puede operar) */
    /* Mínimo de velas para que escanear() pueda correr: emaFondo (100) + 5.
       Si hay menos, el motor nunca emite en esa serie (devuelve vacío). */
    const MIN_VELAS = 105;
    /* El TF de referencia se siembra PRIMERO: si M1 se evaluara antes de que
       exista el H1, el filtro de tendencia mayor no tendría con qué comparar. */
    /* Primera siembra: el TF de tendencia primero y después de mayor a menor,
       para que el M5 quede operativo cuanto antes. Refrescos posteriores: el
       TF de tendencia primero (barato, solo velas nuevas) y luego M1/M5, que
       son los que cambian cada minuto y no pueden esperar a M15/H1. */
    const ORDEN_INICIAL = [estrategia.tfTendencia, ...TFS_ESCANEO.filter((tf) => tf !== estrategia.tfTendencia)];
    /* El refresco incluye todos los TF, pero la comprobación `fresco` de más
       abajo evita pedir los que no han cambiado: en un minuto normal solo
       M1 (y M5 al cerrar) generan petición. Se mantienen todos para poder
       recuperar huecos de M15/M30/H1 tras una caída del feed. */
    const ORDEN_REFRESCO = [...new Set([estrategia.tfTendencia, 'M1', 'M5', 'M15', 'M30', 'H1', 'H4']
      .filter((tf) => TFS_ESCANEO.includes(tf)))];
    /* El ciclo rápido solo toca las temporalidades que acaban de cerrar. */
    const orden = stats.sembrado ? ORDEN_REFRESCO : ORDEN_INICIAL;
    const ORDEN_SIEMBRA = Array.isArray(opts.tfs)
      ? orden.filter((tf) => opts.tfs.includes(tf))
      : orden;
    for (const tf of ORDEN_SIEMBRA) {
      if (!TFS[tf]) continue;
      /* Si el feed cae a mitad del ciclo, no tiene sentido seguir pidiendo:
         pedirVelas devuelve null y solo se genera ruido ("backfill vacío"). */
      if (cliente.etapa !== 'listo') break;
      for (const s of simbolosActivos) {
        if (cliente.etapa !== 'listo') break;
        const previas = (estrategia.historia(s) || {})[tf] || [];
        const ultima = previas.length ? previas[previas.length - 1].t : 0;
        const seg = TFS[tf] || 900;
        const segMs = seg * 1000;
        /* Fresco = ya tenemos la última vela cerrada que debería existir.
           La referencia se calcula desde el reloj (cierre del periodo actual
           menos un periodo), no desde la última vela en memoria: así el
           resultado no depende de si la serie incluye o no la vela en
           formación, que es lo que hacía que M1 se re-pidiera cada minuto y
           H1 se re-pidiera tras cada hora. */
        const aperturaUltimaCerrada = Math.floor(Date.now() / segMs) * segMs - segMs;
        const fresco = previas.length > 0 && previas[previas.length - 1].t >= aperturaUltimaCerrada;
        const suficiente = previas.length >= MIN_VELAS;
        /* Si la serie está fresca Y tiene suficiente historia, no hace falta
           pedir nada. En cualquier otro caso (serie corta/poisoned, o vela
           vieja) se pide. Cuando falta historia se pide SIEMPRE el mes
           completo (desde=0), porque un fetch incremental desde `ultima`
           solo traería las pocas velas que faltan y nunca completaría la serie. */
        if (fresco && suficiente) continue;
        const forzarCompleto = !suficiente;
        const desde = (suficiente && ultima) ? Math.floor(ultima / 1000) : 0;
        // Pausa para no rate-limitar al servidor (10024 TOO_MANY_REQUESTS)
        await new Promise((ok) => setTimeout(ok, PAUSA));
        const r = await cliente.pedirVelas(s, { tf, dias: DIAS_HISTORIA, desde, timeoutMs: desde ? 8000 : 45000 });
        let nuevas = r && r.velas.length ? r.velas : [];
        if (!nuevas.length && desde && cliente.etapa === 'listo') {
          await new Promise((ok) => setTimeout(ok, PAUSA));
          const r2 = await cliente.pedirVelas(s, { tf, dias: DIAS_HISTORIA, timeoutMs: 45000 });
          if (r2 && r2.velas.length) nuevas = r2.velas;
        }
        /* Reintento con mes completo si forzábamos backfill y no llegó nada
           (p. ej. _loteValido rechazó el lote o timeout). Solo si el feed
           sigue vivo: si cayó, reintentar solo alarga el ruido. */
        if (!nuevas.length && forzarCompleto && cliente.etapa === 'listo') {
          log('AVISO', `${tf} ${s}: backfill vacío — reintentando mes completo`);
          await new Promise((ok) => setTimeout(ok, 2000));
          const r3 = await cliente.pedirVelas(s, { tf, dias: DIAS_HISTORIA, desde: 0, timeoutMs: 45000 });
          if (r3 && r3.velas.length) nuevas = r3.velas;
        }
        if (nuevas.length && !consistenteCon(previas, nuevas)) {
          log('AVISO', `${tf} ${s}: lote descartado — el solape no cuadra con la serie en memoria (otro instrumento)`);
          nuevas = [];
        }
        if (nuevas.length) {
          nuevas = anclarAlVivo(s, nuevas);
          /* Ya cerradas no se tocan en un refresco incremental: el anclaje se
             recalcula en cada refresco y reescribiría el OHLC de velas pasadas
             (se vio la vela de 16:05 cambiar de 110.091 a 110.159 después de
             emitida su señal). El bróker sólo aporta lo que aún no tenemos:
             relleno de huecos.
             Pero si la serie es INSUFICIENTE (arranque en frío o recuperación
             tras pérdida de datos), el lote completo (incluidas las velas más
             antiguas) tiene que entrar: si solo se añaden las más nuevas, la
             historia nunca se completa y cada reinicio vuelve a empezar. */
          const ultimaGuardada = previas.length ? previas[previas.length - 1].t : -Infinity;
          const aAgregar = forzarCompleto
            ? nuevas
            : nuevas.filter((v) => v.t > ultimaGuardada);
          if (!aAgregar.length) continue;
          estrategia.setHistoria(s, tf, unirVelas(previas, aAgregar));
          const total = (estrategia.historia(s) || {})[tf]?.length || 0;
          log('INFO', `${tf} ${s}: ${previas.length} en memoria + ${nuevas.length} nuevas = ${total} total${total < MIN_VELAS ? '  ⚠️ INSUFICIENTE' : ''}`);
          /* Si se completó una historia que antes era corta, se persiste ya:
             así un reinicio no vuelve a descargar desde cero (mala conexión). */
          if (forzarCompleto && total >= MIN_VELAS) huboBackfill = true;
        } else if (!previas.length) {
          log('AVISO', `${tf} ${s}: sin respuesta — se calienta con ticks en vivo`);
        } else if (!QUIET && cliente.etapa === 'listo') {
          log('AVISO', `${tf} ${s}: sin velas nuevas (quedan ${previas.length} en memoria)`);
        } else if (!QUIET) {
          log('AVISO', `${tf} ${s}: sin descarga (feed caído) — quedan ${previas.length} en memoria`);
        }
        await new Promise((r2) => setTimeout(r2, QUIET ? 0 : 500));
      }
    }
    /* Rayas: desactivadas por defecto (el motor trabaja solo con RAPTOR). */
    if (RAYAS_ENABLED) {
      for (const tf of TFS_ESCANEO) {
        if (!TF_RAYA_SET.has(tf)) continue;
        for (const s of simbolosActivos) revisarRayas(s, tf);
      }
    }
    if (huboBackfill) { try { estrategia.guardar(); log('INFO', 'estado persistido tras completar historia'); } catch (e) {} }
    if (!QUIET) log('INFO', 'sembrado terminado — motor en marcha');
    stats.sembrado = true;
    /* El guardado va con freno en _guardarDebounced(); aquí ya no se
       reescriben 20 MB en cada pase completo. */
  } finally {
    stats.resembrando = false;
  }
}

outbox.cargar();
const emitidasRecientes = outbox.emitidasRecientes();
estrategia.sembrarEmitidas(emitidasRecientes);
/* Recupera el lado ya enviado de cada vela para no contradecirlo al reiniciar. */
for (const k of emitidasRecientes) {
  const p = String(k).split('|');
  if (p.length >= 5 && (p[4] === 'COMPRA' || p[4] === 'VENTA')) {
    ladoPorVela.set(`${p[0]}|${p[1]}|${p[2]}`, p[4]);
  }
}
const pendientesArranque = outbox.pendientes();
if (!SOLO_RAYAS && pendientesArranque.length && !SIN_TELEGRAM) {
  /* Un pendiente de hace horas ya no es operable: se descarta en vez de
     mandarlo al móvil como si fuera nuevo. */
  const maxEdadMin = Number(process.env.MS_OUTBOX_MAX_EDAD_MIN) || 15;
  const corte = Date.now() - maxEdadMin * 60000;
  log('INFO', `reenviando ${pendientesArranque.length} señales pendientes de entrega`);
  (async () => {
    for (const p of pendientesArranque) {
      if (Number.isFinite(p.desde) && p.desde < corte) {
        outbox.entregada(p.clave);
        log('AVISO', `pendiente ${p.clave} descartado: ${Math.round((Date.now() - p.desde) / 60000)} min de antigüedad`);
        continue;
      }
      const r = await enviarTelegram(p.texto, { prioridad: p.prioridad || 0 });
      if (r.ok) outbox.entregada(p.clave);
      else log('AVISO', `pendiente ${p.clave} sigue sin entregar: ${r.motivo || r.error}`);
    }
  })();
}

cliente.on('tick', (t) => {
  stats.ticks++;
  stats.ticksUltimoMin.push(t.t);
  ultimoTickPorSimbolo.set(t.simbolo, t.t);
  estrategia.onTick(t.simbolo, t.bid, t.ask, t.t);
});

/* El núcleo avisa cuando una vela queda cerrada: se recalcula solo esa
   (símbolo, TF), de modo que la raya se agrega/estira vela a vela. */
estrategia.on('vela', ({ simbolo, tf }) => {
  if (!RAYAS_ENABLED || !TF_RAYA_SET.has(tf)) return;
  try { revisarRayas(simbolo, tf); } catch (e) { log('AVISO', `raya ${simbolo} ${tf}: ${e.message}`); }
});

cliente.on('listo', async ({ simbolos }) => {
  espera = 10000;   // reconexión exitosa: reinicia el backoff
  simbolosActivos = SIMBOLOS_ENV.length ? simbolos.filter((s) => SIMBOLOS_ENV.includes(s)) : simbolos;
  stats.simbolos = simbolosActivos.length;
  /* Identidad del instrumento: el terminal devuelve el catálogo con nombre e
     id. Dos símbolos parecidos (p. ej. con sufijo .r) cotizan a niveles
     distintos y cmd 11 no dice de cuál son las velas; sin esta lista no hay
     forma de saber cuál se está leyendo. */
  const catalogo = Object.values(cliente.nombres)
    .filter((n) => /Vol\s*(1|2|3|4)0/i.test(n)).sort();
  log('INFO', `catálogo Vol: ${catalogo.map((n) => `${n}#${cliente.ids[n]}${simbolosActivos.includes(n) ? '*' : ''}`).join(' · ')}`);
  await resembrar();
});

cliente.on('aviso', (m) => log('INFO', m));

/* Refresco continuo alineado al cierre de vela: a los 3 s del minuto, no a
   los 60 s desde que arrancó el proceso. Así una vela M1/M5 se pide cuando ya
   cerró y no 20–60 s después. Se reprograma al terminar cada ciclo para no
   solapar dos `resembrar()` si el bróker tarda. */
let timerRefresco = null;
/* Ciclo rápido: cada 15 s, alineado a :02, :17, :32 y :47.
   El primer pase de cada minuto cae 2 s después del cierre de la vela M1 (antes
   se esperaba al minuto siguiente y en el peor caso la vela llegaba 60 s
   tarde); los tres siguientes solo confirman revisiones del bróker sin coste
   extra porque la respuesta incremental viene vacía. M5 entra por la misma
   puerta en cuanto su vela cierra. */
function programarRefrescoRapido() {
  const ahora = Date.now();
  const PERIODO = 15000;
  const FASE = 2000;
  const siguiente = (Math.floor((ahora - FASE) / PERIODO) + 1) * PERIODO + FASE;
  timerRefresco = setTimeout(async () => {
    try { await resembrar({ tfs: ['M1', 'M5'], quiet: true, pausa: 300 }); }
    catch (e) { log('AVISO', 'refresco rápido: ' + e.message); }
    programarRefrescoRapido();
  }, Math.max(300, siguiente - ahora));
}
programarRefrescoRapido();

/* Pase completo cada 5 min: recupera huecos de M15/M30/H1 tras una caída y
   revisa lo que el ciclo rápido no toca. La comprobación `fresco` hace que,
   en marcha normal, no genere ninguna petición. */
function programarRefrescoCompleto() {
  const ahora = Date.now();
  const PERIODO = 300000;
  const siguiente = (Math.floor(ahora / PERIODO) + 1) * PERIODO + 5000;
  setTimeout(async () => {
    try { await resembrar({ quiet: true }); }
    catch (e) { log('AVISO', 'refresco completo: ' + e.message); }
    programarRefrescoCompleto();
  }, Math.max(1000, siguiente - ahora));
}
programarRefrescoCompleto();

/* ---------- reconexión ---------- */
/* Sin reconexión proactiva: cortar una sesión sana cada 15 min solo añadía
   riesgo (y con la clave de sesión vieja dejaba el motor en bucle de 1006).
   Si el socket se queda mudo, el detector del cliente (25 s sin recibir nada,
   ni siquiera el keep-alive) lo marca como feed muerto, cierra y este bloque
   reconecta con backoff. */
let credRechazadas = false;
let espera = 10000;
let tReconexion = null;
const arrancar = () => cliente.conectar();
cliente.on('login_rechazado', ({ dd }) => {
  credRechazadas = true;
  log('ERROR', `login rechazado (dd=${dd}) — credenciales o servidor inválidos. SIN reconexión automática: corrige .env y reinicia.`);
});
cliente.on('cerrar', () => {
  if (credRechazadas) { log('AVISO', 'parado: credenciales rechazadas (sin reintento automático)'); return; }
  stats.reconexiones++;
  /* Socket mudo (25 s sin recibir ni el keep-alive): reintento rápido. El
     backoff creciente (30 s → 60 → 120 → 240 → 300, y vuelve a 30 al conectar)
     ya evita la tormenta si el servidor está caído. Los 5 min que había aquí
     venían de las tormentas de 1006, que eran el bug de la clave de sesión. */
  const feedMuerto = cliente._feedMuerto === true;
  if (feedMuerto) {
    log('AVISO', 'feed muerto (silencio del socket) — reintento en 30 s');
    espera = 30000;
  }
  log('AVISO', `sesión cerrada — reconectando en ${Math.round(espera / 1000)} s...`);
  clearTimeout(tReconexion);
  tReconexion = setTimeout(() => { espera = Math.min(300000, espera * 2); arrancar(); }, espera);
});

(async () => {
  await crearServidor(() => ({
    uptime_s: Math.floor((Date.now() - stats.iniciado) / 1000),
    conexion: cliente.etapa,
    motor: 'video-03',
    telegram: telegramConfigurado() && !SIN_TELEGRAM ? 'activo' : 'desactivado',
    ticksTotales: stats.ticks,
    ticksPorMinuto: (stats.ticksUltimoMin = stats.ticksUltimoMin.filter((t) => t > Date.now() - 60e3)).length,
    senalesHoy: stats.senales,
    reconexiones: stats.reconexiones,
    ultimaSenal: stats.ultimaSenal,
    latenciaMs: {
      ultima: stats.ultimaSenal ? stats.ultimaSenal.latenciaMs ?? null : null,
      p50: stats.latencias.length
        ? [...stats.latencias].sort((a, b) => a - b)[Math.floor((stats.latencias.length - 1) * 0.5)]
        : null,
      n: stats.latencias.length,
    },
    nucleo: estrategia.stats,
    telegramEstado: { ...estadoTelegram(), configurado: telegramConfigurado() && !SIN_TELEGRAM },
    urgente: { ...estadoUrgente(), configurado: ntfyConfigurado() },
    entrega: { tfs: TFS_TELEGRAM, filtradas: stats.filtradas },
    outbox: outbox.tamano(),
    parametros: estrategia.p,
    simbolos: Object.fromEntries(Object.entries(estrategia.resumen()).map(([s, v]) => [s, {
      ...v,
      /* Precio VIVO del terminal (media bid/ask del último tick). Las velas
         vienen de cmd 11, que no dice de qué símbolo son: si el vivo y el
         último cierre no cuadran, las velas son de otro instrumento. */
      vivo: Number.isFinite(cliente._ultimoPrecio?.[s]) ? cliente._ultimoPrecio[s] : null,
    }])),
    rayas: [...vigias.entries()].map(([k, v]) => ({ key: k, raya: v._ultimaRaya })),
  }), Number(process.env.PORT || 3000), (simbodo, tf) => {
    const hist = (estrategia.historia(simbodo) || {})[tf];
    if (!hist || !hist.length) return null;
    const ultima = hist[hist.length - 1];
    const clave = `${simbodo}|${tf}|${hist.length}|${ultima.t}|${ultima.c}`;
    const ahora = Date.now();
    const enCache = cacheVelas.get(clave);
    if (enCache && ahora - enCache.t < MS_CACHE_VELAS_MS) {
      return { simbodo, tf, velas: hist, zonas: enCache.zonas, senales: enCache.senales };
    }
    /* Solo lo que la gráfica consume: zonas horizontales + catálogo de
       señales. Antes se calculaban además rayas, eventos, casos, referencias
       y tendencia para tirarlos acto seguido: ~40 ms por petición. */
    const zonas = (function () { try { return zonasDe(hist, 3); } catch (e) { return []; } })();
    const senales = (function () { try { return estrategia.senalesRecientes(simbodo, tf); } catch (e) { return []; } })();
    cacheVelas.set(clave, { t: ahora, zonas, senales });
    /* La clave cambia con cada vela; sin tope el mapa crecería con el
       histórico. 64 entradas cubren de sobra 4 símbolos × 7 TFs. */
    if (cacheVelas.size > 64) cacheVelas.delete(cacheVelas.keys().next().value);
    return { simbodo, tf, velas: hist, zonas, senales };
  }
  );
  log('INFO', `HTTP /salud y /estado en puerto ${process.env.PORT || 3000}`);
})();

/* ---------- red de seguridad de proceso ---------- */
/* Ningún throw inesperado puede dejar el motor parado en silencio. En un
   fallo fatal se registra el stack, se persiste el estado y se sale con
   código 1 para que supervisor.sh (o systemd/pm2) lo relance. Una promesa
   rechazada suelta se registra pero no se mata el proceso: normalmente viene
   de un .then de envío y no implica corrupción del histórico. */
let _saliendoPorFallo = false;
function _falloFatal(etiqueta, err) {
  if (_saliendoPorFallo) return;
  _saliendoPorFallo = true;
  try { log('ERROR', `${etiqueta}: ${err && (err.stack || err.message) || err}`); } catch (e) { /* consola rota */ }
  try { estrategia.destruir(); } catch (e) { /* guardado best-effort */ }
  try { cliente.cerrar(); } catch (e) { /* socket ya cerrado */ }
  process.exit(1);
}
process.on('uncaughtException', (e) => _falloFatal('uncaughtException', e));
process.on('unhandledRejection', (e) => {
  try { log('ERROR', `unhandledRejection: ${e && (e.stack || e.message) || e}`); } catch (err) { /* consola rota */ }
});

process.on('SIGTERM', () => { log('INFO', 'SIGTERM — cerrando'); estrategia.destruir(); cliente.cerrar(); process.exit(0); });
process.on('SIGINT', () => { log('INFO', 'SIGINT — cerrando'); estrategia.destruir(); cliente.cerrar(); process.exit(0); });

if (!SIN_TELEGRAM && !telegramConfigurado()) {
  log('AVISO', 'TELEGRAM_TOKEN o TELEGRAM_CHAT sin definir en .env — las señales se quedan en consola, NO llegan a Telegram');
}
log('INFO', `motor v03 iniciado (cuenta ${cliente.login} @ ${cliente.host}, telegram: ${SIN_TELEGRAM ? 'off' : telegramConfigurado() ? 'on' : 'sin configurar'}, TF: ${TFS_ESCANEO.join('/')}, al móvil: ${TFS_TELEGRAM.join('/')}, modo: ${SOLO_RAYAS ? 'SOLO RAYAS' : 'completo'})`);
arrancar();
