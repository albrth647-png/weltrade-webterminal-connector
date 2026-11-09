'use strict';
/* ============================================================
   DOCUMENTO DE ESTRATEGIA — esquema + validador ESTRICTO
   ------------------------------------------------------------
   La estrategia vive en DOCUMENTOS (JSON, o .md/.txt con un
   bloque ```json), NUNCA en el código. Este archivo solo conoce
   el ESQUEMA (qué campos existen y sus tipos/rangos): no contiene
   ningún valor de estrategia. Un documento incompleto se rechaza
   con la lista exacta de lo que falta.

   Documento de referencia: estrategias/raptor_default.json
   ============================================================ */

const TFS_VALIDAS = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];
const INDICADORES_ZONA = ['fractales'];
const INDICADORES_SESGO = ['ema'];

/* Esquema: [ruta, tipo, min, max] — vocabulario, no estrategia */
const ESQUEMA = [
  ['meta.nombre', 'string', 1, 80],
  ['meta.version', 'int', 1, 999],
  ['zonas.activo', 'bool'],
  ['zonas.tf', 'tf'],
  ['zonas.indicador', 'enum:' + INDICADORES_ZONA.join(',')],
  ['zonas.alas', 'int', 1, 10],
  ['zonas.tolPivoteAtr', 'num', 0, 10],
  ['zonas.tolPivoteRel', 'num', 0, 0.1],
  ['zonas.vigenciaHoras', 'num', 1, 24 * 30],
  ['toques.tf', 'tf'],
  ['toques.bandaAtr', 'num', 0.01, 5],
  ['toques.excursionAtr', 'num', 0, 10],
  ['toques.fases.EARLY', 'num', 0, 100],
  ['toques.fases.MAIN', 'num', 0, 100],
  ['toques.fases.LATE', 'num', 0, 100],
  ['tn.activo', 'bool'],
  ['tn.atr', 'num', 0.01, 10],
  ['sesgo.activo', 'bool'],
  ['sesgo.tf', 'tf'],
  ['sesgo.indicador', 'enum:' + INDICADORES_SESGO.join(',')],
  ['sesgo.periodo', 'int', 2, 400],
  ['sesgo.velasPendiente', 'int', 1, 50],
  ['gatillo.direccional', 'bool'],
  ['score.min', 'num', 0, 100],
  ['score.pesoFuerzaMax', 'num', 0, 100],
  ['score.pesoFuerzaPorPivote', 'num', 0, 100],
  ['score.pesoSesgo', 'num', 0, 100],
  ['score.pesoGatillo', 'num', 0, 100],
  ['dedup.minutos', 'num', 0, 1440],
  ['riesgo.slAtr', 'num', 0.1, 20],
  ['riesgo.tpAtr', 'num', 0.1, 20],
  ['atr.periodo', 'int', 2, 200],
  // tope alto: un mes de M5 son 8.640 velas (y de M1, 43.200)
  ['maxVelas.M1', 'int', 50, 50000], ['maxVelas.M5', 'int', 50, 50000],
  ['maxVelas.M15', 'int', 50, 50000], ['maxVelas.M30', 'int', 50, 50000],
  ['maxVelas.H1', 'int', 50, 50000], ['maxVelas.H4', 'int', 50, 50000],
  ['maxVelas.D1', 'int', 50, 50000],
];

const _toma = (obj, ruta) => ruta.split('.').reduce((a, k) => (a == null ? undefined : a[k]), obj);
const _pon = (obj, ruta, v) => { const ks = ruta.split('.'); const u = ks.pop(); ks.reduce((a, k) => (a[k] = a[k] || {}), obj)[u] = v; };

/* Validación ESTRICTA: todo campo del esquema debe existir y ser
   válido. Devuelve { ok, errores[], doc?, avisos? } */
