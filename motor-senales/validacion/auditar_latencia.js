'use strict';
/* ============================================================
   AUDITORÍA DE LATENCIA DE SEÑALES — medición, no opinión
   ------------------------------------------------------------
   Responde tres preguntas con las velas reales de 30 días:

   1) ¿Cuántos avisos (2/2R/3/3R) genera el núcleo y cuántos
      llegan a emitirse? (el motor en vivo solo manda entradas)
   2) Para una entrada 1R/2R/3R, ¿cuánto tarda desde el toque que la
      origina, y cuánto precio se ha recorrido en ese hueco?
   3) ¿El motor comprueba la frescura de la vela antes de emitir?
      (siembra/reconexión pueden emitir una vela vieja)

   Uso:  node validacion/auditar_latencia.js
   Requiere backtest_hibrida/datos/*.csv (gitignored).
   ============================================================ */
const fs = require('fs');
const path = require('path');
const core = require('../raptor_core');
const H = require('../raptor_hibrida');
const { EstrategiaHibrida } = require('../estrategia_hibrida');
const { docACfg } = require('../doc_estrategia');

const DIR = path.join(__dirname, '..', '..', 'backtest_hibrida', 'datos');
const SIMBOLOS = ['FX_Vol_20', 'FX_Vol_40', 'SFX_Vol_20', 'SFX_Vol_40'];
const TFS = ['M5', 'M15', 'M30', 'H1'];
const MIN = { M5: 5, M15: 15, M30: 30, H1: 60 };
const P = core.params({ emitTouchesFrom: 'M1' });   // igual que el motor en vivo

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

const cuantil = (a, f) => {
  if (!a.length) return NaN;
  const b = [...a].sort((x, y) => x - y);
  return b[Math.floor((b.length - 1) * f)];
};
const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '—');

let avisos = 0, entradas = 0, pares = 0;
const retardoMin = [], avanceAtr = [], huecoAperturaAtr = [];
const retardoPorTF = { M5: [], M15: [], M30: [], H1: [] };
let ejemplo = null, primerToque = null;

for (const sym of SIMBOLOS) {
  for (const tf of TFS) {
    const archivo = path.join(DIR, `${sym}_${tf}.csv`);
    if (!fs.existsSync(archivo)) continue;
    const df = leerCSV(archivo);
    const atr = H.atrSma(df.h, df.l, df.c, 14);
    const senales = core.scan(df, tf, P);

    for (let i = 0; i < senales.length; i++) {
      const s = senales[i];
      if (s.kind === 'touch') {
        avisos++;
        if (!primerToque) primerToque = { sym, tf, df, i: s.barIndex };
        continue;
      }
      entradas++;

      /* lo que se puede ejecutar al recibir el mensaje: apertura siguiente */
      const sig = senales[i + 1];
      const apertura = (sig && sig.barIndex === s.barIndex + 1 && Number.isFinite(sig.entry))
        ? sig.entry
        : (s.barIndex + 1 < df.c.length ? df.o[s.barIndex + 1] : NaN);
      if (Number.isFinite(apertura)) huecoAperturaAtr.push((apertura - s.entry) / atr[s.barIndex]);

      /* 1R/2R/3R: el aviso del toque que lo origina está <= 6 velas antes
         (maxBarsToBreak); el toque lleva el mismo número que el rompimiento */
      if (!/R(B)?$/.test(s.pattern)) continue;
      const num = s.pattern[0];
      let j = i - 1, toque = null;
      while (j >= 0 && s.barIndex - senales[j].barIndex <= 6) {
        if (senales[j].kind === 'touch' && senales[j].pattern === num
          && senales[j].direction === s.direction) { toque = senales[j]; break; }
        j--;
      }
      if (!toque) continue;
      pares++;
      retardoMin.push((s.barIndex - toque.barIndex) * MIN[tf]);
      retardoPorTF[tf].push((s.barIndex - toque.barIndex) * MIN[tf]);
      avanceAtr.push((s.entry - toque.brokenLevel) / atr[s.barIndex]);
      if (!ejemplo && sym === 'FX_Vol_20' && tf === 'M5') ejemplo = { s, df, atr };
    }
  }
}

