import { zonasDe, detectarPivotes } from './zonas.js';

let ok = 0, fail = 0;
function check(cond, msg) {
  if (cond) { ok++; console.log('OK  ' + msg); }
  else { fail++; console.log('FAIL ' + msg); }
}

// velas con un máximo claro en el medio y un mínimo claro
const velas = [];
for (let i = 0; i < 20; i++) {
  const base = 100 + Math.sin(i * 0.5) * 2;
  velas.push({ t: i * 60000, o: base, h: base + 0.5, l: base - 0.5, c: base });
}
// forzar un pico en i=10
velas[10].h = 110; velas[10].l = 109;
// forzar un valle en i=5
velas[5].l = 90; velas[5].h = 91;

const { highs, lows } = detectarPivotes(velas, 3);
check(highs.includes(10), 'pivote high en i=10');
check(lows.includes(5), 'pivote low en i=5');

const zs = zonasDe(velas, 3);
check(zs.length >= 2, 'al menos 2 zonas');
check(zs.some(z => z.tipo === 'resistencia' && z.precio === 110), 'zona resistencia en 110');
check(zs.some(z => z.tipo === 'soporte' && z.precio === 90), 'zona soporte en 90');
check(zs.every(z => z.iHasta === velas.length - 1), 'zonas hasta última vela');

// vacío
check(zonasDe([], 3).length === 0, 'sin velas → sin zonas');
check(zonasDe(null, 3).length === 0, 'null → sin zonas');

console.log(`\n${ok} OK, ${fail} FAIL`);
process.exit(fail ? 1 : 0);