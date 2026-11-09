'use strict';
/* ============================================================
   RAPTOR NÚCLEO v2 — port fiel de estrategias/raptor_strategy.py
   ------------------------------------------------------------
   Vocabulario del propietario (captura 2026-11-09, SFX Vol 20 H1):
   el NÚMERO es el toque de la EMA30 y la R es su ROMPIMIENTO.
     · toques (aviso)      : 1, 2, 3
     · rompimientos (entrada): 1R, 2R, 3R
   El reset de la secuencia ya NO es un sufijo: viaja como dato del evento
   (`reset`, `ciclo`), porque la R significa rompimiento, no reset.
   La seductora (engaño sobre EMA50 + quiebre con cuerpo) NO es un rompimiento
   de toque: lleva su propio código 1S (`seductora: true`). Antes salía como 1R
   y el propietario la veía «al revés», porque en su gráfica la R es SIEMPRE el
   cierre que rompe el nivel de un toque, a favor de la tendencia.
   Además está APAGADA por defecto (`seductora: false`): su catálogo son las
   tres estrategias con sus tres rompimientos. MS_SEDUCTORA=1 la enciende.
   EMA30 (zona) / EMA50 (techo «el límite») / EMA100 (tendencia).

   Cada valor numérico es un parámetro ajustable, igual que en
   Python: el port no inventa ni cambia ninguno.
   ============================================================ */

const RANK = { M1: 0, M5: 1, M15: 2, M30: 3, H1: 4, H4: 5 };
const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4'];
const TOUCH_PATTERNS = new Set(['1', '2', '3']);
const ENTRY_PATTERNS = new Set(['1R', '2R', '3R', '1S']);

const PARAMS = {
  emaFast: 30, emaMid: 50, emaSlow: 100,
  slopeBars: 10, atrPeriod: 14, tolAtr: 0.10,
  swingLookback: 8, maxBarsToBreak: 6,
  minBodyRatio: 0.50, minBodyAtr: 0.30, requireBodyOnBreak: false,
  requireExtension: true,
  fakeLookback: 12, fakePreBars: 5,
  resetAfterSignal: true, resetOnAbandonedExit: true,
  emitTouches: true, emitTouchesFrom: 'M15',
  maxDistAtr: 2.0, ruptura1: true, seductora: false, newTrendGap: 60,
};

function params(over = {}) {
  const p = { ...PARAMS, ...over };
  if (RANK[p.emitTouchesFrom] === undefined) throw new Error(`emitTouchesFrom inválido: ${p.emitTouchesFrom}`);
  return p;
}

/* pd.Series(x).ewm(span, adjust=False) */
function ema(x, span) {
  const n = x.length, out = new Float64Array(n);
  if (!n) return out;
  const a = 2 / (span + 1);
  out[0] = x[0];
  for (let i = 1; i < n; i++) out[i] = a * x[i] + (1 - a) * out[i - 1];
  return out;
}

/* ATR del núcleo: EWM(alpha=1/period) sobre el TR */
function atrEwm(h, l, c, period) {
  const n = c.length, out = new Float64Array(n);
  if (!n) return out;
  const a = 1 / period;
  let prev = c[0];
  for (let i = 0; i < n; i++) {
    const tr = Math.max(h[i] - l[i], Math.abs(h[i] - prev), Math.abs(l[i] - prev));
    out[i] = i === 0 ? tr : a * tr + (1 - a) * out[i - 1];
    prev = c[i];
  }
  return out;
}

function minRange(arr, desde, hasta) {           // [desde, hasta)
  let m = Infinity;
  for (let i = desde; i < hasta; i++) if (arr[i] < m) m = arr[i];
  return m;
}

function maxRange(arr, desde, hasta) {
  let m = -Infinity;
  for (let i = desde; i < hasta; i++) if (arr[i] > m) m = arr[i];
  return m;
}

