'use strict';
/* ============================================================
   TEST DEL FLUJO SEÑAL -> TELEGRAM
   ------------------------------------------------------------
   Hace permanentes los fallos que la auditoría encontró, para que
   no vuelvan a ocurrir en silencio:

     1) los avisos de toque 1/2/3 (entry = NaN) SÍ se emiten y con formato
     2) una vela vieja sembrada NO se emite (guard de frescura)
     3) la misma vela no emite dos veces la misma clase
     4) si el bróker corrige la vela, se re-evalúa: la señal que la
        vela sintética del tick no vio no se pierde
     5) el payload lleva emitidaEn/latenciaMs (latencia medible)
     6) no hay dedup global por símbolo (patrón+precio sin caducidad)
     7) el mensaje va sin SL/TP

   Sin red y sin datos externos: serie sintética determinista.
   Ejecutar:  node test_flujo.mjs
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EstrategiaHibrida } from './estrategia_hibrida.js';
import { formatearSenal, formatearAviso } from './telegram.js';
import { docACfg } from './doc_estrategia.js';
import core from './raptor_core.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
let ok = 0, mal = 0;
const check = (nombre, cond, extra = '') => {
  if (cond) { ok++; console.log(`  ✓ ${nombre}`); }
  else { mal++; console.error(`  ✗ ${nombre}${extra ? ' — ' + extra : ''}`); }
};

const doc = JSON.parse(fs.readFileSync(path.join(AQUI, 'estrategias', 'raptor_default.json'), 'utf8'));
const CFG = docACfg(doc);
const P = core.params({ emitTouchesFrom: 'M1' });   // el mismo que usa el motor

/* Serie determinista M5 (sin Math.random): tendencia que oscila y gira. */
function serie(n, semilla = 7) {
  let r = semilla >>> 0;
  const rnd = () => ((r = (Math.imul(r, 1664525) + 1013904223) >>> 0) / 4294967296);
  const v = [];
  let x = 1000;
  for (let i = 0; i < n; i++) {
    const vol = 5 + 2 * Math.sin(i / 41);
    const drift = 0.55 * Math.sin(i / 63) + 0.18 * Math.sin(i / 13);
    const o = x;
    const c = x + drift * vol + (rnd() - 0.5) * vol * 2.2;
    const h = Math.max(o, c) + rnd() * vol * 0.7;
    const l = Math.min(o, c) - rnd() * vol * 0.7;
    v.push({ t: i * 300000, o, h, l, c });
    x = c;
  }
  return v;
}

const N = 3000;
const base = serie(N);
const aDf = (velas) => ({
  t: velas.map((v) => v.t), o: velas.map((v) => v.o),
  h: velas.map((v) => v.h), l: velas.map((v) => v.l), c: velas.map((v) => v.c),
});

/* Buscar los eventos sobre la serie base (el núcleo es invariante al desplazamiento de tiempo). */
const evs = core.scan(aDf(base), 'M5', P);
const toque = evs.find((x) => x.kind === 'touch' && x.barIndex > 300);
const entrada1 = evs.find((x) => x.kind === 'entry' && x.barIndex > 300);
check('la serie de prueba produce toque y una entrada', !!toque && !!entrada1,
  `toques=${evs.filter((x) => x.kind === 'touch').length} entradas=${evs.filter((x) => x.kind === 'entry').length}`);

if (!toque || !entrada1) {
  console.error('\nresultado: no se puede ejecutar el resto sin eventos de prueba');
  process.exit(1);
}

/* Anclar la serie al reloj: la vela de la entrada cierra hace ~30 s. */
const AHORA = Date.now();
const i = entrada1.barIndex;
const delta = (AHORA - 30000) - (base[i].t + 300000);
const velas = base.map((v) => ({ ...v, t: v.t + delta }));

console.log('— 1. avisos de toque 1/2/3 (antes morían en el guard de precio) —');
{
  const e = new EstrategiaHibrida(CFG);
  const avisos = [], senales = [];
  e.on('alerta', (a) => avisos.push(a));
  e.on('senal', (s) => senales.push(s));
  e.setHistoria('TEST', 'M5', velas.slice(0, toque.barIndex));
  e.onVelaCerrada('TEST', 'M5', velas[toque.barIndex]);
  e.destruir();
  check('el aviso se emite', avisos.length >= 1, `avisos=${avisos.length}`);
  check('el aviso no se emite como entrada', senales.length === 0, `señales=${senales.length}`);
  const a = avisos[0];
  check('el aviso lleva precio de referencia y nivel a romper',
    !!a && Number.isFinite(a.precio) && Number.isFinite(a.nivelRoto), a ? `precio=${a.precio} romper=${a.nivelRoto}` : 'sin aviso');
  const txt = formatearAviso(a || {});
  check('el formato del aviso dice «no es entrada» y lleva activo', /no es entrada/i.test(txt) && /Activo/.test(txt));
}

