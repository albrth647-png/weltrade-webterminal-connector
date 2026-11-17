'use strict';
/* AUDITORÍA DESTRUCTIVA — sondas de rotura sobre el motor de señales.
   Solo lectura sobre .estado.json. No envía nada a Telegram ni a MT5. */
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const nucleoMod = (await import('./nucleo.js')).default;
const tiempoMod = (await import('./tiempo.js')).default;
const telegramMod = (await import('./telegram.js')).default;
const clienteMod = (await import('./cliente_mt5.js')).default;

const { escanear, escanearEstructura, Nucleo, atr, ema, ENTRADAS, prioridadEvento } = nucleoMod;
const { horaHabana } = tiempoMod;
const { formatearSenal, formatearAviso } = telegramMod;
const { ClienteMT5 } = clienteMod;

const out = [];
const log = (...a) => { const s = a.join(' '); out.push(s); console.log(s); };
const ok = (c, m) => log((c ? '  OK   ' : '  FALLO') + ' · ' + m);

const raw = JSON.parse(fs.readFileSync('.estado.json', 'utf8'));
const sym = Object.keys(raw.simbolo).find((s) => s.includes('FX Vol 40')) || Object.keys(raw.simbolo)[0];
const m1 = raw.simbolo[sym].velas.M1;
const m5 = raw.simbolo[sym].velas.M5;
log(`\n== DATOS == ${sym} · M1 ${m1.length} velas · M5 ${m5.length} velas`);

/* ── P1. Look-ahead / invariancia de prefijo ──────────────────────────── */
log('\n== P1. Look-ahead (prefijo vs serie completa) ==');
{
  const N = Math.min(1500, m1.length);
  const base = m1.slice(-N);
  const full = escanear(base);
  const sig = (e) => `${e.barIndex}|${e.lado}|${e.patron}|${Number(e.precio).toFixed(4)}|${Number(e.nivelRoto).toFixed(4)}`;
  let comparadas = 0, malas = 0;
  for (let k = 260; k < N; k += 47) {
    const pre = escanear(base.slice(0, k));
    const a = pre.eventos.filter((e) => e.barIndex === k - 1).map(sig).sort();
    const b = full.eventos.filter((e) => e.barIndex === k - 1).map(sig).sort();
    comparadas++;
    if (JSON.stringify(a) !== JSON.stringify(b)) { malas++; if (malas <= 3) log(`     k=${k} pre=${a} full=${b}`); }
  }
  ok(malas === 0, `Yoel: ${comparadas} cortes, ${malas} discrepancias`);

  const N5 = Math.min(1200, m5.length);
  const base5 = m5.slice(-N5);
  const full5 = escanearEstructura(base5);
  let c5 = 0, b5 = 0;
  for (let k = 60; k < N5; k += 41) {
    const pre = escanearEstructura(base5.slice(0, k));
    const a = pre.eventos.filter((e) => e.barIndex === k - 1).map(sig).sort();
    const b = full5.eventos.filter((e) => e.barIndex === k - 1).map(sig).sort();
    c5++;
    if (JSON.stringify(a) !== JSON.stringify(b)) b5++;
  }
  ok(b5 === 0, `Estructura: ${c5} cortes, ${b5} discrepancias`);
}

/* ── P2. Fuzz de velas corruptas ──────────────────────────────────────── */
log('\n== P2. Fuzz de velas (NaN, h<l, negativos, campos ausentes) ==');
{
  let throws = 0, runs = 0;
  const rnd = (a, b) => a + Math.random() * (b - a);
  for (let it = 0; it < 300; it++) {
    const n = Math.floor(rnd(120, 420));
    const v = [];
    let p = rnd(1000, 2000);
    for (let i = 0; i < n; i++) {
      p += rnd(-5, 5);
      const o = p + rnd(-3, 3), c = p + rnd(-3, 3);
      const h = Math.max(o, c) + rnd(0, 4), l = Math.min(o, c) - rnd(0, 4);
      const cand = { t: Date.now() - (n - i) * 60000, o, h, l, c };
      const mod = Math.floor(rnd(0, 9));
      if (mod === 0) cand.c = NaN;
      else if (mod === 1) cand.h = NaN;
      else if (mod === 2) cand.l = cand.h + 10;          // h < l
      else if (mod === 3) cand.o = -5;
      else if (mod === 4) delete cand.h;
      else if (mod === 5) cand.c = Infinity;
      else if (mod === 6) { cand.h = 1e12; cand.l = -1e12; }
      v.push(cand);
    }
    for (const fn of [escanear, escanearEstructura]) {
      runs++;
      try { fn(v); } catch (e) { throws++; if (throws <= 5) log(`     throw ${e.name}: ${e.message}`); }
    }
  }
  ok(throws === 0, `${runs} ejecuciones, ${throws} excepciones`);
}

