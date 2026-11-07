'use strict';
/* ============================================================
   CLIENTE MT5 PARA EL NAVEGADOR — Weltrade WebTerminal (PWA)
   ------------------------------------------------------------
   Portado del protocolo revertido y validado (Node):
   - WSS binario + AES-256-CBC (IV ceros, PKCS#7) vía WebCrypto
   - cmd 0  handshake   -> clave de sesión (offset 66..98)
   - cmd 28 login (912 B) | cmd 6 catálogo | cmd 7 suscripción
   - cmd 8  stream de ticks | cmd 11 velas (semilla)
   - cmd 51 keep-alive
   Emite eventos: listo | tick | velas | aviso | cerrar
   SIN dependencias: todo es WebSocket + crypto.subtle estándar.
   ============================================================ */

/* ---------- cripto del protocolo ---------- */
const OBF = '13ef13b2b76dd8:5795gdcfb2fdc1ge85bf768f54773d22fff996e3ge75g5:75'; // embebida en el cliente oficial
const _obfuscar = (e) => e.split('').map((ch) => ch.charCodeAt(0) === 28 ? '&' : ch.charCodeAt(0) === 23 ? '!' : String.fromCharCode(ch.charCodeAt(0) - 1)).join('');
const CLAVE_ESTATICA = new Uint8Array((_obfuscar(OBF).match(/.{2}/g) || []).map((x) => parseInt(x, 16)));

const IV_CERO = new Uint8Array(16);
let _claveExportableCache = null;
async function _claveCrypto(bytes) {
  if (!_claveExportableCache || !_bytesIguales(_claveExportableCache.raw, bytes)) {
    _claveExportableCache = { raw: new Uint8Array(bytes), key: await crypto.subtle.importKey('raw', bytes.slice(0), 'AES-CBC', false, ['encrypt', 'decrypt']) };
  }
  return _claveExportableCache.key;
}
const _bytesIguales = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

async function aesEnc(clave, datos) {
  const key = await _claveCrypto(clave);
  return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: IV_CERO }, key, datos));
}
async function aesDec(clave, cifrado) {
  const key = await _claveCrypto(clave);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv: IV_CERO }, key, cifrado));
}
const _rnd = (nBytes) => crypto.getRandomValues(new Uint8Array(nBytes));

/* ---------- helpers de buffer (sin Buffer de Node) ---------- */
function utf16le(str) {
  const b = new Uint8Array(str.length * 2);
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); b[2 * i] = c & 0xff; b[2 * i + 1] = (c >> 8) & 0xff; }
  return b;
}
function utf16leLeer(b, desde, hasta) {
  let s = '';
  for (let j = desde; j < hasta; j += 2) { const ch = b[j] | (b[j + 1] << 8); if (!ch) break; s += String.fromCharCode(ch); }
  return s;
}
function dv(b) { return new DataView(b.buffer, b.byteOffset, b.byteLength); }
const u32 = (b, o) => dv(b).getUint32(o, true);
const f64 = (b, o) => dv(b).getFloat64(o, true);
const w32 = (b, o, v) => dv(b).setUint32(o, v, true);
const h16 = (b, o, v) => dv(b).setUint16(o, v, true);

/* ---------- cuerpo de login (912 B, layout revertido) ---------- */
async function buildLoginBody(login, pass, host) {
  const b = new Uint8Array(912);
  b.set(utf16le(pass), 4);                                  // contraseña UTF-16LE @4
  /* huella SHA-1 en UTF-8 (igual que los clientes Node: el portaje anterior
     usaba UTF-16LE — el servidor no la valida, pero así son 100 % idénticos) */
  const fpRaw = new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`termux;${login};${Date.now()}`)));
  b.set(fpRaw.slice(0, 16), 196);                           // huella 16 B @196 (no se valida)
  b.set(utf16le(host), 480);                                // servidor UTF-16LE @480
  w32(b, 476, host.length);                                 // [u32 len] del servidor
  w32(b, 736, parseInt(login, 10));                         // nº de cuenta u32 @736
  return b;
}

