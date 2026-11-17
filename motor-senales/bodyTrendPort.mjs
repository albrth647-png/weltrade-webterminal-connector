'use strict';
/* ============================================================
   PORT COMPLETO DE BodyTrendBrain.mq5 A JAVASCRIPT
   ------------------------------------------------------------
   Motor de cuerpo + cerebro online nativo (logistico).
   Decisiones propias: confirmar / provisional / debil / suprimir.
   Entrenamiento cronologico online, sin repintado, sin lookahead.

   Parametros:
     InpLeft = 3, InpRight = 3
     InpATRPeriod = 14, InpBreakATR = 0.10
     InpUseBrain = true, InpNOutcome = 20, InpKATR = 1.0
     InpWarmup = 60, InpLR = 0.05, InpDecay = 0.995
     InpThHigh = 0.60, InpThLow = 0.45
     InpSuppressLow = false, InpAdaptBuf = true, InpKappa = 0.5

   Devuelve:
     tendencia, originT, originP, prot, pivots, warned, fan
     protectedLevel, fanLines, originBar
     brain: { samples, lastP, bufFactor, ready, mode }
     lastTier, lastTag, lastTip
   ============================================================ */

const NFEAT = 8;

const BH = (i, o, c) => Math.max(o[i], c[i]);
const BL = (i, o, c) => Math.min(o[i], c[i]);
const Clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const Sigmoid = (z) => {
  if (z > 30) return 1.0;
  if (z < -30) return 0.0;
  return 1.0 / (1.0 + Math.exp(-z));
};

const INP_LEFT = 3;
const INP_RIGHT = 3;
const INP_ATR_PERIOD = 14;
const INP_BREAK_ATR = 0.10;
const INP_USE_BRAIN = true;
const INP_N_OUTCOME = 20;
const INP_K_ATR = 1.0;
const INP_WARMUP = 60;
const INP_LR = 0.05;
const INP_DECAY = 0.995;
const INP_TH_HIGH = 0.60;
const INP_TH_LOW = 0.45;
const INP_SUPPRESS_LOW = false;
const INP_ADAPT_BUF = true;
const INP_KAPPA = 0.5;

function atrSimple(velas, period) {
  const n = velas.length;
  const out = new Array(n).fill(0);
  for (let i = period; i < n; i++) {
    let sum = 0;
    for (let k = 1; k <= period; k++) {
      const rng = Math.max(velas[i - k].h, velas[i - k].c) - Math.min(velas[i - k].l, velas[i - k].o);
      sum += rng;
    }
    out[i] = sum / period;
  }
  return out;
}

