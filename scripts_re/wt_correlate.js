// Correlaciona precios conocidos con bytes del frame de ticks
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

// precios de referencia (screenshot Market Watch ~13:12)
const ref = {
  454: ['FX Vol 20', 114584], 455: ['FX Vol 40', 197538], 456: ['FX Vol 60', 36180],
  457: ['FX Vol 80', 45201], 458: ['FX Vol 99', 49560], 459: ['SFX Vol 20', 35319],
  460: ['SFX Vol 40', 109484], 461: ['SFX Vol 60', 345251], 462: ['SFX Vol 80', 76066], 463: ['SFX Vol 99', 1205],
};

const tickFrames = packets.filter((p) => p.cmd === 8 && p.body.length >= 400);
console.log('frames ticks grandes:', tickFrames.length);
const b = tickFrames[0].body;
console.log('frame body:', b.length, 'B');

// buscar TODOS los f64 en el cuerpo cuyo valor este cerca de algun precio de referencia (±25%)
console.log('\n=== f64 cerca de precios conocidos ===');
for (let i = 0; i < b.length - 8; i++) {
  const v = b.readDoubleLE(i);
  for (const [id, [name, p0]] of Object.entries(ref)) {
    if (v > p0 * 0.75 && v < p0 * 1.25) {
      console.log(`  offset=${i} (rec=${Math.floor(i / 50)} rel=${i % 50}) valor=${v.toFixed(2)} ~ ${name} (${p0})`);
    }
  }
}

// igual con f32
console.log('\n=== f32 cerca de precios conocidos ===');
let count = 0;
for (let i = 0; i < b.length - 4 && count < 20; i++) {
  const v = b.readFloatLE(i);
  for (const [id, [name, p0]] of Object.entries(ref)) {
    if (v > p0 * 0.75 && v < p0 * 1.25) { console.log(`  offset=${i} (rec=${Math.floor(i / 50)} rel=${i % 50}) valor=${v.toFixed(2)} ~ ${name}`); count++; }
  }
}

// dump completo alineado por registros de 50B para inspeccion visual
console.log('\n=== registros de 50B (id@0) ===');
for (let r = 0; r < 10; r++) {
  const base = r * 50;
  const id = b.readUInt32LE(base);
  const name = ref[id] ? ref[id][0] : '?';
  const hex = b.subarray(base, base + 50).toString('hex').match(/.{8}/g).join(' ');
  console.log(`id=${id} ${name.padEnd(10)} ${hex}`);
}
