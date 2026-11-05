'use strict';
/* ============================================================
   TEST OFFLINE DE LA ESTRATEGIA (sin red, sin credenciales)
   ------------------------------------------------------------
   Escenario sintético controlado que verifica:
     1. Sesgo H1 alcista calculado con EMA
     2. Detección de zona soporte por pivote fractal M15
     3. Refuerzo de zona por segundo pivote (fuerza 2)
     4. Toque EARLY + señal COMPRA con score ≥ scoreMin
     5. Excursión → retest direccional → toque MAIN (2ª señal)
     6. Tercer toque sin dirección -> LATE y SIN señal
     7. TN: cierre M15 más allá de la zona mata la zona
     8. Zona muerta no genera toques
     9. El nuevo suelo se convierte en zona nueva (pivote confirmado)
   Ejecutar:  node test_estrategia.js
   Sale con código 0 si todo pasa, 1 si algo falla.
   ============================================================ */
const { Estrategia } = require('./estrategia');

const t0 = Date.UTC(2026, 0, 1, 0, 0, 0);
const M15 = 900e3, M5 = 300e3, H1 = 3600e3;
let fallos = 0;
const ok = (cond, nombre) => {
  console.log(`${cond ? '✅' : '❌'} ${nombre}`);
  if (!cond) fallos++;
};

// ---------- escenario ----------
const E = new Estrategia({ dedupMin: 0, scoreMin: 60 });
const S = 'FX Vol 20';
const eventos = { zonaNueva: [], toque: [], senal: [], tn: 0 };
E.on('zona', (ev) => { if (ev.evento === 'nueva') eventos.zonaNueva.push(ev.zona); });
E.on('toque', (ev) => eventos.toque.push(ev));
E.on('senal', (ev) => eventos.senal.push(ev));
E.on('tn', () => eventos.tn++);

// 1) Historial H1 alcista (40 velas subiendo de 100 a 110) -> sesgo 'alza'
const base = 100;
for (let i = 0; i < 40; i++) {
  E.onVelaCerrada(S, 'H1', { t: t0 + i * H1, o: base + i * 0.25, h: base + i * 0.25 + 0.3, l: base + i * 0.25 - 0.3, c: base + i * 0.25 + 0.25 });
}
ok(E.s.get(S).sesgo === 'alza', `1) sesgo H1 alcista (obtuvo: ${E.s.get(S).sesgo})`);

// 2) Historial M15 plano con rango 1.2 (siembra ATR ≈ 1.2) + pivote de piso en 98.6
let t15 = t0;
const m15 = [];
for (let i = 0; i < 30; i++) m15.push({ t: (t15 += M15), o: 99.8, h: 100.4, l: 99.2, c: 100.0 });
m15.push({ t: (t15 += M15), o: 99.9, h: 100.0, l: 99.3, c: 99.6 });
m15.push({ t: (t15 += M15), o: 99.5, h: 99.7, l: 98.6, c: 98.9 });   // <- futuro pivote (i = len-3)
m15.push({ t: (t15 += M15), o: 98.9, h: 99.4, l: 98.8, c: 99.3 });   // confirmación 1
m15.push({ t: (t15 += M15), o: 99.3, h: 99.6, l: 98.9, c: 99.5 });   // confirmación 2 -> pivote detectado
for (const v of m15) E.onVelaCerrada(S, 'M15', v);
const zonas = E.s.get(S).zonas.filter((z) => z.tipo === 'soporte' && z.estado === 'activa');
ok(zonas.length === 1 && Math.abs(zonas[0].nivel - 98.6) < 0.4,
  `2) zona soporte detectada cerca de 98.6 (obtuvo: ${zonas.map((z) => z.nivel).join(', ') || 'ninguna'})`);
const ZONA = zonas[0];
ok(E.s.get(S).atr > 0.5 && E.s.get(S).atr < 2.5, `   ATR sembrado razonable (obtuvo: ${E.s.get(S).atr.toFixed(3)})`);

// 3) Refuerzo: segundo pivote de piso a 98.7 (dentro de tolerancia)
m15.push({ t: (t15 += M15), o: 99.6, h: 99.8, l: 99.0, c: 99.7 });
m15.push({ t: (t15 += M15), o: 99.7, h: 99.9, l: 98.7, c: 99.0 });   // futuro pivote 2 (i = len-3)
m15.push({ t: (t15 += M15), o: 99.0, h: 99.4, l: 98.9, c: 99.3 });
m15.push({ t: (t15 += M15), o: 99.3, h: 99.6, l: 99.0, c: 99.5 });
for (const v of m15.slice(-4)) E.onVelaCerrada(S, 'M15', v);
ok(ZONA.fuerza === 2, `3) zona reforzada a fuerza 2 (obtuvo: ${ZONA.fuerza})`);

