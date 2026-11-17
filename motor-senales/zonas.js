'use strict';
/* ============================================================
   RAPTOR — ZONAS HORIZONTALES (port del DrawZoneRect del doc)
   ------------------------------------------------------------
   Detecta pivotes de precio (máximos/mínimos locales) con fuerza
   `swingStrength` barras a cada lado y los convierte en zonas
   horizontales (rectángulos) que se extienden hasta la última vela.

   Convención de colores del documento:
     - swing LOW  (soporte, alcista) → azul
     - swing HIGH (resistencia, bajista) → rojo

   Solo se consideran velas cerradas: las últimas `swingStrength`
   barras se descartan para no usar máximos/mínimos aún no confirmados.
   ============================================================ */

const SWING_STRENGTH_DEFAULT = 3;
const COLOR_BULL = '#448aff';   // azul alcista (soporte)
const COLOR_BEAR = '#ff5252';   // rojo bajista (resistencia)

function velasValidas(velas) {
  return Array.isArray(velas) ? velas : [];
}

/* Detecta índices de pivotes swing-high / swing-low. */
function detectarPivotes(velas, fuerza) {
  const s = Math.max(1, Number.isFinite(fuerza) ? fuerza : SWING_STRENGTH_DEFAULT);
  const vs = velasValidas(velas);
  const n = vs.length;
  const highs = [], lows = [];
  // las últimas `s` velas no están confirmadas
  for (let i = s; i < n - s; i++) {
    const hi = vs[i].h;
    const lo = vs[i].l;
    let esHigh = true, esLow = true;
    for (let k = 1; k <= s; k++) {
      if (vs[i - k].h >= hi || vs[i + k].h >= hi) esHigh = false;
      if (vs[i - k].l <= lo || vs[i + k].l <= lo) esLow = false;
      if (!esHigh && !esLow) break;
    }
    if (esHigh) highs.push(i);
    if (esLow) lows.push(i);
  }
  return { highs, lows };
}

/* Construye la lista de zonas a partir de los pivotes. Cada zona es un
   rectángulo horizontal: precio = nivel del pivote, desde el índice del
   pivote hasta la última vela. */
function zonasDe(velas, fuerza) {
  const vs = velasValidas(velas);
  if (!vs.length) return [];
  const n = vs.length;
  const { highs, lows } = detectarPivotes(vs, fuerza);
  const zonas = [];
  for (const i of highs) {
    zonas.push({
      tipo: 'resistencia',
      lado: 'bajista',
      precio: vs[i].h,
      iDesde: i,
      iHasta: n - 1,
      color: COLOR_BEAR,
      swingStrength: fuerza || SWING_STRENGTH_DEFAULT,
    });
  }
  for (const i of lows) {
    zonas.push({
      tipo: 'soporte',
      lado: 'alcista',
      precio: vs[i].l,
      iDesde: i,
      iHasta: n - 1,
      color: COLOR_BULL,
      swingStrength: fuerza || SWING_STRENGTH_DEFAULT,
    });
  }
  return zonas;
}

module.exports = {
  zonasDe,
  detectarPivotes,
  SWING_STRENGTH_DEFAULT,
  COLOR_BULL,
  COLOR_BEAR,
};