'use strict';
/* P3c: cuadrático real — prefijo largo casi-válido + muchas "}" */
const path = require('path');
const REPO = '/home/z/my-project/weltrade-webterminal-connector';
const importador = require(path.join(REPO, 'motor-senales/importador.js'));
console.log('━━━ P3c: buscarBloqueJson — prefijo válido largo que falla al final ━━━');
let prev = 0;
for (const k of [1000, 4000, 16000]) {
  const texto = '{"a":[' + '{"b":1},'.repeat(k) + ',]';   // JSON inválido solo al final
  const t0 = process.hrtime.bigint();
  importador.importarDocumento('a.sinext', Buffer.from(texto));
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`  k=${k} (${(texto.length / 1024).toFixed(0)} KB) → ${ms.toFixed(0)} ms  (x${(ms / (prev || 1)).toFixed(1)} por x4 de tamaño)`);
  prev = ms;
}
console.log('  (si el ratio se acerca a 16 por cada x4 → cuadrático O(n²))');
