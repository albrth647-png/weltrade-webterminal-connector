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
const { EstrategiaHibrida, TF_HIBRIDA } = require('./estrategia_hibrida');
const { docACfg, resumenDoc } = require('./doc_estrategia');
const { GestorEstrategia } = require('./gestor_estrategia');
const { crearServidor } = require('./servidor');
const { enviarTelegram, formatearSenal, formatearAviso, telegramConfigurado, estadoTelegram } = require('./telegram');
const { enviarEntradaUrgente, enviarNivelUrgente, ntfyConfigurado, estadoUrgente } = require('./urgente');
const outbox = require('./outbox');

const SIMBOLOS_ENV = (process.env.MS_SIMBOLOS || '').split(',').map((s) => s.trim()).filter(Boolean);
const SIN_TELEGRAM = process.env.MS_SIN_TELEGRAM === '1';
/* Los TOQUES 1/2/3 (avisos «vigila este nivel») van a Telegram **por defecto**:
   son parte del catálogo del propietario (1/2/3 toque · 1R/2R/3R rompimiento).
   MS_TELEGRAM_TOQUES=0 los silencia y deja el móvil solo con las entradas;
   MS_TELEGRAM_AVISOS=0 (nombre viejo) hace lo mismo. */
const ENVIAR_TOQUES = process.env.MS_TELEGRAM_TOQUES !== '0' && process.env.MS_TELEGRAM_AVISOS !== '0';
/* Etapa 1 de la entrega: aviso de zona EN EL TICK, cuando el precio llega a la
   banda. No es una señal de la estrategia (los toques son 1/2/3 y sus
   rompimientos 1R/2R/3R), es «el nivel está en juego ahora». Va ENCENDIDO
   porque es lo único que llega antes de que el movimiento se haga;
   MS_AVISO_INTRABAR=0 lo apaga. */
const AVISO_INTRABAR = process.env.MS_AVISO_INTRABAR !== '0';
/* Temporalidades que se envían al móvil. Por defecto SOLO M5: es la más rápida
   y la única donde el rompimiento todavía se puede tomar (un 2RB de H1 llega
   2 h después del toque). Las demás se siguen calculando, salen en consola y
   en /estado, y no se envían. MS_TF_VIVO=M5,M15 para ampliar. */
const TF_VIVO = process.env.MS_TF_VIVO || 'M5';
const TFS_TELEGRAM = TF_VIVO.split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
/* Motor de señales: la HÍBRIDA manda (catálogo de Yoel + fases EARLY/MAIN/LATE).
   MS_MOTOR=v1 deja el baseline anterior para comparar. */
const MOTOR = process.env.MS_MOTOR || 'hibrida';
const VERBOSO = process.env.MS_VERBOSO === '1';

/* Historia que se siembra y se conserva: UN MES por temporalidad (regla del
   propietario). El tope real de velas en memoria lo aplica estrategia.js
   (DIAS_RETENCION × velas/día), así que nada crece por encima de 30 días. */
const DIAS_HISTORIA = 30;
const SEG_TF = { M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400 };

const log = (nivel, msg, extra) => {
  const linea = `[${new Date().toISOString()}] [${nivel}] ${msg}`;
  console.log(extra !== undefined ? linea + ' ' + JSON.stringify(extra) : linea);
};

