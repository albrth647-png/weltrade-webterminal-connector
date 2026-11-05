// Deriva la clave AES del WebTerminal y descifra las cabeceras de los frames capturados
const fs = require('fs');
const crypto = require('crypto');

const OBF = '13ef13b2b76dd8:5795gdcfb2fdc1ge85bf768f54773d22fff996e3ge75g5:75';

function obfuscation(e) {
  let t = [];
  for (let r = 0; r < e.length; r++) {
    const c = e.charCodeAt(r);
    t.push(c === 28 ? '&' : c === 23 ? '!' : String.fromCharCode(c - 1));
  }
  return t.join('');
}

function hexToBuffer(e) {
  const t = [];
  for (let r = 0, n = e.length / 2; r < n; r++) t.push(Number('0x' + e.substring(2 * r, 2 * r + 2)));
  return Buffer.from(t);
}

const hexStr = obfuscation(OBF);
console.log('hex tras obfuscation:', hexStr, '(len', hexStr.length + ')');
const keyBuf = hexToBuffer(hexStr);
console.log('CLAVE AES (%d bytes): %s', keyBuf.length, keyBuf.toString('hex'));

function decryptHead(payload) {
  const iv = Buffer.alloc(16); // IV de ceros
  const d = crypto.createDecipheriv('aes-256-cbc', keyBuf, iv);
  d.setAutoPadding(false);
  return Buffer.concat([d.update(payload), d.final()]);
}

const lines = fs.readFileSync('/home/z/my-project/re/ws_frames.log', 'utf8').split('\n').filter(Boolean);
for (const line of lines.slice(0, 14)) {
  const m = line.match(/^(TX|RX#?\d*) (\d+)B head=([0-9a-f]+)/);
  if (!m) continue;
  const full = Buffer.from(m[3], 'hex');
  const len = full.readUInt32LE(0);
  const flags = full.readUInt32LE(4);
  const payload = full.subarray(8); // 24 bytes = 1 bloque completo + 8
  const block1 = payload.subarray(0, 16);
  let pt = '';
  try {
    const dec = decryptHead(block1);
    pt = `AES1=${dec.toString('hex')} | utf16="${dec.toString('utf16le').replace(/[^\x20-\x7e]/g, '.')}" | ascii="${dec.toString('latin1').replace(/[^\x20-\x7e]/g, '.')}"`;
  } catch (e) {
    pt = 'fallo: ' + e.message;
  }
  console.log(`${m[1].padEnd(5)} ${m[2].padStart(5)}B len=${String(len).padStart(5)} flags=${flags} PT: ${pt}`);
}
