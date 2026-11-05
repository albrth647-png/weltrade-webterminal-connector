'use strict';
/* ============================================================
   MOTOR DE SEÑALES — punto de entrada
   ------------------------------------------------------------
   cliente_mt5 (ticks + velas H1)  →  estrategia (señales)
        →  consola + Telegram + HTTP /salud /estado
   Reconexión automática con backoff 3 s → 30 s.
   Uso:  node app.js     (lee .env de esta carpeta)
   ============================================================ */
const { ClienteMT5 } = require('./cliente_mt5');
const { Estrategia } = require('./estrategia');
const { crearServidor } = require('./servidor');
const { enviarTelegram, formatearSenal, telegramConfigurado } = require('./telegram');

const SIMBOLOS = (process.env.MS_SIMBOLOS || '').split(',').map((s) => s.trim()).filter(Boolean);
const SIN_TELEGRAM = process.env.MS_SIN_TELEGRAM === '1';
const VERBOSO = process.env.MS_VERBOSO === '1';

const log = (nivel, msg, extra) => {
  const linea = `[${new Date().toISOString()}] [${nivel}] ${msg}`;
  console.log(extra !== undefined ? linea + ' ' + JSON.stringify(extra) : linea);
};

// ---------- estado global para /estado ----------
const stats = {
  iniciado: Date.now(),
  ticks: 0, ticksUltimoMin: [], senales: 0, tn: 0, reconexiones: 0,
  ultimaSenal: null, ultimosAvisos: [],
};

// ---------- módulos ----------
const cliente = new ClienteMT5({
  filtro: SIMBOLOS.length
    ? new RegExp('^(' + SIMBOLOS.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')$', 'i')
    : undefined,
});
const estrategia = new Estrategia({
  scoreMin: Number(process.env.MS_SCORE_MIN || 60),
  dedupMin: Number(process.env.MS_DEDUP_MIN || 45),
});

// cliente -> estrategia
cliente.on('tick', (t) => {
  stats.ticks++;
  stats.ticksUltimoMin.push(t.t);
  estrategia.onTick(t.simbolo, t.bid, t.ask, t.t);
});

cliente.on('listo', async ({ simbolos }) => {
  const PLAN = [['H1', 90], ['M15', 15], ['M5', 3]];   // [tf, días de historia]
  log('INFO', `sembrando historial de ${simbolos.length} símbolos (H1/M15/M5 vía cmd 11)...`);
  for (const s of simbolos) {
    for (const [tf, dias] of PLAN) {
      const r = await cliente.pedirVelas(s, { tf, dias });
      if (r && r.velas.length) {
        estrategia.setHistoria(s, tf, r.velas);
        log('INFO', `${tf} ${s}: ${r.velas.length} velas (${r.descartadas} descartadas)`);
      } else {
        log('AVISO', `${tf} ${s}: sin respuesta — se calienta con ticks en vivo`);
      }
      await new Promise((r2) => setTimeout(r2, 350)); // espaciado entre peticiones
    }
  }
  log('INFO', 'sembrado terminado — motor en marcha');
});

// estrategia -> salida
estrategia.on('senal', async (s) => {
  stats.senales++;
  stats.ultimaSenal = s;
  log('SEÑAL', `${s.lado} ${s.simbolo} fase=${s.fase} score=${s.score} nivel=${s.nivel} precio=${s.precio} sl=${s.sl} tp=${s.tp}`);
  if (!SIN_TELEGRAM) {
    const r = await enviarTelegram(formatearSenal(s));
    if (!r.ok) log('AVISO', 'telegram falló: ' + (r.motivo || r.error));
  }
});
estrategia.on('tn', (ev) => {
  stats.tn++;
  log('TN', `${ev.simbolo} zona ${ev.zona.tipo} ${ev.zona.nivel} cancelada (${ev.motivo})`);
});
estrategia.on('toque', (ev) => { if (VERBOSO) log('TOQUE', `${ev.simbolo} ${ev.fase} en ${ev.zona.tipo} ${ev.zona.nivel}`); });
estrategia.on('zona', (ev) => { if (VERBOSO) log('ZONA', `${ev.simbolo} ${ev.evento}: ${ev.zona.tipo} ${ev.zona.nivel} (fuerza ${ev.zona.fuerza})`); });
estrategia.on('aviso', (m) => log('AVISO', m));
cliente.on('aviso', (m) => log('INFO', m));
cliente.on('cerrar', () => {
  stats.reconexiones++;
  log('AVISO', 'sesión cerrada — reconectando...');
});

// ---------- servidor HTTP ----------
(async () => {
  await crearServidor(() => ({
    uptime_s: Math.floor((Date.now() - stats.iniciado) / 1000),
    conexion: cliente.etapa,
    telegram: telegramConfigurado() && !SIN_TELEGRAM ? 'activo' : 'desactivado',
    ticksTotales: stats.ticks,
    ticksPorMinuto: (stats.ticksUltimoMin = stats.ticksUltimoMin.filter((t) => t > Date.now() - 60e3)).length,
    senalesHoy: stats.senales, tn: stats.tn, reconexiones: stats.reconexiones,
    ultimaSenal: stats.ultimaSenal,
    simbolos: estrategia.resumen(),
  }));
  log('INFO', `HTTP /salud y /estado en puerto ${process.env.PORT || 3000}`);
})();

// ---------- bucle de reconexión ----------
let espera = 3000;
function arrancar() {
  cliente.conectar();
}
cliente.on('cerrar', () => {
  setTimeout(() => { espera = Math.min(30000, espera * 1.5); arrancar(); }, espera);
});

process.on('SIGTERM', () => { log('INFO', 'SIGTERM — cerrando'); cliente.cerrar(); process.exit(0); });
process.on('SIGINT', () => { log('INFO', 'SIGINT — cerrando'); cliente.cerrar(); process.exit(0); });

log('INFO', `motor de señales iniciado (cuenta ${cliente.login} @ ${cliente.host}, telegram: ${SIN_TELEGRAM ? 'off' : telegramConfigurado() ? 'on' : 'sin configurar'})`);
arrancar();
