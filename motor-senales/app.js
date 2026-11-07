'use strict';
/* ============================================================
   MOTOR DE SEÑALES — punto de entrada
   ------------------------------------------------------------
   gestor_estrategia (DOCUMENTO activo, sin estrategia en código)
     → estrategia (vocabulario genérico)  ←  cliente_mt5 (ticks + velas)
         → consola + Telegram + web con botón de importación
   Reconexión automática con backoff 3 s → 30 s.
   Cambiar de estrategia NO toca código: botón en la web ("/"),
   o edita estrategias/activa.json y reinicia.
   Uso:  node app.js     (lee .env de esta carpeta)
   ============================================================ */
const { ClienteMT5 } = require('./cliente_mt5');
const { Estrategia, TFS } = require('./estrategia');
const { docACfg, resumenDoc } = require('./doc_estrategia');
const { GestorEstrategia } = require('./gestor_estrategia');
const { crearServidor } = require('./servidor');
const { enviarTelegram, formatearSenal, telegramConfigurado } = require('./telegram');

const SIMBOLOS_ENV = (process.env.MS_SIMBOLOS || '').split(',').map((s) => s.trim()).filter(Boolean);
const SIN_TELEGRAM = process.env.MS_SIN_TELEGRAM === '1';
const VERBOSO = process.env.MS_VERBOSO === '1';

// días de historia por TF para la siembra (operativo, no estratégico)
const DIAS_SEMILLA = { M1: 2, M5: 3, M15: 15, M30: 40, H1: 90, H4: 180, D1: 365 };
const SEG_TF = { M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400 };

const log = (nivel, msg, extra) => {
  const linea = `[${new Date().toISOString()}] [${nivel}] ${msg}`;
  console.log(extra !== undefined ? linea + ' ' + JSON.stringify(extra) : linea);
};

// ---------- estado global para /estado ----------
const stats = {
  iniciado: Date.now(),
  ticks: 0, ticksUltimoMin: [], senales: 0, tn: 0, reconexiones: 0,
  ultimaSenal: null, estrategia: null, fuenteEstrategia: '', resembrando: false,
};

// ---------- módulos ----------
const cliente = new ClienteMT5({
  filtro: SIMBOLOS_ENV.length
    ? new RegExp('^(' + SIMBOLOS_ENV.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')$', 'i')
    : undefined,
});
const gestor = new GestorEstrategia();
let simbolosActivos = [];
let estrategia = null;

// ---------- ciclo de vida de la estrategia (se construye SOLO desde documentos) ----------
function construirEstrategia(doc) {
  if (estrategia) estrategia.removeAllListeners();
  const e = new Estrategia(docACfg(doc));
  e.on('senal', async (s) => {
    stats.senales++;
    stats.ultimaSenal = s;
    log('SEÑAL', `${s.lado} ${s.simbolo} fase=${s.fase} score=${s.score} nivel=${s.nivel} precio=${s.precio} sl=${s.sl} tp=${s.tp}`);
    if (!SIN_TELEGRAM) {
      const r = await enviarTelegram(formatearSenal(s));
      if (!r.ok) log('AVISO', 'telegram falló: ' + (r.motivo || r.error));
    }
  });
  e.on('tn', (ev) => { stats.tn++; log('TN', `${ev.simbolo} zona ${ev.zona.tipo} ${ev.zona.nivel} cancelada (${ev.motivo})`); });
  e.on('toque', (ev) => { if (VERBOSO) log('TOQUE', `${ev.simbolo} ${ev.fase} en ${ev.zona.tipo} ${ev.zona.nivel}`); });
  e.on('zona', (ev) => { if (VERBOSO) log('ZONA', `${ev.simbolo} ${ev.evento}: ${ev.zona.tipo} ${ev.zona.nivel} (fuerza ${ev.zona.fuerza})`); });
  e.on('aviso', (m) => log('AVISO', m));
  return e;
}

function unirVelas(viejas, nuevas) {
  const m = new Map();
  for (const v of viejas) m.set(v.t, v);
  for (const v of nuevas) m.set(v.t, v);   // si repite t, manda la del servidor
  return [...m.values()].sort((a, b) => a.t - b.t);
}

async function resembrar() {
  if (stats.resembrando) return;
  stats.resembrando = true;
  try {
    const doc = gestor.actual().doc;
    const tfs = [...new Set([doc.sesgo.tf, doc.zonas.tf, doc.toques.tf])].filter((tf) => TFS[tf]);
    const plan = tfs.map((tf) => [tf, DIAS_SEMILLA[tf] || 15]);
    log('INFO', `sembrando historial de ${simbolosActivos.length} símbolos (${plan.map((p) => p[0]).join('/')}) para "${doc.meta.nombre}"...`);
    for (const s of simbolosActivos) {
      for (const [tf, dias] of plan) {
        /* re-sembrado INCREMENTAL: tras una reconexión el búfer en memoria
           sigue vivo — solo se piden las velas posteriores a la última
           (antes se redescargaban los días completos en CADA reconexión) */
        const previas = (estrategia.historia(s) || {})[tf] || [];
        const ultima = previas.length ? previas[previas.length - 1].t : 0;
        if (previas.length && Date.now() - ultima < (SEG_TF[tf] || 900) * 1000) continue;   // caché al día
        const desde = ultima ? Math.floor(ultima / 1000) + 1 : 0;
        const r = await cliente.pedirVelas(s, { tf, dias, desde, timeoutMs: desde ? 4000 : 10000 });
        let nuevas = r && r.velas.length ? r.velas : [];
        if (!nuevas.length && desde) {
          const r2 = await cliente.pedirVelas(s, { tf, dias, timeoutMs: 6000 });   // reintento único
          if (r2 && r2.velas.length) nuevas = r2.velas;
        }
        if (nuevas.length) {
          estrategia.setHistoria(s, tf, unirVelas(previas, nuevas));   // setHistoria recorta la vela formándose
          log('INFO', `${tf} ${s}: ${previas.length} en memoria + ${nuevas.length} nuevas`);
        } else if (!previas.length) {
          log('AVISO', `${tf} ${s}: sin respuesta — se calienta con ticks en vivo`);
        }
        await new Promise((r2) => setTimeout(r2, 350)); // espaciado entre peticiones
      }
    }
    log('INFO', 'sembrado terminado — motor en marcha');
  } finally {
    stats.resembrando = false;
  }
}