// 4) Toque EARLY en M5 + señal COMPRA (sesgo alza + vela direccional)
let t5 = t15;
E.onVelaCerrada(S, 'M5', { t: (t5 += M5), o: 98.7, h: 99.2, l: 98.5, c: 99.1 });
const toqueEarly = eventos.toque.find((x) => x.fase === 'EARLY');
ok(Boolean(toqueEarly), '4) toque EARLY emitido');
ok(eventos.senal.length === 1 && eventos.senal[0].lado === 'COMPRA' && eventos.senal[0].fase === 'EARLY',
  `   señal COMPRA EARLY (obtuvo: ${JSON.stringify(eventos.senal.map((s) => s.lado + '/' + s.fase))})`);
ok(eventos.senal[0] && eventos.senal[0].score >= 60, `   score ≥ 60 (obtuvo: ${eventos.senal[0] && eventos.senal[0].score})`);
ok(eventos.senal[0] && eventos.senal[0].sl < eventos.senal[0].precio && eventos.senal[0].tp > eventos.senal[0].precio, '   SL bajo el precio y TP por encima (COMPRA)');

// 5) Excursión ≥ 1.2×ATR y retest direccional -> MAIN
const excObjetivo = ZONA.nivel + 1.3 * E.s.get(S).atr;
E.onVelaCerrada(S, 'M5', { t: (t5 += M5), o: 99.2, h: excObjetivo + 0.1, l: 99.1, c: excObjetivo });
E.onVelaCerrada(S, 'M5', { t: (t5 += M5), o: 98.75, h: 99.1, l: ZONA.nivel - 0.05, c: 98.95 }); // retest
const toquesMain = eventos.toque.filter((x) => x.fase === 'MAIN');
ok(toquesMain.length === 1, `5) toque MAIN por retest (obtuvo: ${toquesMain.length})`);
ok(eventos.senal.length === 2 && eventos.senal[1].fase === 'MAIN', '   señal MAIN emitida');

// 6) Tercer toque SIN vela direccional -> LATE y sin señal
E.onVelaCerrada(S, 'M5', { t: (t5 += M5), o: 99.2, h: 99.3, l: ZONA.nivel - 0.02, c: 99.1 });
const toquesLate = eventos.toque.filter((x) => x.fase === 'LATE');
ok(toquesLate.length === 1, `6) tercer toque clasificado LATE (obtuvo: ${toquesLate.length})`);
ok(eventos.senal.length === 2, `   LATE sin dirección no emite señal (señales: ${eventos.senal.length})`);

// 7) TN: cierre M15 muy por debajo del soporte
E.onVelaCerrada(S, 'M15', { t: (t15 += M15), o: 98.9, h: 99.0, l: 97.5, c: 97.6 });
ok(eventos.tn === 1, '7) evento TN emitido al cerrar más allá de la zona');
ok(ZONA.estado === 'muerta', '   zona marcada como muerta');

// 8) Zona muerta ya no genera toques
const toquesAntes = eventos.toque.length;
E.onVelaCerrada(S, 'M5', { t: (t5 += M5), o: 98.0, h: 98.3, l: 97.9, c: 98.2 });
ok(eventos.toque.length === toquesAntes, '8) zona muerta no genera toques');

// 9) El nuevo suelo 97.5 se convierte en zona nueva (pivote con 2 confirmaciones)
const zonasAntes = eventos.zonaNueva.length;
E.onVelaCerrada(S, 'M15', { t: (t15 += M15), o: 98.0, h: 98.4, l: 97.7, c: 98.3 });
E.onVelaCerrada(S, 'M15', { t: (t15 += M15), o: 98.3, h: 98.6, l: 97.9, c: 98.5 });
const nuevas = eventos.zonaNueva.filter((z) => z.tipo === 'soporte' && Math.abs(z.nivel - 97.5) < 0.4);
ok(nuevas.length === 1, `9) nuevo suelo 97.5 creó zona nueva (obtuvo: ${nuevas.length})`);

// resumen
console.log(fallos === 0 ? '\n🎉 TODOS LOS TESTS PASARON' : `\n💥 ${fallos} test(s) fallaron`);
process.exit(fallos === 0 ? 0 : 1);
