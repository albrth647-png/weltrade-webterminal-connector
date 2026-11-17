'use strict';
/* ============================================================
   RAYAS — línea de tendencia y sus dos avisos (M5, M15, M30, H1)
   ------------------------------------------------------------
   Regla del usuario, validada sobre 30 días × 4 símbolos:
     · La raya va a favor del tramo vigente: bajista pegada a los
       CIERRES (máximos por cierre) y descendente; alcista pegada a
       los CIERRES (mínimos por cierre) y ascendente. Anclaje en el
       cuerpo de la vela, no en la mecha.   · El precio la SUPERA por CIERRE con margen de 0,10 ATR → la
       tendencia vieja queda en duda. No se entra ahí.
   · En esa MISMA vela de ruptura se avisa CAMBIO de tendencia (no se
       espera a las 6 velas).
   · Si dentro de 6 velas el precio regresa y cierra del lado viejo →
       aviso aparte de ENGAÑO (la ruptura fue falsa).
   · TOQUE: si una vela toca la raya vigente con el CUERPO (la raya
       queda entre apertura y cierre) y la siguiente vela cierra con
       cuerpo a favor de la tendencia, aviso TOQUE (prioridad normal).
   Medido en M30 (4 símbolos, 30 días, 599 rupturas):
     cierre +0,10 ATR + ventana 6 → 53,3 % cambio, 32,1 % retest,
     7,0 % engaño.     Anclaje en cierre: la raya se marca en el cuerpo de la vela.
   La raya no se queda clavada: se re-ancla con cada pivote nuevo y
   se extiende hacia el futuro; tras un engaño vuelve a quedar vigente.
   Todas las rayas de un tramo comparten UN único origen (abanico): al
   cambiar la tendencia el abanico se reinicia desde un nuevo origen.
   ============================================================ */
const { TFS } = require('./nucleo');

const TFS_RAYA = ['M5', 'M15', 'M30', 'H1'];

const PARAMS = {
  k: 3,                 // calibrado: 3 velas a cada lado (M5). k=2 mejor para FX Vol 40, k=3 para FX Vol 20.
  atrPeriodo: 14,
  margenAtr: 0.10,       // cierre que supera la raya por este margen = ruptura
  toqueAtr: 0.15,        // mecha a esta distancia de la raya = toque
  ventana: 6,            // velas para decidir «no regresa»
  kAtrPivot: 0,          // ATR minimo entre dos pivotes para validar la raya
  validarCuerpos: true,  // la raya no puede cruzar el CUERPO de ninguna vela (regla)
  validarWicks: false,   // las mechas sí pueden cruzarla
  anclarEnExtremo: false, // ancla en el cierre (borde del cuerpo)
  pivotePorCierre: true, // pivote por cierre (máximos/mínimos por cierre)
  minToques: 1,          // toques exigidos además de las dos anclas
  /* Brooks: una ruptura necesita SEGUIMIENTO. Un cierre fuera que vuelve
     dentro en 1-2 velas fue un test, no una ruptura. 0 = comportamiento
     antiguo (romper con el primer cierre fuera). */
  velasConfirmacion: 2,
  minVelasAncla: 8,      // separación mínima entre anclas
  minVelasTrasAncla: 4,  // la ruptura debe aguantar al menos 4 velas tras el 2º pivote
  maxVelasRaya: 400,     // ventana máxima para buscar la raya vigente
  maxVelasFamilia: 5000, // ventana para la familia de rayas (marcaciones largas)
  /* El propietario marca 2-5 líneas por activo, bien puestas. Más líneas no
     informan: se estorban entre ellas y esconden la que importa. */
  maxRayasFamilia: 5,
  minRayasFamilia: 2,
  minToquesFamilia: 3,   // convención: 2 puntos definen, el 3.º valida la raya
  dedupAtr: 2.5,         // dos rayas a menos de esto a mitad de tramo son la misma
  minVelasSerie: 60,     // mínimo de velas cerradas para analizar
};

