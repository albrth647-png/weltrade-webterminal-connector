#!/usr/bin/env node
// Quita del estado guardado las velas H1 corruptas (bug de respuestas cruzadas
// del cliente MT5: la respuesta de un símbolo se repartía a todas las peticiones).
// El H1 guardado no cuadra con las M30 de su misma hora, así que no sirve para
// dibujar ni para señales; al borrarlo, el motor lo vuelve a pedir limpio al arrancar.
//
//   node limpiar_h1.js         -> enseña qué borraría (no toca nada)
//   node limpiar_h1.js --si    -> copia de seguridad y borra
//
// Con el motor encendido NO se ejecuta: al salir reescribe .estado.json y
// volvería a meter el H1 corrupto que tiene en memoria.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ARCHIVO = path.join(__dirname, '.estado.json');

if (!fs.existsSync(ARCHIVO)) {
  console.error('no existe', ARCHIVO);
  process.exit(1);
}

try {
  const vivo = execSync("ps -eo pid,args | grep '[n]ode app.js'", { encoding: 'utf8' }).trim();
  if (vivo) {
    console.error('Para el motor primero (Ctrl+C en su terminal).');
    console.error('Con el motor encendido, al salir reescribiría .estado.json con el H1 corrupto.\n');
    console.error('Proceso vivo: ' + vivo);
    process.exit(2);
  }
} catch (e) {
  // grep sin coincidencias: no hay motor encendido, seguimos
}

const db = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8'));
const simbolos = db.simbodo || db.simbolo || {};
const borrar = [];

for (const [simbolo, datos] of Object.entries(simbolos)) {
  if (!datos || typeof datos !== 'object') continue;
  for (const [clave, valor] of Object.entries(datos)) {
    if (/h1/i.test(clave)) {
      const n = Array.isArray(valor) ? valor.length : 1;
      borrar.push({ ruta: simbolo + '.' + clave, n });
    }
  }
  if (datos.velas && typeof datos.velas === 'object') {
    for (const clave of Object.keys(datos.velas)) {
      if (/^h1$/i.test(clave)) {
        borrar.push({ ruta: simbolo + '.velas.' + clave, n: datos.velas[clave].length });
      }
    }
  }
}

if (!borrar.length) {
  console.log('No hay nada con H1 en el estado guardado.');
  process.exit(0);
}

console.log('Borraría:');
let total = 0;
for (const b of borrar) {
  total += b.n;
  console.log('  - ' + b.ruta + '  (' + b.n + ' elementos)');
}
console.log('  total: ' + total + ' elementos en ' + borrar.length + ' sitios');

const sobran = Object.keys(db).filter((k) => /h1/i.test(k));
if (sobran.length) console.log('\nAviso: en la raíz hay ' + sobran.join(', ') + ' (no lo toco, no es velas)');

if (!process.argv.includes('--si')) {
  console.log('\n(simulación) añade --si para hacerlo de verdad');
  process.exit(0);
}

const sello = new Date().toISOString().replace(/[:.]/g, '-');
const copia = ARCHIVO + '.bak-' + sello;
fs.copyFileSync(ARCHIVO, copia);

for (const b of borrar) {
  const [simbolo, ...resto] = b.ruta.split('.');
  let destino = simbolos[simbolo];
  for (let i = 0; i < resto.length - 1; i++) destino = destino[resto[i]];
  delete destino[resto[resto.length - 1]];
}

fs.writeFileSync(ARCHIVO, JSON.stringify(db));
console.log('\ncopia de seguridad: ' + path.basename(copia));
console.log('hecho: H1 borrado en ' + borrar.length + ' sitios');
console.log('arranca el motor y deja que repueble H1 antes de fiarte de una raya en H1');
