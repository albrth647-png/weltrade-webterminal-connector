'use strict';
/* ============================================================
   AUDITORÍA PROFUNDA DEL MOTOR — segunda pasada
   ------------------------------------------------------------
   La primera midió RETARDOS. Esta mide las causas que hacen que
   una señal no llegue nunca o llegue ya sin recorrido:

     A) coste de UN cierre de vela por símbolo (¿el temporizador
        de 1 s se queda corto y el motor se atrasa solo?)
     B) avisos 2/2R/3/3R: ¿cuántos genera el núcleo y cuántos
        emite el motor en vivo?
     C) deduplicación global por símbolo: ¿cuántas señales
        legítimas suprime a lo largo de 30 días?
     D) coste en precio del retardo toque -> entrada
        (¿llega con el stop ya violado?)
     E) vela sintética del tick: ¿la reemplaza la vela real del
        bróker o se queda clavada en la serie?
     F) siembra/reinicio: ¿emite velas viejas (señal fantasma)?

   Uso:  node validacion/auditar_profundidad.js
   Requiere backtest_hibrida/datos/*.csv (gitignored).
   Sin red y sin credenciales.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const core = require('../raptor_core');
const H = require('../raptor_hibrida');
const { EstrategiaHibrida } = require('../estrategia_hibrida');
const { docACfg } = require('../doc_estrategia');

const DIR = path.join(__dirname, '..', '..', 'backtest_hibrida', 'datos');
const SIMS = ['FX_Vol_20', 'FX_Vol_40', 'SFX_Vol_20', 'SFX_Vol_40'];
const TFS = ['M5', 'M15', 'M30', 'H1'];
const MIN = { M5: 5, M15: 15, M30: 30, H1: 60 };
const SEG = { M5: 300, M15: 900, M30: 1800, H1: 3600 };
const P = core.params({ emitTouchesFrom: 'M1' });

const DOC = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'estrategias', 'raptor_default.json'), 'utf8'));
const CFG = docACfg(DOC);
/* mismos parámetros que construye EstrategiaHibrida (paridad con el backtest) */
const HP = H.hibridaParams({
  v2: P,
  zonas: {
    alas: CFG.alasPivote, tolPivoteAtr: CFG.tolPivoteAtr, tolPivoteRel: CFG.tolPivoteRel,
    tnAtr: CFG.tnAtr, excursionAtr: CFG.excursionAtr,
    bandaToqueAtr: CFG.bandaToqueAtr, atrPeriodo: CFG.atrPeriodo,
  },
  score: {
    pesoFase: { ...CFG.pesoFase },
    pesoFuerzaMax: CFG.pesoFuerzaMax, pesoFuerzaPorPivote: CFG.pesoFuerzaPorPivote,
    pesoSesgo: CFG.pesoSesgo, pesoGatillo: CFG.pesoGatillo, min: 0,
  },
  independiente: true,
  filtrarSesgo: false, filtrarConfluencia: false, filtrarGatillo: false, scoreMin: 0,
});

function leerCSV(archivo) {
  const lineas = fs.readFileSync(archivo, 'utf8').trim().split('\n').slice(1);
  const df = { t: [], o: [], h: [], l: [], c: [] };
  for (const l of lineas) {
    const p = l.split(',');
    df.t.push(Date.parse(p[0]));
    df.o.push(+p[1]); df.h.push(+p[2]); df.l.push(+p[3]); df.c.push(+p[4]);
  }
  return df;
}
const recorta = (df, desde, hasta = df.t.length) => ({
  t: df.t.slice(desde, hasta), o: df.o.slice(desde, hasta),
  h: df.h.slice(desde, hasta), l: df.l.slice(desde, hasta), c: df.c.slice(desde, hasta),
});
const velasDe = (df, desde = 0, hasta = df.t.length) =>
  df.t.slice(desde, hasta).map((t, k) => ({ t, o: df.o[desde + k], h: df.h[desde + k], l: df.l[desde + k], c: df.c[desde + k] }));