/* ---------- utilidades ---------- */
function atr(velas, periodo = 14) {
  const n = velas.length;
  const out = new Array(n).fill(0);
  if (!n) return out;
  const tr = new Array(n);
  tr[0] = velas[0].h - velas[0].l;
  for (let i = 1; i < n; i++) {
    const pc = velas[i - 1].c;
    tr[i] = Math.max(velas[i].h - velas[i].l, Math.abs(velas[i].h - pc), Math.abs(velas[i].l - pc));
  }
  const per = Math.min(periodo, Math.max(1, n - 1));
  let suma = 0;
  for (let i = 1; i <= per; i++) suma += tr[i];
  out[per] = suma / per;
  for (let i = 0; i < per; i++) out[i] = out[per];
  for (let i = per + 1; i < n; i++) out[i] = (out[i - 1] * (per - 1) + tr[i]) / per;
  return out;
}

function pivotes(velas, tipo, k = 3, porCierre = true) {
  const r = [];
  const esAlto = tipo === 'alto';
  for (let i = k; i < velas.length - k; i++) {
    let ok = true;
    for (let m = 1; m <= k; m++) {
      const a = velas[i - m], b = velas[i + m], v = velas[i];
      // Regla documentada y casos manuales: la raya va pegada a los CIERRES
      // (máximos/mínimos por cierre), no a las mechas. `porCierre=false` deja
      // el pivote por high/low (ta.pivothigh) para experimentos.
      if (porCierre) {
        if (esAlto ? !(v.c > a.c && v.c > b.c) : !(v.c < a.c && v.c < b.c)) { ok = false; break; }
      } else {
        if (esAlto ? !(v.h > a.h && v.h > b.h) : !(v.l < a.l && v.l < b.l)) { ok = false; break; }
      }
    }
    if (ok) r.push(i);
  }
  return r;
}

/* ---------- validación de una raya candidata (2 anclas) ---------- */
function _validarRaya(velas, A, p, tipo, iA, i2, opts = {}) {
  const n = velas.length;
  const esB = tipo === 'bajista';
  const campo = 'c';
  if (!opts.skipMinAncla && (i2 - iA < p.minVelasAncla)) return null;
  // Anclaje en el EXTREMO (high en bajista, low en alcista): así la raya
  // toca la mecha sin cruzarla, que es la regla pedida. Con anclarEnExtremo
  // false se ancla en el cierre (comportamiento antiguo).
  const campoAncla = p.anclarEnExtremo ? (esB ? 'h' : 'l') : campo;
  const base = velas[iA][campoAncla], fin = velas[i2][campoAncla];
  const m = (fin - base) / (i2 - iA);
  if (!Number.isFinite(m) || m === 0) return null;
  if (esB ? m >= 0 : m <= 0) return null;   // bajista baja, alcista sube
  const linea = (i) => base + m * (i - iA);

  // Filtro ATR entre pivotes (Metrify): la diferencia de precio entre las
  // dos anclas debe ser al menos kAtrPivot * ATR medio, para evitar rayas
  // sobre ruido. Si kAtrPivot <= 0 se desactiva.
  if (p.kAtrPivot > 0) {
    let atrMedio = 0;
    for (let i = iA; i <= i2; i++) atrMedio += A[i];
    atrMedio /= (i2 - iA + 1);
    if (Math.abs(fin - base) < p.kAtrPivot * atrMedio) return null;
  }

  // Regla del usuario: el TRAMO marcado no puede cruzar el CUERPO de
  // ninguna vela (las mechas sí). Se valida entre las dos anclas; después
  // de i2 la raya se extiende y, si el precio la rompe, queda "rota"
  // (discontinua) y se avisa el cambio de tendencia.
  const finValid = i2;
  if (p.validarCuerpos) {
    const eps = 1e-9;
    for (let i = iA + 1; i < finValid; i++) {
      if (i === i2) continue; // el ancla toca el cierre, no lo cruza
      const lv = linea(i);
      const hiC = Math.max(velas[i].o, velas[i].c);
      const loC = Math.min(velas[i].o, velas[i].c);
      if (esB) {
        if (hiC > lv + eps) return null;
      } else {
        if (loC < lv - eps) return null;
      }
    }
  }
  // Mecha opcional (validarWicks=true): tampoco deja pasar el high/low.
  if (p.validarWicks) {
    const eps = 1e-9;
    for (let i = iA + 1; i < finValid; i++) {
      if (i === i2) continue;
      const lv = linea(i);
      if (esB) {
        if (velas[i].h > lv + eps) return null;
      } else {
        if (velas[i].l < lv - eps) return null;
      }
    }
  }

  let brk = -1, brkFalso = -1, iEngano = -1, toques = 0;
  const fuera = (i) => esB
    ? velas[i].c > linea(i) + p.margenAtr * A[i]
    : velas[i].c < linea(i) - p.margenAtr * A[i];
  const dentro = (i) => esB ? velas[i].c <= linea(i) : velas[i].c >= linea(i);
  for (let i = iA + 1; i < n; i++) {
    if (fuera(i)) {
      /* Confirmación: las siguientes velas cerradas no pueden volver dentro.
         Si no hay velas suficientes para confirmar, la raya aún no está rota. */
      const k = Math.max(0, p.velasConfirmacion | 0);
      if (k === 0) { brk = i; break; }
      let confirmada = true, dentroEn = -1;
      for (let j = 1; j <= k; j++) {
        if (i + j >= n) { confirmada = false; break; }   // aún no hay con qué confirmar
        if (dentro(i + j)) { confirmada = false; dentroEn = i + j; break; }
      }
      if (confirmada) { brk = i; break; }
      /* Ruptura intentada y no confirmada: es un ENGAÑO, no un cambio. Se
         guarda la vela que volvió dentro y se sigue evaluando. */
      if (brkFalso < 0) { brkFalso = i; iEngano = dentroEn; }
      continue;
    }
    /* Un toque por cuerpo (la raya queda dentro del cuerpo) no invalida la
       raya: solo una ruptura por encima del margen rompe la tendencia. */
    if (i !== i2) {
      const dist = Math.abs(velas[i].c - linea(i));
      if (dist <= p.toqueAtr * A[i]) toques++;
    }
  }
  if (brk >= 0 && brk - i2 < p.minVelasTrasAncla) return null;
  if (toques < p.minToques) return null;
  return { tipo, iA, i2, base, m, toques, brk, brkFalso, iEngano };
}

