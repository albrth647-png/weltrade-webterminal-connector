/* ============================================================
   Regresión de la sugerencia (F3).
   - memoria vacía → no hay fantasma, confianza 0
   - solo casos aprobados y solo del pasado
   - distancia en 0..1, vecinos acotados a k
   - con 3+ vecinos coherentes hay fantasma numérico
   - aceptar/rechazar se guarda sin reescribir el caso
   ============================================================ */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import memoriaMod from './memoria.js';
import sugerenciaMod from './sugerencia.js';

const { crearAlmacen } = memoriaMod;
const { sugerir, distancia, rangosDe } = sugerenciaMod;

let ok = 0, mal = 0;
const check = (nombre, cond, extra = '') => {
  if (cond) { ok++; console.log(`  ok: ${nombre}`); }
  else { mal++; console.error(`  FALLA: ${nombre}${extra ? ' — ' + extra : ''}`); }
};

function serie(n, inicio = 1762905600000) {
  const out = [];
  let precio = 100000, semilla = 4242;
  const rnd = () => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla / 2147483648; };
  for (let i = 0; i < n; i++) {
    const o = precio;
    const c = precio + 40 + (rnd() - 0.5) * 20;
    out.push({ t: inicio + i * 300000, o, c, h: Math.max(o, c) + 8, l: Math.min(o, c) - 8 });
    precio = c;
  }
  return out;
}

const velas = serie(400);
const tope = Math.max(...velas.map((v) => v.h)) + 1000;
const linea = { id: 'o-f3', type: 'trend', i1: 250, p1: tope, i2: 330, p2: tope };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sug-'));
const alm = crearAlmacen({ archivo: path.join(dir, 'casos.jsonl') });

const consulta = alm.crear({ simbolo: 'FX Vol 20', tf: 'M5', linea, velas });
check('la consulta tiene huella con ATR absoluto', consulta.huella.atr > 0);
check('la consulta guarda precio', consulta.mercado.precio === velas[330].c);

/* --- memoria vacía --- */
const vacia = sugerir(consulta, []);
check('sin casos no hay fantasma', vacia.hay === false && vacia.fantasma === null);
check('sin casos el motivo es memoria vacía', vacia.motivo === 'memoria vacía');
check('sin casos la confianza es 0', vacia.confianza === 0);

/* --- solo borradores: sigue vacía --- */
alm.guardar({ ...consulta, origen: { ...consulta.origen, lineaId: 'o-b1' } });
const soloBorrador = sugerir(consulta, alm.listar());
check('los borradores no cuentan', soloBorrador.hay === false && soloBorrador.motivo === 'memoria vacía');

/* --- se guardan y aprueban 5 casos parecidos --- */
const ids = [];
for (let i = 0; i < 5; i++) {
  const c = alm.crear({
    simbolo: 'FX Vol 20', tf: 'M5',
    linea: { ...linea, id: 'o-a' + i, i1: 240 + i, p1: tope, i2: 320 + i, p2: tope },
    velas,
  });
  alm.guardar(c);
  alm.cambiarEstado(c.id, 'aprobado');
  ids.push(c.id);
}
const conBase = sugerir(consulta, alm.listar());
check('con 5 aprobados hay base', conBase.vecinos.length === 5, String(conBase.vecinos.length));
check('la confianza está en 0..1', conBase.confianza >= 0 && conBase.confianza <= 1, String(conBase.confianza));
check('hay línea fantasma si la confianza llega', conBase.hay === (conBase.confianza >= 0.6));
if (conBase.hay) {
  const f = conBase.fantasma;
  check('la fantasma es numérica', [f.i1, f.i2, f.p1, f.p2].every(Number.isFinite));
  check('la fantasma conserva el ancla', f.i1 === consulta.geometria.i1 && f.p1 === consulta.geometria.p1);
  check('la fantasma tiene pendiente', Number.isFinite(f.pendAtr));
}
check('la explicación cita el anclaje', /anclaron en el cierre/.test(conBase.explicacion));
check('los vecinos van ordenados por cercanía',
  conBase.vecinos.every((v, i, a) => i === 0 || a[i - 1].distancia <= v.distancia));
check('todos los vecinos están aprobados', conBase.vecinos.every((v) => v.estado === 'aprobado'));

/* --- k acotado --- */
const conK = sugerir(consulta, alm.listar(), { k: 2 });
check('k acota los vecinos', conK.vecinos.length === 2 && conK.hay === false);

/* --- nada del futuro --- */
const futuro = { ...consulta, id: 'c-futuro', origen: { ...consulta.origen, lineaId: 'o-fut' }, mercado: { ...consulta.mercado, t: consulta.mercado.t + 86400000 }, etiqueta: { ...consulta.etiqueta, estado: 'aprobado' } };
const conFuturo = sugerir(consulta, [...alm.listar(), futuro]);
check('un caso posterior no se recupera', !conFuturo.vecinos.some((v) => v.id === 'c-futuro'));

/* --- distancia --- */
const d = distancia(consulta, consulta, sugerenciaMod.PESOS_HUELLA, rangosDe(alm.listar()));
check('distancia a sí mismo = 0', d < 1e-9, String(d));
check('distancia en 0..1', d >= 0 && d <= 1);
const otro = { ...consulta, huella: { ...consulta.huella, er20: 0, r2: 0, adx14: 0, pilaEma: 'bajista', estructura: 'LH-LL' }, geometria: { ...consulta.geometria, pendAtr: -consulta.geometria.pendAtr } };
const d2 = distancia(consulta, otro, sugerenciaMod.PESOS_HUELLA, rangosDe(alm.listar()));
check('un contexto opuesto se aleja', d2 > d);

/* --- etiquetas sin reescribir --- */
const antes = fs.readFileSync(alm.archivo, 'utf8').trim().split('\n').length;
alm.cambiarEstado(ids[0], 'rechazado');
const despues = fs.readFileSync(alm.archivo, 'utf8').trim().split('\n').length;
check('cambiar estado no reescribe casos.jsonl', antes === despues);
check('el estado nuevo se lee', alm.obtener(ids[0]).etiqueta.estado === 'rechazado');
check('etiquetas.jsonl existe', fs.existsSync(alm.rutaEtiquetas));

let lanzo = null;
try { alm.cambiarEstado('c-0000-00-00-0000', 'aprobado'); } catch (e) { lanzo = e.codigo; }
check('etiquetar un caso inexistente da 404', lanzo === 404);
lanzo = null;
try { alm.cambiarEstado(ids[0], 'inventado'); } catch (e) { lanzo = e.codigo; }
check('estado inválido da 422', lanzo === 422);

fs.rmSync(dir, { recursive: true, force: true });

console.log(`\nresultado: ${ok} OK / ${mal} fallos`);
process.exit(mal ? 1 : 0);
