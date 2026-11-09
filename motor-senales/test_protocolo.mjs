'use strict';
/* ============================================================
   TEST DEL PROTOCOLO — frames AES-CBC sintéticos → parsers reales
   ------------------------------------------------------------
   Hace permanente la verificación que la auditoría ejecutó a mano:
   1) Handshake válido  → clave de sesión de 32 B adoptada          (cmd 0)
   2) Handshake inválido → guard de 32 B: aviso + cierre, sin colgar (M3)
   3) Login rechazado   → evento 'login_rechazado' + cierre         (M4)
   4) Catálogo          → nombre UTF-16 + id leídos (registro 526 B)(cmd 6)
   5) Ticks             → bid/ask exactos, registro corrupto ignorado(cmd 8)
   6) Velas             → parser 48 B: 1 válida + 1 corrupta        (cmd 11)
   7) Paridad Node ↔ PWA: mismos frames, mismos eventos, campo a campo
   8) Constantes del protocolo idénticas en los 3 clientes (anti B2)
   9) B1: la PWA calcula la huella SHA-1 en UTF-8 (igual que Node)
   SIN red y SIN credenciales: todo se inyecta por _onMensaje().
   Ejecutar:  node test_protocolo.mjs
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ClienteMT5 } from './cliente_mt5.js';
import { ClienteMT5Web } from '../pwa/proto.js';
import { Estrategia as EstrategiaPWA } from '../pwa/motor.js';
import { formatearSenal as formatearPWA } from '../pwa/motor.js';
import { Estrategia as EstrategiaNodo } from './estrategia.js';
import { formatearSenal as formatearNodo } from './telegram.js';
import { validarDoc, docACfg } from './doc_estrategia.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
let ok = 0, mal = 0;
const check = (nombre, cond, extra = '') => {
  if (cond) { ok++; console.log(`  ✓ ${nombre}`); }
  else { mal++; console.error(`  ✗ ${nombre}${extra ? ' — ' + extra : ''}`); }
};
const espera = (ms = 25) => new Promise((r) => setTimeout(r, ms));

/* ---------- cripto del test (reimplementada, independiente) ---------- */
const OBF = '13ef13b2b76dd8:5795gdcfb2fdc1ge85bf768f54773d22fff996e3ge75g5:75';
const deobf = (e) => e.split('').map((ch) => ch.charCodeAt(0) === 28 ? '&' : ch.charCodeAt(0) === 23 ? '!' : String.fromCharCode(ch.charCodeAt(0) - 1)).join('');
const CLAVE_ESTATICA = Buffer.from((deobf(OBF).match(/../g) || []).map((x) => parseInt(x, 16)));
const CLAVE_SESION = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff));

const packet = (cmd, dd, cuerpo) => {
  const p = Buffer.alloc(5 + cuerpo.length);
  p[0] = 0x12; p[1] = 0x34;               // 2 bytes aleatorios cualesquiera
  p.writeUInt16LE(cmd, 2);
  p[4] = dd;
  Buffer.from(cuerpo).copy(p, 5);
  return p;
};
const frame = (paquete, clave = CLAVE_ESTATICA) => {
  const c = crypto.createCipheriv('aes-256-cbc', clave, Buffer.alloc(16));
  const cif = Buffer.concat([c.update(paquete), c.final()]);
  const f = Buffer.alloc(8 + cif.length);
  f.writeUInt32LE(cif.length, 0); f.writeUInt32LE(1, 4);
  cif.copy(f, 8);
  return f;
};