/* ---------- búsqueda de rayas ----------
   Fan (abanico): si hay al menos 4 pivotes, se toman los 4 MÁS RECIENTES
   y se generan 3 patas (Leg 1/2/3) compartiendo UN único origen (el más
   antiguo de esos 4). Eso es el abanico canónico (Fan Principle).
   Si hay menos de 4 pivotes, se cae al barrido por pares (compatibilidad
   con series cortas / tests). */
function _rayas(velas, A, tipo, p) {
  const n = velas.length;
  const esB = tipo === 'bajista';
  const desde = Math.max(0, n - p.maxVelasRaya);
  const pivs = pivotes(velas, esB ? 'alto' : 'bajo', p.k, p.pivotePorCierre !== false).filter((i) => i >= desde);
  const out = [];
  if (pivs.length < 2) return out;

  // Origen fijado al inicio del tramo vigente: el pivote MAS ANTIGUO que
  // aun produce al menos una pata VIVA (brk<0). Se desliza hacia adelante
  // solo hasta encontrar ese origen; asi el ancla queda fijada al inicio del
  // tramo vigente (no se mueve mientras el tramo siga vivo) y se reinicia
  // cuando el tramo se rompe. Preferimos el origen mas antiguo valido para
  // que el abanico abarque todo el tramo (inicio a fin), no solo el final.
  // Origen = INICIO DE LA TENDENCIA: el pivote MAS ANTIGUO desde el que la
  // raya hasta el pivote mas reciente sigue sin cruzar ninguna vela ni
  // mecha. Al formarse pivotes nuevos la raya se corre sola hacia ellos.
  const pFan0 = { ...p, minToques: 0 };
  const ultimoPiv = pivs[pivs.length - 1];
  let originIdx = -1;
  for (let s = 0; s < pivs.length - 1; s++) {
    if (ultimoPiv - pivs[s] < p.minVelasAncla) continue;
    const rr = _validarRaya(velas, A, pFan0, tipo, pivs[s], ultimoPiv, { skipMinAncla: true });
    /* La raya debe seguir VIVA hasta la última vela: si ya se rompió, ese
       origen es de un tramo viejo y no es el inicio de la tendencia actual. */
    if (rr && rr.brk < 0) { originIdx = s; break; }
  }
  // Si el tramo aun no tiene una raya limpia, se cae al origen mas antiguo
  // con alguna pata viva (compatibilidad).
  if (originIdx < 0) {
    for (let s = 0; s < pivs.length - 1; s++) {
      const o = pivs[s];
      let hasViva = false;
      for (let b = s + 1; b < pivs.length; b++) {
        const rr = _validarRaya(velas, A, pFan0, tipo, o, pivs[b], { skipMinAncla: true });
        if (rr && rr.brk < 0) { hasViva = true; break; }
      }
      if (hasViva) { originIdx = s; break; }
    }
  }
  if (originIdx < 0) originIdx = Math.max(0, pivs.length - 2);
  const origin = pivs[originIdx];
  const cand = pivs.slice(originIdx);

  if (cand.length >= 4) {
    const pFan = { ...p, minToques: 0 };
    // Fan de 3 patas: origen comun + los 3 pivotes mas recientes posteriores.
    const legs = [];
    const last3 = cand.slice(-3);
    for (const end of last3) {
      if (end === origin) continue;
      const r = _validarRaya(velas, A, pFan, tipo, origin, end, { skipMinAncla: true });
      if (r) legs.push(r);
    }
    if (legs.length) out.push(...legs);
    else {
      for (let b = 1; b < cand.length; b++) {
        const r = _validarRaya(velas, A, p, tipo, origin, cand[b]);
        if (r) out.push(r);
      }
    }
  } else {
    for (let b = 1; b < cand.length; b++) {
      const r = _validarRaya(velas, A, p, tipo, origin, cand[b]);
      if (r) out.push(r);
    }
  }
  return out;
}

