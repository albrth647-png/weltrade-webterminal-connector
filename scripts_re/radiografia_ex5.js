'use strict';
/* ============================================================
   RADIOGRAFÍA FORENSE COMPLETA de un .ex5 (MetaQuotes MT5)
   ------------------------------------------------------------
   Nivel 1 del plan RE: inventario y mapa estructural SIN
   descifrar. Produce un informe técnico completo:
     1. Cabecera: campos con offset/valor/candidatos de sentido
     2. Mapa de entropía por bloques + frontera exacta
        claro->opaco (ventana deslizante de 256 B)
     3. TODOS los strings del archivo (UTF-16LE + ASCII) con
        offset, clasificados
     4. Criptoanálisis del cuerpo: histograma, chi-cuadrado,
        repetición de bloques de 16 (¿ECB?), alineación AES,
        entropía por segmentos
     5. Pruebas de descompresión (zlib/gzip crudo) en offsets
        candidatos
   Uso: node radiografia_ex5.js <archivo.ex5> [salida.json]
   ============================================================ */
const fs = require('fs');

/* ---------- utilidades ---------- */
const H = (buf) => [...buf].map((x) => x.toString(16).padStart(2, '0')).join(' ');
const u32 = (b, o) => (o + 4 <= b.length ? b.readUInt32LE(o) : undefined);
const u16 = (b, o) => (o + 2 <= b.length ? b.readUInt16LE(o) : undefined);

function entropia(seg) {
  if (!seg.length) return 0;
  const c = new Array(256).fill(0);
  for (const x of seg) c[x]++;
  return -c.reduce((a, v) => (v ? a + (v / seg.length) * Math.log2(v / seg.length) : a), 0);
}

/* strings UTF-16LE: secuencias de (printable + 0x00) */
function stringsU16(buf, min = 4) {
  const out = [];
  let ini = -1, s = '';
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const c = buf[i], z = buf[i + 1];
    if (z === 0 && c >= 0x20 && c <= 0x7e) { if (ini < 0) ini = i; s += String.fromCharCode(c); }
    else { if (s.length >= min) out.push({ offset: ini, len: s.length, texto: s }); ini = -1; s = ''; }
  }
  if (s.length >= min) out.push({ offset: ini, len: s.length, texto: s });
  return out;
}

/* strings ASCII de 6+ imprimibles con alguna letra */
function stringsAscii(buf, min = 6) {
  const out = [];
  const re = /[\x20-\x7e]{6,}/g;
  for (const m of buf.toString('latin1').matchAll(re)) {
    if (/[a-zA-Z]{3}/.test(m[0])) out.push({ offset: m.index, len: m[0].length, texto: m[0] });
  }
  return out;
}

/* frontera claro->opaco: ventana de 256 B paso 16; luego salta el
   padding de ceros para dar el byte exacto donde empieza el cifrado */
function fronteraOpaca(buf) {
  const W = 256, P = 16;
  for (let o = 0; o + W <= buf.length; o += P) {
    if (entropia(buf.subarray(o, o + W)) > 7.0) {
      let ini = o;
      while (ini < buf.length && buf[ini] === 0) ini++;   // padding de ceros -> primer byte real
      return { aprox: o, inicioCifrado: ini };
    }
  }
  return { aprox: -1, inicioCifrado: -1 };
}

/* chi-cuadrado contra distribución uniforme */
function chi2(seg) {
  const c = new Array(256).fill(0);
  for (const x of seg) c[x]++;
  const esp = seg.length / 256;
  return c.reduce((a, v) => a + (v - esp) ** 2 / esp, 0);
}

/* repetición de bloques de 16 B (ECB con tabla estática) */
function bloquesRepetidos(seg) {
  const vistos = new Map();
  let rep = 0, total = 0;
  for (let o = 0; o + 16 <= seg.length; o += 16) {
    const k = seg.subarray(o, o + 16).toString('latin1');
    if (vistos.has(k)) rep++;
    vistos.set(k, 1);
    total++;
  }
  return { total, repetidos: rep };
}

/* prueba inflate crudo en un offset */
function pruebaInflate(buf, offset) {
  const { inflateRawSync, inflateSync } = require('zlib');
  for (const [nom, fn] of [['zlib', inflateSync], ['raw', inflateRawSync]]) {
    try {
      const sal = fn(buf.subarray(offset));
      if (sal.length > 64) return { metodo: nom, bytes: sal.length, muestra: sal.subarray(0, 64).toString('hex') };
    } catch (e) { /* sigue */ }
  }
  return null;
}

