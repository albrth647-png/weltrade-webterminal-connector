'use strict';
/* Analiza las marcas manuales del propietario contra la serie real.
   Uso: node analizar_marcas.mjs [marcas.json] [serie.json]
   La serie se puede bajar de /velas. Las marcas traen t1/t2 (ms) y p1/p2. */
const fs = require('fs');

const RUTA_MARCAS = process.argv[2] || '/tmp/marcas_sfx40.json';
const RUTA_SERIE = process.argv[3] || '/tmp/sfx40c.json';

const marcas = JSON.parse(fs.readFileSync(RUTA_MARCAS, 'utf8'));
const datos = JSON.parse(fs.readFileSync(RUTA_SERIE, 'utf8'));
const velas = datos.velas;
const n = velas.length;

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
const idxT = new Map();
velas.forEach((v, i) => idxT.set(v.t, i));
const masCercano = (t) => {
  if (idxT.has(t)) return idxT.get(t);
  let mejor = -1, dif = Infinity;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(velas[i].t - t);
    if (d < dif) { dif = d; mejor = i; }
  }
  return mejor;
};

const SEG = 300000; // M5 en ms
const filas = [];
for (const m of marcas) {
  const i1 = masCercano(m.t1), i2 = masCercano(m.t2);
  const desplaz = Math.round((m.t1 - velas[i1].t) / SEG);
  const span = i2 - i1;
  const linea = (i) => m.p1 + ((m.p2 - m.p1) * (i - i1)) / (i2 - i1 || 1);
  let cruces = 0, maxPen = 0, sumaDebajo = 0, cuentaDebajo = 0, tocaMecha = 0;
  for (let i = i1; i <= i2; i++) {
    const v = velas[i];
    const lo = Math.min(v.o, v.c), hi = Math.max(v.o, v.c);
    const y = linea(i);
    if (y > lo && y < hi) {
      cruces++;
      const pen = Math.min(y - lo, hi - y);
      if (pen > maxPen) maxPen = pen;
    }
    // distancia vertical al cuerpo más cercano (negativa = por debajo)
    const d = y < lo ? y - lo : y > hi ? y - hi : 0;
    if (d < 0) { sumaDebajo += -d / A[i]; cuentaDebajo++; }
    if (y >= v.l && y <= v.h) tocaMecha++;
  }
  filas.push({
    id: m.id,
    desde: new Date(velas[i1].t).toISOString().slice(0, 16),
    span,
    dias: +(span * 5 / 60 / 24).toFixed(1),
    pendAtr: +((m.p2 - m.p1) / (i2 - i1) / A[i2] * 100).toFixed(2),
    cruces,
    pctCruces: +(100 * cruces / (span + 1)).toFixed(1),
    maxPenAtr: +(maxPen / A[i2]).toFixed(2),
    offsetAtr: cuentaDebajo ? +(sumaDebajo / cuentaDebajo).toFixed(2) : 0,
    mechas: +(100 * tocaMecha / (span + 1)).toFixed(0),
    desplaz,
    p1vsCierre: +((m.p1 - velas[i1].c) / A[i1]).toFixed(2),
    p2vsCierre: +((m.p2 - velas[i2].c) / A[i2]).toFixed(2),
  });
}

filas.sort((a, b) => a.span - b.span);
console.log(`serie ${n} velas  ${new Date(velas[0].t).toISOString().slice(0, 16)} .. ${new Date(velas[n - 1].t).toISOString().slice(0, 16)}  ATR=${A[n - 1].toFixed(2)}`);
for (const f of filas) {
  console.log(
    `${f.id}  desde ${f.desde}  ${String(f.span).padStart(4)} velas (${f.dias}d)  pend ${String(f.pendAtr).padStart(6)}%ATR  ` +
    `cuerpos ${String(f.cruces).padStart(3)} (${f.pctCruces}%)  pen ${f.maxPenAtr}ATR  ` +
    `offset ${f.offsetAtr}ATR  mechas ${f.mechas}%  desplaz ${f.desplaz}  p1-c ${f.p1vsCierre}ATR  p2-c ${f.p2vsCierre}ATR`
  );
}
const porGrupo = new Map();
for (const f of filas) {
  const g = Math.round(f.span / 1000);
  porGrupo.set(g, (porGrupo.get(g) || 0) + 1);
}
console.log('grupos por millar de velas:', [...porGrupo.entries()].map(([g, c]) => `${g}k:${c}`).join(' '));
