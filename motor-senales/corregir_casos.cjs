'use strict';
/* ============================================================
   Corrige la etiqueta de símbolo de los casos guardados.
   ------------------------------------------------------------
   Motivo: la respuesta de cmd 11 no identifica el instrumento. Al sembrar,
   sin precio vivo, cada símbolo aceptó el lote del anterior, así que los
   21 casos quedaron etiquetados con el activo equivocado.

   Método: para la marca de tiempo del caso se busca la vela de cada serie
   verificada y se elige la que coincide con el precio guardado. Si ninguna
   coincide, el caso se marca como 'desconocido' en vez de inventar.
   ============================================================ */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const CASOS = path.join(DIR, 'datos', 'casos.jsonl');
const ESTADO = path.join(DIR, '.estado.json');
const TOL = 0.02; // 2 % de tolerancia entre el precio del caso y el cierre de la vela

const series = {}; // simbolo -> Map(t -> close)
const estado = JSON.parse(fs.readFileSync(ESTADO, 'utf8'));
for (const [sim, v] of Object.entries(estado.simbodo || {})) {
  const velas = (v.velas && v.velas.M5) || [];
  if (!velas.length) continue;
  series[sim] = new Map(velas.map((k) => [k.t, k.c]));
}

const casos = fs.readFileSync(CASOS, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const cambios = [];

for (const c of casos) {
  const m = c.mercado || {};
  const t = Number(m.t);
  const precio = Number(m.precio);
  if (!Number.isFinite(t) || !Number.isFinite(precio) || precio <= 0) {
    cambios.push(`${c.id}: sin mercado.t/precio, no se puede verificar`);
    continue;
  }

  let mejor = null;
  for (const [sim, mapa] of Object.entries(series)) {
    const cierre = mapa.get(t);
    if (!cierre) continue;
    const desv = Math.abs(cierre - precio) / cierre;
    if (!mejor || desv < mejor.desv) mejor = { sim, desv, cierre };
  }

  if (!mejor) {
    cambios.push(`${c.id}: ninguna serie tiene la vela ${new Date(t).toISOString()} — sin cambios`);
    continue;
  }

  const anterior = m.simbolo || '(sin campo)';
  if (mejor.desv <= TOL) {
    if (anterior !== mejor.sim) {
      m.simbolo = mejor.sim;
      m.simboloOriginal = anterior;
      c.correccion = {
        fecha: new Date().toISOString(),
        motivo: 'cmd 11 sin identidad de símbolo: el caso pertenece a otra serie',
        antes: anterior,
        despues: mejor.sim,
        desvio: Number((mejor.desv * 100).toFixed(3)),
      };
      // Reetiquetar la id de referencia para que no contradiga al símbolo.
      if (typeof c.id === 'string' && c.id.startsWith('ref-m5-')) {
        const resto = c.id.slice('ref-m5-'.length);
        const guion = resto.lastIndexOf('-');
        if (guion > 0) {
          const tallo = resto.slice(guion + 1);
          const sim = c.mercado.simbolo.toLowerCase().replace(/[^a-z0-9]+/g, '');
          const nueva = `ref-m5-${sim}-${tallo}`;
          cambios.push(`${c.id} -> ${nueva} (${anterior} -> ${mejor.sim}, desvío ${(mejor.desv * 100).toFixed(2)}%)`);
          c.id = nueva;
        }
      } else {
        cambios.push(`${c.id}: ${anterior} -> ${mejor.sim} (desvío ${(mejor.desv * 100).toFixed(2)}%)`);
      }
    }
  } else {
    m.simbolo = 'desconocido';
    m.simboloOriginal = anterior;
    c.correccion = {
      fecha: new Date().toISOString(),
      motivo: 'ninguna serie verificada coincide con el precio guardado',
      antes: anterior,
      despues: 'desconocido',
      desvio: Number((mejor.desv * 100).toFixed(3)),
    };
    cambios.push(`${c.id}: ${anterior} -> DESCONOCIDO (mejor ${mejor.sim} con desvío ${(mejor.desv * 100).toFixed(1)}%)`);
  }
}

const bk = CASOS.replace(/\.jsonl$/, `.jsonl.bak-${Date.now()}`);
fs.copyFileSync(CASOS, bk);
fs.writeFileSync(CASOS, casos.map((c) => JSON.stringify(c)).join('\n') + '\n');

console.log(`backup: ${path.basename(bk)}`);
console.log(`casos: ${casos.length} · cambios: ${cambios.length}`);
for (const x of cambios) console.log('  ' + x);

const conteo = {};
for (const c of casos) conteo[(c.mercado || {}).simbolo] = (conteo[(c.mercado || {}).simbolo] || 0) + 1;
console.log('reparto final:', conteo);
