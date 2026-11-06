'use strict';
/* ============================================================
   TEST DEL IMPORTADOR DE DOCUMENTOS (sin red, sin credenciales)
   ------------------------------------------------------------
   Cubre: .json, .md con bloque, .set, .tpl, .mq5, .ex5 sintético,
   .ex5 real (si está en ../upload), texto sin doc, JSON inválido.
   Ejecutar:  node test_importador.js
   ============================================================ */
const fs = require('fs');
const path = require('path');
const { importarDocumento } = require('./importador');

let fallos = 0;
const ok = (cond, nombre) => {
  console.log(`${cond ? '✅' : '❌'} ${nombre}`);
  if (!cond) fallos++;
};
const buf = (s) => Buffer.from(s, 'utf8');
const base = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'estrategias', 'raptor_default.json'), 'utf8'));

// 1) JSON directo válido
let r = importarDocumento('mi_estrategia.json', buf(JSON.stringify({ ...base(), score: { ...base().score, min: 65 } })));
ok(r.ok && r.tipo === 'json' && r.doc.score.min === 65, `1) json directo: score.min=65 (obtuvo ${r.doc && r.doc.score.min})`);

// 2) MD con bloque ```json
const docB = base(); docB.dedup.minutos = 30;
r = importarDocumento('doc.md', buf('# Mi estrategia\n\n```json\n' + JSON.stringify(docB) + '\n```\n'));
ok(r.ok && r.doc.dedup.minutos === 30, `2) md con bloque json (obtuvo ${r.doc && r.doc.dedup.minutos})`);

// 3) .set con parámetros de Expert
const setTxt = [
  '; parámetros del expert',
  'ScoreMin=65||30||5||90||Y',
  'ATRPeriodo=14',
  'EmaH1=30',
  'SLAtr=1.5',
  'TPAtr=3.0',
  'CosaDesconocida=7',
].join('\n');
r = importarDocumento('MiBot.set', buf(setTxt));
ok(r.ok && r.tipo === 'set', `3a) .set parseado (obtuvo tipo ${r.tipo})`);
ok(r.doc.score.min === 65 && r.doc.atr.periodo === 14 && r.doc.sesgo.periodo === 30 && r.doc.riesgo.slAtr === 1.5 && r.doc.riesgo.tpAtr === 3.0,
  `3b) .set mapea score/atr/ema/sl/tp (obtuvo ${r.doc.score.min}/${r.doc.atr.periodo}/${r.doc.sesgo.periodo}/${r.doc.riesgo.slAtr}/${r.doc.riesgo.tpAtr})`);
ok(r.sinMapa.some((x) => x.startsWith('CosaDesconocida')), '3c) .set lista lo no mapeable');

// 4) .tpl con indicadores de gráfico
const tplTxt = `<chart>
<symbol>FX Vol 20</symbol>
<indicator>
<name>MA(30)</name>
<period>30</period>
<method>1</method>
</indicator>
<indicator>
<name>ATR(14)</name>
<period>14</period>
</indicator>
<indicator>
<name>Fractals(5)</name>
</indicator>
</chart>`;
r = importarDocumento('grafico.tpl', buf(tplTxt));
ok(r.ok && r.tipo === 'tpl', `4a) .tpl parseado`);
ok(r.doc.sesgo.periodo === 30 && r.doc.atr.periodo === 14, `4b) .tpl mapea EMA(30) y ATR(14) (obtuvo ${r.doc.sesgo.periodo}/${r.doc.atr.periodo})`);
ok(r.mapeados.some((x) => x.includes('Fractals')), '4c) .tpl detecta fractales');