/* ── P3. Horario de La Habana / DST ───────────────────────────────────── */
log('\n== P3. Hora Habana en cambios de horario (2026) ==');
{
  const casos = [
    ['2026-03-08T04:30:00Z', '2026-03-07 23:30'],
    ['2026-03-08T05:30:00Z', '2026-03-08 01:30'],
    ['2026-11-01T04:30:00Z', '2026-11-01 00:30'],
    ['2026-11-01T05:30:00Z', '2026-11-01 00:30'],
    ['2026-07-15T12:00:00Z', '2026-07-15 08:00'],
    ['2026-01-15T12:00:00Z', '2026-01-15 07:00'],
  ];
  let mal = 0;
  for (const [iso, esp] of casos) {
    const got = horaHabana(Date.parse(iso));
    if (got !== esp) { mal++; log(`     ${iso} -> ${got} (esperado ${esp})`); }
  }
  ok(mal === 0, `${casos.length} instantes DST, ${mal} mal`);
  ok(horaHabana(NaN) === '—', 'NaN devuelve raya (no rompe)');
}

/* ── P4. Formato Telegram: escape, precios, longitud ──────────────────── */
log('\n== P4. Formato Telegram (inyección HTML / precios / tamaño) ==');
{
  const t = formatearSenal({ lado: 'COMPRA', simbolo: '<b>&x</b>', patron: '1', estrategia: 'Raptor-v03', tfZona: 'M1', precio: 210000.123456, tendencia: 'ALCISTA', t: Date.now() });
  ok(t.includes('&lt;b&gt;&amp;x&lt;/b&gt;') && !t.includes('<b>&x'), 'símbolo escapado (& < >)');
  ok(/Estrategia:<\/b> 1 · Raptor-v03/.test(t), 'estrategia + patrón presentes');
  ok(/Habana\)/.test(t), 'hora Habana presente');
  ok(formatearSenal({ simbolo: 'X', precio: NaN }).includes('—'), 'precio NaN -> raya');
  ok(formatearSenal({ simbolo: 'X', precio: 0 }).includes('—'), 'precio 0 -> raya');
  ok(formatearSenal({ simbolo: 'X', precio: -7 }).includes('—'), 'precio negativo -> raya');
  const grande = formatearSenal({ simbolo: 'X'.repeat(5000), patron: '1', precio: 1, t: Date.now() });
  ok(grande.length <= 4096, `mensaje grande mide ${grande.length} (límite Telegram 4096)`);
  const aviso = formatearAviso({ patron: '2ER', lado: 'COMPRA', simbolo: 'FX Vol 40', tfZona: 'M5', precio: 100, nivelRoto: 110, t: Date.now() });
  ok(aviso.includes('no es entrada') && aviso.includes('Nivel a romper'), 'aviso 2ER se etiqueta como no-entrada');
  const detras = formatearAviso({ patron: '2R', lado: 'COMPRA', simbolo: 'X', tfZona: 'M1', precio: 100, nivelRoto: 90, t: Date.now() });
  ok(detras.includes('Nivel del toque'), 'nivel ya superado cambia de etiqueta');
}

/* ── P5. Cola de Telegram bajo inundación ─────────────────────────────── */
log('\n== P5. Cola Telegram bajo inundación (250 avisos) ==');
{
  process.env.TELEGRAM_TOKEN = 'test-token';
  process.env.TELEGRAM_CHAT = 'test-chat';
  global.fetch = () => new Promise(() => {});   // nunca responde
  const tg = (await import('./telegram.js')).default;
  for (let i = 0; i < 250; i++) tg.enviarTelegram('aviso ' + i, { prioridad: 1 });
  const st = tg.estadoTelegram();
  ok(st.pendientes <= 200, `cola acotada: ${st.pendientes} pendientes (máx 200)`);
  ok(st.descartados >= 50, `descartados ${st.descartados} al desbordar`);
}

