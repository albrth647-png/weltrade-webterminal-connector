'use strict';
/* ============================================================
   RADIOGRAFÍA DE BOTS MT5 — lado PWA (100 % en el navegador)
   ------------------------------------------------------------
   El botón "Radiografía" de la app lee el documento de un bot
   adversario (familia MT5: .mt5/.ex5/.ex4/.set/.tpl/.mq5/...)
   SIN enviarlo a ningún servidor y responde:

     - binario EX5/EX4  -> radiografía de cabecera: autor, link,
       versión, frontera claro/cifrado, entropía, chi², ECB.
       El cuerpo del bot va cifrado por MetaQuotes: aquí NO hay
       reglas legibles (ver docs/EX5_GoldRush_radiografia.md).
     - texto .set/.tpl/.mq5/.json/.md -> se extrae la anatomía
       legible (inputs, indicadores, órdenes, pares).

   NUNCA inventa estrategia: solo informa de lo observado.
   Espejo browser del importador del motor (motor-senales/
   importador.js) — mismos umbrales, mismos slots de cabecera.
   ============================================================ */

const TEXTO_EXTS = new Set(['json', 'md', 'txt', 'markdown', 'set', 'tpl', 'mq5', 'mq4', 'mqh', 'mqd', 'inc']);

const extension = (n) => (String(n || '').match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();

const esTexto = (u8) => {
  let raro = 0;
  for (let i = 0; i < Math.min(2048, u8.length); i++) {
    const x = u8[i];
    if (x < 9 || (x > 13 && x < 32)) raro++;
  }
  return raro < 8;
};

const entropia = (u8) => {
  if (!u8.length) return 0;
  const c = new Array(256).fill(0);
  for (const x of u8) c[x]++;
  return -c.reduce((a, v) => (v ? a + (v / u8.length) * Math.log2(v / u8.length) : a), 0);
};

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

/* ---------- radiografía de binarios EX5/EX4 ---------- */
function radiografiarBinario(nombre, u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const u32 = (o) => (o + 4 <= u8.length ? dv.getUint32(o, true) : 0);
  const u16 = (o) => (o + 2 <= u8.length ? dv.getUint16(o, true) : 0);
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

  const magia = String.fromCharCode(u8[0], u8[1], u8[2]);
  const h = { tipo: magia === 'EX5' ? 'EX5 (MT5)' : magia === 'EX4' ? 'EX4 (MT4)' : 'formato no reconocido por cabecera' };

  if (magia === 'EX5') {
    h.versionFormato = u8[3];
    h.camposCabecera = { c0x08: u32(0x08), c0x0E: u16(0x0E), c0x10: u32(0x10), c0x40: u32(0x40), c0x60: u32(0x60), c0x64: u32(0x64) };
    const ts = u32(0xA0);
    if (ts > 946684800 && ts < 2051222400) h.compilado = new Date(ts * 1000).toISOString().slice(0, 10) + ' (interpretación probable)';
    const autor = utf16Slot(0xA8), link = utf16Slot(0x1A8), verPrograma = utf16Slot(0x2A8);
    if (autor) h.autor = autor;
    if (link) h.link = link;
    if (verPrograma) h.versionPrograma = verPrograma;
    const extra = [];
    for (let o = 0; o < Math.min(4096, u8.length) - 8; o++) {
      let s = '';
      while (o + 1 < Math.min(4096, u8.length)) {
        const c = u8[o] + 256 * u8[o + 1];
        if (c >= 32 && c <= 126 && u8[o + 1] === 0) { s += String.fromCharCode(c); o += 2; } else break;
      }
      if (s.length >= 4 && ![autor, link, verPrograma].includes(s)) extra.push(s);
    }
    if (extra.length) h.stringsExtra = extra;
  } else {
    // EX4 (legado): strings ASCII/UTF-16 sueltos en todo el archivo
    const ascii = [];
    let cur = '';
    for (let i = 0; i < u8.length; i++) {
      const c = u8[i];
      if (c >= 32 && c <= 126) cur += String.fromCharCode(c);
      else { if (cur.length >= 6 && /[a-zA-Z]{3}/.test(cur)) ascii.push(cur); cur = ''; }
    }
    if (cur.length >= 6 && /[a-zA-Z]{3}/.test(cur)) ascii.push(cur);
    h.stringsTexto = ascii.slice(0, 40);
  }

  // frontera claro/cifrado: primera ventana de 256 B con entropía > 7
  let frontera = -1;
  for (let o = 0; o + 256 <= u8.length; o += 16) {
    if (entropia(u8.subarray(o, o + 256)) > 7.0) {
      frontera = o;
      while (frontera < u8.length && u8[frontera] === 0) frontera++;
      break;
    }
  }
  if (frontera >= 0) h.fronteraCifrada = frontera;

  const cuerpo = u8.subarray(frontera >= 0 ? frontera : 0);
  const nBloques = 8;
  const paso = Math.max(1, Math.floor(cuerpo.length / nBloques));
  let e = 0;
  for (let k = 0; k < nBloques; k++) e += entropia(cuerpo.subarray(k * paso, Math.min(cuerpo.length, (k + 1) * paso)));
  e /= nBloques;
  h.entropia = +e.toFixed(2);
  h.tamanoBytes = u8.length;

  if (cuerpo.length >= 4096) {
    const vistos = new Set();
    let rep = 0, total = 0;
    for (let o = 0; o + 16 <= cuerpo.length; o += 16) {
      let k = '';
      for (let i = 0; i < 16; i++) k += String.fromCharCode(cuerpo[o + i]);
      if (vistos.has(k)) rep++;
      vistos.add(k);
      total++;
    }
    const c = new Array(256).fill(0);
    for (let i = 0; i < Math.min(65536, cuerpo.length); i++) c[cuerpo[i]]++;
    const esp = Math.min(65536, cuerpo.length) / 256;
    const chi2 = Math.round(c.reduce((a, v) => a + ((v - esp) ** 2) / esp, 0));
    h.cripto = {
      bloques16: `${rep}/${total} repetidos`,
      chi2,
      lectura: rep === 0 && chi2 < 1000 ? 'indistinguible del azar: cifrado fuerte (CBC/CTR o propio), no compresión sola' : 'hay estructura detectable: cabe análisis más profundo',
    };
  }

  h.veredicto = e > 7.5
    ? 'cuerpo cifrado de MetaQuotes: SIN reglas legibles sin ingeniería inversa (ruta A: volcado de memoria del terminal — kit en scripts_re/kit_dump_windows/)'
    : 'cuerpo legible al menos en parte — cabe análisis más profundo';
  return h;
}

/* ---------- anatomía de texto (.set/.tpl/.mq5/...) ---------- */
function anatomiaTexto(nombre, texto) {
  const ext = extension(nombre);
  const h = { tipo: 'texto MT5 (' + (ext || 'desconocida') + ')' };

  // documento de estrategia embebido (json)
  const doc = buscarBloqueJson(texto);
  if (doc && doc.zonas && doc.toques) {
    h.documentoEstrategia = { nombre: doc.meta?.nombre || '?', descripcion: String(doc.meta?.descripcion || '').slice(0, 200) };
    h.veredicto = 'contiene un documento de estrategia completo — se puede importar en el panel del motor';
    return h;
  }

  // .tpl: indicadores del gráfico
  if (/<indicator>/.test(texto)) {
    h.simbolo = (texto.match(/<symbol>([^<]*)<\/symbol>/) || [])[1] || '';
    h.indicadores = [...texto.matchAll(/<name>([^<]*)<\/name>/g)].slice(0, 24).map((m) => m[1]);
    h.veredicto = `plantilla con ${h.indicadores.length} indicadores; la plantilla no guarda TF ni reglas`;
    return h;
  }

  // .mq5/.mq4/.mqh: inputs + llamadas a indicadores + órdenes
  const entradas = [...texto.matchAll(/(?:^|\n)\s*s?input\s+[A-Za-z_][\w.]*\s+([A-Za-z_]\w*)\s*=\s*([^;]+);/g)]
    .slice(0, 60).map((m) => `${m[1]}=${m[2].trim()}`);
  const indicadores = [];
  for (const re of [/iMA\s*\(/g, /iATR\s*\(/g, /iFractals\s*\(/g, /iStochastic\s*\(/g, /iRSI\s*\(/g, /iBands\s*\(/g, /iMACD\s*\(/g, /iCCI\s*\(/g, /iSAR\s*\(/g, /iCustom\s*\(/g]) {
    const n = (texto.match(re) || []).length;
    if (n) indicadores.push(`${re.source.replace(/\\s\*\\\(|\(/g, '')}: ${n}`);
  }
  if (entradas.length || indicadores.length) {
    h.entradas = entradas;
    h.indicadores = indicadores;
    h.ordenes = { compra: (texto.match(/ORDER_TYPE_BUY|OP_BUY/g) || []).length, venta: (texto.match(/ORDER_TYPE_SELL|OP_SELL/g) || []).length };
    h.veredicto = `fuente MQL: ${entradas.length} inputs, ${indicadores.length} tipos de indicadores — anatomía legible (no la lógica interna)`;
    return h;
  }

  // .set: pares clave=valor
  const pares = [...texto.matchAll(/^\s*([A-Za-z_]\w*)\s*=\s*([^|\r\n]+)/gm)].slice(0, 80).map((m) => `${m[1]}=${m[2].trim()}`);
  if (pares.length) {
    h.pares = pares;
    h.veredicto = `archivo de parámetros con ${pares.length} pares clave=valor (estilo .set de un Expert)`;
    return h;
  }

  h.veredicto = 'texto reconocido pero sin anatomía de bot ni documento de estrategia dentro';
  return h;
}

/* ---------- dispatcher público ---------- */
export function radiografiar(nombre, arrayBuffer) {
  const u8 = new Uint8Array(arrayBuffer);
  if (!u8.length) return { ok: false, resumen: 'archivo vacío', hallazgos: {} };
  if (u8.length > 8 * 1024 * 1024) return { ok: false, resumen: `archivo demasiado grande (${(u8.length / 1e6).toFixed(1)} MB, máx 8)`, hallazgos: {} };

  const magia = String.fromCharCode(u8[0], u8[1], u8[2]);
  const binarioMT = magia === 'EX5' || magia === 'EX4';
  const ext = extension(nombre);
  const quizasTexto = !binarioMT && (TEXTO_EXTS.has(ext) || esTexto(u8));

  let hallazgos, ok = true;
  if (binarioMT) {
    hallazgos = radiografiarBinario(nombre, u8);
  } else if (quizasTexto) {
    hallazgos = anatomiaTexto(nombre, new TextDecoder('utf-8', { fatal: false }).decode(u8));
  } else {
    return { ok: false, resumen: `archivo binario sin magia EX5/EX4 (empieza por 0x${u8[0].toString(16)} ${u8[1].toString(16)} ${u8[2].toString(16)}) — no es un programa de MT5`, hallazgos: {} };
  }

  const resumen = binarioMT
    ? `Radiografía de ${nombre}: ${hallazgos.tipo}`
      + (hallazgos.autor ? ` · autor: ${hallazgos.autor}` : '')
      + (hallazgos.versionPrograma ? ` · v${hallazgos.versionPrograma}` : '')
      + (hallazgos.fronteraCifrada >= 0 ? ` · zona clara 0x0-0x${hallazgos.fronteraCifrada.toString(16)} (${(100 * hallazgos.fronteraCifrada / u8.length).toFixed(1)}%), resto cifrado` : '')
      + `. ${hallazgos.veredicto}`
    : `${nombre}: ${hallazgos.veredicto}`;

  return { ok, resumen, hallazgos };
}
