'use strict';
/* ============================================================
   IMPORTADOR DE DOCUMENTOS DE ESTRATEGIA
   ------------------------------------------------------------
   Convierte documentos externos en un documento de estrategia
   válido (o en un informe de radiografía, cuando el formato no
   permite más). Formatos aceptados:

     .json/.md/.txt  -> documento directo o bloque ```json
     .set            -> parámetros de un Expert de MT5 (texto)
     .tpl            -> plantilla de gráfico de MT5 (texto)
     .mq5/.mq4/.mqh  -> código fuente: extrae inputs, indicadores
                        (iMA/iATR/iFractals/...) y órdenes
     .ex5/.ex4       -> bot compilado: RADIOGRAFÍA (cabecera:
                        autor, link, versión, build, fecha) — el
                        cuerpo va cifrado; no contiene reglas
                        legibles sin ingeniería inversa del
                        terminal (fase 2)

   NUNCA inventa estrategia: los borradores parten de la
   plantilla neutra (estrategias/raptor_default.json) y solo
   aplican parámetros que se pudieron extraer con certeza.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const { validarDoc } = require('./doc_estrategia');

const PLANTILLA = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'estrategias', 'raptor_default.json'), 'utf8'));
const MAX_BYTES = 8 * 1024 * 1024;

/* ---------- utilidades ---------- */
const extension = (n) => (String(n || '').match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
const limpiarNombre = (n) => String(n || '').replace(/[^\w.\- ]+/g, '_').slice(0, 80) || 'documento';
const esTexto = (buf) => { let raro = 0; for (const x of buf.subarray(0, 2048)) if (x < 9 || (x > 13 && x < 32)) raro++; return raro < 8; };

function buscarBloqueJson(texto) {
  const cerca = texto.match(/```json\s*([\s\S]*?)```/i) || texto.match(/```\s*([\s\S]*?)```/);
  if (cerca) { try { return JSON.parse(cerca[1]); } catch (e) { /* sigue */ } }
  const ini = texto.indexOf('{');
  if (ini >= 0) {
    for (let fin = texto.lastIndexOf('}'); fin > ini; fin = texto.lastIndexOf('}', fin - 1)) {
      try { return JSON.parse(texto.slice(ini, fin + 1)); } catch (e) { /* sigue */ }
    }
  }
  return null;
}

function borradorBase(nombre, descripcion, origen) {
  const d = PLANTILLA();
  d.meta = {
    nombre: (nombre || 'importada').replace(/\.[a-z0-9]+$/i, '').slice(0, 80),
    version: 1,
    descripcion: (descripcion || '').slice(0, 500),
    origen: origen || 'importado',
    creado: new Date().toISOString(),
  };
  return d;
}

function cerrarBorrador(doc, informe) {
  const v = validarDoc(doc);
  if (v.ok) { informe.doc = v.doc; informe.avisos = v.avisos || []; }
  else { informe.ok = false; informe.doc = null; informe.erroresValidacion = v.errores; }
  return informe;
}

/* ---------- .set (parámetros de Expert de MT5, texto plano) ---------- */
const ALIAS_SET = {
  scoremin: 'score.min', dedupmin: 'dedup.minutos', atrperiodo: 'atr.periodo',
  emah1: 'sesgo.periodo', emaperiodo: 'sesgo.periodo', maperiod: 'sesgo.periodo',
  tolpivoteatr: 'zonas.tolPivoteAtr', tolpivoterel: 'zonas.tolPivoteRel',
  bandatoqueatr: 'toques.bandaAtr', excursionatr: 'toques.excursionAtr',
  tnatr: 'tn.atr', slatr: 'riesgo.slAtr', tpatr: 'riesgo.tpAtr',
  pesoearly: 'toques.fases.EARLY', pesomain: 'toques.fases.MAIN', pesolate: 'toques.fases.LATE',
  pesosfuerzamax: 'score.pesoFuerzaMax', pesosfuerzaporpivote: 'score.pesoFuerzaPorPivote',
  pesosesgo: 'score.pesoSesgo', pesogatillo: 'score.pesoGatillo',
  zonasactivo: 'zonas.activo', tnactivo: 'tn.activo', sesgoactivo: 'sesgo.activo',
  gatillodireccional: 'gatillo.direccional', alas: 'zonas.alas', pivotealas: 'zonas.alas',
  vigenciahoras: 'zonas.vigenciaHoras',
};
const _ponerRuta = (doc, ruta, v) => { const ks = ruta.split('.'); const u = ks.pop(); ks.reduce((a, k) => (a[k] = a[k] || {}), doc)[u] = v; };

function importarSet(texto, nombre) {
  const informe = { tipo: 'set', ok: true, resumen: '', hallazgos: { pares: [] }, mapeados: [], sinMapa: [] };
  const doc = borradorBase(nombre, `Borrador desde ${nombre}`, 'set');
  let n = 0;
  for (const linea of texto.split(/\r?\n/)) {
    const l = linea.replace(/^\s*;.*$/, '').trim();           // comentarios ';'
    if (!l || !l.includes('=')) continue;
    const [kRaw, vRaw] = l.split('=', 2);
    const valor = String(vRaw).split('||')[0].trim();         // rangos del optimizador
    const clave = kRaw.trim();
    informe.hallazgos.pares.push({ clave, valor });
    const ruta = ALIAS_SET[clave.toLowerCase().replace(/[^a-z0-9]/g, '')];
    if (!ruta) { if (n || informe.hallazgos.pares.length > 0) informe.sinMapa.push(`${clave}=${valor}`); continue; }
    const num = Number(valor);
    _ponerRuta(doc, ruta, /^(true|false)$/i.test(valor) ? /^true$/i.test(valor) : Number.isFinite(num) ? num : valor);
    informe.mapeados.push(`${clave}=${valor} -> ${ruta}`);
    n++;
  }
  informe.resumen = `${informe.hallazgos.pares.length} parámetros leídos; ${n} mapeados al documento, ${informe.sinMapa.length} sin equivalente`;
  if (!n) { informe.sinMapa.unshift('ningún parámetro coincide con este motor — el .set parece de un bot con otra estructura'); }
  return cerrarBorrador(doc, informe);
}

/* ---------- .tpl (plantilla de gráfico de MT5, texto plano) ---------- */
const METODO_MA = { 0: 'SMA', 1: 'EMA', 2: 'SMMA', 3: 'LWMA' };

function importarTpl(texto, nombre) {
  const informe = { tipo: 'tpl', ok: true, resumen: '', hallazgos: { indicadores: [], simbolo: '' }, mapeados: [], sinMapa: [] };
  const doc = borradorBase(nombre, `Borrador desde plantilla ${nombre}`, 'tpl');
  informe.hallazgos.simbolo = (texto.match(/<symbol>([^<]*)<\/symbol>/) || [])[1] || '';
  const bloques = texto.split('<indicator>').slice(1);
  let emaH1 = null, atr = null, fractales = false;
  for (const b of bloques) {
    const nom = (b.match(/<name>([^<]*)<\/name>/) || [])[1] || '';
    const per = Number((b.match(/<period>(\d+)<\/period>/) || [])[1] || 0);
    const met = (b.match(/<method>(\d+)<\/method>/) || [])[1];
    const esMa = /(^|\W)MA\s*\(/i.test(nom) || /MovingAverage/i.test(nom);
    const esAtr = /ATR/i.test(nom);
    const esFra = /Fractals/i.test(nom);
    informe.hallazgos.indicadores.push({ nombre: nom, periodo: per || null, metodo: METODO_MA[met] || null });
    if (esMa && per) {
      if (METODO_MA[met] === 'EMA' && emaH1 == null) { emaH1 = per; informe.mapeados.push(`${nom} EMA(${per}) -> sesgo.periodo`); }
      else informe.sinMapa.push(`${nom} — media no EMA o adicional (sin equivalente)`);
    } else if (esAtr && per && atr == null) { atr = per; informe.mapeados.push(`ATR(${per}) -> atr.periodo`); }
    else if (esFra) { fractales = true; informe.mapeados.push('Fractals -> zonas.indicador=fractales'); }
    else if (nom) informe.sinMapa.push(`${nom} — sin equivalente en este motor`);
  }
  if (emaH1 != null) doc.sesgo.periodo = emaH1;
  if (atr != null) doc.atr.periodo = atr;
  if (fractales) doc.zonas.indicador = 'fractales';
  informe.resumen = `plantilla con ${informe.hallazgos.indicadores.length} indicadores en el gráfico${informe.hallazgos.simbolo ? ` (símbolo ${informe.hallazgos.simbolo})` : ''}; la plantilla no guarda TF ni reglas — revísalas`;
  return cerrarBorrador(doc, informe);
}

/* ---------- .mq5/.mq4/.mqh (código fuente del bot) ---------- */
const TF_MQL = { PERIOD_M1: 'M1', PERIOD_M5: 'M5', PERIOD_M15: 'M15', PERIOD_M30: 'M30', PERIOD_H1: 'H1', PERIOD_H4: 'H4', PERIOD_D1: 'D1', PERIOD_W1: 'W1', PERIOD_MN1: 'MN1' };
const METODO_MQL = { MODE_SMA: 'SMA', MODE_EMA: 'EMA', MODE_SMMA: 'SMMA', MODE_LWMA: 'LWMA', '0': 'SMA', '1': 'EMA', '2': 'SMMA', '3': 'LWMA' };

function _arg(args, i, resolver) {
  let a = (args[i] || '').trim();
  if (/^_?Period$/i.test(a)) return '?';
  if (resolver && resolver[a] !== undefined) a = String(resolver[a]);
  if (TF_MQL[a]) return TF_MQL[a];
  if (/^-?\d+(\.\d+)?$/.test(a)) return Number(a);
  return a;
}

function importarMq(texto, nombre) {
  const informe = { tipo: extension(nombre), ok: true, resumen: '', hallazgos: { entradas: [], indicadores: [], tfs: [], ordenes: { compra: 0, venta: 0 } }, mapeados: [], sinMapa: [] };
  const doc = borradorBase(nombre, `Borrador desde código fuente ${nombre}`, 'mq');

  for (const m of texto.matchAll(/(?:^|\n)\s*s?input\s+([A-Za-z_][\w.]*)\s+([A-Za-z_]\w*)\s*=\s*([^;]+);/g)) {
    informe.hallazgos.entradas.push({ tipo: m[1], nombre: m[2], valor: m[3].trim() });
  }
  const resolver = {};
  for (const e of informe.hallazgos.entradas) resolver[e.nombre] = e.valor;
  const ver = (nombre, re, extra) => {
    for (const m of texto.matchAll(re)) {
      const args = m[1].split(',').map((s) => s.trim());
      informe.hallazgos.indicadores.push({ indicador: nombre, tf: _arg(args, 1, resolver), ...(extra ? extra(args) : {}) });
    }
  };
  ver('MA', /\biMA\s*\(([^)]*)\)/g, (a) => ({ periodo: _arg(a, 2, resolver), metodo: METODO_MQL[a[4]] || String(a[4] || '') }));
  ver('ATR', /\biATR\s*\(([^)]*)\)/g, (a) => ({ periodo: _arg(a, 2, resolver) }));
  ver('Fractals', /\biFractals\s*\(([^)]*)\)/g, () => ({}));
  ver('Stochastic', /\biStochastic\s*\(([^)]*)\)/g, (a) => ({ k: _arg(a, 2, resolver), d: _arg(a, 3, resolver) }));
  ver('RSI', /\biRSI\s*\(([^)]*)\)/g, (a) => ({ periodo: _arg(a, 2, resolver) }));
  ver('Bands', /\biBands\s*\(([^)]*)\)/g, (a) => ({ periodo: _arg(a, 2, resolver) }));
  ver('MACD', /\biMACD\s*\(([^)]*)\)/g, (a) => ({ rapida: _arg(a, 2, resolver), lenta: _arg(a, 3, resolver) }));
  ver('CCI', /\biCCI\s*\(([^)]*)\)/g, (a) => ({ periodo: _arg(a, 2, resolver) }));
  ver('SAR', /\biSAR\s*\(([^)]*)\)/g, (a) => ({ paso: _arg(a, 2, resolver), max: _arg(a, 3, resolver) }));
  ver('Custom', /\biCustom\s*\(([^)]*)\)/g, (a) => ({ indicadorExterno: String(a[8] || a[9] || '?').replace(/["']/g, '') }));
  for (const m of texto.matchAll(/PERIOD_(M1|M5|M15|M30|H1|H4|D1|W1|MN1)/g)) informe.hallazgos.tfs.push(TF_MQL[m[0]]);
  informe.hallazgos.ordenes.compra = (texto.match(/ORDER_TYPE_BUY|OP_BUY/g) || []).length;
  informe.hallazgos.ordenes.venta = (texto.match(/ORDER_TYPE_SELL|OP_SELL/g) || []).length;

  const ema = informe.hallazgos.indicadores.find((x) => x.indicador === 'MA' && x.metodo === 'EMA' && (x.tf === 'H1' || x.tf === '?'));
  const atrI = informe.hallazgos.indicadores.find((x) => x.indicador === 'ATR' && (typeof x.periodo === 'number'));
  const fra = informe.hallazgos.indicadores.find((x) => x.indicador === 'Fractals');
  if (ema) { doc.sesgo.periodo = ema.periodo; doc.sesgo.tf = ema.tf === '?' ? doc.sesgo.tf : ema.tf; informe.mapeados.push(`iMA EMA(${ema.periodo}, ${ema.tf}) -> sesgo`); }
  if (atrI) { doc.atr.periodo = atrI.periodo; informe.mapeados.push(`iATR(${atrI.periodo}) -> atr.periodo`); }
  if (fra) informe.mapeados.push('iFractals -> zonas.indicador=fractales (ya en plantilla)');
  for (const e of informe.hallazgos.entradas) {
    const clave = e.nombre.toLowerCase();
    const num = Number(e.valor);
    if (/sl|stoploss/i.test(clave) && Number.isFinite(num) && num >= 0.1 && num <= 20) { doc.riesgo.slAtr = num; informe.mapeados.push(`input ${e.nombre}=${e.valor} -> riesgo.slAtr`); }
    else if (/tp|takeprofit/i.test(clave) && Number.isFinite(num) && num >= 0.1 && num <= 20) { doc.riesgo.tpAtr = num; informe.mapeados.push(`input ${e.nombre}=${e.valor} -> riesgo.tpAtr`); }
    else if (!ema && /ema|maperiod|ma_period/i.test(clave) && Number.isFinite(num) && num >= 2 && num <= 400) { doc.sesgo.periodo = num; informe.mapeados.push(`input ${e.nombre}=${e.valor} -> sesgo.periodo`); }
    else if (!atrI && /atr/i.test(clave) && Number.isFinite(num) && num >= 2 && num <= 200) { doc.atr.periodo = num; informe.mapeados.push(`input ${e.nombre}=${e.valor} -> atr.periodo`); }
    else informe.sinMapa.push(`input ${e.nombre}=${e.valor} — sin equivalente seguro (revísalo tú)`);
  }
  const noMapeados = informe.hallazgos.indicadores.filter((x) => !['MA', 'ATR', 'Fractals'].includes(x.indicador));
  for (const x of noMapeados) informe.sinMapa.push(`indicador ${x.indicador}${x.periodo ? `(${x.periodo})` : ''} — este motor no lo reproduce`);

  informe.resumen = `fuente MQL: ${informe.hallazgos.entradas.length} inputs, ${informe.hallazgos.indicadores.length} llamadas a indicadores, órdenes ${informe.hallazgos.ordenes.compra}/${informe.hallazgos.ordenes.venta} (C/V). `
    + 'AVISO: se extrae la ANATOMÍA (parámetros e indicadores), no se ejecuta ni clona su lógica interna — revisa el borrador antes de activar.';
  return cerrarBorrador(doc, informe);
}

/* ---------- .ex5/.ex4 (bot compilado) — radiografía de cabecera ---------- */
function importarEx5(buf, nombre) {
  const informe = { tipo: extension(nombre), ok: true, resumen: '', hallazgos: {}, mapeados: [], sinMapa: [] };
  const magia = buf.subarray(0, 3).toString('latin1');
  const esEx5 = magia === 'EX5';
  const esEx4 = magia === 'EX4';
  informe.hallazgos.tipo = esEx5 ? 'EX5 (MT5)' : esEx4 ? 'EX4 (MT4)' : 'formato no reconocido por cabecera';

  const u32 = (o) => (o + 4 <= buf.length ? buf.readUInt32LE(o) : 0);
  const u16 = (o) => (o + 2 <= buf.length ? buf.readUInt16LE(o) : 0);
  const utf16Slot = (o, max = 256) => {
    let s = '';
    for (let i = 0; i < max; i += 2) {
      const c = u16(o + i);
      if (c === 0) break;
      if (c < 32 || c > 126) return s;
      s += String.fromCharCode(c);
    }
    return s;
  };

  if (esEx5) {
    informe.hallazgos.versionFormato = buf[3];
    informe.hallazgos.marcador1 = u32(8);
    informe.hallazgos.buildCompilador = u32(0x60) || undefined;
    const ts = u32(0xA0);
    if (ts > 946684800 && ts < 2051222400) {                     // 2000..2035 razonable
      informe.hallazgos.compilado = new Date(ts * 1000).toISOString().slice(0, 10) + ' (interpretación probable)';
    }
    const autor = utf16Slot(0xA8), link = utf16Slot(0x1A8), verPrograma = utf16Slot(0x2A8);
    if (autor) informe.hallazgos.autor = autor;
    if (link) informe.hallazgos.link = link;
    if (verPrograma) informe.hallazgos.versionPrograma = verPrograma;
    // strings UTF-16 adicionales en los primeros 4 KB
    const extra = [];
    for (const m of buf.subarray(0, 4096).toString('latin1').matchAll(/(?:[\x20-\x7e]\x00){4,}/g)) {
      const s = m[0].replace(/\x00/g, '');
      if (![autor, link, verPrograma].includes(s)) extra.push(s);
    }
    if (extra.length) informe.hallazgos.stringsExtra = extra;
  } else {
    // EX4 (legado): strings sueltos en todo el archivo
    const txt = buf.toString('latin1');
    const u16txt = [...buf.toString('utf16le').matchAll(/[\x20-\x7e]{6,}/g)].map((m) => m[0]);
    const ascii = [...txt.matchAll(/[\x20-\x7e]{6,}/g)].map((m) => m[0]).filter((s) => /^[ -~]+$/.test(s) && /[a-zA-Z]{3}/.test(s));
    informe.hallazgos.stringsTexto = ascii.slice(0, 40);
    if (u16txt.length) informe.hallazgos.stringsUtf16 = u16txt.slice(0, 40);
  }

  // entropía media del cuerpo (¿cifrado?)
  let e = 0; const bloques = 8; const paso = Math.max(1, Math.floor(buf.length / bloques));
  for (let k = 0; k < bloques; k++) {
    const seg = buf.subarray(k * paso, Math.min(buf.length, (k + 1) * paso));
    const c = new Array(256).fill(0);
    for (const x of seg) c[x]++;
    e += -c.reduce((a, v) => (v ? a + (v / seg.length) * Math.log2(v / seg.length) : a), 0);
  }
  e /= bloques;
  informe.hallazgos.entropia = +e.toFixed(2);
  informe.hallazgos.tamanoBytes = buf.length;

  const cifrado = e > 7.5;
  informe.hallazgos.veredicto = cifrado
    ? 'cuerpo cifrado/comprimido de MetaQuotes: SIN reglas legibles sin ingeniería inversa del terminal (fase 2 con Ghidra + loader propio)'
    : 'cuerpo legible al menos en parte — cabe análisis más profundo';
  informe.resumen = `Radiografía de ${nombre}: ${informe.hallazgos.tipo}`
    + (informe.hallazgos.autor ? ` · autor: ${informe.hallazgos.autor}` : '')
    + (informe.hallazgos.versionPrograma ? ` · v${informe.hallazgos.versionPrograma}` : '')
    + (informe.hallazgos.compilado ? ` · compilado ${informe.hallazgos.compilado}` : '')
    + `. ${informe.hallazgos.veredicto}.`
    + ' El borrador adjunto es la PLANTILLA NEUTRA renombrada — NO refleja la lógica del bot.';
  informe.sinMapa.push('lógica interna del bot: no extraíble en esta fase (binario cifrado)');
  const doc = borradorBase(nombre, `Radiografía de bot compilado ${nombre} — NO es su estrategia`, 'ex5');
  return cerrarBorrador(doc, informe);
}

/* ---------- dispatcher ---------- */
function importarDocumento(nombreArchivo, buf) {
  if (!Buffer.isBuffer(buf) || !buf.length) return { tipo: '?', ok: false, resumen: 'archivo vacío', hallazgos: {}, mapeados: [], sinMapa: [], erroresValidacion: [] };
  if (buf.length > MAX_BYTES) return { tipo: '?', ok: false, resumen: `archivo demasiado grande (${(buf.length / 1e6).toFixed(1)} MB, máx 8)`, hallazgos: {}, mapeados: [], sinMapa: [], erroresValidacion: [] };
  const ext = extension(nombreArchivo);
  const nombre = limpiarNombre(nombreArchivo);

  try {
    if (ext === 'json') {
      const doc = JSON.parse(buf.toString('utf8'));
      const inf = { tipo: 'json', ok: true, resumen: 'documento JSON de estrategia', hallazgos: {}, mapeados: ['documento completo'], sinMapa: [] };
      return cerrarBorrador(doc, inf);
    }
    if (ext === 'md' || ext === 'txt' || ext === 'markdown') {
      const texto = buf.toString('utf8');
      const doc = buscarBloqueJson(texto);
      if (!doc) return { tipo: ext, ok: false, resumen: 'no se encontró un documento de estrategia dentro del texto (busca un bloque ```json o un objeto con "zonas"/"toques"/"score")', hallazgos: {}, mapeados: [], sinMapa: [], erroresValidacion: [] };
      const inf = { tipo: ext, ok: true, resumen: 'documento de estrategia embebido en texto', hallazgos: {}, mapeados: ['bloque json del texto'], sinMapa: [] };
      return cerrarBorrador(doc, inf);
    }
    if (ext === 'set') return importarSet(buf.toString('utf8'), nombre);
    if (ext === 'tpl') return importarTpl(buf.toString('utf8'), nombre);
    if (ext === 'mq5' || ext === 'mq4' || ext === 'mqh') return importarMq(buf.toString('utf8'), nombre);
    if (ext === 'ex5' || ext === 'ex4') return importarEx5(buf, nombre);
    // sin extensión conocida: sniffing
    if (buf.subarray(0, 3).toString('latin1') === 'EX5') return importarEx5(buf, nombre);
    if (esTexto(buf)) {
      const texto = buf.toString('utf8');
      const doc = buscarBloqueJson(texto);
      if (doc) return cerrarBorrador(doc, { tipo: 'texto', ok: true, resumen: 'documento JSON detectado dentro del texto', hallazgos: {}, mapeados: ['json embebido'], sinMapa: [] });
      if (/^(.|\r|\n)*=/.test(texto) && /=/.test(texto)) return importarSet(texto, nombre);
      if (/<indicator>/.test(texto)) return importarTpl(texto, nombre);
      return { tipo: 'texto', ok: false, resumen: 'texto reconocido pero sin documento de estrategia dentro', hallazgos: {}, mapeados: [], sinMapa: [], erroresValidacion: [] };
    }
    return { tipo: ext || '?', ok: false, resumen: `formato "${ext || 'desconocido'}" no soportado — usa .json/.md/.txt/.set/.tpl/.mq5/.mq4/.mqh/.ex5/.ex4`, hallazgos: {}, mapeados: [], sinMapa: [], erroresValidacion: [] };
  } catch (e) {
    return { tipo: ext || '?', ok: false, resumen: 'error al procesar: ' + e.message, hallazgos: {}, mapeados: [], sinMapa: [], erroresValidacion: [] };
  }
}

module.exports = { importarDocumento };
