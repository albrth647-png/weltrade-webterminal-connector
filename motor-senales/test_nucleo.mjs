'use strict';
/* ============================================================
   TEST DEL NÚCLEO — catálogo del vídeo 03
   ------------------------------------------------------------
   Una serie por escenario, generada con la EMA30/50 calculada en
   vivo (misma función que el motor) para colocar los toques donde
   deben ir, sin azar:

     S1  dos toques + quiebre           → 2B
     S2  tres toques + quiebre          → 3B
     S3  engaño sobre la EMA50 + regreso → 1
     S4  la jugada repetida             → 2B y después 2RB (reset)

   Y las cinco reglas del vídeo que se añadieron después, cada una
   medida contra la misma serie con la guarda APAGADA: si la guarda
   no cambia el resultado, el test falla.

     S5  toque que no supera al anterior  → sin 2 y sin entrada
     S6  engaño de hace 40 velas         → sin 1
     S7  2B con vela de cuerpo mínimo    → 2B no (el cuerpo lo exigen todas las B)
     S8  cierre sobre la EMA50           → cancela el pendiente
     S9  se salió, volvió y repitió       → la segunda lleva R
     S10 la 1 rompe el mínimo del engaño → no el de las 12 velas
     S11 el 2B de Sperandeo              → se opera el fracaso, al otro lado
     S12 la 2B del diccionario           → quiebre + retesteo, entra en la vuelta

   Y los invariantes que no pueden romperse: solo códigos del
   vídeo (no existe 1B), escaneo determinista, entradas con precio
   válido, invalidación al otro lado y nivel realmente roto.
   Ejecutar:  node test_nucleo.mjs
   ============================================================ */
import { escanear, ema } from './nucleo.js';

/* Códigos de ROTURA (la 2 y la 3 son señales de toque, no de rotura). */
const ROTURAS = new Set(['1', '1R', '2B', '2RB', '3B', '3RB']);
const DEBUG = process.env.DEBUG_NUCLEO === '1';
const traza = (...a) => { if (DEBUG) console.log('   ·', ...a); };

let ok = 0, mal = 0;
const check = (nombre, cond, extra = '') => {
  if (cond) { ok++; console.log(`  ✓ ${nombre}`); }
  else { mal++; console.error(`  ✗ ${nombre}${extra ? ' — ' + extra : ''}`); }
};

/* ---------- generador ---------- */
let velas = [], precio = 1000, i = 0;
const R = (x) => Math.round(x * 100) / 100;
const vela = (o, h, l, c) => { velas.push({ t: i++ * 300000, o, h, l, c }); precio = c; };
const ultimaEma = (p) => { const e = ema(velas.map((v) => v.c), p); return e[e.length - 1]; };

const serie = () => { velas = []; i = 0; precio = 1000; };
const tendencia = (n, paso) => { for (let k = 0; k < n; k++) { const o = precio, c = R(o - paso); vela(o, R(o + 1.5), R(c - 1.5), c); } };

/* Vela que toca la EMA30 con la mecha y cierra por debajo (VENTA).
   La mecha se queda por debajo de la EMA50: si las EMAs se han juntado
   tanto que no cabe, no es un toque válido y la serie no lo finge. */
function toque() {
  let g = 0;
  while (g++ < 80) {
    const E = ultimaEma(30);
    if (E - precio <= 5) break;
    const o = precio, c = R(o + 4);
    vela(o, R(c + 0.5), R(o - 1), c);
  }
  const E30 = ultimaEma(30), E50 = ultimaEma(50);
  const c = R(E30 - 4);
  const h = R(Math.min(E30 + 0.6, E50 - 0.5));
  if (h < E30 - 1) throw new Error(`serie inválida: la mecha (${h}) no llega a la EMA30 (${E30.toFixed(2)}) sin superar la EMA50 (${E50.toFixed(2)})`);
  traza(`toque @${velas.length} E30=${E30.toFixed(2)} E50=${E50.toFixed(2)} E100=${ultimaEma(100).toFixed(2)} mecha=${h} cierre=${c}`);
  vela(precio, h, R(Math.min(precio, c) - 1), c);
}