export class ClienteMT5Web {
  constructor(opts = {}) {
    this.login = opts.login;
    this.pass = opts.pass;
    this.host = opts.host || 'mt5.demo.weltrade.org';
    this.filtro = opts.filtro || /^(FX Vol|SFX Vol|Step|Boom|Crash|Range|FlipX|Drift)/i;
    /* tope de símbolos a suscribir cuando el filtro es el genérico
       (catálogo vacío → cientos de sintéticos agotan la memoria del
       teléfono). 0 = sin tope (se usa cuando el usuario da su lista). */
    this.limite = opts.limite || 0;
    this.nombres = {};        // id -> nombre
    this.ids = {};            // nombre -> id
    this.ws = null;
    this.clave = CLAVE_ESTATICA;
    this.etapa = 'apagado';
    this._ping = null;
    this._listeners = {};
    this._pendientes11 = new Map();
    this._cola11 = null;              // serialización de peticiones de velas
    this._silencio11Hasta = 0;        // ventana anti-respuesta-tardía tras un timeout
    this._cerrada = false;            // guard de idempotencia de _cerrar
    this._ultimoRX = 0;               // último byte recibido (detector de socket medio-abierto)
  }

  on(ev, fn) { (this._listeners[ev] ??= []).push(fn); return this; }
  emit(ev, d) { for (const f of this._listeners[ev] || []) { try { f(d); } catch (e) { console.error(e); } } }
  _log(msg) { this.emit('aviso', msg); }

  async _enviar(cmd, body = new Uint8Array(0)) {
    if (!this.ws || this.ws.readyState !== 1) return;
    try {
      const p = new Uint8Array(4 + body.length);
      p.set(_rnd(2), 0); h16(p, 2, cmd); p.set(body, 4);
      const cifrado = await aesEnc(this.clave, p);
      const f = new Uint8Array(8 + cifrado.length);
      const d = dv(f); d.setUint32(0, cifrado.length, true); d.setUint32(4, 1, true);
      f.set(cifrado, 8);
      this.ws.send(f.buffer);
    } catch (e) { /* reconexión lo cubre */ }
  }

  conectar() {
    this.etapa = 'conectando';
    this._cerrada = false;                    // nueva sesión: el guard de cierre se reinicia
    const ws = new WebSocket(`wss://${this.host}/terminal`);
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    this._ultimoRX = Date.now();
    this._ping = setInterval(() => {
      // socket medio-abierto (Android congeló la app, NAT cayó…): el server
      // no responde a 3 pulsos seguidos → cerrar ya, el backoff reconecta
      if (Date.now() - this._ultimoRX > 25000) {
        this._log('sin respuesta del servidor durante 25 s — cerrando para reconectar');
        this.cerrar();
        return;
      }
      this._enviar(51);
    }, 8000);
    // sesión incompleta 20 s (TCP colgado a medio abrir): cortar y reintentar
    this._tAbrir = setTimeout(() => {
      if (this.etapa !== 'listo') {
        this._log('sin sesión completa tras 20 s — cerrando para reintentar');
        this.cerrar();
      }
    }, 20000);

    ws.onopen = async () => { this.etapa = 'handshake'; await this._enviar(0, new Uint8Array(64)); };
    ws.onclose = () => this._cerrar();
    ws.onerror = () => { /* onclose llega después */ };
    ws.onmessage = (ev) => this._onMensaje(new Uint8Array(ev.data));
  }

  /* Idempotente: cierra-abierto + ws.close() + onclose tardío producían
     DOS eventos 'cerrar' por sesión y el backoff de la UI agendaba DOS
     reconexiones (bucle de reconexiones cada 3 s). UNA emisión como sea. */
  _cerrar() {
    if (this._cerrada) return;
    this._cerrada = true;
    clearInterval(this._ping);
    clearTimeout(this._tAbrir);
    this.etapa = 'apagado';
    for (const [, p] of this._pendientes11) { clearTimeout(p.timer); if (p.debounce) clearTimeout(p.debounce); p.resolver(null); }
    this._pendientes11.clear();
    this.emit('cerrar');
  }

  cerrar() { try { this.ws && this.ws.close(); } catch (e) { } this._cerrar(); }

