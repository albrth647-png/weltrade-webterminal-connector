#!/usr/bin/env node
/* ============================================================
   CONECTOR NATIVO WELTRADE — MT5 WebTerminal (sin navegador)
   Protocolo revertido con ingeniería inversa (REA + análisis JS)
   ------------------------------------------------------------
   - WebSocket + AES-256-CBC (clave estática embebida -> clave de sesión)
   - Handshake, login, catálogo, suscripción dinámica, ticks en vivo
   - Reconexión automática, salida en JSON Lines
   Uso:  node conector.js        (lee .env de la misma carpeta)
   ============================================================ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------- configuración (.env) ----------
const ENV_FILE = path.join(__dirname, '.env');
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^\s*(WT_[A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
const LOGIN = process.env.WT_LOGIN;
const PASS = process.env.WT_PASS;
const HOST = process.env.WT_HOST || 'mt5.demo.weltrade.org'; // demo | mt5.real.weltrade.org
const SYMBOLS = (process.env.WT_SYMBOLS || '').split(',').map((s) => s.trim()).filter(Boolean);
const FORMAT = (process.env.WT_FORMAT || 'json').toLowerCase(); // json | texto
if (!LOGIN || !PASS) { console.error('[!] Falta WT_LOGIN o WT_PASS en .env'); process.exit(1); }

// ---------- cripto del protocolo ----------
const OBF = '13ef13b2b76dd8:5795gdcfb2fdc1ge85bf768f54773d22fff996e3ge75g5:75'; // embebida en el cliente oficial
const obfuscation = (e) => e.split('').map((ch) => ch.charCodeAt(0) === 28 ? '&' : ch.charCodeAt(0) === 23 ? '!' : String.fromCharCode(ch.charCodeAt(0) - 1)).join('');
const STATIC_KEY = Buffer.from((obfuscation(OBF).match(/.{2}/g) || []).map((x) => parseInt(x, 16)));
const aesEnc = (key, data) => { const c = crypto.createCipheriv('aes-256-cbc', key, Buffer.alloc(16)); return Buffer.concat([c.update(data), c.final()]); };
const aesDec = (key, data) => { const d = crypto.createDecipheriv('aes-256-cbc', key, Buffer.alloc(16)); d.setAutoPadding(true); return Buffer.concat([d.update(data), d.final()]); };
const buildPacket = (cmd, body) => { const h = Buffer.alloc(4); h[0] = crypto.randomInt(256); h[1] = crypto.randomInt(256); h.writeUInt16LE(cmd, 2); return Buffer.concat([h, body]); };
const buildFrame = (key, cmd, body) => { const c = aesEnc(key, buildPacket(cmd, body)); const f = Buffer.alloc(8 + c.length); f.writeUInt32LE(c.length, 0); f.writeUInt32LE(1, 4); c.copy(f, 8); return f; };
const parseRX = (pt) => ({ cmd: pt.readUInt16LE(2), dd: pt[4], body: pt.subarray(5) });

// ---------- cuerpo de login (912 B, layout revertido) ----------
function buildLoginBody() {
  const b = Buffer.alloc(912);
  Buffer.from(PASS, 'utf16le').copy(b, 4);                 // contraseña UTF-16LE @4
  const fp = crypto.createHash('sha1').update(`termux;${LOGIN};${Date.now()}`).digest().subarray(0, 16);
  fp.copy(b, 196);                                          // huella 16 B @196 (no se valida)
  const s16 = Buffer.from(HOST, 'utf16le');
  b.writeUInt32LE(HOST.length, 476);                        // [u32 len] del servidor
  s16.copy(b, 480);                                         // servidor UTF-16LE @480
  b.writeUInt32LE(parseInt(LOGIN, 10), 736);                // nº de cuenta u32 @736
  return b;
}

// ---------- salida ----------
function emit(obj) {
  if (FORMAT === 'json') console.log(JSON.stringify(obj));
  else console.log(`[${new Date().toISOString()}] ${obj.tipo} ${obj.simbolo || ''} ${obj.bid !== undefined ? 'bid=' + obj.bid : ''} ${obj.ask !== undefined ? 'ask=' + obj.ask : ''} ${obj.msg || ''}`);
}

/* login rechazado = estado terminal: el bucle principal NO reintenta
   (evita martillear el servidor y arriesgar bloqueo de cuenta) */
let credencialesRechazadas = false;

