/* Muestreador del precio VIVO del terminal (el que usa el motor) para
   compararlo con una captura de MT5 del teléfono.

   Uso:  node reloj_vivo.mjs [segundos]
   Escribe datos/reloj_vivo.csv:  habana,utc,vivo,fx20,sfx20,fx40,sfx40
   Cada línea es un instante; con la hora del teléfono se busca la línea
   correspondiente y se ve si el terminal cotiza lo mismo.

   El precio "vivo" sale de /estado (media bid/ask del último tick del
   terminal). No abre sesión nueva: no tumba la del motor. */

import fs from 'node:fs';
import path from 'node:path';

const SEG = Math.max(10, Number(process.argv[2] || 600));
const PUERTO = Number(process.env.PORT || 3000);
const SALIDA = path.join(path.dirname(new URL(import.meta.url).pathname), 'datos', 'reloj_vivo.csv');

const habana = (d) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Havana', hour12: false,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
}).format(d).replace(',', '');

const linea = (j, d) => {
  const g = (s) => {
    const p = j.simbolos && j.simbolos[s] && j.simbolos[s].vivo;
    return Number.isFinite(p) ? p.toFixed(2) : '';
  };
  return [habana(d), d.toISOString().slice(0, 19) + 'Z',
    g('FX Vol 20'), g('SFX Vol 20'), g('FX Vol 40'), g('SFX Vol 40')].join(',');
};

if (!fs.existsSync(SALIDA)) {
  fs.writeFileSync(SALIDA, 'habana,utc,fx20,sfx20,fx40,sfx40\n');
}

const t0 = Date.now();
const iv = setInterval(async () => {
  const d = new Date();
  try {
    const r = await fetch(`http://127.0.0.1:${PUERTO}/estado`);
    const j = await r.json();
    const l = linea(j, d);
    fs.appendFileSync(SALIDA, l + '\n');
    console.log(l);
  } catch (e) {
    fs.appendFileSync(SALIDA, `${habana(d)},${d.toISOString()},sin /estado (${e.message})\n`);
  }
  if (Date.now() - t0 > SEG * 1000) {
    clearInterval(iv);
    console.log(`fin: ${SALIDA}`);
    process.exit(0);
  }
}, 1000);
