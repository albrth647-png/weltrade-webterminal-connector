/* Series sintéticas compartidas por las pruebas y el visor.
 * El mínimo de cada ciclo cae exactamente sobre la línea plantada, así que
 * sabemos de antemano dónde DEBE quedar la raya. */

import { atrSerie, normalizar } from "./motor.mjs";

export function serieTendencia(n = 600, {
  base = 100, slopeIni = 0.05, slopeFin = 0.05, cambio = 1e9,
  amp = 2.2, ciclo = 24, seed = 7
} = {}) {
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const nivel = (i) => base + slopeIni * Math.min(i, cambio) + slopeFin * Math.max(0, i - cambio);
  const out = [];
  let prev = nivel(0) + amp * 0.5;
  for (let i = 0; i < n; i++) {
    const fase = 2 * Math.PI * (i % ciclo) / ciclo;
    const close = nivel(i) + amp * (0.5 + 0.5 * Math.sin(fase)) + (rnd() - 0.5) * 0.12;
    const open = prev + (rnd() - 0.5) * 0.05;
    const hi = Math.max(open, close) + 0.35 + rnd() * 0.1;
    const lo = Math.min(open, close) - 0.35 - rnd() * 0.1;
    out.push({ t: 1700000000000 + i * 300000, o: open, h: hi, l: lo, c: close });
    prev = close;
  }
  return out;
}

/* Ruptura: tras un tramo sano, el precio se va ATRs por debajo de la línea. */
export function serieConRuptura(n = 320) {
  const v = serieTendencia(n);
  const atr = atrSerie(normalizar(v), 14);
  const lastAtr = atr[n - 30];
  for (let i = n - 40; i < n; i++) {
    const k = i - (n - 40);
    const golpe = lastAtr * (0.6 + 0.12 * k);
    v[i] = {
      t: v[i].t,
      o: v[i].o - golpe, h: v[i].h - golpe * 0.6,
      l: v[i].l - golpe * 1.2, c: v[i].c - golpe
    };
  }
  return v;
}

export const serieDemo = serieTendencia;