  async _onMensaje(buf) {
    this._ultimoRX = Date.now();   // hay señal vital aunque el frame no se entienda
    let p;
    try {
      const pt = await aesDec(this.clave, buf.subarray(8));
      p = { cmd: h16le(pt, 2), dd: pt[4], body: pt.subarray(5) };
    } catch (e) { return; }

    // Handshake: clave de sesión en body[66..98]
    if (p.cmd === 0 && this.etapa === 'handshake') {
      this.clave = p.body.slice(66, 98);
      if (this.clave.length !== 32) {
        // sin este guard el fallo era mudo: importKey rechazaba y no llegaba nada
        this._log(`handshake inválido: clave de sesión de ${this.clave.length} B (esperados 32) — cerrando`);
        this.cerrar();
        return;
      }
      this.etapa = 'login';
      this._enviar(28, await buildLoginBody(this.login, this.pass, this.host));
      return;
    }
    // Login aceptado -> catálogo
    if (p.cmd === 28 && this.etapa === 'login') {
      if (p.dd !== 0) {
        this._log(`login rechazado (dd=${p.dd}) — revisa cuenta/contraseña/servidor`);
        this.emit('login_rechazado', { dd: p.dd });   // la UI para el reintento automático
        this.cerrar();
        return;
      }
      this.etapa = 'catalogo';
      this._enviar(3); this._enviar(9); this._enviar(6);
      return;
    }
    // Catálogo: registros de 526 B, nombre UTF-16 @0, id u32 @196
    if (p.cmd === 6 && this.etapa === 'catalogo') {
      const b = p.body;
      const n = u32(b, 0);
      for (let k = 0; k < n && 4 + (k + 1) * 526 <= b.length; k++) {
        const base = 4 + k * 526;
        const id = u32(b, base + 196);
        const nombre = utf16leLeer(b, base, base + 64);
        if (nombre) { this.nombres[id] = nombre; this.ids[nombre] = id; }
      }
      this.etapa = 'listo';
      let objetivos = Object.values(this.nombres).filter((nn) => this.filtro.test(nn));
      if (this.limite > 0 && objetivos.length > this.limite) {
        this._log(`filtro genérico dio ${objetivos.length} símbolos — se suscriben los primeros ${this.limite} (memoria del teléfono)`);
        objetivos = objetivos.slice(0, this.limite);
      }
      // suscripción de ticks: [u32 n][u32 id × n]
      const sub = new Uint8Array(4 + objetivos.length * 4);
      w32(sub, 0, objetivos.length);
      objetivos.forEach((nom, i) => w32(sub, 4 + i * 4, this.ids[nom]));
      this._enviar(7, sub);
      this._enviar(4);
      this._log(`listo: ${objetivos.length} símbolos suscritos`);
      this.emit('listo', { simbolos: objetivos });
      return;
    }
    // Ticks: registros de 50 B
    if (p.cmd === 8 && this.etapa === 'listo') {
      const b = p.body;
      for (let off = 0; off + 50 <= b.length; off += 50) {
        const id = u32(b, off);
        const bid = f64(b, off + 12) / 100, ask = f64(b, off + 20) / 100;
        if (!(bid > 0) || !(ask > 0)) continue;
        this.emit('tick', { simbolo: this.nombres[id] || `id_${id}`, bid, ask, t: Date.now() });
      }
      return;
    }
    // Velas (respuesta a cmd 11, posiblemente partida en varios frames).
    // La respuesta NO identifica el símbolo: va al único pendiente en
    // curso (las peticiones están serializadas); respuestas tardías de
    // una petición caducada se descartan por la ventana de silencio.
    if (p.cmd === 11 && this._pendientes11.size) {
      const vela = this._parseVelas(p.body);
      for (const [nombre, pend] of this._pendientes11) {
        if (!pend.buf) pend.buf = [];
        for (const v of vela.velas) pend.buf.push(v);
        pend.descartadas = (pend.descartadas || 0) + vela.descartadas;
        if (pend.debounce) clearTimeout(pend.debounce);
        pend.debounce = setTimeout(() => {
          clearTimeout(pend.timer);
          this._pendientes11.delete(nombre);
          pend.resolver({ velas: pend.buf, descartadas: pend.descartadas || 0 });
        }, 700);
      }
      return;
    }
  }