/* ---------- main ---------- */
function radiografiar(ruta) {
  const buf = fs.readFileSync(ruta);
  const R = { archivo: ruta, tamano: buf.length, sha256: require('crypto').createHash('sha256').update(buf).digest('hex') };

  /* 1. cabecera */
  R.magia = buf.subarray(0, 3).toString('latin1');
  R.versionFormato = buf[3];
  R.campos = {};
  for (const [nom, off] of Object.entries({
    c0x04: 0x04, c0x06: 0x06, c0x08: 0x08, c0x0C: 0x0C, c0x10: 0x10, c0x14: 0x14,
    c0x40: 0x40, c0x48: 0x48, c0x50: 0x50, c0x58: 0x58, c0x5A: 0x5A,
    c0x60: 0x60, c0x64: 0x64, c0x68: 0x68, c0x6C: 0x6C, c0x70: 0x70, c0x74: 0x74, c0x78: 0x78, c0x7C: 0x7C,
  })) R.campos[nom] = { offset: off, hex: H(buf.subarray(off, off + 8)), u32: u32(buf, off), u16: u16(buf, off) };
  /* blobs aleatorios de la cabecera (posibles hashes/claves) */
  R.blobs = {
    hash16_0x20: H(buf.subarray(0x20, 0x30)),
    hash32_0x80: H(buf.subarray(0x80, 0xA0)),
    cola0xA0: H(buf.subarray(0xA0, 0xA8)),
    slotAutor0xA8: buf.subarray(0xA8, 0x1A8).toString('utf16le').replace(/\0.*$/, ''),
    slotLink0x1A8: buf.subarray(0x1A8, 0x2A8).toString('utf16le').replace(/\0.*$/, ''),
    slotVersion0x2A8: buf.subarray(0x2A8, 0x2E8).toString('utf16le').replace(/\0.*$/, ''),
  };

  /* 2. entropía */
  R.frontera = fronteraOpaca(buf);
  const iniCif = R.frontera.inicioCifrado >= 0 ? R.frontera.inicioCifrado : 0;
  const BLOQUE = 4096;
  R.mapaEntropia = [];
  for (let o = 0; o < buf.length; o += BLOQUE) {
    const e = entropia(buf.subarray(o, Math.min(buf.length, o + BLOQUE)));
    R.mapaEntropia.push({ offset: o, e: +e.toFixed(2) });
  }
  const cuerpo = buf.subarray(iniCif);
  R.cuerpo = {
    desde: iniCif, bytes: cuerpo.length, entropia: +entropia(cuerpo).toFixed(3),
    chi2: +chi2(cuerpo.subarray(0, 65536)).toFixed(0),
    bloques16: bloquesRepetidos(cuerpo),
    alineacionAES: (cuerpo.length % 16 === 0) ? 'múltiplo de 16' : `resto ${(cuerpo.length % 16)}`,
    segmentos: [0, 0.25, 0.5, 0.75].map((f) => ({
      en: Math.floor(cuerpo.length * f), e: +entropia(cuerpo.subarray(Math.floor(cuerpo.length * f), Math.floor(cuerpo.length * f) + 4096)).toFixed(2),
    })),
  };

  /* 3. strings de TODO el archivo */
  R.stringsU16 = stringsU16(buf, 4);
  R.stringsAscii = stringsAscii(buf, 6).filter((s) => !R.stringsU16.some((u) => Math.abs(u.offset - s.offset) < 8));
  /* clasificación */
  const clasifica = (t) => {
    if (/^https?:\/\//i.test(t)) return 'url';
    if (/^\d+\.\d+$/.test(t)) return 'version';
    if (/oninit|ontick|ondeinit|ontrade|ontimer|ontester|onchartevent/i.test(t)) return 'handler_mql5';
    if (/copyright|link|version|author/i.test(t)) return 'propiedad';
    return 'otro';
  };
  R.stringsU16.forEach((s) => (s.clase = clasifica(s.texto)));
  R.stringsAscii.forEach((s) => (s.clase = clasifica(s.texto)));

  /* 4. pruebas de descompresión en offsets candidatos */
  R.inflates = [];
  for (const off of [iniCif, iniCif + 4, iniCif + 16, 0x400, 0x440]) {
    if (off < 0 || off >= buf.length) continue;
    const r = pruebaInflate(buf, off);
    if (r) R.inflates.push({ offset: off, ...r });
  }

  /* 5. cola del archivo: ¿trailer con tabla de secciones? */
  R.cola = { hex: H(buf.subarray(Math.max(0, buf.length - 64))) };

  return R;
}

/* ---------- informe legible ---------- */
function informe(R) {
  const L = [];
  L.push(`# Radiografía forense: ${R.archivo}`);
  L.push(`SHA-256: \`${R.sha256}\`  ·  Tamaño: ${R.tamano} bytes (${(R.tamano / 1024).toFixed(1)} KB)`);
  L.push(`\n## 1. Cabecera`);
  L.push(`- Magia: "${R.magia}" · versión de formato: ${R.versionFormato}`);
  for (const [k, v] of Object.entries(R.campos)) L.push(`- ${k} @0x${v.offset.toString(16)}: u32=${v.u32} (0x${(v.u32 ?? 0).toString(16)}) · bytes: ${v.hex.slice(0, 23)}`);
  L.push(`\n### Blobs y slots de la cabecera`);
  L.push(`- hash16 @0x20: ${R.blobs.hash16_0x20}`);
  L.push(`- hash32 @0x80: ${R.blobs.hash32_0x80}`);
  L.push(`- cola @0xA0: ${R.blobs.cola0xA0}`);
  L.push(`- autor @0xA8: "${R.blobs.slotAutor0xA8}"`);
  L.push(`- link @0x1A8: "${R.blobs.slotLink0x1A8}"`);
  L.push(`- versión @0x2A8: "${R.blobs.slotVersion0x2A8}"`);
  L.push(`\n## 2. Entropía`);
  L.push(`- Frontera aproximada claro->opaco (ventana 256 B, umbral 7.0): 0x${R.frontera.aprox.toString(16)}`);
  L.push(`- Inicio real del cuerpo cifrado (tras el padding de ceros): **0x${R.frontera.inicioCifrado.toString(16)}** (${R.frontera.inicioCifrado})`);
  L.push(`- Cuerpo opaco: ${R.cuerpo.bytes} bytes (${(100 * R.cuerpo.bytes / R.tamano).toFixed(1)}% del archivo) desde 0x${R.cuerpo.desde.toString(16)}`);
  L.push(`- Entropía media del cuerpo: ${R.cuerpo.entropia} bits/byte (8 = aleatorio perfecto)`);
  L.push(`- Chi-cuadrado (64 KB): ${R.cuerpo.chi2} (uniforme ideal ≈ 255; >1000 = sesgo detectable)`);
  L.push(`- Bloques de 16 B: ${R.cuerpo.bloques16.repetidos}/${R.cuerpo.bloques16.total} repetidos → ${R.cuerpo.bloques16.repetidos ? 'patrón ECB/table' : 'sin repetición (CBC/CTR o comprimido)'}`);
  L.push(`- Alineación: ${R.cuerpo.alineacionAES}`);
  L.push(`- Entropía por segmentos: ${R.cuerpo.segmentos.map((s) => `0x${(R.cuerpo.desde + s.en).toString(16)}=${s.e}`).join(' · ')}`);
  const saltos = [];
  for (let i = 1; i < R.mapaEntropia.length; i++) if (Math.abs(R.mapaEntropia[i].e - R.mapaEntropia[i - 1].e) > 1.5) saltos.push(`0x${R.mapaEntropia[i].offset.toString(16)} (${R.mapaEntropia[i - 1].e}→${R.mapaEntropia[i].e})`);
  L.push(`- Saltos bruscos de entropía entre bloques de 4 KB: ${saltos.length ? saltos.join(', ') : 'ninguno (homogéneo)'}`);
  L.push(`\n## 3. Strings`);
  const lista = (arr, titulo) => {
    L.push(`\n### ${titulo} (${arr.length})`);
    for (const s of arr.slice(0, 60)) L.push(`- @0x${s.offset.toString(16)} [${s.clase}] "${s.texto.slice(0, 90)}"`);
    if (arr.length > 60) L.push(`- … y ${arr.length - 60} más`);
  };
  lista(R.stringsU16.filter((s) => s.clase !== 'otro'), 'UTF-16LE clasificados');
  lista(R.stringsU16.filter((s) => s.clase === 'otro'), 'UTF-16LE restantes');
  lista(R.stringsAscii, 'ASCII');
  L.push(`\n## 4. Descompresión`);
  L.push(R.inflates.length ? R.inflates.map((r) => `- ✅ ${r.metodo} válido @0x${r.offset.toString(16)}: ${r.bytes} bytes`).join('\n') : '- ❌ ningún offset candidato produjo un stream zlib/gzip válido → el cuerpo NO va comprimido con zlib estándar (cifrado propio del terminal)');
  L.push(`\n## 5. Cola del archivo (últimos 64 B)`);
  L.push('```'); L.push(R.cola.hex); L.push('```');
  return L.join('\n');
}

const ruta = process.argv[2];
if (!ruta) { console.error('uso: node radiografia_ex5.js <archivo.ex5> [salida.md]'); process.exit(1); }
const R = radiografiar(ruta);
const texto = informe(R);
console.log(texto);
if (process.argv[3]) fs.writeFileSync(process.argv[3], texto + '\n');
