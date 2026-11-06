// Bisect v2: slicing correcto (TX body@4, RX body@5) + replay verbatim
const fs = require('fs');
const crypto = require('crypto');
const OBF = '13ef13b2b76dd8:5795gdcfb2fdc1ge85bf768f54773d22fff996e3ge75g5:75';
const WS_URL = 'wss://mt5.demo.weltrade.org/terminal';
const obf = (e) => e.split('').map((c) => c.charCodeAt(0) === 28 ? '&' : c.charCodeAt(0) === 23 ? '!' : String.fromCharCode(c.charCodeAt(0) - 1)).join('');
const STATIC_KEY = Buffer.from((obf(OBF).match(/.{2}/g) || []).map((x) => parseInt(x, 16)));
const encK = (k, d) => { const c = crypto.createCipheriv('aes-256-cbc', k, Buffer.alloc(16)); return Buffer.concat([c.update(d), c.final()]); };
const decK = (k, d) => { const c = crypto.createDecipheriv('aes-256-cbc', k, Buffer.alloc(16)); c.setAutoPadding(true); return Buffer.concat([c.update(d), c.final()]); };
const frame = (k, cmd, body) => {
  const head = Buffer.alloc(4); head[0] = crypto.randomInt(256); head[1] = crypto.randomInt(256); head.writeUInt16LE(cmd, 2);
  const c = encK(k, Buffer.concat([head, body]));
  const f = Buffer.alloc(8 + c.length); f.writeUInt32LE(c.length, 0); f.writeUInt32LE(1, 4); c.copy(f, 8);
  return f;
};

const lines = fs.readFileSync('/home/z/my-project/re/ws_frames_full.log', 'utf8').split('\n').filter(Boolean);
const frames = lines.map((l) => { const m = l.match(/^(TX|RX)#(\d+) (\d+)B hex=([0-9a-f]*)/); return m ? { dir: m[1], n: +m[2], buf: Buffer.from(m[4], 'hex') } : null; }).filter(Boolean);
let sess = null;
const bodies = {};
for (const f of frames) {
  const key = f.n <= 2 ? STATIC_KEY : sess; if (!key) continue;
  try {
    const pt = decK(key, f.buf.subarray(8));
    const cmd = pt.readUInt16LE(2);
    if (f.dir === 'TX') { const body = pt.subarray(4); bodies[cmd] = bodies[cmd] || body; }
    else if (f.n === 2) { const rb = pt.subarray(5); sess = rb.subarray(66, 98); }
  } catch (e) {}
}
const hsBody = bodies[0], loginBody = bodies[28];
console.log('handshake body:', hsBody.length + 'B', 'todos ceros?', hsBody.every((x) => x === 0));
console.log('login body:', loginBody.length + 'B');
const fpCapt = loginBody.subarray(196, 212);
console.log('fingerprint (BODY[196..212]):', fpCapt.toString('hex'), 'encontrado en offset', loginBody.indexOf(fpCapt));

async function attempt(name, hsB, lgB) {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS_URL);
    ws.binaryType = 'arraybuffer';
    let key = STATIC_KEY, result = 'sin-respuesta';
    const done = (r) => { try { ws.close(); } catch (e) {} resolve(r); };
    const timer = setTimeout(() => done(result), 9000);
    ws.onopen = () => ws.send(frame(STATIC_KEY, 0, hsB));
    ws.onmessage = (ev) => {
      const buf = Buffer.from(ev.data);
      try {
        const pt = decK(key, buf.subarray(8));
        const cmd = pt.readUInt16LE(2), dd = pt[4];
        if (cmd === 0) { key = pt.subarray(5).subarray(66, 98); ws.send(frame(key, 28, lgB)); result = 'handshake-ok'; return; }
        if (cmd === 28) { result = `LOGIN dd=${dd} ${dd === 0 ? 'ACEPTADO' : 'rechazado'} body=${pt.subarray(5).length}B`; clearTimeout(timer); done(result); }
      } catch (e) { result += ' |descif-fallo'; }
    };
    ws.onclose = () => { clearTimeout(timer); done(result + ' [cerrado]'); };
    ws.onerror = () => {};
  });
}

(async () => {
  const zeros64 = Buffer.alloc(64);
  console.log('\nT1: handshake ceros + login VERBATIM (912B) =>', await attempt('T1', zeros64, loginBody));
  const lg2 = Buffer.from(loginBody);
  crypto.createHash('sha1').update('x').digest().subarray(0, 16).copy(lg2, loginBody.indexOf(fpCapt));
  console.log('T2: handshake ceros + login con otro fingerprint =>', await attempt('T2', zeros64, lg2));
  process.exit(0);
})();