/* ---------- 1+2. handshake válido e inválido ---------- */
async function testHandshake() {
  console.log('— handshake (cmd 0) y guard de clave de 32 B (M3) —');

  const nodo = new ClienteMT5({ login: '12345678', pass: 'x', host: 'mt5.demo.weltrade.org' });
  nodo.etapa = 'handshake';
  const cuerpo = Buffer.concat([Buffer.alloc(66), CLAVE_SESION]);
  nodo._onMensaje(frame(packet(0, 0, cuerpo)));
  check('Node: clave de sesión adoptada', nodo.clave.equals(CLAVE_SESION));
  check('Node: etapa login', nodo.etapa === 'login');

  const pwa = new ClienteMT5Web({ login: '12345678', pass: 'x', host: 'mt5.demo.weltrade.org' });
  pwa.etapa = 'handshake';
  await pwa._onMensaje(new Uint8Array(frame(packet(0, 0, cuerpo))));
  await espera();
  check('PWA: clave de sesión adoptada', pwa.clave.length === 32 && pwa.clave.every((b, i) => b === CLAVE_SESION[i]));
  check('PWA: etapa login', pwa.etapa === 'login');

  // inválido: solo 10 B tras el offset 66 → el guard debe cortar con aviso y cierre
  // (instancias NUEVAS: la clave debe seguir siendo la estática para que el frame se descifre)
  for (const [nombre, fabricar] of [['Node', () => new ClienteMT5({})], ['PWA', () => new ClienteMT5Web({})]]) {
    const cliente = fabricar();
    const avisos = [], cierres = [];
    cliente.on('aviso', (m) => avisos.push(m));
    cliente.on('cerrar', () => cierres.push(1));
    cliente.etapa = 'handshake';
    const corto = Buffer.concat([Buffer.alloc(66), Buffer.alloc(10)]);
    await cliente._onMensaje(new Uint8Array(frame(packet(0, 0, corto))));
    await espera();
    check(`${nombre}: handshake inválido → aviso "handshake inválido"`, avisos.some((m) => String(m).includes('handshake inválido')), JSON.stringify(avisos));
    check(`${nombre}: handshake inválido → sesión cerrada`, cierres.length === 1);
    check(`${nombre}: handshake inválido → etapa 'apagado'`, cliente.etapa === 'apagado');
  }
}

/* ---------- 3. login rechazado → evento terminal (M4) ---------- */
async function testLoginRechazado() {
  console.log('— login rechazado (cmd 28, dd≠0) —');
  for (const [nombre, cliente] of [['Node', new ClienteMT5({})], ['PWA', new ClienteMT5Web({})]]) {
    const rechazos = [], cierres = [];
    cliente.on('login_rechazado', (ev) => rechazos.push(ev));
    cliente.on('cerrar', () => cierres.push(1));
    cliente.etapa = 'login';
    await cliente._onMensaje(new Uint8Array(frame(packet(28, 5, Buffer.alloc(16)))));
    await espera();
    check(`${nombre}: emite login_rechazado con dd`, rechazos.length === 1 && rechazos[0].dd === 5, JSON.stringify(rechazos));
    check(`${nombre}: cierra la sesión tras el rechazo`, cierres.length === 1);
    check(`${nombre}: etapa 'apagado'`, cliente.etapa === 'apagado');
  }
}

