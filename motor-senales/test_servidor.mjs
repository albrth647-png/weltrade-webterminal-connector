/* ============================================================
   Regresión HTTP del servidor: cabeceras, favicon y memoria (F1).
   ============================================================ */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { crearServidor } from './servidor.js';
import { crearAlmacen } from './memoria.js';

let ok = 0, mal = 0;
const check = (nombre, cond, extra = '') => {
  if (cond) { ok++; console.log(`  ✓ ${nombre}`); }
  else { mal++; console.error(`  ✗ ${nombre}${extra ? ' — ' + extra : ''}`); }
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srv-'));

/* --- servidor sin velas: la memoria responde vacía, no rompe --- */
const vacio = crearAlmacen({ archivo: path.join(dir, 'vacio.jsonl') });
const srv = await crearServidor(() => ({ ok: true, conexion: 'listo' }), 0, null, { memoria: vacio });
const base = `http://127.0.0.1:${srv.address().port}`;

try {
  const salud = await fetch(base + '/salud');
  check('/salud responde 200', salud.status === 200, String(salud.status));
  check('/salud es text/plain', (salud.headers.get('content-type') || '').startsWith('text/plain'));
  check('X-Content-Type-Options: nosniff', salud.headers.get('x-content-type-options') === 'nosniff');
  check('X-Frame-Options: DENY', salud.headers.get('x-frame-options') === 'DENY');
  check('CSP estricta', (salud.headers.get('content-security-policy') || '').includes("default-src 'none'"));
  check('Cache-Control: no-store', salud.headers.get('cache-control') === 'no-store');
  check('Referrer-Policy: no-referrer', salud.headers.get('referrer-policy') === 'no-referrer');

  const estado = await fetch(base + '/estado');
  check('/estado responde 200 JSON',
    estado.status === 200 && (estado.headers.get('content-type') || '').includes('application/json'));
  const j = await estado.json();
  check('/estado devuelve el estado', j.ok === true && j.conexion === 'listo');
  check('/estado también lleva cabeceras', estado.headers.get('x-content-type-options') === 'nosniff');

  const fav = await fetch(base + '/favicon.ico');
  check('favicon responde 204 (sin 404)', fav.status === 204, String(fav.status));

  const nope = await fetch(base + '/no-existe');
  check('ruta desconocida responde 404', nope.status === 404, String(nope.status));
  check('la 404 también lleva cabeceras', nope.headers.get('x-content-type-options') === 'nosniff');

  /* memoria vacía */
  const listaVacia = await fetch(base + '/casos');
  const jv = await listaVacia.json();
  check('/casos sin archivo responde 200', listaVacia.status === 200, String(listaVacia.status));
  check('/casos sin archivo devuelve total 0', jv.ok === true && jv.total === 0 && Array.isArray(jv.casos));
  check('GET /casos/<id> inexistente da 404', (await fetch(base + '/casos/c-0000-00-00-0001')).status === 404);

  const sinVelas = await fetch(base + '/marcas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ simbolo: 'FX Vol 20', tf: 'M5', linea: { type: 'trend', i1: 1, p1: 1, i2: 2, p2: 2 } }),
  });
  check('POST /marcas sin velas da 409', sinVelas.status === 409, String(sinVelas.status));
} finally {
  srv.close();
}

/* --- servidor con velas y almacén temporal --- */
function serieVelas(n) {
  const out = [];
  let precio = 100000, semilla = 987;
  const rnd = () => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla / 2147483648; };
  for (let i = 0; i < n; i++) {
    const o = precio;
    const c = precio + (rnd() - 0.45) * 30;
    out.push({
      t: 1762905600000 + i * 300000,
      o,
      c,
      h: Math.max(o, c) + rnd() * 10,
      l: Math.min(o, c) - rnd() * 10,
    });
    precio = c;
  }
  return out;
}
const velas = serieVelas(300);
const tope = Math.max(...velas.map((v) => v.h)) + 1000;
const linea = { id: 'o-http-1', type: 'trend', i1: 200, p1: tope, i2: 260, p2: tope, extendRight: true };
const alm = crearAlmacen({ archivo: path.join(dir, 'casos.jsonl') });
const srv2 = await crearServidor(
  () => ({ ok: true }),
  0,
  (s, tf) => (s === 'FX Vol 20' ? { simbodo: s, tf, velas } : null),
  { memoria: alm }
);
const base2 = `http://127.0.0.1:${srv2.address().port}`;

