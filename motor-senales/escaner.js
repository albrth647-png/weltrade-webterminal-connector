'use strict';
/* ============================================================
   ESCÁNER DE TENDENCIA — F2
   ------------------------------------------------------------
   Solo contexto para marcar: NO avisa, NO envía, NO filtra
   señales del catálogo.

   - Determinista: mismas velas → mismo resultado, sin estado global.
   - Solo velas cerradas: se evalúa el último elemento de la serie.
   - Ventana acotada (maxVelas) para que el coste no crezca con la historia.
   - Histéresis real: umbral de entrada ≠ umbral de salida, confirmación
     y cooldown, corriendo la máquina sobre las últimas velas.
   Sin dependencias.
   ============================================================ */
const { atr, ema } = require('./nucleo');
const { pivotes } = require('./rayas');

/* Top-down (vídeo 03): H1/M15 = sesgo, M5/M1 = gatillo.
   Se ignora M30 (correlacionado con M15/H1) y M2/M3/M4. */
const TFS_ESCANER = ['H1', 'M15', 'M5', 'M1'];

const PARAMS = {
  atrPeriodo: 14,
  ventanaFuerza: 20,
  ventanaEstado: 60,
  maxVelas: 240,
  /* umbrales [EST]: estimados, sin calibrar con marcas todavía */
  erEntrada: 0.35,
  erSalida: 0.22,
  r2Min: 0.55,
  adxEntrada: 22,
  adxSalida: 16,
  confirmacionVelas: 2,
  confirmacionDebil: 3,
  cooldownVelas: 5,
  pesoH1: 0.40,
  pesoM15: 0.30,
  pesoM5: 0.20,
  pesoM1: 0.10,
  gateAlineacion: 3,
  gateScore: 0.55,
  distEmaAtr: 2.5,
  toleranciaClusterAtr: 0.35,
  margenRotoAtr: 0.5,
  cierresParaRoto: 2,
  vidaMediaVelas: 200,
  maxNiveles: 5,
};

/* ---------- series de indicadores (una pasada) ---------- */

function erSerie(cierres, n) {
  const N = cierres.length;
  const out = new Array(N).fill(null);
  if (N <= n) return out;
  /* suma deslizante: O(n) en vez de O(n·ventana) */
  let recorrido = 0;
  for (let i = 1; i <= n; i++) recorrido += Math.abs(cierres[i] - cierres[i - 1]);
  out[n] = recorrido > 0 ? Math.abs(cierres[n] - cierres[0]) / recorrido : null;
  for (let i = n + 1; i < N; i++) {
    recorrido += Math.abs(cierres[i] - cierres[i - 1]) - Math.abs(cierres[i - n] - cierres[i - n - 1]);
    out[i] = recorrido > 0 ? Math.abs(cierres[i] - cierres[i - n]) / recorrido : null;
  }
  return out;
}

function r2Serie(cierres, n) {
  const N = cierres.length;
  const out = new Array(N).fill(null);
  if (N < n) return out;
  /* sumas prefijas: O(n) sin cortar arrays en cada vela */
  const py = new Float64Array(N + 1);
  const pyy = new Float64Array(N + 1);
  const pxy = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) {
    py[i + 1] = py[i] + cierres[i];
    pyy[i + 1] = pyy[i] + cierres[i] * cierres[i];
    pxy[i + 1] = pxy[i] + i * cierres[i];
  }
  for (let i = n - 1; i < N; i++) {
    const a = i - n + 1;
    const sy = py[i + 1] - py[a];
    const syy = pyy[i + 1] - pyy[a];
    const sxy = pxy[i + 1] - pxy[a];
    const sx = ((a + i) * n) / 2;
    const sxx = (i * (i + 1) * (2 * i + 1) - (a - 1) * a * (2 * a - 1)) / 6;
    const den = n * sxx - sx * sx;
    if (!(den > 0)) continue;
    const b = (n * sxy - sx * sy) / den;
    const syyC = syy - (sy * sy) / n;
    if (!(syyC > 0)) continue;
    const sxyC = sxy - (sx * sy) / n;
    const r = 1 - (syyC - b * sxyC) / syyC;
    out[i] = Math.max(0, Math.min(1, r));
  }
  return out;
}