// ---------- estado global para /estado ----------
const stats = {
  iniciado: Date.now(),
  ticks: 0, ticksUltimoMin: [], senales: 0, tn: 0, reconexiones: 0,
  avisos: 0, ultimaAlerta: null, latencias: [], filtradas: 0,
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
  const cfg = docACfg(doc);
  const e = MOTOR === 'v1' ? new Estrategia(cfg) : new EstrategiaHibrida(cfg);
  e.on('senal', async (s) => {
    stats.senales++;
    stats.ultimaSenal = s;
    /* la señal lleva QUÉ estrategia es: 2R, 1R, 3R… (+ fase de zona) */
    const etq = s.patron ? `${s.patron}${s.fase ? ' ' + s.fase : ''}` : `fase=${s.fase}`;
    /* latencia real: cierre de la vela -> motor. Si un día vuelve a crecer
       (escaneo lento, cola de velas, feed atrasado) se ve en el log y en /estado. */
    if (Number.isFinite(s.latenciaMs)) {
      stats.latencias.push(s.latenciaMs);
      if (stats.latencias.length > 500) stats.latencias.shift();
    }
    log('SEÑAL', `${s.lado} ${s.simbolo} ${etq} score=${s.score} precio=${s.precio} latencia=${Number.isFinite(s.latenciaMs) ? s.latenciaMs + ' ms' : '—'} estrategia=${s.estrategia}`);
    /* un 2RB de H1 llega 2 h después del toque: se calcula, se registra, pero
       no se manda al móvil salvo que esté en MS_TF_VIVO */
    const tfSenal = s.tfGatillo || s.tfZona;
    if (tfSenal && !TFS_TELEGRAM.includes(tfSenal)) {
      stats.filtradas++;
      if (VERBOSO) log('INFO', `señal ${tfSenal} no enviada (MS_TF_VIVO=${TF_VIVO})`);
      return;
    }
    if (!SIN_TELEGRAM) {
      const texto = formatearSenal(s);
      try {
        /* outbox: si el envío no confirma, el texto queda en disco y se
           reenvía al arrancar siguiente. La clave de vela impide repetirla. */
        outbox.marcarEmitida(s.clave);
        outbox.pendiente(s.clave, texto, 0);
        const r = await enviarTelegram(texto, { prioridad: 0 });
        if (r.ok) {
          outbox.entregada(s.clave);
          log('ENVÍO', `entregada (message_id ${r.messageId ?? '—'})`);
        } else {
          log('AVISO', 'telegram falló: ' + (r.motivo || r.error) + ' — queda en outbox');
        }
      } catch (err) {
        /* un error inesperado en Telegram no debe caer el motor */
        log('ERROR', `telegram excepción: ${err.message}`);
      }
    }
    /* CARRIL URGENTE: va aparte de Telegram y no se espera. Si Telegram tarda,
       el móvil está en Doze o la cola tiene trabajo, esto suena igual. */
    enviarEntradaUrgente(s).then((r) => {
      if (r.ok) log('ENVÍO', 'carril urgente entregado (ntfy)');
      else if (ntfyConfigurado()) log('AVISO', `carril urgente falló: ${r.motivo || r.error}`);
    });
  });

  /* AVISOS de operación (2/2R/3/3R): «el precio llegó a la zona, ve a buscar
     la entrada». Van por su propio evento: antes se emitían por 'aviso', que
     es el canal de logs y errores, y además se descartaban antes de salir. */
  e.on('alerta', async (a) => {
    if (a.origen === 'intrabar' && !AVISO_INTRABAR) return;   // MS_AVISO_INTRABAR=0 lo apaga
    if (a.tfZona && !TFS_TELEGRAM.includes(a.tfZona)) return;  // mismo filtro que las entradas
    stats.avisos++;
    stats.ultimaAlerta = a;
    const etq = a.origen === 'intrabar' ? 'zona' : `${a.patron}${a.fase ? ' ' + a.fase : ''}`;
    log('ALERTA', `${a.lado} ${a.simbolo} ${etq} (aviso, no entrada) ref=${a.precio} romper=${a.nivelRoto} latencia=${Number.isFinite(a.latenciaMs) ? a.latenciaMs + ' ms' : '—'}`);
    if (ENVIAR_TOQUES && !SIN_TELEGRAM) {
      const texto = formatearAviso(a);
      try {
        /* prioridad 1: los avisos esperan detrás de las entradas. Los intrabar
           no van al outbox (son frecuentes y caducan solos). */
        if (a.origen !== 'intrabar' && a.clave) {
          outbox.marcarEmitida(a.clave);
          outbox.pendiente(a.clave, texto, 1);
        }
        const r = await enviarTelegram(texto, { prioridad: 1 });
        if (r.ok && a.origen !== 'intrabar' && a.clave) outbox.entregada(a.clave);
        if (!r.ok) log('AVISO', 'telegram (alerta) falló: ' + (r.motivo || r.error));
      } catch (err) {
        log('ERROR', `telegram excepción (alerta): ${err.message}`);
      }
    }
    /* Etapa 1 al móvil, en el tick: el nivel está en juego. La confirmación
       (1R/2R/3R, 1S) sigue saliendo al cierre de la vela. */
    if (a.origen === 'intrabar') {
      enviarNivelUrgente(a).then((r) => {
        if (r.ok) log('ENVÍO', 'nivel en juego entregado (ntfy)');
        else if (ntfyConfigurado()) log('AVISO', `nivel en juego falló: ${r.motivo || r.error}`);
      });
    }
  });
  e.on('tn', (ev) => { stats.tn++; log('TN', `${ev.simbolo} zona ${ev.zona.tipo} ${ev.zona.nivel} cancelada (${ev.motivo})`); });
  e.on('toque', (ev) => { if (VERBOSO) log('TOQUE', `${ev.simbolo} ${ev.fase} en ${ev.zona.tipo} ${ev.zona.nivel}`); });
  e.on('zona', (ev) => { if (VERBOSO) log('ZONA', `${ev.simbolo} ${ev.evento}: ${ev.zona.tipo} ${ev.zona.nivel} (fuerza ${ev.zona.fuerza})`); });
  e.on('aviso', (m) => log('AVISO', m));   // solo log/errores: las alertas de operación van por 'alerta'
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
    /* la híbrida necesita las CUATRO temporalidades que escanea el backtest */
    const tfs = MOTOR === 'v1'
      ? [...new Set([doc.sesgo.tf, doc.zonas.tf, doc.toques.tf])].filter((tf) => TFS[tf])
      : TF_HIBRIDA;
    const plan = tfs.map((tf) => [tf, DIAS_HISTORIA]);
    log('INFO', `sembrando historial de ${simbolosActivos.length} símbolos (${plan.map((p) => p[0]).join('/')}) para "${doc.meta.nombre}"...`);
    /* Orden TF-major: primero el M5 de TODOS los símbolos (es el que alimenta el
       aviso intrabar y el que antes puede operar), después M15, M30 y H1. Antes
       iba símbolo a símbolo y el último esperaba 2–3 min sin poder emitir.
       No se puede paralelizar: cmd 11 no identifica el símbolo en la respuesta,
       así que el cliente serializa las peticiones de velas a propósito. */
    for (const [tf, dias] of plan) {
      for (const s of simbolosActivos) {
        /* re-sembrado INCREMENTAL: tras una reconexión el búfer en memoria
           sigue vivo — solo se piden las velas posteriores a la última
           (antes se redescargaban los días completos en CADA reconexión) */
        const previas = (estrategia.historia(s) || {})[tf] || [];
        const ultima = previas.length ? previas[previas.length - 1].t : 0;
        if (previas.length && Date.now() - ultima < (SEG_TF[tf] || 900) * 1000) continue;   // caché al día
        /* desde = última (INCLUSIVE), no última+1: la vela que cerró el tick
           es sintética (apertura = primer tick) y hay que dejar que el bróker
           la reemplace por la real. Con +1 s nunca se pedía y la serie quedaba
           envenenada con una vela falsa por cada cierre, para siempre. */
        const desde = ultima ? Math.floor(ultima / 1000) : 0;
        /* un mes de M5 en una sola respuesta tarda ~30 s: el timeout del pedido
           COMPLETO tiene que cubrirlo o la siembra se queda sin velas */
        const r = await cliente.pedirVelas(s, { tf, dias, desde, timeoutMs: desde ? 8000 : 45000 });
        let nuevas = r && r.velas.length ? r.velas : [];
        if (!nuevas.length && desde) {
          const r2 = await cliente.pedirVelas(s, { tf, dias, timeoutMs: 45000 });   // reintento único
          if (r2 && r2.velas.length) nuevas = r2.velas;
        }
        if (nuevas.length) {
          estrategia.setHistoria(s, tf, unirVelas(previas, nuevas));   // setHistoria recorta la vela formándose
          log('INFO', `${tf} ${s}: ${previas.length} en memoria + ${nuevas.length} nuevas`);
        } else if (!previas.length) {
          log('AVISO', `${tf} ${s}: sin respuesta — se calienta con ticks en vivo`);
        }
        await new Promise((r2) => setTimeout(r2, 200)); // espaciado entre peticiones
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
log('INFO', `estrategia activa: "${gestor.actual().doc.meta.nombre}" · motor ${MOTOR} (${gestor.actual().fuente})`);
/* Outbox: recordar lo ya emitido (para no repetirlo tras un reinicio) y
   reenviar lo que quedó pendiente de entrega. */
outbox.cargar();
if (estrategia.sembrarEmitidas) estrategia.sembrarEmitidas(outbox.emitidasRecientes());
const pendientesArranque = outbox.pendientes();
if (pendientesArranque.length && !SIN_TELEGRAM) {
  log('INFO', `reenviando ${pendientesArranque.length} señales pendientes de entrega`);
  (async () => {
    for (const p of pendientesArranque) {
      const r = await enviarTelegram(p.texto, { prioridad: p.prioridad || 0 });
      if (r.ok) outbox.entregada(p.clave);
      else log('AVISO', `pendiente ${p.clave} sigue sin entregar: ${r.motivo || r.error}`);
    }
  })();
}

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

/* Refresco CONTINUO de velas: cada minuto se revisa qué TF ya cerró una vela
   nueva y se pide solo esa. resembrar() es incremental (salta las que están al
   día) y fusiona por timestamp, así que repetir no duplica ni deja huecos. */
const REFRESCO_VELAS_MS = 60 * 1000;
setInterval(() => { if (estrategia) resembrar(); }, REFRESCO_VELAS_MS);

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
    avisos: stats.avisos,
    ultimaAlerta: stats.ultimaAlerta,
    /* la prueba de que la señal no sale tarde: cierre de vela -> emisión */
    latenciaMs: {
      ultima: stats.ultimaSenal ? stats.ultimaSenal.latenciaMs ?? null : null,
      p50: stats.latencias.length
        ? [...stats.latencias].sort((a, b) => a - b)[Math.floor((stats.latencias.length - 1) * 0.5)]
        : null,
      n: stats.latencias.length,
    },
    /* contadores internos del motor: emitidas / avisos / intrabar / suprimidas / viejas */
    motor: estrategia && estrategia.stats ? estrategia.stats : null,
    telegram: { ...estadoTelegram(), configurado: telegramConfigurado() && !SIN_TELEGRAM },
    urgente: { ...estadoUrgente(), configurado: ntfyConfigurado() },
    entrega: { tfs: TFS_TELEGRAM, filtradas: stats.filtradas, intrabar: AVISO_INTRABAR },
    outbox: outbox.tamano(),
    estrategia: stats.estrategia,
    fuenteEstrategia: stats.fuenteEstrategia,
    simbolos: estrategia ? estrategia.resumen() : {},
  }), gestor);
  log('INFO', `HTTP / (panel), /salud y /estado en puerto ${process.env.PORT || 3000}`);
})();

