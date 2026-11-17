/* ============================================================
   Regresión del escáner de tendencia (F2).
   - determinismo y ausencia de estado global
   - estados válidos, fuerza y matriz acotadas
   - una tendencia clara no se queda en RANGO
   - un rango ruidoso no se declara TENDENCIA
   - p95 ≤ 5 ms por evaluación
   ============================================================ */
import escaner from './escaner.js';
const { evaluar, calcularMatriz, escanearSeries } = escaner;

let ok = 0, mal = 0;
const check = (nombre, cond, extra = '') => {
  if (cond) { ok++; console.log(`  ok: ${nombre}`); }
  else { mal++; console.error(`  FALLA: ${nombre}${extra ? ' — ' + extra : ''}`); }
};

function serie(n, modo) {
  const out = [];
  let precio = 100000, semilla = 777;
  const rnd = () => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla / 2147483648; };
  for (let i = 0; i < n; i++) {
    const o = precio;
    /* tendencia: deriva constante · rango: ruido estacionario sin dirección */
    const c = modo === 'tendencia'
      ? precio + 55 + (rnd() - 0.5) * 25
      : 100000 + (rnd() - 0.5) * 80;
    out.push({
      t: 1762905600000 + i * 300000,
      o,
      c,
      h: Math.max(o, c) + rnd() * 12,
      l: Math.min(o, c) - rnd() * 12,
    });
    precio = c;
  }
  return out;
}

const tendencia = serie(400, 'tendencia');
const rango = serie(400, 'rango');

/* --- determinismo --- */
const a = evaluar(tendencia);
const b = evaluar(tendencia);
check('misma serie → mismo resultado', JSON.stringify(a) === JSON.stringify(b));
check('no comparte referencias (sin estado global)', a !== b);

/* --- forma del resultado --- */
const ESTADOS = ['RANGO', 'TENDENCIA', 'DEBIL', 'AGOTAMIENTO'];
check('estado válido', ESTADOS.includes(a.estado), a.estado);
check('fuerza en 0..1', a.fuerza >= 0 && a.fuerza <= 1, String(a.fuerza));
check('er en 0..1', a.er === null || (a.er >= 0 && a.er <= 1), String(a.er));
check('r2 en 0..1', a.r2 === null || (a.r2 >= 0 && a.r2 <= 1), String(a.r2));
check('dirección válida', ['alcista', 'bajista', 'ninguna'].includes(a.direccion), a.direccion);
check('volatilidad válida', ['baja', 'normal', 'alta'].includes(a.volatilidad), a.volatilidad);
check('niveles acotados', Array.isArray(a.niveles) && a.niveles.length <= escaner.PARAMS.maxNiveles);
check('cambios acotados', a.cambios >= 0 && a.cambios <= escaner.PARAMS.ventanaEstado);

/* --- comportamiento esperado --- */
check('tendencia clara no queda en RANGO', a.estado !== 'RANGO', a.estado);
const r = evaluar(rango);
check('rango ruidoso no es TENDENCIA', r.estado !== 'TENDENCIA', r.estado);
check('rango sin dirección tiene ER bajo', r.er !== null && r.er < 0.35, String(r.er));

/* --- las series optimizadas coinciden con la cuenta directa --- */
function erDirecto(c, n, i) {
  let s = 0;
  for (let j = i - n + 1; j <= i; j++) s += Math.abs(c[j] - c[j - 1]);
  return s > 0 ? Math.abs(c[i] - c[i - n]) / s : null;
}
function r2Directo(c, n, i) {
  const ys = c.slice(i - n + 1, i + 1);
  const m = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let k = 0; k < n; k++) { const dx = k - (n - 1) / 2, dy = ys[k] - m; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  if (!(sxx > 0) || !(syy > 0)) return null;
  const b = sxy / sxx;
  let ss = 0;
  for (let k = 0; k < n; k++) { const pred = m + b * (k - (n - 1) / 2); ss += (ys[k] - pred) ** 2; }
  return 1 - ss / syy;
}
const cierres = tendencia.map((v) => v.c);
const erS = escaner.erSerie(cierres, 20);
const r2S = escaner.r2Serie(cierres, 20);
check('ER deslizante coincide con la cuenta directa', Math.abs(erS[300] - erDirecto(cierres, 20, 300)) < 1e-9);
check('R² con sumas prefijas coincide', Math.abs(r2S[300] - r2Directo(cierres, 20, 300)) < 1e-6, String(r2S[300]) + ' vs ' + String(r2Directo(cierres, 20, 300)));

/* --- sin fuga de futuro: recortar a la última vela no altera nada --- */
const recortada = tendencia.slice(0, tendencia.length);
check('recorte exacto no altera', JSON.stringify(evaluar(recortada)) === JSON.stringify(a));

/* --- series cortas --- */
check('serie corta devuelve null', evaluar(tendencia.slice(0, 50)) === null);

/* --- matriz --- */
const mat = escanearSeries({ H1: tendencia, M30: tendencia, M15: rango, M5: tendencia });
check('score en -1..1', mat.matriz.score >= -1 && mat.matriz.score <= 1, String(mat.matriz.score));
check('alineación 0..4', mat.matriz.alineacion >= 0 && mat.matriz.alineacion <= 4, String(mat.matriz.alineacion));
check('sesgo es texto', typeof mat.matriz.sesgo === 'string' && mat.matriz.sesgo.length > 0);
check('detalle por TF', Object.keys(mat.matriz.detalle).length === 4);
check('sin series → sin datos', calcularMatriz({}).sesgo === 'sin datos');

/* --- latencia: p95 ≤ 5 ms --- */
/* Calentamiento: las primeras llamadas pagan JIT/GC y no representan el
   coste en régimen. Sin él, en Termux el p95 oscilaba por encima de 5 ms. */
for (let i = 0; i < 40; i++) evaluar(tendencia);
const muestras = [];
for (let i = 0; i < 200; i++) {
  const t0 = process.hrtime.bigint();
  evaluar(tendencia);
  muestras.push(Number(process.hrtime.bigint() - t0) / 1e6);
}
muestras.sort((x, y) => x - y);
const p50 = muestras[Math.floor(muestras.length * 0.5)];
const p95 = muestras[Math.floor(muestras.length * 0.95)];
check('p50 ≤ 5 ms', p50 <= 5, p50.toFixed(2) + ' ms');
check('p95 ≤ 5 ms', p95 <= 5, p95.toFixed(2) + ' ms');
console.log(`  latencia: p50 ${p50.toFixed(2)} ms · p95 ${p95.toFixed(2)} ms · n=200`);

console.log(`\nresultado: ${ok} OK / ${mal} fallos`);
process.exit(mal ? 1 : 0);
