/* ============================================================
   Regresión de la memoria de marcaciones (F1).
   - huella determinista y sin fuga de futuro
   - validación de la línea
   - almacén append-only, listar, obtener, duplicados
   ============================================================ */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import memoria from './memoria.js';
const { crearAlmacen, huellaDe } = memoria;

let ok = 0, mal = 0;
const check = (nombre, cond, extra = '') => {
  if (cond) { ok++; console.log(`  ok: ${nombre}`); }
  else { mal++; console.error(`  FALLA: ${nombre}${extra ? ' — ' + extra : ''}`); }
};

/* Serie sintética: tendencia suave con ruido reproducible. */
function velas(n, inicio = 100000) {
  const out = [];
  let precio = inicio;
  let semilla = 12345;
  const rnd = () => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla / 2147483648; };
  for (let i = 0; i < n; i++) {
    const paso = (rnd() - 0.45) * 40;
    const o = precio;
    const c = precio + paso;
    const h = Math.max(o, c) + rnd() * 15;
    const l = Math.min(o, c) - rnd() * 15;
    out.push({ t: 1762905600000 + i * 900000, o, h, l, c });
    precio = c;
  }
  return out;
}

const serie = velas(400);
const linea = { id: 'o-test', type: 'trend', i1: 250, p1: serie[250].c, i2: 330, p2: serie[330].c, extendRight: true };

/* --- huella --- */
const h1 = huellaDe(serie, 330);
const h2 = huellaDe(serie, 330);
check('la huella es determinista', JSON.stringify(h1) === JSON.stringify(h2));
check('er20 en 0..1', h1.er20 === null || (h1.er20 >= 0 && h1.er20 <= 1), String(h1.er20));
check('r2 en 0..1', h1.r2 === null || (h1.r2 >= 0 && h1.r2 <= 1), String(h1.r2));
check('adx14 numérico', h1.adx14 === null || Number.isFinite(h1.adx14), String(h1.adx14));
check('atrPct positivo', h1.atrPct > 0, String(h1.atrPct));
check('pilaEma válida', ['alcista', 'bajista', 'mixta', null].includes(h1.pilaEma), String(h1.pilaEma));
check('estructura válida', ['HH-HL', 'LH-LL', 'mixta', null].includes(h1.estructura), String(h1.estructura));
check('posDon en 0..1', h1.posDon === null || (h1.posDon >= 0 && h1.posDon <= 1), String(h1.posDon));

/* --- sin fuga de futuro: recortar la serie después de i2 no cambia nada --- */
const hCorta = huellaDe(serie.slice(0, 331), 330);
check('sin fuga de futuro (misma huella al cortar en i2)',
  JSON.stringify(hCorta) === JSON.stringify(h1));

/* --- validación --- */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memoria-'));
const archivo = path.join(dir, 'casos.jsonl');
const alm = crearAlmacen({ archivo });
check('listar sin archivo devuelve vacío', alm.listar().length === 0);

const lanza = (codigo, fn) => {
  try { fn(); return null; } catch (e) { return e.codigo === codigo ? e : null; }
};
check('rechaza temporalidad inválida', !!lanza(422, () => alm.crear({ simbolo: 'X', tf: 'M7', linea, velas: serie })));
check('rechaza índice fuera de la serie', !!lanza(422, () => alm.crear({ simbolo: 'X', tf: 'M5', linea: { ...linea, i2: 9999 }, velas: serie })));
check('rechaza línea sin coordenadas', !!lanza(422, () => alm.crear({ simbolo: 'X', tf: 'M5', linea: { type: 'trend' }, velas: serie })));
check('rechaza sin velas', !!lanza(409, () => alm.crear({ simbolo: 'X', tf: 'M5', linea, velas: [] })));

/* --- guardar --- */
const caso = alm.crear({ simbolo: 'FX Vol 20', tf: 'M5', linea, velas: serie, nota: 'prueba' });
check('caso en estado borrador', caso.etiqueta.estado === 'borrador');
check('caso cita playbook', typeof caso.playbook === 'string' && caso.playbook.includes('@'), caso.playbook);
check('geometría conserva índices', caso.geometria.i1 === 250 && caso.geometria.i2 === 330);
check('mercado guarda el tiempo del ancla', caso.mercado.t === serie[330].t);

alm.guardar(caso);
check('id con fecha', /^c-\d{4}-\d{2}-\d{2}-\d{4}$/.test(caso.id), caso.id);
check('archivo creado', fs.existsSync(archivo));
check('una línea por caso', fs.readFileSync(archivo, 'utf8').trim().split('\n').length === 1);
check('listar devuelve el caso', alm.listar().length === 1);
check('obtener por id', alm.obtener(caso.id)?.id === caso.id);
check('obtener inexistente devuelve null', alm.obtener('c-0000-00-00-0000') === null);

const dup = lanza(409, () => alm.guardar(alm.crear({ simbolo: 'FX Vol 20', tf: 'M5', linea, velas: serie })));
check('no duplica la misma línea', !!dup);

const otro = alm.crear({ simbolo: 'FX Vol 40', tf: 'M5', linea: { ...linea, id: 'o-otro' }, velas: serie });
alm.guardar(otro);
check('append: dos casos', alm.listar().length === 2);
check('filtra por símbolo', alm.listar({ simbolo: 'FX Vol 40' }).length === 1);
check('filtra por estado', alm.listar({ estado: 'aprobado' }).length === 0);

fs.rmSync(dir, { recursive: true, force: true });

console.log(`\nresultado: ${ok} OK / ${mal} fallos`);
process.exit(mal ? 1 : 0);
