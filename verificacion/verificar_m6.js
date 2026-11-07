'use strict';
/* Verificación funcional del M6: ESTADO_TOKEN en servidor.js
   Arranca el servidor con token y comprueba:
   - /estado sin token            → 401
   - /estado con token malo       → 401
   - /estado con token por query  → 200
   - /estado con token por header → 200
   - /salud sin token             → 200 (queda abierto para pingers)
   - POST /estrategia/validar sin token → 401 (mutaciones protegidas) */
process.env.ESTADO_TOKEN = 'secreto-demo';
const { crearServidor } = require('/home/z/my-project/weltrade-webterminal-connector/motor-senales/servidor.js');

const getEstado = () => ({ ok: true, prueba: 'm6' });
const gestor = {
  actual: () => ({ doc: { meta: { nombre: 'x', version: 1 } }, fuente: 'prueba' }),
  validar: () => ({ ok: true, errores: [] }),
  importar: () => ({ ok: true }), activar: () => ({ ok: true }), restaurarIntegrada: () => ({ ok: true }),
};

const pedir = (ruta, cabeceras = {}, metodo = 'GET') => new Promise((resolver) => {
  const req = http.request({ host: '127.0.0.1', port: PUERTO, path: ruta, headers: cabeceras, method: metodo }, (res) => {
    let d = '';
    res.on('data', (c) => { d += c; });
    res.on('end', () => resolver({ codigo: res.statusCode, cuerpo: d }));
  });
  req.on('error', (e) => resolver({ codigo: 0, cuerpo: e.message }));
  req.end();
});
const http = require('http');
const PUERTO = 3987;

(async () => {
  await crearServidor(getEstado, gestor, PUERTO);
  let ok = 0, mal = 0;
  const check = (n, cond, extra = '') => { if (cond) { ok++; console.log(`  ✓ ${n}`); } else { mal++; console.error(`  ✗ ${n} ${extra}`); } };

  let r = await pedir('/estado');
  check('/estado sin token → 401', r.codigo === 401, `dio ${r.codigo}`);
  r = await pedir('/estado?token=malo');
  check('/estado con token malo → 401', r.codigo === 401, `dio ${r.codigo}`);
  r = await pedir('/estado?token=secreto-demo');
  check('/estado con token por query → 200', r.codigo === 200, `dio ${r.codigo}`);
  r = await pedir('/estado', { 'x-estado-token': 'secreto-demo' });
  check('/estado con token por header → 200', r.codigo === 200, `dio ${r.codigo}`);
  r = await pedir('/salud');
  check('/salud sin token → 200 (abierta para pingers)', r.codigo === 200, `dio ${r.codigo}`);
  r = await pedir('/', { });
  check('/ (panel) sin token → 200', r.codigo === 200, `dio ${r.codigo}`);
  r = await pedir('/estrategia/validar', { 'content-type': 'application/json' }, 'POST');
  check('POST validar sin token → 401', r.codigo === 401, `dio ${r.codigo}`);
  r = await pedir('/estrategia/validar?token=secreto-demo', { 'content-type': 'application/json' }, 'POST');
  check('POST validar con token → 200', r.codigo === 200, `dio ${r.codigo}`);

  console.log(`\nm6: ${ok} OK, ${mal} FALLOS`);
  process.exitCode = mal ? 1 : 0;
  process.exit(process.exitCode);
})();
