/* ============================================================
   Tests de la estrategia Estructura (con puerta EMA).
   Serie construida a mano: calma → impulso → retroceso → quiebre.
   La calma inicial debe superar la EMA100 para que la pila exista.
   ============================================================ */
import { escanearEstructura } from './nucleo.js';

let ok = 0, mal = 0;
const check = (nombre, cond, extra = '') => {
  if (cond) { ok++; console.log(`  ✓ ${nombre}`); }
  else { mal++; console.error(`  ✗ ${nombre}${extra ? ' — ' + extra : ''}`); }
};

let velas = [], i = 0;
const push = (o, h, l, c) => { velas.push({ t: i++ * 300000, o, h, l, c }); };
const serie = () => { velas = []; i = 0; };

/* 20 velas doji planas: ATR ≈ 2 y sin impulso en ningún sentido
   (cuerpo mínimo → el ratio de cuerpo queda por debajo del umbral). */
const calma = (n = 120) => {
  for (let k = 0; k < n; k++) push(1000, 1001, 999, 1000.05);
};

/* Impulso de 2 velas (pierna, no vela suelta) que hace el mínimo de 20 velas. */
const VENTA_IMPULSO = () => {
  push(1000, 1000.5, 995.8, 996);    // 1.ª vela de la pierna
  push(996, 996.2, 993.5, 993.8);    // 2.ª vela: nuevo mínimo → punta 993.5
};
const VENTA_RETROCESO = () => push(993.8, 997.5, 993.6, 997);  // retroceso dentro del rango
const VENTA_TOQUE = () => push(997, 997.2, 995.2, 995.5);      // cierra a la baja: toque
const VENTA_QUIEBRE = () => push(995, 995.2, 991.8, 992);      // cierra bajo la punta

const patrones = (r) => r.eventos.map((e) => `${e.patron}@${e.barIndex}`).join(' ');
const delLado = (r, lado) => r.eventos.filter((e) => e.lado === lado);

/* ---------- 1. Impulso + retroceso + quiebre → 1E ---------- */
serie(); calma(); VENTA_IMPULSO(); VENTA_RETROCESO(); VENTA_TOQUE(); VENTA_QUIEBRE();
const r1 = escanearEstructura(velas);
const entradas1 = delLado(r1, 'VENTA').filter((e) => e.tipo === 'entry');
check('emite una entrada tras impulso, retroceso y quiebre', entradas1.length === 1, patrones(r1));
check('la entrada es la seductora 1E', entradas1[0]?.patron === '1E', patrones(r1));
check('la entrada rompe el nivel en el cierre',
  entradas1[0] && entradas1[0].precio < entradas1[0].nivelRoto, patrones(r1));
check('la invalidación queda por encima del precio',
  entradas1[0] && entradas1[0].invalida > entradas1[0].precio, patrones(r1));

/* La misma jugada sin EMA100 disponible: la puerta EMA debe bloquearla. */
const r1sinEma = escanearEstructura(velas, { emaFondo: 1000 });
check('sin EMA100 no emite', r1sinEma.eventos.length === 0, patrones(r1sinEma));
check('sin EMA100 cuenta el filtro', r1sinEma.filtros.sinAlineacion > 0);

/* ---------- 2. Sin impulso no hay nada ---------- */
serie(); calma(60);
const r2 = escanearEstructura(velas);
check('sin impulso no emite eventos', r2.eventos.length === 0, patrones(r2));
check('sin impulso cuenta el filtro', r2.filtros.sinImpulso > 0);

/* ---------- 3. Retroceso que supera el origen → se cancela ---------- */
serie(); calma(); VENTA_IMPULSO(); VENTA_RETROCESO(); VENTA_TOQUE();
push(995, 1003, 994.8, 1002.5);   // cierre por encima del origen + margen
const r3 = escanearEstructura(velas);
check('un cierre sobre el origen cancela la jugada', delLado(r3, 'VENTA').length === 0, patrones(r3));
check('cuenta el filtro de techo', r3.filtros.sobreTecho > 0);

/* ---------- 4. Caducidad: toque sin quiebre ---------- */
serie(); calma(); VENTA_IMPULSO(); VENTA_RETROCESO(); VENTA_TOQUE();
for (let k = 0; k < 32; k++) { const o = 996 + k * 0.1; push(o, o + 0.8, o - 0.1, o + 0.5); }
const r4 = escanearEstructura(velas);
check('sin quiebre no hay entrada', delLado(r4, 'VENTA').filter((e) => e.tipo === 'entry').length === 0, patrones(r4));
check('la jugada caduca', r4.filtros.caducidad > 0);

/* ---------- 5. Dos toques → aviso 2E y entrada 2EB ---------- */
serie(); calma(); VENTA_IMPULSO(); VENTA_RETROCESO(); VENTA_TOQUE();
push(995.5, 999, 995.4, 998.5);   // el precio sube otra vez
push(998.5, 999.5, 998, 999);     // nuevo pico de retroceso
push(999, 999.4, 997.2, 997.5);   // cierra a la baja: 2.º toque
push(997, 997.2, 991.5, 992);     // quiebre
const r5 = escanearEstructura(velas);
const senales5 = delLado(r5, 'VENTA').filter((e) => e.tipo === 'entry').map((e) => e.patron);
check('el 2.º toque se entrega como señal 2E', senales5.includes('2E'), patrones(r5));
check('el quiebre del 2.º toque entra con 2EB', senales5.includes('2EB'), patrones(r5));

/* ---------- 6. Determinismo ---------- */
const a = JSON.stringify(escanearEstructura(velas).eventos);
const b = JSON.stringify(escanearEstructura(velas).eventos);
check('el escaneo es determinista', a === b);

/* ---------- 7. Códigos válidos y coherencia ---------- */
const VALIDOS = new Set(['1E', '1ER', '2E', '2ER', '3E', '3ER', '2EB', '2EBR', '3EB', '3EBR']);
const todos = [r1, r3, r4, r5].flatMap((r) => r.eventos);
check('solo usa códigos Estructura', todos.every((e) => VALIDOS.has(e.patron)),
  [...new Set(todos.map((e) => e.patron))].join(' '));
const roturasE = new Set(['1E', '1ER', '2EB', '2EBR', '3EB', '3EBR']);
check('toda rotura Estructura rompe su nivel en el cierre',
  todos.filter((e) => roturasE.has(e.patron))
    .every((e) => Number.isFinite(e.nivelRoto)
      && (e.lado === 'VENTA' ? e.precio < e.nivelRoto : e.precio > e.nivelRoto)));
check('los toques 2E también se entregan como señales', todos.some((e) => e.patron === '2E'));

console.log(`\nresultado: ${ok} OK / ${mal} fallos`);
process.exit(mal ? 1 : 0);
