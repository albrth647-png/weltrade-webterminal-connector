'use strict';
/* Tendencia actual: módulo independiente de las rayas.
   Responde 4 cosas: dirección, inicio, fuerza e invalidación.
   Nada de dibujo aquí: si la tendencia se deduce de la raya, un error de
   raya contamina la etiqueta.

   Regla (2 de 3, solo con velas cerradas):
     1) ESTRUCTURA  pivotes por cierre: HH/HL vs LH/LL
     2) FUERZA      ADX(14) con +DI/-DI
     3) PENDIENTE   OLS del tramo (R²) + Efficiency Ratio
   ADX < 20 o ER < 0,2 => RANGO, aunque la estructura parezca clara. */

const { pivotes, atr } = require('./rayas');

const PARAMS = {
  adxPeriodo: 14,
  aroonPeriodo: 14,
  erPeriodo: 20,
  kPivote: 3,
  velasEstructura: 300, // ventana para leer la estructura
  adxTendencia: 25,
  adxRango: 20,
  erTendencia: 0.3,
  erRango: 0.2,
  r2Minimo: 0.5,
};

/* ---------- medias de Wilder (RMA) ---------- */
function rma(valores, periodo) {
  const out = new Array(valores.length).fill(0);
  let suma = 0;
  for (let i = 0; i < valores.length; i++) {
    if (i < periodo) {
      suma += valores[i];
      out[i] = i === periodo - 1 ? suma / periodo : 0;
    } else {
      out[i] = (out[i - 1] * (periodo - 1) + valores[i]) / periodo;
    }
  }
  return out;
}

/* ---------- ADX / DMI ---------- */
function adx(velas, periodo = PARAMS.adxPeriodo) {
  const n = velas.length;
  const tr = new Array(n).fill(0);
  const dmP = new Array(n).fill(0);
  const dmM = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const v = velas[i], p = velas[i - 1];
    tr[i] = Math.max(v.h - v.l, Math.abs(v.h - p.c), Math.abs(v.l - p.c));
    const sube = v.h - p.h;
    const baja = p.l - v.l;
    dmP[i] = sube > baja && sube > 0 ? sube : 0;
    dmM[i] = baja > sube && baja > 0 ? baja : 0;
  }
  const trS = rma(tr, periodo);
  const dmPS = rma(dmP, periodo);
  const dmMS = rma(dmM, periodo);
  const dx = new Array(n).fill(0);
  let diP = 0, diM = 0;
  for (let i = 0; i < n; i++) {
    if (trS[i] > 0) {
      diP = (100 * dmPS[i]) / trS[i];
      diM = (100 * dmMS[i]) / trS[i];
      const suma = diP + diM;
      dx[i] = suma > 0 ? (100 * Math.abs(diP - diM)) / suma : 0;
    }
  }
  const adxS = rma(dx, periodo);
  return { adx: adxS[n - 1] || 0, diPlus: diP, diMenos: diM };
}

/* ---------- Aroon ---------- */
function aroon(velas, periodo = PARAMS.aroonPeriodo) {
  const n = velas.length;
  const desde = Math.max(0, n - periodo - 1);
  let iMax = desde, iMin = desde;
  for (let i = desde; i < n; i++) {
    if (velas[i].h >= velas[iMax].h) iMax = i;
    if (velas[i].l <= velas[iMin].l) iMin = i;
  }
  const alto = ((periodo - (n - 1 - iMax)) / periodo) * 100;
  const bajo = ((periodo - (n - 1 - iMin)) / periodo) * 100;
  return { arriba: Math.max(0, Math.min(100, alto)), abajo: Math.max(0, Math.min(100, bajo)) };
}

/* ---------- Efficiency Ratio (Kaufman) ---------- */
function efficiencyRatio(cierres, periodo = PARAMS.erPeriodo) {
  if (cierres.length <= periodo) return 0;
  const desde = cierres.length - periodo - 1;
  const neto = Math.abs(cierres[cierres.length - 1] - cierres[desde]);
  let recorrido = 0;
  for (let i = desde + 1; i < cierres.length; i++) recorrido += Math.abs(cierres[i] - cierres[i - 1]);
  return recorrido > 0 ? neto / recorrido : 0;
}