// arranque con el documento activo
estrategia = construirEstrategia(gestor.actual().doc);
stats.estrategia = resumenDoc(gestor.actual().doc);
stats.fuenteEstrategia = gestor.actual().fuente;
log('INFO', `estrategia activa: "${gestor.actual().doc.meta.nombre}" (${gestor.actual().fuente})`);
const SIMBOLOS = gestor.actual().doc.simbolos.length ? gestor.actual().doc.simbolos : SIMBOLOS_ENV;

// cliente -> estrategia (siempre la instancia vigente)
cliente.on('tick', (t) => {
  stats.ticks++;
  stats.ticksUltimoMin.push(t.t);
  estrategia.onTick(t.simbolo, t.bid, t.ask, t.t);
});

cliente.on('listo', async ({ simbolos }) => {
  simbolosActivos = simbolos;
  await resembrar();
});

// nuevo documento activado desde la web -> estrategia nueva + re-siembra
gestor.on('cambio', async (doc) => {
  log('INFO', `estrategia reemplazada desde la web: "${doc.meta.nombre}" — reconstruyendo motor y re-sembrando...`);
  estrategia = construirEstrategia(doc);
  stats.estrategia = resumenDoc(doc);
  stats.fuenteEstrategia = gestor.actual().fuente;
  if (doc.simbolos.length && doc.simbolos.join('|') !== simbolosActivos.join('|')) {
    log('AVISO', 'el documento trae una lista de símbolos distinta: se aplicará por completo en el próximo reinicio del proceso');
  }
  await resembrar();
});

cliente.on('aviso', (m) => log('INFO', m));

// ---------- bucle de reconexión ----------
/* Un login rechazado NO es una caída de red: no se reintenta en bucle
   (evita martillear el servidor y arriesgar bloqueo de cuenta).
   Estado terminal: corrige .env y reinicia el proceso.
   UN solo handler de 'cerrar': antes había dos (uno contaba y otro
   reconectaba) y el doble emit del cliente los disparaba en cascada. */
let credRechazadas = false;
let espera = 3000;
let tReconexion = null;
function arrancar() {
  cliente.conectar();
}
cliente.on('login_rechazado', ({ dd }) => {
  credRechazadas = true;
  log('ERROR', `login rechazado (dd=${dd}) — credenciales o servidor inválidos. SIN reconexión automática: corrige .env y reinicia.`);
});
cliente.on('cerrar', () => {
  if (credRechazadas) { log('AVISO', 'parado: credenciales rechazadas (sin reintento automático)'); return; }
  stats.reconexiones++;
  log('AVISO', 'sesión cerrada — reconectando...');
  clearTimeout(tReconexion);   // UN solo temporizador, nunca dos en carrera
  tReconexion = setTimeout(() => { espera = Math.min(30000, espera * 1.5); arrancar(); }, espera);
});
(async () => {
  await crearServidor(() => ({
    uptime_s: Math.floor((Date.now() - stats.iniciado) / 1000),
    conexion: cliente.etapa,
    telegram: telegramConfigurado() && !SIN_TELEGRAM ? 'activo' : 'desactivado',
    ticksTotales: stats.ticks,
    ticksPorMinuto: (stats.ticksUltimoMin = stats.ticksUltimoMin.filter((t) => t > Date.now() - 60e3)).length,
    senalesHoy: stats.senales, tn: stats.tn, reconexiones: stats.reconexiones,
    ultimaSenal: stats.ultimaSenal,
    estrategia: stats.estrategia,
    fuenteEstrategia: stats.fuenteEstrategia,
    simbolos: estrategia ? estrategia.resumen() : {},
  }), gestor);
  log('INFO', `HTTP / (panel), /salud y /estado en puerto ${process.env.PORT || 3000}`);
})();

// ---------- bucle de reconexión ----------
/* (el handler único de 'cerrar' está más arriba, junto al resto de
   cableados del cliente: UNA suscripción, UN temporizador) */

process.on('SIGTERM', () => { log('INFO', 'SIGTERM — cerrando'); cliente.cerrar(); process.exit(0); });
process.on('SIGINT', () => { log('INFO', 'SIGINT — cerrando'); cliente.cerrar(); process.exit(0); });

log('INFO', `motor de señales iniciado (cuenta ${cliente.login} @ ${cliente.host}, telegram: ${SIN_TELEGRAM ? 'off' : telegramConfigurado() ? 'on' : 'sin configurar'})`);
arrancar();