/* Aguanta sin romper el nivel del toque: la caducidad del quiebre vence
   sin que se dispare una entrada. */
const aguante = (n = 6, paso = 1.2) => { for (let k = 0; k < n; k++) { const o = precio, c = R(o - paso); vela(o, R(o + 0.5), R(c - 0.5), c); } };

/* Se aleja de la EMA30 para que el siguiente toque sea un toque nuevo. */
const separar = () => { aguante(); for (let k = 0; k < 4; k++) { const o = precio, c = R(o - 10); vela(o, R(o + 0.5), R(c - 0.5), c); } };

/* Cierre con cuerpo por debajo de todo lo reciente: el quiebre. */
function quiebre() {
  const lows = velas.slice(-15).map((v) => v.l);
  const c = R(Math.min(...lows) - 6);
  traza(`quiebre @${velas.length} cierre=${c} min15=${R(Math.min(...lows))}`);
  vela(precio, R(precio + 0.5), R(c - 0.5), c);
}

/* Rango medio de las últimas velas: sirve para colocar toques finos. */
const rangoMedio = (n = 14) => {
  const v = velas.slice(-n);
  return v.reduce((s, x) => s + (x.h - x.l), 0) / v.length;
};

/* Toque fino: mecha de `mecha` rangos por encima de la EMA30 (dentro de la
   tolerancia) y cierre por debajo. No modifica los cierres, así que no mueve
   la EMA más de lo que mueve el propio precio. */
function toqueFino(mecha = 0.4, abajo = 0.2) {
  const E30 = ultimaEma(30), r = rangoMedio();
  const c = R(E30 - 0.1 * r);
  vela(R(E30 - 0.1 * r), R(E30 + mecha * r), R(E30 - abajo * r), c);
}

/* Caída: las mechas ya no llegan a la banda de la EMA30. */
const caida = (n = 3) => {
  for (let k = 0; k < n; k++) {
    const o = precio, c = R(o - 2.5);
    vela(o, R(o + 0.2), R(c - 0.3), c);
  }
};

/* Quiebre que nace por debajo de la banda: su mecha no vuelve a la EMA30. */
function quiebreAbajo() {
  const lows = velas.slice(-15).map((v) => v.l);
  const c = R(Math.min(...lows) - 6);
  const o = R(precio - 6);   // abre con hueco: su mecha no vuelve a la EMA30
  traza(`quiebre-abajo @${velas.length} cierre=${c}`);
  vela(o, R(o + 0.3), R(c - 0.5), c);
}

/* Cierre por encima de la EMA50: se fue al otro lado del techo. */
function salidita() {
  const E50 = ultimaEma(50);
  const o = R(E50 - 2), c = R(E50 + 3);
  vela(o, R(c + 1), R(o - 1), c);
}

/* Quiebre con cuerpo mínimo (doji con mechas): cuerpo 0,3 sobre 16 de rango. */
function quiebreDoji() {
  const lows = velas.slice(-15).map((v) => v.l);
  const c = R(Math.min(...lows) - 6);
  const o = R(c + 0.3);
  traza(`quiebre-doji @${velas.length} cierre=${c}`);
  vela(o, R(o + 8), R(c - 8), c);
}

/* Engaño: se sale por encima de la EMA50, regresa cruzando la EMA30 y quiebra. */
function engano(quiebra = true) {
  let g = 0;
  while (g++ < 80) {
    const E50 = ultimaEma(50);
    if (precio > E50 + 8) break;
    const o = precio, c = R(o + 7);
    vela(o, R(c + 2), R(o - 1), c);
  }
  vela(precio, R(precio + 2), R(precio - 1), R(ultimaEma(50) + 6));
  let h = 0;
  while (h++ < 80) {
    const E30 = ultimaEma(30);
    if (precio < E30 - 3) break;
    const o = precio, c = R(o - 6);
    vela(o, R(o + 0.5), R(c - 0.5), c);
  }
  if (quiebra) quiebre();
}

/* Los escenarios miden la ESTRUCTURA del catálogo (toques, engaño, reset,
   guardas), así que se ejecutan con la entrada al quiebre; el retesteo, que es
   la regla por defecto, tiene su propio escenario (S12). */
