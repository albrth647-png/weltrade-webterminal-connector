'use strict';
/* ============================================================
   VERIFICADOR INDEPENDIENTE DE ETIQUETAS
   ------------------------------------------------------------
   No confía en el motor: recalcula EMAs, ATR y toques por su
   cuenta y comprueba que CADA señal emitida cumple la regla del
   patrón que lleva escrito.

     R01 gramática   : patrón ∈ catálogo; tipo (entrada/aviso) coherente
     R02 tendencia   : la señal nace con EMA30<EMA50<EMA100 + pendiente
     R03 precio      : entry = cierre exacto de su vela
     R04 hora        : t = apertura de la vela (el mensaje suma el cierre)
     R05 rompimiento: hay toque previo (≤6 velas) y el cierre rompe SU mínimo
                      (1R/2R/3R: la vela tiene que estar completa, no vale la mecha)
     R06 invalidez   : el nivel de invalidación es el máximo del tramo
     R06b nivel      : el nivel que se envía en el mensaje es el que se rompió
     R07 seductora   : cuerpo ≥50 % y ≥0,3·ATR, salida previa sobre EMA50 (≤12 velas)
                       (1S: NO es un rompimiento de toque, y no vale como R)
     R08 fase        : EARLY/MAIN/LATE o sin fase, nunca otra cosa
     R09 score       : 0..100

   Uso: node validar_reglas.js   (los 4 activos, histórico completo)
   ============================================================ */
const fs = require('fs');
const path = require('path');
const H = require('./raptor_hibrida');

const BASE = path.join(__dirname, '..', 'backtest_hibrida', 'datos');
const TFS = ['M5', 'M15', 'M30', 'H1'];
const SIMS = ['FX_Vol_20', 'FX_Vol_40', 'SFX_Vol_20', 'SFX_Vol_40'];
const CATALOGO = new Set(['1', '2', '3', '1R', '2R', '3R', '1S']);
const AVISOS = new Set(['1', '2', '3']);
const P = { emaFast: 30, emaMid: 50, emaSlow: 100, slopeBars: 10, atrPeriod: 14,
  tolAtr: 0.10, swing: 8, maxBars: 6, bodyRatio: 0.50, bodyAtr: 0.30, fake: 12, fakePre: 5, maxDist: 2.0 };

function leer(sim, tf) {
  const l = fs.readFileSync(path.join(BASE, `${sim}_${tf}.csv`), 'utf8').trim().split('\n');
  const cab = l[0].split(',');
  const ix = (n) => cab.indexOf(n);
  const [it, io, ih, il, ic] = ['time', 'open', 'high', 'low', 'close'].map(ix);
  const df = { t: [], o: [], h: [], l: [], c: [] };
  for (const fila of l.slice(1)) {
    const f = fila.split(',');
    df.t.push(Date.parse(f[it])); df.o.push(+f[io]); df.h.push(+f[ih]); df.l.push(+f[il]); df.c.push(+f[ic]);
  }
  return df;
}
const ema = (x, span) => { const out = []; const a = 2 / (span + 1); x.forEach((v, i) => out.push(i ? a * v + (1 - a) * out[i - 1] : v)); return out; };
const atr = (h, l, c, per) => { const out = []; const a = 1 / per; let prev = c[0];
  for (let i = 0; i < c.length; i++) { const tr = Math.max(h[i] - l[i], Math.abs(h[i] - prev), Math.abs(l[i] - prev)); out.push(i ? a * tr + (1 - a) * out[i - 1] : tr); prev = c[i]; } return out; };
const minDe = (a, d, h) => { let m = Infinity; for (let i = d; i < h; i++) if (a[i] < m) m = a[i]; return m; };
const maxDe = (a, d, h) => { let m = -Infinity; for (let i = d; i < h; i++) if (a[i] > m) m = a[i]; return m; };

let total = 0;
const violaciones = [];

