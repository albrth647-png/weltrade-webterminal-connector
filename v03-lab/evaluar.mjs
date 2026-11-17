'use strict';
/* ============================================================
   BANCO DE PRUEBAS DEL VÍDEO 03
   ------------------------------------------------------------
   Mide la estrategia tal como la calcula `motor-senales/nucleo.js`
   (no reimplementa nada: importa `escanear`).

   Método (el mismo de la calibración de 2026-11-10):
     · entrada al cierre de la vela de la señal
     · stop en `invalida` (extremo del toque)
     · objetivo a 1,5R
     · horizonte de 12 velas; si no toca nada, sale al cierre
     · stop y objetivo en la misma vela → se cuenta como stop (conservador)
     · 70 % inicial de cada serie = train · 30 % final = validación
     · operaciones sin 12 velas por delante se descartan (no se inventan)

   Uso:
     node v03-lab/evaluar.mjs
     node v03-lab/evaluar.mjs --url http://127.0.0.1:3000
     node v03-lab/evaluar.mjs --tf M5,M15 --simbolo "FX Vol 20"
   ============================================================ */
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { escanear, PARAMS } from '../motor-senales/nucleo.js';
import { cargarSeries, SIMBOLOS, TFS } from './datos.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const HORIZONTE = 12;
const TP_R = 1.5;
const SPLIT = 0.7;
/* 2 y 3 son entradas al toque; sólo se separan de las roturas para medirlas.
   La R no es un patrón: marca que la secuencia 1/2/3 se ha reseteado. */
const TOQUES = new Set(['2', '2R', '3', '3R']);
const ROTURAS = new Set(['1', '1R', '2B', '2RB', '3B', '3RB']);

/* ---------------- argumentos ---------------- */
const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : null; };
const url = arg('url');
const soloTf = arg('tf') ? arg('tf').toUpperCase().split(',') : TFS;
const soloSimbolo = arg('simbolo') ? arg('simbolo').split(',').map((s) => s.trim()) : SIMBOLOS;
/* un run parcial no pisa el reporte completo */
const parcial = soloTf.length !== TFS.length || soloSimbolo.length !== SIMBOLOS.length;
const sufijo = parcial
  ? '-' + soloSimbolo.map((s) => s.replace(/\s+/g, '')).join('+') + '-' + soloTf.join('+')
  : '';
const ARCHIVO_MD = join(AQUI, `reporte${sufijo}.md`);
const ARCHIVO_JSON = join(AQUI, `reporte${sufijo}.json`);

/* ---------------- simulación de la operación ---------------- */
export function simular(velas, ev) {
  const entrada = ev.precio;
  const stop = ev.invalida;
  if (!Number.isFinite(entrada) || !Number.isFinite(stop)) return null;
  const riesgo = Math.abs(entrada - stop);
  if (!(riesgo > 0)) return null;
  if (ev.barIndex + HORIZONTE > velas.length - 1) return { abierta: true };

  const venta = ev.lado === 'VENTA';
  const objetivo = venta ? entrada - TP_R * riesgo : entrada + TP_R * riesgo;

  for (let k = ev.barIndex + 1; k <= ev.barIndex + HORIZONTE; k++) {
    const v = velas[k];
    const tocaStop = venta ? v.h >= stop : v.l <= stop;
    const tocaObjetivo = venta ? v.l <= objetivo : v.h >= objetivo;
    if (tocaStop) return { r: -1, motivo: 'stop', bar: k, ambiguo: tocaObjetivo };
    if (tocaObjetivo) return { r: TP_R, motivo: 'objetivo', bar: k };
  }
  const salida = velas[ev.barIndex + HORIZONTE].c;
  const r = (venta ? entrada - salida : salida - entrada) / riesgo;
  return { r, motivo: 'tiempo', bar: ev.barIndex + HORIZONTE };
}

/* ---------------- métricas ---------------- */
function metricas(regs) {
  const n = regs.length;
  if (!n) return { n: 0, esperanza: 0, suma: 0, acierto: 0, pf: null, maxDD: 0, ganadoras: 0, perdedoras: 0 };
  const orden = regs.slice().sort((a, b) =>
    a.simbolo.localeCompare(b.simbolo) || a.tf.localeCompare(b.tf) || a.bar - b.bar);
  let suma = 0, pico = 0, dd = 0, gana = 0, pierde = 0, brutoG = 0, brutoP = 0;
  for (const r of orden) {
    suma += r.r;
    if (r.r > 0) { gana++; brutoG += r.r; } else { pierde++; brutoP += -r.r; }
    if (suma > pico) pico = suma;
    if (pico - suma > dd) dd = pico - suma;
  }
  return {
    n,
    esperanza: suma / n,
    suma,
    acierto: gana / n,
    pf: brutoP > 0 ? brutoG / brutoP : null,
    maxDD: dd,
    ganadoras: gana,
    perdedoras: pierde,
  };
}

