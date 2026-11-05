// Descifra la sesión completa del WebTerminal: handshake estático -> clave de sesión -> login + datos
const fs = require('fs');
const crypto = require('crypto');

const OBF = '13ef13b2b76dd8:5795gdcfb2fdc1ge85bf768f54773d22fff996e3ge75g5:75';
const obfuscation = (e) => e.split('').map((ch) => ch.charCodeAt(0) === 28 ? '&' : ch.charCodeAt(0) === 23 ? '!' : String.fromCharCode(ch.charCodeAt(0) - 1)).join('');
const hexToBuffer = (e) => Buffer.from((e.match(/.{2}/g) || []).map((x) => parseInt(x, 16)));
const STATIC_KEY = hexToBuffer(obfuscation(OBF));

function aesDec(key, payload) {
  const iv = Buffer.alloc(16);
  const d = crypto.createDecipheriv('aes-256-cbc', key, iv);
  d.setAutoPadding(true); // WebCrypto elimina PKCS#7
  return Buffer.concat([d.update(payload), d.final()]);
}
const parsePacket = (b) => ({
  cmd: b.readUInt16LE(2),
  dd: b[4],
  body: b.subarray(5),
  r0: b[0], r1: b[1],
});

const lines = fs.readFileSync('/home/z/my-project/re/ws_frames_full.log', 'utf8').split('\n').filter(Boolean);
const frames = lines.map((l) => {
  const m = l.match(/^(TX|RX)#(\d+) (\d+)B hex=([0-9a-f]*)/);
  return m ? { dir: m[1], n: +m[2], buf: Buffer.from(m[4], 'hex') } : null;
}).filter(Boolean);

const out = [];
let sessionKey = null;

for (const f of frames) {
  const totalLen = f.buf.readUInt32LE(0);
  const flags = f.buf.readUInt32LE(4);
  const payload = f.buf.subarray(8);
  let rec = { dir: f.dir, n: f.n, bytes: f.buf.length, len: totalLen, flags, ok: false };
  try {
    const key = f.n === 1 || f.n === 2 ? STATIC_KEY : sessionKey;
    if (!key) { rec.note = 'sin clave de sesion'; out.push(rec); continue; }
    const pt = aesDec(key, payload);
    const p = parsePacket(pt);
    rec.cmd = p.cmd; rec.dd = p.dd; rec.bodyLen = p.body.length; rec.ok = true;
    rec.bodyHex = p.body.subarray(0, 120).toString('hex');
    // intento de extraccion de strings utf16le y ascii
    const s16 = p.body.toString('utf16le').replace(/[^\x20-\x7e]{2,}/g, '|').slice(0, 120);
    const s8 = p.body.toString('latin1').replace(/[^\x20-\x7e]{2,}/g, '|').slice(0, 120);
    rec.utf16 = s16; rec.ascii = s8;
    if (f.dir === 'RX' && f.n === 2) {
      const body = p.body;
      rec.es = body.readUInt16LE(0);
      rec.is64 = body.subarray(2, 66).toString('hex');
      sessionKey = body.subarray(66, 98);
      rec.sessionKey = sessionKey.toString('hex');
      console.log('=== HANDSHAKE RX#2 ===');
      console.log('es (u16):', rec.es);
      console.log('is64:', rec.is64);
      console.log('CLAVE DE SESION:', rec.sessionKey);
    }
  } catch (e) {
    rec.err = e.message.slice(0, 60);
  }
  out.push(rec);
}

fs.writeFileSync('/home/z/my-project/re/session_decoded.json', JSON.stringify(out, null, 1));
console.log('\n=== RESUMEN DE COMANDOS ===');
const seen = new Set();
for (const r of out) {
  if (!r.ok) { console.log(`${r.dir}#${r.n} ${r.bytes}B SIN DESCIFRAR ${r.err || r.note || ''}`); continue; }
  const k = `${r.dir}|cmd=${r.cmd}`;
  const line = `${r.dir}#${r.n} ${r.bytes}B cmd=${r.cmd} dd=${r.dd} body=${r.bodyLen}B utf16="${(r.utf16 || '').slice(0, 70)}"`;
  if (seen.has(k) && r.cmd >= 100) continue;
  seen.add(k);
  console.log(line.slice(0, 200));
}