/* ---------- regresión del tramo ---------- */
function regresion(velas, desde, hasta) {
  const a = Math.max(0, desde), b = Math.min(velas.length - 1, hasta);
  const n = b - a + 1;
  if (n < 3) return { m: 0, b: 0, r2: 0, n: 0 };
  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  for (let i = a; i <= b; i++) {
    const x = i - a, y = velas[i].c;
    sx += x; sy += y; sxx += x * x; sxy += x * y; syy += y * y;
  }
  const den = n * sxx - sx * sx;
  const m = den !== 0 ? (n * sxy - sx * sy) / den : 0;
  const b0 = (sy - m * sx) / n;
  const cov = n * sxy - sx * sy;
  const vx = n * sxx - sx * sx;
  const vy = n * syy - sy * sy;
  const r2 = vx > 0 && vy > 0 ? (cov * cov) / (vx * vy) : 0;
  return { m, b: b0, r2, n };
}

/* ---------- estructura: HH/HL vs LH/LL ---------- */
function estructura(velas, p = PARAMS) {
  const desde = Math.max(0, velas.length - p.velasEstructura);
  const altos = pivotes(velas, 'alto', p.kPivote, true).filter((i) => i >= desde);
  const bajos = pivotes(velas, 'bajo', p.kPivote, true).filter((i) => i >= desde);
  if (altos.length < 2 || bajos.length < 2) return { direccion: 0, inicio: null, detalle: 'pivotes insuficientes' };
  const h1 = velas[altos[altos.length - 2]].c, h2 = velas[altos[altos.length - 1]].c;
  const l1 = velas[bajos[bajos.length - 2]].c, l2 = velas[bajos[bajos.length - 1]].c;
  const altosSuben = h2 > h1, bajosSuben = l2 > l1;
  let direccion = 0;
  if (altosSuben && bajosSuben) direccion = 1;
  else if (!altosSuben && !bajosSuben) direccion = -1;
  /* Inicio del tramo: el pivote más antiguo de la secuencia actual
     (último bajo en alcista, último alto en bajista). */
  const inicio = direccion === 1 ? bajos[bajos.length - 1] : direccion === -1 ? altos[altos.length - 1] : null;
  return {
    direccion, inicio,
    detalle: `${altosSuben ? 'HH' : 'LH'} ${bajosSuben ? 'HL' : 'LL'}`,
    altos: altos.slice(-3), bajos: bajos.slice(-3),
  };
}

/* ---------- tendencia por estructura (ruptura de swing) ----------
   Es la definición operativa de "cambio de tendencia": un cierre que supera
   el último swing alto confirmado (alcista) o el último swing bajo (bajista).
   Sin ADX ni ER: esos filtros llegaban 15 velas tarde y convertían en RANGO
   justo el punto donde nace la tendencia.

   Devuelve además `inicio`: el pivote que arrancó la pata actual, que es el
   mismo punto del que debe nacer la raya. Un solo concepto para las dos cosas. */
