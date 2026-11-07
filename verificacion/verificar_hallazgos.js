'use strict';
/* ============================================================
   VERIFICACIÓN DE HALLAZGOS — auditoría weltrade-webterminal-connector
   Prueba empíricamente los bugs detectados en la revisión manual.
   ============================================================ */
const path = require('path');
const REPO = '/home/z/my-project/weltrade-webterminal-connector';

let paso = 0;
const titulo = (s) => console.log(`\n━━━ PRUEBA ${++paso}: ${s} ━━━`);

/* ---------- P1: regex de escape roto en pwa/app.js ---------- */
titulo('Regex de escape de símbolos (PWA vs motor Node)');
// versión PWA (pwa/app.js:158) — copiada literal del fichero
const rePWA = /[.*+?^${}()|[\\]\\]/g;
// versión motor-senales (app.js:42) — copiada literal del fichero
const reNode = /[.*+?^${}()|[\]\\]/g;
const casos = ['FX Vol 20', 'Step.5', 'Boom 500 (LIVE)', 'Crash+1', 'SFX*Vol'];
for (const c of casos) {
  const p1 = c.replace(rePWA, '\\$&');
  const p2 = c.replace(reNode, '\\$&');
  let okPWA = 'compila', okNode = 'compila';
  try { new RegExp('^(' + p1 + ')$', 'i'); } catch (e) { okPWA = 'LANZA: ' + e.message.slice(0, 40); }
  try { new RegExp('^(' + p2 + ')$', 'i'); } catch (e) { okNode = 'LANZA: ' + e.message.slice(0, 40); }
  console.log(`  "${c}"  PWA→escapado="${p1}"  ${okPWA}`);
  console.log(`           Node→escapado="${p2}"  ${okNode}`);
}

/* ---------- P2: ReDoS en importador.js (sniffing) ---------- */
titulo('ReDoS: /^(.|\\r|\\n)*=/ sobre texto con \\r sin "="');
const importador = require(path.join(REPO, 'motor-senales/importador.js'));
for (const n of [16, 20, 24]) {
  const t = '\r'.repeat(n);            // sin "=" → el motor agota todas las rutas
  const t0 = process.hrtime.bigint();
  let res = '?';
  try { res = String(importador.importarDocumento('archivo.sinext', Buffer.from(texto)).ok); }
  catch (e) { res = 'excepción ' + e.message.slice(0, 30); }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`  n=${n} (2^${n} caminos) → ${ms.toFixed(0)} ms  (ok=${res})`);
}

/* ---------- P3: CPU-DoS en buscarBloqueJson (O(n²)) ---------- */
titulo('buscarBloqueJson: coste cuadrático con JSON imposible');
for (const kb of [64, 256, 1024]) {
  const texto = '{' + '"a":1,'.repeat(Math.floor(kb * 1024 / 6)); // nunca cierra → parse falla en cada intento
  const t0 = process.hrtime.bigint();
  importador.importarDocumento('x.sinext', Buffer.from(texto));
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`  ${kb} KB → ${ms.toFixed(0)} ms  (8 MB ≈ ${(ms * 8192 / kb / 1000).toFixed(0)} s de CPU por petición)`);
}