/* ---------- 4+5. catálogo (cmd 6) y ticks (cmd 8) con paridad ---------- */
async function testCatalogoYTicks() {
  console.log('— catálogo (cmd 6) y ticks (cmd 8), paridad Node↔PWA —');
  const cuerpo = Buffer.alloc(4 + 526);
  cuerpo.writeUInt32LE(1, 0);
  Buffer.from('FX Vol 75', 'utf16le').copy(cuerpo, 4);
  cuerpo.writeUInt32LE(202, 4 + 196);

  const nodo = new ClienteMT5({});
  const pwa = new ClienteMT5Web({});
  const ticksNodo = [], ticksPwa = [], listosNodo = [], listosPwa = [];
  nodo.on('tick', (t) => ticksNodo.push(t)); nodo.on('listo', (e) => listosNodo.push(e));
  pwa.on('tick', (t) => ticksPwa.push(t)); pwa.on('listo', (e) => listosPwa.push(e));

  for (const c of [nodo, pwa]) c.etapa = 'catalogo';
  nodo._onMensaje(frame(packet(6, 0, cuerpo)));
  await pwa._onMensaje(new Uint8Array(frame(packet(6, 0, cuerpo))));
  await espera();

  check('Node: catálogo → nombre+id', nodo.nombres[202] === 'FX Vol 75');
  check('PWA: catálogo → nombre+id', pwa.nombres[202] === 'FX Vol 75' && pwa.ids['FX Vol 75'] === 202);
  check('Node: emite listo con símbolos', listosNodo.length === 1 && listosNodo[0].simbolos[0] === 'FX Vol 75');
  check('PWA: emite listo con símbolos', listosPwa.length === 1 && listosPwa[0].simbolos[0] === 'FX Vol 75');

  // 2 registros de 50 B: uno válido y otro con bid/ask en 0 (debe ignorarse)
  const ticks = Buffer.alloc(100);
  ticks.writeUInt32LE(202, 0);
  ticks.writeDoubleLE(11458457, 0 + 12);   // /100 → 114584.57
  ticks.writeDoubleLE(11458865, 0 + 20);   // /100 → 114588.65
  ticks.writeUInt32LE(999, 50);            // registro inválido: bid/ask 0
  for (const c of [nodo, pwa]) c.etapa = 'listo';
  nodo._onMensaje(frame(packet(8, 0, ticks)));
  await pwa._onMensaje(new Uint8Array(frame(packet(8, 0, ticks))));
  await espera();

  const esperado = { simbolo: 'FX Vol 75', bid: 114584.57, ask: 114588.65 };
  check('Node: 1 tick válido (el corrupto se ignora)', ticksNodo.length === 1, JSON.stringify(ticksNodo));
  check('Node: valores exactos', ticksNodo[0].simbolo === esperado.simbolo && ticksNodo[0].bid === esperado.bid && ticksNodo[0].ask === esperado.ask);
  check('PWA: 1 tick válido (el corrupto se ignora)', ticksPwa.length === 1, JSON.stringify(ticksPwa));
  check('PWA: valores exactos', ticksPwa[0].simbolo === esperado.simbolo && ticksPwa[0].bid === esperado.bid && ticksPwa[0].ask === esperado.ask);
  check('Paridad tick Node↔PWA (sin t, que es Date.now())',
    ticksNodo[0].simbolo === ticksPwa[0].simbolo && ticksNodo[0].bid === ticksPwa[0].bid && ticksNodo[0].ask === ticksPwa[0].ask);
}

/* ---------- 6. parser de velas (cmd 11) ---------- */
async function testVelas() {
  console.log('— parser de velas (registros de 48 B) —');
  const b = Buffer.alloc(96);
  b.writeUInt32LE(1700000000, 0);
  b.writeDoubleLE(100.5, 4); b.writeDoubleLE(112.25, 12); b.writeDoubleLE(98.75, 20); b.writeDoubleLE(110.1, 28);
  b.writeUInt32LE(123, 36); b.writeUInt32LE(0, 40);
  // registro corrupto: h < l
  b.writeUInt32LE(1700000300, 48);
  b.writeDoubleLE(100, 52); b.writeDoubleLE(90, 60); b.writeDoubleLE(95, 68); b.writeDoubleLE(99, 76);

  const nodo = new ClienteMT5({});
  const pwa = new ClienteMT5Web({});
  const rN = nodo._parseVelas(b);
  const rP = pwa._parseVelas(new Uint8Array(b));
  check('Node: 1 vela válida + 1 descartada', rN.velas.length === 1 && rN.descartadas === 1, JSON.stringify(rN));
  check('PWA: 1 vela válida + 1 descartada', rP.velas.length === 1 && rP.descartadas === 1, JSON.stringify(rP));
  const v = rN.velas[0];
  check('Node: valores exactos', v.t === 1700000000000 && v.o === 100.5 && v.h === 112.25 && v.l === 98.75 && v.c === 110.1);
  check('Paridad vela Node↔PWA', JSON.stringify(rN) === JSON.stringify(rP));
}

