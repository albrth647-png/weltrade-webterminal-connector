'use strict';
/* ============================================================
   CLIENTE MT5 NATIVO — Weltrade WebTerminal (sin navegador)
   ------------------------------------------------------------
   Reutiliza el protocolo revertido y validado del conector:
   - WSS binario + AES-256-CBC (IV ceros, PKCS#7)
   - cmd 0 handshake -> clave de sesión (offset 66..98)
   - cmd 28 login (912 B) | cmd 6 catálogo | cmd 7 suscripción
   - cmd 8 stream de ticks | cmd 11 velas H1 (semilla)
   - cmd 51 keep-alive
   Emite eventos: listo | tick | velas | aviso | cerrar
   Sin dependencias externas (Node >= 22, WebSocket global).
   ============================================================ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

// ---------- .env de la misma carpeta ----------
(function cargarEnv() {
  const archivo = path.join(__dirname, '.env');
  if (fs.existsSync(archivo)) {
    for (const line of fs.readFileSync(archivo, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  }
})();

// ---------- cripto del protocolo (idéntica al conector validado) ----------
const OBF = '13ef13b2b76dd8:5795gdcfb2fdc1ge85bf768f54773d22fff996e3ge75g5:75';
const obfuscation = (e) => e.split('').map((ch) => ch.charCodeAt(0) === 28 ? '&' : ch.charCodeAt(0) === 23 ? '!' : String.fromCharCode(ch.charCodeAt(0) - 1)).join('');
const CLAVE_ESTATICA = Buffer.from((obfuscation(OBF).match(/.{2}/g) || []).map((x) => parseInt(x, 16)));
const aesEnc = (key, data) => { const c = crypto.createCipheriv('aes-256-cbc', key, Buffer.alloc(16)); return Buffer.concat([c.update(data), c.final()]); };
const aesDec = (key, data) => { const d = crypto.createDecipheriv('aes-256-cbc', key, Buffer.alloc(16)); d.setAutoPadding(true); return Buffer.concat([d.update(data), d.final()]); };
const buildFrame = (key, packet) => { const c = aesEnc(key, packet); const f = Buffer.alloc(8 + c.length); f.writeUInt32LE(c.length, 0); f.writeUInt32LE(1, 4); c.copy(f, 8); return f; };
const parseRX = (pt) => ({ cmd: pt.readUInt16LE(2), dd: pt[4], body: pt.subarray(5) });

// ---------- cuerpo de login (912 B, layout revertido) ----------
function buildLoginBody(login, pass, host) {
  const b = Buffer.alloc(912);
  Buffer.from(pass, 'utf16le').copy(b, 4);
  const fp = crypto.createHash('sha1').update(`termux;${login};${Date.now()}`).digest().subarray(0, 16);
  fp.copy(b, 196);
  const s16 = Buffer.from(host, 'utf16le');
  b.writeUInt32LE(host.length, 476);
  s16.copy(b, 480);
  b.writeUInt32LE(parseInt(login, 10), 736);
  return b;
}

class ClienteMT5 extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.login = opts.login || process.env.WT_LOGIN;
    this.pass = opts.pass || process.env.WT_PASS;
    this.host = opts.host || process.env.WT_HOST || 'mt5.demo.weltrade.org';
    this.filtro = opts.filtro || /^(FX Vol|SFX Vol|Step|Boom|Crash|Range|FlipX|Drift)/i;
    this.nombres = {};        // id -> nombre
    this.ids = {};            // nombre -> id
    this.ws = null;
    this.clave = CLAVE_ESTATICA;
    this.etapa = 'apagado';
    this._ping = null;
    this._pendientes11 = new Map(); // nombre -> {resolver, timer}
  }

  _log(msg) { this.emit('aviso', msg); }
  _enviarPacket(packet) { try { this.ws.send(buildFrame(this.clave, packet)); } catch (e) { /* reconexión lo cubre */ } }
  _enviar(cmd, body) {
    const p = Buffer.alloc(4 + body.length);
    p[0] = crypto.randomInt(256); p[1] = crypto.randomInt(256); p.writeUInt16LE(cmd, 2);
    body.copy(p, 4);
    this._enviarPacket(p);
  }

  conectar() {
    this.etapa = 'conectando';
    const ws = new WebSocket(`wss://${this.host}/terminal`);
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    this._ping = setInterval(() => this._enviar(51, Buffer.alloc(0)), 8000);

    ws.onopen = () => { this.etapa = 'handshake'; this._enviar(0, Buffer.alloc(64)); };
    ws.onclose = () => this._cerrar();
    ws.onerror = () => { /* onclose llega después */ };
    ws.onmessage = (ev) => this._onMensaje(Buffer.from(ev.data));
  }

  _cerrar() {
    clearInterval(this._ping);
    this.etapa = 'apagado';
    for (const [, p] of this._pendientes11) { clearTimeout(p.timer); p.resolver(null); }
    this._pendientes11.clear();
    this.emit('cerrar');
  }

  cerrar() { try { this.ws && this.ws.close(); } catch (e) { } this._cerrar(); }

  _onMensaje(buf) {
    let p;
    try { p = parseRX(aesDec(this.clave, buf.subarray(8))); } catch (e) { return; }

    // Handshake: clave de sesión en body[66..98]
    if (p.cmd === 0 && this.etapa === 'handshake') {
      this.clave = p.body.subarray(66, 98);
      this.etapa = 'login';
      this._enviar(28, buildLoginBody(this.login, this.pass, this.host));
      return;
    }
    // Login aceptado -> catálogo
    if (p.cmd === 28 && this.etapa === 'login') {
      if (p.dd !== 0) { this._log(`login rechazado (dd=${p.dd}) — revisa cuenta/contraseña/servidor`); this.cerrar(); return; }
      this.etapa = 'catalogo';
      this._enviar(3, Buffer.alloc(0)); this._enviar(9, Buffer.alloc(0)); this._enviar(6, Buffer.alloc(0));
      return;
    }
    // Catálogo: registros de 526 B, nombre UTF-16 @0, id u32 @196
    if (p.cmd === 6 && this.etapa === 'catalogo') {
      const b = p.body;
      const n = b.readUInt32LE(0);
      for (let k = 0; k < n && 4 + (k + 1) * 526 <= b.length; k++) {
        const base = 4 + k * 526;
        const id = b.readUInt32LE(base + 196);
        let nombre = '';
        for (let j = base; j < base + 64; j += 2) { const ch = b.readUInt16LE(j); if (!ch) break; nombre += String.fromCharCode(ch); }
        if (nombre) { this.nombres[id] = nombre; this.ids[nombre] = id; }
      }
      this.etapa = 'listo';
      const objetivos = Object.values(this.nombres).filter((n) => this.filtro.test(n));
      // suscripción de ticks: [u32 n][u32 id × n]
      const sub = Buffer.alloc(4 + objetivos.length * 4);
      sub.writeUInt32LE(objetivos.length, 0);
      objetivos.forEach((nom, i) => sub.writeUInt32LE(this.ids[nom], 4 + i * 4));
      this._enviar(7, sub);
      this._enviar(4, Buffer.alloc(0));
      this._log(`listo: ${objetivos.length} símbolos suscritos`);
      this.emit('listo', { simbolos: objetivos });
      return;
    }
    // Ticks: registros de 50 B
    if (p.cmd === 8 && this.etapa === 'listo') {
      const b = p.body;
      for (let off = 0; off + 50 <= b.length; off += 50) {
        const id = b.readUInt32LE(off);
        const bid = b.readDoubleLE(off + 12) / 100, ask = b.readDoubleLE(off + 20) / 100;
        if (!(bid > 0) || !(ask > 0)) continue;
        this.emit('tick', { simbolo: this.nombres[id] || `id_${id}`, bid, ask, t: Date.now() });
      }
      return;
    }
    // Velas (respuesta a cmd 11)
    if (p.cmd === 11 && this._pendientes11.size) {
      const vela = this._parseVelas(p.body);
      for (const [nombre, pend] of this._pendientes11) {
        clearTimeout(pend.timer);
        this._pendientes11.delete(nombre);
        pend.resolver(vela);
      }
      return;
    }
  }

  /* Petición de velas. Layout capturado y verificado en sesión real:
     packet[4..64)   = símbolo UTF-16LE + null, relleno con ceros (60 B)
     packet[64..66)  = u16 PERIOD_* de MT5 en little-endian (H1=0x4001, M15=15, M5=5...)
     packet[66..74)  = [u32 desde][u32 hasta] (época en segundos; el servidor
                       responde con las velas de ese rango)
     Respuesta: registros de 48 B [u32 t][f64 o][f64 h][f64 l][f64 c][u32 vol][u32 ?] */
  pedirVelas(nombre, { tf = 'H1', dias = 90, timeoutMs = 10000 } = {}) {
    if (this.etapa !== 'listo' || !this.ids[nombre]) return Promise.resolve(null);
    const ENUM_TF = { M1: 1, M5: 5, M15: 15, M30: 30, H1: 0x4001, H4: 0x4004, D1: 0x4018 };
    const periodo = ENUM_TF[tf] ?? 0x4001;
    const packet = Buffer.alloc(78);                          // [4B cabecera][60B símbolo][2B tf][8B rango]
    packet[0] = crypto.randomInt(256); packet[1] = crypto.randomInt(256); packet.writeUInt16LE(11, 2);
    Buffer.from(nombre, 'utf16le').copy(packet, 4);          // + terminador null (los ceros del alloc)
    const hasta = Math.floor(Date.now() / 1000), desde = hasta - Math.max(1, dias) * 86400;
    packet[68] = periodo & 0xff; packet[69] = (periodo >> 8) & 0xff;
    packet.writeUInt32LE(desde, 70); packet.writeUInt32LE(hasta, 74);
    return new Promise((resolver) => {
      const timer = setTimeout(() => { this._pendientes11.delete(nombre); resolver(null); }, timeoutMs);
      this._pendientes11.set(nombre, { resolver, timer });
      this._enviarPacket(packet);
    });
  }

  /* Parser de velas: registros de 48 B
     [u32 t][f64 o][f64 h][f64 l][f64 c][u32 vol][u32 flags]
     Validación por registro; los corruptos se descartan con log. */
  _parseVelas(b) {
    const velas = []; let descartadas = 0;
    for (let off = 0; off + 48 <= b.length; off += 48) {
      const t = b.readUInt32LE(off) * 1000;
      const o = b.readDoubleLE(off + 4), h = b.readDoubleLE(off + 12);
      const l = b.readDoubleLE(off + 20), c = b.readDoubleLE(off + 28);
      const ok = t > 0 && [o, h, l, c].every(Number.isFinite) &&
        h >= Math.max(o, c) - 1e-9 && l <= Math.min(o, c) + 1e-9 && h >= l;
      if (!ok) { descartadas++; continue; }
      velas.push({ t, o, h, l, c });
    }
    return { velas, descartadas };
  }
}

module.exports = { ClienteMT5 };