// ---------- bucle de reconexión ----------
/* (el handler único de 'cerrar' está más arriba, junto al resto de
   cableados del cliente: UNA suscripción, UN temporizador) */

process.on('SIGTERM', () => { log('INFO', 'SIGTERM — cerrando'); if (estrategia) estrategia.destruir(); cliente.cerrar(); process.exit(0); });
process.on('SIGINT', () => { log('INFO', 'SIGINT — cerrando'); if (estrategia) estrategia.destruir(); cliente.cerrar(); process.exit(0); });

/* Aviso explícito: con el token pero sin chat_id el motor arranca y NO envía
   nada a Telegram (telegramConfigurado() exige los dos). Antes solo se veía
   «telegram: sin configurar» entre las demás líneas del arranque. */
if (!SIN_TELEGRAM && !telegramConfigurado()) {
  log('AVISO', 'TELEGRAM_TOKEN o TELEGRAM_CHAT sin definir en .env — las señales se quedan en consola, NO llegan a Telegram');
}
log('INFO', `motor de señales iniciado (motor ${MOTOR}, cuenta ${cliente.login} @ ${cliente.host}, telegram: ${SIN_TELEGRAM ? 'off' : telegramConfigurado() ? 'on' : 'sin configurar'}, toques 1/2/3: ${ENVIAR_TOQUES ? 'on' : 'off'}, carril urgente: ${ntfyConfigurado() ? 'ntfy' : 'solo alarma local'}, TF al móvil: ${TFS_TELEGRAM.join('/')}, nivel en juego: ${AVISO_INTRABAR ? 'on' : 'off'})`);
if (!ntfyConfigurado()) {
  log('AVISO', 'sin NTFY_TOPIC: el carril urgente queda en la alarma local del PC. Para push instantáneo en el móvil, define NTFY_TOPIC (y NTFY_URL si usas tu propio servidor).');
}
arrancar();
