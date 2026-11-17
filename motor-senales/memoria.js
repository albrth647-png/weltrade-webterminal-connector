'use strict';
/* ============================================================
   MEMORIA DE MARCACIONES — F1
   ------------------------------------------------------------
   Un caso = una marca del propietario + su huella de contexto.
   - La huella se calcula al GUARDAR, con velas hasta i2 inclusive:
     no hay fuga de futuro.
   - El archivo es append-only: una línea JSON por caso.
   - Sin casos, todo devuelve vacío sin error.
   Sin dependencias, sin base de datos.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const { TFS, ema, atr } = require('./nucleo');
const { pivotes } = require('./rayas');

const RUTA_POR_DEFECTO = path.join(__dirname, 'datos', 'casos.jsonl');
const VERSION_CASO = 1;
const VENTANA = 20;
const ADX_PERIODO = 14;

/* Playbook que corresponde a cada tipo de línea. No se inventa la regla:
   la geometría elige el documento; las reglas concretas se añaden al aprobar. */
const PLAYBOOK_POR_TIPO = {
  trend: 'rayas.abanico@1',
  ray: 'rayas.abanico@1',
  angle: 'rayas.abanico@1',
  arrow: 'rayas.abanico@1',
  channel: 'rayas.abanico@1',
  horizontal: 'niveles.confluencias@1',
  vertical: 'marcacion@1',
  cycle: 'marcacion@1',
};

const fallo = (codigo, mensaje) => Object.assign(new Error(mensaje), { codigo });

/* ---------- indicadores (todos sobre velas ya cerradas) ---------- */

function er(cierres, n) {
  if (cierres.length < n + 1) return null;
  const desde = cierres.length - n - 1;
  let recorrido = 0;
  for (let i = desde + 1; i < cierres.length; i++) recorrido += Math.abs(cierres[i] - cierres[i - 1]);
  if (!(recorrido > 0)) return null;
  return Math.abs(cierres[cierres.length - 1] - cierres[desde]) / recorrido;
}

function r2(cierres, n) {
  if (cierres.length < n) return null;
  const ys = cierres.slice(-n);
  const media = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - (n - 1) / 2;
    const dy = ys[i] - media;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (!(sxx > 0) || !(syy > 0)) return null;
  const b = sxy / sxx;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const pred = media + b * (i - (n - 1) / 2);
    ssRes += (ys[i] - pred) ** 2;
  }
  return 1 - ssRes / syy;
}

function adx(velas, periodo = ADX_PERIODO) {
  const n = velas.length;
  if (n < periodo * 3) return null;
  const tr = [], dmp = [], dmm = [];
  for (let i = 1; i < n; i++) {
    const sube = velas[i].h - velas[i - 1].h;
    const baja = velas[i - 1].l - velas[i].l;
    tr.push(Math.max(
      velas[i].h - velas[i].l,
      Math.abs(velas[i].h - velas[i - 1].c),
      Math.abs(velas[i].l - velas[i - 1].c)
    ));
    dmp.push(sube > baja && sube > 0 ? sube : 0);
    dmm.push(baja > sube && baja > 0 ? baja : 0);
  }
  let atrS = 0, dpS = 0, dmS = 0;
  for (let i = 0; i < periodo; i++) { atrS += tr[i]; dpS += dmp[i]; dmS += dmm[i]; }
  const dxs = [];
  for (let i = periodo; i < tr.length; i++) {
    atrS = atrS - atrS / periodo + tr[i];
    dpS = dpS - dpS / periodo + dmp[i];
    dmS = dmS - dmS / periodo + dmm[i];
    const pdi = atrS ? 100 * dpS / atrS : 0;
    const mdi = atrS ? 100 * dmS / atrS : 0;
    dxs.push(pdi + mdi ? 100 * Math.abs(pdi - mdi) / (pdi + mdi) : 0);
  }
  if (dxs.length < periodo) return null;
  let a = dxs.slice(0, periodo).reduce((x, y) => x + y, 0) / periodo;
  for (let i = periodo; i < dxs.length; i++) a = (a * (periodo - 1) + dxs[i]) / periodo;
  return a;
}