const escenario = (nombre, construir, opciones = {}) => {
  serie();
  tendencia(180, 1.5);
  construir();
  const { eventos } = escanear(velas, { modo2B: 'continuacion', ...opciones });
  const entradas = eventos.filter((e) => e.tipo === 'entry');
  const avisos = eventos.filter((e) => e.tipo === 'aviso');
  console.log(`\n[${nombre}] ${velas.length} velas · entradas=${entradas.map((e) => `${e.patron}@${e.barIndex}`).join(',') || '—'} · avisos=${avisos.map((e) => `${e.patron}@${e.barIndex}`).join(',') || '—'}`);
  return { eventos, entradas, avisos };
};

/* ---------- S1: 2B ---------- */
console.log('— S1: dos toques + quiebre —');
const S1 = escenario('S1', () => { toque(); separar(); toque(); quiebre(); });
check('emite 2B', S1.entradas.some((e) => e.patron === '2B'), S1.entradas.map((e) => e.patron).join(','));
check('el 2.º toque se entrega como señal 2', S1.entradas.some((a) => a.patron === '2'), S1.entradas.map((e) => e.patron).join(','));
check('la señal 2 llega antes del 2B', (() => {
  const a = S1.entradas.find((x) => x.patron === '2');
  const e = S1.entradas.find((x) => x.patron === '2B');
  return !!a && !!e && a.barIndex <= e.barIndex;
})());

/* ---------- S2: 3B ---------- */
console.log('\n— S2: tres toques + quiebre —');
const S2 = escenario('S2', () => { toque(); separar(); toque(); separar(); toque(); quiebre(); });
check('emite 3B', S2.entradas.some((e) => e.patron === '3B'), S2.entradas.map((e) => e.patron).join(','));
check('el 3.er toque se entrega como señal 3', S2.entradas.some((a) => a.patron === '3'), S2.entradas.map((e) => e.patron).join(','));

/* ---------- S3: la seductora ---------- */
console.log('\n— S3: engaño + regreso + quiebre —');
const S3 = escenario('S3', () => { engano(); });
check('emite 1 (la seductora)', S3.entradas.some((e) => e.patron === '1'), S3.entradas.map((e) => e.patron).join(','));
check('la 1 no se confunde con una 2B', !S3.entradas.some((e) => e.patron === '2B'));

/* ---------- S4: reset ---------- */
console.log('\n— S4: la jugada repetida —');
const S4 = escenario('S4', () => {
  toque(); separar(); toque(); quiebre();
  toque(); separar(); toque(); quiebre();
});
const roturas4 = S4.entradas.filter((e) => ROTURAS.has(e.patron));
check('la primera rotura es 2B', roturas4[0]?.patron === '2B', S4.entradas.map((e) => e.patron).join(','));
check('la repetida es 2RB', roturas4.some((e) => e.patron === '2RB'), S4.entradas.map((e) => e.patron).join(','));

/* ---------- S5: «primer toque que supera» ---------- */
console.log('\n— S5: el 2.º toque NO supera al 1.º —');
/* Toque 1 con mecha larga (mínimo profundo) y toque 2 con mínimo más alto:
   el precio no superó el mínimo del anterior, así que no es un 2.º toque. */
const sinExtension = () => { toqueFino(0.05, 3.0); caida(2); toqueFino(0.05, 0.2); quiebreAbajo(); };
const S5 = escenario('S5', sinExtension);
const S5libre = escenario('S5 sin guarda', sinExtension, { exigirExtension: false });
check('sin superar al anterior no hay señal 2', !S5.entradas.some((a) => a.patron === '2'), S5.entradas.map((a) => a.patron).join(','));
check('sin superar al anterior no hay entrada', S5.entradas.length === 0, S5.entradas.map((e) => e.patron).join(','));
check('con la guarda apagada sí cuenta el 2.º toque', S5libre.entradas.some((a) => a.patron === '2') && S5libre.entradas.length > 0,
  `señales=${S5libre.entradas.map((e) => e.patron).join(',')}`);

