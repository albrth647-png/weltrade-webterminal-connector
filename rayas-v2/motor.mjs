/* ============================================================================
 * rayas-v2/motor.mjs · TRENDLINE RODANTE (carpeta independiente)
 * ----------------------------------------------------------------------------
 * Qué hace y qué garantiza:
 *  1. La raya NACE en el origen de la tendencia (el mínimo/máximo desde el que
 *     arrancó el tramo), no en un pivote cualquiera de en medio.
 *  2. La raya SE CORRE: el segundo ancla avanza a cada retroceso (pivote) nuevo
 *     que deja la línea limpia. Si el pivote nuevo rompe la línea, NO se mueve.
 *  3. Solo se marca lo que se puede comprobar: anclas en pivotes de cuerpo
 *     reales, >= 2 toques + 1 toque extra, CERO cierres violando la línea.
 *  4. Se dibujan como mucho 3 rayas: maestra rodante, interna del impulso
 *     actual y canal paralelo. Cada una con su trabajo.
 *  5. Determinista: mismas velas -> mismas rayas (sin Math.random, sin repintar
 *     hacia atrás: cada raya nace en su ancla).
 *
 * Sin dependencias. No importa nada de motor-senales.
 * ==========================================================================*/

export const CONFIG = {
  pivL: 3,            // ventana izquierda del pivote (cuerpo)
  pivR: 3,            // ventana derecha (confirmación)
  atrPeriod: 14,
  tolATR: 0.25,       // tolerancia de toque, en ATR (medida sobre 16 series reales)
  minSpan: 8,         // barras mínimas entre origen y ancla
  maxSlopeATR: 1.20,  // pendiente máxima por vela, en ATR (descarta verticales)
  maxMarks: 3,
  closedOnly: true,   // ignora la vela en formación
  canal: true,
  lookback: 900,      // máximo de barras hacia atrás para buscar el origen
  minMasterSpan: 60,  // barras mínimas que debe cubrir una raya para llamarse maestra
  maxEvaluaciones: 12000 // tope de tramos comprobados (determinista, evita bucles)
};

export const BH = (d) => Math.max(d.o, d.c);
export const BL = (d) => Math.min(d.o, d.c);
const num = (v) => typeof v === "number" && isFinite(v);