function tendenciaEstructural(velas, params = {}) {
  const p = { ...PARAMS, ...params };
  const n = velas.length;
  if (!Array.isArray(velas) || n < p.kPivote * 4 + 10) {
    return { direccion: 0, etiqueta: 'SIN DATOS', inicio: null, inicioT: null, cambios: 0, detalle: 'serie corta' };
  }
  const altos = pivotes(velas, 'alto', p.kPivote, true);
  const bajos = pivotes(velas, 'bajo', p.kPivote, true);

  let dir = 0, inicio = null, cambios = 0;
  let ultimoAlto = null, ultimoBajo = null;
  let ia = 0, ib = 0;
  let rotura = null; // { i, precio, tipo }

  for (let i = 0; i < n; i++) {
    /* Un pivote en j solo se conoce al cerrar j + k: nunca se usa antes. */
    while (ia < altos.length && altos[ia] + p.kPivote <= i) { ultimoAlto = altos[ia]; ia++; }
    while (ib < bajos.length && bajos[ib] + p.kPivote <= i) { ultimoBajo = bajos[ib]; ib++; }

    const cierre = velas[i].c;
    if (ultimoAlto != null && cierre > velas[ultimoAlto].c && dir !== 1) {
      dir = 1; cambios++;
      inicio = ultimoBajo != null && ultimoBajo < i ? ultimoBajo : inicio;
      rotura = { i, precio: velas[ultimoAlto].c, tipo: 'alto' };
    } else if (ultimoBajo != null && cierre < velas[ultimoBajo].c && dir !== -1) {
      dir = -1; cambios++;
      inicio = ultimoAlto != null && ultimoAlto < i ? ultimoAlto : inicio;
      rotura = { i, precio: velas[ultimoBajo].c, tipo: 'bajo' };
    }
  }

  return {
    direccion: dir,
    etiqueta: dir === 1 ? 'ALCISTA' : dir === -1 ? 'BAJISTA' : 'RANGO',
    inicio,
    inicioT: inicio != null ? velas[inicio].t : null,
    cambios,
    rotura,
    detalle: rotura ? `cierre ${velas[rotura.i].c} ${rotura.tipo === 'alto' ? '>' : '<'} swing ${rotura.precio}` : 'sin ruptura',
  };
}

/* ---------- dos escalas ----------
   El SMC de referencia (LuxAlgo) trabaja con dos escalas: estructura interna
   (5 velas) y swing (50). Medido en SFX Vol 20: k=3 da 14 cambios por 200
   velas, k=5 da 4 y k=20 da 1. Se separa el trabajo:
     - etiqueta de tendencia = escala lenta (estable, no parpadea)
     - inicio / nacimiento de raya = escala rápida (fresca)
   Mezclar las dos en un solo número es lo que hacía oscilar la etiqueta. */
function tendenciaDoble(velas, params = {}) {
  const p = params || {};
  const lenta = tendenciaEstructural(velas, { kPivote: p.kSwing ?? 20 });
  const rapida = tendenciaEstructural(velas, { kPivote: p.kInterna ?? 5 });
  return {
    etiqueta: lenta.etiqueta,
    direccion: lenta.direccion,
    swing: lenta,
    interna: rapida,
    /* De dónde nace la raya: pivote de la pata rápida; si no hay, la lenta. */
    inicio: rapida.inicio ?? lenta.inicio,
    inicioT: rapida.inicioT ?? lenta.inicioT,
    coinciden: lenta.direccion === rapida.direccion,
  };
}

/* ---------- histéresis ----------
   La etiqueta cruda parpadea porque ADX y estructura se contradicen vela a
   vela. Aquí un cambio necesita N cierres consecutivos en la nueva etiqueta
   y, si es un giro de dirección (ALCISTA<->BAJISTA), ADX con margen extra.
   El estado se pasa por referencia: es lo que permite reproducir la serie
   vela a vela sin mirar el futuro. */
function crearHisteresis() {
  return {
    etiqueta: null, direccion: 0, pendiente: null, n: 0,
    desdeT: null, desdeI: null, cambios: 0,
  };
}

function tendenciaEstable(velas, estado, params = {}) {
  const p = { ...PARAMS, confirmaciones: 2, margenAdx: 3, ...params };
  const raw = tendenciaActual(velas, p);
  const ultimaT = velas.length ? velas[velas.length - 1].t : null;

  if (!estado || estado.etiqueta == null) {
    if (estado) {
      estado.etiqueta = raw.etiqueta;
      estado.direccion = raw.direccion;
      estado.desdeT = ultimaT;
      estado.desdeI = raw.inicio;
    }
    return { ...raw, cambio: false, estado };
  }

  if (raw.etiqueta === estado.etiqueta) {
    estado.pendiente = null;
    estado.n = 0;
    return { ...raw, etiqueta: estado.etiqueta, direccion: estado.direccion, cambio: false, estado };
  }

  estado.n = estado.pendiente === raw.etiqueta ? estado.n + 1 : 1;
  estado.pendiente = raw.etiqueta;

  /* Un giro de dirección es lo más caro: exige más fuerza que una salida a
     rango, que solo pide confirmación temporal. */
  const giro = raw.etiqueta !== 'RANGO' && estado.etiqueta !== 'RANGO';
  const adxMin = giro ? p.adxTendencia + p.margenAdx : 0;
  const fuerzaOk = !giro || (raw.componentes && raw.componentes.adx >= adxMin);

  if (estado.n >= p.confirmaciones && fuerzaOk) {
    estado.etiqueta = raw.etiqueta;
    estado.direccion = raw.direccion;
    estado.pendiente = null;
    estado.n = 0;
    estado.cambios++;
    estado.desdeT = ultimaT;
    estado.desdeI = raw.inicio;
    return { ...raw, cambio: true, estado };
  }

  return {
    ...raw,
    etiqueta: estado.etiqueta,
    direccion: estado.direccion,
    inicio: estado.desdeI,
    confirmando: estado.n,
    cambio: false,
    estado,
  };
}

