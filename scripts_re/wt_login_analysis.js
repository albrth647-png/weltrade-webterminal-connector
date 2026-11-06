// Analiza el cuerpo completo del comando de LOGIN (cmd=28) y de los ticks (cmd=8)
const fs = require('fs');
const crypto = require('crypto');

const OBF = '13ef13b2b76dd8:5795gdcfb2fdc1ge85bf768f54773d22fff996e3ge75g5:75';
const obfuscation = (e) => e.split('').map((ch) => ch.charCodeAt(0) === 28 ? '&' : ch.charCodeAt(0) === 23 ? '!' : String.fromCharCode(ch.charCodeAt(0) - 1)).join('');
const STATIC_KEY = Buffer.from((obfuscation(OBF).match(/.{2}/g) || []).map((x) => parseInt(x, 16)));
const aesDec = (key, payload) => {
  const d = crypto.createDecipheriv('aes-256-cbc', key, Buffer.alloc(16));
  d.setAutoPadding(true);
  return Buffer.concat([d.update(payload), d.final()]);
};

const lines = fs.readFileSync('/home/z/my-project/re/ws_frames_full.log', 'utf8').split('\n').filter(Boolean);
const frames = lines.map((l) => {
  const m = l.match(/^(TX|RX)#(\d+) (\d+)B hex=([0-9a-f]*)/);
  return m ? { dir: m[1], n: +m[2], buf: Buffer.from(m[4], 'hex') } : null;
}).filter(Boolean);

// reconstruir clave de sesion
let sessionKey = null;
const packets = [];
for (const f of frames) {
  const payload = f.buf.subarray(8);
  const key = f.n <= 2 ? STATIC_KEY : sessionKey;
  if (!key) continue;
  try {
    const pt = aesDec(key, payload);
    const pkt = { dir: f.dir, n: f.n, cmd: pt.readUInt16LE(2), dd: pt[4], body: pt.subarray(5) };
    if (f.dir === 'RX' && f.n === 2) sessionKey = pkt.body.subarray(66, 98);
    packets.push(pkt);
  } catch (e) {}
}

const login = process.env.WT_LOGIN || '10000000';
const hexView = (b, width = 32) => {
  let out = '';
  for (let i = 0; i < Math.min(b.length, 1024); i += width) {
    const chunk = b.subarray(i, i + width);
    const hex = chunk.toString('hex').match(/.{4}/g)?.join(' ') || '';
    const ascii = chunk.toString('latin1').replace(/[^\x20-\x7e]/g, '.');
    out += `${String(i).padStart(4, '0')}  ${hex.padEnd(width * 2 + width / 2)}  ${ascii}\n`;
  }
  return out;
};

// 1) LOGIN completo (TX cmd=28)
const txLogin = packets.find((p) => p.dir === 'TX' && p.cmd === 28);
if (txLogin) {
  const b = txLogin.body;
  fs.writeFileSync('/home/z/my-project/re/login_body.bin', b);
  console.log(`=== TX LOGIN cmd=28 body=${b.length}B ===`);
  console.log(hexView(b));
  // buscar el login en varias codificaciones
  for (const enc of ['utf16le', 'latin1']) {
    const idx = b.toString(enc).indexOf(login);
    console.log(`login "${login}" en ${enc}: offset ${idx}`);
  }
}

// 2) RESPUESTA de login (RX cmd=28)
const rxLogin = packets.find((p) => p.dir === 'RX' && p.cmd === 28);
if (rxLogin) {
  console.log(`\n=== RX AUTH RESPUESTA body=${rxLogin.body.length}B ===`);
  console.log(hexView(rxLogin.body, 32));
}

// 3) Un frame de ticks (RX cmd=8)
const tick = packets.find((p) => p.dir === 'RX' && p.cmd === 8 && p.body.length === 500);
if (tick) {
  console.log(`\n=== RX TICKS cmd=8 body=${tick.body.length}B (muestra) ===`);
  console.log(hexView(tick.body, 32));
}
