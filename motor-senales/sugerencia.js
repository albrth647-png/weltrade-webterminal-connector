'use strict';
/* ============================================================
   SUGERENCIA POR CASOS (F3) — k-NN con distancia de Gower.
   ------------------------------------------------------------
   - Solo casos APROBADOS y solo del PASADO (t ≤ consulta).
   - Sin embeddings: la huella se compara campo a campo y se explica.
   - Con menos de 3 vecinos, o confianza < 0.6, NO hay línea fantasma.
   - La fantasma no se dibuja sola: el propietario acepta o descarta.
   Sin dependencias.
   ============================================================ */

const PESOS_HUELLA = {
  er20: 1.0,
  r2: 0.9,
  adx14: 0.8,
  atrPct: 0.6,
  posDon: 0.7,
  dow: 0.2,
  pendAtr: 1.5,
  pilaEma: 1.0,
  estructura: 1.2,
  sesion: 0.4,
};

const NUMERICOS = [
  ['huella', 'er20'],
  ['huella', 'r2'],
  ['huella', 'adx14'],
  ['huella', 'atrPct'],
  ['huella', 'posDon'],
  ['huella', 'dow'],
  ['geometria', 'pendAtr'],
];
const CATEGORICOS = [
  ['huella', 'pilaEma'],
  ['huella', 'estructura'],
  ['huella', 'sesion'],
];

const CONF = { k: 8, minVecinos: 3, confianzaMin: 0.6, decaimientoDias: 90 };

function mediana(valores) {
  const v = valores.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Escala de cada campo numérico: rango intercuartílico del corpus. */
function rangosDe(casos) {
  const rangos = {};
  for (const [grupo, campo] of NUMERICOS) {
    const vals = casos
      .map((c) => c[grupo] && c[grupo][campo])
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    if (vals.length < 2) { rangos[campo] = 1; continue; }
    const q = (p) => vals[Math.min(vals.length - 1, Math.floor((vals.length - 1) * p))];
    const iqr = q(0.75) - q(0.25);
    const rango = vals[vals.length - 1] - vals[0];
    rangos[campo] = iqr > 0 ? iqr : (rango > 0 ? rango : 1);
  }
  return rangos;
}

/** Distancia de Gower ponderada: numéricos normalizados, categóricos 0/1. */
function distancia(a, b, pesos = PESOS_HUELLA, rangos = {}) {
  let suma = 0, total = 0;
  for (const [grupo, campo] of NUMERICOS) {
    const w = pesos[campo];
    if (!w) continue;
    const va = a[grupo] && a[grupo][campo];
    const vb = b[grupo] && b[grupo][campo];
    if (!Number.isFinite(va) || !Number.isFinite(vb)) continue;
    const escala = rangos[campo] || 1;
    suma += w * Math.min(1, Math.abs(va - vb) / escala);
    total += w;
  }
  for (const [grupo, campo] of CATEGORICOS) {
    const w = pesos[campo];
    if (!w) continue;
    const va = a[grupo] && a[grupo][campo];
    const vb = b[grupo] && b[grupo][campo];
    if (va === null || va === undefined || vb === null || vb === undefined) continue;
    suma += w * (va === vb ? 0 : 1);
    total += w;
  }
  return total ? suma / total : 1;
}

/**
 * Sugerencia para una consulta (caso borrador con huella ya calculada).
 * Devuelve la línea fantasma solo si hay base suficiente.
 */
function sugerir(consulta, casos, opciones = {}) {
  const C = { ...CONF, ...opciones };
  const ahora = consulta.mercado.t;

  const aprobados = (casos || []).filter((c) => c
    && c.etiqueta && c.etiqueta.estado === 'aprobado'
    && c.geometria && c.geometria.valida !== false
    && c.mercado && Number.isFinite(c.mercado.t)
    && c.mercado.t <= ahora);

  if (!aprobados.length) {
    return {
      hay: false,
      motivo: 'memoria vacía',
      confianza: 0,
      vecinos: [],
      fantasma: null,
      explicacion: 'sin casos parecidos todavía',
    };
  }

  const rangos = rangosDe(aprobados);
  const ranking = aprobados.map((c) => {
    const dg = distancia(consulta, c, PESOS_HUELLA, rangos);
    const dias = Math.max(0, (ahora - c.mercado.t) / 86400000);
    const decaimiento = Math.exp(-dias / C.decaimientoDias);
    let d = 1 - (1 - dg) * decaimiento;
    if (c.mercado.simbolo !== consulta.mercado.simbolo) d = Math.min(1, d + 0.05);
    if (c.mercado.tf !== consulta.mercado.tf) d = Math.min(1, d + 0.03);
    return { caso: c, distancia: d, similitud: 1 - d };
  }).sort((a, b) => a.distancia - b.distancia).slice(0, C.k);

  if (ranking.length < C.minVecinos) {
    return {
      hay: false,
      motivo: `faltan casos parecidos (${ranking.length}/${C.minVecinos})`,
      confianza: 0,
      vecinos: resumirVecinos(ranking),
      fantasma: null,
      explicacion: 'todavía no hay base suficiente para sugerir',
    };
  }

  const signo = Math.sign(consulta.geometria.pendAtr || 0);
  const mismoSentido = signo === 0 ? 0 : ranking.filter((v) => Math.sign(v.caso.geometria.pendAtr || 0) === signo).length;
  const acuerdo = signo === 0 ? 0 : mismoSentido / ranking.length;
  const confianza = Number((acuerdo * Math.min(1, ranking.length / 5)).toFixed(3));

  const pendientes = ranking.map((v) => v.caso.geometria.pendAtr).filter(Number.isFinite);
  const pendAtr = mediana(pendientes);
  const atr = consulta.huella && Number.isFinite(consulta.huella.atr) ? consulta.huella.atr : null;
  const anclajeCierre = ranking.filter((v) => v.caso.geometria.anclaje === 'cierre').length;

  let fantasma = null;
  if (confianza >= C.confianzaMin && Number.isFinite(pendAtr) && atr > 0) {
    const { i1, i2, p1 } = consulta.geometria;
    fantasma = {
      i1, i2, p1,
      p2: p1 + pendAtr * atr * (i2 - i1),
      pendAtr: Number(pendAtr.toFixed(4)),
      vecinos: ranking.length,
      confianza,
    };
  }

  return {
    hay: !!fantasma,
    motivo: fantasma ? null : `confianza baja (${Math.round(confianza * 100)}%)`,
    confianza,
    vecinos: resumirVecinos(ranking),
    fantasma,
    explicacion: `${anclajeCierre} de ${ranking.length} casos parecidos anclaron en el cierre`
      + (signo ? ` · ${mismoSentido} con la misma pendiente` : ''),
  };
}

function resumirVecinos(ranking) {
  return ranking.map((v) => ({
    id: v.caso.id,
    distancia: Number(v.distancia.toFixed(3)),
    similitud: Number((1 - v.distancia).toFixed(3)),
    simbolo: v.caso.mercado.simbolo,
    tf: v.caso.mercado.tf,
    t: v.caso.mercado.t,
    pendAtr: v.caso.geometria.pendAtr,
    anclaje: v.caso.geometria.anclaje,
    estado: v.caso.etiqueta.estado,
    resultado: v.caso.etiqueta.resultado,
  }));
}

module.exports = {
  sugerir,
  distancia,
  rangosDe,
  mediana,
  PESOS_HUELLA,
  CONF,
};