// 5) .mq5 sintético con inputs e indicadores
const mqTxt = `//+------------------------------------------------------------------+
//|                                                       MiBot.mq5 |
//+------------------------------------------------------------------+
#property strict
input int    PeriodoEMA = 30;
input int    PeriodoATR = 14;
input double SL_ATR    = 1.0;
input double TP_ATR    = 2.0;
int OnTick() {
   double ema = iMA(_Symbol, PERIOD_H1, PeriodoEMA, 0, MODE_EMA, PRICE_CLOSE, 0);
   double atr = iATR(_Symbol, PERIOD_M15, PeriodoATR, 0);
   double fr  = iFractals(_Symbol, PERIOD_M15, 0, 1);
   double st  = iStochastic(_Symbol, PERIOD_M5, 14, 3, 3, MODE_SMA, 0, 0);
   if (atr > 0 && st > 0) { /* compra/venta */ }
   return 0;
}`;
r = importarDocumento('MiBot.mq5', buf(mqTxt));
ok(r.ok && r.hallazgos.entradas.length === 4, `5a) mq5 extrae 4 inputs (obtuvo ${r.hallazgos.entradas.length})`);
ok(r.hallazgos.indicadores.length === 4, `5b) mq5 detecta 4 indicadores (obtuvo ${r.hallazgos.indicadores.length})`);
ok(r.doc.sesgo.periodo === 30 && r.doc.atr.periodo === 14 && r.doc.riesgo.slAtr === 1.0 && r.doc.riesgo.tpAtr === 2.0,
  `5c) mq5 mapea sesgo/atr/sl/tp (obtuvo ${r.doc.sesgo.periodo}/${r.doc.atr.periodo}/${r.doc.riesgo.slAtr}/${r.doc.riesgo.tpAtr})`);
ok(r.sinMapa.some((x) => x.includes('Stochastic')), '5d) mq5 marca Stochastic sin equivalente');

// 6) .ex5 sintético (cabecera EX5 con slots UTF-16)
function slotUtf16(s, tam = 256) {
  const b = Buffer.alloc(tam);
  Buffer.from(s, 'utf16le').copy(b);
  return b;
}
const ex5Falso = Buffer.concat([
  Buffer.from('EX5', 'latin1'), Buffer.from([2]),
  Buffer.alloc(0xA8 - 4),
  slotUtf16('ElAutor DelBot'), slotUtf16('https://botdeladversario.com'), slotUtf16('2.5'),
  Buffer.alloc(1024).map(() => Math.floor(Math.random() * 256)),
]);
r = importarDocumento('Adversario.ex5', ex5Falso);
ok(r.ok && r.tipo === 'ex5' && r.hallazgos.autor === 'ElAutor DelBot' && r.hallazgos.link === 'https://botdeladversario.com',
  `6a) ex5 sintético: radiografía con autor/link (obtuvo ${r.hallazgos.autor})`);
ok(r.doc && r.doc.meta.descripcion.includes('NO es su estrategia'), '6b) ex5: borrador marcado como NO estrategia del bot');

// 7) .ex5 REAL del adversario (si está en upload)
const ex5Real = '/home/z/my-project/upload/HobbieCode_GoldRush.ex5';
if (fs.existsSync(ex5Real)) {
  r = importarDocumento('HobbieCode_GoldRush.ex5', fs.readFileSync(ex5Real));
  ok(r.ok && r.hallazgos.autor === 'HobbieCode - Ramon Ruiz', `7a) ex5 REAL: autor (obtuvo ${r.hallazgos.autor})`);
  ok(r.hallazgos.link === 'https://hobbiecode.com', `7b) ex5 REAL: link (obtuvo ${r.hallazgos.link})`);
  ok(r.hallazgos.versionPrograma === '1.00', `7c) ex5 REAL: versión del programa (obtuvo ${r.hallazgos.versionPrograma})`);
  ok(r.hallazgos.entropia > 7.5 && r.hallazgos.veredicto.includes('cifrado'), `7d) ex5 REAL: cuerpo cifrado detectado (entropía ${r.hallazgos.entropia})`);
} else {
  console.log('⏭  ex5 real no está en upload/ — test 7 saltado');
}

// 8) texto sin documento dentro -> rechazo claro
r = importarDocumento('notas.txt', buf('Esto es una nota sin ningún documento de estrategia dentro.'));
ok(!r.ok && /no se encontr/.test(r.resumen), '8) texto sin json: rechazo claro');

// 9) JSON inválido (le faltan campos) -> lista lo que falta
const incompleto = { meta: { nombre: 'a medias' }, zonas: { tf: 'M15' } };
r = importarDocumento('medio.json', buf(JSON.stringify(incompleto)));
ok(!r.ok && r.erroresValidacion.length > 5, `9) json incompleto: ${r.erroresValidacion.length} campos faltantes listados`);
ok(r.erroresValidacion.some((x) => x.includes('toques.bandaAtr')), '9b) lista un campo concreto que falta');

// 10) archivo vacío
r = importarDocumento('vacio.ex5', Buffer.alloc(0));
ok(!r.ok, '10) archivo vacío rechazado');

console.log(fallos === 0 ? '\n🎉 TODOS LOS TESTS DEL IMPORTADOR PASARON' : `\n💥 ${fallos} test(s) fallaron`);
process.exit(fallos === 0 ? 0 : 1);