function pilaEma(velas) {
  const cierres = velas.map((v) => v.c);
  const e30 = ema(cierres, 30), e50 = ema(cierres, 50), e100 = ema(cierres, 100);
  const i = velas.length - 1;
  const a = e30[i], b = e50[i], c = e100[i];
  if (![a, b, c].every(Number.isFinite)) return null;
  if (a > b && b > c) return 'alcista';
  if (a < b && b < c) return 'bajista';
  return 'mixta';
}

function estructura(velas) {
  const altos = pivotes(velas, 'alto', 3);
  const bajos = pivotes(velas, 'bajo', 3);
  if (altos.length < 2 || bajos.length < 2) return null;
  const h1 = altos[altos.length - 2], h2 = altos[altos.length - 1];
  const l1 = bajos[bajos.length - 2], l2 = bajos[bajos.length - 1];
  const hh = velas[h2].h > velas[h1].h;
  const hl = velas[l2].l > velas[l1].l;
  if (hh && hl) return 'HH-HL';
  if (!hh && !hl) return 'LH-LL';
  return 'mixta';
}

function posDonchian(velas, n = VENTANA) {
  if (velas.length < n) return null;
  const tramo = velas.slice(-n);
  const max = Math.max(...tramo.map((v) => v.h));
  const min = Math.min(...tramo.map((v) => v.l));
  if (!(max > min)) return null;
  return (tramo[tramo.length - 1].c - min) / (max - min);
}

function sesion(t) {
  const h = new Date(t).getUTCHours();
  if (h < 7) return 'asia';
  if (h < 12) return 'europa';
  if (h < 21) return 'ny';
  return 'fuera';
}

/* ---------- huella ---------- */

/**
 * Huella de contexto en el instante de la marca. Solo usa velas con índice
 * ≤ i2: lo que ocurrió después no puede influir.
 */
function huellaDe(velas, i2, params = {}) {
  const corte = Math.min(i2, velas.length - 1);
  if (corte < 30) return null;
  const hasta = velas.slice(0, corte + 1);
  const cierres = hasta.map((v) => v.c);
  const a = atr(hasta, params.atrPeriodo || 14);
  const atrI = a[a.length - 1];
  if (!(atrI > 0)) return null;
  const ultima = hasta[hasta.length - 1];
  return {
    er20: er(cierres, 20),
    r2: r2(cierres, VENTANA),
    adx14: adx(hasta, ADX_PERIODO),
    atr: atrI,
    atrPct: (atrI / ultima.c) * 100,
    pilaEma: pilaEma(hasta),
    estructura: estructura(hasta),
    scoreMTF: null,          // F2: lo rellena el escáner
    posDon: posDonchian(hasta),
    niveles: [],             // F2: clústeres de niveles
    sesion: sesion(ultima.t),
    dow: new Date(ultima.t).getUTCDay(),
  };
}

/* ---------- validez de la raya (no cruza velas intermedias) ---------- */

/**
 * En la metodología del propietario, una raya de tendencia puede cruzar
 * velas intermedias sin dejar de ser válida: la validez por cruce de velas
 * intermedias no aplica. Toda raya se considera válida.
 */
function rayoValido(i1, p1, i2, p2, velas) {
  return true;
}

function velasCruzadasDe(i1, p1, i2, p2, velas) {
  return 0;
}

function analizarValidez(i1, p1, i2, p2, velas) {
  return { valida: rayoValido(i1, p1, i2, p2, velas), velasCruzadas: velasCruzadasDe(i1, p1, i2, p2, velas) };
}

/* ---------- anclaje por hora (no se corre con la ventana) ---------- */

/**
 * Devuelve el índice de la vela cuya hora coincide con `t`, o -1 si ya no
 * está en la serie (fuera de la ventana de ~30 días).
 */
function indiceDeHora(velas, t) {
  if (!Array.isArray(velas) || !Number.isFinite(t)) return -1;
  for (let i = 0; i < velas.length; i++) if (velas[i] && velas[i].t === t) return i;
  return -1;
}

/* ---------- construir el caso ---------- */

