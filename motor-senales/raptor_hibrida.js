'use strict';
/* ============================================================
   RAPTOR HÍBRIDA — port fiel de estrategias/raptor_hibrida.py
   ------------------------------------------------------------
   Las señales las genera el NÚCLEO v2 (toques 1/2/3 · rompimientos 1R/2R/3R).
   Encima se aplican las capas de la v1: zonas fractales con
   fuerza y TN, fases EARLY/MAIN/LATE sobre la zona, sesgo EMA30,
   gatillo direccional y score ponderado.

   INDEPENDENCIA POR TEMPORALIDAD (por defecto): cada TF calcula
   TODAS sus capas con sus propias velas. Ninguna TF lee otra.
   ============================================================ */
const core = require('./raptor_core');

const TF_SEGUNDOS = { M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400 };

/* «el rompimiento del 2.º toque, por encima de cualquier cosa, ES LA MEJOR»
   (v3 4:21-4:50, que allí se llama 2B/2RB y aquí es la 2R: R = rompimiento) */
const PESO_PATRON_DEFAULT = {
  '2R': 40,
  '1R': 30, '3R': 30, '1S': 30,
  '1': 10, '2': 10, '3': 10,
};

const ZONA_PARAMS = {
  alas: 2, tolPivoteAtr: 0.30, tolPivoteRel: 0.0008,
  vigenciaHoras: 48.0, tnAtr: 0.50, excursionAtr: 1.20,
  bandaToqueAtr: 0.15, confluenciaAtr: 0.50, atrPeriodo: 14,
};

const SCORE_PARAMS = {
  pesoPatron: { ...PESO_PATRON_DEFAULT },
  pesoFase: { EARLY: 25, MAIN: 40, LATE: 15 },
  pesoFuerzaPorPivote: 5.0, pesoFuerzaMax: 25.0,
  pesoSesgo: 25.0, pesoGatillo: 10.0, pesoConfluencia: 0.0, min: 0.0,
};

function hibridaParams(over = {}) {
  return {
    v2: over.v2 || core.params({ emitTouchesFrom: 'M1' }),
    zonas: { ...ZONA_PARAMS, ...(over.zonas || {}) },
    score: { ...SCORE_PARAMS, ...(over.score || {}) },
    independiente: over.independiente !== undefined ? over.independiente : true,
    filtrarSesgo: !!over.filtrarSesgo,
    filtrarConfluencia: !!over.filtrarConfluencia,
    filtrarGatillo: !!over.filtrarGatillo,
    scoreMin: over.scoreMin || 0,
  };
}

/* ATR de la v1: media SIMPLE del TR sobre `periodo` velas (expansivo al inicio) */
function atrSma(h, l, c, periodo) {
  const n = c.length, out = new Float64Array(n);
  let suma = 0;
  for (let i = 0; i < n; i++) {
    const prev = i === 0 ? c[0] : c[i - 1];
    const tr = Math.max(h[i] - l[i], Math.abs(h[i] - prev), Math.abs(l[i] - prev));
    suma += tr;
    if (i >= periodo) {
      const prevI = i - periodo;
      const pPrev = prevI === 0 ? c[0] : c[prevI - 1];
      suma -= Math.max(h[prevI] - l[prevI], Math.abs(h[prevI] - pPrev), Math.abs(l[prevI] - pPrev));
    }
    out[i] = suma / Math.min(i + 1, periodo);
  }
  return out;
}

