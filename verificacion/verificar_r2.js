'use strict';
/* Ronda 2 de verificación — tests corregidos */
const path = require('path');
const REPO = '/home/z/my-project/weltrade-webterminal-connector';
const importador = require(path.join(REPO, 'motor-senales/importador.js'));

/* ---------- P2b: ReDoS real ---------- */
console.log('━━━ P2: ReDoS /(^.|\r|\n)*=/ con \\r y sin "=" ━━━');
for (const n of [16, 19, 22, 25]) {
  const t = '\r'.repeat(n);
  const t0 = process.hrtime.bigint();
  let out;
  try { out = String(importador.importarDocumento('a.sinext', Buffer.from(t)).ok); } catch (e) { out = 'EXC'; }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`  ${n} \\r (${(2 ** n).toExponential(0)} rutas) → ${ms.toFixed(0)} ms  ok=${out}`);
}

/* ---------- P3b: buscarBloqueJson cuadrático (input con muchas }) ---------- */
console.log('\n━━━ P3: buscarBloqueJson con muchas "}" (cada intento de parse recorre hasta la "}") ━━━');
for (const k of [500, 2000, 8000]) {
  const texto = '{' + '{"x":1}'.repeat(k);   // k cerraduras; cada fin=intento parsea ~k*7 bytes
  const t0 = process.hrtime.bigint();
  importador.importarDocumento('a.sinext', Buffer.from(texto));
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`  ${k} bloques (${((k * 7 + 1) / 1024).toFixed(0)} KB) → ${ms.toFixed(0)} ms`);
}

/* ---------- P1b: paréntesis desbalanceado en PWA ---------- */
console.log('\n━━━ P1b: símbolo con "(" suelto en la PWA ━━━');
const rePWA = /[.*+?^${}()|[\\]\\]/g;
for (const c of ['FX(2', 'Boom [500', 'Vol 20 {x']) {
  const esc = c.replace(rePWA, '\\$&');
  try { new RegExp('^(' + esc + ')$', 'i'); console.log(`  "${c}" → compila (escape="${esc}")`); }
  catch (e) { console.log(`  "${c}" → SyntaxError: ${e.message.slice(0, 50)}  ← crearCliente() lanza y la UI queda colgada en "conectando…"}`); }
}