/* ---------- conversión de pata (leg) a objeto raya completo ---------- */
function legToRaya(leg, velas) {
  const n = velas.length;
  const esB = leg.tipo === 'bajista';
  const linea = (i) => leg.base + leg.m * (i - leg.iA);
  return {
    tipo: leg.tipo,
    iA: leg.iA, i2: leg.i2, base: leg.base, m: leg.m, toques: leg.toques, brk: leg.brk,
    desde: velas[leg.iA].t,
    hasta: velas[leg.i2].t,
    valorDesde: leg.base,
    valorHasta: velas[leg.i2].c,
    pendiente: leg.m,
    /* toques = toques INTERMEDIOS (los que cuentan para minToques). Las dos
       anclas son siempre dos toques: por eso el total nunca baja de 2. */
    toques: leg.toques,
    toquesTotales: (leg.toques || 0) + 2,
    valorAhora: linea(n - 1),
    valorSiguiente: linea(n),
    rota: leg.brk >= 0,
    ruptura: leg.brk >= 0 ? { t: velas[leg.brk].t, precio: velas[leg.brk].c, valor: linea(leg.brk), velas: n - 1 - leg.brk } : null,
    anclas: [{ t: velas[leg.iA].t, precio: leg.base }, { t: velas[leg.i2].t, precio: velas[leg.i2].c }],
  };
}

/* ---------- origen único de tendencia (abanico) ----------
   Todas las rayas de un mismo tramo comparten UN solo punto de inicio:
   el origen del tramo vigente. Al romper la tendencia, el abanico se
   reinicia desde un nuevo origen. */
function origenActual(rayas) {
  if (!rayas || !rayas.length) return null;
  const vivas = rayas.filter((r) => r.brk < 0);
  const pool = vivas.length ? vivas : rayas;
  return Math.min(...pool.map((r) => r.iA));
}
function filtrarAbanico(rayas) {
  const baj = rayas.filter((r) => r.tipo === 'bajista');
  const alc = rayas.filter((r) => r.tipo === 'alcista');
  const oB = origenActual(baj);
  const oA = origenActual(alc);
  return [
    ...baj.filter((r) => oB === null || r.iA === oB),
    ...alc.filter((r) => oA === null || r.iA === oA),
  ];
}