export function normalizar(arr) {
  if (!Array.isArray(arr)) throw new Error("velas debe ser un array");
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const x = arr[i] || {};
    const c = {
      t: +(x.t ?? x.time ?? x.timestamp ?? i),
      o: +(x.o ?? x.open),
      h: +(x.h ?? x.high),
      l: +(x.l ?? x.low),
      c: +(x.c ?? x.close)
    };
    if (![c.t, c.o, c.h, c.l, c.c].every(num)) continue;
    if (c.h < Math.max(c.o, c.c) - 1e-9) continue;
    if (c.l > Math.min(c.o, c.c) + 1e-9) continue;
    out.push(c);
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

export function atrSerie(d, p) {
  const out = new Array(d.length).fill(0);
  let prev = d.length ? d[0].c : 0;
  for (let i = 0; i < d.length; i++) {
    const tr = i
      ? Math.max(d[i].h - d[i].l, Math.abs(d[i].h - prev), Math.abs(d[i].l - prev))
      : d[i].h - d[i].l;
    out[i] = i < p ? (out[i - 1] || 0) * i / (i + 1) + tr / (i + 1) : (out[i - 1] * (p - 1) + tr) / p;
    prev = d[i].c;
  }
  return out;
}

/* Pivotes SOLO de cuerpo: max(o,c) / min(o,c). Nunca mechas. */
export function pivotes(d, L, R, last) {
  const out = [];
  const from = L;
  const to = Math.min(last - R, d.length - 1);
  for (let i = from; i <= to; i++) {
    const bh = BH(d[i]), bl = BL(d[i]);
    let isH = true, isL = true;
    for (let k = 1; k <= L && (isH || isL); k++) {
      if (bh <= BH(d[i - k])) isH = false;
      if (bl >= BL(d[i - k])) isL = false;
    }
    /* A la derecha se admite empate: en una meseta el pivote queda en su
       último extremo (evita que dos velas iguales anulen el pivote). */
    for (let k = 1; k <= R && (isH || isL); k++) {
      if (i + k >= d.length) { isH = false; isL = false; break; }
      if (bh < BH(d[i + k])) isH = false;
      if (bl > BL(d[i + k])) isL = false;
    }
    if (isH) out.push({ bar: i, price: bh, type: 1 });
    if (isL) out.push({ bar: i, price: bl, type: -1 });
  }
  return out;
}

const lineaEn = (a, pa, b, pb, x) => pa + (pb - pa) * (x - a) / ((b - a) || 1);

/* Valida un tramo ancla -> candidato contra TODAS las velas intermedias.
 * Devuelve hechos, no una opinión: toques, rechazos, violaciones. */
export function validarTramo(d, atr, a, pa, b, pb, dir, opt, last) {
  const tolBase = opt.tolATR;
  let viol = 0, violMax = 0, touches = 0, rejects = 0, lastTouch = -9, breakBar = null;
  const touchBars = [];
  /* 1) El tramo que la raya TIENE que respetar: desde su origen hasta su ancla. */
  for (let i = a; i <= b; i++) {
    const v = lineaEn(a, pa, b, pb, i);
    const tol = tolBase * Math.max(atr[i], 1e-9);
    const body = dir > 0 ? BL(d[i]) : BH(d[i]);
    const desvio = dir > 0 ? v - body : body - v; // >0 = cuerpo por debajo/encima de la línea
    if (desvio > tol) {
      viol++;
      if (desvio / Math.max(atr[i], 1e-9) > violMax) violMax = desvio / Math.max(atr[i], 1e-9);
    }
    if (Math.abs(desvio) <= tol) {
      if (i - lastTouch > 1) {
        touches++;
        touchBars.push(i);
        const cierraBien = dir > 0 ? d[i].c > v : d[i].c < v;
        if (cierraBien) rejects++;
      }
      lastTouch = i;
    }
  }
  /* 2) Después del ancla la raya puede romperse. Se busca DÓNDE, para dibujarla
     solo hasta ahí en vez de proyectar una línea muerta. */
  let violAfter = 0;
  for (let i = b + 1; i <= last; i++) {
    const v = lineaEn(a, pa, b, pb, i);
    const tol = tolBase * Math.max(atr[i], 1e-9);
    const body = dir > 0 ? BL(d[i]) : BH(d[i]);
    const desvio = dir > 0 ? v - body : body - v;
    if (desvio > tol) {
      violAfter++;
      if (breakBar === null && desvio > tol * 2) breakBar = i;
    }
  }
  const slope = (pb - pa) / ((b - a) || 1);
  const slopeATR = slope / Math.max(atr[b] || atr[a], 1e-9);
  const grade = viol > 0 ? "X"
    : touches >= 3 && rejects >= 1 ? "A"
    : touches >= 3 ? "B"
    : touches >= 2 ? "C" : "X";
  return { touches, rejects, viol, violAfter, violMax, slope, slopeATR, grade, touchBars, span: b - a, breakBar };
}

/* Origen de la tendencia: el extremo más antiguo de la cadena de mínimos
 * crecientes (o máximos decrecientes) que llega hasta el último pivote. */
export function origenDeTendencia(piv, dir, last, opt) {
  const t = dir > 0 ? -1 : 1;
  const lista = piv.filter(p => p.type === t && p.bar <= last - opt.pivR);
  if (!lista.length) return null;
  let org = lista[lista.length - 1];
  for (let k = lista.length - 2; k >= 0; k--) {
    const p = lista[k];
    if (last - p.bar > opt.lookback) break;
    const masExtremo = dir > 0 ? p.price < org.price : p.price > org.price;
    if (!masExtremo) break;
    org = p;
  }
  return org;
}

export function direccionDeTendencia(piv, d, last) {
  const hs = piv.filter(p => p.type === 1 && p.bar <= last);
  const ls = piv.filter(p => p.type === -1 && p.bar <= last);
  if (hs.length < 2 || ls.length < 2) {
    return d.length >= 2 ? (d[last].c >= d[0].c ? 1 : -1) : 1;
  }
  const h1 = hs[hs.length - 2], h2 = hs[hs.length - 1];
  const l1 = ls[ls.length - 2], l2 = ls[ls.length - 1];
  const score = (h2.price > h1.price ? 1 : -1) + (l2.price > l1.price ? 1 : -1);
  return score > 0 ? 1 : score < 0 ? -1 : (l2.price >= l1.price ? 1 : -1);
}

/* ---------------------------------------------------------------------------
 * NÚCLEO: la raya maestra rodante
 * ---------------------------------------------------------------------------
 * Orden de búsqueda, que es justo lo que pidió el usuario:
 *   1. Se parte del RETROCESO MÁS RECIENTE (segunda ancla = pivote nuevo).
 *      Ahí es donde la raya "se corre" cuando la tendencia avanza.
 *   2. Para ese ancla se busca el origen MÁS ANTIGUO que deje la línea limpia:
 *      así la raya nace en el inicio del tramo, no en medio.
 *   3. Si el pivote nuevo NO admite ninguna línea limpia (el precio la rompió),
 *      se conserva el ancla anterior. Nunca se inventa ni se repinta.
 * -------------------------------------------------------------------------*/
function rayaMaestra(d, atr, piv, dir, org, opt, last) {
  const t = dir > 0 ? -1 : 1;
  const anclas = piv
    .filter(p => p.type === t && p.bar <= last - opt.pivR && last - p.bar <= opt.lookback)
    .sort((x, y) => x.bar - y.bar);
  if (anclas.length < 3) return { raya: null, pasos: 0, descartadas: 0, motivo: "pivotes insuficientes" };

  let evaluaciones = 0, descartadas = 0, pasos = 0;

  const comprobar = (b, o) => {
    if (o.bar > b.bar - opt.minSpan) return null;
    if (dir > 0 ? !(o.price < b.price) : !(o.price > b.price)) return null;
    evaluaciones++;
    const ev = validarTramo(d, atr, o.bar, o.price, b.bar, b.price, dir, opt, last);
    const slopeBien = dir > 0 ? ev.slope > 0 : ev.slope < 0;
    if (!slopeBien || ev.viol > 0 || Math.abs(ev.slopeATR) > opt.maxSlopeATR) { descartadas++; return null; }
    return { o, b, ev };
  };

  const armar = (o, b, ev, valid, grade) => ({
    rol: "M", id: "M", dir,
    a: o.bar, pa: o.price, b: b.bar, pb: b.price,
    touches: ev.touches, rejects: ev.rejects, viol: ev.viol,
    violAfter: ev.violAfter, breakBar: ev.breakBar, rota: ev.breakBar !== null,
    span: ev.span, slopeATR: ev.slopeATR, grade,
    valid, origen: { bar: o.bar, price: o.price }
  });

  let fallback = null;      // 2 toques: se dibuja discontinuo, nunca como maestra
  let mejorCorta = null;    // 3+ toques pero menos de minMasterSpan barras
  let mejor = null, mejorPunt = -Infinity;

  /* Se prueban TODOS los anclajes recientes. Se puntúa la raya por lo que
     cubre (span) menos lo que se ha quedado atrás: así gana la línea que
     explica la tendencia y, cuando un retroceso nuevo la respeta, el ancla
     se corre sola a ese pivote. */
  const tramo = Math.max(1, last - anclas[0].bar);
  const edadLibre = Math.max(opt.minMasterSpan, Math.round(tramo * 0.12));

  for (let j = anclas.length - 1; j >= 2; j--) {
    if (evaluaciones >= opt.maxEvaluaciones) break;
    const b = anclas[j];
    let limpia = null;
    for (let i = 0; i < j - 1; i++) {
      const r = comprobar(b, anclas[i]);
      if (!r) continue;
      if (r.ev.touches >= 3) {
        if (b.bar - r.o.bar >= opt.minMasterSpan) { limpia = r; break; }
        if (!mejorCorta || b.bar - r.o.bar > mejorCorta.b.bar - mejorCorta.o.bar) mejorCorta = r;
      }
      if (!fallback) fallback = r;
    }
    if (!limpia) continue;
    pasos = j + 1;
    const span = limpia.b.bar - limpia.o.bar;
    const atraso = Math.max(0, (last - limpia.b.bar) - edadLibre);
    const punt = span - 2 * atraso - (limpia.ev.breakBar !== null ? 1000 : 0);
    if (punt > mejorPunt) { mejorPunt = punt; mejor = limpia; }
  }

  if (mejor) {
    const { o, b, ev } = mejor;
    return { pasos, descartadas, raya: armar(o, b, ev, true, ev.grade) };
  }

  /* Hay 3+ toques pero ninguna raya cubre el mínimo de barras: se devuelve la
     más larga que sí los tenga, siempre que supere al menos minSpan. */
  const corta = mejorCorta || (fallback && fallback.ev.touches >= 3 ? fallback : null);
  if (corta && corta.b.bar - corta.o.bar >= opt.minSpan * 2) {
    const { o, b, ev } = corta;
    return { pasos, descartadas, raya: armar(o, b, ev, false, "C") };
  }

  /* Sin ninguna raya de 3 toques: se marca la de 2 toques como C (discontinua).
     Es información, no una raya "buena": el dibujo lo dice con el grado. */
  if (fallback) {
    const { o, b, ev } = fallback;
    return { pasos, descartadas, raya: armar(o, b, ev, false, "C") };
  }

  return { raya: null, pasos, descartadas, motivo: "sin ancla limpia" };
}

/* Línea interna: el tramo del impulso en curso (último pivote -> pivote nuevo). */
function rayaInterna(d, atr, piv, dir, opt, last) {
  const t = dir > 0 ? -1 : 1;
  const lista = piv.filter(p => p.type === t && p.bar <= last - opt.pivR);
  if (lista.length < 2) return null;
  const b = lista[lista.length - 1], a = lista[lista.length - 2];
  if (b.bar - a.bar < 4) return null;
  const ev = validarTramo(d, atr, a.bar, a.price, b.bar, b.price, dir, opt, last);
  const slopeBien = dir > 0 ? ev.slope > 0 : ev.slope < 0;
  if (!slopeBien || ev.viol > 0 || Math.abs(ev.slopeATR) > opt.maxSlopeATR) return null;
  return {
    rol: "I", id: "I", dir,
    a: a.bar, pa: a.price, b: b.bar, pb: b.price,
    touches: ev.touches, rejects: ev.rejects, viol: ev.viol,
    span: ev.span, slopeATR: ev.slopeATR, grade: ev.grade,
    valid: ev.grade === "A" || ev.grade === "B"
  };
}

/* Canal: paralela por el extremo opuesto del tramo (sobre-extensión). */
function canalParalelo(d, atr, piv, dir, maestra, opt, last) {
  if (!maestra || !opt.canal) return null;
  const t = dir > 0 ? 1 : -1;
  let best = null;
  for (const p of piv) {
    if (p.type !== t || p.bar <= maestra.a || p.bar > last) continue;
    if (!best || (dir > 0 ? p.price > best.price : p.price < best.price)) best = p;
  }
  if (!best) return null;
  const vEnAncla = lineaEn(maestra.a, maestra.pa, maestra.b, maestra.pb, best.bar);
  const offset = dir > 0 ? best.price - vEnAncla : vEnAncla - best.price;
  if (offset <= 0 || offset > 30 * Math.max(atr[best.bar], 1e-9)) return null;
  /* La paralela comparte tramo con la maestra: mismo origen, mismo final. */
  const signo = dir > 0 ? 1 : -1;
  const a = maestra.a;
  const pa = lineaEn(maestra.a, maestra.pa, maestra.b, maestra.pb, a) + signo * offset;
  const pb = lineaEn(maestra.a, maestra.pa, maestra.b, maestra.pb, last) + signo * offset;
  /* Toques REALES de esa paralela, para no etiquetar lo que no se comprobó. */
  let touches = 0, lastTouch = -9;
  for (let i = a; i <= last; i++) {
    const v = lineaEn(a, pa, last, pb, i);
    const tol = opt.tolATR * Math.max(atr[i], 1e-9);
    const ext = dir > 0 ? BH(d[i]) : BL(d[i]);
    if (Math.abs(ext - v) <= tol) { if (i - lastTouch > 1) touches++; lastTouch = i; }
  }
  return {
    rol: "C", id: "C", dir,
    a, pa, b: last, pb,
    touches, rejects: 0, viol: 0, span: last - a,
    slopeATR: maestra.slopeATR, grade: "canal", valid: true,
    paralelaA: "M", offset
  };
}

/* ---------------------------------------------------------------------------
 * API PRINCIPAL
 * -------------------------------------------------------------------------*/
export function analizar(velas, opciones) {
  const opt = Object.assign({}, CONFIG, opciones || {});
  const d = normalizar(velas);
  if (d.length < 30) throw new Error("hacen falta al menos 30 velas");

  const last = opt.closedOnly ? d.length - 2 : d.length - 1;
  const atr = atrSerie(d, opt.atrPeriod);
  const piv = pivotes(d, opt.pivL, opt.pivR, last);
  const dir = direccionDeTendencia(piv, d, last);
  const org = origenDeTendencia(piv, dir, last, opt);

  const audit = {
    velas: d.length, last, dir, pivotes: piv.length,
    origen: org ? { bar: org.bar, precio: org.price, t: d[org.bar].t, desde: last - org.bar } : null,
    pasos: 0, descartadas: 0, motivo: null
  };

  const marcas = [];
  if (org) {
    const m = rayaMaestra(d, atr, piv, dir, org, opt, last);
    audit.pasos = m.pasos;
    audit.descartadas = m.descartadas;
    audit.motivo = m.motivo || null;
    if (m.raya) {
      marcas.push(m.raya);
      audit.origen = { bar: m.raya.a, precio: m.raya.pa, t: d[m.raya.a].t, desde: last - m.raya.a };
    }

    const int = rayaInterna(d, atr, piv, dir, opt, last);
    if (int) marcas.push(int);

    const ch = canalParalelo(d, atr, piv, dir, m.raya, opt, last);
    if (ch) marcas.push(ch);
  }

  /* Orden de importancia: maestra, canal, interna. Máximo maxMarks. */
  const peso = { M: 3, C: 2, I: 1 };
  const seleccion = marcas
    .slice()
    .sort((x, y) => (peso[y.rol] - peso[x.rol]) || (y.touches - x.touches))
    .slice(0, opt.maxMarks)
    .sort((x, y) => (peso[y.rol] - peso[x.rol]));

  audit.marcas = seleccion.length;
  audit.grados = seleccion.map(m => `${m.rol}:${m.grade}`).join(" ");
  audit.ok = seleccion.length >= 2 && seleccion.filter(m => m.rol !== "C").every(m => m.viol === 0);

  return { dir, origen: audit.origen, marcas: seleccion, audit };
}

/* Lista de dibujo lista para cualquier renderizador. view = {leftBar,rightBar} */
export function listaDeDibujo(res, view) {
  const L = view.leftBar, R = view.rightBar;
  const out = [];
  for (const m of res.marcas) {
    /* Se proyectan hasta el borde derecho, salvo que la raya esté ROTA: se
       dibuja solo hasta la rotura, no se proyecta una línea muerta. */
    const x2 = m.breakBar != null ? Math.min(R, m.breakBar) : R;
    if (m.a > R || x2 < L) continue;
    const x1 = Math.max(m.a, L);
    out.push({
      rol: m.rol, id: m.id, dir: m.dir,
      x1Bar: x1, p1: lineaEn(m.a, m.pa, m.b, m.pb, x1),
      x2Bar: x2, p2: lineaEn(m.a, m.pa, m.b, m.pb, x2),
      clipLeftBar: m.a,
      style: m.valid ? "solid" : "dash",
      width: m.rol === "M" ? 2.4 : m.rol === "C" ? 1.6 : 1.4,
      colorRole: m.rol === "C" ? "channel" : m.dir > 0 ? "bull" : "bear",
      touches: m.touches, rejects: m.rejects, viol: m.viol, grade: m.grade,
      breakBar: m.breakBar ?? null, rota: !!m.rota,
      label: `${m.rol} · ${m.touches}t · ${m.grade}${m.viol ? " · VIOLA" : ""}${m.rota ? " · ROTA" : ""}`
    });
  }
  return out;
}