// ---------- sesión completa (se resuelve al cerrar) ----------
function sesion() {
  return new Promise((resolve) => {
    const ws = new WebSocket(`wss://${HOST}/terminal`);
    ws.binaryType = 'arraybuffer';
    let key = STATIC_KEY, stage = 'handshake';
    const symbolNames = {};
    const lastTick = {};
    let send;
    const ping = setInterval(() => { try { if (stage === 'datos') send(51, Buffer.alloc(0)); } catch (e) {} }, 8000);

    ws.onopen = () => { emit({ tipo: 'info', msg: 'conectado, handshake...' }); send = (cmd, body) => ws.send(buildFrame(key, cmd, body)); send(0, Buffer.alloc(64)); };
    ws.onclose = () => { clearInterval(ping); emit({ tipo: 'info', msg: 'sesion cerrada' }); resolve(); };
    ws.onerror = () => {};

    ws.onmessage = (ev) => {
      const buf = Buffer.from(ev.data);
      let p;
      try { p = parseRX(aesDec(key, buf.subarray(8))); } catch (e) { return; }

      if (p.cmd === 0 && stage === 'handshake') {
        key = p.body.subarray(66, 98);
        if (key.length !== 32) {
          // sin este guard createCipheriv lanzaba dentro de un try silencioso
          emit({ tipo: 'error', msg: `handshake inválido: clave de sesión de ${key.length} B (esperados 32) — cerrando` });
          ws.close();
          return;
        }
        send(28, buildLoginBody());
        stage = 'login';
        return;
      }
      if (p.cmd === 28 && stage === 'login') {
        if (p.dd !== 0) {
          credencialesRechazadas = true;
          emit({ tipo: 'error', msg: `login rechazado (dd=${p.dd}) — revisa cuenta/contraseña/servidor` });
          ws.close();
          return;
        }
        emit({ tipo: 'info', msg: 'login aceptado, pidiendo catalogo...' });
        send(3, Buffer.alloc(0)); send(9, Buffer.alloc(0)); send(6, Buffer.alloc(0));
        stage = 'catalogo';
        return;
      }
      if (p.cmd === 6 && stage === 'catalogo') {
        const b = p.body;
        const count = b.readUInt32LE(0);
        for (let k = 0; k < count && 4 + (k + 1) * 526 <= b.length; k++) {
          const base = 4 + k * 526;
          const id = b.readUInt32LE(base + 196);
          let name = '';
          for (let j = base; j < base + 64; j += 2) { const ch = b.readUInt16LE(j); if (!ch) break; name += String.fromCharCode(ch); }
          if (name) symbolNames[id] = name;
        }
        emit({ tipo: 'info', msg: `catalogo: ${Object.keys(symbolNames).length} simbolos` });
        // suscripción dinámica: [u32 count][u32 id × n]
        let ids = Object.keys(symbolNames).map(Number);
        if (SYMBOLS.length) {
          ids = ids.filter((id) => SYMBOLS.some((s) => symbolNames[id].toLowerCase() === s.toLowerCase()));
        }
        ids = ids.filter((id) => /^(FX Vol|SFX Vol|Step|Boom|Crash|Range|FlipX|Drift)/i.test(symbolNames[id] || ''));
        const sub = Buffer.alloc(4 + ids.length * 4);
        sub.writeUInt32LE(ids.length, 0);
        ids.forEach((id, i) => sub.writeUInt32LE(id, 4 + i * 4));
        send(7, sub);
        send(4, Buffer.alloc(0));
        stage = 'datos';
        emit({ tipo: 'info', msg: `suscrito a ${ids.length} simbolos — transmitiendo ticks...` });
        return;
      }
      if (p.cmd === 8 && stage === 'datos') {
        const b = p.body;
        for (let off = 0; off + 50 <= b.length; off += 50) {
          const id = b.readUInt32LE(off);
          const bid = b.readDoubleLE(off + 12) / 100, ask = b.readDoubleLE(off + 20) / 100;
          if (!(bid > 0) || !(ask > 0)) continue;
          const name = symbolNames[id] || `id_${id}`;
          const prev = lastTick[name];
          if (prev && prev.bid === bid && prev.ask === ask) continue;
          lastTick[name] = { bid, ask };
          emit({ tipo: 'tick', simbolo: name, bid, ask, t: Date.now() });
        }
        return;
      }
      if (p.cmd === 17 && stage === 'datos') {
        // estado de cuenta (balance/equity como f64 escalado — estructura por afinar)
        return;
      }
    };
  });
}

// ---------- bucle principal con reconexión ----------
(async () => {
  emit({ tipo: 'info', msg: `conector iniciado (cuenta ${LOGIN} @ ${HOST})` });
  for (;;) {
    try { await sesion(); } catch (e) { emit({ tipo: 'error', msg: e.message }); }
    if (credencialesRechazadas) {
      emit({ tipo: 'error', msg: 'credenciales rechazadas: NO se reintenta (evita bloqueos). Corrige .env y relanza.' });
      process.exit(1);
    }
    emit({ tipo: 'info', msg: 'reconectando en 3s...' });
    await new Promise((r) => setTimeout(r, 3000));
  }
})();
