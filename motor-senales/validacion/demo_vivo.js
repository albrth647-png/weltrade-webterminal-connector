'use strict';
/* Prueba de punta a punta: siembra velas REALES de un activo, cierra la última
   vela y muestra la señal tal como sale del motor (patrón + fase + mensaje).
   Uso: node validacion/demo_vivo.js [SIMBOLO] [ENVIAR=1] */
const fs = require('fs');
const path = require('path');
require('../cliente_mt5');   // carga .env con el MISMO parser del motor (igual que app.js)
const { EstrategiaHibrida } = require('../estrategia_hibrida');
const { docACfg } = require('../doc_estrategia');
const { formatearSenal, enviarTelegram, telegramConfigurado } = require('../telegram');

const SIM = process.argv[2] || 'SFX Vol 40';
const ENVIAR = process.argv[3] === 'ENVIAR=1' || process.env.ENVIAR === '1';
const BASE = path.join(__dirname, '..', '..', 'backtest_hibrida', 'datos');
const TFS = ['M5', 'M15', 'M30', 'H1'];

function leer(id, tf) {
  const tabla = fs.readFileSync(path.join(BASE, `${id}_${tf}.csv`), 'utf8').trim().split('\n');
  const cab = tabla[0].split(',');
  const ix = (n) => cab.indexOf(n);
  const [it, io, ih, il, ic] = ['time', 'open', 'high', 'low', 'close'].map(ix);
  return tabla.slice(1).map((l) => {
    const f = l.split(',');
    return { t: Date.parse(f[it]), o: +f[io], h: +f[ih], l: +f[il], c: +f[ic] };
  });
}

const doc = require('../estrategias/raptor_default.json');
const cfg = docACfg(doc);
const motor = new EstrategiaHibrida(cfg);
const idArchivo = SIM.replace(/ /g, '_');

const senales = [];
let avisos = 0;
motor.on('senal', (s) => senales.push(s));
motor.on('aviso', () => { avisos++; });

/* Replay de las últimas K velas de cada TF: es el camino exacto del motor en vivo
   (cada cierre recalcula la estrategia y emite si el patrón nace en esa vela). */
const K = 150;
for (const tf of TFS) {
  const velas = leer(idArchivo, tf);
  motor.setHistoria(SIM, tf, velas.slice(0, -K));
  for (const v of velas.slice(-K)) motor.onVelaCerrada(SIM, tf, v);
}

console.log(`símbolo ${SIM} · estrategia "${cfg.nombre}" · replay ${K} velas/TF`);
console.log(`entradas: ${senales.length} · avisos 2/3 (no operan): ${avisos}`);
const porPatron = {};
for (const s of senales) porPatron[s.patron] = (porPatron[s.patron] || 0) + 1;
console.log('patrones:', JSON.stringify(porPatron));
for (const s of senales) {
  console.log(`\n--- ${s.tfZona} ${s.lado} ${s.patron}${s.fase ? ' ' + s.fase : ''} score=${s.score} zona=${s.zonaTipo || '-'} sesgo=${s.sesgo}`);
  console.log(formatearSenal(s).replace(/<\/?b>/g, ''));
}

if (ENVIAR) {
  if (!telegramConfigurado()) { console.log('\nTelegram sin token/chat: no se envía'); process.exit(0); }
  const ultima = senales[senales.length - 1];
  if (!ultima) { console.log('\nNo hay señal para enviar'); process.exit(0); }
  enviarTelegram(formatearSenal(ultima)).then((r) => {
    console.log(r.ok ? '\nentregada a Telegram' : '\nfallo: ' + (r.motivo || r.error));
  });
}
