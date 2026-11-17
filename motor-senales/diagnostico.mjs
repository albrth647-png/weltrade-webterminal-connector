'use strict';
/* Diagnóstico de por qué la auto-raya no reproduce los 10 casos manuales.
   Uso: node diagnostico.mjs <velas.json> --casos datos/casos.jsonl --simbodo "FX Vol 20"
*/
import { readFileSync } from 'node:fs';
import { _rayas, rayaVigente, PARAMS, atr } from './rayas.js';

function norm(v) {
  return { t: v.t ?? v.time, o: v.o ?? v.open, h: v.h ?? v.high, l: v.l ?? v.low, c: v.c ?? v.close };
}
function cargarVelas(ruta) {
  const raw = JSON.parse(readFileSync(ruta, 'utf8'));
  return (Array.isArray(raw) ? raw : (raw.velas || raw.candles || raw.data)).map(norm);
}
function cargarCasos(ruta) {
  return readFileSync(ruta, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
}

const args = process.argv.slice(2);
const rutaVelas = args[0];
const iCasos = args.indexOf('--casos');
const rutaCasos = iCasos >= 0 ? args[iCasos + 1] : 'datos/casos.jsonl';
const iSym = args.indexOf('--simbodo');
const sym = iSym >= 0 ? args[iSym + 1] : null;

const velas = cargarVelas(rutaVelas);
const casos = cargarCasos(rutaCasos).filter((c) => !sym || c.mercado.simbolo === sym);

console.log(`Velas: ${velas.length}  rango t: ${velas[0].t} .. ${velas[velas.length - 1].t}`);
console.log(`Casos: ${casos.length}\n`);

const A = atr(velas, PARAMS.atrPeriodo);
const idxPorT = new Map();
velas.forEach((v, i) => idxPorT.set(v.t, i));

for (const caso of casos) {
  const g = caso.geometria;
  const i1t = idxPorT.get(g.t1);
  const i2t = idxPorT.get(g.t2);
  console.log(`--- ${caso.id}  ${caso.mercado.simbolo} ${caso.mercado.tf}`);
  console.log(`  guardado: i1=${g.i1} i2=${g.i2} nVelas=${caso.mercado.nVelas} pendAtr=${g.pendAtr.toFixed(4)}`);
  console.log(`  por timestamp: i1=${i1t} i2=${i2t}  (desfase i1=${i1t == null ? '?' : i1t - g.i1}, i2=${i2t == null ? '?' : i2t - g.i2})`);
  if (i1t == null || i2t == null) { console.log('  ⚠ caso fuera de la serie descargada\n'); continue; }

  const manualM = (g.p2 - g.p1) / (i2t - i1t);
  const slice = velas.slice(0, i2t + 1);
  const Aslice = A.slice(0, i2t + 1);
  const tipo = g.pendAtr < 0 ? 'bajista' : 'alcista';
  const rayas = _rayas(slice, Aslice, tipo, PARAMS);

  console.log(`  manual (reanclado): m=${manualM.toFixed(4)} precio/vela  atr medio~${(Aslice[i2t] || 1).toFixed(1)}  m/atr=${(manualM / (Aslice[i2t] || 1)).toFixed(4)}`);
  console.log(`  rayas detectadas: ${rayas.length}`);
  for (const r of rayas) {
    const valEnI2 = r.base + r.m * (i2t - r.iA);
    const dM = Math.abs(r.m - manualM);
    const dV = Math.abs(valEnI2 - g.p2) / (Aslice[i2t] || 1);
    console.log(`    iA=${r.iA} i2=${r.i2} m=${r.m.toFixed(4)} toques=${r.toques} brk=${r.brk} | dM=${dM.toFixed(4)} dV(atr)=${dV.toFixed(3)}`);
  }
  const rv = rayaVigente(slice);
  const pata0 = rv && rv.patas && rv.patas[0];
  console.log(`  rayaVigente: ${rv ? rv.tipo + ' iA=' + rv.iA + ' patas=' + (rv.patas || []).length : 'null'}`);
  if (pata0) console.log(`    pata0 iA=${pata0.iA} m=${pata0.pendiente.toFixed(4)}`);
  console.log('');
}