const r2 = (x) => (Number.isFinite(x) ? x.toFixed(3) : '—');
const pct = (x) => (Number.isFinite(x) ? (x * 100).toFixed(1) + ' %' : '—');
const pf = (x) => (x === null ? '—' : x.toFixed(2));

function tabla(cabeceras, filas) {
  return [
    '| ' + cabeceras.join(' | ') + ' |',
    '|' + cabeceras.map(() => '---').join('|') + '|',
    ...filas.map((f) => '| ' + f.join(' | ') + ' |'),
  ].join('\n');
}

/* ---------------- análisis ---------------- */
async function main() {
  const series = await cargarSeries({ url, simbolos: soloSimbolo, tfs: soloTf, verbose: true });
  if (!series.length) {
    console.error('No hay series: revisa backtest_hibrida/datos o pasa --url');
    process.exit(1);
  }
  console.log(`\n${series.length} series · ${series.reduce((a, s) => a + s.velas.length, 0)} velas`);

  const filtros = {};
  const seriesInfo = [];
  const regs = { base: [], sinReset: [], soloEntradas: [], sinResetSoloEntradas: [],
    sinCuerpo: [], sinRetesteo: [], anterior: [], conChop: [], conChopSuave: [],
    conChopMedio: [], conChopRoturas: [], conChopSuaveRoturas: [], conChopMedioRoturas: [] };
  let abiertas = 0, ambiguas = 0, sinSimular = 0, etiquetas = 0;
  let ambiguasToques = 0, ambiguasRoturas = 0;
  let sinRiesgoToques = 0, sinRiesgoRoturas = 0;

  for (const { simbolo, tf, velas, fuente } of series) {
    const corte = Math.floor(velas.length * SPLIT);
    const base = escanear(velas, {});
    const sinReset = escanear(velas, { resetTrasEntrada: false });
    const sinCuerpo = escanear(velas, { cuerpoSoloUno: true });
    const sinRetesteo = escanear(velas, { modo2B: 'continuacion' });
    const anterior = escanear(velas, { cuerpoSoloUno: true, modo2B: 'continuacion' });
    const conChop = escanear(velas, { separacionMinAtr: 0.5, pendienteMinAtr: 0.3 });
    const conChopSuave = escanear(velas, { separacionMinAtr: 0.3, pendienteMinAtr: 0.15 });
    const conChopMedio = escanear(velas, { separacionMinAtr: 0.4, pendienteMinAtr: 0.2 });

    for (const [k, v] of Object.entries(base.filtros || {})) filtros[k] = (filtros[k] || 0) + v;

    const añadir = (destino, eventos, contar = false) => {
      for (const ev of eventos) {
        const sim = simular(velas, ev);
        if (!sim) {
          if (contar) {
            sinSimular++;
            if (TOQUES.has(ev.patron)) sinRiesgoToques++; else sinRiesgoRoturas++;
          }
          continue;
        }
        if (sim.abierta) { if (contar) abiertas++; continue; }
        if (sim.ambiguo && contar) {
          ambiguas++;
          if (TOQUES.has(ev.patron)) ambiguasToques++; else ambiguasRoturas++;
        }
        destino.push({
          simbolo, tf, bar: ev.barIndex, t: velas[ev.barIndex].t,
          lado: ev.lado, patron: ev.patron,
          tramo: ev.barIndex < corte ? 'train' : 'valid',
          r: sim.r, motivo: sim.motivo,
        });
      }
    };

    añadir(regs.base, base.eventos, true);
    añadir(regs.sinReset, sinReset.eventos);
    añadir(regs.sinCuerpo, sinCuerpo.eventos);
    añadir(regs.sinRetesteo, sinRetesteo.eventos);
    añadir(regs.anterior, anterior.eventos);
    añadir(regs.conChop, conChop.eventos);
    añadir(regs.conChopSuave, conChopSuave.eventos);
    añadir(regs.conChopMedio, conChopMedio.eventos);
    añadir(regs.conChopRoturas, conChop.eventos.filter((e) => ROTURAS.has(e.patron)));
    añadir(regs.conChopSuaveRoturas, conChopSuave.eventos.filter((e) => ROTURAS.has(e.patron)));
    añadir(regs.conChopMedioRoturas, conChopMedio.eventos.filter((e) => ROTURAS.has(e.patron)));
    añadir(regs.soloEntradas, base.eventos.filter((e) => !TOQUES.has(e.patron)));
    añadir(regs.sinResetSoloEntradas, sinReset.eventos.filter((e) => !TOQUES.has(e.patron)));

    /* cuántas ETIQUETAS cambia el reset (mismas jugadas, otro sufijo R) */
    const mapaReset = new Map(sinReset.eventos.map((e) => [`${e.barIndex}|${e.lado}`, e.patron]));
    for (const e of base.eventos) {
      const p = mapaReset.get(`${e.barIndex}|${e.lado}`);
      if (p && p !== e.patron) etiquetas++;
    }

    seriesInfo.push({
      simbolo, tf, fuente,
      velas: velas.length,
      desde: velas[0].t, hasta: velas[velas.length - 1].t,
      eventos: base.eventos.length,
    });
  }

  const variantes = {
    'diccionario: cuerpo en las B + retesteo (por defecto)': regs.base,
    'sin retesteo (entrar al quiebre)': regs.sinRetesteo,
    'sin cuerpo en las B': regs.sinCuerpo,
    'como antes: sin cuerpo y sin retesteo': regs.anterior,
    'con filtro anti-rango estricto (0.5/0.3 ATR)': regs.conChop,
    'con filtro anti-rango suave (0.3/0.15 ATR)': regs.conChopSuave,
    'con filtro anti-rango medio (0.4/0.2 ATR)': regs.conChopMedio,
    'roturas + filtro estricto': regs.conChopRoturas,
    'roturas + filtro suave': regs.conChopSuaveRoturas,
    'roturas + filtro medio': regs.conChopMedioRoturas,
    'sin reset tras entrada': regs.sinReset,
    'solo roturas (1/1R/2B/2RB/3B/3RB)': regs.soloEntradas,
    'solo toque (2/2R/3/3R)': regs.base.filter((r) => TOQUES.has(r.patron)),
    'sin reset + solo roturas': regs.sinResetSoloEntradas,
  };

  const porTramo = (rs, tramo) => rs.filter((r) => r.tramo === tramo);
  const filasVariantes = Object.entries(variantes).map(([nombre, rs]) => {
    const m = metricas(rs);
    const tr = metricas(porTramo(rs, 'train'));
    const va = metricas(porTramo(rs, 'valid'));
    return [nombre, m.n, r2(m.esperanza), pct(m.acierto), pf(m.pf), r2(m.suma), r2(m.maxDD),
      `${r2(tr.esperanza)} (n=${tr.n})`, `${r2(va.esperanza)} (n=${va.n})`];
  });

  /* jerarquía de señales: peso operativo por código (calibración 2026-11-14) */
  const TIER = { '3RB': 'A', '2RB': 'A', '1': 'B', '1R': 'B', '3B': 'B',
    '2B': 'C', '3R': 'C', '2': 'C', '2R': 'C', '3': 'C' };
  const PESO = { '3RB': 3, '2RB': 2, '1': 1, '1R': 1, '3B': 1,
    '2B': 0, '3R': 0, '2': 0, '2R': 0, '3': 0 };
  const RECOMENDACION = { A: 'operar con prioridad', B: 'operar con cautela', C: 'evitar' };
  const codigos = [...new Set(regs.base.map((r) => r.patron))].sort();
  const filasJerarquia = codigos
    .map((c) => ({ c, m: metricas(regs.base.filter((r) => r.patron === c)) }))
    .sort((a, b) => b.m.esperanza - a.m.esperanza)
    .map(({ c, m }) => {
      const tier = TIER[c] || '—';
      const peso = PESO[c] !== undefined ? PESO[c] : 0;
      return [`\`${c}\``, tier, peso, m.n, r2(m.esperanza), pf(m.pf), pct(m.acierto),
        RECOMENDACION[tier] || '—'];
    });
  const filasCodigo = codigos.map((c) => {
    const rs = regs.base.filter((r) => r.patron === c);
    const m = metricas(rs);
    const tr = metricas(porTramo(rs, 'train'));
    const va = metricas(porTramo(rs, 'valid'));
    return [`\`${c}\``, ROTURAS.has(c) ? 'toque + rotura' : (TOQUES.has(c) ? 'solo toque' : '—'),
      m.n, r2(m.esperanza), pct(m.acierto), pf(m.pf),
      `${r2(tr.esperanza)} (n=${tr.n})`, `${r2(va.esperanza)} (n=${va.n})`];
  });

  /* por TF y por símbolo (base) */
  const filasTf = soloTf.map((tf) => {
    const m = metricas(regs.base.filter((r) => r.tf === tf));
    return [tf, m.n, r2(m.esperanza), pct(m.acierto), pf(m.pf)];
  });
  const filasSimbolo = soloSimbolo.map((s) => {
    const m = metricas(regs.base.filter((r) => r.simbolo === s));
    return [s, m.n, r2(m.esperanza), pct(m.acierto), pf(m.pf)];
  });

  /* control: qué cambia si el reset se aplicara sólo al salir de la tendencia */
  const filasReset = [...new Set([...regs.base, ...regs.sinReset].map((r) => r.patron))].sort().map((c) => {
    const a = metricas(regs.base.filter((r) => r.patron === c));
    const b = metricas(regs.sinReset.filter((r) => r.patron === c));
    return [`\`${c}\``, a.n, r2(a.esperanza), b.n, r2(b.esperanza)];
  });

  const totalSerie = (campo) => seriesInfo.reduce((a, s) => a + s[campo], 0);
  const fechas = (t) => new Date(t).toISOString().slice(0, 10);

  const md = `# Vídeo 03 — banco de pruebas${parcial ? ' (recorte)' : ''}

Generado por \`node v03-lab/evaluar.mjs${parcial ? ` --tf ${soloTf.join(',')} --simbolo "${soloSimbolo.join(',')}"` : ''}\`
el ${new Date().toISOString().slice(0, 10)}.

Motor: \`motor-senales/nucleo.js\` con sus parámetros actuales
(EMA${PARAMS.emaContacto}/${PARAMS.emaTecho}/${PARAMS.emaFondo}, tolerancia ${PARAMS.tolToqueAtr} ATR,
ventana ${PARAMS.ventanaMin}, caducidad ${PARAMS.caducidad}, cuerpo ${PARAMS.cuerpoMin}/${PARAMS.cuerpoMinAtr} ATR,
reset tras entrada: **${PARAMS.resetTrasEntrada ? 'sí' : 'no'}**).

## Método

- Entrada al **cierre** de la vela de la señal, stop en \`invalida\` (extremo del toque).
- Objetivo **${TP_R}R**, horizonte **${HORIZONTE} velas**; si no toca nada, salida al cierre.
- Stop y objetivo en la misma vela → **stop** (conservador).
- **${Math.round(SPLIT * 100)} % inicial** de cada serie para train, **${Math.round((1 - SPLIT) * 100)} % final** para validación.
- Sin comisiones ni spread (los índices sintéticos del bróker ya los llevan implícitos en el precio).
- Operaciones que no tienen ${HORIZONTE} velas por delante se descartan: ${abiertas}.
- Velas donde stop y objetivo coinciden: ${ambiguas} (se cuentan como stop) —
  ${ambiguasToques} solo toque y ${ambiguasRoturas} toque + rotura.
- Señales sin riesgo válido (stop = entrada): ${sinSimular} — ${sinRiesgoToques} solo toque y ${sinRiesgoRoturas} toque + rotura.

## Series

${seriesInfo.length} series · ${totalSerie('velas')} velas · ${totalSerie('eventos')} señales.
Del ${fechas(Math.min(...seriesInfo.map((s) => s.desde)))} al
${fechas(Math.max(...seriesInfo.map((s) => s.hasta)))}.

## Totales por variante

${tabla(['Variante', 'n', 'Esperanza R', 'Acierto', 'PF', 'Suma R', 'Máx. DD', 'Train', 'Validación'], filasVariantes)}

«Base» y «sin reset tras entrada» dan las mismas operaciones a propósito: el
reset sólo cambia la **etiqueta** de ${etiquetas} de ${totalSerie('eventos')} señales. Lo que se mide con R
no depende del código, así que esa fila sirve para ver cuánto se mueve el reparto
por código, no la rentabilidad.

## Por código (variante base)

${tabla(['Código', 'Tipo', 'n', 'Esperanza R', 'Acierto', 'PF', 'Train', 'Validación'], filasCodigo)}

## Jerarquía de señales (peso operativo)

${tabla(['Código', 'Tier', 'Peso', 'n', 'Esperanza R', 'PF', 'Acierto', 'Recomendación'], filasJerarquia)}

- **Tier A** (operar con prioridad): \`3RB\`, \`2RB\` — únicos con R positivo claro y PF ≥ 1,4.
- **Tier B** (operar con cautela): \`1\`, \`1R\`, \`3B\` — R marginal, PF ~1,0.
- **Tier C** (evitar): \`2B\`, \`2\`, \`2R\`, \`3\`, \`3R\` — R negativo; la \`2B\` solo vale si el
  filtro anti-rango estricto la deja pasar (ver Paso 1).
- La \`2\` y la \`3\` son entradas al toque y rinden negativo: no se operan salvo en
  contextos muy específicos.

## El reset

\`R\` no es un patrón: es el **reseteo de la secuencia 1/2/3**. Cuando una jugada
se consume, la cuenta vuelve a empezar y la siguiente señal puede volver a ser
una 1. El motor ya funciona así (\`resetTrasEntrada: true\`), que es la lectura
del propietario.

La tabla compara esa lectura con la alternativa de resetear sólo cuando el
precio se sale de la tendencia y vuelve. No cambia ninguna operación: cambia la
**etiqueta** de las señales, así que sólo sirve para ver cuánto se mueve el
reparto por código.

${tabla(['Código', 'n (reset tras entrada)', 'Esperanza R', 'n (reset sólo al salir)', 'Esperanza R'], filasReset)}

## Por temporalidad (base)

${tabla(['TF', 'n', 'Esperanza R', 'Acierto', 'PF'], filasTf)}

## Por símbolo (base)

${tabla(['Símbolo', 'n', 'Esperanza R', 'Acierto', 'PF'], filasSimbolo)}

## Por qué se descartan candidatos

Cuenta de **chequeos** (barra × lado), no de señales: sirve para ver qué filtro
muerde más, no para leerlo como número de oportunidades.

${tabla(['Filtro', 'Chequeos'], Object.entries(filtros).sort((a, b) => b[1] - a[1]).map(([k, v]) => ['`' + k + '`', v]))}

## Lectura

- Esto mide **el motor actual**, no una versión ideal. Si un código sale mal, el
  reporte no dice «la idea del vídeo no funciona»: dice que esa codificación, con
  estos parámetros, no ganó en estos datos.
- La muestra por código es pequeña; cualquier esperanza con \`n < 30\` es ruido.
- El edge medido históricamente es fino (PF 1,1–1,2). Tratar el reporte como
  termómetro, no como promesa.
- La 2 y la 3 son entradas al toque, y así se miden. Su esperanza negativa no
dice que la idea falle: dice que entrar al toque sin rotura rinde peor que
esperar la rotura, y que conviene separar los dos grupos al leer los totales.
`;

  writeFileSync(ARCHIVO_MD, md);
  writeFileSync(ARCHIVO_JSON, JSON.stringify({
    generado: new Date().toISOString(),
    parametros: PARAMS,
    metodo: { horizonte: HORIZONTE, tpR: TP_R, split: SPLIT },
    series: seriesInfo,
    variantes: Object.fromEntries(Object.entries(variantes).map(([k, rs]) => [k, metricas(rs)])),
    porCodigo: Object.fromEntries(codigos.map((c) => [c, metricas(regs.base.filter((r) => r.patron === c))])),
    filtros,
  }, null, 2));

  console.log('\n' + tabla(['Variante', 'n', 'Esp. R', 'Acierto', 'PF', 'Suma R', 'Máx. DD', 'Train', 'Validación'], filasVariantes));
  console.log('\n' + tabla(['Código', 'Tipo', 'n', 'Esp. R', 'Acierto', 'PF', 'Train', 'Validación'], filasCodigo));
  console.log(`\nescrito: ${ARCHIVO_MD.replace(AQUI + '/', 'v03-lab/')} y ${ARCHIVO_JSON.replace(AQUI + '/', 'v03-lab/')}`);
}

/* Solo corre el análisis si se ejecuta el archivo; `probar.mjs` importa `simular`. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