function adxSerie(velas, periodo = 14) {
  const n = velas.length;
  const out = new Array(n).fill(null);
  if (n < periodo * 2 + 1) return out;
  const tr = [], dmp = [], dmm = [];
  for (let i = 1; i < n; i++) {
    const sube = velas[i].h - velas[i - 1].h;
    const baja = velas[i - 1].l - velas[i].l;
    tr.push(Math.max(
      velas[i].h - velas[i].l,
      Math.abs(velas[i].h - velas[i - 1].c),
      Math.abs(velas[i].l - velas[i - 1].c)
    ));
    dmp.push(sube > baja && sube > 0 ? sube : 0);
    dmm.push(baja > sube && baja > 0 ? baja : 0);
  }
  let atrS = 0, dpS = 0, dmS = 0;
  for (let i = 0; i < periodo; i++) { atrS += tr[i]; dpS += dmp[i]; dmS += dmm[i]; }
  const dxs = [];
  for (let i = periodo; i < tr.length; i++) {
    atrS = atrS - atrS / periodo + tr[i];
    dpS = dpS - dpS / periodo + dmp[i];
    dmS = dmS - dmS / periodo + dmm[i];
    const pdi = atrS ? 100 * dpS / atrS : 0;
    const mdi = atrS ? 100 * dmS / atrS : 0;
    dxs.push(pdi + mdi ? 100 * Math.abs(pdi - mdi) / (pdi + mdi) : 0);
  }
  if (dxs.length < periodo) return out;
  let a = dxs.slice(0, periodo).reduce((x, y) => x + y, 0) / periodo;
  out[periodo * 2] = a;
  for (let i = periodo; i < dxs.length; i++) {
    a = (a * (periodo - 1) + dxs[i]) / periodo;
    const idx = i + periodo + 1;
    if (idx < n) out[idx] = a;
  }
  return out;
}

/* ---------- medición en una vela ---------- */

function pilaEn(e30, e50, e100, i) {
  const a = e30[i], b = e50[i], c = e100[i];
  if (![a, b, c].every(Number.isFinite)) return null;
  if (a > b && b > c) return 'alcista';
  if (a < b && b < c) return 'bajista';
  return 'mixta';
}

function direccionDe(pila) {
  if (pila === 'alcista') return 'alcista';
  if (pila === 'bajista') return 'bajista';
  return 'ninguna';
}

function fuerzaDe(er, r2, adx) {
  const e = Number.isFinite(er) ? er : 0;
  const r = Number.isFinite(r2) ? r2 : 0;
  const a = Number.isFinite(adx) ? Math.min(1, adx / 50) : 0;
  return Math.max(0, Math.min(1, 0.45 * e + 0.35 * r + 0.20 * a));
}

function medirEn(d, i, P, vol) {
  const { w, closes, A, e30, e50, e100, ADX, ER, R2 } = d;
  const atrI = A[i];
  const pila = pilaEn(e30, e50, e100, i);
  const er = ER[i];
  const r2 = R2[i];
  const adx = ADX[i];
  const desde = Math.max(1, i - P.ventanaFuerza + 1);
  let max = -Infinity, min = Infinity;
  let maxPrev = -Infinity, minPrev = Infinity;
  let suma = 0;
  for (let j = desde; j <= i; j++) {
    const v = w[j];
    if (v.h > max) max = v.h;
    if (v.l < min) min = v.l;
    if (j < i) {
      if (v.h > maxPrev) maxPrev = v.h;
      if (v.l < minPrev) minPrev = v.l;
    }
    suma += v.c;
  }
  const n = i - desde + 1;
  const media = n > 0 ? suma / n : 0;
  let b = 0;
  if (n > 1) {
    let sxy = 0, sxx = 0;
    for (let k = 0; k < n; k++) {
      const dx = k - (n - 1) / 2;
      sxy += dx * (w[desde + k].c - media);
      sxx += dx * dx;
    }
    b = sxx > 0 ? sxy / sxx : 0;
  }
  const distEma50Atr = atrI > 0 && Number.isFinite(e50[i]) ? (closes[i] - e50[i]) / atrI : null;
  /* extremo nuevo respecto a la ventana ANTERIOR, no respecto a sí misma */
  const nuevoMax = i > desde && w[i].h > maxPrev;
  const nuevoMin = i > desde && w[i].l < minPrev;
  const r2Hace5 = Number.isFinite(R2[i - 5]) ? R2[i - 5] : null;
  const divergencia = r2Hace5 !== null && Number.isFinite(r2) && r2 < r2Hace5 - 0.15;
  const agotamiento = !!(
    Number.isFinite(distEma50Atr) && Math.abs(distEma50Atr) > P.distEmaAtr
    && divergencia && (nuevoMax || nuevoMin)
  );
  return {
    t: w[i].t,
    precio: closes[i],
    atr: atrI,
    atrPct: atrI > 0 ? (atrI / closes[i]) * 100 : null,
    volatilidad: vol,
    er, r2, adx,
    pendAtr: atrI > 0 ? b / atrI : null,
    posDon: max > min ? (closes[i] - min) / (max - min) : null,
    pila,
    direccion: direccionDe(pila),
    fuerza: fuerzaDe(er, r2, adx),
    distEma50Atr,
    agotamiento,
    fuerte: Number.isFinite(er) && Number.isFinite(r2) && Number.isFinite(adx)
      && er >= P.erEntrada && r2 >= P.r2Min && adx >= P.adxEntrada && pila !== 'mixta',
    flojo: (Number.isFinite(er) && er < P.erSalida)
      || (Number.isFinite(adx) && adx < P.adxSalida)
      || pila === 'mixta',
  };
}

