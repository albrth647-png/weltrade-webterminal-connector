'use strict';
/* Guarda las marcaciones manuales del propietario como casos de REFERENCIA
   (no entrenan ni cuentan como aprobados). Corrige el mapeo precio↔pantalla:
   cada extremo se reancla al PIVOTE POR CIERRE real (lado soporte/resistencia)
   más cercano a su hora, y el precio pasa a ser el cierre de ese pivote.
   Uso: node guardar_referencias.cjs <marcas.json> <serie.json> [simbolo] [tf] */
const fs = require('fs');
const path = require('path');
const { pivotes } = require('./rayas');

const RUTA_MARCAS = process.argv[2] || '/tmp/marcas_sfx40.json';
const RUTA_SERIE = process.argv[3] || '/tmp/sfx40c.json';
const SIMBOLO = process.argv[4] || 'SFX Vol 40';
const TF = process.argv[5] || 'M5';
const ARCHIVO = path.join(__dirname, 'datos', 'casos.jsonl');

const marcas = JSON.parse(fs.readFileSync(RUTA_MARCAS, 'utf8'));
const { velas } = JSON.parse(fs.readFileSync(RUTA_SERIE, 'utf8'));
const idxT = new Map(velas.map((v, i) => [v.t, i]));

const pivBajo = pivotes(velas, 'bajo', 3, true);
const pivAlto = pivotes(velas, 'alto', 3, true);
const masCercano = (arr, i) => arr.reduce((mejor, p) => (Math.abs(p - i) < Math.abs(mejor - i) ? p : mejor), arr[0]);
/* Reancla i2 conservando la DIRECCIÓN original de la marca: en una
   resistencia el segundo alto debe quedar por debajo del primero (y al
   revés en un soporte). Si el pivote más cercano la invierte, se busca el
   siguiente más cercano que la respete (hasta 40 velas). */
function pivoteQueRespeta(arr, i, precioOrigen, soporte) {
  const ordenados = arr.slice().sort((a, b) => Math.abs(a - i) - Math.abs(b - i));
  const vale = (p) => (soporte ? velas[p].c > precioOrigen : velas[p].c < precioOrigen);
  for (const p of ordenados) {
    if (Math.abs(p - i) > 40) break;
    if (vale(p)) return p;
  }
  return masCercano(arr, i);
}

function atrLocal(i) {
  const per = 14, desde = Math.max(1, i - per + 1);
  let s = 0, c = 0;
  for (let k = desde; k <= i; k++) {
    const tr = Math.max(velas[k].h - velas[k].l,
      Math.abs(velas[k].h - velas[k - 1].c), Math.abs(velas[k].l - velas[k - 1].c));
    s += tr; c++;
  }
  return c ? s / c : 0;
}

/* Cruces de CUERPO (min/max de o,c), que es la regla del propietario. */
function crucesDeCuerpo(i1, p1, i2, p2) {
  let cruces = 0, maxPen = 0;
  const a = Math.min(i1, i2), b = Math.max(i1, i2);
  const linea = (i) => p1 + ((p2 - p1) * (i - i1)) / (i2 - i1 || 1);
  for (let i = a + 1; i < b; i++) {
    const v = velas[i];
    const lo = Math.min(v.o, v.c), hi = Math.max(v.o, v.c);
    const y = linea(i);
    if (y > lo && y < hi) {
      cruces++;
      const pen = Math.min(y - lo, hi - y);
      if (pen > maxPen) maxPen = pen;
    }
  }
  return { cruces, maxPenAtr: maxPen / (atrLocal(i2) || 1) };
}

const nuevas = [];
for (const m of marcas) {
  const iIni = idxT.get(m.t1), iFin = idxT.get(m.t2);
  if (iIni == null || iFin == null) { console.log('fuera de serie', m.id); continue; }
  const soporte = m.p2 > m.p1;
  const arr = soporte ? pivBajo : pivAlto;
  const i1 = masCercano(arr, iIni);
  const p1 = velas[i1].c;
  const i2 = pivoteQueRespeta(arr, iFin, p1, soporte);
  const p2 = velas[i2].c;
  const { cruces, maxPenAtr } = crucesDeCuerpo(i1, p1, i2, p2);
  const A = atrLocal(i2) || 1;
  nuevas.push({
    id: `ref-${TF.toLowerCase()}-${SIMBOLO.toLowerCase().replace(/[^a-z0-9]+/g, '')}-${m.id}`,
    v: 1,
    origen: {
      tipo: 'manual', autor: 'propietario', creado: new Date().toISOString(),
      lineaId: m.id, sugerencia: null,
      /* lo que llegó del navegador, para poder auditar la corrección */
      marcasOriginales: { t1: m.t1, p1: m.p1, i1: iIni, t2: m.t2, p2: m.p2, i2: iFin },
      reanclaje: 'pivote-cierre',
    },
    mercado: { simbolo: SIMBOLO, tf: TF, t: velas[i2].t, precio: p2, nVelas: velas.length },
    geometria: {
      tipo: 'trend', i1, i2, p1, p2,
      pendAtr: (p2 - p1) / (i2 - i1 || 1) / A,
      largo: i2 - i1,
      toques: 0,
      anclaje: 'cierre',
      cuerpo: true,
      extension: 'ninguna',
      valida: true,
      velasCruzadas: cruces,
      maxPenAtr: +maxPenAtr.toFixed(2),
      t1: velas[i1].t, t2: velas[i2].t,
    },
    huella: null,
    etiqueta: { estado: 'referencia', resultado: null, mfeAtr: null, maeAtr: null, velasHastaRuptura: null },
    checks: [],
    playbook: 'rayas.referencia@1',
    nota: 'Marcación manual reanclada a pivotes por cierre (referencia visual, no entrena el motor).',
  });
}

if (!nuevas.length) { console.log('nada que guardar'); process.exit(0); }
/* Se reemplazan las referencias anteriores de este símbolo/TF (el almacén es
   append-only para casos de entrenamiento; las referencias se regeneran). */
const prefijo = `ref-${TF.toLowerCase()}-${SIMBOLO.toLowerCase().replace(/[^a-z0-9]+/g, '')}-`;
const lineas = fs.readFileSync(ARCHIVO, 'utf8').trim().split('\n').filter(Boolean);
const conservadas = lineas.filter((l) => {
  try { return !String(JSON.parse(l).id).startsWith(prefijo); } catch (e) { return true; }
});
fs.writeFileSync(ARCHIVO + '.tmp', [...conservadas, ...nuevas.map((c) => JSON.stringify(c))].join('\n') + '\n');
fs.renameSync(ARCHIVO + '.tmp', ARCHIVO);
console.log(`guardadas ${nuevas.length} referencias en ${ARCHIVO} (reemplazadas ${lineas.length - conservadas.length})`);
for (const c of nuevas) {
  const g = c.geometria;
  console.log(' ', c.id.replace(prefijo, ''), `${g.i1}-${g.i2}`, 'cruces', g.velasCruzadas, 'pen', g.maxPenAtr + 'ATR',
    'p1', g.p1.toFixed(2), 'p2', g.p2.toFixed(2));
}