/* ---------- timeline de eventos ---------- */
function analizar(velas, params = {}) {
  const p = { ...PARAMS, ...params };
  const n = velas.length;
  const evs = [];
  if (!Array.isArray(velas) || n < p.minVelasSerie) return evs;
  const A = atr(velas, p.atrPeriodo);
  // Para detectar cambios/engaños se validan los cuerpos solo entre anclas:
  // una raya que el precio rompio despues debe existir para poder avisar.
  const pHist = { ...p, validarWicksHastaAhora: false };
  /* Ojo: aquí NO se filtra por abanico. `filtrarAbanico` deja solo la raya
     viva más antigua por tipo, y una raya viva nunca ha roto: con eso el
     aviso de CAMBIO no podía dispararse jamás (0 eventos en 8.589 velas).
     Se recorren todas las rayas y al final se deduplica por (clase, vela, tipo)
     quedándose con la de más toques. */
  const todas = _candidatasRayas(velas, A, pHist, true);
  for (const r of todas) {
    const esB = r.tipo === 'bajista';
    const linea = (i) => r.base + r.m * (i - r.iA);
    const emisiones = [];
    if (r.brk >= 0) {
      /* CAMBIO solo con ruptura CONFIRMADA (cierre fuera + seguimiento).
         El aviso se fecha en la vela que CONFIRMA, que es cuando se sabe:
         fecharlo en la de ruptura haría que el Vigia lo descartara como
         evento pasado y el cambio no se avisaría nunca. `brk` sigue siendo
         la vela de ruptura para dibujar. */
      const iEvCambio = Math.min(n - 1, r.brk + Math.max(0, p.velasConfirmacion | 0));
      emisiones.push({ clase: 'cambio', iEv: iEvCambio });
      let vuelve = -1;
      for (let i = r.brk + 1; i <= Math.min(n - 1, r.brk + p.ventana); i++) {
        const c = velas[i].c;
        if (esB ? c < linea(i) - p.margenAtr * A[i] : c > linea(i) + p.margenAtr * A[i]) { vuelve = i; break; }
      }
      if (vuelve > 0) emisiones.push({ clase: 'engano', iEv: vuelve });
    }
    /* Ruptura intentada sin seguimiento: ENGAÑO en la vela que volvió dentro. */
    if (r.iEngano >= 0 && r.iEngano > r.i2) emisiones.push({ clase: 'engano', iEv: r.iEngano });
    for (const em of emisiones) {
      if (em.iEv > n - 1) continue;
      if (evs.some((e) => e.clase === em.clase && e.iEv === em.iEv && e.iA === r.iA)) continue;
      const iEv = em.iEv;
      const clase = em.clase;
      evs.push({
        tipo: r.tipo, iA: r.iA, i2: r.i2, brk: r.brk, iEv, clase, toques: r.toques,
        valorDesde: r.base,
        valorHasta: velas[r.i2].c,
        valorRuptura: linea(r.brk),
        valorEvento: linea(iEv),
      });
    }
  }
  /* Dedup: varias rayas del mismo tipo pueden romperse en la misma vela.
     Vale una sola, la mejor sostenida. */
  const unicos = new Map();
  for (const e of evs) {
    const k = `${e.clase}|${e.iEv}|${e.tipo}`;
    const prev = unicos.get(k);
    if (!prev || (e.toques || 0) > (prev.toques || 0)) unicos.set(k, e);
  }
  evs.length = 0;
  evs.push(...[...unicos.values()].sort((a, b) => a.iEv - b.iEv));

  /* ---- TOQUES confirmados sobre raya VIGENTE (sin ATR, por cuerpo) ----
     Un toque = una vela cuyo cuerpo (min/max de o,c) contiene el valor
     de la raya. Se avisa solo si la siguiente vela cierra con cuerpo a
     favor de la tendencia vigente y la raya sigue sin romperse. */
  for (const r of todas) {
    if (r.brk >= 0) continue; // solo rayas vigentes (no rotas)
    const esB = r.tipo === 'bajista';
    const linea = (i) => r.base + r.m * (i - r.iA);
    let nToque = 0;
    for (let i = r.i2 + 1; i < n - 1; i++) {
      const rv = linea(i);
      const o = velas[i].o, c = velas[i].c;
      const lo = Math.min(o, c), hi = Math.max(o, c);
      const eps = 1e-9;
      if (!(lo - eps <= rv && rv <= hi + eps)) continue; // no tocó con cuerpo
      nToque++;
      const j = i + 1;
      const oj = velas[j].o, cj = velas[j].c;
      const bodyFavor = esB ? cj < oj : cj > oj;
      if (!bodyFavor) continue; // siguiente vela no confirma rebote
      evs.push({
        tipo: r.tipo, iA: r.iA, i2: r.i2, brk: r.brk, iEv: j, clase: 'toque', toques: r.toques,
        valorDesde: r.base,
        valorHasta: velas[r.i2].c,
        valorRuptura: null,
        valorEvento: linea(j),
        nToque,
      });
    }
  }
  /* una sola cosa por vela, la raya de más calidad (más toques, anclas más recientes) */
  const porVela = new Map();
  for (const e of evs) {
    const prev = porVela.get(e.iEv);
    if (!prev || e.toques > prev.toques || (e.toques === prev.toques && e.i2 > prev.i2)) porVela.set(e.iEv, e);
  }
  return [...porVela.values()].sort((a, b) => a.iEv - b.iEv);
}