function bodyTrendCore(velas) {
  const n = velas.length;
  if (n < INP_LEFT + INP_RIGHT + INP_N_OUTCOME + 10) {
    return { tendencia: 0, originT: 0, originP: 0, prot: 0, pivots: [], warned: false, fan: [], protectedLevel: 0, fanLines: [], originBar: -1, brain: { samples: 0, lastP: 0.5, bufFactor: 1.0, ready: false, mode: 'BASE' }, lastTier: 2, lastTag: 'BASE', lastTip: '' };
  }

  const o = velas.map(v => v.o);
  const c = velas.map(v => v.c);
  const atr = atrSimple(velas, INP_ATR_PERIOD);

  /* estado del motor */
  let pivots = [];
  let np = 0;
  let lastHigh = -1;
  let lastLow = -1;
  let trend = 0;
  let originT = 0;
  let originP = 0;
  let trendStartBar = 0;
  let prot = 0;
  let protName = '';
  let lineName = '';
  let lT1 = 0, lT2 = 0, lP1 = 0, lP2 = 0;
  let warned = false;
  let fan = [];
  let nfan = 0;
  let seq = 0;
  let last = -1;

  /* cerebro */
  let w = new Array(NFEAT).fill(0);
  let samples = 0;
  let lastP = 0.5;
  let bufFactor = 1.0;
  let brainReady = false;
  let sigs = []; // { bar, dir, level, atr, x[], resolved }

  function newSeq() { seq++; return seq; }

  function score(x) {
    let z = 0;
    for (let k = 0; k < NFEAT; k++) z += w[k] * x[k];
    return Sigmoid(z);
  }

  function updateWeights(x, label) {
    const p = score(x);
    const err = label - p;
    for (let k = 0; k < NFEAT; k++) {
      w[k] = Clamp(w[k] * INP_DECAY + INP_LR * err * x[k], -5.0, 5.0);
    }
    samples++;
    brainReady = (samples >= INP_WARMUP);
  }

  function lineVal(t) {
    if (lT2 === lT1) return lP1;
    return lP1 + (lP2 - lP1) * (t - lT1) / (lT2 - lT1);
  }

  function findOrigin(want, from, to) {
    let found = false;
    let best = 0;
    let bt = 0;
    for (let k = 0; k < np; k++) {
      if (pivots[k].type === want && pivots[k].bar >= from && pivots[k].bar <= to) {
        const p = pivots[k].p;
        if (!found || (want > 0 ? p > best : p < best)) {
          found = true; best = p; bt = pivots[k].t;
        }
      }
    }
    if (!found) {
      let a = Math.max(0, from);
      let b = to;
      if (b < a) return { found: false, t: 0, p: 0 };
      best = (want > 0) ? BH(a, o, c) : BL(a, o, c);
      bt = velas[a].t;
      for (let i2 = a + 1; i2 <= b; i2++) {
        const p = (want > 0) ? BH(i2, o, c) : BL(i2, o, c);
        if (want > 0 ? p > best : p < best) { best = p; bt = velas[i2].t; }
      }
      found = true;
    }
    return { found, t: bt, p: best };
  }

  function buildFeatures(i, dir, level, sinceBar) {
    const A = Math.max(atr[i], 0.0001);
    let a = Math.max(0, i - 49);
    let sum = 0, cnt = 0;
    for (let k = a; k <= i; k++) { sum += atr[k]; cnt++; }
    let mean = (cnt > 0) ? sum / cnt : A;
    if (mean <= 0) mean = A;
    let slope = 0;
    let bars = (lT2 - lT1) / 1; // en JS no tenemos PeriodSeconds, usamos barras
    if (bars > 0) slope = (lP2 - lP1) / bars;
    let nstruct = 0;
    const want = (dir > 0) ? -1 : +1;
    for (let k = 0; k < np; k++) {
      if (pivots[k].type === want && pivots[k].bar >= sinceBar && pivots[k].bar <= i) nstruct++;
    }
    const x = new Array(NFEAT);
    x[0] = 1.0;
    x[1] = Clamp((dir > 0 ? (c[i] - level) : (level - c[i])) / A, -5, 5);
    x[2] = Clamp((i - sinceBar) / 100.0, 0, 1);
    x[3] = Clamp(slope / A, -3, 3);
    x[4] = Clamp((dir > 0 ? (c[i] - originP) : (originP - c[i])) / A, -10, 10);
    x[5] = Clamp(atr[i] / mean, 0.2, 3);
    x[6] = Clamp(Math.abs(c[i] - o[i]) / A, 0, 3);
    x[7] = Clamp(nstruct / 10.0, 0, 1);
    return x;
  }

  function resolveOutcomes(i) {
    for (let k = 0; k < sigs.length; k++) {
      if (sigs[k].resolved) continue;
      if (sigs[k].bar + INP_N_OUTCOME > i) continue;
      const A = Math.max(sigs[k].atr, 0.0001);
      const up = sigs[k].level + INP_K_ATR * A;
      const dn = sigs[k].level - INP_K_ATR * A;
      let label = 0;
      let done = false;
      for (let j = sigs[k].bar + 1; j <= sigs[k].bar + INP_N_OUTCOME; j++) {
        const bh = BH(j, o, c);
        const bl = BL(j, o, c);
        if (sigs[k].dir > 0) {
          if (bl <= dn) { label = 0; done = true; break; }
          else if (bh >= up) { label = 1; done = true; break; }
        } else {
          if (bh >= up) { label = 0; done = true; break; }
          else if (bl <= dn) { label = 1; done = true; break; }
        }
      }
      if (!done) label = 0;
      updateWeights(sigs[k].x, label);
      sigs[k].resolved = true;
    }
    // limpiar señales resueltas si hay demasiadas
    if (sigs.length > 5000) {
      const w = [];
      for (let k = 0; k < sigs.length; k++) {
        if (!sigs[k].resolved) w.push(sigs[k]);
      }
      sigs = w;
    }
  }

  function decide(x) {
    if (!INP_USE_BRAIN || !brainReady) { return { tier: 2, p: 0.5, base: true }; }
    const p = score(x);
    let tier = 0;
    if (p >= INP_TH_HIGH) tier = 2;
    else if (p >= INP_TH_LOW) tier = 1;
    else tier = 0;
    return { tier, p, base: false };
  }

  function tierTag(tier, base) {
    if (base) return 'BASE';
    if (tier === 2) return 'CONF';
    if (tier === 1) return 'PROV';
    return 'DEBIL';
  }

  function tierStyle(tier) {
    if (tier === 2) return 'solid';
    if (tier === 1) return 'dash';
    return 'dot';
  }

  let lastTier = 2;
  let lastTag = 'BASE';
  let lastTip = '';
  let lastSignalBar = -1;

  function beginTrend(nt, i, sinceBar, useLast, broken) {
    // FreezeProtected
    protName = '';
    // FadeFan: marcar fan lines anteriores como rotas
    // En JS no dibujamos aqui, solo registramos
    lineName = '';
    warned = false;
    trend = nt;
    trendStartBar = i;
    const want = (nt > 0) ? -1 : +1;
    let ot = 0, op = 0, ok = false;
    if (useLast) {
      const idx = (nt > 0) ? lastLow : lastHigh;
      if (idx >= 0 && idx < np) { ot = pivots[idx].t; op = pivots[idx].p; ok = true; }
    }
    if (!ok) {
      const r = findOrigin(want, sinceBar, i);
      if (r.found) { ot = r.t; op = r.p; ok = true; }
    }
    if (!ok) { ot = velas[i].t; op = (nt > 0) ? BL(i, o, c) : BH(i, o, c); }
    originT = ot;
    originP = op;

    // Cerebro: features -> decision -> marca -> registro para aprender
    const x = buildFeatures(i, nt, broken, sinceBar);
    const dec = decide(x);
    const p = dec.p;
    lastP = p;
    const base = dec.base;
    if (INP_ADAPT_BUF && !base) {
      bufFactor = Clamp(1.0 + INP_KAPPA * (1.0 - p), 0.5, 2.0);
    } else {
      bufFactor = 1.0;
    }

    const tier = dec.tier;
    lastTier = tier;
    lastTag = tierTag(tier, base);
    const tag = lastTag;
    const tip = tag + ' | p=' + p.toFixed(2) + ' | muestras=' + samples + ' | margen x' + bufFactor.toFixed(2) + ' | cierre=' + c[i].toFixed(2) + ' nivel=' + broken.toFixed(2);

    const col = (nt > 0) ? 'bull' : 'bear';
    // SetProtected
    prot = op;
    protName = 'protected';
    // SetFanLine: diagonal inicial
    lineName = 'line';
    lT1 = originT; lP1 = originP;
    lT2 = velas[i].t; lP2 = (nt > 0) ? BL(i, o, c) : BH(i, o, c);
    fan.push({ t1: originT, p1: originP, t2: velas[i].t, p2: (nt > 0) ? BL(i, o, c) : BH(i, o, c), color: col, tip });
    nfan++;

    lastTip = tip;
    lastSignalBar = i;

    // Registrar señal para aprender
    sigs.push({ bar: i, dir: nt, level: broken, atr: Math.max(atr[i], 0.0001), x: x.slice(), resolved: false });
  }

  function addPivot(type, bar) {
    pivots[np] = { t: velas[bar].t, p: (type > 0) ? BH(bar, o, c) : BL(bar, o, c), type, bar };
    np++;
    if (type > 0) lastHigh = np - 1; else lastLow = np - 1;

    const tip = 'Pivote cuerpo ' + (type > 0 ? 'MAX' : 'MIN') + ' | ' + ((type > 0) ? BH(bar, o, c) : BL(bar, o, c)).toFixed(2);

    if (trend > 0 && type < 0 && pivots[np - 1].p > prot && velas[bar].t > originT) {
      fan.push({ t1: originT, p1: originP, t2: velas[bar].t, p2: pivots[np - 1].p, color: 'bull', tip });
      nfan++;
      prot = pivots[np - 1].p;
    } else if (trend < 0 && type > 0 && pivots[np - 1].p < prot && velas[bar].t > originT) {
      fan.push({ t1: originT, p1: originP, t2: velas[bar].t, p2: pivots[np - 1].p, color: 'bear', tip });
      nfan++;
      prot = pivots[np - 1].p;
    }
  }

  const end = n - 2;
  const start = INP_LEFT + INP_RIGHT;

  for (let i = start; i <= end; i++) {
    // 1) Resolver resultados completados y entrenar
    resolveOutcomes(i);

    // 2) Margen adaptativo
    const buf = INP_BREAK_ATR * atr[i] * bufFactor;

    // 3) Cambio de tendencia
    if (trend > 0 && c[i] < prot - buf) {
      const broken = prot;
      beginTrend(-1, i, trendStartBar, false, broken);
    } else if (trend < 0 && c[i] > prot + buf) {
      const broken = prot;
      beginTrend(+1, i, trendStartBar, false, broken);
    } else if (trend === 0) {
      if (lastHigh >= 0 && c[i] > pivots[lastHigh].p + buf) {
        const broken = pivots[lastHigh].p;
        beginTrend(+1, i, Math.max(0, i - 100), true, broken);
      } else if (lastLow >= 0 && c[i] < pivots[lastLow].p - buf) {
        const broken = pivots[lastLow].p;
        beginTrend(-1, i, Math.max(0, i - 100), true, broken);
      }
    }

    // 4) Aviso: cierre rompe la diagonal vigente
    if (trend !== 0 && lineName !== '' && !warned) {
      const lv = lineVal(i);
      if ((trend > 0 && c[i] < lv - buf) || (trend < 0 && c[i] > lv + buf)) {
        warned = true;
      }
    }

    // 5) Confirmacion de pivote de cuerpo
    const cc = i - INP_RIGHT;
    if (cc >= INP_LEFT) {
      const bh = BH(cc, o, c);
      const bl = BL(cc, o, c);
      let isH = true, isL = true;
      for (let k = 1; k <= INP_LEFT; k++) {
        if (bh <= BH(cc - k, o, c)) isH = false;
        if (bl >= BL(cc - k, o, c)) isL = false;
      }
      for (let k = 1; k <= INP_RIGHT; k++) {
        if (bh <= BH(cc + k, o, c)) isH = false;
        if (bl >= BL(cc + k, o, c)) isL = false;
      }
      if (isH) addPivot(+1, cc);
      if (isL) addPivot(-1, cc);
    }
  }

  // originBar
  let originBar = -1;
  for (let i = 0; i < n; i++) {
    if (velas[i].t === originT) { originBar = i; break; }
  }

  const mode = (INP_USE_BRAIN && brainReady) ? 'ONLINE' : 'BASE';
  const trendStr = (trend > 0) ? 'ALCISTA' : (trend < 0) ? 'BAJISTA' : 'SIN TENDENCIA';

  return {
    tendencia: trend,
    originT,
    originP,
    prot,
    pivots: pivots.slice(0, np),
    warned,
    fan: fan.slice(0, nfan),
    protectedLevel: prot,
    fanLines: fan.slice(0, nfan),
    originBar,
    brain: {
      samples,
      lastP,
      bufFactor,
      ready: brainReady,
      mode
    },
    lastTier,
    lastTag,
    lastTip,
    trendStr
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { bodyTrendCore, BH, BL, NFEAT, INP_LEFT, INP_RIGHT, INP_ATR_PERIOD, INP_BREAK_ATR, atrSimple };
}
if (typeof globalThis !== 'undefined') {
  globalThis.bodyTrendCore = bodyTrendCore;
}
"