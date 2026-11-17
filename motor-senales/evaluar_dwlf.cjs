'use strict';
/* Comparación JUSTA de @dwlf/indicators contra las 11 marcas de referencia.
   Solo se mide el tramo donde la línea detectada y la marca coexisten (sin
   extrapolar) y se informa qué fracción del tramo de la marca cubre. */
const fs = require('fs');
const path = require('path');
const { Trendline } = require('@dwlf/indicators');

const { velas } = JSON.parse(fs.readFileSync('/tmp/sfx40c.json', 'utf8'));
function atr(v, per = 14) {
  const out = new Array(v.length).fill(0); let s = 0;
  for (let i = 1; i < v.length; i++) {
    const tr = Math.max(v[i].h - v[i].l, Math.abs(v[i].h - v[i - 1].c), Math.abs(v[i].l - v[i - 1].c));
    if (i <= per) s += tr;
    if (i === per) out[i] = s / per;
    else if (i > per) out[i] = (out[i - 1] * (per - 1) + tr) / per;
    else out[i] = tr;
  }
  return out;
}
const A = atr(velas);
const candles = velas.map((v) => ({ t: v.t, o: v.o, h: v.h, l: v.l, c: v.c }));
const casos = fs.readFileSync(path.join(__dirname, 'datos', 'casos.jsonl'), 'utf8')
  .trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  .filter((c) => c.etiqueta && c.etiqueta.estado === 'referencia');

const refs = casos.map((c) => {
  const g = c.geometria, o = c.origen.marcasOriginales;
  return { id: c.origen.lineaId, i1: g.i1, i2: g.i2, p1: g.p1, p2: g.p2, dir: o.p2 > o.p1 ? 'support' : 'resistance' };
});
const yRef = (r, i) => r.p1 + (r.p2 - r.p1) * (i - r.i1) / (r.i2 - r.i1);
const yLinea = (l, i) => l.startPrice + l.slope * (i - l.startIndex);

function evaluar(trendlines) {
  const filas = [];
  for (const r of refs) {
    let mejor = null;
    for (const l of trendlines) {
      if (l.type !== r.dir) continue;
      const a = Math.max(r.i1, l.startIndex), b = Math.min(r.i2, l.endIndex);
      if (b - a < 20) continue;
      let s = 0;
      for (let i = a; i <= b; i++) s += Math.abs(yLinea(l, i) - yRef(r, i)) / (A[i] || 1);
      const e = s / (b - a + 1);
      if (!mejor || e < mejor.error) mejor = { error: e, cobertura: (b - a + 1) / (r.i2 - r.i1 + 1), l, a, b };
    }
    filas.push({ id: r.id, ...mejor });
  }
  const conLinea = filas.filter((f) => f.l);
  const mediana = (xs) => { const s = xs.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
  return {
    filas,
    cubiertas: conLinea.length,
    coberturaMedia: conLinea.reduce((x, f) => x + f.cobertura, 0) / (conLinea.length || 1),
    medianaError: mediana(conLinea.map((f) => f.error)),
    bienCubiertas: conLinea.filter((f) => f.cobertura >= 0.5).length,
  };
}

const configs = [];
for (const swingLookback of [3, 5, 8, 12, 20])
  for (const tol of [0.5, 1, 1.5, 2.5, 4])
    for (const minSeg of [40, 100, 200]) {
      const params = {
        swingLookback, minSwingLowTolerancePct: tol, minSlopePctPerCandle: 0.0001,
        breachDetectionMode: 'atr', breachThreshold: 2, atrPeriod: 14,
        breachRequireConsecutive: 1, minSegmentLength: minSeg, minSlopeDeltaPct: 0.01,
      };
      const t0 = Date.now();
      const { trendlines } = Trendline.computeTrendlines(candles, params);
      const ev = evaluar(trendlines);
      const spans = trendlines.map((l) => l.endIndex - l.startIndex).sort((x, y) => x - y);
      configs.push({ params, n: trendlines.length, ms: Date.now() - t0, maxSpan: spans[spans.length - 1] || 0, ...ev });
    }

configs.sort((x, y) => (y.bienCubiertas - x.bienCubiertas) || (x.medianaError - y.medianaError));
const best = configs[0];
console.log('mejor config:', JSON.stringify(best.params));
console.log(`líneas ${best.n} · span máx ${best.maxSpan} velas · ${best.ms} ms`);
console.log(`marcas con tramo comparable ${best.cubiertas}/11 · cobertura media ${(100 * best.coberturaMedia).toFixed(0)}% · bien cubiertas (≥50%) ${best.bienCubiertas}/11 · error mediano ${best.medianaError.toFixed(2)} ATR`);
console.log('\nmarca      cobertura   error     línea (inicio-fin, estado)');
for (const f of best.filas) {
  if (!f.l) { console.log(`${String(f.id).padEnd(10)} —           —`); continue; }
  console.log(`${String(f.id).padEnd(10)} ${(100 * f.cobertura).toFixed(0).padStart(5)}%     ${f.error.toFixed(2).padStart(6)} ATR   ${f.l.startIndex}-${f.l.endIndex} ${f.l.isActive ? 'viva' : 'rota'}`);
}
