'use strict';
/* Compara las marcas manuales de referencia (SFX Vol 40 M5) con las
   trendlines que detecta @dwlf/indicators. Mide error medio en ATR, acierto
   de anclaje (barra y precio) y coste.
   Uso: node comparar_dwlf.cjs [serie.json] [simbolo] [tf] */
const fs = require('fs');
const path = require('path');
const { Trendline } = require('@dwlf/indicators');

const RUTA_SERIE = process.argv[2] || '/tmp/sfx40c.json';
const SIMBOLO = process.argv[3] || 'SFX Vol 40';
const TF = process.argv[4] || 'M5';

const { velas } = JSON.parse(fs.readFileSync(RUTA_SERIE, 'utf8'));
const n = velas.length;

/* ATR de Wilder, alineado con la serie */
function atr(v, per = 14) {
  const out = new Array(v.length).fill(0);
  let suma = 0;
  for (let i = 1; i < v.length; i++) {
    const tr = Math.max(v[i].h - v[i].l, Math.abs(v[i].h - v[i - 1].c), Math.abs(v[i].l - v[i - 1].c));
    if (i <= per) suma += tr;
    if (i === per) out[i] = suma / per;
    else if (i > per) out[i] = (out[i - 1] * (per - 1) + tr) / per;
    else out[i] = tr;
  }
  return out;
}
const A = atr(velas);

/* Referencias guardadas (reancladas a pivotes) */
const casos = fs.readFileSync(path.join(__dirname, 'datos', 'casos.jsonl'), 'utf8')
  .trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  .filter((c) => c.etiqueta && c.etiqueta.estado === 'referencia'
    && c.mercado.simbolo === SIMBOLO && c.mercado.tf === TF);

const candles = velas.map((v) => ({ t: v.t, o: v.o, h: v.h, l: v.l, c: v.c }));

const params = {
  swingLookback: 5,
  minSwingLowTolerancePct: 0.5,
  minSlopePctPerCandle: 0.0001,
  breachDetectionMode: 'atr',
  breachThreshold: 1,
  atrPeriod: 14,
  breachRequireConsecutive: 1,
  minSegmentLength: 40,
  minSlopeDeltaPct: 0.01,
};

const t0 = Date.now();
const { trendlines } = Trendline.computeTrendlines(candles, params);
const ms = Date.now() - t0;
const VERSION_DWLF = JSON.parse(fs.readFileSync(path.join(__dirname, 'node_modules', '@dwlf', 'indicators', 'package.json'), 'utf8')).version;
console.log(`dwlf ${VERSION_DWLF} · ${trendlines.length} líneas en ${ms} ms (${n} velas)`);
const cuenta = { support: 0, resistance: 0 };
for (const l of trendlines) cuenta[l.type]++;
console.log(`  soporte ${cuenta.support} · resistencia ${cuenta.resistance} · activas ${trendlines.filter((l) => l.isActive).length}`);

const linea = (l, i) => l.startPrice + l.slope * (i - l.startIndex);
const errorAtr = (l, c) => {
  const a = Math.max(l.startIndex, c.i1), b = Math.min(l.endIndex, c.i2);
  if (b - a < 20) return null;
  let s = 0;
  for (let i = a; i <= b; i++) s += Math.abs(linea(l, i) - (c.p1 + (c.p2 - c.p1) * (i - c.i1) / (c.i2 - c.i1))) / (A[i] || 1);
  return s / (b - a + 1);
};

console.log('\nmarca            dir       mejor línea dwlf        error    anclaje');
let cumple05 = 0, cumple1 = 0, sinLinea = 0;
for (const c of casos) {
  const g = c.geometria;
  const dir = g.p2 > g.p1 ? 'support' : 'resistance';
  let mejor = null, err = Infinity;
  for (const l of trendlines) {
    if (l.type !== dir) continue;
    const e = errorAtr(l, { i1: g.i1, i2: g.i2, p1: g.p1, p2: g.p2 });
    if (e != null && e < err) { err = e; mejor = l; }
  }
  const nombre = String(c.origen.lineaId).padEnd(9);
  if (!mejor) { sinLinea++; console.log(`${nombre} ${dir.padEnd(11)} —                        —        —`); continue; }
  const dBarras = Math.abs(mejor.startIndex - g.i1);
  const dPrecio = Math.abs(mejor.startPrice - g.p1) / (A[g.i1] || 1);
  const ok = dBarras <= 30 && dPrecio <= 1;
  if (err <= 0.5) cumple05++;
  if (err <= 1) cumple1++;
  console.log(`${nombre} ${dir.padEnd(11)} ${String(mejor.startIndex).padStart(4)}-${String(mejor.endIndex).padEnd(4)} ${mejor.isActive ? 'viva' : 'rota'}  ${err.toFixed(2).padStart(5)} ATR  ${ok ? 'sí' : 'no'} (${dBarras} velas, ${dPrecio.toFixed(2)} ATR)`);
}
console.log(`\nresumen: ${casos.length} marcas · ≤0,5 ATR ${cumple05} · ≤1 ATR ${cumple1} · sin línea comparable ${sinLinea}`);