/* ---------- raya vigente: abanico (fan) de 3 patas ---------- */
function rayaVigente(velas, params = {}) {
  const p = { ...PARAMS, ...params };
  const n = velas.length;
  if (!Array.isArray(velas) || n < p.minVelasSerie) return null;
  const A = atr(velas, p.atrPeriodo);
  // 1) Rayas limpias: no cruzan ningún cuerpo hasta el precio actual.
  let todas = filtrarAbanico([..._rayas(velas, A, 'bajista', p), ..._rayas(velas, A, 'alcista', p)]);
  // 2) Si no hay ninguna limpia, se muestra la última raya rota (discontinua)
  //    para que el usuario vea el cambio de tendencia en la web.
  if (!todas.length) {
    const pHist = { ...p, validarWicksHastaAhora: false };
    todas = filtrarAbanico([..._rayas(velas, A, 'bajista', pHist), ..._rayas(velas, A, 'alcista', pHist)]);
  }
  if (!todas.length) return null;
  // Agrupar por tipo (bajista/alcista); cada grupo es un fan.
  const porTipo = {};
  for (const r of todas) (porTipo[r.tipo] = porTipo[r.tipo] || []).push(r);
  const tipos = Object.keys(porTipo);
  // Elegir el fan activo: el que tenga patas vivas; si ambos, el de origen más reciente.
  let tipoActivo = tipos[0];
  if (tipos.length > 1) {
    const score = (t) => {
      const legs = porTipo[t];
      const vivas = legs.filter((r) => r.brk < 0).length;
      const origin = Math.max(...legs.map((r) => r.iA));
      return vivas * 1e6 + origin;
    };
    tipoActivo = tipos.slice().sort((a, b) => score(b) - score(a))[0];
  }
  const legs = porTipo[tipoActivo].slice().sort((a, b) => a.i2 - b.i2);
  const patas = legs.map((r) => legToRaya(r, velas));
  // Primaria = pata viva si hay; si no, la de más toques.
  const primary = patas.slice().sort((a, b) =>
    ((b.rota ? 0 : 1) - (a.rota ? 0 : 1)) || (b.toques - a.toques) || (b.i2 - a.i2))[0];
  return { ...primary, patas };
}

