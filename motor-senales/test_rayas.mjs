'use strict';
import { analizar, rayaVigente, Vigia } from './rayas.js';

let pass = 0, fail = 0;
function eq(a, b, msg) { if (a !== b) { fail++; console.log('  FAIL: ' + msg + ' (got ' + JSON.stringify(a) + ', want ' + JSON.stringify(b) + ')'); } else { pass++; console.log('  ok: ' + msg); } }
function ok(cond, msg) { if (!cond) { fail++; console.log('  FAIL: ' + msg); } else { pass++; console.log('  ok: ' + msg); } }

/* Serie sintética: raya bajista anclada en CIERRES (cuerpo de la vela).
   Dos pivotes máximos por cierre (i=8 e i=20) forman una línea descendente;
   el precio rompe por encima en i=36. */
function makeSerie(mode) {
  const n = 46;
  const closes = new Array(n);
  const m = -5 / 12;
  const line = (i) => 200 + m * (i - 8);
  for (let i = 0; i < 8; i++) closes[i] = 195 + i * 0.6;
  closes[8] = 200;
  for (let i = 9; i < 17; i++) closes[i] = line(i) - 0.5;
  closes[12] = line(12) - 0.1; // toque
  closes[17] = 194.5; closes[18] = 194.6; closes[19] = 194.7;
  closes[20] = 195;
  for (let i = 21; i < 34; i++) closes[i] = line(i) - 0.5;
  closes[25] = line(25) - 0.1; // toque
  if (mode === 'cambio') {
    closes[36] = 192;
    for (let i = 37; i < n; i++) closes[i] = 192.5;
  } else {
    closes[36] = 192;
    closes[37] = 191;
    closes[38] = 186; // regresa por debajo de la raya
    for (let i = 39; i < n; i++) closes[i] = 188.5;
  }
  for (let i = 0; i < n; i++) if (closes[i] === undefined) closes[i] = line(i) - 1;
  return closes.map((c, i) => ({ t: (i + 1) * 1800000, o: c, h: c + 1, l: c - 1, c }));
}

console.log('--- test_rayas ---');
const V1 = makeSerie('cambio');
const evs1 = analizar(V1, { minVelasSerie: 30 });
ok(evs1.length >= 1, 'cambio: al menos un evento');
ok(evs1.some((e) => e.clase === 'cambio'), 'cambio: hay cambio');
ok(evs1.some((e) => e.clase === 'cambio' && e.brk === 36), 'cambio: ruptura referenciada en brk=36');
ok(evs1.some((e) => e.clase === 'cambio' && e.iEv === 38), 'cambio: aviso en iEv=38 (2 velas de confirmación)');

const V2 = makeSerie('engano');
const evs2 = analizar(V2, { minVelasSerie: 30 });
ok(evs2.some((e) => e.clase === 'engano' && e.iEv === 38), 'engano: aparece en iEv=38');
ok(!evs2.some((e) => e.clase === 'cambio' && e.brk === 36), 'engano: la ruptura fallida NO se marca como cambio');

const vig = new Vigia({ simbodo: 'X', tf: 'M30', params: { minVelasSerie: 30 } });
/* Con una sola vela tras la ruptura todavía no se puede confirmar: no hay aviso. */
const rB0 = vig.revisar(V1.slice(0, 37));
ok(rB0.eventos.length === 0, 'Vigia: no declara cambio sin confirmación');
const rB = vig.revisar(V1.slice(0, 39));
ok(rB.eventos.length === 1 && rB.eventos[0].clase === 'cambio', 'Vigia: cambio al confirmar (2 velas)');
ok(rB.raya !== null, 'Vigia: raya vigente disponible');
const rDup = vig.revisar(V1.slice(0, 39));
ok(rDup.eventos.length === 0, 'Vigia: no duplica');
const rC = vig.revisar(V1);
ok(rC.eventos.length === 0, 'Vigia: sin duplicados al extender la serie');

const rv = rayaVigente(V1, { minVelasSerie: 30 });
ok(rv !== null && rv.tipo === 'bajista', 'rayaVigente: bajista');
ok(rv.rota === true, 'rayaVigente: rota tras ruptura');

console.log('\\n' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