  /* Petición de velas. Layout capturado y verificado en sesión real:
     packet[4..64)   = símbolo UTF-16LE + terminador null (60 B)
     packet[68..70)  = u16 PERIOD_* de MT5 en little-endian (H1=0x4001, M15=15, M5=5...)
     packet[70..78)  = [u32 desde][u32 hasta] (época en segundos)
     Respuesta: registros de 48 B [u32 t][f64 o][f64 h][f64 l][f64 c][u32 vol][u32 flags] */
  /* Serializadas: cmd 11 no trae el símbolo en la respuesta y el reparto
     va a TODOS los pendientes — dos peticiones solapadas corromperían el
     histórico con velas del símbolo equivocado. Una cada vez, con una
     ventana de silencio tras cada timeout para tragar respuestas tardías. */
  pedirVelas(nombre, opts = {}) {
    if (this.etapa !== 'listo' || !this.ids[nombre]) return Promise.resolve(null);
    this._cola11 = (this._cola11 || Promise.resolve())
      .then(() => this._pedirVelasUna(nombre, opts), () => this._pedirVelasUna(nombre, opts));
    return this._cola11;
  }

  async _pedirVelasUna(nombre, { tf = 'H1', dias = 90, desde = 0, hasta = 0, timeoutMs = 10000 } = {}) {
    const guardia = Math.max(0, this._silencio11Hasta - Date.now());
    if (guardia) await new Promise((ok) => setTimeout(ok, guardia));
    if (this.etapa !== 'listo' || !this.ids[nombre]) return null;
    const ENUM_TF = { M1: 1, M5: 5, M15: 15, M30: 30, H1: 0x4001, H4: 0x4004, D1: 0x4018 };
    const periodo = ENUM_TF[tf] ?? 0x4001;
    const packet = new Uint8Array(78);
    packet.set(_rnd(2), 0); h16(packet, 2, 11);
    packet.set(utf16le(nombre), 4);                          // + terminador null (los ceros del alloc)
    const h = Math.floor(Number(hasta)) || Math.floor(Date.now() / 1000);
    const d = Math.floor(Number(desde)) || h - Math.max(1, dias) * 86400;
    h16(packet, 68, periodo);
    w32(packet, 70, d); w32(packet, 74, h);
    return new Promise((resolver) => {
      const timer = setTimeout(() => {
        const pend = this._pendientes11.get(nombre);
        if (pend && pend.debounce) clearTimeout(pend.debounce);
        this._pendientes11.delete(nombre);
        this._silencio11Hasta = Date.now() + 1500;   // traga respuestas tardías del timeout
        resolver(null);
      }, timeoutMs);
      this._pendientes11.set(nombre, { resolver, timer, iniciado: Date.now() });
      this._enviarRaw(packet);
    });
  }

  /* cmd 11 lleva su propia cabecera dentro del packet completo (no es solo body) */
  async _enviarRaw(packetCompleto) {
    if (!this.ws || this.ws.readyState !== 1) return;
    try {
      const cifrado = await aesEnc(this.clave, packetCompleto);
      const fr = new Uint8Array(8 + cifrado.length);
      const d = dv(fr); d.setUint32(0, cifrado.length, true); d.setUint32(4, 1, true);
      fr.set(cifrado, 8);
      this.ws.send(fr.buffer);
    } catch (e) { /* reconexión lo cubre */ }
  }

  /* Parser de velas: registros de 48 B. Corruptos se descartan. */
  _parseVelas(b) {
    const velas = []; let descartadas = 0;
    for (let off = 0; off + 48 <= b.length; off += 48) {
      const t = u32(b, off) * 1000;
      const o = f64(b, off + 4), h = f64(b, off + 12), l = f64(b, off + 20), c = f64(b, off + 28);
      const ok = t > 0 && [o, h, l, c].every(Number.isFinite) &&
        h >= Math.max(o, c) - 1e-9 && l <= Math.min(o, c) + 1e-9 && h >= l;
      if (!ok) { descartadas++; continue; }
      velas.push({ t, o, h, l, c });
    }
    return { velas, descartadas };
  }
}

/* util pequeña: leer u16 LE desde un Uint8Array */
function h16le(b, o) { return b[o] | (b[o + 1] << 8); }
