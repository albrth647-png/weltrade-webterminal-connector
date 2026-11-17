'use strict';
/* ============================================================
   PRUEBAS DEL LABORATORIO v03
   ------------------------------------------------------------
   Comprueba tres cosas:
     1. Los datos (16 series, orden, OHLC, sin duplicados).
     2. El motor: determinismo, códigos del vídeo, niveles y
        invalidaciones coherentes, sin eventos repetidos.
     3. El banco: el reparto train/validación es una partición y
        la simulación de R da lo que tiene que dar.

   Ejecutar:  node v03-lab/probar.mjs
   ============================================================ */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escanear } from '../motor-senales/nucleo.js';
import { cargarSeries, parseCsv, clave, SIMBOLOS, TFS } from './datos.mjs';
import { simular } from './evaluar.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SPLIT = 0.7;
const TOQUES = new Set(['2', '2R', '3', '3R']);
const ROTURAS = new Set(['1', '1R', '2B', '2RB', '3B', '3RB']);
const CATALOGO = new Set([...TOQUES, ...ROTURAS]);

let ok = 0, mal = 0;
const check = (nombre, cond, extra = '') => {
  if (cond) { ok++; console.log(`  ✓ ${nombre}`); }
  else { mal++; console.error(`  ✗ ${nombre}${extra ? ' — ' + extra : ''}`); }
};

const series = await cargarSeries({});
console.log(`\n— datos —`);
check(`hay ${SIMBOLOS.length * TFS.length} series`, series.length === SIMBOLOS.length * TFS.length, `hay ${series.length}`);
check('todas tienen >= 500 velas', series.every((s) => s.velas.length >= 500),
  series.map((s) => `${clave(s.simbolo, s.tf)}=${s.velas.length}`).join(' '));

const desordenada = series.filter((s) => s.velas.some((v, i) => i > 0 && v.t <= s.velas[i - 1].t));
check('velas ordenadas y sin duplicados', desordenada.length === 0, desordenada.map((s) => clave(s.simbolo, s.tf)).join(','));

const ohlcMal = series.filter((s) => s.velas.some((v) =>
  !(v.h >= Math.max(v.o, v.c)) || !(v.l <= Math.min(v.o, v.c)) || !(v.h >= v.l)));
check('OHLC coherente', ohlcMal.length === 0, ohlcMal.map((s) => clave(s.simbolo, s.tf)).join(','));

check('el parser rechaza un CSV sin columnas', (() => {
  try { parseCsv('a,b\n1,2'); return false; } catch (e) { return true; }
})());

console.log(`\n— motor —`);
const resultados = series.map((s) => ({ ...s, eventos: escanear(s.velas, {}).eventos }));

check('escaneo determinista', series.every((s, i) =>
  JSON.stringify(escanear(s.velas, {}).eventos) === JSON.stringify(resultados[i].eventos)));

check('solo códigos del vídeo', resultados.every((r) => r.eventos.every((e) => CATALOGO.has(e.patron))),
  [...new Set(resultados.flatMap((r) => r.eventos.map((e) => e.patron)))].filter((p) => !CATALOGO.has(p)).join(','));

check('no existe 1B', resultados.every((r) => !r.eventos.some((e) => e.patron === '1B')));

const desordenados = resultados.filter((r) => r.eventos.some((e, i) => i > 0 && e.barIndex < r.eventos[i - 1].barIndex));
check('eventos en orden de barra', desordenados.length === 0, desordenados.map((r) => clave(r.simbolo, r.tf)).join(','));

const repetidos = resultados.filter((r) => {
  const vistos = new Set();
  return r.eventos.some((e) => {
    const k = e.barIndex + '|' + e.lado;
    if (vistos.has(k)) return true;
    vistos.add(k);
    return false;
  });
});
check('nunca dos eventos en la misma vela y sentido', repetidos.length === 0,
  repetidos.map((r) => clave(r.simbolo, r.tf)).join(','));

const malPrecio = resultados.filter((r) => r.eventos.some((e) =>
  !Number.isFinite(e.precio) || e.precio <= 0 || Math.abs(e.precio - r.velas[e.barIndex].c) > 1e-9));
check('el precio de la señal es el cierre de su vela', malPrecio.length === 0,
  malPrecio.map((r) => clave(r.simbolo, r.tf)).join(','));

const malInvalidacion = resultados.filter((r) => r.eventos.some((e) => {
  if (!Number.isFinite(e.invalida)) return true;
  if (!ROTURAS.has(e.patron)) return false;   // los toques se revisan aparte
  return e.lado === 'VENTA' ? e.invalida <= e.precio : e.invalida >= e.precio;
}));
check('en las roturas la invalidación está al otro lado del precio', malInvalidacion.length === 0,
  malInvalidacion.map((r) => clave(r.simbolo, r.tf)).join(','));

/* Los toques nacen en el extremo: si la vela cierra justo en su extremo, el stop
   coincide con la entrada y la señal no es operable. Se cuenta, no se maquilla. */