/* ---------- familia de rayas ----------
   Todas las rayas VIVAS (una por origen) dentro de la ventana larga, para
   dibujarlas a la vez: el propietario marca varias líneas de distinto
   origen y escala, no una sola. Cada origen aporta su pata más larga que
   siga sin cruzar ningún cuerpo hasta el precio actual. */
/* Candidatas: una pata por origen, viva o ROTA. La usan la familia (se queda
   con las vivas) y el timeline de eventos (necesita las rotas: sin ellas no
   hay cambio de tendencia que avisar). */
function _candidatasRayas(velas, A, p, incluirRotas = false) {
  const n = velas.length;
  const desde = Math.max(0, n - p.maxVelasFamilia);
  const pFan = { ...p, minToques: 0 };
  const out = [];
  for (const tipo of ['bajista', 'alcista']) {
    const esB = tipo === 'bajista';
    const pivs = pivotes(velas, esB ? 'alto' : 'bajo', p.k, p.pivotePorCierre !== false)
      .filter((i) => i >= desde);
    if (pivs.length < 2) continue;
    // Cada origen aporta su raya más larga que SIGUE VIVA hasta el precio
    // actual (r.brk < 0). El segundo ancla es el pivote más nuevo que aún
    // aguanta sin cruzar cuerpos, no necesariamente el último pivote.
    const ultimo = pivs[pivs.length - 1];
    const desdeB = Math.max(1, pivs.length - 60);
    for (let s = 0; s < pivs.length - 1; s++) {
      if (ultimo - pivs[s] < p.minVelasAncla) break;
      /* Se prefiere la pata VIVA más larga; si no hay, se guarda la mejor
         ROTA. Sin las rotas el timeline no puede avisar de un cambio. */
      let vivo = null, roto = null;
      for (let b = pivs.length - 1; b >= Math.max(s + 1, desdeB); b--) {
        const r = _validarRaya(velas, A, pFan, tipo, pivs[s], pivs[b], { skipMinAncla: true });
        if (!r) continue;
        if (r.brk < 0) {
          if (!vivo) vivo = r;
          /* La familia se queda con la viva más nueva y para; el timeline
             necesita seguir bajando para encontrar la pata que sí rompió. */
          if (!incluirRotas) break;
          continue;
        }
        if (!roto) roto = r;
      }
      const cands = [];
      if (vivo) cands.push(vivo);
      if (roto && (!vivo || roto.i2 !== vivo.i2)) cands.push(roto);
      for (const r of cands) {
        // Dedup por geometría: si a mitad de tramo la línea pasa a menos de
        // `dedupAtr` ATR de otra ya guardada, es la misma raya vista desde otro
        // pivote. Vivas y rotas no se mezclan: son información distinta.
        const dup = out.find((o) => {
          if (o.tipo !== r.tipo) return false;
          if ((o.brk < 0) !== (r.brk < 0)) return false;
          const im = Math.round((Math.min(o.iA, r.iA) + r.i2) / 2);
          const yo = o.base + o.m * (im - o.iA);
          const yr = r.base + r.m * (im - r.iA);
          return Math.abs(yo - yr) < p.dedupAtr * A[im];
        });
        if (dup) { if (r.i2 - r.iA > dup.i2 - dup.iA) Object.assign(dup, r); continue; }
        out.push(r);
      }
    }
  }
  return out;
}

