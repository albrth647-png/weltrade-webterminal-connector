'use strict';
/* ============================================================
   CALIBRACIÓN — mide qué parámetros reproducen las líneas
   marcadas a mano en /grafica.

   Correcciones sobre la versión anterior (causa de que "no
   arreglara nada"):
   · Reancla i1/i2 por TIMESTAMP (t1/t2), no por índice: la serie
     descargada tiene 8587 velas y los casos se guardaron con 8590,
     así que los índices estaban desplazados 89 velas.
   · Filtra los casos por símbolo: cada archivo de velas calibra
     solo sus propios casos (antes cruzaba FX Vol 20 con FX Vol 40).
   · Error robusto: distancia media vertical entre la línea manual
     y la detectada sobre el tramo, en ATR. No exige que los
     extremos clicados coincidan al punto (se dibujan a ojo).

   Uso:
     node calibrar.mjs <velas.json> --casos datos/casos.jsonl --simbodo "FX Vol 20"
   ============================================================ */
import { readFileSync } from 'node:fs';
import { _rayas, PARAMS, atr } from './rayas.js';

function norm(v) {
  return { t: v.t ?? v.time ?? v.timestamp, o: v.o ?? v.open, h: v.h ?? v.high, l: v.l ?? v.low, c: v.c ?? v.close };
}
function cargarVelas(ruta) {
  const raw = JSON.parse(readFileSync(ruta, 'utf8'));
  const arr = Array.isArray(raw) ? raw : (raw.velas || raw.candles || raw.data);
  if (!Array.isArray(arr) || !arr.length) throw new Error('sin velas en ' + ruta);
  return arr.map(norm);
}
function cargarCasos(ruta) {
  return readFileSync(ruta, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
}

function main() {
  const args = process.argv.slice(2);
  const rutaVelas = args[0];
  if (!rutaVelas) {
    console.log('Uso: node calibrar.mjs <velas.json> --casos datos/casos.jsonl --simbodo "FX Vol 20"');
    process.exit(1);
  }
  const iCasos = args.indexOf('--casos');
  const rutaCasos = iCasos >= 0 ? args[iCasos + 1] : 'datos/casos.jsonl';
  const iSym = args.indexOf('--simbodo');
  const sym = iSym >= 0 ? args[iSym + 1] : null;

  const velas = cargarVelas(rutaVelas);
  const idxPorT = new Map();
  velas.forEach((v, i) => idxPorT.set(v.t, i));

  let casos = cargarCasos(rutaCasos);
  if (sym) casos = casos.filter((c) => c.mercado.simbolo === sym);
  // Reanclar por timestamp
  const anclados = [];
  for (const c of casos) {
    const g = c.geometria;
    const i1 = idxPorT.get(g.t1);
    const i2 = idxPorT.get(g.t2);
    if (i1 == null || i2 == null || i2 >= velas.length) continue;
    anclados.push({ caso: c, i1, i2 });
  }
  if (!anclados.length) {
    console.log(`Sin casos utilizables para ${sym || '(sin filtro)'} en ${rutaVelas}`);
    process.exit(1);
  }
  console.log(`Velas: ${velas.length}  Casos: ${anclados.length}${sym ? '  (' + sym + ')' : ''}`);
  const desfases = anclados.map((a) => a.i2 - a.caso.geometria.i2);
  console.log(`Desfase de índices al reanclar (i2): ${[...new Set(desfases)].join(', ')}\n`);

  // Error: distancia media vertical manual vs detectada, normalizada por ATR.
  function errorDe(raya, a, A) {
    const { caso, i1, i2 } = a;
    const g = caso.geometria;
    const mMan = (g.p2 - g.p1) / (i2 - i1);
    const enManual = (i) => g.p1 + mMan * (i - i1);
    const enDet = (i) => raya.base + raya.m * (i - raya.iA);
    let suma = 0, n = 0;
    for (let i = i1; i <= i2; i++) { suma += Math.abs(enDet(i) - enManual(i)); n++; }
    const distAtr = (suma / Math.max(1, n)) / (A[i2] || 1);
    const pendAtrMan = mMan / (A[i2] || 1);
    const pendAtrDet = raya.m / (A[i2] || 1);
    const dPend = Math.abs(pendAtrDet - pendAtrMan);
    return (distAtr + dPend) / 2;
  }

  const grid = {
    pivotePorCierre: [true, false],
    k: [2, 3, 4, 5],
    kAtrPivot: [0, 0.3, 0.5, 0.8],
    validarWicks: [false, true],
  };

  const resultados = [];
  let mejor = null;
  for (const pivotePorCierre of grid.pivotePorCierre) {
    for (const k of grid.k) {
      for (const kAtrPivot of grid.kAtrPivot) {
        for (const validarWicks of grid.validarWicks) {
          const params = { ...PARAMS, pivotePorCierre, k, kAtrPivot, validarWicks };
          let errTotal = 0, nOk = 0, nSinRaya = 0;
          for (const a of anclados) {
            const g = a.caso.geometria;
            const slice = velas.slice(0, a.i2 + 1);
            const A = atr(slice, params.atrPeriodo);
            const tipo = g.pendAtr < 0 ? 'bajista' : 'alcista';
            const rayas = _rayas(slice, A, tipo, params);
            if (!rayas.length) { errTotal += 5; nSinRaya++; continue; }
            let mejorErr = Infinity;
            for (const r of rayas) {
              const e = errorDe(r, a, A);
              if (e < mejorErr) mejorErr = e;
            }
            errTotal += mejorErr;
            if (mejorErr < 0.25) nOk++;
          }
          const res = {
            pivotePorCierre, k, kAtrPivot, validarWicks,
            errMedio: +(errTotal / anclados.length).toFixed(4),
            ok: nOk, sinRaya: nSinRaya, total: anclados.length,
          };
          resultados.push(res);
          if (!mejor || res.errMedio < mejor.errMedio) mejor = res;
        }
      }
    }
  }

  resultados.sort((a, b) => a.errMedio - b.errMedio);
  console.log('Top 8 combinaciones (errMedio = distancia en ATR, menor es mejor):');
  console.log('pivCierre  k  kAtr  wicks  errMedio  ok/total  sinRaya');
  for (const r of resultados.slice(0, 8)) {
    console.log(`${String(r.pivotePorCierre).padEnd(9)} ${r.k}  ${r.kAtrPivot.toFixed(1)}   ${String(r.validarWicks).padEnd(5)}  ${r.errMedio.toFixed(4)}    ${r.ok}/${r.total}     ${r.sinRaya}`);
  }
  console.log('\nMEJOR:', JSON.stringify(mejor));
  console.log(`\nAplica con: PARAMS.pivotePorCierre=${mejor.pivotePorCierre}, PARAMS.k=${mejor.k}, PARAMS.kAtrPivot=${mejor.kAtrPivot}, PARAMS.validarWicks=${mejor.validarWicks}`);

  // Detalle por caso con la mejor combinación
  const params = { ...PARAMS, pivotePorCierre: mejor.pivotePorCierre, k: mejor.k, kAtrPivot: mejor.kAtrPivot, validarWicks: mejor.validarWicks };
  console.log('\nDetalle por caso (mejor combinación):');
  for (const a of anclados) {
    const g = a.caso.geometria;
    const slice = velas.slice(0, a.i2 + 1);
    const A = atr(slice, params.atrPeriodo);
    const tipo = g.pendAtr < 0 ? 'bajista' : 'alcista';
    const rayas = _rayas(slice, A, tipo, params);
    let mejorErr = Infinity, mejorR = null;
    for (const r of rayas) { const e = errorDe(r, a, A); if (e < mejorErr) { mejorErr = e; mejorR = r; } }
    const nombre = a.caso.id;
    if (!mejorR) { console.log(`  ${nombre}  ${tipo}: SIN RAYA`); continue; }
    console.log(`  ${nombre}  ${tipo}: iA=${mejorR.iA} i2=${mejorR.i2} toques=${mejorR.toques} m=${mejorR.m.toFixed(3)} err=${mejorErr.toFixed(3)} ATR`);
  }
}

main();