/* ---------- tendencia actual ---------- */
function tendenciaActual(velas, params = {}) {
  const p = { ...PARAMS, ...params };
  const n = velas.length;
  if (!Array.isArray(velas) || n < 60) {
    return { direccion: 0, etiqueta: 'SIN DATOS', inicio: null, fuerza: 0, detalle: 'serie corta', componentes: null };
  }
  const A = atr(velas, p.adxPeriodo);
  const atrAhora = A[n - 1] || 0;
  const dmi = adx(velas, p.adxPeriodo);
  const ar = aroon(velas, p.aroonPeriodo);
  const cierres = velas.map((v) => v.c);
  const er = efficiencyRatio(cierres, p.erPeriodo);
  const est = estructura(velas, p);

  const desde = est.inicio != null ? est.inicio : Math.max(0, n - 100);
  const reg = regresion(velas, desde, n - 1);

  /* 1) estructura */
  const vEstructura = est.direccion;
  /* 2) fuerza: ADX alto y DI dominante */
  let vFuerza = 0;
  if (dmi.adx >= p.adxTendencia && dmi.diPlus !== dmi.diMenos) vFuerza = dmi.diPlus > dmi.diMenos ? 1 : -1;
  /* 3) pendiente: recta con R² y ER suficientes */
  let vPendiente = 0;
  if (reg.r2 >= p.r2Minimo && er >= p.erTendencia) vPendiente = reg.m > 0 ? 1 : -1;

  const suma = vEstructura + vFuerza + vPendiente;
  let direccion = 0;
  if (suma >= 2) direccion = 1;
  else if (suma <= -2) direccion = -1;

  /* Rango explícito: poca fuerza o recorrido ineficiente */
  let etiqueta = 'RANGO';
  if (direccion === 1) etiqueta = 'ALCISTA';
  else if (direccion === -1) etiqueta = 'BAJISTA';
  let motivo = '';
  if (direccion !== 0 && (dmi.adx < p.adxRango || er < p.erRango)) {
    direccion = 0; etiqueta = 'RANGO';
    motivo = dmi.adx < p.adxRango ? `ADX ${dmi.adx.toFixed(1)} < ${p.adxRango}` : `ER ${er.toFixed(2)} < ${p.erRango}`;
  }

  return {
    direccion,
    etiqueta,
    inicio: est.inicio,
    inicioT: est.inicio != null ? velas[est.inicio].t : null,
    fuerza: suma,
    motivo,
    componentes: {
      estructura: vEstructura,
      fuerza: vFuerza,
      pendiente: vPendiente,
      adx: +dmi.adx.toFixed(1),
      diPlus: +dmi.diPlus.toFixed(1),
      diMenos: +dmi.diMenos.toFixed(1),
      aroonArriba: +ar.arriba.toFixed(0),
      aroonAbajo: +ar.abajo.toFixed(0),
      er: +er.toFixed(2),
      r2: +reg.r2.toFixed(2),
      pendAtr: atrAhora > 0 ? +((reg.m / atrAhora) * 100).toFixed(2) : 0,
      detalleEstructura: est.detalle,
    },
  };
}

module.exports = {
  tendenciaActual, tendenciaEstable, crearHisteresis, tendenciaEstructural, tendenciaDoble,
  adx, aroon, efficiencyRatio, regresion, estructura, PARAMS,
};
