// Verificacion programatica final del layout de ticks
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
    packets.push({ dir: f.dir, n: f.n, cmd: pt.readUInt16LE(2), body: f.dir === 'TX' ? pt.subarray(4) : pt.subarray(5) });
    if (f.dir === 'RX' && f.n === 2) sess = pt.subarray(5).subarray(66, 98);
  } catch (e) {}
}

const ref = {
  454: ['FX Vol 20', 114584.57], 455: ['FX Vol 40', 197538.82], 456: ['FX Vol 60', 36180.45],
  457: ['FX Vol 80', 45201.81], 458: ['FX Vol 99', 49560.96], 459: ['SFX Vol 20', 35319.70],
  460: ['SFX Vol 40', 109484.09], 461: ['SFX Vol 60', 345251.98], 462: ['SFX Vol 80', 76066.88], 463: ['SFX Vol 99', 1205.01],
};

const tickFrames = packets.filter((p) => p.cmd === 8 && p.body.length >= 400);
const b = tickFrames[0].body;

console.log('=== lectura directa de registros (f64@12 y f64@20, /100) ===');
for (let r = 0; r < 10; r++) {
  const base = r * 50;
  const id = b.readUInt32LE(base);
  const bid = b.readDoubleLE(base + 12), ask = b.readDoubleLE(base + 20);
  const name = ref[id] ? ref[id][0] : '?', p0 = ref[id] ? ref[id][1] : 0;
  console.log(`id=${id} ${name.padEnd(10)} bidRaw=${bid.toFixed(2)} askRaw=${ask.toFixed(2)} | /100: ${ (bid/100).toFixed(2) }/${ (ask/100).toFixed(2) } | ref=${p0} | match=${Math.abs(bid/100 - p0)/p0 < 0.15 ? 'SI' : 'NO'}`);
}

console.log('\n=== busqueda global: f64 v tal que v/100 cerca de ref ===');
for (let i = 0; i < b.length - 8; i++) {
  const v = b.readDoubleLE(i);
  if (v < 1000 || v > 1e9) continue;
  for (const [id, [name, p0]] of Object.entries(ref)) {
    if (Math.abs(v / 100 - p0) / p0 < 0.15) {
      console.log(`offset=${i} rec=${Math.floor(i/50)} rel=${i%50} v=${v.toFixed(2)} v/100=${(v/100).toFixed(2)} ~ ${name} (${p0})`);
    }
  }
}

console.log('\n=== busqueda global: f64 v cerca de ref directamente ===');
for (let i = 0; i < b.length - 8; i++) {
  const v = b.readDoubleLE(i);
  if (v < 1000 || v > 1e9) continue;
  for (const [id, [name, p0]] of Object.entries(ref)) {
    if (Math.abs(v - p0) / p0 < 0.15) {
      console.log(`offset=${i} rec=${Math.floor(i/50)} rel=${i%50} v=${v.toFixed(2)} ~ ${name} (${p0})`);
    }
  }
}

// comparar dos frames distintos: que campos cambian por registro
console.log('\n=== estabilidad entre frames (rec id 454) ===');
const f1 = tickFrames[0].body, f2 = tickFrames[5].body;
for (let r = 0; r < 10; r++) {
  const base = r * 50;
  const id1 = f1.readUInt32LE(base);
  if (id1 !== 454) continue;
  const diff = [];
  for (let k = 4; k < 50; k += 1) {
    const a = f1[base + k], c = f2[base + k];
    if (a !== c) diff.push(k);
  }
  console.log('bytes distintos entre frame0 y frame5 en record 454:', diff.join(','));
}