try {
  const alta = await fetch(base2 + '/marcas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ simbolo: 'FX Vol 20', tf: 'M5', linea, nota: 'http' }),
  });
  const ja = await alta.json();
  check('POST /marcas responde 201', alta.status === 201, String(alta.status));
  check('POST /marcas devuelve el caso', ja.ok === true && !!ja.caso && ja.caso.id);
  check('POST /marcas fija Location', alta.headers.get('location') === '/casos/' + ja.caso.id);
  check('el caso llega con huella', ja.caso.huella && ja.caso.huella.atrPct > 0);
  check('el caso cita playbook', typeof ja.caso.playbook === 'string');

  const lista = await fetch(base2 + '/casos?simbolo=FX%20Vol%2020&tf=M5');
  const jl = await lista.json();
  check('GET /casos cuenta 1', jl.total === 1 && jl.casos.length === 1);
  check('GET /casos/<id> devuelve el caso', (await (await fetch(base2 + '/casos/' + ja.caso.id)).json()).caso.id === ja.caso.id);

  const dup = await fetch(base2 + '/marcas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ simbolo: 'FX Vol 20', tf: 'M5', linea }),
  });
  check('POST /marcas duplicado da 409', dup.status === 409, String(dup.status));

  const otroSimbolo = await fetch(base2 + '/marcas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ simbolo: 'SFX Vol 20', tf: 'M5', linea }),
  });
  check('POST /marcas sin velas del símbolo da 409', otroSimbolo.status === 409, String(otroSimbolo.status));

  const sinLinea = await fetch(base2 + '/marcas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ simbolo: 'FX Vol 20', tf: 'M5' }),
  });
  check('POST /marcas sin linea da 400', sinLinea.status === 400, String(sinLinea.status));

  const jsonMalo = await fetch(base2 + '/marcas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{no es json',
  });
  check('POST /marcas con JSON inválido da 400', jsonMalo.status === 400, String(jsonMalo.status));

  check('casos.jsonl tiene una línea', fs.readFileSync(alm.archivo, 'utf8').trim().split('\n').length === 1);

  /* escáner: contexto, no avisos */
  const esc = await fetch(base2 + '/escaner?simbodo=FX%20Vol%2020');
  const je = await esc.json();
  check('GET /escaner responde 200', esc.status === 200, String(esc.status));
  check('GET /escaner devuelve matriz', je.ok === true && !!je.matriz && typeof je.matriz.score === 'number');
  check('GET /escaner evalúa las 4 TF', ['H1', 'M15', 'M5', 'M1'].every((t) => je.series && je.series[t]));
  check('GET /escaner por debajo de 50 ms', je.ms <= 50, String(je.ms));
  check('GET /escaner sin simbodo da 400', (await fetch(base2 + '/escaner')).status === 400);
  check('GET /escaner símbolo desconocido da 404', (await fetch(base2 + '/escaner?simbodo=NADA')).status === 404);

  /* sugerencia y etiquetas (F3) */
  const sugVacia = await fetch(base2 + '/sugerencias', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ simbolo: 'FX Vol 20', tf: 'M5', linea: { ...linea, id: 'o-sug' } }),
  });
  const js = await sugVacia.json();
  check('POST /sugerencias sin aprobados no sugiere', sugVacia.status === 200 && js.hay === false && js.fantasma === null);
  check('POST /sugerencias explica memoria vacía', js.motivo === 'memoria vacía', String(js.motivo));

  const patch = await fetch(base2 + '/casos/' + ja.caso.id, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ estado: 'aprobado' }),
  });
  const jp = await patch.json();
  check('PATCH /casos/:id aprueba', patch.status === 200 && jp.caso.etiqueta.estado === 'aprobado', String(patch.status));
  check('PATCH /casos/:id inválido da 422', (await fetch(base2 + '/casos/' + ja.caso.id, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ estado: 'inventado' }),
  })).status === 422);
  check('PATCH /casos/:id inexistente da 404', (await fetch(base2 + '/casos/c-0000-00-00-0000', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ estado: 'aprobado' }),
  })).status === 404);

  const sugUno = await (await fetch(base2 + '/sugerencias', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ simbolo: 'FX Vol 20', tf: 'M5', linea: { ...linea, id: 'o-sug' } }),
  })).json();
  check('con 1 aprobado todavía no hay base', sugUno.hay === false && /faltan/.test(sugUno.motivo || ''), String(sugUno.motivo));
} finally {
  srv2.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\nresultado: ${ok} OK / ${mal} fallos`);
process.exit(mal ? 1 : 0);