/* ── P6. Crash del parser MT5 con frame corto (cmd 6) ─────────────────── */
log('\n== P6. Frames malformados del bróker (no deben tumbar el motor) ==');
{
  const frame = (clave, cmd, body = Buffer.alloc(0)) => {
    /* El protocolo real lleva un byte dd en el offset 4: parseRX toma body
       desde el 5. Sin este byte, el primer byte del cuerpo se consume como dd. */
    const packet = Buffer.alloc(5 + body.length);
    packet.writeUInt16LE(cmd, 2); body.copy(packet, 5);
    const ci = crypto.createCipheriv('aes-256-cbc', clave, Buffer.alloc(16));
    const ct = Buffer.concat([ci.update(packet), ci.final()]);
    const f = Buffer.alloc(8 + ct.length);
    f.writeUInt32LE(ct.length, 0); f.writeUInt32LE(1, 4); ct.copy(f, 8);
    return f;
  };
  const c = new ClienteMT5({ login: '1', pass: 'x', host: 'h' });
  c.etapa = 'catalogo';
  c.clave = crypto.randomBytes(32);
  const logs = [];
  c._log = (m) => logs.push(m);
  c._cerrar = () => {};

  try { c._onMensaje(frame(c.clave, 6, Buffer.alloc(0))); ok(true, 'cmd 6 vacío no lanza'); }
  catch (e) { ok(false, `cmd 6 vacío lanza ${e.code || e.name}: ${e.message}`); }
  ok(logs.some((m) => /frame descartado|catálogo truncado/.test(m)), 'el frame inválido se registra (no muere en silencio)');

  const c2 = new ClienteMT5({ login: '1', pass: 'x', host: 'h' });
  c2.etapa = 'catalogo'; c2.clave = crypto.randomBytes(32);
  c2._log = () => {}; c2._cerrar = () => {}; c2._enviar = () => {};
  const nBogus = Buffer.alloc(4); nBogus.writeUInt32LE(0xFFFFFFFF, 0);
  try {
    c2._onMensaje(frame(c2.clave, 6, nBogus));
    ok(true, 'catálogo con contador 0xFFFFFFFF no recorre memoria' + (c2.etapa === 'listo' ? ' (etapa listo)' : ''));
  } catch (e) { ok(false, `catálogo con contador corrupto lanza ${e.code}: ${e.message}`); }

  const c3 = new ClienteMT5({ login: '1', pass: 'x', host: 'h' });
  c3.etapa = 'listo'; c3.clave = crypto.randomBytes(32);
  c3.nombres[454] = 'FX Vol 40';
  c3._log = () => {};
  let tick = null; c3.on('tick', (t) => { tick = t; });
  const tb = Buffer.alloc(50); tb.writeUInt32LE(454, 0); tb.writeDoubleLE(21000000, 12); tb.writeDoubleLE(21000100, 20);
  try { c3._onMensaje(frame(c3.clave, 8, tb)); } catch (e) { /* se reporta abajo */ }
  ok(tick && tick.simbolo === 'FX Vol 40' && tick.bid === 210000, 'un tick válido sigue entrando tras el blindaje');

  for (const cmd of [8, 11]) {
    try { c3._onMensaje(frame(c3.clave, cmd, Buffer.alloc(0))); ok(true, `cmd ${cmd} vacío no lanza`); }
    catch (e) { ok(false, `cmd ${cmd} vacío lanza ${e.code}: ${e.message}`); }
  }
}

/* ── P7. Envenenamiento del estado persistido ─────────────────────────── */
log('\n== P7. Estado persistido con una vela corrupta ==');
{
  const tmp = path.join(os.tmpdir(), 'audit_estado_' + process.pid + '.json');
  const velas = [];
  const t0 = Date.now() - 300 * 60000;
  for (let i = 0; i < 300; i++) {
    const b = 2000 + Math.sin(i / 9) * 30 + i * 0.05;
    velas.push({ t: t0 + i * 60000, o: b, h: b + 4, l: b - 4, c: b + 1, fuente: 'server' });
  }
  const sinH = velas.map((v) => ({ ...v }));
  delete sinH[150].h;
  const sinC = velas.map((v) => ({ ...v }));
  delete sinC[150].c;
  for (const [nombre, arr] of [['falta h', sinH], ['falta c', sinC]]) {
    fs.writeFileSync(tmp, JSON.stringify({
      version: 1, guardado: Date.now(),
      simbolo: { X: { velas: { M1: arr, M5: [], M15: [], M30: [], H1: [], H4: [], D1: [] }, cur: {}, ahora: 0 } },
      evalPorVela: {}, ladoPorVela: {},
    }));
    const n = new Nucleo({ archivoPersistencia: tmp });
    const serie = n.historia('X').M1;
    const a = atr(serie, 14);
    const nanAtr = a.some((x) => x !== null && Number.isNaN(x));
    const ultimo = a[a.length - 1];
    log(`     ${nombre}: cargadas ${serie.length}/${arr.length} · ATR final ${ultimo} · ATR con NaN: ${nanAtr}`);
    ok(serie.length >= arr.length - 1, `${nombre}: solo se descarta la vela corrupta, no la cola`);
    ok(Number.isFinite(ultimo) && ultimo > 0, `${nombre}: ATR sigue siendo válido`);
    n.destruir();
  }
  fs.unlinkSync(tmp);
}

