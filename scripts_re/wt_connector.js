// ============================================================
//  CONECTOR NATIVO Weltrade MT5 WebTerminal — v2 FUNCIONAL
//  Sin navegador: WebSocket + AES-256-CBC (clave estatica->sesion)
//  Uso: WT_LOGIN=... WT_PASS=... node wt_connector.js [segundos]
// ============================================================
const fs = require('fs');
const crypto = require('crypto');

const OBF = '13ef13b2b76dd8:5795gdcfb2fdc1ge85bf768f54773d22fff996e3ge75g5:75';
const WS_URL = 'wss://mt5.demo.weltrade.org/terminal';
const SERVER_NAME = 'mt5.demo.weltrade.org';
const RE = '/home/z/my-project/re';

// ---------- cripto ----------
const obfuscation = (e) => e.split('').map((ch) => ch.charCodeAt(0) === 28 ? '&' : ch.charCodeAt(0) === 23 ? '!' : String.fromCharCode(ch.charCodeAt(0) - 1)).join('');
const STATIC_KEY = Buffer.from((obfuscation(OBF).match(/.{2}/g) || []).map((x) => parseInt(x, 16)));
const aesEnc = (key, data) => { const c = crypto.createCipheriv('aes-256-cbc', key, Buffer.alloc(16)); return Buffer.concat([c.update(data), c.final()]); };
const aesDec = (key, data) => { const d = crypto.createDecipheriv('aes-256-cbc', key, Buffer.alloc(16)); d.setAutoPadding(true); return Buffer.concat([d.update(data), d.final()]); };

// ---------- paquetes: TX body@4, RX: [r8][r8][u16 cmd][u8 dd][body@5] ----------
const buildPacket = (cmd, body) => { const h = Buffer.alloc(4); h[0] = crypto.randomInt(256); h[1] = crypto.randomInt(256); h.writeUInt16LE(cmd, 2); return Buffer.concat([h, body]); };
const buildFrame = (key, cmd, body) => { const c = aesEnc(key, buildPacket(cmd, body)); const f = Buffer.alloc(8 + c.length); f.writeUInt32LE(c.length, 0); f.writeUInt32LE(1, 4); c.copy(f, 8); return f; };
const parseRX = (pt) => ({ cmd: pt.readUInt16LE(2), dd: pt[4], body: pt.subarray(5) });