/* ---------- 8+9. constantes cruzadas y huella UTF-8 ---------- */
function testConstantes() {
  console.log('— constantes idénticas en los 3 clientes (anti-divergencia B2) y B1 —');
  const leer = (rel) => fs.readFileSync(path.join(AQUI, rel), 'utf8');
  const conector = leer('../conector/conector.js');
  const nodoCli = leer('./cliente_mt5.js');
  const pwa = leer('../pwa/proto.js');

  const enLos3 = (frag, que) => {
    check(`constante "${que}" en conector.js`, conector.includes(frag));
    check(`constante "${que}" en cliente_mt5.js`, nodoCli.includes(frag));
    check(`constante "${que}" en proto.js (PWA)`, pwa.includes(frag));
  };
  enLos3(OBF, 'clave ofuscada OBF');
  enLos3('912', 'cuerpo de login 912 B');
  enLos3('526', 'registro de catálogo 526 B');
  enLos3('(66, 98)', 'offset de clave de sesión 66..98');
  enLos3('+ 50 <=', 'registro de tick 50 B');

  check('offset de velas 48 B en cliente_mt5.js', nodoCli.includes('+ 48 <='));
  check('offset de velas 48 B en proto.js', pwa.includes('+ 48 <='));
  check('periodo H1 0x4001 en cliente_mt5.js', nodoCli.includes('0x4001'));
  check('periodo H1 0x4001 en proto.js', pwa.includes('0x4001'));

  check('B1: PWA ya NO calcula la huella en UTF-16LE', !pwa.includes("digest('SHA-1', utf16le("));
  check('B1: PWA calcula la huella en UTF-8 (TextEncoder)', pwa.includes("new TextEncoder().encode(`termux;"));
}

/* ---------- 10. cerrar() idempotente (anti doble reconexión) ---------- */
async function testCerrarIdempotente() {
  console.log('— cerrar() triple → UN solo evento (anti bucle de reconexiones) —');
  for (const [nombre, fabricar] of [['Node', () => new ClienteMT5({})], ['PWA', () => new ClienteMT5Web({})]]) {
    const cliente = fabricar();
    const cierres = [];
    cliente.on('cerrar', () => cierres.push(1));
    cliente._cerrar();       // muerte de red
    cliente.cerrar();        // cierre explícito (conectarInternal/desconectar)
    cliente._cerrar();       // onclose tardío
    await espera();
    check(`${nombre}: 3 vías de cierre → 1 solo evento 'cerrar'`, cierres.length === 1, `obtuvo ${cierres.length}`);
    check(`${nombre}: etapa 'apagado'`, cliente.etapa === 'apagado');
    // una sesión nueva reanuda el guard (conectar() hace this._cerrada = false;
    // aquí se simula SIN abrir socket real: el test es 100 % offline)
    cliente._cerrada = false;
    cliente._cerrar();
    await espera();
    check(`${nombre}: sesión nueva emite su propio 'cerrar'`, cierres.length === 2);
  }
}