function detectarZonas(df, zp = ZONA_PARAMS) {
  const h = df.h, l = df.l, c = df.c, t = df.t, n = c.length;
  const atr = n ? atrSma(h, l, c, zp.atrPeriodo) : new Float64Array(0);
  const w = zp.alas;

  const eventos = [];
  for (let centro = w; centro < n - w; centro++) {
    let techo = true, piso = true;
    for (let k = 1; k <= w; k++) {
      if (!(h[centro] > h[centro - k] && h[centro] > h[centro + k])) techo = false;
      if (!(l[centro] < l[centro - k] && l[centro] < l[centro + k])) piso = false;
      if (!techo && !piso) break;
    }
    if (techo) eventos.push({ en: centro + w, tipo: 'resistencia', nivel: h[centro] });
    if (piso) eventos.push({ en: centro + w, tipo: 'soporte', nivel: l[centro] });
  }

  const zonas = [];
  /* Índice vivo de zonas activas. El array `zonas` conserva TODAS (los ids son
     la identidad que se compara con el backtest), pero los dos bucles de abajo
     recorren solo las vivas: antes era O(velas × zonas muertas) y con 30 días
     de M5 hay ~860 zonas acumuladas. Mismo resultado, menos trabajo. */
  const activas = [];
  let e = 0;
  for (let j = 0; j < n; j++) {
    const ahora = t[j];
    while (e < eventos.length && eventos[e].en < j) e++;
    for (; e < eventos.length && eventos[e].en === j; e++) {
      const { tipo, nivel } = eventos[e];
      const tol = Math.max(zp.tolPivoteRel * nivel, zp.tolPivoteAtr * (atr[j] || 0));
      let cand = null;
      for (const z of activas) {
        if (z.tipo === tipo && Math.abs(z.nivel - nivel) <= tol) { cand = z; break; }
      }
      if (cand) {
        cand.nivel = (cand.nivel * cand.fuerza + nivel) / (cand.fuerza + 1);
        cand.fuerza++;
      } else {
        const z = { id: zonas.length + 1, tipo, nivel, fuerza: 1, estado: 'activa', nacida: ahora };
        zonas.push(z);
        activas.push(z);
      }
    }
    const a = atr[j] || 0;
    if (!a) continue;
    for (let ai = activas.length - 1; ai >= 0; ai--) {
      const z = activas[ai];
      if (z.nacida > ahora) continue;
      const fuera = z.tipo === 'soporte' ? c[j] < z.nivel - zp.tnAtr * a : c[j] > z.nivel + zp.tnAtr * a;
      if (fuera) { z.estado = 'muerta'; activas.splice(ai, 1); }
    }
  }
  return { zonas, activas, atr };
}

function zonasActivasEn(zonas, tLimite) {
  return zonas.filter((z) => z.estado === 'activa' && z.nacida <= tLimite);
}

/* CAPA D — cronología de toques de UNA zona: EARLY → MAIN / LATE */
function fasesDeZona(df, zona, atrEn, zp = ZONA_PARAMS) {
  if (!df || !df.c || !df.c.length || !Number.isFinite(atrEn) || atrEn <= 0) return [];
  const h = df.h, l = df.l, t = df.t;
  const banda = zp.bandaToqueAtr * atrEn;
  const out = [];
  let toques = 0, excur = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] < zona.nacida) continue;
    const toca = l[i] <= zona.nivel + banda && h[i] >= zona.nivel - banda;
    if (toca) {
      toques++;
      const fase = toques === 1 ? 'EARLY' : (excur >= zp.excursionAtr * atrEn ? 'MAIN' : 'LATE');
      out.push({ t: t[i], fase, toques });
      excur = 0;
    } else if (toques > 0) {
      const ex = zona.tipo === 'soporte' ? h[i] - zona.nivel : zona.nivel - l[i];
      if (ex > 0) excur = Math.max(excur, ex);
    }
  }
  return out;
}

/* CAPA E — sesgo por vela: cierre > EMA30 y EMA30 sube → alza; espejo → baja */
function sesgoSerie(df, periodo = 30, velasPendiente = 3) {
  if (!df || !df.c || df.c.length < periodo + velasPendiente + 1) return null;
  const c = df.c, t = df.t;
  const ema30 = core.ema(c, periodo);
  const estados = new Array(c.length);
  for (let i = 0; i < c.length; i++) {
    if (i < periodo + velasPendiente) { estados[i] = 'lateral'; continue; }
    const ult = ema30[i], antes = ema30[i - velasPendiente];
    if (c[i] > ult && ult > antes) estados[i] = 'alza';
    else if (c[i] < ult && ult < antes) estados[i] = 'baja';
    else estados[i] = 'lateral';
  }
  return { t, estados };
}

