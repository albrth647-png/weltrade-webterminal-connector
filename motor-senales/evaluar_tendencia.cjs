'use strict';
/* ============================================================
   Mide la capa de tendencia con las series VERIFICADAS.
   ------------------------------------------------------------
   - Serie por símbolo desde .estado.json (velas M5 ya validadas contra el
     precio vivo del bróker).
   - Compara etiqueta CRUDA (tendenciaActual) contra ESTABLE (histeresis).
   - Estabilidad: cambios de etiqueta en las últimas 200 velas.
   - Acierto en el origen de cada marca: soporte => ALCISTA, resistencia => BAJISTA.
   - Retardo: primeras velas desde el origen hasta confirmar la dirección.

   Uso: node evaluar_tendencia.cjs ["SFX Vol 20"]
   ============================================================ */
const fs = require('fs');
const path = require('path');
const { tendenciaActual, tendenciaEstable, crearHisteresis, tendenciaEstructural } = require('./tendencia');

const estado = JSON.parse(fs.readFileSync(path.join(__dirname, '.estado.json'), 'utf8'));
const series = {};
for (const [sim, v] of Object.entries(estado.simbodo || {})) {
  const velas = (v.velas && v.velas.M5) || [];
  if (velas.length >= 100) series[sim] = velas;
}

const filtro = process.argv[2];
const casos = fs.readFileSync(path.join(__dirname, 'datos', 'casos.jsonl'), 'utf8')
  .trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
  .filter((c) => c.etiqueta && c.etiqueta.estado === 'referencia')
  .filter((c) => !filtro || (c.mercado || {}).simbolo === filtro);

/* ---------- estado actual + estabilidad ---------- */
const VENTANA = 200;
for (const [sim, velas] of Object.entries(series)) {
  if (filtro && sim !== filtro) continue;

  const est = crearHisteresis();
  let crudoCambios = 0, estableCambios = 0, estrucCambios = 0, previaCruda = null, previaEstruct = null;
  const desde = Math.max(60, velas.length - VENTANA);
  for (let i = desde; i < velas.length; i++) {
    const h = velas.slice(0, i + 1);
    const crudo = tendenciaActual(h).etiqueta;
    if (previaCruda && crudo !== previaCruda) crudoCambios++;
    previaCruda = crudo;
    const r = tendenciaEstable(h, est);
    if (r.cambio) estableCambios++;
    const e = tendenciaEstructural(h).etiqueta;
    if (previaEstruct && e !== previaEstruct) estrucCambios++;
    previaEstruct = e;
  }

  const eh = tendenciaEstructural(velas);
  console.log(`\n=== ${sim} (${velas.length} velas M5) ===`);
  console.log(`  actual: estructura=${eh.etiqueta} (${eh.detalle}) · histéresis=${est.etiqueta}`);
  console.log(`  cambios en ${VENTANA} velas: crudo=${crudoCambios} · histéresis=${estableCambios} · estructura=${estrucCambios}`);
  console.log(`  inicio de la pata actual: ${eh.inicio != null ? eh.inicio + ' (' + new Date(eh.inicioT).toISOString().slice(0, 16) + ')' : '—'}`);
}

/* ---------- acierto en el origen de las marcas ---------- */
const porSimbolo = {};
for (const c of casos) {
  const sim = (c.mercado || {}).simbolo;
  (porSimbolo[sim] = porSimbolo[sim] || []).push(c);
}

for (const [sim, lista] of Object.entries(porSimbolo)) {
  const velas = series[sim];
  if (!velas) { console.log(`\n${sim}: sin serie verificada, se omite`); continue; }
  const idxPorT = new Map(velas.map((v, i) => [v.t, i]));

  console.log(`\n--- ${sim}: ${lista.length} marcas ---`);
  console.log('linea      origen        esperado   crudo     estable   estruc    adx   er   r2   estructura');

  let okCrudo = 0, okEstable = 0, okEstableEstruct = 0, n = 0;
  let sumaCrudo = 0, sumaEstable = 0, confCrudo = 0, confEstable = 0;

  for (const c of lista) {
    const o = c.origen.marcasOriginales;
    const esperado = o.p2 > o.p1 ? 'ALCISTA' : 'BAJISTA';
    const i1 = idxPorT.get(o.t1);
    if (i1 == null || i1 < 60) { console.log(`${String(c.origen.lineaId).padEnd(10)} sin vela para t1`); continue; }

    const h = velas.slice(0, i1 + 1);
    const crudo = tendenciaActual(h);
    const est = crearHisteresis();
    let r = null;
    for (let k = 60; k <= i1; k++) r = tendenciaEstable(velas.slice(0, k + 1), est);

    const estruc = tendenciaEstructural(h);
    const aciertaCrudo = crudo.etiqueta === esperado;
    const aciertaEstable = r && r.etiqueta === esperado;
    const aciertaEstruc = estruc.etiqueta === esperado;
    n++; if (aciertaCrudo) okCrudo++; if (aciertaEstable) okEstable++; if (aciertaEstruc) okEstableEstruct++;

    console.log(
      `${String(c.origen.lineaId).padEnd(10)} ${String(i1).padStart(6)}  ${esperado.padEnd(10)} ` +
      `${crudo.etiqueta.padEnd(9)} ${String(r ? r.etiqueta : '—').padEnd(9)} ` +
      `${estruc.etiqueta.padEnd(9)} ${String(crudo.componentes.adx).padStart(4)} ${String(crudo.componentes.er).padStart(4)} ` +
      `${String(crudo.componentes.r2).padStart(4)}   ${crudo.componentes.detalleEstructura}`
    );

    /* retardo: velas desde el origen hasta que la dirección coincide */
    const dirEsperada = esperado === 'ALCISTA' ? 1 : -1;
    let lagC = null, lagE = null;
    const est2 = crearHisteresis();
    for (let k = 60; k < velas.length; k++) {
      const hk = velas.slice(0, k + 1);
      const rc = tendenciaActual(hk);
      const re = tendenciaEstable(hk, est2);
      if (k >= i1) {
        if (lagC == null && rc.direccion === dirEsperada) lagC = k - i1;
        if (lagE == null && re.direccion === dirEsperada) lagE = k - i1;
      }
      if (lagC != null && lagE != null) break;
    }
    if (lagC != null) { sumaCrudo += lagC; confCrudo++; }
    if (lagE != null) { sumaEstable += lagE; confEstable++; }
  }

  console.log(`  acierto en origen: crudo ${okCrudo}/${n} · histéresis ${okEstable}/${n} · estructura ${okEstableEstruct}/${n}`);
  console.log(`  retardo medio: crudo ${confCrudo ? (sumaCrudo / confCrudo).toFixed(1) : '—'} · histéresis ${confEstable ? (sumaEstable / confEstable).toFixed(1) : '—'} velas`);
}