console.log('=== 1. QUÉ SE EMITE Y QUÉ NO ===');
console.log(`avisos del núcleo (2/2R/3/3R): ${avisos}`);
console.log(`entradas del núcleo (1/1R/B):   ${entradas}`);
if (primerToque) {
  /* repro contra el motor real: sembrar hasta i-1 y cerrar la vela del aviso */
  const { df, i, tf, sym } = primerToque;
  const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'estrategias', 'raptor_default.json'), 'utf8'));
  const e = new EstrategiaHibrida(docACfg(doc));
  let nSenal = 0, nAviso = 0;
  e.on('senal', () => nSenal++);
  e.on('aviso', () => nAviso++);
  e.setHistoria(sym, tf, df.t.map((t, k) => ({ t, o: df.o[k], h: df.h[k], l: df.l[k], c: df.c[k] })).slice(0, i));
  e.onVelaCerrada(sym, tf, { t: df.t[i], o: df.o[i], h: df.h[i], l: df.l[i], c: df.c[i] });
  e.destruir();
  console.log(`al cerrar la vela del aviso el motor emitió: ${nSenal} señales y ${nAviso} avisos`);
}

console.log('\n=== 2. RETARDO AVISO -> ENTRADA (1R/2R/3R) ===');
console.log(`pares analizados: ${pares}`);
console.log(`retardo (min): p50 ${fmt(cuantil(retardoMin, 0.5), 0)} · p75 ${fmt(cuantil(retardoMin, 0.75), 0)} · p90 ${fmt(cuantil(retardoMin, 0.9), 0)} · max ${fmt(Math.max(...retardoMin), 0)}`);
console.log(`precio recorrido en ese hueco (ATR): p50 ${fmt(cuantil(avanceAtr, 0.5), 2)} · p75 ${fmt(cuantil(avanceAtr, 0.75), 2)} · p90 ${fmt(cuantil(avanceAtr, 0.9), 2)}`);
for (const tf of TFS) {
  const r = retardoPorTF[tf];
  if (r.length) console.log(`  ${tf}: n=${r.length} · p50 ${fmt(cuantil(r, 0.5), 0)} min · p90 ${fmt(cuantil(r, 0.9), 0)} min · max ${fmt(Math.max(...r), 0)} min`);
}

console.log('\n=== 3. LO QUE CUESTA EL TRANSPORTE (cierre -> apertura siguiente) ===');
console.log(`hueco (ATR): p50 ${fmt(cuantil(huecoAperturaAtr, 0.5), 3)} · p75 ${fmt(cuantil(huecoAperturaAtr, 0.75), 3)} · p90 ${fmt(cuantil(huecoAperturaAtr, 0.9), 3)}`);

console.log('\n=== 4. ¿HAY GUARD DE FRESCURA AL SEMBRAR? ===');
if (ejemplo) {
  const { s, df } = ejemplo;
  const doc = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'estrategias', 'raptor_default.json'), 'utf8'));
  const e = new EstrategiaHibrida(docACfg(doc));
  let emitida = null;
  e.on('senal', (x) => { if (!emitida) emitida = x; });
  const velas = df.t.map((t, i) => ({ t, o: df.o[i], h: df.h[i], l: df.l[i], c: df.c[i] }))
    .slice(0, s.barIndex + 1);
  e.setHistoria('FX Vol 20', 'M5', velas);
  e.destruir();
  if (emitida) {
    console.log(`emitió "${emitida.patron}" sin comparar su cierre con el reloj (edad de la vela: ${fmt((Date.now() - emitida.t) / 60000, 0)} min; en vivo esa edad es el atraso del feed)`);
  } else {
    console.log('no emitió en la siembra');
  }
}