/* última vela cerrada ANTES del cierre de la vela de la señal */
function sesgoEn(serie, tSenal, tfSenal) {
  if (!serie || !serie.t) return 'desconocido';
  const cierre = tSenal + (TF_SEGUNDOS[tfSenal] || 300) * 1000;
  const t = serie.t;
  let lo = 0, hi = t.length;                     // upper_bound
  while (lo < hi) { const m = (lo + hi) >> 1; if (t[m] <= cierre) lo = m + 1; else hi = m; }
  const idx = lo - 1;
  return idx < 0 ? 'desconocido' : serie.estados[idx];
}

function ultimoIndiceHasta(t, limite) {
  let lo = 0, hi = t.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (t[m] <= limite) lo = m + 1; else hi = m; }
  return lo - 1;
}

function enriquecer(senales, dfs, p = hibridaParams()) {
  const capas = {
    independiente: p.independiente, zonas: false, fases: false, sesgo: false,
    zonasPorTf: [], sesgoPorTf: [],
  };
  const tfZonas = (tf) => (p.independiente ? tf : 'M15');
  const tfFases = (tf) => (p.independiente ? tf : 'M5');
  const tfSesgo = (tf) => (p.independiente ? tf : 'H1');

  const tfs = [...new Set(senales.map((s) => s.tf))];
  const ctx = [...new Set(tfs.flatMap((t) => [tfZonas(t), tfFases(t), tfSesgo(t)]))].sort();

  const cacheZonas = new Map(), cacheSesgo = new Map();
  for (const tf of ctx) {
    const d = dfs[tf];
    if (!d || !d.c || !d.c.length) continue;
    cacheZonas.set(tf, detectarZonas(d, p.zonas));
    cacheSesgo.set(tf, sesgoSerie(d, p.v2.emaFast, 3));
  }
  if (cacheZonas.size) { capas.zonas = true; capas.zonasPorTf = [...cacheZonas.keys()].sort(); }
  if (cacheSesgo.size) { capas.sesgo = true; capas.sesgoPorTf = [...cacheSesgo.keys()].sort(); }

  const cacheFases = new Map();
  const out = [];

  for (const s of senales) {
    const tSig = s.t, tfSig = s.tf;
    const cierreSig = tSig + (TF_SEGUNDOS[tfSig] || 300) * 1000;
    const dir = s.direction;

    const dfSig = dfs[tfSig];
    let precioRef = Number.isFinite(s.entry) ? s.entry : null;
    if (precioRef === null && dfSig && s.barIndex >= 0 && s.barIndex < dfSig.c.length) precioRef = dfSig.c[s.barIndex];

    const r = { ...s, zonaId: null, zonaTipo: null, zonaNivel: null, zonaFuerza: null, distZonaAtr: null,
      confluencia: false, confluenciaFavor: false, faseZona: null,
      sesgo: 'desconocido', sesgoOk: true, gatilloOk: null, score: null };

    /* CAPA E — sesgo de la TF propia */
    r.sesgo = sesgoEn(cacheSesgo.get(tfSesgo(tfSig)) || null, tSig, tfSig);
    r.sesgoOk = (r.sesgo === 'alza' || r.sesgo === 'baja')
      ? ((r.sesgo === 'alza') === (dir === 'BUY'))
      : true;

    /* CAPA F — gatillo direccional: la vela de la señal va en la dirección */
    if (dfSig && s.barIndex >= 0 && s.barIndex < dfSig.c.length) {
      r.gatilloOk = dir === 'BUY' ? dfSig.c[s.barIndex] > dfSig.o[s.barIndex] : dfSig.c[s.barIndex] < dfSig.o[s.barIndex];
    }

    /* CAPAS A/B/C/D — zona más cercana, fuerza, confluencia y fase */
    const tz = tfZonas(tfSig);
    const zc = cacheZonas.get(tz);
    const zdf = dfs[tz];
    if (zc && zdf && zdf.c.length && precioRef !== null) {
      const j = ultimoIndiceHasta(zdf.t, cierreSig);
      if (j >= 0) {
        const aZ = j < zc.atr.length ? zc.atr[j] : NaN;
        const activas = zonasActivasEn(zc.zonas, cierreSig);
        if (activas.length && Number.isFinite(aZ) && aZ > 0) {
          let mejor = activas[0], mejorDist = Math.abs(precioRef - mejor.nivel);
          for (const z of activas.slice(1)) {
            const d = Math.abs(precioRef - z.nivel);
            if (d < mejorDist) { mejor = z; mejorDist = d; }
          }
          r.distZonaAtr = mejorDist / aZ;
          r.zonaId = mejor.id; r.zonaTipo = mejor.tipo; r.zonaNivel = mejor.nivel; r.zonaFuerza = mejor.fuerza;
          if (mejorDist <= p.zonas.confluenciaAtr * aZ) {
            r.confluencia = true;
            r.confluenciaFavor = (mejor.tipo === 'resistencia') === (dir === 'SELL');
            const tff = tfFases(tfSig), fdf = dfs[tff];
            const clave = `${tz}|${mejor.id}`;
            if (fdf && fdf.c.length && !cacheFases.has(clave)) {
              cacheFases.set(clave, fasesDeZona(fdf, mejor, aZ, p.zonas));
            }
            const cron = cacheFases.get(clave) || [];
            let fase = null;
            for (const f of cron) if (f.t >= tSig && f.t < cierreSig) fase = f.fase;
            if (fase) { r.faseZona = fase; capas.fases = true; }
          }
        }
      }
    }

    /* CAPA G — score: ordena, no decide (min=0) */
    let sScore = p.score.pesoPatron[s.pattern] !== undefined ? p.score.pesoPatron[s.pattern] : 10;
    if (r.faseZona) sScore += p.score.pesoFase[r.faseZona] || 0;
    if (r.zonaFuerza !== null) sScore += Math.min(p.score.pesoFuerzaMax, r.zonaFuerza * p.score.pesoFuerzaPorPivote);
    if (r.sesgoOk && (r.sesgo === 'alza' || r.sesgo === 'baja')) sScore += p.score.pesoSesgo;
    if (r.gatilloOk) sScore += p.score.pesoGatillo;
    if (r.confluenciaFavor) sScore += p.score.pesoConfluencia;
    r.score = Math.min(100, sScore);

    out.push(r);
  }
  /* zonasCache sale para que el motor en vivo pueda avisar intrabar cuando el
     precio entra en una banda, sin recalcular zonas en cada tick */
  return { senales: out, capas, zonasCache: cacheZonas };
}

