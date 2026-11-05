// Localiza campos exactos dentro del cuerpo del login capturado
const fs = require('fs');
const b = fs.readFileSync('/home/z/my-project/re/login_body.bin');
const login = process.env.WT_LOGIN || '10000000';
const loginNum = parseInt(login, 10);
const pass = process.env.WT_PASS || '';

console.log('body total:', b.length, 'bytes');
console.log('login num:', loginNum, '= hex LE:', Buffer.from([loginNum & 255, (loginNum >> 8) & 255, (loginNum >> 16) & 255, (loginNum >> 24) & 255]).toString('hex'));

// buscar u32 del login
const loginBuf = Buffer.alloc(4);
loginBuf.writeUInt32LE(loginNum, 0);
const idx32 = b.indexOf(loginBuf);
console.log('u32 login en offset:', idx32);

// buscar login como utf16le y ascii
console.log('login utf16le offset:', b.indexOf(Buffer.from(login, 'utf16le')));
console.log('login ascii offset:', b.indexOf(login));

// buscar password utf16le
if (pass) {
  const p16 = Buffer.from(pass, 'utf16le');
  console.log('password utf16le offset:', b.indexOf(p16), '(len', p16.length + ')');
}

// bytes no nulos por region (mapa de campos)
const regions = [];
let start = -1;
for (let i = 0; i < b.length; i++) {
  if (b[i] !== 0 && start === -1) start = i;
  if (b[i] === 0 && start !== -1) {
    if (i - start >= 1) regions.push([start, i]);
    start = -1;
  }
}
if (start !== -1) regions.push([start, b.length]);
// fusionar regiones separadas por <=2 ceros
const merged = [];
for (const r of regions) {
  const last = merged[merged.length - 1];
  if (last && r[0] - last[1] <= 2) last[1] = r[1];
  else merged.push([...r]);
}
console.log('\nregiones con datos (offset ini, fin, tam, hex-head):');
for (const [s, e] of merged) {
  console.log(`  ${String(s).padStart(4)}-${String(e).padStart(4)} (${String(e - s).padStart(3)}B) ${b.subarray(s, Math.min(e, s + 24)).toString('hex')} ${/[\x20-\x7e]{4}/.test(b.subarray(s, e).toString('latin1')) ? '"' + b.subarray(s, e).toString('utf16le').replace(/[^\x20-\x7e]/g, '').slice(0, 30) + '"' : ''}`);
}