function validarDoc(entrada) {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
    return { ok: false, errores: ['el documento debe ser un objeto JSON (mira estrategias/raptor_default.json)'] };
  }
  const errores = [];
  const avisos = [];
  const doc = JSON.parse(JSON.stringify(entrada));
  const tipo = (v, t) => {
    if (t === 'bool') return typeof v === 'boolean';
    if (t === 'int') return Number.isInteger(v);
    if (t === 'num') return typeof v === 'number' && Number.isFinite(v);
    if (t === 'tf') return TFS_VALIDAS.includes(v);
    if (t === 'string') return typeof v === 'string' && v.length > 0;
    if (t && t.startsWith('enum:')) return typeof v === 'string' && t.slice(5).split(',').includes(v);
    return false;
  };
  for (const [ruta, t, min, max] of ESQUEMA) {
    const v = _toma(doc, ruta);
    if (v === undefined) { errores.push(`falta "${ruta}"`); continue; }
    if (!tipo(v, t)) { errores.push(`"${ruta}" debe ser ${t} (obtuvo: ${JSON.stringify(v)})`); continue; }
    if (min !== undefined && typeof v === 'number') {
      if (v < min || v > max) { errores.push(`"${ruta}" fuera de rango [${min}..${max}] (obtuvo: ${v})`); continue; }
    }
    if (t === 'string' && typeof v === 'string' && (max !== undefined || min !== undefined)) {
      const lim = max ?? 80;
      if (v.length > lim) { errores.push(`"${ruta}" excede ${lim} caracteres`); _pon(doc, ruta, v.slice(0, lim)); }
    }
  }
  // claves desconocidas -> aviso (no bloquean)
  const planas = [];
  (function aplana(o, pre) { for (const [k, v] of Object.entries(o || {})) { const r = pre ? `${pre}.${k}` : k; if (v && typeof v === 'object' && !Array.isArray(v)) aplana(v, r); else planas.push(r); } })(doc, '');
  for (const r of planas) if (!_toma(Object.fromEntries(ESQUEMA.map((e) => [e[0], 1])), r)) avisos.push(`campo desconocido "${r}" (se ignora)`);
  if (errores.length) return { ok: false, errores, avisos };
  if (!doc.meta) doc.meta = {};
  return { ok: true, errores: [], avisos, doc };
}

/* Documento -> configuración del motor (estrategia.js) */
function docACfg(doc) {
  return {
    /* nombre legible de la estrategia: viaja en la señal para que el
       mensaje de Telegram diga QUÉ estrategia la generó */
    nombre: `${doc.meta.nombre} v${doc.meta.version}`,
    simbolos: Array.isArray(doc.simbolos) ? doc.simbolos.slice() : [],
    tfZona: doc.zonas.tf, alasPivote: doc.zonas.alas,
    tolPivoteAtr: doc.zonas.tolPivoteAtr, tolPivoteRel: doc.zonas.tolPivoteRel,
    vigenciaHoras: doc.zonas.vigenciaHoras,
    tfToque: doc.toques.tf, bandaToqueAtr: doc.toques.bandaAtr,
    excursionAtr: doc.toques.excursionAtr, pesoFase: { ...doc.toques.fases },
    tnActivo: doc.tn.activo, tnAtr: doc.tn.atr,
    sesgoActivo: doc.sesgo.activo, tfSesgo: doc.sesgo.tf, emaH1: doc.sesgo.periodo,
    emaVelasPendiente: doc.sesgo.velasPendiente,
    gatilloDireccional: doc.gatillo.direccional,
    scoreMin: doc.score.min, pesoFuerzaMax: doc.score.pesoFuerzaMax,
    pesoFuerzaPorPivote: doc.score.pesoFuerzaPorPivote, pesoSesgo: doc.score.pesoSesgo,
    pesoGatillo: doc.score.pesoGatillo,
    dedupMin: doc.dedup.minutos,
    slAtr: doc.riesgo.slAtr, tpAtr: doc.riesgo.tpAtr, atrPeriodo: doc.atr.periodo,
    maxVelas: { ...doc.maxVelas },
  };
}

/* Resumen legible para /estado y la UI */
function resumenDoc(doc) {
  return {
    nombre: doc.meta.nombre,
    version: doc.meta.version,
    simbolos: doc.simbolos,
    zonas: `${doc.zonas.indicador}(alas ${doc.zonas.alas}) en ${doc.zonas.tf}${doc.zonas.activo ? '' : ' [OFF]'}`,
    toques: `banda ${doc.toques.bandaAtr}×ATR en ${doc.toques.tf} · fases E/M/L ${doc.toques.fases.EARLY}/${doc.toques.fases.MAIN}/${doc.toques.fases.LATE}`,
    sesgo: doc.sesgo.activo ? `${doc.sesgo.indicador.toUpperCase()}(${doc.sesgo.periodo}) en ${doc.sesgo.tf}` : 'sin filtro de sesgo',
    tn: doc.tn.activo ? `${doc.tn.atr}×ATR` : 'off',
    score: `min ${doc.score.min} · fuerza ${doc.score.pesoFuerzaMax} · sesgo ${doc.score.pesoSesgo} · gatillo ${doc.score.pesoGatillo}`,
    riesgo: `SL ${doc.riesgo.slAtr}×ATR · TP ${doc.riesgo.tpAtr}×ATR · dedup ${doc.dedup.minutos} min`,
  };
}

module.exports = { TFS_VALIDAS, ESQUEMA, validarDoc, docACfg, resumenDoc };
