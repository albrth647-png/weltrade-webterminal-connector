// Estructura exacta: catalogo (cmd=6) y registro de tick (cmd=8)
const fs = require('fs');
const crypto = require('crypto');
const OBF = '13ef13b2b76dd8:5795gdcfb2fdc1ge85bf768f54773d22fff996e3ge75g5:75';
const obf = (e) => e.split('').map((c) => c.charCodeAt(0) === 28 ? '&' : c.charCodeAt(0) === 23 ? '!' : String.fromCharCode(c.charCodeAt(0) - 1)).join('');
const STATIC_KEY = Buffer.from((obf(OBF).match(/.{2}/g) || []).map((x) => parseInt(x, 16)));
const decK = (k, d) => { const c = crypto.createDecipheriv('aes-256-cbc', k, Buffer.alloc(16)); c.setAutoPadding(true); return Buffer.concat([c.update(d), c.final()]); };

const lines = fs.readFileSync('/home/z/my-project/re/ws_frames_full.log', 'utf8').split('\n').filter(Boolean);
const frames = lines.map((l) => { const m = l.match(/^(TX|RX)#(\d+) (\d+)B hex=([0-9a-f]*)/); return m ? { dir: m[1], n: +m[2], buf: Buffer.from(m[4], 'hex') } : null; }).filter(Boolean);
let sess = null; const packets = [];
for (const f of frames) {
  const key = f.n <= 2 ? STATIC_KEY : sess; if (!key) continue;
  try {
    const pt = decK(key, f.buf.subarray(8));
    const p = { dir: f.dir, n: f.n, cmd: pt.readUInt16LE(2), dd: pt[4], body: f.dir === 'TX' ? pt.subarray(4) : pt.subarray(5) };
    if (f.dir === 'RX' && f.n === 2) sess = pt.subarray(5).subarray(66, 98);
    packets.push(p);
  } catch (e) {}
}

// ---- cmd=6 catalogo ----
const cat = packets.find((p) => p.cmd === 6 && p.body.length > 1000);
if (cat) {
  const b = cat.body;
  console.log(`=== CMD=6 catalogo body=${b.length}B ===`);
  console.log('primeros 96B:', b.subarray(0, 96).toString('hex').match(/.{8}/g).join(' '));
  // strings utf16 con offsets
  const text = b.toString('utf16le');
  const re = /(FX Vol \d+|SFX Vol \d+|Synthetics[^|]*)/g;
  let m, shown = 0;
  while ((m = re.exec(text)) !== null && shown < 10) {
    console.log(`  str "${m[1].slice(0, 40)}" utf16idx=${m.index} bytepos=${m.index * 2}`);
    shown++;
  }
  // u32 plausibles y sus offsets (primeros 30)
  const u32s = [];
  for (let i = 0; i < Math.min(b.length - 4, 4000); i += 1) {
    const v = b.readUInt32LE(i);
    if (v >= 400 && v < 900) u32s.push([i, v]);
  }
  console.log('u32 400-900 (primeros 30):', u32s.slice(0, 30).map(([i, v]) => `${i}:${v}`).join(' '));
  // dump alrededor del primer nombre
  const first = b.indexOf(Buffer.from('FX Vol 20', 'utf16le'));
  if (first > 0) {
    console.log(`\ndump 96B antes de "FX Vol 20" (offset ${first}):`);
    for (let i = Math.max(0, first - 96); i < first; i += 16) {
      console.log(`  ${String(i).padStart(4)} ${b.subarray(i, i + 16).toString('hex').match(/.{4}/g).join(' ')}`);
    }
  }
}

// ---- cmd=8 ticks ----
const tick = packets.find((p) => p.cmd === 8 && p.body.length >= 400);
if (tick) {
  const b = tick.body;
  console.log(`\n=== CMD=8 ticks body=${b.length}B ===`);
  for (let i = 0; i < Math.min(b.length, 160); i += 16) {
    console.log(`  ${String(i).padStart(4)} ${b.subarray(i, i + 16).toString('hex').match(/.{4}/g).join(' ')}`);
  }
  // doubles plausibles con offsets
  const dbls = [];
  for (let i = 0; i < b.length - 8; i++) {
    const v = b.readDoubleLE(i);
    if (v > 100 && v < 1e6 && Math.abs(Math.round(v * 100) - v * 100) < 0.011) dbls.push([i, v]);
  }
  console.log('doubles plausibles:', dbls.slice(0, 14).map(([i, v]) => `${i}:${v.toFixed(2)}`).join('  '));
}