/* ── P8. Rendimiento y escritura de estado ────────────────────────────── */
log('\n== P8. Rendimiento (CPU/IO) ==');
{
  let t0 = process.hrtime.bigint();
  for (let i = 0; i < 3; i++) escanear(m1);
  const msYoel = Number(process.hrtime.bigint() - t0) / 1e6 / 3;
  t0 = process.hrtime.bigint();
  for (let i = 0; i < 3; i++) escanearEstructura(m5);
  const msEst = Number(process.hrtime.bigint() - t0) / 1e6 / 3;
  log(`     escanear M1 (${m1.length} velas): ${msYoel.toFixed(1)} ms · Estructura M5: ${msEst.toFixed(1)} ms`);
  ok(msYoel < 150, `escanear M1 bajo 150 ms (${msYoel.toFixed(1)})`);

  const n = new Nucleo({ archivoPersistencia: null });
  t0 = process.hrtime.bigint();
  n.setHistoria('X', 'M1', m1);
  const msSet = Number(process.hrtime.bigint() - t0) / 1e6;
  log(`     setHistoria M1 (escaneo + poblar señales + evaluar): ${msSet.toFixed(1)} ms`);
  ok(msSet < 1000, `setHistoria bajo 1000 ms (${msSet.toFixed(1)})`);
  n.destruir();

  // coste real de guardar 20 MB
  const n2 = new Nucleo({ archivoPersistencia: '.estado.json' });
  const tmp = path.join(os.tmpdir(), 'audit_guardar_' + process.pid + '.json');
  n2.archivoPersistencia = tmp;
  t0 = process.hrtime.bigint();
  n2.guardar();
  const msGuardar = Number(process.hrtime.bigint() - t0) / 1e6;
  const mb = fs.statSync(tmp).size / 1048576;
  log(`     guardar estado: ${msGuardar.toFixed(0)} ms · ${mb.toFixed(1)} MB`);
  ok(msGuardar < 2000, `guardar bajo 2000 ms (${msGuardar.toFixed(0)} ms — bloquea el event loop)`);
  fs.unlinkSync(tmp);
  n2.archivoPersistencia = null;
  n2.destruir();

  const tmp2 = path.join(os.tmpdir(), 'audit_freno_' + process.pid + '.json');
  const n3 = new Nucleo({ archivoPersistencia: tmp2 });
  n3._ultimoGuardado = Date.now();
  n3._guardarDebounced();
  ok(!!n3._guardarTimer, 'guardado con freno: no reescribe 20 MB en cada vela');
  if (n3._guardarTimer) clearTimeout(n3._guardarTimer);
  n3._guardarTimer = null;
  n3.archivoPersistencia = null;
  n3.destruir();
  try { fs.unlinkSync(tmp2); } catch (e) { /* no existía */ }
}

/* ── P9. Doble evento Estructura + Yoel en la misma vela M5 ──────────── */
log('\n== P9. Dos estrategias en la misma vela M5 (escaneo) ==');
{
  const a = escanear(m5).eventos;
  const b = escanearEstructura(m5).eventos;
  const porBarra = new Map();
  for (const e of a) {
    const k = e.barIndex + '|' + e.lado;
    porBarra.set(k, (porBarra.get(k) || []).concat('Y:' + e.patron));
  }
  for (const e of b) {
    const k = e.barIndex + '|' + e.lado;
    porBarra.set(k, (porBarra.get(k) || []).concat('E:' + e.patron));
  }
  const dobles = [...porBarra.entries()].filter(([, v]) => v.length > 1);
  log(`     velas con doble evento en el escaneo: ${dobles.length} (la gráfica conserva los dos)`);
  for (const [k, v] of dobles.slice(0, 5)) log(`     barra ${k}: ${v.join(' + ')} · hora ${horaHabana(m5[Number(k.split('|')[0])].t)}`);
  ok(dobles.length > 0, `el escaneo conserva los dobles para dibujarlos (${dobles.length})`);
}

