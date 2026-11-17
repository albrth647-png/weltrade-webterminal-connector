'use strict';
/* ============================================================
   CONTEO DE ESTRUCTURA — antes/después de la puerta EMA
   ------------------------------------------------------------
   No reimplementa el motor: importa escanearEstructura().
   Mide las mismas 16 series que v03-lab/evaluar.mjs.

   Uso:
     node v03-lab/estructura.mjs
     node v03-lab/estructura.mjs > v03-lab/estructura_post.json
   ============================================================ */
import { cargarSeries } from './datos.mjs';
import { escanearEstructura } from '../motor-senales/nucleo.js';

const series = await cargarSeries();
let total = 0;
const by = {};
const porTendencia = {};
const filtros = {};

for (const s of series) {
  const r = escanearEstructura(s.velas, {});
  total += r.eventos.length;
  for (const e of r.eventos) {
    by[e.patron] = (by[e.patron] || 0) + 1;
    porTendencia[e.tendencia] = (porTendencia[e.tendencia] || 0) + 1;
  }
  for (const [k, v] of Object.entries(r.filtros || {})) {
    filtros[k] = (filtros[k] || 0) + v;
  }
}

console.log(JSON.stringify({
  generado: new Date().toISOString().slice(0, 10),
  series: series.length,
  total,
  by,
  porTendencia,
  filtros,
}, null, 2));
