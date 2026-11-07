'use strict';
/* Ronda 3: simulación con WebSocket falso de la tormenta de reconexión
   (doble emisión de "cerrar" + multiplicación de cadenas al estilo app.js) */
const path = require('path');
const REPO = '/home/z/my-project/weltrade-webterminal-connector';
const { ClienteMT5 } = require(path.join(REPO, 'motor-senales/cliente_mt5.js'));

/* WebSocket falso: conecta, y muere de red a los 60 ms (como Weltrade móvil) */
let socketsCreados = 0;
class FakeWS {
  constructor() {
    socketsCreados++;
    this.readyState = 0;
    this.sent = [];
    setTimeout(() => { this.readyState = 1; this.onopen && this.onopen(); }, 5);
    setTimeout(() => { this.readyState = 3; this.onclose && this.onclose(); }, 60); // caída de red
  }
  close() { this.readyState = 3; setTimeout(() => this.onclose && this.onclose(), 5); }
  send(b) { this.sent.push(b); }
}

/* escenario A: cerrar() manual sobre socket vivo (login rechazado) */
console.log('━━━ P4: eventos "cerrar" tras UNA llamada a cerrar() con socket vivo ━━━');
{
  const realWS = global.WebSocket;
  global.WebSocket = FakeWS;
  const c = new ClienteMT5({ login: '1', pass: 'x' });
  let emis = 0;
  c.on('cerrar', () => emis++);
  c.conectar();
  setTimeout(() => c.cerrar(), 20);     // socket vivo → como el flujo de login rechazado
  setTimeout(() => {
    console.log(`  emitidos: ${emis} ${emis > 1 ? '← BUG: el app.js agenda 2 reconexiones → 2 sesiones paralelas' : 'OK'}`);
    global.WebSocket = realWS;
    escenarioB();
  }, 120);
}

/* escenario B: réplica exacta del bucle de reconexión de motor-senales/app.js
   con red inestable (cada socket muere a los 60 ms) → ¿cuántas sesiones paralelas? */
function escenarioB() {
  console.log('\n━━━ P4b: réplica del bucle de reconexión de app.js con red caída ━━━');
  const realWS = global.WebSocket;
  global.WebSocket = FakeWS;
  const c = new ClienteMT5({ login: '1', pass: 'x' });
  // handlers idénticos a motor-senales/app.js (líneas 127-156):
  c.on('cerrar', () => { /* stats++ */ });
  c.on('cerrar', () => { setTimeout(arrancar, 5); });   // espera=5ms para acelerar
  function arrancar() { c.conectar(); }
  arrancar();
  // en 1.2 s debería haber ~1 sesión; si hay multiplicación, muchas más
  setTimeout(() => {
    console.log(`  sockets WebSocket creados en 1.2 s de red caída: ${socketsCreados}`);
    console.log(`  ${socketsCreados > 20 ? '← TORMENTA: cada ciclo MULTIPLICA las reconexiones (doble emisión de "cerrar")' : 'sin multiplicación'}`);
    global.WebSocket = realWS;
    escenarioC();
  }, 1200);
}

/* escenario C: lo mismo con la lógica de la PWA (conectarInternal cierra el cliente viejo) */
function escenarioC() {
  console.log('\n━━━ P4c: réplica de la PWA (conectarInternal cierra al cliente anterior) ━━━');
  const realWS = global.WebSocket;
  global.WebSocket = FakeWS;
  socketsCreados = 0;
  let cliente = null;
  let paradoManual = false;
  function conectarInternal() {
    if (cliente) { try { cliente.cerrar(); } catch (e) {} }   // ← la PWA hace esto
    cliente = new ClienteMT5({ login: '1', pass: 'x' });
    cliente.on('cerrar', () => {                              // handler de cablear()
      if (paradoManual) return;
      setTimeout(conectarInternal, 5);
    });
    cliente.conectar();
  }
  conectarInternal();
  setTimeout(() => {
    console.log(`  sockets creados en 1.2 s: ${socketsCreados}`);
    console.log(`  ${socketsCreados > 20 ? '← TORMENTA también en la PWA: el cierre del cliente viejo re-agenda otra cadena' : 'sin multiplicación'}`);
    global.WebSocket = realWS;
    console.log('\n═══ FIN RONDA 3 ═══');
    process.exit(0);
  }, 1200);
}