/* ---------- 11. setHistoria descarta la vela EN FORMACIÓN ---------- */
async function testVelaFormandose() {
  console.log('— setHistoria: la vela en formación del servidor NO entra al búfer —');
  const ahora = Date.now();
  const cerrada = { t: ahora - 900e3 - 5000, o: 100, h: 101, l: 99, c: 100.5 };   // M15 ya cerrada
  const formandose = { t: ahora - 5000, o: 100.5, h: 100.9, l: 100.1, c: 100.7 }; // aún viva (t+15min > ahora)

  const pwa = new EstrategiaPWA({ scoreMin: 60 });
  pwa.setHistoria('FX Vol 20', 'M15', [cerrada, formandose]);
  const bufPwa = pwa.s.get('FX Vol 20').velas.M15;
  check('PWA: búfer sin la vela en formación', bufPwa.length === 1 && bufPwa[0].t === cerrada.t, JSON.stringify(bufPwa));

  const vDoc = validarDoc(JSON.parse(fs.readFileSync(path.join(AQUI, 'estrategias', 'raptor_default.json'), 'utf8')));
  const nodo = new EstrategiaNodo(docACfg(vDoc.doc));
  nodo.setHistoria('FX Vol 20', 'M15', [cerrada, formandose]);
  const bufNodo = nodo.s.get('FX Vol 20').velas.M15;
  check('Node: búfer sin la vela en formación', bufNodo.length === 1 && bufNodo[0].t === cerrada.t, JSON.stringify(bufNodo));

  // historia() accesible para re-sembrado incremental (Node) y panel (PWA)
  check('PWA: historia() devuelve el búfer', pwa.historia('FX Vol 20').M15.length === 1);
  check('Node: historia() devuelve el búfer', nodo.historia('FX Vol 20').M15.length === 1);
  check('PWA: zonasDe()/velaActual() para el panel canvas', Array.isArray(pwa.zonasDe('FX Vol 20')) && pwa.velaActual('FX Vol 20', 'M15') === null);

  // el cierre real posterior ya NO lo bloquea la vela congelada (el bug M-original)
  pwa.onVelaCerrada('FX Vol 20', 'M15', { t: ahora - 5000, o: 100.5, h: 101.2, l: 100.4, c: 101.0 });
  check('PWA: el cierre real de esa vela SÍ entra tras la siembra', pwa.s.get('FX Vol 20').velas.M15.length === 2);
}

/* ---------- 12. formatearSenal: escape HTML + hora ---------- */
async function testTelegramFormato() {
  console.log('— formatearSenal: formato de señal y escape HTML —');
  const s = {
    lado: 'COMPRA', simbolo: 'FX Vol <20>', fase: 'MAIN', sesgo: 'alza',
    tfZona: 'M15', tfGatillo: 'M5', nivel: 98.6, precio: 98.9, sl: 97.4, tp: 101.1,
    score: 75, estrategia: 'Raptor-propio v1',
    motivo: 'MAIN en soporte (fuerza 2) & retest', t: Date.UTC(2026, 0, 2, 3, 4, 0),
  };
  const msg = formatearNodo(s);
  const l = msg.split('\n');
  check('Node: cabecera con COMPRA', /🟢 <b>COMPRA<\/b>/.test(l[0]), l[0]);
  check('Node: 1 es el activo', /^<b>1\. Activo:<\/b> FX Vol &lt;20&gt;$/.test(l[1]), l[1]);
  check('Node: 2 es la temporalidad', /^<b>2\. Temporalidad:<\/b> M15 · entrada M5$/.test(l[2]), l[2]);
  check('Node: 3 es la estrategia', /^<b>3\. Estrategia:<\/b> Raptor-propio v1$/.test(l[3]), l[3]);
  check('Node: 4 es el precio entrada', /^<b>4\. Precio entrada:<\/b> 98\.9 \(vela cerrada\)$/.test(l[4]), l[4]);
  check('Node: 5 es la hora UTC', /^<b>5\. Hora:<\/b> 2026-01-02 03:04 UTC$/.test(l[5]), l[5]);
  check('Node: sin SL/TP (5 campos + cabecera)', l.length === 6 && !/(?:SL|TP):/.test(msg), `lineas=${l.length}`);
  check('Node: código de patrón delante del nombre',
    formatearNodo({ ...s, patron: '2R' }).split('\n')[3] === '<b>3. Estrategia:</b> 2R · Raptor-propio v1');
  check('Node: símbolo con < > escapado', !msg.includes('FX Vol <20>'));
  check('Node: VENTA usa icono rojo', formatearNodo({ ...s, lado: 'VENTA' }).startsWith('🔴 <b>VENTA</b>'));
  check('Node: sin estrategia cae a un nombre por defecto',
    formatearNodo({ ...s, estrategia: undefined }).split('\n')[3] === '<b>3. Estrategia:</b> Raptor');
  /* la PWA conserva su formato anterior */
  const p = formatearPWA(s);
  check('PWA: símbolo con < > escapado', p.includes('FX Vol &lt;20&gt;') && !p.includes('FX Vol <20>'));
  check('PWA: & escapado', p.includes('fuerza 2) &amp; retest'));
  check('PWA: incluye hora UTC', /Hora: \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/.test(p));
  check('PWA: sin SL/TP', !/(?:SL|TP):/.test(p));
}

