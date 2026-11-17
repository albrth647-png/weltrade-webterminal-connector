/* ============================================================================
 * btb-core.js · NÚCLEO DETERMINISTA DE MARCACIONES (cuerpo de vela)
 * Sin DOM · sin dependencias · Node (Termux) o navegador · UMD
 *
 * CONTRATO:
 *  1. Pivotes y niveles SOLO al cuerpo: max(o,c) / min(o,c). Nunca mechas.
 *  2. Rupturas SOLO por cierre de vela cerrada + margen ATR.
 *  3. CAMBIO = cierre rompe el nivel protegido (CHoCH). No por toques.
 *  4. Abanico = origen -> cada mínimo creciente (alcista) / máximo decreciente.
 *     NO es un zigzag de todos los pivotes. (Eso era el ruido de su captura.)
 *  5. Horizontales: la rota que inicia tendencia y la protegida que la termina.
 *  6. Sin proyección hacia atrás: toda línea nace en su ancla `a`.
 *  7. VIVA exige >=2 toques y >=1 rechazo por cierre; si no, CANDIDATA.
 *  8. ENGAÑO solo si un CAMBIO confirmado falla en <= engN velas.
 *  9. Votos MTF con regla explícita; el agregado se deriva de esos votos.
 * 10. Cerebro online opcional (ruta A), forward-only, sin repintado.
 * ==========================================================================*/
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BTB = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULTS = {
    pivL: 3, pivR: 3,          // ventana de pivote de cuerpo
    atrPeriod: 14,
    marginATR: 0.10,           // margen de ruptura = ATR * factor
    tolATR: 0.15,              // tolerancia de toque al trendline
    engN: 10,                  // ventana para declarar ENGAÑO
    keepFan: true,             // conservar abanico histórico
    emitLegs: false,           // piernas de estructura (SOLO depuración)
    emitPivots: false,         // puntos de pivote (SOLO depuración)
    closedOnly: true,          // ignorar la última vela (en formación)
    // cerebro online (ruta A)
    brain: false,
    nOut: 20, kATR: 1.0, warmup: 60,
    lr: 0.05, decay: 0.995,
    thHigh: 0.60, thLow: 0.45,
    suppressLow: false, adaptMargin: true, kappa: 0.5,
    // votos
    voteStrength: 0.06, voteFactors: [1, 2, 4, 8]
  };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const BH = d => Math.max(d.o, d.c);
  const BL = d => Math.min(d.o, d.c);
  const isNum = v => typeof v === "number" && isFinite(v);

  function validateConfig(c) {
    const P = Object.assign({}, DEFAULTS, c || {});    if (P.pivL < 1 || P.pivR < 1) throw new Error("pivL/pivR >= 1");
    if (P.atrPeriod < 1) throw new Error("atrPeriod >= 1");
    if (P.marginATR < 0 || P.tolATR <= 0) throw new Error("margenes inválidos");
    if (P.nOut < 1 || P.kATR <= 0) throw new Error("nOut/kATR inválidos");
    if (!(P.thLow > 0 && P.thHigh > P.thLow && P.thHigh < 1)) throw new Error("umbrales inválidos");
    return P;
  }

  function normalizeCandles(arr) {
    if (!Array.isArray(arr)) throw new Error("candles debe ser array");
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      const x = arr[i];
      const c = {
        t: +(x.t ?? x.time ?? x.timestamp ?? i),
        o: +(x.o ?? x.open), h: +(x.h ?? x.high),
        l: +(x.l ?? x.low), c: +(x.c ?? x.close)
      };
      if (![c.t, c.o, c.h, c.l, c.c].every(isNum)) continue;
      if (c.h < Math.max(c.o, c.c) - 1e-9 || c.l > Math.min(c.o, c.c) + 1e-9) continue;
      out.push(c);
    }
    out.sort((a, b) => a.t - b.t);
    return out;
  }

  function atrSeries(d, p) {
    const out = new Array(d.length).fill(0);
    let sum = 0, prev = d.length ? d[0].c : 0;
    for (let i = 0; i < d.length; i++) {
      const tr = i ? Math.max(d[i].h - d[i].l, Math.abs(d[i].h - prev), Math.abs(d[i].l - prev))
                   : d[i].h - d[i].l;
      out[i] = i < p ? (sum += tr) / (i + 1) : (out[i - 1] * (p - 1) + tr) / p;
      prev = d[i].c;
    }
    return out;
  }

  function aggregate(candles, k) {
    if (k <= 1) return candles.slice();
    const out = [];
    for (let i = 0; i < candles.length; i += k) {
      const ch = candles.slice(i, i + k);
      if (!ch.length) break;
      out.push({
        t: ch[0].t, o: ch[0].o,
        h: Math.max.apply(null, ch.map(x => x.h)),
        l: Math.min.apply(null, ch.map(x => x.l)),
        c: ch[ch.length - 1].c
      });    }
    return out;
  }

  const sigmoid = z => z > 30 ? 1 : z < -30 ? 0 : 1 / (1 + Math.exp(-z));

  /* ----------------------------------------------------------------------
   * MOTOR
   * --------------------------------------------------------------------*/
  function createEngine(config) {
    const P = validateConfig(config);
    let d = [], atr = [], st = null, seq = 0, processed = -1;

    function freshState() {
      return {
        piv: [], lines: [], levels: [], events: [], touches: [], legs: [],
        trend: 0, origin: null, prot: 0, protLevel: null, startBar: 0,
        lastH: null, lastL: null, activeLine: null, engWatch: null,
        w: new Array(8).fill(0), samples: 0, lastP: 0.5, bufF: 1, ready: false,
        pending: []
      };
    }
    const A = i => Math.max(atr[i] || 0, 1e-9);
    const lineAt = (ln, x) => ln.pa + (ln.pb - ln.pa) * (x - ln.a) / ((ln.b - ln.a) || 1);
    const nid = k => k + (seq++);

    function score(x) { let z = 0; for (let k = 0; k < 8; k++) z += st.w[k] * x[k]; return sigmoid(z); }

    function features(i, dir, level, since) {
      const a = A(i), m0 = Math.max(0, i - 49);
      let s = 0, n = 0; for (let k = m0; k <= i; k++) { s += atr[k]; n++; }
      const mean = n ? s / n : a;
      const slope = st.activeLine ? (st.activeLine.pb - st.activeLine.pa) / ((st.activeLine.b - st.activeLine.a) || 1) : 0;
      let ns = 0; const want = dir > 0 ? -1 : 1;
      for (const p of st.piv) if (p.type === want && p.bar >= since && p.bar <= i) ns++;
      const org = st.origin ? st.origin.p : level;
      return [
        1,
        clamp((dir > 0 ? d[i].c - level : level - d[i].c) / a, -5, 5),
        clamp((i - since) / 100, 0, 1),
        clamp(slope / a, -3, 3),
        clamp((dir > 0 ? d[i].c - org : org - d[i].c) / a, -10, 10),
        clamp(atr[i] / (mean || a), 0.2, 3),
        clamp(Math.abs(d[i].c - d[i].o) / a, 0, 3),
        clamp(ns / 10, 0, 1)
      ];
    }

    function resolveOutcomes(i) {
      for (const s of st.pending) {        if (s.done || s.bar + P.nOut > i) continue;
        const a = Math.max(s.atr, 1e-9);
        const up = s.level + P.kATR * a, dn = s.level - P.kATR * a;
        let lab = 0, done = false;
        for (let j = s.bar + 1; j <= s.bar + P.nOut; j++) {
          const bh = BH(d[j]), bl = BL(d[j]);
          if (s.dir > 0) { if (bl <= dn) { lab = 0; done = true; break; } else if (bh >= up) { lab = 1; done = true; break; } }
          else { if (bh >= up) { lab = 0; done = true; break; } else if (bl <= dn) { lab = 1; done = true; break; } }
        }
        if (!done) lab = 0;
        const p = score(s.x), err = lab - p;
        for (let k = 0; k < 8; k++) st.w[k] = clamp(st.w[k] * P.decay + P.lr * err * s.x[k], -5, 5);
        st.samples++; st.ready = st.samples >= P.warmup; s.done = true;
      }
      if (st.pending.length > 4000) st.pending = st.pending.filter(s => !s.done);
    }

    function decide(x) {
      if (!P.brain || !st.ready) return { p: 0.5, tier: 2, base: true };
      const p = score(x);
      return { p, tier: p >= P.thHigh ? 2 : p >= P.thLow ? 1 : 0, base: false };
    }
    const tagOf = t => t.base ? "BASE" : t.tier === 2 ? "CONF" : t.tier === 1 ? "PROV" : "DEBIL";

    function pushEvent(type, i, price, dir, dec, reason) {
      st.events.push({
        id: nid("E"), type, bar: i, t: d[i].t, price, dir,
        tier: dec ? dec.tier : 2, p: dec ? dec.p : 0.5,
        tag: dec ? tagOf(dec) : "—", reason
      });
    }

    function findOrigin(dir, since, i) {
      let best = null; const want = dir > 0 ? -1 : 1;
      for (const p of st.piv)
        if (p.type === want && p.bar >= since && p.bar <= i)
          if (!best || (dir > 0 ? p.p < best.p : p.p > best.p)) best = p;
      if (best) return best;
      let bi = clamp(since, 0, i);
      for (let k = bi; k <= i; k++) if (dir > 0 ? BL(d[k]) < BL(d[bi]) : BH(d[k]) > BH(d[bi])) bi = k;
      return { bar: bi, p: dir > 0 ? BL(d[bi]) : BH(d[bi]), type: want, t: d[bi].t };
    }

    function beginTrend(dir, i, broken, bootstrap, sinceBar) {
      if (st.protLevel) { st.protLevel.b = i; st.protLevel.active = false; st.protLevel = null; }
      for (const ln of st.lines) if (ln.dir === st.trend) ln.alive = false;
      st.trend = dir; st.startBar = i; st.activeLine = null;
      st.origin = bootstrap ? (dir > 0 ? st.lastL : st.lastH) : findOrigin(dir, sinceBar, i);
      if (!st.origin) st.origin = findOrigin(dir, Math.max(0, i - 100), i);
      st.prot = st.origin.p;      st.protLevel = { id: nid("L"), a: st.origin.bar, b: null, price: st.prot, role: dir > 0 ? "S" : "R", active: true };
      st.levels.push(st.protLevel);

      const x = features(i, dir, broken, sinceBar);
      const dec = decide(x);
      st.lastP = dec.p;
      st.bufF = (P.adaptMargin && !dec.base) ? clamp(1 + P.kappa * (1 - dec.p), 0.5, 2) : 1;

      const suppress = P.suppressLow && !dec.base && dec.tier === 0;
      if (!suppress) pushEvent("CAMBIO", i, d[i].c, dir, dec,
        `Cierre ${d[i].c.toFixed(2)} rompió ${dir > 0 ? "resistencia" : "soporte"} ${broken.toFixed(2)} · margen ${(P.marginATR * A(i) * st.bufF).toFixed(2)} · p=${dec.p.toFixed(2)} · muestras=${st.samples}`);
      st.pending.push({ bar: i, dir, level: broken, atr: A(i), x, done: false });
      st.engWatch = { bar: i, level: broken, dir, done: false };
    }

    function addPivot(type, bar) {
      const p = { id: nid("P"), t: d[bar].t, bar, p: type > 0 ? BH(d[bar]) : BL(d[bar]), type };
      st.piv.push(p);
      if (type > 0) st.lastH = p; else st.lastL = p;
      if (P.emitLegs) {
        const prev = st.piv.length > 1 ? st.piv[st.piv.length - 2] : null;
        if (prev) st.legs.push({ a: prev.bar, pa: prev.p, b: bar, pb: p.p });
      }
      const qualifies = st.origin && bar > st.origin.bar &&
        ((st.trend > 0 && type < 0 && p.p > st.prot) || (st.trend < 0 && type > 0 && p.p < st.prot));
      if (!qualifies) return;
      const ln = {
        id: nid("T"), a: st.origin.bar, pa: st.origin.p, b: bar, pb: p.p,
        dir: st.trend, alive: true, touches: 0, rejects: 0, valid: false, warn: false
      };
      if (!P.keepFan) for (const o of st.lines) if (o.dir === st.trend) o.alive = false;
      st.lines.push(ln); st.activeLine = ln;
      st.prot = p.p;
      if (st.protLevel) { st.protLevel.a = bar; st.protLevel.price = p.p; }
    }

    function processBar(i) {
      resolveOutcomes(i);
      const buf = P.marginATR * A(i) * st.bufF;

      if (st.trend > 0 && d[i].c < st.prot - buf) beginTrend(-1, i, st.prot, false, st.startBar);
      else if (st.trend < 0 && d[i].c > st.prot + buf) beginTrend(1, i, st.prot, false, st.startBar);
      else if (st.trend === 0) {
        if (st.lastH && d[i].c > st.lastH.p + buf) {
          let a = st.lastH.bar;
          for (let k = 0; k < st.lastH.bar; k++) if (Math.abs(BH(d[k]) - st.lastH.p) <= P.tolATR * A(k)) { a = k; break; }
          st.levels.push({ id: nid("L"), a, b: i, price: st.lastH.p, role: "R", active: false });
          beginTrend(1, i, st.lastH.p, true, Math.max(0, i - 100));
        } else if (st.lastL && d[i].c < st.lastL.p - buf) {
          let a = st.lastL.bar;          for (let k = 0; k < st.lastL.bar; k++) if (Math.abs(BL(d[k]) - st.lastL.p) <= P.tolATR * A(k)) { a = k; break; }
          st.levels.push({ id: nid("L"), a, b: i, price: st.lastL.p, role: "S", active: false });
          beginTrend(-1, i, st.lastL.p, true, Math.max(0, i - 100));
        }
      }

      if (st.engWatch && !st.engWatch.done && i > st.engWatch.bar && i - st.engWatch.bar <= P.engN) {
        const back = st.engWatch.dir > 0 ? d[i].c < st.engWatch.level - buf : d[i].c > st.engWatch.level + buf;
        if (back) {
          pushEvent("ENGAÑO", i, d[i].c, -st.engWatch.dir, null,
            `Ruptura fallida: el cierre volvió ${st.engWatch.dir > 0 ? "debajo" : "encima"} de ${st.engWatch.level.toFixed(2)} en <=${P.engN} velas`);
          st.engWatch.done = true;
        }
      }

      const ln = st.activeLine;
      if (ln && ln.alive && i > ln.b) {
        const v = lineAt(ln, i), tol = P.tolATR * A(i);
        if (st.trend > 0 && BL(d[i]) >= v - tol && BL(d[i]) <= v + tol && d[i].c > v) {
          ln.touches++; ln.rejects++; ln.valid = ln.touches >= 2 && ln.rejects >= 1;
          st.touches.push({ id: nid("K"), bar: i, t: d[i].t, price: BL(d[i]), dir: 1, line: ln.id });
          pushEvent("TOQUE", i, BL(d[i]), 1, null, `Cuerpo tocó ${ln.id} y cerró por encima (v=${v.toFixed(2)})`);
        } else if (st.trend < 0 && BH(d[i]) >= v - tol && BH(d[i]) <= v + tol && d[i].c < v) {
          ln.touches++; ln.rejects++; ln.valid = ln.touches >= 2 && ln.rejects >= 1;
          st.touches.push({ id: nid("K"), bar: i, t: d[i].t, price: BH(d[i]), dir: -1, line: ln.id });
          pushEvent("TOQUE", i, BH(d[i]), -1, null, `Cuerpo tocó ${ln.id} y cerró por debajo (v=${v.toFixed(2)})`);
        }
        if ((st.trend > 0 && d[i].c < v - buf) || (st.trend < 0 && d[i].c > v + buf)) ln.warn = true;
      }

      const cc = i - P.pivR;
      if (cc >= P.pivL) {
        const bh = BH(d[cc]), bl = BL(d[cc]);
        let isH = true, isL = true;
        for (let k = 1; k <= P.pivL; k++) { if (bh <= BH(d[cc - k])) isH = false; if (bl >= BL(d[cc - k])) isL = false; }
        for (let k = 1; k <= P.pivR; k++) { if (bh <= BH(d[cc + k])) isH = false; if (bl >= BL(d[cc + k])) isL = false; }
        if (isH) addPivot(1, cc);
        if (isL) addPivot(-1, cc);
      }
    }

    function lastClosedIndex() { return P.closedOnly ? d.length - 2 : d.length - 1; }

    function replay() {
      st = freshState(); seq = 0; processed = -1;
      atr = atrSeries(d, P.atrPeriod);
      const end = lastClosedIndex();
      for (let i = P.pivL + P.pivR; i <= end; i++) { processBar(i); processed = i; }
    }
    return {
      config: P,
      setCandles(arr) { d = normalizeCandles(arr); replay(); return this; },
      push(candle) {
        const c = normalizeCandles([candle])[0];
        if (!c) return this;
        d.push(c); atr = atrSeries(d, P.atrPeriod);
        const end = lastClosedIndex();
        for (let i = Math.max(processed + 1, P.pivL + P.pivR); i <= end; i++) { processBar(i); processed = i; }
        return this;
      },
      get candles() { return d; },
      result() {
        const end = Math.max(0, lastClosedIndex());
        const ln = st.activeLine;
        const slope = ln ? (ln.pb - ln.pa) / ((ln.b - ln.a) || 1) : 0;
        const strength = Math.abs(slope) / A(end);
        const vote = st.trend === 0 ? 0 : (strength > P.voteStrength ? 1 : 0.5) * st.trend;
        return {
          trend: st.trend, origin: st.origin, protected: st.prot, protectedLevel: st.protLevel,
          startBar: st.startBar, activeLine: ln,
          pivots: P.emitPivots ? st.piv.slice() : [],
          legs: P.emitLegs ? st.legs.slice() : [],
          lines: st.lines.slice(), levels: st.levels.slice(),
          events: st.events.slice(), touches: st.touches.slice(),
          brain: { enabled: P.brain, ready: st.ready, samples: st.samples, p: st.lastP, bufFactor: st.bufF },
          stats: { slope, atr: A(end), strength, vote, lastClosed: end, bars: d.length }
        };
      }
    };
  }

  /* ----------------------------------------------------------------------
   * VOTOS MTF (agregado derivado de los votos, nunca al revés)
   * --------------------------------------------------------------------*/
  function mtfVotes(candles, config, baseMinutes) {
    const P = validateConfig(config);
    const rows = P.voteFactors.map(k => {
      const e = createEngine(P).setCandles(aggregate(candles, k));
      const r = e.result();
      const mins = (baseMinutes || 15) * k;
      return { tf: mins < 60 ? "M" + mins : "H" + (mins / 60), factor: k, vote: r.stats.vote, trend: r.trend };
    });
    const score = rows.reduce((s, r) => s + r.vote, 0) / rows.length;
    const dir = score >= 0.25 ? 1 : score <= -0.25 ? -1 : 0;
    const match = rows.reduce((s, r) => s + (dir !== 0 && Math.sign(r.vote) === dir ? Math.abs(r.vote) : 0), 0);
    const label = dir > 0 ? (score >= 0.6 ? "ALCISTA fuerte" : "ALCISTA débil")
                : dir < 0 ? (score <= -0.6 ? "BAJISTA fuerte" : "BAJISTA débil") : "RANGO";
    return { rows, score, dir, match, total: rows.length, label };
  }
  /* ----------------------------------------------------------------------
   * LISTA DE DIBUJO (su renderizador NO calcula nada: solo pinta esto)
   * view = { leftBar, rightBar }  ·  clipLeftBar garantiza cero proyección atrás
   * --------------------------------------------------------------------*/
  function buildDrawList(result, view) {
    const L = view.leftBar, R = view.rightBar, out = [];
    const at = (ln, x) => ln.pa + (ln.pb - ln.pa) * (x - ln.a) / ((ln.b - ln.a) || 1);
    for (const l of result.levels) {
      const x2 = l.active ? R : (l.b ?? l.a);
      if (x2 < L || l.a > R) continue;
      const x1 = Math.max(l.a, L);
      out.push({
        kind: "level", id: l.id, role: l.role, active: l.active,
        x1Bar: x1, p1: l.price, x2Bar: x2, p2: l.price,
        clipLeftBar: l.a, rayRight: !!l.active,
        style: "solid", width: 2,
        label: `${l.role} ${l.price.toFixed(2)}`
      });
    }
    for (const ln of result.lines) {
      /* Solo la diagonal de la tendencia VIVA se proyecta al borde derecho.
         Una línea muerta se dibuja únicamente sobre su propio tramo
         (ancla -> pivote): prolongarla hasta hoy convierte el histórico de
         625 abanicos en una maraña de rectas que cruzan toda la gráfica. */
      const endBar = ln.alive ? R : Math.min(R, ln.b);
      if (ln.a > R || endBar < L) continue;
      const x1 = Math.max(ln.a, L);
      const x2 = Math.max(endBar, x1);
      out.push({
        kind: "trendline", id: ln.id, dir: ln.dir, alive: ln.alive,
        x1Bar: x1, p1: at(ln, x1), x2Bar: x2, p2: at(ln, x2),
        clipLeftBar: ln.a, rayRight: !!ln.alive,
        style: ln.warn ? "dash" : (ln.valid ? "solid" : "dash"),
        colorRole: ln.warn ? "warn" : (ln.dir > 0 ? "bull" : "bear"),
        width: ln.valid ? 2 : 1.4,
        label: `${ln.id} · ${ln.touches}t · ${ln.valid ? "VIVA" : "CAND"}`
      });
    }
    for (const e of result.events) {
      if (e.bar < L - 1 || e.bar > R + 1) continue;
      out.push({ kind: "marker", id: e.id, type: e.type, bar: e.bar, price: e.price, dir: e.dir, tag: e.tag, reason: e.reason });
    }
    if (result.legs.length) for (const g of result.legs) {
      if (g.b < L || g.a > R) continue;
      out.push({ kind: "leg", x1Bar: Math.max(g.a, L), p1: g.pa, x2Bar: g.b, p2: g.pb, clipLeftBar: g.a, style: "dot", width: 1, colorRole: "debug" });
    }
    return out;
  }

  /* ----------------------------------------------------------------------
   * AUTOPRUEBA (se ejecuta en su máquina; devuelve hechos, no promesas)
   * --------------------------------------------------------------------*/
  function selfTest(candles, config) {
    const P = validateConfig(config);
    const a = createEngine(P).setCandles(candles).result();    const b = createEngine(P).setCandles(candles).result();
    const deterministic = JSON.stringify(a.events) === JSON.stringify(b.events) &&
                          JSON.stringify(a.lines) === JSON.stringify(b.lines);
    const inc = createEngine(P);
    const norm = normalizeCandles(candles);
    inc.setCandles(norm.slice(0, Math.max(30, Math.floor(norm.length / 2))));
    for (let i = Math.max(30, Math.floor(norm.length / 2)); i < norm.length; i++) inc.push(norm[i]);
    const incrementalMatches = JSON.stringify(inc.result().events) === JSON.stringify(a.events);
    const noBackProjection = a.lines.every(l => l.a <= l.b) && a.levels.every(l => l.b == null || l.a <= l.b);
    const bodyOnly = a.pivots.length === 0 || a.pivots.every(p => {
      const c = norm[p.bar]; return p.p === BH(c) || p.p === BL(c);
    });
    const dl = buildDrawList(a, { leftBar: 0, rightBar: Math.max(0, norm.length - 1) });
    const clipOk = dl.every(s => s.kind === "marker" || s.x1Bar >= s.clipLeftBar);
    const v = mtfVotes(candles, P, 15);
    const votesCoherent = Math.abs(v.score - v.rows.reduce((s, r) => s + r.vote, 0) / v.rows.length) < 1e-9;
    return { deterministic, incrementalMatches, noBackProjection, bodyOnly, clipOk, votesCoherent,
             counts: { lines: a.lines.length, levels: a.levels.length, events: a.events.length } };
  }

  return { DEFAULTS, validateConfig, normalizeCandles, aggregate, createEngine, mtfVotes, buildDrawList, selfTest, BH, BL };
});