function percentil(valores, p) {
  if (!valores.length) return null;
  const orden = [...valores].sort((a, b) => a - b);
  return orden[Math.min(orden.length - 1, Math.floor((orden.length - 1) * p / 100))];
}

/* ---------- niveles ---------- */

function nivelesDe(w, atrI, P) {
  if (!(atrI > 0)) return [];
  const tol = P.toleranciaClusterAtr * atrI;
  const puntos = [
    ...pivotes(w, 'alto', 3).map((i) => ({ i, p: w[i].h })),
    ...pivotes(w, 'bajo', 3).map((i) => ({ i, p: w[i].l })),
  ].slice(-200);
  const clusters = [];
  for (const pt of puntos) {
    const c = clusters.find((x) => Math.abs(x.precio - pt.p) <= tol);
    if (c) { c.suma += pt.p; c.n++; c.precio = c.suma / c.n; c.ultimo = Math.max(c.ultimo, pt.i); c.primer = Math.min(c.primer, pt.i); }
    else clusters.push({ precio: pt.p, suma: pt.p, n: 1, ultimo: pt.i, primer: pt.i });
  }
  const n = w.length;
  const cierres = w.map((v) => v.c);
  for (const c of clusters) {
    const margen = P.margenRotoAtr * atrI;
    let rotos = 0;
    for (let i = n - 1; i >= Math.max(0, n - 5); i--) {
      if (Math.abs(cierres[i] - c.precio) > margen && Math.sign(cierres[i] - c.precio) === Math.sign(cierres[n - 1] - c.precio)) rotos++;
    }
    c.estado = rotos >= P.cierresParaRoto ? 'roto' : (c.n >= 2 ? 'probado' : 'virgen');
    c.score = Math.exp(-(n - 1 - c.ultimo) / P.vidaMediaVelas) * (1 + 0.25 * (c.n - 1));
  }
  return clusters
    .sort((a, b) => b.score - a.score)
    .slice(0, P.maxNiveles)
    .map((c) => ({
      precio: Number(c.precio.toFixed(5)),
      toques: c.n,
      distAtr: Number(((c.precio - cierres[n - 1]) / atrI).toFixed(3)),
      estado: c.estado,
      score: Number(c.score.toFixed(3)),
    }));
}

/* ---------- estructura ---------- */

function estructuraDe(w) {
  const altos = pivotes(w, 'alto', 3);
  const bajos = pivotes(w, 'bajo', 3);
  if (altos.length < 2 || bajos.length < 2) return null;
  const h1 = altos[altos.length - 2], h2 = altos[altos.length - 1];
  const l1 = bajos[bajos.length - 2], l2 = bajos[bajos.length - 1];
  const hh = w[h2].h > w[h1].h;
  const hl = w[l2].l > w[l1].l;
  if (hh && hl) return 'HH-HL';
  if (!hh && !hl) return 'LH-LL';
  return 'mixta';
}

/* ---------- evaluación ---------- */

/**
 * Evalúa una serie cerrada. Devuelve el estado de tendencia y sus medidas.
 * Puro: mismas velas → mismo resultado.
 */