// ---------- plantillas de la sesion capturada (slicing TX@4 correcto) ----------
function extractTemplates() {
  const lines = fs.readFileSync(`${RE}/ws_frames_full.log`, 'utf8').split('\n').filter(Boolean);
  const frames = lines.map((l) => { const m = l.match(/^(TX|RX)#(\d+) (\d+)B hex=([0-9a-f]*)/); return m ? { dir: m[1], n: +m[2], buf: Buffer.from(m[4], 'hex') } : null; }).filter(Boolean);
  let sess = null; const out = {};
  for (const f of frames) {
    const key = f.n <= 2 ? STATIC_KEY : sess; if (!key) continue;
    try {
      const pt = aesDec(key, f.buf.subarray(8));
      const cmd = pt.readUInt16LE(2);
      if (f.dir === 'TX') { const b = pt.subarray(4); if (!(cmd in out)) out[cmd] = b; }
      if (f.dir === 'RX' && f.n === 2) sess = pt.subarray(5).subarray(66, 98);
    } catch (e) {}
  }
  return out;
}

// ---------- cuerpo de login (912B) con campos localizados por busqueda ----------
function buildLoginBody(tplLogin, login, pass, server) {
  const b = Buffer.from(tplLogin);
  const pass16 = Buffer.from(pass, 'utf16le');
  const OFF_PASS = b.indexOf(pass16); if (OFF_PASS < 0) throw new Error('offset password no encontrado');
  const OFF_FP = b.indexOf(tplLogin.subarray(196, 212)); if (OFF_FP < 0) throw new Error('offset fingerprint no encontrado');
  const OFF_SLEN = b.indexOf(Buffer.from([server.length, 0, 0, 0])); if (OFF_SLEN < 0) throw new Error('offset servidor no encontrado');
  const OFF_LOGIN = b.indexOf((() => { const t = Buffer.alloc(4); t.writeUInt32LE(parseInt(login, 10), 0); return t; })());
  if (OFF_LOGIN < 0) throw new Error('offset login no encontrado');
  // sustituir fingerprint por uno propio (no validado, pero propio)
  crypto.createHash('sha1').update(`termux;${login}`).digest().subarray(0, 16).copy(b, OFF_FP);
  // password y login ya coinciden (misma cuenta); para otra cuenta se reescriben:
  pass16.copy(b, OFF_PASS);
  b.writeUInt32LE(parseInt(login, 10), OFF_LOGIN);
  console.log(`[tpl] pass@${OFF_PASS} fp@${OFF_FP} server@${OFF_SLEN} login@${OFF_LOGIN}`);
  return b;
}

// ---------- principal ----------
const DUR = (parseInt(process.argv[2] || '60', 10)) * 1000;
const login = process.env.WT_LOGIN, pass = process.env.WT_PASS;
if (!login || !pass) { console.error('faltan WT_LOGIN/WT_PASS'); process.exit(1); }

(async () => {
  const tpl = extractTemplates();
  if (!tpl[28]) throw new Error('plantilla login no encontrada en captura');
  const loginBody = buildLoginBody(tpl[28], login, pass, SERVER_NAME);
  const zeros64 = Buffer.alloc(64);

  const ws = new WebSocket(WS_URL);
  ws.binaryType = 'arraybuffer';
  let key = STATIC_KEY, stage = 'handshake';
  const symbolNames = {}, lastTick = {};
  let tickCount = 0, equity = null, balance = null;

  const send = (cmd, body) => ws.send(buildFrame(key, cmd, body));

  ws.onopen = () => { console.log('[+] WS abierto'); send(0, zeros64); };
  ws.onclose = () => console.log('[-] WS cerrado');
  ws.onerror = () => {};

  ws.onmessage = (ev) => {
    const buf = Buffer.from(ev.data);
    let p;
    try { p = parseRX(aesDec(key, buf.subarray(8))); } catch (e) { console.log('[!] descifrado:', e.message.slice(0, 40)); return; }

    if (p.cmd === 0 && stage === 'handshake') {
      const build = p.body.readUInt16LE(0);
      key = p.body.subarray(66, 98);
      console.log(`[+] handshake OK build=${build} — enviando login`);
      send(28, loginBody); stage = 'login';
      return;
    }
    if (p.cmd === 28 && stage === 'login') {
      if (p.dd !== 0) { console.log(`[!] login RECHAZADO dd=${p.dd}`); ws.close(); return; }
      console.log('[+] LOGIN ACEPTADO — suscribiendo a datos...');
      stage = 'datos';
      (async () => {
        for (const cmd of [3, 9, 6, 4, 7]) {
          if (tpl[cmd]) { send(cmd, tpl[cmd]); await new Promise((r) => setTimeout(r, 350)); }
        }
        console.log('[+] suscripciones enviadas (3,9,6,4,7) — esperando ticks...');
      })();
      return;
    }
    if (p.cmd === 6 && p.body.length > 100) {
      const b = p.body;
      const count = b.readUInt32LE(0);
      for (let k = 0; k < count && 4 + (k + 1) * 526 <= b.length; k++) {
        const base = 4 + k * 526;
        const id = b.readUInt32LE(base + 196);
        // nombre utf16le hasta NUL
        let name = '';
        for (let j = base; j < base + 64; j += 2) {
          const ch = b.readUInt16LE(j);
          if (ch === 0) break;
          name += String.fromCharCode(ch);
        }
        if (id >= 100 && id < 100000 && name) symbolNames[id] = name;
      }
      console.log(`[+] catalogo: ${count} simbolos, ${Object.keys(symbolNames).length} mapeados: ${JSON.stringify(symbolNames).slice(0, 220)}`);
      return;
    }
    if (p.cmd === 8) {
      const b = p.body;
      for (let off = 0; off + 50 <= b.length; off += 50) {
        const id = b.readUInt32LE(off);
        const bid = b.readDoubleLE(off + 12) / 100, ask = b.readDoubleLE(off + 20) / 100;
        if (bid <= 0 || ask <= 0) continue;
        const name = symbolNames[id] || `id_${id}`;
        tickCount++;
        const prev = lastTick[name];
        if (!prev || prev.bid !== bid || prev.ask !== ask) {
          lastTick[name] = { bid, ask, t: Date.now() };
          console.log(`TICK ${name.padEnd(12)} bid=${bid.toFixed(2)} ask=${ask.toFixed(2)}`);
        }
      }
      return;
    }
    if (p.cmd === 17) { // estado de cuenta: buscar doubles plausibles de balance/equity
      const b = p.body;
      for (let j = 0; j + 8 <= b.length; j += 8) {
        const v = b.readDoubleLE(j);
        if (v > 0 && v < 1e9 && Math.abs(v - Math.round(v * 100) / 100) < 1e-9) {
          if (balance === null) balance = v; else if (equity === null && v !== balance) equity = v;
        }
      }
      console.log(`[i] cuenta: balance=${balance} equity=${equity}`);
      return;
    }
  };

  const beat = setInterval(() => { if (stage === 'datos') send(51, Buffer.alloc(0)); }, 8000);
  setTimeout(() => {
    clearInterval(beat);
    console.log('\n=== RESUMEN FINAL (conector nativo puro) ===');
    console.log('ticks recibidos:', tickCount);
    for (const [name, t] of Object.entries(lastTick)) console.log(`  ${name.padEnd(12)} bid=${t.bid.toFixed(2)} ask=${t.ask.toFixed(2)}`);
    console.log('simbolos mapeados:', JSON.stringify(symbolNames));
    ws.close(); process.exit(0);
  }, DUR);
})().catch((e) => { console.error('FALLO:', e.message); process.exit(1); });