const degeneradas = resultados.flatMap((r) => r.eventos.filter((e) =>
  !ROTURAS.has(e.patron) && (e.lado === 'VENTA' ? e.invalida <= e.precio : e.invalida >= e.precio)));
const totalToques = resultados.reduce((a, r) => a + r.eventos.filter((e) => !ROTURAS.has(e.patron)).length, 0);
console.log(`  · toques con stop = entrada (no operables): ${degeneradas.length} de ${totalToques}`);
check('los toques degenerados son una minoría',
  degeneradas.length > 0 && degeneradas.length < totalToques / 10, `${degeneradas.length}/${totalToques}`);
check('ningún toque tiene la invalidación del lado equivocado', resultados.every((r) => r.eventos.every((e) =>
  ROTURAS.has(e.patron) || !Number.isFinite(e.invalida) ||
  (e.lado === 'VENTA' ? e.invalida >= e.precio : e.invalida <= e.precio))));

const malNivel = resultados.filter((r) => r.eventos.some((e) => {
  if (!ROTURAS.has(e.patron)) return false;
  if (!Number.isFinite(e.nivelRoto)) return true;
  const c = r.velas[e.barIndex].c;
  return e.lado === 'VENTA' ? !(c < e.nivelRoto) : !(c > e.nivelRoto);
}));
check('toda rotura rompe su nivel en el cierre', malNivel.length === 0,
  malNivel.map((r) => clave(r.simbolo, r.tf)).join(','));

console.log(`\n— banco —`);
const particion = resultados.every((r) => {
  const corte = Math.floor(r.velas.length * SPLIT);
  const train = r.eventos.filter((e) => e.barIndex < corte).length;
  const valid = r.eventos.filter((e) => e.barIndex >= corte).length;
  return train + valid === r.eventos.length;
});
check('train + validación = total de señales', particion);

const vela = (o, h, l, c) => ({ t: 0, o, h, l, c });

/* Venta con entrada 100 y stop 101 (riesgo 1, objetivo 99): la vela siguiente
   baja a 98,9 sin acercarse al stop. */
const relleno = Array.from({ length: 12 }, () => vela(100, 100.2, 99.9, 100));
const haciaObjetivo = [vela(100, 100.2, 99.9, 100), vela(100, 100.1, 98.4, 98.6), ...relleno];
const alObjetivo = simular(haciaObjetivo, { barIndex: 0, lado: 'VENTA', precio: 100, invalida: 101 });
check('venta que llega a 1,5R devuelve +1,5', alObjetivo && Math.abs(alObjetivo.r - 1.5) < 1e-9, JSON.stringify(alObjetivo));

const haciaStop = [vela(100, 100.2, 99.9, 100), vela(100, 102, 100, 101.5), ...relleno];
const alStop = simular(haciaStop, { barIndex: 0, lado: 'VENTA', precio: 100, invalida: 101 });
check('venta que toca el stop devuelve -1', alStop && alStop.r === -1 && alStop.motivo === 'stop', JSON.stringify(alStop));

/* Compra 100 → stop 99, objetivo 101,5. Trece velas laterales y la última
   (barIndex + 12) cierra en 100,5. */
const lateral = [vela(100, 100.1, 99.9, 100)];
for (let k = 1; k <= 12; k++) lateral.push(vela(100, 100.4, 99.6, k === 12 ? 100.5 : 100));
const porTiempo = simular(lateral, { barIndex: 0, lado: 'COMPRA', precio: 100, invalida: 99 });
check('sin tocar nada sale al cierre dentro del horizonte', porTiempo && porTiempo.motivo === 'tiempo' && Math.abs(porTiempo.r - 0.5) < 1e-9, JSON.stringify(porTiempo));

const sinRiesgo = simular(haciaObjetivo, { barIndex: 0, lado: 'VENTA', precio: 100, invalida: 100 });
check('sin riesgo no se inventa operación', sinRiesgo === null);

const corte = simular(haciaObjetivo, { barIndex: haciaObjetivo.length - 1, lado: 'VENTA', precio: 100, invalida: 101 });
check('sin velas suficientes se descarta (no se simula a medias)', corte && corte.abierta === true, JSON.stringify(corte));

if (existsSync(join(AQUI, 'reporte.json'))) {
  const rep = JSON.parse(readFileSync(join(AQUI, 'reporte.json'), 'utf8'));
  const suma = Object.values(rep.porCodigo).reduce((a, m) => a + m.n, 0);
  const base = rep.variantes['diccionario: cuerpo en las B + retesteo (por defecto)'].n;
  check('el reporte cuadra: suma por código = total', suma === base, `${suma} vs ${base}`);
  check('el reporte guarda los parámetros', !!rep.parametros && rep.parametros.emaContacto === 30);
} else {
  console.log('  · sin reporte.json todavía (corre evaluar.mjs)');
}

console.log(`\nresultado: ${ok} OK / ${mal} fallos`);
process.exit(mal ? 1 : 0);