/* ── P10. Jerarquía de pesos para Estructura ──────────────────────────── */
log('\n== P10. Jerarquía de pesos ==');
{
  /* La prioridad es la que decide el desempate cuando dos estrategias caen
     en la misma vela/lado: toda entrada del catálogo debe tenerla. */
  const faltan = [...ENTRADAS].filter((p) => !(prioridadEvento({ patron: p }) > 0));
  const niveles = new Set([...ENTRADAS].map((p) => prioridadEvento({ patron: p })));
  log(`     entradas con prioridad 0: ${faltan.join(', ') || 'ninguna'} · niveles distintos: ${niveles.size}`);
  ok(faltan.length === 0, 'toda entrada del catálogo tiene prioridad para el desempate');
  ok(niveles.size > 1, `la prioridad ordena los patrones (${niveles.size} niveles)`);
}

/* ── P11. Frescura por símbolo (M2) ───────────────────────────────────── */
log('\n== P11. Frescura por símbolo ==');
{
  const c = new ClienteMT5({});
  c._ultimoPrecio.X = 100;
  c._ultimoTick.X = Date.now() - 120000;
  ok(c._loteValido('X', [{ c: 100 }], 0).velas.length === 0, 'precio congelado (120 s) rechazado');
  c._ultimoTick.X = Date.now();
  ok(c._loteValido('X', [{ c: 100 }], 0).velas.length === 1, 'precio fresco aceptado');
}

/* ── P12. Guard de arranque en frío (A3) ──────────────────────────────── */
log('\n== P12. Guard de arranque en frío ==');
{
  const n = new Nucleo({ archivoPersistencia: '.estado.json' });
  ok(n._evalPrevio.size > 0, `evalPorVela previo cargado (${n._evalPrevio.size} claves)`);
  ok(Number.isFinite(n._tArranque), 't_arranque registrado para el guard');
  n.archivoPersistencia = null;
  n.destruir();
}

/* ── P13. Una sola EMISIÓN por vela y lado ────────────────────────────── */
/* El escaneo conserva los dos eventos (para la gráfica), pero el motor solo
   debe emitir uno. Se reproduce una vela doble real cortando la serie en esa
   barra: la última vela del array es la que se evalúa. */
log('\n== P13. Una señal por vela y lado ==');
{
  const a = escanear(m5).eventos;
  const b = escanearEstructura(m5).eventos;
  const porBarra = new Map();
  const anotar = (e, et) => {
    const k = e.barIndex + '|' + e.lado;
    porBarra.set(k, (porBarra.get(k) || []).concat({ patron: e.patron, et }));
  };
  for (const e of a) anotar(e, 'Y');
  for (const e of b) anotar(e, 'E');
  const doble = [...porBarra.entries()].filter(([, v]) => v.length > 1).pop();
  ok(!!doble, 'hay una vela doble real para probar la emisión');
  if (doble) {
    const [k, evs] = doble;
    const barra = Number(k.split('|')[0]);
    const lado = k.split('|')[1];
    const n = new Nucleo({ archivoPersistencia: null });
    n._tArranque = 0;   // el guard de arranque en frío no aplica a esta prueba
    const emitidas = [];
    n.on('senal', (s) => emitidas.push(s));
    n._evaluar('PRUEBA', 'M5', m5.slice(0, barra + 1));
    const tCierre = m5[barra].t + 300000;
    const deLaVela = emitidas.filter((s) => Math.abs(s.t - tCierre) < 1);
    log(`     barra ${barra} ${lado}: ${evs.map((x) => x.et + ':' + x.patron).join(' + ')} → ` +
      `${deLaVela.map((s) => s.patron).join(' + ') || 'nada'}`);
    ok(deLaVela.length === 1, `una sola señal emitida para la vela/lado (${deLaVela.length})`);
    ok(new Set(deLaVela.map((s) => s.lado)).size === deLaVela.length, 'ningún lado se repite en la misma vela');
    n.archivoPersistencia = null;
    n.destruir();
  }
}

log('\n== FIN ==');
process.exit(0);
