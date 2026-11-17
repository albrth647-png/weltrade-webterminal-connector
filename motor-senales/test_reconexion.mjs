/* ============================================================
   Regresión de reconexión: el bug que provocaba el bucle era que
   el onclose de un socket viejo llamaba a _cerrar() y mataba la
   sesión nueva. Aquí se simula con un WebSocket falso.
   ============================================================ */
import { ClienteMT5 } from './cliente_mt5.js';

let ok = 0, mal = 0;
const check = (nombre, cond, extra = '') => {
  if (cond) { ok++; console.log(`  ✓ ${nombre}`); }
  else { mal++; console.error(`  ✗ ${nombre}${extra ? ' — ' + extra : ''}`); }
};

class FakeWS {
  static instancias = [];
  constructor(url) {
    this.url = url;
    this.readyState = 1;
    this.binaryType = '';
    this.closed = false;
    this.enviados = [];
    FakeWS.instancias.push(this);
  }
  send(d) { this.enviados.push(d); }
  close() { this.closed = true; this.readyState = 3; }
}

const RealWS = globalThis.WebSocket;
globalThis.WebSocket = FakeWS;
try {
  const cliente = new ClienteMT5({ login: 'demo', pass: 'demo', host: 'demo.local' });
  const cierres = [];
  cliente.on('cerrar', () => cierres.push(1));

  cliente.conectar();
  const viejo = FakeWS.instancias[0];
  cliente.conectar();
  const nuevo = FakeWS.instancias[1];

  check('reconectar cierra el socket anterior', viejo.closed === true);
  check('el socket actual es el nuevo', cliente.ws === nuevo);
  check('solo se crean dos sockets', FakeWS.instancias.length === 2);

  viejo.onclose({ code: 1006 });
  check('un cierre tardío del socket viejo no tumba la sesión nueva',
    cierres.length === 0 && cliente.etapa === 'conectando',
    `cierres=${cierres.length} etapa=${cliente.etapa}`);

  nuevo.onclose({ code: 1000 });
  check('el cierre del socket actual sí dispara reconexión', cierres.length === 1, `cierres=${cierres.length}`);
  check('tras cerrar, la etapa es apagado', cliente.etapa === 'apagado');

  cliente.cerrar();
  check('un cierre explícito posterior no duplica el evento', cierres.length === 1, `cierres=${cierres.length}`);
} finally {
  globalThis.WebSocket = RealWS;
}

console.log(`\nresultado: ${ok} OK / ${mal} fallos`);
process.exit(mal ? 1 : 0);