for (const sim of SIMS) {
  const dfs = {};
  for (const tf of TFS) dfs[tf] = leer(sim, tf);
  const { senales } = H.scanHibrida(dfs);

  /* series de referencia por TF (recalculadas aquí, no cogidas del motor) */
  const ref = {};
  for (const tf of TFS) {
    const d = dfs[tf];
    ref[tf] = { e30: ema(d.c, P.emaFast), e50: ema(d.c, P.emaMid), e100: ema(d.c, P.emaSlow), atr: atr(d.h, d.l, d.c, P.atrPeriod), d };
  }

  for (const s of senales) {
    total++;
    const fallo = (regla, detalle) => violaciones.push(`${sim} ${s.tf} ${s.pattern} @${new Date(s.t).toISOString()}: ${regla} — ${detalle}`);
    const d = dfs[s.tf], r = ref[s.tf], i = s.barIndex;
    const bueno = s.direction === 'SELL';

    /* espejo para COMPRA: la regla bajista se cumple sobre series invertidas */
    const sign = bueno ? 1 : -1;
    const o = bueno ? d.o : d.o.map((v) => -v);
    const h = bueno ? d.h : d.l.map((v) => -v);
    const l = bueno ? d.l : d.h.map((v) => -v);
    const c = bueno ? d.c : d.c.map((v) => -v);
    const e30 = bueno ? r.e30 : r.e30.map((v) => -v);
    const e50 = bueno ? r.e50 : r.e50.map((v) => -v);
    const e100 = bueno ? r.e100 : r.e100.map((v) => -v);
    const a = r.atr;
    const tol = P.tolAtr * a[i];
    const entry = sign * s.entry, inval = sign * s.invalidation;

    /* R01 */
    if (!CATALOGO.has(s.pattern)) { fallo('R01 gramática', s.pattern); continue; }
    if ((s.kind === 'touch') !== AVISOS.has(s.pattern)) { fallo('R01 gramática', `tipo ${s.kind} con patrón ${s.pattern}`); continue; }
    /* R02 tendencia — la alineación se mide en la vela de la señal. El filtro
       de distancia («está muy alejada, no lo tomo») se mide en el TOQUE que
       arma el nivel, dentro de quiebre(): la vela del rompimiento está lejos
       de la EMA30 por definición, es la extensión. Medirla aquí marcaba 481
       falsos positivos sobre las R. */
    if (!(e30[i] < e50[i] && e50[i] < e100[i]) || !(e100[i] < e100[i - P.slopeBars])) { fallo('R02 tendencia', 'EMA sin alinear o sin pendiente'); continue; }
    /* R03 precio */
    if (s.kind === 'entry' && Math.abs(entry - c[i]) > 1e-9) { fallo('R03 precio', `entry ${entry} != cierre ${c[i]}`); continue; }
    /* R04 hora */
    if (s.t !== d.t[i]) { fallo('R04 hora', `t ${s.t} != apertura ${d.t[i]}`); continue; }
    /* R08 fase */
    if (s.faseZona !== null && !['EARLY', 'MAIN', 'LATE'].includes(s.faseZona)) { fallo('R08 fase', s.faseZona); continue; }
    /* R09 score */
    if (!(s.score >= 0 && s.score <= 100)) { fallo('R09 score', s.score); continue; }

    if (s.kind === 'touch') continue;   // los avisos no entran: nada más que verificar

    /* R05/R06 — rompimiento del nivel de un toque (1R / 2R / 3R) */
    const quiebre = () => {
      let motivo = 'sin toque previo con ese mínimo';
      for (let tt = Math.max(0, i - P.maxBars - 1); tt < i; tt++) {
        const toca = h[tt] >= e30[tt] - P.tolAtr * a[tt] && h[tt] <= e50[tt] + P.tolAtr * a[tt] && c[tt] < e30[tt];
        if (!toca) continue;
        const refLow = minDe(l, Math.max(0, tt - P.swing), tt);
        if (Math.abs(inval - h[tt]) > 1e-9) { motivo = `invalidación ${inval} != máximo del toque ${h[tt]}`; continue; }
        /* R02 distancia — en el toque, que es donde se aplica el filtro */
        if ((e30[tt] - c[tt]) > P.maxDist * a[tt]) { motivo = `toque demasiado lejos de EMA30 (${(e30[tt] - c[tt]).toFixed(1)} > ${(P.maxDist * a[tt]).toFixed(1)})`; continue; }
        /* R06b — el nivel que se le enseña al propietario es el que se rompió */
        if (!(Math.abs(sign * s.brokenLevel - refLow) <= 1e-9)) { motivo = `nivel enviado ${sign * s.brokenLevel} != mínimo del tramo ${refLow}`; continue; }
        if (!(c[i] < refLow)) { motivo = `cierre ${c[i]} no rompe ${refLow}`; continue; }
        return null;
      }
      return motivo;
    };

    /* R07 — la seductora (engaño sobre EMA50 + quiebre con cuerpo). Se emite
       también como 1R: es el rompimiento del primer hueco. */
    const seductora = () => {
      const cuerpo = Math.abs(c[i] - o[i]), rango = Math.max(h[i] - l[i], 1e-12);
      if (!(c[i] < o[i] && cuerpo / rango >= P.bodyRatio && cuerpo >= P.bodyAtr * a[i])) return 'vela de quiebre sin cuerpo suficiente';
      let motivo = 'sin salida previa sobre la EMA50';
      for (let k = Math.max(0, i - P.fake); k < i; k++) {
        if (!(h[k] > e50[k] + P.tolAtr * a[k])) continue;
        if (Math.abs(inval - maxDe(h, k, i)) > 1e-9) { motivo = `invalidación ${inval} != máximo del tramo`; continue; }
        if (!(c[i] < minDe(l, Math.max(0, k - P.fakePre), i))) { motivo = 'cierre no rompe el mínimo del engaño'; continue; }
        return null;
      }
      return motivo;
    };

    const mQuiebre = quiebre();
    if (s.seductora === true || s.pattern === '1S') { const m = seductora(); if (m) fallo('R07 seductora', m); continue; }
    if (mQuiebre === null) continue;
    /* 1R/2R/3R son SOLO el rompimiento de un toque. Antes la seductora se
       colaba aquí por el atajo «si el patrón es 1R, prueba la seductora»: así
       una R podía no ser ninguna ruptura de nivel, que es justo lo que el
       propietario veía «al revés» en su gráfica. */
    fallo('R05/R06 quiebre', mQuiebre);
  }
}

console.log(`señales verificadas: ${total}`);
console.log(violaciones.length ? `VIOLACIONES: ${violaciones.length}` : 'VIOLACIONES: 0 — cada etiqueta cumple la regla de su patrón');
for (const v of violaciones.slice(0, 12)) console.log('  ', v);
process.exit(violaciones.length ? 1 : 0);
