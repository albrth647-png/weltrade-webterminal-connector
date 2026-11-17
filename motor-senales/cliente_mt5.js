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
    this._pendiente11Actual = null;   // el ÚNICO pedido de velas en curso
    this._ultimoPrecio = {};          // nombre -> último precio vivo (guard de cruce)
    this._ultimoTick = {};            // nombre -> ts del último tick (frescura por símbolo)
    this._cola11 = null;              // serialización de peticiones de velas
    this._silencio11Hasta = 0;        // ventana anti-respuesta-tardía tras un timeout
    this._cerrada = false;            // guard de idempotencia de _cerrar
    this._feedMuerto = false;         // true cuando el feed murió por falta de ticks (rate limit / silencio del servidor)
    this._ultimoRX = 0;               // último byte recibido (detector de socket medio-abierto)
    this._tAbrir = null;
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
    /* Un socket anterior vivo debe cerrarse ANTES de abrir otro. Dos sesiones
       de la misma cuenta hacen que el servidor tumbe una; peor aún, su
       onclose tardío llamaba a _cerrar() y mataba la sesión nueva. */
    const previa = this.ws;
    this.ws = null;
    if (previa) { try { previa.close(); } catch (e) { /* ya cerrado */ } }
    this.etapa = 'conectando';
    this._cerrada = false;                    // nueva sesión: el guard de cierre se reinicia
    this._feedMuerto = false;                 // nueva sesión: reset del flag de feed muerto
    /* La clave de sesión (32 B del handshake) caduca con el socket. Sin este
       reset el handshake del reintento iba cifrado con la clave de la sesión
       anterior, el servidor no lo podía descifrar y cerraba con 1006 a los 2 s:
       el proceso quedaba desconectado en bucle hasta reiniciarlo a mano. */
    this.clave = CLAVE_ESTATICA;
    const ws = new WebSocket(`wss://${this.host}/terminal`);
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    this._ultimoRX = Date.now();
    this._tConectado = Date.now();
    this._ping = setInterval(() => {
      // socket medio-abierto: 3 pulsos sin recibir NADA = muerto → cerrar ya
      if (Date.now() - this._ultimoRX > 25000) {
        this._log('sin respuesta del servidor durante 25 s — marcando feed muerto y cerrando para reconectar');
        this._feedMuerto = true;
        this.cerrar();
        return;
      }
      this._enviar(51, Buffer.alloc(0));
    }, 5000);
    this._tAbrir = setTimeout(() => {
      if (this.etapa !== 'listo') {
        this._log('sin sesión completa tras 20 s — cerrando para reintentar');
        this.cerrar();
      }
    }, 20000);

    ws.onopen = () => { this.etapa = 'handshake'; this._enviar(0, Buffer.alloc(64)); };
    /* El código y el motivo del cierre son la única pista de por qué el
       servidor corta: 1000 = cierre normal, 1006 = red/abrupto, 4xxx = el
       servidor rechaza la sesión. Sin esto solo veíamos «sesión cerrada». */
    ws.onclose = (ev) => {
      /* Cierre tardío de un socket que ya no es el actual: no tocar la sesión
         viva ni programar otra reconexión. */
      if (this.ws !== ws) return;
      const seg = this._tConectado ? Math.round((Date.now() - this._tConectado) / 1000) : null;
      this._log(`socket cerrado tras ${seg ?? '?'} s (code ${ev?.code ?? '?'}${ev?.reason ? ', ' + ev.reason : ''})`);
      this._cerrar();
    };
    ws.onerror = (ev) => {
      const detalle = ev?.message || ev?.error?.message || ev?.type || 'sin detalle';
      this._log('socket error: ' + detalle);
    };
    ws.onmessage = (ev) => this._onMensaje(Buffer.from(ev.data));
  }

  /* Idempotente: muerte de red + cerrar() explícito + onclose tardío
     emitían DOS 'cerrar' y la app agendaba DOS reconexiones. UNA como sea. */
  _cerrar() {
    if (this._cerrada) return;
    this._cerrada = true;
    clearInterval(this._ping);
    clearTimeout(this._tAbrir);
    this.etapa = 'apagado';
    for (const [, p] of this._pendientes11) { clearTimeout(p.timer); if (p.debounce) clearTimeout(p.debounce); p.resolver(null); }
    this._pendientes11.clear();
    this._pendiente11Actual = null;
    this.emit('cerrar');
  }

  cerrar() { try { this.ws && this.ws.close(); } catch (e) { } this._cerrar(); }

  _onMensaje(buf) {
    /* Un frame truncado, corrupto o de un servidor hostil NO puede tumbar el
       motor. Antes, un cmd 6 con cuerpo de 0-3 B lanzaba
       ERR_BUFFER_OUT_OF_BOUNDS desde ws.onmessage (fuera de try) y mataba el
       proceso entero. */
    try {
      /* ws.onmessage entrega ArrayBuffer; los tests y la PWA pasan Uint8Array.
         Se normaliza a Buffer antes de parsear. */
      this._procesarMensaje(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
    } catch (e) {
      try { this._log(`frame descartado (${e.code || e.name || 'error'}): ${e.message}`); } catch (_) { /* el log nunca debe relanzar */ }
    }
  }

  _procesarMensaje(buf) {
    if (!buf || buf.length < 8) {
      this._log('frame descartado: cabecera incompleta');
      return;
    }
    this._ultimoRX = Date.now();   // hay señal vital aunque el frame no se entienda
    let p;
    try { p = parseRX(aesDec(this.clave, buf.subarray(8))); } catch (e) { return; }

    // Handshake: clave de sesión en body[66..98]
    if (p.cmd === 0 && this.etapa === 'handshake') {
      this.clave = p.body.subarray(66, 98);
      if (this.clave.length !== 32) {
        // sin este guard createCipheriv lanzaba dentro de un try silencioso
        this._log(`handshake inválido: clave de sesión de ${this.clave.length} B (esperados 32) — cerrando`);
        this._cerrar();
        return;
      }
      this.etapa = 'login';
      this._enviar(28, buildLoginBody(this.login, this.pass, this.host));
      return;
    }
    // Login aceptado -> catálogo
    if (p.cmd === 28 && this.etapa === 'login') {
      if (p.dd !== 0) {
        this._log(`login rechazado (dd=${p.dd}) — revisa cuenta/contraseña/servidor`);
        this.emit('login_rechazado', { dd: p.dd });   // app.js corta la reconexión automática
        this.cerrar();
        return;
      }
      this.etapa = 'catalogo';
      this._enviar(3, Buffer.alloc(0)); this._enviar(9, Buffer.alloc(0)); this._enviar(6, Buffer.alloc(0));
      return;
    }
    // Catálogo: registros de 526 B, nombre UTF-16 @0, id u32 @196
    if (p.cmd === 6 && this.etapa === 'catalogo') {
      const b = p.body;
      /* Guard de longitud + tope al número de registros que caben de verdad:
         un contador corrupto (0xFFFFFFFF) ya no recorre memoria fuera del
         buffer ni permite un bucle desmedido. */
      if (b.length < 4) {
        this._log('catálogo truncado: falta el contador de símbolos');
        return;
      }
      const n = Math.min(b.readUInt32LE(0), Math.floor((b.length - 4) / 526));
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
        const simbolo = this.nombres[id] || `id_${id}`;
        /* precio vivo: es lo que permite detectar velas de OTRO activo antes de
           meterlas en el histórico (la respuesta de cmd 11 no trae el símbolo) */
        this._ultimoPrecio[simbolo] = (bid + ask) / 2;
        this._ultimoTick[simbolo] = Date.now();
        this.emit('tick', { simbolo, bid, ask, t: Date.now() });
      }
      return;
    }
    // Velas (respuesta a cmd 11, posiblemente partida en varios frames)
    if (p.cmd === 11) {
      /* La respuesta NO identifica el símbolo: se entrega ÚNICAMENTE al pedido
         en curso. Antes se repartía a todos los pendientes y, cuando un lote
         llegaba partido con más de 700 ms entre trozos, el resto se pegaba al
         símbolo SIGUIENTE: el búfer de un activo quedaba con precios de otro
         (la señal decía FX Vol 20 con el precio de SFX Vol 20). */
      const nombre = this._pendiente11Actual;
      const pend = nombre && this._pendientes11.get(nombre);
      if (!pend) return;                              // sin pedido vivo: se descarta
      if (Date.now() < this._silencio11Hasta) return;  // resto de un lote caducado
      const vela = this._parseVelas(p.body);
      if (!pend.buf) pend.buf = [];
      for (const v of vela.velas) pend.buf.push(v);
      pend.descartadas = (pend.descartadas || 0) + vela.descartadas;
      if (pend.debounce) clearTimeout(pend.debounce);
      pend.debounce = setTimeout(() => {
        clearTimeout(pend.timer);
        this._pendientes11.delete(nombre);
        if (this._pendiente11Actual === nombre) this._pendiente11Actual = null;
        /* Cooldown tras cerrar el lote: un trozo tardío ya no puede entrar en
           el pedido del símbolo siguiente. */
        /* Ventana de silencio adaptativa: un lote grande llega en muchos
           frames y sus últimos trozos pueden pisar la petición siguiente, así
           que necesita 2,5 s. Una respuesta incremental (pocas velas, un solo
           frame) no tiene cola que se retrase y con 800 ms basta: así el
           refresco rápido de M1/M5 no se queda esperando 2,5 s por símbolo. */
        this._silencio11Hasta = Date.now() + ((pend.buf && pend.buf.length >= 200) ? 2500 : 400);
        pend.resolver(this._loteValido(nombre, pend.buf, pend.descartadas || 0));
      }, 700);
      return;
    }
  }

  /* Petición de velas. Layout capturado y verificado en sesión real:
     packet[4..64)   = símbolo UTF-16LE + null, relleno con ceros (60 B)
     packet[64..66)  = u16 PERIOD_* de MT5 en little-endian (H1=0x4001, M15=15, M5=5...)
     packet[66..74)  = [u32 desde][u32 hasta] (época en segundos; el servidor
                       responde con las velas de ese rango)
     Respuesta: registros de 48 B [u32 t][f64 o][f64 h][f64 l][f64 c][u32 vol][u32 ?] */
  /* Serializadas: cmd 11 no trae el símbolo en la respuesta y el reparto
     va a TODOS los pendientes — dos peticiones solapadas corromperían el
     histórico con velas del símbolo equivocado. Una cada vez. */
  pedirVelas(nombre, opts = {}) {
    if (this.etapa !== 'listo' || !this.ids[nombre]) return Promise.resolve(null);
    this._cola11 = (this._cola11 || Promise.resolve())
      .then(() => this._pedirVelasUna(nombre, opts), () => this._pedirVelasUna(nombre, opts));
    return this._cola11;
  }

  /* Espera a tener precio vivo del símbolo. Sin él NO se pueden pedir velas:
     la respuesta de cmd 11 no dice de qué instrumento son, así que el precio
     vivo es la única prueba de identidad disponible. */
  esperarPrecio(nombre, ms = 8000) {
    const ok = () => Number.isFinite(this._ultimoPrecio[nombre]) && this._ultimoPrecio[nombre] > 0
      && (Date.now() - (this._ultimoTick[nombre] || 0)) < 90000;
    if (ok()) return Promise.resolve(true);
    return new Promise((resolver) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (ok()) { clearInterval(iv); resolver(true); return; }
        if (Date.now() - t0 >= ms || this.etapa === 'apagado') { clearInterval(iv); resolver(false); }
      }, 100);
      if (iv.unref) iv.unref();
    });
  }

  async _pedirVelasUna(nombre, { tf = 'H1', dias = 90, desde = 0, hasta = 0, timeoutMs = 10000 } = {}) {
    const guardia = Math.max(0, this._silencio11Hasta - Date.now());
    if (guardia) await new Promise((ok) => setTimeout(ok, guardia));
    if (this.etapa !== 'listo' || !this.ids[nombre]) return null;
    /* Puerta de identidad: sin precio vivo no se pide. Antes se pedía a ciegas
       y el lote del símbolo anterior acababa guardado bajo el siguiente. */
    if (!(Number.isFinite(this._ultimoPrecio[nombre]) && this._ultimoPrecio[nombre] > 0)) {
      const hay = await this.esperarPrecio(nombre, 8000);
      if (!hay) {
        this._log(`velas de ${nombre}: sin precio vivo tras 8 s — no se piden (no se podría verificar el símbolo)`);
        return null;
      }
    }
    const ENUM_TF = { M1: 1, M5: 5, M15: 15, M30: 30, H1: 0x4001, H4: 0x4004, D1: 0x4018 };
    const periodo = ENUM_TF[tf] ?? 0x4001;
    const packet = Buffer.alloc(78);                          // [4B cabecera][60B símbolo][2B tf][8B rango]
    packet[0] = crypto.randomInt(256); packet[1] = crypto.randomInt(256); packet.writeUInt16LE(11, 2);
    Buffer.from(nombre, 'utf16le').copy(packet, 4);          // + terminador null (los ceros del alloc)
    const h = Math.floor(Number(hasta)) || Math.floor(Date.now() / 1000);
    const d = Math.floor(Number(desde)) || h - Math.max(1, dias) * 86400;
    packet[68] = periodo & 0xff; packet[69] = (periodo >> 8) & 0xff;
    packet.writeUInt32LE(d, 70); packet.writeUInt32LE(h, 74);
    return new Promise((resolver) => {
      const timer = setTimeout(() => {
        const pend = this._pendientes11.get(nombre);
        if (pend && pend.debounce) clearTimeout(pend.debounce);
        this._pendientes11.delete(nombre);
        if (this._pendiente11Actual === nombre) this._pendiente11Actual = null;
        this._silencio11Hasta = Date.now() + 4000;   // traga respuestas tardías del timeout
        resolver(null);
      }, timeoutMs);
      this._pendientes11.set(nombre, { resolver, timer, iniciado: Date.now() });
      this._pendiente11Actual = nombre;
      this._enviarPacket(packet);
    });
  }

  /* Guard de cruce: el último cierre del lote tiene que estar en el rango del
     precio vivo del símbolo. Si no, son velas de otro activo y se descartan
     ANTES de envenenar el histórico (FX Vol 20 ~118.000 · SFX Vol 20 ~35.300:
     un 20 % de desvío no es volatilidad, es un cruce de respuesta). */
  _loteValido(nombre, velas, descartadas) {
    if (!velas || !velas.length) return { velas: velas || [], descartadas };
    const ref = this._ultimoPrecio[nombre];
    /* Sin precio vivo no hay prueba de identidad: se rechaza el lote entero.
       Antes se aceptaba a ciegas y cada símbolo terminó guardando el lote del
       anterior (los 21 casos quedaron etiquetados con el activo equivocado). */
    if (!(Number.isFinite(ref) && ref > 0)) {
      this._log(`velas de ${nombre} descartadas: sin precio vivo con el que verificar el símbolo`);
      return { velas: [], descartadas: descartadas + velas.length };
    }
    /* Frescura por símbolo: un precio de hace minutos no prueba identidad ni
       sirve para anclar; el instrumento pudo quedarse sin ticks (M2). */
    const edadTick = Date.now() - (this._ultimoTick[nombre] || 0);
    if (!(edadTick < 90000)) {
      this._log(`velas de ${nombre} descartadas: precio vivo congelado (${Math.round(edadTick / 1000)} s sin tick)`);
      return { velas: [], descartadas: descartadas + velas.length };
    }
    const ult = velas[velas.length - 1].c;
    if (!Number.isFinite(ult) || Math.abs(ult - ref) / ref > 0.15) {
      this._log(`velas de ${nombre} descartadas: cierre ${ult} no cuadra con el precio vivo ${ref} (cruce de cmd 11)`);
      return { velas: [], descartadas: descartadas + velas.length };
    }
    /* Recorta a la cola CONTIGUA: si el lote mezcla dos instrumentos a mitad,
       el cierre cuadra pero la mitad antigua es de otro activo. Se conserva
       solo el tramo final cuyas velas encadenan (<5 % de salto por vela). */
    let corte = velas.length - 1;
    for (let i = velas.length - 2; i >= 0; i--) {
      const a = velas[i].c, b = velas[i + 1].c;
      if (!(a > 0) || !Number.isFinite(a) || !Number.isFinite(b)) break;
      if (Math.abs(b - a) / a > 0.05) break;
      corte = i;
    }
    if (corte > 0) {
      this._log(`velas de ${nombre}: recortadas ${corte} iniciales que no encadenan con el tramo válido`);
      descartadas += corte;
    }
    return { velas: velas.slice(corte), descartadas };
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
