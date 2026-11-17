'use strict';
/* ============================================================
   Validación de marcaciones contra las marcas guardadas.
   ------------------------------------------------------------
   Para cada marca (dos anclas en el tiempo) se calcula la familia de rayas
   con la serie verificada y se busca la raya que mejor la reproduce.
   Se mide el error en ATR en cada ancla y si la raya existe con el mismo
   sentido. Es la prueba de "bien marcada", no de "se parece".

   Uso: node validar_rayas.cjs ["SFX Vol 20"]
   ============================================================ */
const fs = require('fs');
const path = require('path');
const { familiaRayas, atr } = require('./rayas');

const estado = JSON.parse(fs.readFileSync(path.join(__dirname, '.estado.json'), 'utf8'));
const series = {};
for (const [sim, v] of Object.entries(estado.simbodo || {})) {
  const velas = (v.velas && v.velas.M5) || [];
  if (velas.length >= 200) series[sim] = velas;
}

const filtro = process.argv[2];
const casos = fs.readFileSync(path.join(__dirname, 'datos', 'casos.jsonl'), 'utf8')
  .trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  .filter((c) => c.origen && c.origen.marcasOriginales)
  .filter((c) => !filtro || (c.mercado || {}).simbolo === filtro);

const porSimbolo = {};
for (const c of casos) {
  const sim = (c.mercado || {}).simbolo;
  (porSimbolo[sim] = porSimbolo[sim] || []).push(c);
}

let totalErr = 0, totalN = 0, dentro2atr = 0;

for (const [sim, lista] of Object.entries(porSimbolo)) {
  const velas = series[sim];
  if (!velas) { console.log(`\n${sim}: sin serie verificada`); continue; }
  const idxPorT = new Map(velas.map((v, i) => [v.t, i]));

  console.log(`\n=== ${sim} · ${lista.length} marcas ===`);
  console.log('marca      tipo       err@1  err@2  medio  ¿en top5?  anclas de la raya');

  for (const c of lista) {
    const o = c.origen.marcasOriginales;
    const i1 = idxPorT.get(o.t1), i2 = idxPorT.get(o.t2);
    if (i1 == null || i2 == null) { console.log(`${c.origen.lineaId}  sin velas para sus anclas`); continue; }
    const tipo = o.p2 > o.p1 ? 'alcista' : 'bajista';

    /* Sin hindsight: solo las velas que existían cuando se trazó la marca. */
    const hasta = velas.slice(0, i2 + 1);
    const A = atr(hasta, 14);
    const atrRef = A[A.length - 1] || 1;
    const fam = familiaRayas(hasta);
    /* Segundo paseo con tope amplio: ¿la geometría es producible en absoluto? */
    const famAmplia = familiaRayas(hasta, { maxRayasFamilia: 60, dedupAtr: 1.5 });

    const evaluar = (rs) => {
      let mejor = null;
      for (const r of rs) {
        if (r.tipo !== tipo) continue;
        const y1 = r.base + r.m * (i1 - r.iA);
        const y2 = r.base + r.m * (i2 - r.iA);
        const e1 = Math.abs(y1 - o.p1) / atrRef;
        const e2 = Math.abs(y2 - o.p2) / atrRef;
        const medio = (e1 + e2) / 2;
        if (!mejor || medio < mejor.medio) mejor = { r, e1, e2, medio };
      }
      return mejor;
    };

    const m5 = evaluar(fam);
    const mAmplia = evaluar(famAmplia);
    const mejor = m5 && m5.medio <= (mAmplia ? mAmplia.medio : Infinity) ? m5 : mAmplia;
    if (!mejor) { console.log(`${String(c.origen.lineaId).padEnd(10)} ${tipo.padEnd(9)}  — sin raya ${tipo}`); continue; }

    totalErr += mejor.medio; totalN++;
    if (mejor.medio <= 2) dentro2atr++;
    const enTop5 = m5 && m5.medio <= 2 ? 'sí' : 'no';
    console.log(
      `${String(c.origen.lineaId).padEnd(10)} ${tipo.padEnd(9)} ${mejor.e1.toFixed(1).padStart(5)} ${mejor.e2.toFixed(1).padStart(6)} ${mejor.medio.toFixed(2).padStart(6)}  ${enTop5.padEnd(8)}  ${mejor.r.iA}..${mejor.r.i2} toques=${mejor.r.toques}`
    );
  }
}

console.log(`\nRESUMEN (sin hindsight, datos hasta el cierre de cada marca):`);
console.log(`  error medio ${totalN ? (totalErr / totalN).toFixed(2) : '—'} ATR · dentro de 2 ATR: ${dentro2atr}/${totalN}`);