console.log('— 2. guard de frescura: una vela vieja no se emite —');
{
  const e = new EstrategiaHibrida(CFG);
  let emitidas = 0;
  e.on('senal', () => emitidas++);
  e.on('alerta', () => emitidas++);
  const viejas = velas.slice(0, i + 1).map((v) => ({ ...v, t: v.t - 3 * 86400000 }));
  e.setHistoria('TEST', 'M5', viejas);
  const contador = e.stats.velasViejas;
  e.destruir();
  check('sembrar una vela de hace 3 días no emite nada', emitidas === 0, `emitió ${emitidas}`);
  check('la vela descartada queda contada en stats.velasViejas', contador >= 1, `velasViejas=${contador}`);
}

console.log('— 3. la misma vela no emite dos veces —');
{
  const e = new EstrategiaHibrida(CFG);
  let emitidas = 0;
  e.on('senal', () => emitidas++);
  e.on('alerta', () => emitidas++);
  e.setHistoria('TEST', 'M5', velas.slice(0, toque.barIndex));
  e.onVelaCerrada('TEST', 'M5', velas[toque.barIndex]);
  const tras1 = emitidas;
  e.onVelaCerrada('TEST', 'M5', velas[toque.barIndex]);
  e.destruir();
  check('cerrar dos veces la misma vela no duplica', emitidas === tras1, `${tras1} -> ${emitidas}`);
  check('el primer cierre sí emitió', tras1 >= 1, `emitidas=${tras1}`);
}

console.log('— 4. la vela real del bróker re-evalúa la sintética —');
{
  const e = new EstrategiaHibrida(CFG);
  const senales = [];
  e.on('senal', (s) => senales.push(s));
  e.setHistoria('TEST', 'M5', velas.slice(0, i));
  /* El tick cierra la vela en un precio que NO rompe el nivel y sin cuerpo:
     la versión sintética no puede emitir ninguna entrada (ni rompimiento
     1R/2R/3R ni seductora 1S). La vela real del bróker sí cierra rompiendo. */
  const nivel = entrada1.brokenLevel;
  const cSintetico = entrada1.direction === 'SELL'
    ? Math.max(velas[i].o, nivel) + 1e-6
    : Math.min(velas[i].o, nivel) - 1e-6;
  e.setHistoria('TEST', 'M5', velas.slice(0, i).concat([{ ...velas[i], c: cSintetico }]));
  const conSintetica = senales.length;
  /* 60 s después llega la vela real del servidor */
  e.setHistoria('TEST', 'M5', velas.slice(0, i + 1));
  const reevaluadas = e.stats.reevaluadas;
  e.destruir();
  check('la sintética no emite y la real sí', senales.length > conSintetica,
    `sintética=${conSintetica} real=${senales.length}`);
  check('se contabiliza la re-evaluación', reevaluadas >= 1, `reevaluadas=${reevaluadas}`);
}

console.log('— 5. latencia medible en el payload —');
{
  const e = new EstrategiaHibrida(CFG);
  const senales = [];
  e.on('senal', (s) => senales.push(s));
  e.setHistoria('TEST', 'M5', velas.slice(0, i));
  e.setHistoria('TEST', 'M5', velas.slice(0, i + 1));
  e.destruir();
  const s = senales[0];
  check('la señal lleva emitidaEn y latenciaMs',
    !!s && Number.isFinite(s.emitidaEn) && Number.isFinite(s.latenciaMs));
  check('latenciaMs = cierre de vela -> emisión (≈30 s en el test)',
    !!s && Math.abs(s.latenciaMs - 30000) < 5000, s ? `${s.latenciaMs} ms` : 'sin señal');
}

console.log('— 6. sin dedup global por símbolo —');
{
  const e = new EstrategiaHibrida(CFG);
  check('no existe la clave patrón+precio sin caducidad', !('_ultimaSenalPorSimbolo' in e));
  check('la emisión se recuerda por vela y clase', e._emitidos instanceof Map);
  e.destruir();
}

console.log('— 7. mensaje sin SL/TP, con los 5 campos —');
{
  const txt = formatearSenal({
    lado: 'COMPRA', simbolo: 'FX Vol 20', tfZona: 'M5', tfGatillo: 'M5',
    patron: '2R', estrategia: 'Raptor-híbrida', precio: 2458.12, t: Date.now(),
  });
  check('el mensaje no lleva SL ni TP', !/\bSL\b|\bTP\b/.test(txt));
  check('el mensaje lleva los 5 campos numerados', (txt.match(/<b>\d\./g) || []).length === 5, txt);
}