/* ---------- S6: el engaño caduca ---------- */
console.log('\n— S6: engaño viejo, quiebre tardío —');
const enganoViejo = () => engano();
const S6 = escenario('S6', enganoViejo, { caducidadEngano: 1 });
const S6libre = escenario('S6 sin guarda', enganoViejo, { caducidadEngano: 0 });
check('un engaño caducado no etiqueta 1', !S6.entradas.some((e) => e.patron === '1'), S6.entradas.map((e) => e.patron).join(','));
check('con el engaño sin caducidad sí sale 1', S6libre.entradas.some((e) => e.patron === '1'), S6libre.entradas.map((e) => e.patron).join(','));

/* ---------- S7: el cuerpo lo exigen todas las B ---------- */
console.log('\n— S7: quiebre sin cuerpo —');
const dosToquesDoji = () => { toque(); separar(); toque(); quiebreDoji(); };
const S7 = escenario('S7', dosToquesDoji);
const S7libre = escenario('S7 sin la regla', dosToquesDoji, { cuerpoSoloUno: true });
check('la 2B exige cuerpo', !S7.entradas.some((e) => e.patron === '2B'), S7.entradas.map((e) => e.patron).join(','));
check('con el cuerpo solo en la 1, el doji sí entraba', S7libre.entradas.some((e) => e.patron === '2B'), S7libre.entradas.map((e) => e.patron).join(','));
const S7uno = escenario('S7 la 1', () => { engano(false); quiebreDoji(); });
check('la 1 sí exige cuerpo', !S7uno.entradas.some((e) => e.patron === '1'), S7uno.entradas.map((e) => e.patron).join(','));

/* ---------- S8: el techo cancela el pendiente ---------- */
console.log('\n— S8: cierre sobre la EMA50 entre el toque y el quiebre —');
const seVaAlTecho = () => { toque(); separar(); toque(); salidita(); quiebre(); };
const S8 = escenario('S8', seVaAlTecho);
const S8libre = escenario('S8 sin guarda', seVaAlTecho, { cancelarSobreTecho: false });
check('superar la EMA50 cancela el pendiente', S8.entradas.filter((e) => ROTURAS.has(e.patron)).length === 0, S8.entradas.map((e) => e.patron).join(','));
check('sin la guarda el pendiente sobrevive', S8libre.entradas.some((e) => e.patron === '2B'), S8libre.entradas.map((e) => e.patron).join(','));

/* ---------- S9: se salió, volvió y lo hizo otra vez ---------- */
console.log('\n— S9: reset por salida, no solo por entrada —');
const S9 = escenario('S9', () => {
  toque(); separar(); toque(); salidita(); aguante(10, 1.2);
  toque(); separar(); toque(); quiebre();
});
const S9libre = escenario('S9 sin la regla', () => {
  toque(); separar(); toque(); salidita(); aguante(10, 1.2);
  toque(); separar(); toque(); quiebre();
}, { resetPorSalida: false });
check('tras salir y volver, TODA rotura posterior lleva R',
  S9.entradas.filter((e) => ROTURAS.has(e.patron)).length > 0
    && S9.entradas.filter((e) => ROTURAS.has(e.patron)).every((e) => e.patron.includes('R')),
  S9.entradas.map((e) => e.patron).join(','));
check('sin la regla la primera repetición sale sin R',
  S9libre.entradas.filter((e) => ROTURAS.has(e.patron)).some((e) => !e.patron.includes('R')),
  S9libre.entradas.map((e) => e.patron).join(','));

/* ---------- S10: el nivel que rompe la 1 ---------- */
console.log('\n— S10: la 1 rompe el mínimo del tramo del engaño —');
const S10 = escenario('S10', () => { engano(); });
const e50 = ema(velas.map((v) => v.c), 50);
const tramo = velas.map((v, k) => ({ v, E: e50[k] })).filter((x, k) => k > 150 && x.E !== null && x.v.c > x.E);
const minEngano = Math.min(...tramo.map((x) => x.v.l));
const uno = S10.entradas.find((e) => e.patron === '1');
check('la 1 rompe el mínimo del tramo del engaño',
  !!uno && Math.abs(uno.nivelRoto - minEngano) < 1e-6,
  uno ? `nivelRoto=${uno.nivelRoto} minEngano=${R(minEngano)}` : 'sin 1');