/* Detección BAJISTA; el lado alcista usa series espejo. */
function scanBearish(o, h, l, c, p, tf) {
  const n = c.length;
  const warm = p.emaSlow + p.slopeBars;
  if (n <= warm + 2) return [];

  const e30 = ema(c, p.emaFast), e50 = ema(c, p.emaMid), e100 = ema(c, p.emaSlow);
  const atr = atrEwm(h, l, c, p.atrPeriod);

  const bodyBreak = new Uint8Array(n), trend = new Uint8Array(n);
  const touchZone = new Uint8Array(n), exceeds = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    const tol = p.tolAtr * atr[i];
    const cuerpo = Math.abs(c[i] - o[i]);
    const rango = Math.max(h[i] - l[i], 1e-12);
    bodyBreak[i] = (c[i] < o[i] && cuerpo / rango >= p.minBodyRatio && cuerpo >= p.minBodyAtr * atr[i]) ? 1 : 0;

    const distOk = p.maxDistAtr == null ? true : (e30[i] - c[i]) <= p.maxDistAtr * atr[i];
    const slopeDn = i >= p.slopeBars ? e100[i] < e100[i - p.slopeBars] : false;
    trend[i] = (e30[i] < e50[i] && e50[i] < e100[i] && slopeDn) ? 1 : 0;
    touchZone[i] = (h[i] >= e30[i] - tol && h[i] <= e50[i] + tol && c[i] < e30[i] && distOk) ? 1 : 0;
    exceeds[i] = h[i] > e50[i] + tol ? 1 : 0;
  }

  const emitTouchHere = p.emitTouches && RANK[tf] >= RANK[p.emitTouchesFrom];
  const events = [];
  let cycle = 0, touches = 0, lost = false, lostSince = 0, hadTrend = false;
  let lastTouchI = -1, lastTouchLow = Infinity, pend = null;
  let minExitBar = -1, exitOpen = false, exitK = -1;

  for (let i = warm; i < n; i++) {
    if (!trend[i]) {
      if (hadTrend && !lost) { lost = true; lostSince = i; }
      touches = 0; pend = null; lastTouchI = -1; exitOpen = false;
      continue;
    }
    if (lost) {                                   // la tendencia volvió
      cycle = (i - lostSince >= p.newTrendGap) ? 0 : cycle + 1;
      lost = false;
    }
    hadTrend = true;

    let fired = false;

    /* salida sobre la EMA50: «se sale» / «el límite» */
    if (exceeds[i]) {
      pend = null;
      if (touches >= 1 || cycle >= 1) {
        touches = 0; lastTouchI = -1;
        if (p.resetOnAbandonedExit) { exitOpen = true; exitK = i; }
      }
    }

    /* rompimiento pendiente del toque → 1R/2R/3R (vela COMPLETA:
       el cierre queda más allá del nivel, la mecha no basta) */
    if (pend !== null && i > pend.idx) {
      if (exceeds[i] || i - pend.idx > p.maxBarsToBreak) {
        pend = null;
      } else if ((bodyBreak[i] || !p.requireBodyOnBreak) && c[i] < pend.refLow) {
        events.push({
          idx: i, kind: 'entry', pattern: `${pend.n}R`,
          entry: c[i], invalidation: pend.inval, broken: pend.refLow,
          reset: cycle >= 1, ciclo: cycle,
        });
        touches = 0; pend = null; lastTouchI = -1;
        if (p.resetAfterSignal) cycle++;
        fired = true;
      }
    }

    /* conteo de toques de la EMA30 → 1/2/3 (aviso) */
    if (touchZone[i] && !touchZone[i - 1]) {
      let ok = true;
      if (touches >= 1 && p.requireExtension && lastTouchI >= 0) {
        const desde = lastTouchI + 1;
        ok = desde < i && minRange(l, desde, i) < lastTouchLow;   // «supera»
      }
      if (ok) {
        touches++; lastTouchI = i; lastTouchLow = l[i];
        if (exitOpen) { exitOpen = false; minExitBar = exitK; cycle++; }  // salió y volvió
        if (touches >= 1 && touches <= 3) {
          const refLow = minRange(l, Math.max(0, i - p.swingLookback), i);
          /* El 1.er toque también arma su nivel: su rompimiento es la 1R.
             Con ruptura1=false se conserva el comportamiento anterior (solo
             el 2.º y el 3.er toque armaban nivel). */
          if (touches >= 2 || p.ruptura1) pend = { idx: i, refLow, inval: h[i], n: touches };
          if (emitTouchHere) {
            events.push({
              idx: i, kind: 'touch', pattern: String(touches),
              entry: NaN, invalidation: h[i], broken: refLow,
              reset: cycle >= 1, ciclo: cycle,
            });
          }
        }
      }
    }

    /* la seductora: engaño + regreso + quiebre con cuerpo. NO es la estrategia
       1 (esa es el primer toque y su 1R): por eso va aparte y apagada. */
    if (p.seductora && !fired && bodyBreak[i] && c[i] < e30[i]) {
      const desde = Math.max(0, i - p.fakeLookback);
      let k = -1;
      for (let j = desde; j < i; j++) if (exceeds[j] && j > minExitBar) k = j;  // salida NUEVA
      if (k >= 0) {
        const ref = minRange(l, Math.max(0, k - p.fakePreBars), i);
        if (c[i] < ref) {
          minExitBar = i;
          events.push({
            idx: i, kind: 'entry', pattern: '1S', seductora: true,
            entry: c[i], invalidation: maxRange(h, k, i), broken: ref,
            reset: cycle >= 1, ciclo: cycle,
          });
          touches = 0; pend = null; lastTouchI = -1; exitOpen = false;
          if (p.resetAfterSignal) cycle++;
        }
      }
    }
  }
  return events;
}