function filtrar(senales, p = hibridaParams()) {
  return senales.filter((s) => {
    if (p.filtrarSesgo && !s.sesgoOk) return false;
    if (p.filtrarConfluencia && !s.confluenciaFavor) return false;
    if (p.filtrarGatillo && !s.gatilloOk) return false;
    if (p.scoreMin > 0 && !(s.score >= p.scoreMin)) return false;
    return true;
  });
}

/* dfs = { M5: {t,o,h,l,c}, M15: {...}, ... } */
function scanHibrida(dfs, p = hibridaParams()) {
  const partes = [];
  for (const tf of core.TIMEFRAMES) {
    const d = dfs[tf];
    if (!d || !d.c || !d.c.length) continue;
    const sig = core.scan(d, tf, p.v2);
    if (sig.length) partes.push(...sig);
  }
  const enr = enriquecer(partes, dfs, p);
  return { senales: filtrar(enr.senales, p), enriquecidas: enr.senales, capas: enr.capas, zonasCache: enr.zonasCache };
}

module.exports = {
  TF_SEGUNDOS, PESO_PATRON_DEFAULT, ZONA_PARAMS, SCORE_PARAMS,
  hibridaParams, atrSma, detectarZonas, zonasActivasEn, fasesDeZona,
  sesgoSerie, sesgoEn, enriquecer, filtrar, scanHibrida,
};