const S10viejo = escenario('S10 nivel viejo', () => { engano(); }, { nivelUnoPorEngano: false });
const unoViejo = S10viejo.entradas.find((e) => e.patron === '1');
check('con el nivel viejo (12 velas) el nivel cambia',
  !!unoViejo && !!uno && Math.abs(unoViejo.nivelRoto - uno.nivelRoto) > 1e-9,
  unoViejo ? `viejo=${unoViejo.nivelRoto} nuevo=${uno && uno.nivelRoto}` : 'sin 1');

/* ---------- S11: el 2B de Sperandeo ---------- */
console.log('\n— S11: el 2B de Sperandeo (se opera el fracaso) —');
serie(); tendencia(180, 1.5); toque(); separar(); toque(); quiebre();
const ref2B = escanear(velas, { modo2B: 'continuacion' }).eventos.find((e) => e.patron === '2B');
const nivel2B = ref2B ? ref2B.nivelRoto : null;
check('hay un 2B de referencia', !!ref2B);
/* Misma serie hasta el toque: quiebre MARGINAL y vela que vuelve al otro lado. */
serie(); tendencia(180, 1.5); toque(); separar(); toque();
const cRoto = R(nivel2B - 1);
vela(precio, R(Math.max(precio, cRoto) + 0.2), R(cRoto - 0.2), cRoto);
const cVuelta = R(nivel2B + 2);
vela(cRoto, R(cVuelta + 0.5), R(cRoto - 0.5), cVuelta);
const rev = escanear(velas, { modo2B: 'reversion' }).eventos.filter((e) => e.tipo === 'entry' && e.patron === '2B');
/* El quiebre marginal es un doji por construcción (rompe 1 punto): para aislar
   la diferencia de MODO se desactiva la regla del cuerpo en esta comparación. */
const cont = escanear(velas, { modo2B: 'continuacion', cuerpoSoloUno: true })
  .eventos.filter((e) => e.tipo === 'entry' && e.patron === '2B');
check('en reversion el 2B se opera al otro lado',
  rev.length === 1 && rev[0].patron === '2B' && rev[0].lado === 'COMPRA',
  JSON.stringify(rev.map((e) => `${e.lado} ${e.patron}`)));
check('en continuacion el mismo 2B se opera a favor',
  cont.some((e) => e.patron === '2B' && e.lado === 'VENTA'), JSON.stringify(cont.map((e) => `${e.lado} ${e.patron}`)));
check('la reversión deja el stop en el extremo marginal',
  !!rev[0] && rev[0].invalida < rev[0].precio && rev[0].invalida <= cRoto,
  rev[0] ? `precio=${rev[0].precio} invalida=${rev[0].invalida}` : 'sin entrada');
/* La reversión consume la jugada: no debe dejar vivo el engaño viejo ni
   incrementar el ciclo cuando resetTrasEntrada está apagado. */
const revSinReset = escanear(velas, { modo2B: 'reversion', resetTrasEntrada: false }).secuencias.VENTA;
check('la reversión respeta resetTrasEntrada:false',
  revSinReset.ciclo === 0, `ciclo=${revSinReset.ciclo}`);
const revSeq = escanear(velas, { modo2B: 'reversion' }).secuencias.VENTA;
check('la reversión limpia el engaño de la secuencia',
  revSeq.engaño === false && revSeq.enganoNivel === null,
  `engaño=${revSeq.engaño} nivel=${revSeq.enganoNivel}`);

/* ---------- S12: la 2B del diccionario (quiebre + retesteo) ---------- */
console.log('\n— S12: la 2B espera el retesteo —');
const nivelQuiebre = (() => { serie(); tendencia(180, 1.5); toque(); separar(); toque();
  return R(Math.min(...velas.slice(-12).map((v) => v.l))); })();
