#!/usr/bin/env node
/* ============================================================
   ABRIR DEMO WELTRADE + DESCARGAR VELAS (protocolo WebTerminal)
   ------------------------------------------------------------
   Fase 1 (crear): handshake -> cmd 29 (sesión anónima) -> cmd 30
     (abrir cuenta demo, layout `xi()` del cliente oficial:
     nombre, grupo, phonePassword, país..., depósito f64, apalanc.)
     Respuesta: [u32 login][i64 tipo][wstr32 password][wstr32 phonePass]
   Fase 2 (velas): login cmd 28 -> cmd 11 por símbolo/periodo
     petición: wstr64 símbolo @0 | u16 periodo @64 | u32 desde @66 | u32 hasta @70
     respuesta: registros de 48 B [u32 t][f64 o][f64 h][f64 l][f64 c][u32 vol][u32 ?]
   Credenciales -> motor-senales/.env (gitignoreado, NUNCA se sube)
   Velas       -> backtest_hibrida/datos/<simbolo>_<TF>.csv
   Robustez    -> 3 reintentos por trozo (conexión mala) y fusión por timestamp
                  con el CSV existente: repetir una descarga NUNCA duplica velas.
                  Incremental por defecto (desde la última vela guardada, que se
                  refresca); --completo re-pide la ventana entera y fusiona.
   Uso:
     node abrir_demo.js crear
     node abrir_demo.js velas --simbolos "FX Vol 20,FX Vol 60" --periodos M5,M15 --dias 366 [--completo]
   ============================================================ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HOST = process.env.WT_HOST || 'mt5.demo.weltrade.org';
const ROOT = path.join(__dirname, '..');
const ENV_FILE = path.join(ROOT, 'motor-senales', '.env');
const DATOS = path.join(ROOT, 'backtest_hibrida', 'datos');

const PERIODOS = { M1: 1, M5: 5, M15: 15, M30: 30, H1: 0x4001, H4: 0x4004, D1: 0x4018 };

// ---------- cripto (idéntica a conector.js) ----------
const OBF = '13ef13b2b76dd8:5795gdcfb2fdc1ge85bf768f54773d22fff996e3ge75g5:75';
const obfuscation = (e) => e.split('').map((ch) => ch.charCodeAt(0) === 28 ? '&' : ch.charCodeAt(0) === 23 ? '!' : String.fromCharCode(ch.charCodeAt(0) - 1)).join('');
const STATIC_KEY = Buffer.from((obfuscation(OBF).match(/.{2}/g) || []).map((x) => parseInt(x, 16)));
const aesEnc = (key, data) => { const c = crypto.createCipheriv('aes-256-cbc', key, Buffer.alloc(16)); return Buffer.concat([c.update(data), c.final()]); };
const aesDec = (key, data) => { const d = crypto.createDecipheriv('aes-256-cbc', key, Buffer.alloc(16)); d.setAutoPadding(true); return Buffer.concat([d.update(data), d.final()]); };
const buildPacket = (cmd, body) => { const h = Buffer.alloc(4); h[0] = crypto.randomInt(256); h[1] = crypto.randomInt(256); h.writeUInt16LE(cmd, 2); return Buffer.concat([h, body]); };
const buildFrame = (key, cmd, body) => { const c = aesEnc(key, buildPacket(cmd, body)); const f = Buffer.alloc(8 + c.length); f.writeUInt32LE(c.length, 0); f.writeUInt32LE(1, 4); c.copy(f, 8); return f; };
const parseRX = (pt) => ({ cmd: pt.readUInt16LE(2), dd: pt[4], body: pt.subarray(5) });

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------- serializador del cliente (tipos: 6=u32, 8=f64, 11=wstr fijo, 12=buf fijo, 18=u64) ----------
function wstr(nBytes) { return Buffer.alloc(nBytes); } // UTF-16LE terminado en nulo, resto 0
function ponWstr(buf, off, str, nBytes) {
  const s = Buffer.from(String(str).slice(0, nBytes / 2 - 1), 'utf16le');
  s.copy(buf, off); if (s.length + 2 <= nBytes) buf.writeUInt16LE(0, off + s.length);
}
function leeWstr(b, off, nBytes) {
  let s = '';
  for (let j = off; j < off + nBytes - 1; j += 2) { const ch = b.readUInt16LE(j); if (!ch) break; s += String.fromCharCode(ch); }
  return s;
}

// cuerpo de sesión anónima (cmd 29) — layout `Fi({})` del cliente, 912 B como el login capturado
function bodyAnonimo() {
  const b = Buffer.alloc(912);
  crypto.randomBytes(16).copy(b, 196);        // huella/salt
  return b;
}

// cuerpo de login (cmd 28) — el de conector.js, verificado en vivo
function bodyLogin(login, pass) {
  const b = Buffer.alloc(912);
  Buffer.from(pass, 'utf16le').copy(b, 4);
  crypto.createHash('sha1').update(`termux;${login};${Date.now()}`).digest().subarray(0, 16).copy(b, 196);
  const s16 = Buffer.from(HOST, 'utf16le');
  b.writeUInt32LE(HOST.length, 476); s16.copy(b, 480);
  b.writeUInt32LE(parseInt(login, 10), 736);
  return b;
}

// cuerpo cmd 30 (abrir demo) — layout `xi()` del cliente: 1.664 B
function bodyAbrirDemo(p) {
  const b = Buffer.alloc(1664);
  let o = 0;
  const w = (str, n) => { ponWstr(b, o, str, n); o += n; };
  const u32 = (v) => { b.writeUInt32LE(v >>> 0, o); o += 4; };
  const f64 = (v) => { b.writeDoubleLE(v, o); o += 8; };
  w(p.nombre, 256);        // [11, nombre, 256]
  w(p.grupo, 128);         // [11, grupo, 128]
  w(p.phonePassword, 64);  // [11, phonePassword, 64]
  w(p.pais, 64);           // [11, país, 64]
  w(p.ciudad, 64);         // [11, ciudad, 64]
  w(p.estado, 64);         // [11, estado, 64]
  w(p.cp, 32);             // [11, zipcode, 32]
  w(p.direccion, 256);     // [11, dirección, 256]
  w(p.telefono, 64);       // [11, teléfono, 64]
  w(p.email, 128);         // [11, email, 128]
  f64(p.deposito);         // [8, depósito]
  u32(p.apalancamiento);   // [6, apalancamiento]
  u32(0);                  // [6, 0]
  u32(1);                  // [6, 1]
  w(p.dominio, 128);       // [11, dominio, 128]
  w('', 64);               // [11, utm_campaign, 64]
  w('', 64);               // [11, utm_source, 64]
  u32(0);                  // [6, emailConfirmCode]
  u32(0);                  // [6, phoneConfirmCode]
  w(p.nombre, 128);        // [11, firstName, 128]
  w('', 128);              // [11, secondName, 128]
  u32(1);                  // [6, agreements]
  return b;
}

// ---------- sesión WS genérica ----------
function conectar(cuerpoHandshake = Buffer.alloc(64)) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`wss://${HOST}/terminal`);
    ws.binaryType = 'arraybuffer';
    const st = { key: STATIC_KEY, ws, abierta: false, pendientes: [], cola: [] };
    ws.onopen = () => ws.send(buildFrame(STATIC_KEY, 0, cuerpoHandshake));
    ws.onerror = (e) => rej(new Error('WS error: ' + (e.message || e.error || 'desconocido')));
    ws.onclose = () => { st.abierta = false; };
    ws.onmessage = (ev) => {
      const buf = Buffer.from(ev.data);
      let p;
      try { p = parseRX(aesDec(st.key, buf.subarray(8))); } catch { return; }
      if (p.cmd === 0 && !st.abierta) {
        st.key = p.body.subarray(66, 98);
        if (st.key.length !== 32) return rej(new Error(`handshake inválido (${st.key.length} B)`));
        st.abierta = true;
        st.enviar = (cmd, body) => ws.send(buildFrame(st.key, cmd, body));
        const q = st.cola.splice(0); q.forEach((f) => f());
        return;
      }
      st.pendientes.forEach((f) => f(p));
    };
    st.cuando = (fn) => new Promise((res) => { if (st.abierta) { fn(); res(); } else st.cola.push(() => { fn(); res(); }); });
    st.cerrar = () => { try { ws.close(); } catch {} };
    res(st);
  });
}

function esperar(st, filtro, ms = 20000) {
  return new Promise((res, rej) => {
    // el manejador se retira SIEMPRE (al responder o al vencer): si se quedara
    // colgado tras un timeout, una respuesta posterior lo resolvería por error.
    const manejador = (p) => {
      if (!filtro(p)) return;
      clearTimeout(t);
      st.pendientes = st.pendientes.filter((x) => x !== manejador);
      res(p);
    };
    const t = setTimeout(() => {
      st.pendientes = st.pendientes.filter((x) => x !== manejador);
      rej(new Error('timeout esperando respuesta'));
    }, ms);
    st.pendientes.push(manejador);
  });
}

// ---------- FASE 1: crear demo ----------
async function crearDemo() {
  const st = await conectar();
  const pass = crypto.randomBytes(9).toString('base64url').slice(0, 12) + 'A1!';
  const phonePass = crypto.randomBytes(4).toString('hex') + 'A1!';
  const p = {
    nombre: 'Raptor Backtest',
    grupo: process.env.WT_DEMO_GRUPO || 'demo',
    phonePassword: phonePass,
    pais: 'Spain', ciudad: '', estado: '', cp: '', direccion: '', telefono: '',
    email: `raptor.bt.${Date.now().toString(36)}@gmail.com`,
    deposito: 100000, apalancamiento: 100,
    dominio: 'weltrade.com',
  };
  await st.cuando(() => {});   // espera handshake
  // cmd 29: sesión anónima (el cliente lo hace antes de abrir demo)
  let rx;
  st.enviar(29, bodyAnonimo());
  try { rx = await esperar(st, (q) => q.cmd === 29, 15000); }
  catch { rx = null; }
  log(rx ? `cmd29 ok (dd=${rx.dd}, ${rx.body.length}B)` : 'cmd29 sin respuesta — sigo con cmd30');
  // cmd 30: abrir demo
  st.enviar(30, bodyAbrirDemo(p));
  rx = await esperar(st, (q) => q.cmd === 30, 25000);
  if (rx.dd !== 0) {
    const hex = rx.body.subarray(0, 64).toString('hex');
    throw new Error(`cmd30 rechazado (dd=${rx.dd}) body=${hex} «${rx.body.toString('utf8').slice(0, 80)}»`);
  }
  const b = rx.body;
  const login = b.readUInt32LE(0);
  const tipo = Number(b.readBigInt64LE(4));
  const password = leeWstr(b, 12, 64);
  const phonePassword = leeWstr(b, 76, 64);
  st.cerrar();
  if (!login || !password) throw new Error('respuesta cmd30 sin credenciales: ' + b.subarray(0, 64).toString('hex'));
  log(`✅ DEMO CREADA — login=${login} tipo=${tipo} password=${password} phonePass=${phonePassword}`);
  // guardar SOLO en .env local (gitignoreado)
  fs.mkdirSync(path.dirname(ENV_FILE), { recursive: true });
  const linea = `WT_LOGIN=${login}\nWT_PASS=${password}\nWT_HOST=${HOST}\n`;
  fs.writeFileSync(ENV_FILE, linea);
  fs.chmodSync(ENV_FILE, 0o600);
  log(`credenciales guardadas en ${path.relative(ROOT, ENV_FILE)} (gitignoreado)`);
  return { login, password };
}

// ---------- FASE 2: descargar velas ----------
function argvVal(flag, def) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : def;
}

async function descargarVelas() {
  // leer .env
  const env = {};
  if (fs.existsSync(ENV_FILE)) for (const l of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = l.match(/^\s*(WT_[A-Z_]+)\s*=\s*(.*?)\s*$/); if (m) env[m[1]] = m[2];
  }
  if (!env.WT_LOGIN || !env.WT_PASS) throw new Error('no hay credenciales: ejecuta antes `node abrir_demo.js crear`');
  // el proyecto trabaja SOLO con estos 4 índices (por defecto y sin sorpresas)
  const simbolos = (argvVal('--simbolos', 'FX Vol 20,FX Vol 40,SFX Vol 20,SFX Vol 40')).split(',').map((s) => s.trim()).filter(Boolean);
  const periodos = (argvVal('--periodos', 'M5,M15,M30,H1')).split(',').map((s) => s.trim());
  const dias = parseInt(argvVal('--dias', '366'), 10);
  const hasta = Math.floor(Date.now() / 1000);
  const desde = hasta - dias * 86400;
  fs.mkdirSync(DATOS, { recursive: true });

  const st = await conectar();
  await st.cuando(() => {});   // espera handshake
  st.enviar(28, bodyLogin(env.WT_LOGIN, env.WT_PASS));
  const rxL = await esperar(st, (q) => q.cmd === 28, 15000);
  if (rxL.dd !== 0) throw new Error(`login rechazado (dd=${rxL.dd})`);
  log(`login ok (${env.WT_LOGIN})`);

  const INTENTOS = 3;
  const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
  const completo = process.argv.includes('--completo');

  /* pide un trozo con reintentos: si falla la conexión repite EL MISMO trozo
     (no avanza ni deja hueco) y avisa en el log; agotados los intentos sigue
     con el trozo siguiente para no perder el resto del par. */
  async function pedirTrozo(simbolo, per, d0, d1) {
    const body = Buffer.alloc(74);
    ponWstr(body, 0, simbolo, 64);
    body.writeUInt16LE(PERIODOS[per] ?? 0, 64);
    body.writeUInt32LE(d0, 66);
    body.writeUInt32LE(d1, 70);
    for (let intento = 1; intento <= INTENTOS; intento++) {
      st.enviar(11, body);
      const rx = await esperar(st, (q) => q.cmd === 11, 20000).catch(() => null);
      if (rx && rx.dd === 0) return rx.body;
      log('WARN', `  ${simbolo} ${per}: intento ${intento}/${INTENTOS} ${rx ? `dd=${rx.dd}` : 'sin respuesta'}${intento < INTENTOS ? ` — reintento en ${intento}s` : ' — trozo perdido'}`);
      if (intento < INTENTOS) await pausa(intento * 1000);
    }
    return null;
  }

  for (const simbolo of simbolos) {
    for (const per of periodos) {
      const archivo = path.join(DATOS, `${simbolo.replace(/\s+/g, '_')}_${per}.csv`);

      // 1) lo que ya está en disco (clave = timestamp): no se vuelve a pedir ni
      //    puede duplicarse al fusionar
      const enDisco = new Map();
      if (fs.existsSync(archivo)) {
        for (const linea of fs.readFileSync(archivo, 'utf8').split('\n').slice(1)) {
          if (!linea.trim()) continue;
          const p = linea.split(',');
          const t = Math.floor(Date.parse(p[0]) / 1000);
          if (Number.isFinite(t)) enDisco.set(t, [t, +p[1], +p[2], +p[3], +p[4], +p[5]]);
        }
      }

      // 2) incremental: se re-pide desde la ÚLTIMA vela guardada (así se refresca
      //    la que estaba en formación). --completo ignora el disco y re-pide todo.
      let desdePar = desde;
      if (!completo && enDisco.size) desdePar = Math.max(desde, Math.max(...enDisco.keys()));
      if (desdePar >= hasta) { log(`  ${simbolo} ${per}: al dia (${enDisco.size} velas)`); continue; }

      const filas = new Map();   // t -> fila: sin duplicados por construcción
      let perdidos = 0;
      /* trozo: como máximo ~4000 velas del periodo pedido. El servidor trunca
         las respuestas grandes sin avisar (30 días de M5 = 8.640 velas), así
         que se parte la ventana para que ninguna vela quede fuera. */
      const SEG_PER = { M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400 };
      const paso = Math.min(40 * 86400, 4000 * (SEG_PER[per] || 300));
      for (let d0 = desdePar; d0 < hasta; d0 += paso) {
        const d1 = Math.min(d0 + paso, hasta);
        const b = await pedirTrozo(simbolo, per, d0, d1);
        if (!b) { perdidos++; continue; }
        for (let off = 0; off + 48 <= b.length; off += 48) {
          const t = b.readUInt32LE(off);
          filas.set(t, [t, b.readDoubleLE(off + 4), b.readDoubleLE(off + 12), b.readDoubleLE(off + 20), b.readDoubleLE(off + 28), b.readUInt32LE(off + 36)]);
        }
      }
      if (!filas.size) { log(`  ${simbolo} ${per}: sin velas nuevas${perdidos ? ` (${perdidos} trozo(s) perdido(s))` : ''}`); continue; }

      let nuevas = 0;
      for (const t of filas.keys()) if (!enDisco.has(t)) nuevas++;
      // 3) fusión por timestamp: lo recién pedido manda (refresca la vela viva)
      const todas = [...new Map([...enDisco, ...filas]).values()].sort((a, b) => a[0] - b[0]);
      const csv = ['time,open,high,low,close,volume', ...todas.map((f) =>
        [new Date(f[0] * 1000).toISOString(), f[1], f[2], f[3], f[4], f[5]].join(','))].join('\n') + '\n';
      fs.writeFileSync(archivo, csv);
      log(`  ${simbolo} ${per}: ${todas.length} velas (${nuevas} nuevas, ${filas.size - nuevas} refrescadas)` +
        `${perdidos ? ` · ${perdidos} trozo(s) perdido(s)` : ''} -> ${path.basename(archivo)} ` +
        `(${new Date(todas[0][0] * 1000).toISOString().slice(0, 10)} → ${new Date(todas[todas.length - 1][0] * 1000).toISOString().slice(0, 10)})`);
    }
  }
  st.cerrar();
}

// ---------- main ----------
if (require.main === module) {
  (async () => {
    const fase = process.argv[2] || 'crear';
    try {
      if (fase === 'crear') await crearDemo();
      else if (fase === 'velas') await descargarVelas();
      else throw new Error('fase desconocida: crear | velas');
      process.exit(0);
    } catch (e) {
      console.error('[ERROR]', e.message);
      process.exit(1);
    }
  })();
}
module.exports = { crearDemo, descargarVelas, conectar, esperar, bodyAbrirDemo, bodyAnonimo, bodyLogin, leeWstr, ponWstr, log, HOST, ENV_FILE, buildFrame, buildPacket, parseRX, STATIC_KEY };