const cuantil = (a, f) => {
  if (!a.length) return NaN;
  const b = [...a].sort((x, y) => x - y);
  return b[Math.floor((b.length - 1) * f)];
};
const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)} %` : '—');
const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const ms = (t0) => Number(process.hrtime.bigint() - t0) / 1e6;

const datos = {};
for (const s of SIMS) for (const tf of TFS) {
  const f = path.join(DIR, `${s}_${tf}.csv`);
  if (fs.existsSync(f)) datos[`${s}|${tf}`] = leerCSV(f);
}
console.log(`series cargadas: ${Object.keys(datos).length} · velas totales: ${Object.values(datos).reduce((a, d) => a + d.t.length, 0)}`);

/* ============================================================
   A) ¿CUÁNTO CUESTA UN CIERRE? (y crece con la historia)
   ============================================================ */
console.log('\n=== A. COSTE DE UN CIERRE DE VELA (escaneo completo de la serie) ===');
const coste = {};
for (const tf of TFS) {
  const df = datos[`FX_Vol_20|${tf}`];
  const n = df.t.length;
  const cortes = [Math.floor(n * 0.25), Math.floor(n * 0.5), Math.floor(n * 0.75), n];
  const sub = recorta(df, 0);
  const dfs = { [tf]: sub };
  for (let i = 0; i < 3; i++) H.scanHibrida(dfs, HP);        // calentar JIT
  const t0 = process.hrtime.bigint();
  const REP = 5;
  for (let i = 0; i < REP; i++) H.scanHibrida(dfs, HP);
  const total = ms(t0) / REP;
  const zonas = H.detectarZonas(sub, HP.zonas).zonas.length;
  /* coste con historia recortada: demuestra si crece con la serie */
  const porCorte = [];
  for (const c of cortes.slice(0, 3)) {
    const d2 = { [tf]: recorta(df, n - c) };
    for (let i = 0; i < 2; i++) H.scanHibrida(d2, HP);
    const t1 = process.hrtime.bigint();
    for (let i = 0; i < 3; i++) H.scanHibrida(d2, HP);
    porCorte.push({ n: c, por: ms(t1) / 3 });
  }
  coste[tf] = { n, por: total, zonas, porCorte };
  console.log(`  ${tf}: n=${n} → ${fmt(total, 1)} ms por cierre · zonas acumuladas en la serie: ${zonas}`);
  console.log('     ' + porCorte.map((f) => `n=${f.n}: ${fmt(f.por, 1)} ms`).join(' · ') + ` · serie completa: ${fmt(total, 1)} ms`);
}
{
  const ciclo = TFS.reduce((a, tf) => a + coste[tf].por, 0);
  console.log(`\n  un símbolo que cierra M5+M15+M30+H1 en el mismo segundo cuesta ≈ ${fmt(ciclo, 0)} ms`);
  console.log(`  el temporizador cierra cada 1.000 ms → caben ~${Math.max(0, Math.floor(1000 / coste.M5.por))} símbolos si todos cierran M5 a la vez`);
  console.log(`  a los 12 símbolos del filtro por defecto: ${fmt(12 * coste.M5.por, 0)} ms de trabajo en el segundo del cierre de M5`);
}

/* ============================================================
   B) AVISOS 2/2R/3/3R: generados vs emitidos
   ============================================================ */
console.log('\n=== B. AVISOS 2/2R/3/3R: los genera el núcleo y ¿los emite el motor? ===');
let avisosNucleo = 0, entradasNucleo = 0;
for (const s of SIMS) for (const tf of TFS) {
  const df = datos[`${s}|${tf}`];
  if (!df) continue;
  for (const x of core.scan(df, tf, P)) {
    if (x.kind === 'touch') avisosNucleo++; else entradasNucleo++;
  }
}
console.log(`  núcleo: ${avisosNucleo} avisos · ${entradasNucleo} entradas (30 días, 4 símbolos, 4 TF)`);
let emitidos = 0, probados = 0;
for (const tf of TFS) {
  const df = datos[`FX_Vol_20|${tf}`];
  const toques = core.scan(df, tf, P).filter((x) => x.kind === 'touch');
  if (!toques.length) continue;
  const t = toques[0];
  const e = new EstrategiaHibrida(CFG);
  let sen = 0, avi = 0;
  e.on('senal', () => sen++);
  e.on('alerta', () => avi++);   // canal de avisos 2/2R/3/3R (separado de los logs)
  e.setHistoria('FX Vol 20', tf, velasDe(df, 0, t.barIndex));
  e.onVelaCerrada('FX Vol 20', tf, { t: df.t[t.barIndex], o: df.o[t.barIndex], h: df.h[t.barIndex], l: df.l[t.barIndex], c: df.c[t.barIndex] });
  e.destruir();
  probados++;
  emitidos += avi;
  console.log(`  ${tf}: cerrando la vela del 1.er aviso → ${sen} señales · ${avi} avisos  (patrón del núcleo: ${t.pattern})`);
}
console.log(`  resumen: ${emitidos}/${probados} avisos llegan al usuario`);

/* ============================================================
   C) DEDUPLICACIÓN GLOBAL POR SÍMBOLO (nunca expira)
   ============================================================ */
console.log('\n=== C. DEDUP POR SÍMBOLO (clave eliminada el 2026-11-09): lo que costaba ===');
let totalEntradas = 0, clavesUnicas = 0, perdidas = 0;
const ejemplosDedup = [];
for (const s of SIMS) {
  const mapa = new Map();
  for (const tf of TFS) {
    const df = datos[`${s}|${tf}`];
    if (!df) continue;
    for (const x of core.scan(df, tf, P)) {
      if (x.kind !== 'entry') continue;
      totalEntradas++;
      const clave = `${x.pattern}|${x.entry.toFixed(2)}`;   // exactamente la clave del motor
      if (mapa.has(clave)) {
        perdidas++;
        if (ejemplosDedup.length < 3) {
          const prev = mapa.get(clave);
          ejemplosDedup.push(`${s}: ${tf} ${x.pattern} @ ${x.entry.toFixed(2)} ya emitida por ${prev.tf} el ${new Date(prev.t).toISOString().slice(0, 16)}`);
        }
      } else {
        mapa.set(clave, { tf, t: x.t });
        clavesUnicas++;
      }
    }
  }
}
console.log(`  entradas del núcleo: ${totalEntradas} · claves únicas: ${clavesUnicas} · suprimidas por la clave patrón+precio: ${perdidas} (${pct(perdidas, totalEntradas)})`);
for (const e of ejemplosDedup) console.log('   · ' + e);
console.log('  la clave no lleva temporalidad ni caducidad: acierta el duplicado real, pero también borra un señal distinta al mismo precio');

/* ============================================================
   D) COSTE EN PRECIO DEL RETARDO (toque -> entrada)
   ============================================================ */
console.log('\n=== D. RETARDO TOQUE -> ENTRADA: cuánto movimiento se pierde ===');
{
  const retardos = [], recorridoAtr = [], violada = [], rrRestante = [], porTf = { M5: [], M15: [], M30: [], H1: [] }, desliz = [];
  let pares = 0;
  for (const s of SIMS) for (const tf of TFS) {
    const df = datos[`${s}|${tf}`];
    if (!df) continue;
    const atr = H.atrSma(df.h, df.l, df.c, 14);
    const senales = core.scan(df, tf, P);
    for (let i = 0; i < senales.length; i++) {
      const x = senales[i];
      if (x.kind !== 'entry' || !/R$/.test(x.pattern)) continue;
      const num = x.pattern[0];          // el toque lleva el mismo número
      let toque = null;
      for (let j = i - 1; j >= 0 && x.barIndex - senales[j].barIndex <= 6; j--) {
        if (senales[j].kind === 'touch' && senales[j].pattern === num && senales[j].direction === x.direction) { toque = senales[j]; break; }
      }
      if (!toque || !(atr[x.barIndex] > 0)) continue;
      pares++;
      const a = atr[x.barIndex];
      retardos.push((x.barIndex - toque.barIndex) * MIN[tf]);
      porTf[tf].push((x.barIndex - toque.barIndex) * MIN[tf]);
      /* movimiento ya recorrido desde el nivel roto hasta el precio del mensaje */
      const recorrido = Math.abs(x.entry - toque.brokenLevel) / a;
      recorridoAtr.push(recorrido);
      /* ¿el stop (invalidación) ya se tocó entre el aviso y el mensaje? */
      let maxAdv = -Infinity;
      for (let k = toque.barIndex + 1; k <= x.barIndex; k++) {
        const adv = x.direction === 'SELL' ? df.h[k] : df.l[k];
        maxAdv = Math.max(maxAdv, x.direction === 'SELL' ? adv - toque.invalidation : toque.invalidation - adv);
      }
      if (maxAdv >= 0) violada.push(1);
      /* precio del mensaje frente al cierre de la vela del aviso: negativo = peor
         (en una venta, entrar más abajo que el aviso; en una compra, más arriba) */
      desliz.push((x.direction === 'SELL' ? -1 : 1) * (x.entry - df.c[toque.barIndex]) / a);
      /* riesgo que queda al entrar: |entrada - invalidación| comparado con lo ya recorrido */
      const riesgo = Math.abs(x.entry - toque.invalidation) / a;
      if (riesgo > 0) rrRestante.push(recorrido / riesgo);
    }
  }
  console.log(`  pares 1R/2R/3R con su aviso: ${pares}`);
  console.log(`  retardo (min): p50 ${fmt(cuantil(retardos, 0.5), 0)} · p90 ${fmt(cuantil(retardos, 0.9), 0)} · max ${fmt(Math.max(...retardos), 0)}`);
  for (const tf of TFS) {
    const r = porTf[tf];
    if (r.length) console.log(`    ${tf}: n=${r.length} · p50 ${fmt(cuantil(r, 0.5), 0)} min · max ${fmt(Math.max(...r), 0)} min`);
  }
  console.log(`  movimiento ya recorrido al recibir el mensaje (ATR): p50 ${fmt(cuantil(recorridoAtr, 0.5), 2)} · p90 ${fmt(cuantil(recorridoAtr, 0.9), 2)}`);
  console.log(`  stop ya violado antes de que llegue el mensaje: ${violada.length}/${pares} (${pct(violada.length, pares)})`);
  const adverso = desliz.filter((d) => d > 0).length;   // > 0 = peor precio que en el aviso
  console.log(`  precio del mensaje PEOR que el cierre del aviso (ATR): p50 ${fmt(cuantil(desliz, 0.5), 2)} · p10 ${fmt(cuantil(desliz, 0.1), 2)} · max ${fmt(Math.max(...desliz), 2)}`);
  console.log(`  llega con peor precio que en el aviso: ${adverso}/${desliz.length} (${pct(adverso, desliz.length)})`);
  console.log(`  recorrido desde el nivel roto hasta el precio del mensaje (ATR): p50 ${fmt(cuantil(recorridoAtr, 0.5), 2)}`);
}

/* ============================================================
   E) LA VELA SINTÉTICA DEL TICK, ¿SE SUSTITUYE POR LA REAL?
   ============================================================ */
console.log('\n=== E. VELA SINTÉTICA vs VELA REAL DEL BRÓKER ===');
{
  const df = datos['FX_Vol_20|M5'];
  const N = df.t.length - 288;                     // 24 h de M5 antes del final
  const previas = velasDe(df, 0, N);               // búfer en memoria
  const sinteticas = [];
  for (let k = N; k < df.t.length; k++) {
    /* el temporizador cierra la vela con los ticks: o = primer tick (≈ cierre previo) */
    sinteticas.push({ t: df.t[k], o: df.c[k - 1], h: df.h[k], l: df.l[k], c: df.c[k] });
  }
  const atr = H.atrSma(df.h, df.l, df.c, 14);
  const pedido = (desdeSeg) => {
    const desdeMs = desdeSeg * 1000;
    const lista = [];
    for (let j = N; j < df.t.length; j++) {
      if (df.t[j] >= desdeMs) lista.push({ t: df.t[j], o: df.o[j], h: df.h[j], l: df.l[j], c: df.c[j] });
    }
    return lista;
  };
  const fusion = (prev, nuevas) => {
    const m = new Map();
    for (const v of prev) m.set(v.t, v);
    for (const v of nuevas) m.set(v.t, v);
    return m;
  };
  let realPedidaViejo = 0, realPedidaNuevo = 0, clavadaViejo = 0, clavadaNuevo = 0;
  let oDistinto = 0, cuerpoCambiado = 0, maxDifAtr = 0;
  const bufferViejo = [], bufferNuevo = [];
  for (let k = 0; k < sinteticas.length; k++) {
    const i = N + k;
    const syn = sinteticas[k];
    bufferViejo.push(syn); bufferNuevo.push(syn);   // onVelaCerrada: la sintética entra en la serie
    /* antes: desde = última + 1 s · ahora: desde = última (inclusive) */
    const viejas = pedido(Math.floor(syn.t / 1000) + 1);
    const nuevas = pedido(Math.floor(syn.t / 1000));
    if (viejas.some((v) => v.t === syn.t)) realPedidaViejo++;
    if (nuevas.some((v) => v.t === syn.t)) realPedidaNuevo++;
    const enV = fusion(bufferViejo, viejas).get(syn.t);
    const enN = fusion(bufferNuevo, nuevas).get(syn.t);
    if (enV && enV.o === syn.o) clavadaViejo++;
    if (enN && enN.o === syn.o) clavadaNuevo++;
    if (Math.abs(syn.o - df.o[i]) > 1e-12) {
      oDistinto++;
      maxDifAtr = Math.max(maxDifAtr, Math.abs(syn.o - df.o[i]) / (atr[i] || 1));
    }
    if (Math.sign(syn.c - syn.o) !== Math.sign(df.c[i] - df.o[i])) cuerpoCambiado++;
  }
  console.log(`  velas cerradas por el tick en 24 h (M5): ${sinteticas.length}`);
  console.log(`  con desde = última+1 s (antes): la vela real se pide ${realPedidaViejo}/${sinteticas.length} · el búfer conserva la sintética ${clavadaViejo}/${sinteticas.length} (${pct(clavadaViejo, sinteticas.length)})`);
  console.log(`  con desde = última  (ahora): la vela real se pide ${realPedidaNuevo}/${sinteticas.length} · el búfer conserva la sintética ${clavadaNuevo}/${sinteticas.length} (${pct(clavadaNuevo, sinteticas.length)})`);
  console.log(`  su apertura difiere de la real: ${oDistinto}/${sinteticas.length} (máx ${fmt(maxDifAtr, 3)} ATR)`);
  console.log(`  el cuerpo cambia de signo respecto a la vela real: ${cuerpoCambiado}/${sinteticas.length} (afecta a bodyBreak / minBodyRatio)`);

  /* impacto real: ¿cambia el conjunto de entradas de esa ventana? */
  const oMixta = df.o.map((o, k) => (k >= N ? df.c[k - 1] : o));
  const realFull = { t: df.t, o: df.o, h: df.h, l: df.l, c: df.c };
  const synFull = { t: df.t, o: oMixta, h: df.h, l: df.l, c: df.c };
  const claveEnt = (x) => `${x.pattern}|${x.barIndex}`;
  const entReal = new Set(core.scan(realFull, 'M5', P).filter((x) => x.kind === 'entry' && x.barIndex >= N).map(claveEnt));
  const entSyn = new Set(core.scan(synFull, 'M5', P).filter((x) => x.kind === 'entry' && x.barIndex >= N).map(claveEnt));
  let perdidas = 0, sobran = 0;
  for (const k of entReal) if (!entSyn.has(k)) perdidas++;
  for (const k of entSyn) if (!entReal.has(k)) sobran++;
  console.log(`  entradas en la ventana (núcleo, serie real): ${entReal.size}`);
  console.log(`  con la apertura sintetica: ${entSyn.size} · ${perdidas} desaparecen · ${sobran} aparecen de más`);
}

/* ============================================================
   F) SIEMBRA / REINICIO: ¿emite velas viejas?
   ============================================================ */
console.log('\n=== F. SIEMBRA: ¿emite una vela que ya pasó? ===');
{
  /* repro exacto: sembrar hasta una vela que SÍ contiene una entrada y
     ver si el motor la emite sin comparar su cierre con el reloj */
  const dfm = datos['FX_Vol_20|M5'];
  const conSenal = core.scan(dfm, 'M5', P).filter((x) => x.kind === 'entry' && x.barIndex > 300);
  let emitidas = 0, edades = [];
  for (const objetivo of conSenal.slice(0, 5)) {
    const e = new EstrategiaHibrida(CFG);
    e.on('senal', (x) => { emitidas++; edades.push((Date.now() - x.t) / 60000); });
    e.setHistoria('FX Vol 20', 'M5', velasDe(dfm, 0, objetivo.barIndex + 1));
    e.destruir();
  }
  console.log(`  sembrando 5 velas que el núcleo marca como entrada → el motor emite ${emitidas}/5`);
  if (edades.length) console.log(`  edad de esas velas: p50 ${fmt(cuantil(edades, 0.5), 0)} min · máx ${fmt(Math.max(...edades), 0)} min (en vivo = atraso del feed)`);
  console.log('  (sin el guard la siembra las emitía: una señal que el mercado ya recorrió)');
  console.log('  el reinicio tampoco las repite: outbox.emitidasRecientes() rellena _emitidos al arrancar');
}
