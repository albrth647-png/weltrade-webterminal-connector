// Solucionador de estructura: cmd=8 (ticks), cmd=17 (cuenta), cmd=4 (watch)
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
    packets.push({ dir: f.dir, n: f.n, cmd: pt.readUInt16LE(2), dd: pt[4], body: f.dir === 'TX' ? pt.subarray(4) : pt.subarray(5) });
    if (f.dir === 'RX' && f.n === 2) sess = pt.subarray(5).subarray(66, 98);
  } catch (e) {}
}

// ---------- cmd=8: buscar (stride, idOff, bidOff) que decodifique N registros plausibles ----------
const tickFrames = packets.filter((p) => p.cmd === 8 && p.body.length >= 400);
console.log('frames cmd=8 grandes:', tickFrames.length);
const b = tickFrames[0].body;
console.log(`analizando frame body=${b.length}B`);
const idsConocidos = [];
for (let i = 0; i < b.length - 4; i++) { const v = b.readUInt32LE(i); if (v >= 454 && v <= 463) idsConocidos.push([i, v]); }
console.log('u32 en rango 454-463:', idsConocidos.map(([i, v]) => `${i}:${v}`).join(' '));

let mejor = null;
for (let stride = 40; stride <= 64; stride++) {
  const nRec = Math.floor(b.length / stride);
  if (nRec < 8) continue;
  for (let idOff = 0; idOff <= 8; idOff += 4) {
    for (let bidOff = 8; bidOff <= stride - 16; bidOff += 1) {
      let ok = 0; const res = [];
      for (let r = 0; r < nRec; r++) {
        const base = r * stride;
        const id = b.readUInt32LE(base + idOff);
        if (id < 454 || id > 463) { ok = -1; break; }
        const bid = b.readDoubleLE(base + bidOff);
        const ask = b.readDoubleLE(base + bidOff + 8);
        if (!(bid > 10 && bid < 1e6 && ask >= bid && ask / bid < 1.01)) { ok = -1; break; }
        ok++; res.push([id, bid, ask]);
      }
      if (ok === nRec && nRec >= 8) {
        const spread = res.reduce((a, [, bi, as]) => a + (as - bi) / bi, 0) / res.length;
        if (!mejor || ok > mejor.ok) mejor = { stride, idOff, bidOff, nRec, res, spread };
        console.log(`VALIDO: stride=${stride} idOff=${idOff} bidOff=${bidOff} n=${nRec} spreadMedio=${(spread * 100).toFixed(4)}%`);
      }
    }
  }
}
if (mejor) {
  console.log('\nMEJOR layout:', JSON.stringify({ stride: mejor.stride, idOff: mejor.idOff, bidOff: mejor.bidOff }));
  for (const [id, bid, ask] of mejor.res) console.log(`  id=${id} bid=${bid.toFixed(2)} ask=${ask.toFixed(2)}`);
}

// ---------- cmd=17: encontrar balance 176.25 / equity 108.95 ----------
const acct = packets.find((p) => p.cmd === 17 && p.body.length > 200);
if (acct) {
  const a = acct.body;
  console.log(`\ncmd=17 body=${a.length}B — buscando f64 176.25 y 108.95...`);
  const findF64 = (val) => { const t = Buffer.alloc(8); t.writeDoubleLE(val, 0); const r = []; for (let i = 0; i < a.length - 8; i++) { if (a.subarray(i, i + 8).equals(t)) r.push(i); } return r; };
  console.log('offset 176.25:', findF64(176.25), ' offset 108.95:', findF64(108.95));
}

// ---------- cmd=4 (market watch) ----------
const mw = packets.find((p) => p.cmd === 4 && p.body.length > 500);
if (mw) {
  const w = mw.body;
  console.log(`\ncmd=4 body=${w.length}B primeros 128B:`);
  for (let i = 0; i < 128; i += 16) console.log(`  ${String(i).padStart(3)} ${w.subarray(i, i + 16).toString('hex').match(/.{4}/g).join(' ')} ${w.subarray(i, i + 16).toString('utf16le').replace(/[^\x20-\x7e]/g, '.')}`);
}