function familiaRayas(velas, params = {}) {
  const p = { ...PARAMS, ...params };
  const n = velas.length;
  if (!Array.isArray(velas) || n < p.minVelasSerie) return [];
  const A = atr(velas, p.atrPeriodo);
  const out = _candidatasRayas(velas, A, p).filter((r) => r.brk < 0);
  /* Orden por CALIDAD, no por longitud. Una raya sirve si el precio la
     respetó varias veces, sigue viva y pasa cerca del precio actual: lejos
     del precio es decoración. Se dibujan como mucho `maxRayasFamilia`. */
  const atrAhora = A[n - 1] || 1;
  const cierreAhora = velas[n - 1].c;
  const puntuar = (r) => {
    const largo = r.i2 - r.iA;
    const vivo = r.brk < 0 ? 1 : 0;
    const yAhora = r.base + r.m * (n - 1 - r.iA);
    const dist = Math.abs(yAhora - cierreAhora) / atrAhora;
    const cercania = Math.max(0, 1 - dist / 12);
    return (r.toques || 0) * 2 + vivo * 3 + Math.min(1, largo / 500) * 2 + cercania * 3;
  };
  out.sort((a, b) => puntuar(b) - puntuar(a));

  /* Solo rayas VALIDADAS (3 toques). Si no hay suficientes se completa con las
     mejores aunque tengan 2, marcadas como provisionales: mejor una raya
     honesta con 2 toques que cinco que nadie ha respetado. */
  const toquesTotales = (r) => (r.toques || 0) + 2;
  const validadas = out.filter((r) => toquesTotales(r) >= p.minToquesFamilia);
  const pool = validadas.length >= p.minRayasFamilia
    ? validadas
    : [...validadas, ...out.filter((r) => toquesTotales(r) < p.minToquesFamilia)];

  /* Una raya a más de 10 ATR del precio no sirve para decidir nada. Si hay
     suficientes cerca, las lejanas se descartan aunque tengan más toques. */
  const cerca = (r) => Math.abs(r.base + r.m * (n - 1 - r.iA) - cierreAhora) / atrAhora <= 10;
  const cercanas = pool.filter(cerca);
  const finales = cercanas.length >= p.minRayasFamilia ? cercanas : pool;

  return finales.slice(0, p.maxRayasFamilia).map((r) => ({
    ...legToRaya(r, velas),
    calidad: +puntuar(r).toFixed(2),
    validada: toquesTotales(r) >= p.minToquesFamilia,
  }));
}

/* ---------- máquina de estados por (símbodo, TF) ---------- */
function ladoDe(tipo, clase) {
  const alcista = tipo === 'alcista';
  if (clase === 'cambio') return alcista ? 'VENTA' : 'COMPRA';
  // toque y engano = continuacion de la tendencia vigente
  return alcista ? 'COMPRA' : 'VENTA';
}

class Vigia {
  constructor({ simbodo = '', tf = 'M30', params = {} } = {}) {
    this.simbodo = simbodo;
    this.tf = tf;
    this.p = { ...PARAMS, ...params };
    this.ultimaT = null;
    this.nVelas = 0;
  }

  revisar(velas) {
    if (!Array.isArray(velas) || velas.length < this.p.minVelasSerie) return { raya: null, eventos: [] };
    const ult = velas[velas.length - 1];
    if (this.ultimaT !== null && ult.t <= this.ultimaT) return { raya: this._ultimaRaya, eventos: [] };
    const previo = this.ultimaT;
    const reSiembra = previo === null || velas.length > this.nVelas + 20;
    this.ultimaT = ult.t;
    this.nVelas = velas.length;

    const seg = TFS[this.tf] || 1800;
    const eventos = [];
    for (const e of analizar(velas, this.p)) {
      const vela = velas[e.iEv];
      if (reSiembra) { if (vela.t !== ult.t) continue; }
      else if (vela.t <= previo) continue;
      const t = vela.t + seg * 1000;
      eventos.push({
        clase: e.clase,
        lado: ladoDe(e.tipo, e.clase),
        simbodo: this.simbodo,
        tf: this.tf,
        t,
        precio: vela.c,
        raya: {
          tipo: e.tipo,
          desde: velas[e.iA].t,
          hasta: velas[e.i2].t,
          valorDesde: e.valorDesde,
          valorHasta: e.valorHasta,
          valorRuptura: e.valorRuptura,
          valorEvento: e.valorEvento,
          toques: e.toques,
        },
        clave: `${this.simbodo}|${this.tf}|${t}|raya-${e.clase}`,
      });
    }
    const raya = rayaVigente(velas, this.p);
    this._ultimaRaya = raya;
    return { raya, eventos };
  }
}

module.exports = {
  Vigia, analizar, rayaVigente, familiaRayas, atr, pivotes,
  _rayas, _candidatasRayas, _validarRaya, origenActual, filtrarAbanico,
  legToRaya, PARAMS, TFS_RAYA,
};