/* df = { t:[], o:[], h:[], l:[], c:[] } con velas CERRADAS */
function scan(df, tf, p = params()) {
  if (RANK[tf] === undefined) throw new Error(`timeframe desconocido: ${tf}`);
  const n = (df.c || []).length;
  const rows = [];

  for (const [direction, sign] of [['SELL', 1], ['BUY', -1]]) {
    const o = new Float64Array(n), h = new Float64Array(n);
    const l = new Float64Array(n), c = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      o[i] = sign * df.o[i];
      h[i] = sign * (sign === 1 ? df.h[i] : df.l[i]);
      l[i] = sign * (sign === 1 ? df.l[i] : df.h[i]);
      c[i] = sign * df.c[i];
    }
    for (const ev of scanBearish(o, h, l, c, p, tf)) {
      rows.push({
        t: df.t[ev.idx], barIndex: ev.idx, tf, direction, kind: ev.kind, pattern: ev.pattern,
        entry: sign * ev.entry, invalidation: sign * ev.invalidation, brokenLevel: sign * ev.broken,
        reset: !!ev.reset, ciclo: ev.ciclo || 0, seductora: !!ev.seductora,
      });
    }
  }
  /* orden de pandas: bar_index, direction (BUY < SELL) */
  rows.sort((a, b) => a.barIndex - b.barIndex
    || (a.direction === b.direction ? 0 : a.direction < b.direction ? -1 : 1));
  return rows;
}

/* solo las señales de la ÚLTIMA vela cerrada (uso en vivo) */
function scanLast(df, tf, p = params()) {
  const n = (df.c || []).length;
  return scan(df, tf, p).filter((s) => s.barIndex === n - 1);
}

function multiTfTrend(dfs, p = params()) {
  const out = {};
  for (const [tf, df] of Object.entries(dfs)) {
    const c = df.c;
    if (!c || c.length < p.emaSlow + 2) { out[tf] = null; continue; }
    const e30 = ema(c, p.emaFast), e50 = ema(c, p.emaMid), e100 = ema(c, p.emaSlow);
    const i = c.length - 1;
    if (c[i] < e30[i] && e30[i] < e50[i] && e50[i] < e100[i]) out[tf] = 'SELL';
    else if (c[i] > e30[i] && e30[i] > e50[i] && e50[i] > e100[i]) out[tf] = 'BUY';
    else out[tf] = null;
  }
  return out;
}

module.exports = {
  TIMEFRAMES, RANK, TOUCH_PATTERNS, ENTRY_PATTERNS, PARAMS, params,
  ema, atrEwm, scan, scanLast, multiTfTrend,
};