/* ---------- 13. cmd 11: un lote no puede cruzar de símbolo ---------- */
async function testCruceVelas() {
  console.log('— cmd 11: el lote va SOLO al pedido en curso (símbolos sin cruzar) —');
  const cliente = new ClienteMT5({});
  cliente.etapa = 'listo';
  cliente.nombres = { 1: 'FX Vol 20', 2: 'SFX Vol 20' };
  cliente.ids = { 'FX Vol 20': 1, 'SFX Vol 20': 2 };
  cliente._enviarPacket = () => { };                       // sin socket: test offline
  cliente._ultimoPrecio = { 'FX Vol 20': 118000, 'SFX Vol 20': 35300 };

  const recibido = {};
  const t1 = setTimeout(() => { }, 4000);
  const t2 = setTimeout(() => { }, 4000);
  cliente._pendientes11.set('SFX Vol 20', { resolver: (r) => { recibido['SFX Vol 20'] = r; }, timer: t1 });
  cliente._pendientes11.set('FX Vol 20', { resolver: (r) => { recibido['FX Vol 20'] = r; }, timer: t2 });
  cliente._pendiente11Actual = 'SFX Vol 20';

  const cuerpo = Buffer.alloc(48);
  cuerpo.writeUInt32LE(1700000000, 0);
  cuerpo.writeDoubleLE(35290, 4); cuerpo.writeDoubleLE(35310, 12);
  cuerpo.writeDoubleLE(35280, 20); cuerpo.writeDoubleLE(35300, 28);
  cliente._onMensaje(frame(packet(11, 0, cuerpo)));
  await espera(800);

  const nSfx = (recibido['SFX Vol 20']?.velas || []).length;
  check('el lote llega solo al símbolo pedido', nSfx === 1 && !recibido['FX Vol 20'],
    `SFX=${nSfx} FX=${(recibido['FX Vol 20']?.velas || []).length}`);

  cliente._onMensaje(frame(packet(11, 0, cuerpo)));
  await espera(100);
  check('un trozo tardío no se pega al símbolo siguiente', !recibido['FX Vol 20']);

  check('un lote con precio de otro activo se descarta',
    cliente._loteValido('FX Vol 20', [{ c: 35300 }], 0).velas.length === 0);
  check('un lote con el precio del propio activo se acepta',
    cliente._loteValido('FX Vol 20', [{ c: 118100 }], 0).velas.length === 1);

  clearTimeout(t1); clearTimeout(t2);
  cliente._pendientes11.clear();
  cliente._pendiente11Actual = null;
}

/* ---------- ejecución ---------- */
try {
  await testHandshake();
  await testLoginRechazado();
  await testCatalogoYTicks();
  await testVelas();
  testConstantes();
  await testCerrarIdempotente();
  await testVelaFormandose();
  await testTelegramFormato();
  await testCruceVelas();
} catch (e) {
  mal++;
  console.error('✗ excepción en el test:', e);
}
console.log(`\nresultado: ${ok} OK, ${mal} FALLOS`);
process.exitCode = mal ? 1 : 0;
