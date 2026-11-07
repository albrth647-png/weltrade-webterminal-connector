'use strict';
/* Ronda 5: (a) contaminación cruzada cmd 11 con packet corregido
   (b) tormenta tras login rechazado en motor-senales (mismo cliente) */
const path = require('path');
const crypto = require('crypto');
const REPO = '/home/z/my-project/weltrade-webterminal-connector';
const { ClienteMT5 } = require(path.join(REPO, 'motor-senales/cliente_mt5.js'));

const OBF = '13ef13b2b76dd8:5795gdcfb2fdc1ge85bf768f54773d22fff996e3ge75g5:75';
const o = (e) => e.split('').map((ch) => ch.charCodeAt(0) === 28 ? '&' : ch.charCodeAt(0) === 23 ? '!' : String.fromCharCode(ch.charCodeAt(0) - 1)).join('');
const CLAVE = Buffer.from((o(OBF).match(/.{2}/g) || []).map((x) => parseInt(x, 16)));

(async () => {
  /* (a) contaminación cruzada */
  console.log('━━━ P6: dos pedirVelas simultáneos (AAA y BBB) + respuesta del servidor ━━━');
  const c = new ClienteMT5({ login: '1', pass: 'x' });
  c.etapa = 'listo';
  c.ids = { AAA: 1, BBB: 2 }; c.nombres = { 1: 'AAA', 2: 'BBB' };
  c.clave = CLAVE;
  c.ws = { send() {} };
  let ultimo = null;
  c._enviarPacket = (p) => { ultimo = p; };
  const pa = c.pedirVelas('AAA', { tf: 'M5', timeoutMs: 4000 });
  const packetAAA = ultimo ? ultimo.subarray(4, 64).toString('utf16le').replace(/\0.*$/, '') : '?';
  const pb = c.pedirVelas('BBB', { tf: 'M5', timeoutMs: 4000 });
  const packetBBB = ultimo ? ultimo.subarray(4, 64).toString('utf16le').replace(/\0.*$/, '') : '?';
  console.log(`  packets enviados: [${packetAAA}] y [${packetBBB}] (pedidos distintos, pendientes simultáneos: ${c._pendientes11.size})`);
  // respuesta del servidor: UNA vela (p.ej. del símbolo AAA)
  const reg = Buffer.alloc(48);
  reg.writeUInt32LE(1111, 0);
  reg.writeDoubleLE(1, 4); reg.writeDoubleLE(2, 12); reg.writeDoubleLE(0.5, 20); reg.writeDoubleLE(1.5, 28);
  const cab = Buffer.alloc(5); cab.writeUInt16LE(11, 2);
  const packet = Buffer.concat([cab, reg]);           // 53 bytes: [r0 r1 cmd dd][48B registro]
  const ci = crypto.createCipheriv('aes-256-cbc', CLAVE, Buffer.alloc(16));
  const cif = Buffer.concat([ci.update(packet), ci.final()]);
  const frame = Buffer.alloc(8 + cif.length);
  frame.writeUInt32LE(cif.length, 0); frame.writeUInt32LE(1, 4); cif.copy(frame, 8);
  c._onMensaje(frame);
  const [ra, rb] = await Promise.all([pa, pb]);
  console.log(`  velas para AAA: ${ra ? ra.velas.length : 'null'} · para BBB: ${rb ? rb.velas.length : 'null'}`);
  console.log(`  ${ra && rb && ra.velas.length === 1 && rb.velas.length === 1 ? '← BUG: la MISMA vela resuelve las DOS promesas (BBB recibe velas de AAA)' : 'OK'}`);

  /* (b) login rechazado → sesiones paralelas */
  console.log('\n━━━ P4d: login rechazado (cerrar() interno) con el bucle de app.js ━━━');
  let sockets = 0;
  class FakeWS {
    constructor() { sockets++; this.readyState = 0; this.sent = [];
      setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 3);
      setTimeout(() => { this.readyState = 3; this.onclose && this.onclose(); }, 40); }
    close() { this.readyState = 3; setTimeout(() => this.onclose && this.onclose(), 3); }
    send() {}
  }
  const realWS = global.WebSocket;
  global.WebSocket = FakeWS;
  const c2 = new ClienteMT5({ login: '1', pass: 'x' });
  c2.on('cerrar', () => setTimeout(arrancar, 3));       // bucle de reconexión de app.js
  function arrancar() { c2.conectar(); }
  arrancar();
  setTimeout(() => c2.cerrar(), 10);                    // ← login rechazado en el primer intento
  setTimeout(() => {
    console.log(`  sockets creados en 1.0 s tras un login rechazado: ${sockets}`);
    console.log(`  ${sockets > 40 ? '← MULTIPLICACIÓN: el doble "cerrar" engendra cadenas paralelas que se dupliquen en cada ciclo' : 'sin multiplicación'}`);
    global.WebSocket = realWS;
    process.exit(0);
  }, 1000);
})();
