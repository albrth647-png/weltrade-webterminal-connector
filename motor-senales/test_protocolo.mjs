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

/* ---------- ejecución ---------- */
try {
  await testHandshake();
  await testLoginRechazado();
  await testCatalogoYTicks();
  await testVelas();
  testConstantes();
} catch (e) {
  mal++;
  console.error('✗ excepción en el test:', e);
}
console.log(`\nresultado: ${ok} OK, ${mal} FALLOS`);
process.exitCode = mal ? 1 : 0;