console.log('— 8. aviso intrabar: sale en el tick del toque —');
{
  const e = new EstrategiaHibrida(CFG);
  const alertas = [];
  e.on('alerta', (a) => alertas.push(a));
  e.setHistoria('TEST', 'M5', velas);        // la siembra deja las zonas vigentes
  const zc = e.s.get('TEST')?.zonasVigentes?.M5;
  check('la siembra deja zonas vigentes para el aviso intrabar', !!zc && zc.zonas.length > 0,
    zc ? `zonas=${zc.zonas.length}` : 'sin cache');
  if (zc && zc.zonas.length) {
    const zona = zc.zonas[0];
    e.onTick('TEST', zona.nivel, zona.nivel, Date.now());
    const intra = alertas.filter((a) => a.origen === 'intrabar');
    check('el tick dentro de la banda emite aviso intrabar', intra.length === 1, `intrabar=${intra.length}`);
    check('el aviso intrabar lleva zona, precio y nivel', !!intra[0] && intra[0].zonaNivel === zona.nivel
      && Number.isFinite(intra[0].precio), JSON.stringify(intra[0]?.zonaNivel));
    e.onTick('TEST', zona.nivel, zona.nivel, Date.now() + 2000);
    check('no repite el mismo aviso dentro de la ventana', alertas.filter((a) => a.origen === 'intrabar').length === 1);
  }
  e.destruir();
}

console.log('— 9. una entrada por zona y dirección entre temporalidades —');
{
  const e = new EstrategiaHibrida(CFG);
  const ahora = Date.now();
  check('zona no avisada al principio', !e._zonaYaAvisada(e._ultimaEntradaZona, 'TEST', 'COMPRA', 1000, ahora));
  e._marcarZonaAvisada(e._ultimaEntradaZona, 'TEST', 'COMPRA', 1000, ahora);
  check('la misma zona y dirección queda suprimida', e._zonaYaAvisada(e._ultimaEntradaZona, 'TEST', 'COMPRA', 1000, ahora + 60000));
  check('caduca pasada la ventana', !e._zonaYaAvisada(e._ultimaEntradaZona, 'TEST', 'COMPRA', 1000, ahora + e._ventanaZonaMs + 1));
  check('la dirección contraria no se suprime', !e._zonaYaAvisada(e._ultimaEntradaZona, 'TEST', 'VENTA', 1000, ahora));
  check('otro nivel de zona no se suprime', !e._zonaYaAvisada(e._ultimaEntradaZona, 'TEST', 'COMPRA', 2000, ahora));
  e.destruir();
}

console.log('— 10. outbox persistente (no se pierde ni se duplica) —');
{
  const tmp = path.join(AQUI, '.test_outbox.json');
  try { fs.unlinkSync(tmp); } catch (e) { /* no existía */ }
  process.env.MS_OUTBOX = tmp;
  const mod = await import('./outbox.js');
  const ob = mod.default ?? mod;
  ob.cargar();
  const k1 = `TEST|M5|${Date.now()}|entry|BUY`;
  check('outbox arranca vacío', ob.tamano().emitidas === 0 && ob.tamano().pendientes === 0);
  ob.marcarEmitida(k1);
  check('marca la clave como emitida', ob.yaEmitida(k1));
  ob.pendiente(k1, 'texto', 0);
  check('la señal queda pendiente de entrega', ob.pendientes().length === 1);
  ob.entregada(k1);
  check('entregada: sale de pendientes y sigue como emitida', ob.pendientes().length === 0 && ob.yaEmitida(k1));
  ob.cargar();
  check('se relee del disco al reiniciar', ob.yaEmitida(k1) && fs.existsSync(tmp));
  check('emitidasRecientes incluye la clave de hoy', ob.emitidasRecientes().includes(k1));
  check('emitidasRecientes descarta claves fuera de la ventana', !ob.emitidasRecientes(1).includes(k1));
  try { fs.unlinkSync(tmp); } catch (e) { /* ya no */ }
  delete process.env.MS_OUTBOX;
}

console.log('— 11. cola de Telegram: prioridad y sin bloqueo en cabeza —');
{
  const enviadosTxt = [];
  const fetchReal = globalThis.fetch;
  globalThis.fetch = async (_url, opt) => {
    enviadosTxt.push(JSON.parse(opt.body).text);
    return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 9000 + enviadosTxt.length } }) };
  };
  process.env.TELEGRAM_TOKEN = 'test-token';
  process.env.TELEGRAM_CHAT = '1';
  const mod = await import('./telegram.js');
  const tg = mod.default ?? mod;
  const t0 = Date.now();
  const rs = await Promise.all([
    tg.enviarTelegram('aviso-1', { prioridad: 1 }),
    tg.enviarTelegram('aviso-2', { prioridad: 1 }),
    tg.enviarTelegram('entrada', { prioridad: 0 }),
  ]);
  const ms = Date.now() - t0;
  check('las tres se entregan', rs.every((r) => r.ok), JSON.stringify(rs.map((r) => r.ok)));
  check('la entrada adelanta a los avisos', enviadosTxt[0] === 'entrada', JSON.stringify(enviadosTxt));
  check('respeta ~1,1 s entre mensajes', ms >= 2000, `${ms} ms`);
  check('devuelve message_id', rs.every((r) => Number.isFinite(r.messageId)));
  check('el estado de la cola queda a cero', tg.estadoTelegram().pendientes === 0 && tg.estadoTelegram().enviados >= 3);
  globalThis.fetch = fetchReal;
  delete process.env.TELEGRAM_TOKEN;
  delete process.env.TELEGRAM_CHAT;
}

console.log(`\nresultado: ${ok} OK, ${mal} FALLOS`);
process.exit(mal ? 1 : 0);
