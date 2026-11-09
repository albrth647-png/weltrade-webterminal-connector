'use strict';
/* Compara el port Node contra el volcado de referencia del Python, señal a señal.
   Uso: node validacion/comparar.js validacion/py.json
   Sale con código 1 si hay CUALQUIER diferencia. */
const fs = require('fs');
const path = require('path');
const H = require('../raptor_hibrida');
const core = require('../raptor_core');

/* Vocabulario nuevo (R = ROMPIMIENTO; toques 1/2/3) → vocabulario del Python
   de referencia (R = reset; B = quiebre). Se compara la MISMA señal, no la
   misma etiqueta: el aviso del 1.er toque y su rompimiento son reglas nuevas
   (captura del propietario, 2026-11-09) que el Python no tiene, así que se
   excluyen del recuento; la equivalencia se mide sobre lo que ambos emiten. */
const A_PY = { '1': 'S', '1R': 'S', '1RB': 'S', '2': 'T2', '2R': 'T2', '3': 'T3', '3R': 'T3',
  '2B': 'B2', '2RB': 'B2', '3B': 'B3', '3RB': 'B3' };
/* 1S = la seductora (antes salía como 1R). Con ruptura1=false el Node no emite
   1R (el rompimiento del 1.er toque es regla nueva), así que la equivalencia
   se mide sobre la seductora y los toques 2/3 y sus rompimientos. */
const A_NODE = { '2': 'T2', '3': 'T3', '2R': 'B2', '3R': 'B3', '1S': 'S' };
const normNode = (s) => (s.seductora ? 'S' : A_NODE[s.pattern] || null);

const TFS = ['M5', 'M15', 'M30', 'H1'];
const BASE = path.join(__dirname, '..', '..', 'backtest_hibrida', 'datos');

function leerCsv(ruta) {
  const txt = fs.readFileSync(ruta, 'utf8').trim().split('\n');
  const cab = txt[0].split(',');
  const col = (n) => cab.indexOf(n);
  const it = col('time'), io = col('open'), ih = col('high'), il = col('low'), ic = col('close');
  const df = { t: [], o: [], h: [], l: [], c: [] };
  for (let i = 1; i < txt.length; i++) {
    const f = txt[i].split(',');
    df.t.push(Date.parse(f[it]));
    df.o.push(+f[io]); df.h.push(+f[ih]); df.l.push(+f[il]); df.c.push(+f[ic]);
  }
  return df;
}

const CAMPOS = ['t', 'barIndex', 'tf', 'direction', 'kind', 'pattern', 'entry', 'invalidation',
  'brokenLevel', 'zonaId', 'zonaTipo', 'zonaFuerza', 'distZonaAtr', 'confluencia',
  'confluenciaFavor', 'faseZona', 'sesgo', 'sesgoOk', 'gatilloOk', 'score'];

function igual(a, b) {
  if (typeof a === 'number' && typeof b === 'number') {
    /* los avisos 2/3 llevan entry=NaN: NaN con NaN es igualdad, no diferencia */
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
    if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
    return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  }
  if (a === null && (b === null || (typeof b === 'number' && Number.isNaN(b)))) return true;
  return a === b;
}

const py = JSON.parse(fs.readFileSync(process.argv[2] || path.join(__dirname, 'py.json'), 'utf8'));
let totalDif = 0, totalFilas = 0;

for (const [sim, esperado] of Object.entries(py)) {
  const dfs = {};
  for (const tf of TFS) dfs[tf] = leerCsv(path.join(BASE, `${sim}_${tf}.csv`));
  /* ruptura1=false: estado idéntico al Python (la 1R nueva se mide aparte) */
  /* ruptura1=false: estado idéntico al Python (la 1R nueva se mide aparte)
     seductora=true: el Python SÍ la tiene (allí se llama 1/1R/1RB), y el motor
     la apaga por defecto porque no es una de las tres estrategias del catálogo */
  const P = H.hibridaParams({ v2: core.params({ emitTouchesFrom: 'M1', ruptura1: false, seductora: true }) });
  const { senales: todas, capas } = H.scanHibrida(dfs, P);
  const senales = todas.filter((s) => normNode(s) !== null)
    .map((s) => ({ ...s, pattern: normNode(s) }));
  const ref = esperado.filas.map((r) => ({ ...r, pattern: A_PY[r.pattern] || r.pattern }));
  totalFilas += ref.length;

  const difs = [];
  if (senales.length !== ref.length) difs.push(`CUENTA: py=${ref.length} node=${senales.length}`);
  const n = Math.min(senales.length, ref.length);
  for (let i = 0; i < n && difs.length < 8; i++) {
    for (const c of CAMPOS) {
      if (!igual(ref[i][c], senales[i][c])) {
        difs.push(`#${i} ${c}: py=${JSON.stringify(ref[i][c])} node=${JSON.stringify(senales[i][c])}`);
        if (difs.length >= 8) break;
      }
    }
  }
  const zonasPy = (esperado.capas.zonasPorTf || []).join(',');
  const zonasNo = (capas.zonasPorTf || []).join(',');
  if (zonasPy !== zonasNo) difs.push(`zonasPorTf: py=${zonasPy} node=${zonasNo}`);

  totalDif += difs.length;
  console.log(`${sim}: ${ref.length} señales py / ${senales.length} node · fases=${capas.fases ? 'sí' : 'no'} · ${difs.length ? 'DIFERENCIAS' : 'idéntico'}`);
  for (const d of difs) console.log('   ', d);
}

console.log(`\nTOTAL: ${totalFilas} filas comparadas · ${totalDif ? totalDif + ' diferencias' : '0 diferencias'}`);
process.exit(totalDif ? 1 : 0);