const conRetesteo = () => {
  toque(); separar(); toque(); quiebre();
  /* vuelve a probar el nivel sin cerrar por encima y cierra otra vez abajo */
  const l = R(nivelQuiebre - 7), h = R(nivelQuiebre - 0.2), c = R(nivelQuiebre - 3);
  vela(precio, h, l, c);
};
const S12 = escenario('S12', conRetesteo, { modo2B: 'retesteo' });
const S12cont = escenario('S12 al cierre', conRetesteo, { modo2B: 'continuacion' });
const r12 = S12.entradas.filter((e) => e.patron === '2B');
const c12 = S12cont.entradas.filter((e) => e.patron === '2B');
check('con retesteo, la 2B entra en la vuelta al nivel', r12.length === 1, S12.entradas.map((e) => `${e.patron}@${e.barIndex}`).join(','));
check('la entrada del retesteo llega después del quiebre',
  !!r12[0] && !!c12[0] && r12[0].barIndex > c12[0].barIndex,
  `retesteo@${r12[0]?.barIndex} quiebre@${c12[0]?.barIndex}`);
check('el retesteo asume menos riesgo que entrar al quiebre',
  !!r12[0] && !!c12[0]
    && (r12[0].invalida - r12[0].precio) < (c12[0].invalida - c12[0].precio),
  r12[0] && c12[0]
    ? `riesgo retesteo=${R(r12[0].invalida - r12[0].precio)} quiebre=${R(c12[0].invalida - c12[0].precio)}`
    : 'sin comparación');
check('el stop del retesteo sigue siendo el extremo del toque',
  !!r12[0] && r12[0].invalida > r12[0].precio, r12[0] ? `precio=${r12[0].precio} invalida=${r12[0].invalida}` : 'sin entrada');
const S12tarde = escenario('S12 caducado', () => {
  toque(); separar(); toque(); quiebre(); aguante(5, 0.3);
  const l = R(nivelQuiebre - 7), h = R(nivelQuiebre - 0.2), c = R(nivelQuiebre - 3);
  vela(precio, h, l, c);
}, { modo2B: 'retesteo' });
check('un retesteo fuera de la caducidad no es 2B',
  !S12tarde.entradas.some((e) => e.patron === '2B'), S12tarde.entradas.map((e) => e.patron).join(','));

/* ---------- invariantes sobre todos los escenarios ---------- */
console.log('\n— invariantes —');
const todos = [S1, S2, S3, S4, S5, S5libre, S6, S6libre, S7, S7libre, S7uno, S8, S8libre, S9, S9libre,
  S12, S12cont, S12tarde];
const todas = todos.flatMap((s) => s.eventos);
const VALIDOS = new Set(['1', '1R', '2', '2R', '3', '3R', '2B', '2RB', '3B', '3RB',
  '1E', '1ER', '2E', '2ER', '3E', '3ER', '2EB', '2EBR', '3EB', '3EBR']);
const entradas = todas.filter((e) => e.tipo === 'entry');

check('solo existen códigos del vídeo', todas.every((e) => VALIDOS.has(e.patron)), [...new Set(todas.map((e) => e.patron))].join(' '));
check('no existe 1B', !todas.some((e) => e.patron === '1B'));
check('toda entrada lleva precio válido', entradas.length > 0 && entradas.every((e) => Number.isFinite(e.precio) && e.precio > 0));
check('la invalidación está al otro lado del precio',
  entradas.every((e) => e.lado !== 'VENTA' || (Number.isFinite(e.invalida) && e.invalida > e.precio)));
check('toda rotura rompe su nivel en el cierre',
  entradas.filter((e) => ROTURAS.has(e.patron))
    .every((e) => Number.isFinite(e.nivelRoto) && (e.lado === 'VENTA' ? e.precio < e.nivelRoto : e.precio > e.nivelRoto)));
check('los toques 2 y 3 también se entregan como señales',
  entradas.some((e) => e.patron === '2') && entradas.some((e) => e.patron === '3'));
check('nunca hay dos eventos en la misma vela y sentido',
  todos.every((s) => new Set(s.eventos.map((e) => `${e.barIndex}|${e.tipo}|${e.lado}`)).size === s.eventos.length));

serie(); tendencia(180, 1.5); toque(); separar(); toque(); quiebre();
const a = JSON.stringify(escanear(velas).eventos);
const b = JSON.stringify(escanear(velas).eventos);
check('el escaneo es determinista', a === b);

console.log(`\nresultado: ${ok} OK / ${mal} fallos`);
process.exit(mal ? 1 : 0);