/* ---------- P4-P7 ---------- */
(async () => {
  /* ---------- P4: doble emisión de 'cerrar' ---------- */
  titulo('Doble emisión de "cerrar" (cerrar() + onclose) en cliente_mt5.js');
  const { ClienteMT5 } = require(path.join(REPO, 'motor-senales/cliente_mt5.js'));
  const c = new ClienteMT5({ login: '1', pass: 'x' });
  let emis = 0;
  c.on('cerrar', () => emis++);
  c.ws = { close() { setTimeout(() => c.ws.onclose && c.ws.onclose(), 5); } };
  c._ping = setInterval(() => {}, 1e6);
  c.cerrar();                          // igual que login rechazado / desconexión manual
  await new Promise((r) => setTimeout(r, 30));
  console.log(`  eventos "cerrar" recibidos tras UNA llamada a cerrar(): ${emis}  ${emis > 1 ? '← BUG: cada evento agenda una reconexión extra en app.js' : ''}`);

  /* ---------- P5: vela en formación sembrada como cerrada ---------- */
  titulo('setHistoria siembra la vela EN FORMACIÓN y nunca se corrige');
  const { Estrategia } = require(path.join(REPO, 'motor-senales/estrategia.js'));
  const { validarDoc, docACfg } = require(path.join(REPO, 'motor-senales/doc_estrategia.js'));
  const fs = require('fs');
  const v = validarDoc(JSON.parse(fs.readFileSync(path.join(REPO, 'motor-senales/estrategias/raptor_default.json'), 'utf8')));
  const E = new Estrategia(docACfg(v.doc));
  const S = 'FX Vol 20';
  const M15 = 900e3;
  const t0 = Math.floor(Date.now() / M15) * M15;       // vela M15 EN CURSO ahora mismo
  const hist = [];
  for (let i = 30; i >= 1; i--) hist.push({ t: t0 - i * M15, o: 100, h: 100.5, l: 99.5, c: 100 });
  hist.push({ t: t0, o: 100, h: 100.1, l: 99.9, c: 100.05 });   // ← parcial del servidor
  E.setHistoria(S, 'M15', hist);
  const antes = E.s.get(S).velas.M15[E.s.get(S).velas.M15.length - 1];
  console.log(`  sembrada vela t=${t0} con h=${antes.h} c=${antes.c} (parcial en el momento de pedir)`);

  const reales = { t: t0, o: 100, h: 103.7, l: 97.2, c: 103.5 };  // la vela t0 ya CERRADA con sus valores reales
  E.onVelaCerrada(S, 'M15', reales);
  const despues = E.s.get(S).velas.M15[E.s.get(S).velas.M15.length - 1];
  const rechazada = despues.h === antes.h && despues.l === antes.l && despues.c === antes.c;
  console.log(`  vela cerrada REAL h=${reales.h} l=${reales.l} c=${reales.c} → ${rechazada ? 'RECHAZADA por el guard de duplicados (arr[last].t >= vela.t)' : 'reemplazada'}`);
  console.log(`  buffer queda con h=${despues.h} l=${despues.l} c=${despues.c} ${rechazada ? '← BUG: ATR/zonas calculados sobre una vela parcial, y persistida' : ''}`);

  /* ---------- P6: contaminación cruzada de velas (cmd 11) ---------- */
  titulo('pedirVelas: respuesta de un símbolo se entrega a TODAS las peticiones pendientes');
  const crypto = require('crypto');
  const c2 = new ClienteMT5({ login: '1', pass: 'x' });
  c2.etapa = 'listo';
  c2.ids = { AAA: 1, BBB: 2 }; c2.nombres = { 1: 'AAA', 2: 'BBB' };
  const OBF = '13ef13b2b76dd8:5795gdcfb2fdc1ge85bf768f54773d22fff996e3ge75g5:75';
  const o = (e) => e.split('').map((ch) => ch.charCodeAt(0) === 28 ? '&' : ch.charCodeAt(0) === 23 ? '!' : String.fromCharCode(ch.charCodeAt(0) - 1)).join('');
  c2.clave = Buffer.from((o(OBF).match(/.{2}/g) || []).map((x) => parseInt(x, 16)));
  let ultimoPacket = null;
  c2._enviarPacket = (p) => { ultimoPacket = p; };
  c2.ws = { send() {} };
  const pa = c2.pedirVelas('AAA', { tf: 'M5', timeoutMs: 5000 });
  const pb = c2.pedirVelas('BBB', { tf: 'M5', timeoutMs: 5000 });
  // respuesta del servidor: 1 vela (del símbolo que pidió AAA)
  const reg = Buffer.alloc(48);
  reg.writeUInt32LE(1111, 0);
  reg.writeDoubleLE(1, 4); reg.writeDoubleLE(2, 12); reg.writeDoubleLE(0.5, 20); reg.writeDoubleLE(1.5, 28);
  const cab = Buffer.alloc(5); cab.writeUInt16LE(11, 2);
  const packet = Buffer.concat([cab, Buffer.alloc(1), reg]);
  const ci = crypto.createCipheriv('aes-256-cbc', c2.clave, Buffer.alloc(16));
  const cif = Buffer.concat([ci.update(packet), ci.final()]);
  const frame = Buffer.alloc(8 + cif.length);
  frame.writeUInt32LE(cif.length, 0); frame.writeUInt32LE(1, 4); cif.copy(frame, 8);
  c2._onMensaje(frame);
  const [ra, rb] = await Promise.all([pa, pb]);
  console.log(`  velas entregadas a AAA: ${ra ? ra.velas.length : 'null'} · a BBB: ${rb ? rb.velas.length : 'null'}`);
  console.log(`  ${ra && rb && ra.velas.length === rb.velas.length && ra.velas.length ? '← BUG confirmado: la MISMA respuesta resuelve las dos promesas' : 'OK (sin mezcla)'}`);

  /* ---------- P7: login no numérico ---------- */
  titulo('writeUInt32LE(parseInt("abc")) en el cuerpo de login (Node)');
  try {
    const b = Buffer.alloc(912);
    b.writeUInt32LE(parseInt('abc', 10), 736);
    console.log('  no lanza');
  } catch (e) {
    console.log(`  LANZA: ${e.message.slice(0, 70)}`);
    console.log('  → en conector.js el throw ocurre dentro de ws.onmessage (handler de evento) → caída del proceso');
  }

  console.log('\n═══ FIN DE VERIFICACIONES ═══');
  process.exit(0);
})();