function geometriaDe(linea, velas) {
  const tipo = String(linea.type || 'trend');
  const i1 = Math.round(Number(linea.i1));
  const i2 = Math.round(Number(linea.i2 ?? linea.i1));
  const p1 = Number(linea.p1);
  const p2 = Number(linea.p2 ?? linea.p1);
  if (![i1, i2, p1, p2].every(Number.isFinite)) throw fallo(422, 'la línea no tiene coordenadas numéricas');
  if (i2 < 0 || i2 >= velas.length) throw fallo(422, `el índice ${i2} está fuera de la serie (${velas.length} velas)`);
  const ancho = Math.abs(i2 - i1) || 1;
  const t1 = Number.isFinite(velas[i1] && velas[i1].t) ? velas[i1].t : null;
  const t2 = Number.isFinite(velas[i2] && velas[i2].t) ? velas[i2].t : null;
  const validez = analizarValidez(i1, p1, i2, p2, velas);
  const a = atr(velas.slice(0, i2 + 1), 14);
  const atrI = a[a.length - 1];
  return {
    tipo, i1, i2, p1, p2,
    pendAtr: atrI > 0 ? ((p2 - p1) / ancho) / atrI : null,
    largo: Math.abs(i2 - i1),
    toques: Number.isFinite(linea.toques) ? linea.toques : 0,
    anclaje: 'cierre',
    cuerpo: tipo !== 'horizontal' && tipo !== 'vertical',
    extension: linea.extendRight ? 'derecha' : (linea.extendLeft ? 'izquierda' : 'ninguna'),
    valida: validez.valida,
    velasCruzadas: validez.velasCruzadas,
    t1, t2,
  };
}

const ESTADOS_CASO = new Set(['borrador', 'aprobado', 'rechazado', 'referencia']);

function crear({
  simbolo, tf, linea, velas, nota = '', ahora = Date.now(),
  estado = 'borrador', sugerencia = null,
} = {}) {
  const sim = typeof simbolo === 'string' ? simbolo.trim() : '';
  if (!sim || sim.length > 64) throw fallo(422, 'simbolo vacío o demasiado largo');
  const temporalidad = String(tf || '').toUpperCase();
  if (!TFS[temporalidad]) throw fallo(422, `temporalidad inválida: ${tf}`);
  if (!linea || typeof linea !== 'object') throw fallo(422, 'falta la línea');
  if (!Array.isArray(velas) || !velas.length) throw fallo(409, 'sin velas para calcular la huella');

  const geometria = geometriaDe(linea, velas);
  const huella = huellaDe(velas, geometria.i2);
  if (!huella) throw fallo(422, 'no hay velas suficientes antes de la marca para calcular la huella');

  return {
    id: null,                      // lo asigna el almacén
    v: VERSION_CASO,
    origen: {
      tipo: 'manual',
      autor: 'propietario',
      creado: new Date(ahora).toISOString(),
      lineaId: typeof linea.id === 'string' ? linea.id : null,
      sugerencia: sugerencia && typeof sugerencia === 'object'
        ? { vecinos: Array.isArray(sugerencia.vecinos) ? sugerencia.vecinos.slice(0, 8) : [], confianza: Number(sugerencia.confianza) || 0, aceptada: !!sugerencia.aceptada }
        : null,
    },
    mercado: {
      simbolo: sim,
      tf: temporalidad,
      t: velas[geometria.i2].t,
      precio: velas[geometria.i2].c,
      nVelas: velas.length,
    },
    geometria,
    huella,
    etiqueta: {
      estado: ESTADOS_CASO.has(estado) ? estado : 'borrador',
      resultado: null,
      mfeAtr: null,
      maeAtr: null,
      velasHastaRuptura: null,
    },
    checks: [],
    playbook: PLAYBOOK_POR_TIPO[geometria.tipo] || 'principios@1',
    nota: typeof nota === 'string' ? nota.slice(0, 500) : '',
  };
}

/* ---------- almacén append-only ---------- */