function evaluar(velas, opciones = {}) {
  const P = { ...PARAMS, ...(opciones.params || {}) };
  if (!Array.isArray(velas) || velas.length < 120) return null;
  const w = velas.slice(-P.maxVelas);
  const closes = w.map((v) => v.c);
  const A = atr(w, P.atrPeriodo);
  /* EMA sobre la historia completa: la semilla (SMA de las primeras N barras)
     debe coincidir con MT5/TradingView, que corren la EMA sobre todo el
     histórico. Recortar a maxVelas reiniciaba la semilla en cada evaluación
     y desfasaba la EMA (sobre todo la EMA100) respecto al gráfico. */
  const closesFull = velas.map((v) => v.c);
  const e30Full = ema(closesFull, 30);
  const e50Full = ema(closesFull, 50);
  const e100Full = ema(closesFull, 100);
  const e30 = e30Full.slice(-w.length);
  const e50 = e50Full.slice(-w.length);
  const e100 = e100Full.slice(-w.length);
  const ADX = adxSerie(w, 14);
  const ER = erSerie(closes, P.ventanaFuerza);
  const R2 = r2Serie(closes, P.ventanaFuerza);
  const d = { w, closes, A, e30, e50, e100, ADX, ER, R2 };

  const n = w.length;
  const pcts = [];
  for (let i = Math.max(0, n - 200); i < n; i++) {
    if (A[i] > 0) pcts.push((A[i] / closes[i]) * 100);
  }
  const p33 = percentil(pcts, 33);
  const p66 = percentil(pcts, 66);
  const atrPctAhora = A[n - 1] > 0 ? (A[n - 1] / closes[n - 1]) * 100 : null;
  const vol = atrPctAhora === null || p33 === null ? 'normal'
    : (atrPctAhora < p33 ? 'baja' : (atrPctAhora > p66 ? 'alta' : 'normal'));

  let estado = 'RANGO';
  let pend = null, cuenta = 0, cooldown = 0, cambios = 0, desde = n - 1;
  const desdeI = Math.max(100, n - P.ventanaEstado);
  for (let i = desdeI; i < n; i++) {
    /* Solo lo que la máquina necesita: sin construir la medición completa
       en cada vela (la medición se hace una vez, al final). */
    const erI = ER[i], r2I = R2[i], adxI = ADX[i];
    const pilaI = pilaEn(e30, e50, e100, i);
    const fuerte = Number.isFinite(erI) && Number.isFinite(r2I) && Number.isFinite(adxI)
      && erI >= P.erEntrada && r2I >= P.r2Min && adxI >= P.adxEntrada && pilaI !== 'mixta';
    const flojo = (Number.isFinite(erI) && erI < P.erSalida)
      || (Number.isFinite(adxI) && adxI < P.adxSalida)
      || pilaI === 'mixta';
    let agotamiento = false;
    const atrI = A[i];
    if (atrI > 0 && Number.isFinite(e50[i])) {
      const dist = Math.abs((closes[i] - e50[i]) / atrI);
      const r2Prev = Number.isFinite(R2[i - 5]) ? R2[i - 5] : null;
      if (dist > P.distEmaAtr && r2Prev !== null
        && Number.isFinite(r2I) && r2I < r2Prev - 0.15) {
        let maxP = -Infinity, minP = Infinity;
        for (let j = Math.max(0, i - P.ventanaFuerza); j < i; j++) {
          if (w[j].h > maxP) maxP = w[j].h;
          if (w[j].l < minP) minP = w[j].l;
        }
        agotamiento = w[i].h > maxP || w[i].l < minP;
      }
    }
    let destino = null;
    if (estado === 'RANGO') {
      if (fuerte) destino = 'TENDENCIA';
    } else if (estado === 'TENDENCIA') {
      if (agotamiento) destino = 'AGOTAMIENTO';
      else if (flojo) destino = 'DEBIL';
    } else if (estado === 'AGOTAMIENTO') {
      if (!agotamiento) destino = flojo ? 'DEBIL' : 'TENDENCIA';
    } else if (estado === 'DEBIL') {
      if (fuerte) destino = 'TENDENCIA';
      else if (flojo) destino = 'RANGO';
    }
    const necesita = destino === 'DEBIL' ? P.confirmacionDebil : P.confirmacionVelas;
    if (destino) {
      if (pend === destino) cuenta++;
      else { pend = destino; cuenta = 1; }
    } else { pend = null; cuenta = 0; }
    if (cooldown > 0) cooldown--;
    if (destino && cuenta >= necesita && cooldown === 0) {
      estado = destino;
      desde = i;
      cambios++;
      pend = null; cuenta = 0; cooldown = P.cooldownVelas;
    }
  }

  const ultima = medirEn(d, n - 1, P, vol);
  return {
    t: ultima.t,
    precio: ultima.precio,
    atr: ultima.atr,
    atrPct: ultima.atrPct,
    volatilidad: vol,
    er: ultima.er,
    r2: ultima.r2,
    adx: ultima.adx,
    pendAtr: ultima.pendAtr,
    posDon: ultima.posDon,
    pilaEma: ultima.pila,
    estructura: estructuraDe(w),
    direccion: ultima.direccion,
    fuerza: ultima.fuerza,
    distEma50Atr: ultima.distEma50Atr,
    agotamiento: ultima.agotamiento,
    niveles: nivelesDe(w, A[n - 1], P),
    sesion: (() => {
      const h = new Date(ultima.t).getUTCHours();
      return h < 7 ? 'asia' : (h < 12 ? 'europa' : (h < 21 ? 'ny' : 'fuera'));
    })(),
    estado,
    estadoVelas: n - 1 - desde,
    cambios,
  };
}

/* ---------- matriz multitemporal ---------- */

function calcularMatriz(porTF, opciones = {}) {
  const P = { ...PARAMS, ...(opciones.params || {}) };
  const pesos = { H1: P.pesoH1, M15: P.pesoM15, M5: P.pesoM5, M1: P.pesoM1 };
  let suma = 0, pesoTotal = 0;
  const detalle = {};
  for (const tf of TFS_ESCANER) {
    const e = porTF[tf];
    if (!e) { detalle[tf] = null; continue; }
    const signo = e.direccion === 'alcista' ? 1 : (e.direccion === 'bajista' ? -1 : 0);
    const aporte = signo * e.fuerza;
    suma += pesos[tf] * aporte;
    pesoTotal += pesos[tf];
    detalle[tf] = { estado: e.estado, direccion: e.direccion, fuerza: Number(e.fuerza.toFixed(3)), aporte: Number(aporte.toFixed(3)) };
  }
  if (!pesoTotal) return { score: 0, alineacion: 0, sesgo: 'sin datos', detalle };
  const score = suma / pesoTotal;
  const signo = score > 0 ? 1 : (score < 0 ? -1 : 0);
  let alineacion = 0;
  for (const tf of TFS_ESCANER) {
    const e = porTF[tf];
    if (!e || !signo) continue;
    const s = e.direccion === 'alcista' ? 1 : (e.direccion === 'bajista' ? -1 : 0);
    if (s === signo) alineacion++;
  }
  const intensidad = Math.abs(score) >= P.gateScore ? 'clara' : (Math.abs(score) >= 0.25 ? 'leve' : 'debil');
  const sesgo = !signo ? 'mixta' : (signo > 0 ? 'alcista' : 'bajista') + ' ' + intensidad;
  return { score: Number(score.toFixed(3)), alineacion, sesgo, detalle };
}

/** Evalúa las cuatro temporalidades de un símbolo y devuelve la matriz. */
/** Precalienta el JIT con una serie sintética: el primer /escaner real
 *  no paga la compilación en caliente. Coste: ~100 ms una sola vez. */
function calentar() {
  const sint = [];
  let p = 100000;
  for (let i = 0; i < 240; i++) {
    const o = p;
    const c = p + Math.sin(i / 7) * 20 + (i % 3);
    sint.push({ t: 1762905600000 + i * 300000, o, c, h: Math.max(o, c) + 5, l: Math.min(o, c) - 5 });
    p = c;
  }
  for (let k = 0; k < 3; k++) evaluar(sint);
}

function escanearSeries(series, opciones = {}) {
  const porTF = {};
  for (const tf of TFS_ESCANER) {
    if (series && Array.isArray(series[tf])) porTF[tf] = evaluar(series[tf], opciones);
  }
  return { series: porTF, matriz: calcularMatriz(porTF, opciones) };
}

module.exports = {
  PARAMS,
  TFS_ESCANER,
  evaluar,
  calentar,
  calcularMatriz,
  escanearSeries,
  /* expuestos para pruebas */
  erSerie, r2Serie, adxSerie, nivelesDe, estructuraDe, fuerzaDe, percentil,
};