function crearAlmacen({ archivo = RUTA_POR_DEFECTO } = {}) {
  const rutaEtiquetas = archivo.replace(/\.jsonl$/, '') + '.etiquetas.jsonl';

  /* Las etiquetas van en un archivo aparte y append-only: cambiar de estado
     no reescribe ni borra el caso original. */
  function etiquetas() {
    const ultimo = new Map();
    if (!fs.existsSync(rutaEtiquetas)) return ultimo;
    for (const linea of fs.readFileSync(rutaEtiquetas, 'utf8').split(/\r?\n/)) {
      if (!linea.trim()) continue;
      try {
        const j = JSON.parse(linea);
        if (j && j.id && ESTADOS_CASO.has(j.estado)) ultimo.set(j.id, j.estado);
      } catch (e) {
        throw fallo(500, `etiquetas.jsonl corrupto: ${e.message}`);
      }
    }
    return ultimo;
  }

  function leer() {
    if (!fs.existsSync(archivo)) return [];
    const texto = fs.readFileSync(archivo, 'utf8');
    const casos = [];
    for (const linea of texto.split(/\r?\n/)) {
      if (!linea.trim()) continue;
      try {
        casos.push(JSON.parse(linea));
      } catch (e) {
        throw fallo(500, `casos.jsonl tiene una línea corrupta: ${e.message}`);
      }
    }
    const marcas = etiquetas();
    if (!marcas.size) return casos;
    return casos.map((c) => (marcas.has(c.id)
      ? { ...c, etiqueta: { ...c.etiqueta, estado: marcas.get(c.id) } }
      : c));
  }

  function listar(filtros = {}) {
    let casos = leer();
    if (filtros.simbolo) casos = casos.filter((c) => c.mercado.simbolo === filtros.simbolo);
    if (filtros.tf) casos = casos.filter((c) => c.mercado.tf === filtros.tf);
    if (filtros.estado) casos = casos.filter((c) => c.etiqueta.estado === filtros.estado);
    return casos;
  }

  function obtener(id) {
    return leer().find((c) => c.id === id) || null;
  }

  function guardar(caso) {
    if (!caso || typeof caso !== 'object') throw fallo(500, 'caso inválido');
    const casos = leer();
    if (caso.origen && caso.origen.lineaId) {
      const dup = casos.find((c) => c.origen
        && c.origen.lineaId === caso.origen.lineaId
        && c.mercado.simbolo === caso.mercado.simbolo
        && c.mercado.tf === caso.mercado.tf);
      if (dup) throw fallo(409, `esa línea ya está guardada como ${dup.id}`);
    }
    const dia = new Date(caso.mercado.t).toISOString().slice(0, 10);
    const delDia = casos.filter((c) => String(c.id).startsWith(`c-${dia}-`)).length;
    caso.id = `c-${dia}-${String(delDia + 1).padStart(4, '0')}`;
    fs.mkdirSync(path.dirname(archivo), { recursive: true });
    fs.appendFileSync(archivo, JSON.stringify(caso) + '\n');
    return caso;
  }

  function cambiarEstado(id, estado) {
    if (!ESTADOS_CASO.has(estado)) throw fallo(422, `estado inválido: ${estado}`);
    const caso = leer().find((c) => c.id === id);
    if (!caso) throw fallo(404, 'caso no encontrado');
    fs.mkdirSync(path.dirname(archivo), { recursive: true });
    fs.appendFileSync(rutaEtiquetas, JSON.stringify({ id, estado, t: Date.now() }) + '\n');
    return { ...caso, etiqueta: { ...caso.etiqueta, estado } };
  }

  return { archivo, rutaEtiquetas, leer, listar, obtener, guardar, crear, cambiarEstado };
}

const porDefecto = crearAlmacen();

module.exports = {
  rayoValido,
  velasCruzadasDe,
  analizarValidez,
  indiceDeHora,
  crearAlmacen,
  crear: porDefecto.crear,
  guardar: porDefecto.guardar,
  listar: porDefecto.listar,
  obtener: porDefecto.obtener,
  cambiarEstado: porDefecto.cambiarEstado,
  ESTADOS_CASO,
  huellaDe,
  geometriaDe,
  PLAYBOOK_POR_TIPO,
  RUTA_POR_DEFECTO,
  VERSION_CASO,
};
