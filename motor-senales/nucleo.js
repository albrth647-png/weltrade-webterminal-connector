'use strict';
const { horaHabana } = require('./tiempo');
/* ============================================================
   NÚCLEO DE SEÑALES — catálogo del vídeo 03 de Yoel
   ------------------------------------------------------------
   Sin zonas fractales, sin fases EARLY/MAIN/LATE, sin score.
   Solo lo que el vídeo define:

     EMA30  = contacto (aquí se mide el toque)
     EMA50  = techo (el retroceso no la supera)
     EMA100 = tendencia de fondo

     `1`          la seductora: se sale sobre la EMA50, regresa y
                  quiebra con cuerpo el mínimo del engaño (ENTRADA)
     `2`          segundo toque a la EMA30 (ENTRADA al toque)
     `3`          tras superar el mínimo de la 2, tercer toque (ENTRADA al toque)
     `2B`         segundo toque + quiebre con cuerpo del mínimo anterior,
                  operado en el retesteo del nivel (ENTRADA)
     `3B`         tercer toque + quiebre con cuerpo del mínimo anterior (ENTRADA)
     `R`          reset de la secuencia 1/2/3: cuando una jugada se consume, la
                  cuenta vuelve a empezar (`1R`, `2R`, `3R`, `2RB`, `3RB`)
     (no existe `1B`: el quiebre ya va dentro de la 1)

   Los números del vídeo no existen (él no da ni uno): los `[EST]` de
   PARAMS son calibración nuestra y se tocan sin miedo. La especificación
   completa está en docs/estrategia/video_03_reglas_implementables.md.

   El escaneo es PURO y determinista: se recalcula la serie y se emiten
   los eventos de la última vela cerrada. Nada de estado que derive.
   ============================================================ */
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

const TFS = { M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400 };
const LADOS = ['VENTA', 'COMPRA'];

/* Una vela es usable solo si el OHLC es coherente. El estado persistido se
   validaba únicamente por `t`: una vela con `c` ausente truncaba la serie y
   una con `h` ausente dejaba el ATR en NaN (el motor dejaba de emitir sin
   error visible). Se descarta solo la vela mala, no la cola. */
const velaValida = (v) => !!v
  && Number.isFinite(v.t)
  && Number.isFinite(v.o) && Number.isFinite(v.h) && Number.isFinite(v.l) && Number.isFinite(v.c)
  && v.o > 0 && v.h > 0 && v.l > 0 && v.c > 0
  && v.h >= Math.max(v.o, v.c) - 1e-9
  && v.l <= Math.min(v.o, v.c) + 1e-9
  && v.h >= v.l;

/* Temporalidades que se escanean por defecto. */
const TF_ESCANEO = ['H1', 'M15', 'M5', 'M1'];

/* Brecha máxima tolerada entre el cierre del bróker y el de la vela que ya se
   cerró con ticks para la MISMA barra. El histórico de cmd 11 y el stream de
   ticks son series distintas: se midieron brechas de 0,2-0,9 % que dejaban las
   señales en precios que no existen en MT5 (el tick sí coincide). Por encima
   de este umbral manda la vela de ticks; por debajo, la del bróker, que corrige
   las revisiones sin mover la señal después de emitida. */
const TOL_TICK_SERVIDOR = 0.0015;
const _avisoTolerancia = new Map();

const PARAMS = {
  /* --- del vídeo --- */
  emaContacto: 30,        // EMA30 blanca: el toque se mide aquí
  emaTecho: 50,           // EMA50 amarilla: no se supera
  emaFondo: 100,          // EMA100: tendencia de fondo
  retencionDias: 30,      // un mes de historia por temporalidad
  /* --- calibrados 2026-11-10 con 4 símbolos × 4 TF (30 días), 2.025 combinaciones:
         elegido con el 70 % inicial y validado con el 30 % final.
         Medido: 0,092R de esperanza en train y 0,044R en validación (ver calibrar.mjs). --- */
  atrPeriodo: 14,
  tolToqueAtr: 0.30,      // la mecha puede quedarse a 0,30 ATR de la EMA30
  ventanaMin: 12,         // «el mínimo anterior» = mínimo de las 12 velas previas
  cuerpoMin: 0.50,        // «con cuerpo» = 50 % del rango de la vela
  cuerpoMinAtr: 0.10,     // en el borde de la rejilla: 0,20 y 0,35 dan prácticamente lo mismo
  caducidad: 3,           // velas que el quiebre sigue vivo tras el toque
  separacionToques: 2,    // velas mínimas entre dos toques
  /* --- reglas del vídeo que antes se daban por supuestas --- */
  exigirExtension: true,   // el 2.º y el 3.er toque tienen que SUPERAR al anterior
  cuerpoSoloUno: false,    // «con cuerpo» lo exigen TODAS las B (diccionario del propietario:
                           // «quiebra con cuerpo el mínimo anterior»). Con true sólo lo pide la 1
  caducidadEngano: 12,     // velas que el engaño sigue vigente (no vale uno de hace 40)
  cancelarSobreTecho: true,// un cierre más allá de la EMA50 cancela el pendiente («no superar»)
  resetPorSalida: true,    // «se salió, volvió y lo hizo otra vez» → la siguiente lleva R
  resetTrasEntrada: true,  // además, tras consumir una jugada la siguiente lleva R
                           // (interpretación laxa del reset; con false el R solo
                           // aparece cuando el precio salió de la tendencia y volvió)
  /* --- filtro anti-rango (chop): no operar si las EMAs no están separadas/en pendiente.
       0 = desactivado (comportamiento anterior). Calibrar en v03-lab. --- */
  separacionMinAtr: 0,     // distancia mínima entre EMA30/50 y EMA50/100, en ATR
  pendienteMinAtr: 0,      // pendiente mínima de la EMA100 en ATR por 5 velas
  nivelUnoPorEngano: true, // la 1 rompe el mínimo DEL TRAMO DEL ENGAÑO (no el de 12 velas)
  /* --- la 2B: tres lecturas, la del propietario por defecto --- */
  modo2B: 'retesteo',      // 'retesteo' (diccionario: «quiebre + retesteo") |
                           // 'continuacion' (operar el quiebre al cierre) |
                           // 'reversion' (Sperandeo: operar el fracaso del quiebre)
  caducidadRetesteo: 3,    // velas que se espera la vuelta al nivel tras el quiebre
  tolRetesteoAtr: 0.30,    // el retesteo puede quedarse a 0,30 ATR del nivel
  margen2BAtr: 0.50,       // «apenas lo supera»: cuánto puede irse el quiebre, en ATR
  caducidadFallo2B: 2,     // velas para que el precio vuelva al otro lado del nivel
  /* --- estrategia Estructura (impulso + retroceso + quiebre, sin EMAs) ---
       Estrategia paralela a la de Yoel. No depende de EMAs: la tendencia
       se verifica por la estructura misma del precio (impulsos y retrocesos).
       Los umbrales son calibración nuestra, ajustables sin tocar el código. --- */
  estructuraImpulsoMinATR: 0.8,      // impulso mínimo en ATR
  estructuraMinVelasImpulso: 2,      // un impulso es un tramo, no una vela suelta
  estructuraMaxVelasImpulso: 3,      // máximo de velas que forman un impulso
  estructuraCuerpoImpulso: 0.35,     // cuerpo ≥ 35% del rango total del impulso
  estructuraVentanaEstructura: 20,   // el impulso debe hacer el extremo de 20 velas
  estructuraRetrocesoMinATR: 1.0,    // retroceso mínimo en ATR (un pullback real, no ruido)
  estructuraRetrocesoMaxATR: 3.0,    // retroceso máximo en ATR
  estructuraCaducidad: 30,           // velas que el quiebre sigue vivo tras el retroceso
  estructuraEspera: 30,              // velas de enfriamiento tras una entrada del mismo lado
};

/* Entradas reales del catálogo. 2/3/2R/3R entran al toque; 1/1R y las B
   entran con el quiebre. Las variantes E de Estructura (2E/3E) son avisos. */
const ENTRADAS = new Set(['1', '1R', '2', '2R', '3', '3R', '2B', '2RB', '3B', '3RB',
  '1E', '1ER', '2EB', '2EBR', '3EB', '3EBR']);

/* Prioridad para «una señal por vela y lado». Entrada > aviso; dentro de las
   entradas, tier A > B > C de la calibración. Estructura no tiene R medido,
   así que se le asigna tier por familia. */
const TIER_ESTRUCTURA = { '3EBR': 'A', '3EB': 'A', '2EBR': 'B', '2EB': 'B', '1E': 'B', '1ER': 'B' };
const PESO_TIER = { A: 3, B: 2, C: 1 };
const PESO_AVISO = { '3E': 6, '3ER': 6, '2E': 5, '2ER': 5 };
function prioridadEvento(ev) {
  if (!ENTRADAS.has(ev.patron)) return PESO_AVISO[ev.patron] || 0;
  const j = JERARQUIA[ev.patron];
  const tier = j ? j.tier : (TIER_ESTRUCTURA[ev.patron] || 'C');
  return 100 + (PESO_TIER[tier] || 0) * 10 + (j ? j.r * 10 : 0);
}

/* ---------------- indicadores ---------------- */

function ema(valores, periodo) {
  const n = valores.length;
  const out = new Array(n).fill(null);
  if (n < periodo) return out;
  let suma = 0;
  for (let i = 0; i < periodo; i++) suma += valores[i];
  out[periodo - 1] = suma / periodo;
  const k = 2 / (periodo + 1);
  for (let i = periodo; i < n; i++) out[i] = valores[i] * k + out[i - 1] * (1 - k);
  return out;
}

function atr(velas, periodo) {
  const n = velas.length;
  const out = new Array(n).fill(null);
  if (n < periodo + 1) return out;
  const tr = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (i === 0) { tr[i] = velas[i].h - velas[i].l; continue; }
    const pc = velas[i - 1].c;
    tr[i] = Math.max(velas[i].h - velas[i].l, Math.abs(velas[i].h - pc), Math.abs(velas[i].l - pc));
  }
  let suma = 0;
  for (let i = 1; i <= periodo; i++) suma += tr[i];
  out[periodo] = suma / periodo;
  for (let i = periodo + 1; i < n; i++) out[i] = (out[i - 1] * (periodo - 1) + tr[i]) / periodo;
  return out;
}

/* ---------------- escaneo ---------------- */

/* Tendencia EMA que ve el operador en el gráfico. Se usa para etiquetar
   cada evento y para que el bot nunca envíe un lado contra la estructura. */
const clasificarTendencia = (cierre, e30, e50, e100) => {
  if (!(e30 > 0) || !(e50 > 0) || !(e100 > 0)) return 'LATERAL';
  if (cierre > e30 && e30 >= e50 && e50 >= e100) return 'ALCISTA';
  if (cierre < e30 && e30 <= e50 && e50 <= e100) return 'BAJISTA';
  return 'LATERAL';
};

/* Puerta EMA única para Estructura: la pila tiene que estar alineada en la
   vela del gatillo. Es la misma condición que usa Raptor para etiquetar. */
const alineadaEMA = (cierre, e30, e50, e100, lado) => {
  /* Sin las tres EMAs válidas no hay pila: null se coercionaría a 0 y
     dejaría pasar señales en el arranque de la serie. */
  if (!(e30 > 0) || !(e50 > 0) || !(e100 > 0)) return false;
  return lado === 'VENTA'
    ? (cierre < e30 && e30 <= e50 && e50 <= e100)
    : (cierre > e30 && e30 >= e50 && e50 >= e100);
};

const nuevaSecuencia = (lado) => ({
  lado,
  toques: [],          // { bar, nivel, extremo, alto, bajo }
  ciclo: 0,            // 0 = jugada nueva · ≥1 = repetida (reset: lleva R)
  engaño: false,
  enganoBar: -1,
  enganoNivel: null,   // mínimo (venta) / máximo (compra) del tramo del engaño
  avisados: 0,         // toques de esta secuencia que ya avisaron (1, 2, 3)
  fallo2B: null,       // modo reversion: quiebre marginal a la espera de fracasar
  retesteo: null,      // modo retesteo: quiebre a la espera de volver al nivel
});

const conReset = (base, ciclo) => {
  if (ciclo < 1) return base;
  if (base === '1') return '1R';        // la seductora reseteada
  if (base === '1E') return '1ER';      // seductora Estructura reseteada
  if (base === '2B') return '2RB';      // quiebre reseteado
  if (base === '2EB') return '2EBR';    // quiebre Estructura reseteado
  if (base === '3B') return '3RB';
  if (base === '3EB') return '3EBR';
  return base + 'R';                    // 2 → 2R · 3 → 3R (entradas) · 2E → 2ER · 3E → 3ER (avisos)
};

/**
 * Escanea una serie completa y devuelve los eventos con su barIndex.
 * Puro: mismas velas → mismos eventos. @returns {{eventos: Array, secuencias: object}}
 */
function _escanearCore(velas, opciones = {}) {
  const P = { ...PARAMS, ...opciones };
  const n = velas.length;
  const eventos = [];
  const filtros = { alineada: 0, toca: 0, supera: 0, enganoVivo: 0, caducidad: 0, cancelarSobreTecho: 0, cuerpoOk: 0, rompe: 0, sinCodigo: 0, chop: 0 };
  if (n < P.emaFondo + 5) return { eventos, secuencias: {}, filtros };

  const c = new Array(n), h = new Array(n), l = new Array(n);
  for (let i = 0; i < n; i++) { c[i] = velas[i].c; h[i] = velas[i].h; l[i] = velas[i].l; }
  const eC = ema(c, P.emaContacto);
  const eT = ema(c, P.emaTecho);
  const eF = ema(c, P.emaFondo);
  const a = atr(velas, P.atrPeriodo);

  const seq = { VENTA: nuevaSecuencia('VENTA'), COMPRA: nuevaSecuencia('COMPRA') };

  for (let i = P.emaFondo; i < n; i++) {
    const atrI = a[i];
    const E30 = eC[i], E50 = eT[i], E100 = eF[i];
    if (!(atrI > 0) || !(E30 > 0) || !(E50 > 0) || !(E100 > 0)) continue;

    for (const lado of LADOS) {
      const s = seq[lado];
      const venta = lado === 'VENTA';
      const extremo = venta ? h[i] : l[i];

      /* 1. ¿Se salió de la tendencia? (cruza la EMA50 contra el sesgo)
            El mínimo/máximo del tramo del engaño se va actualizando
            mientras dure la excursión: es el nivel que luego se quiebra. */
      const salio = venta ? c[i] > E50 : c[i] < E50;
      if (salio) {
        if (!s.engaño) { s.engaño = true; s.enganoNivel = venta ? l[i] : h[i]; }
        else s.enganoNivel = venta ? Math.min(s.enganoNivel, l[i]) : Math.max(s.enganoNivel, h[i]);
        s.enganoBar = i;   // la excursión sigue viva mientras siga fuera del techo
        /* «no superar la EMA50» aplica a toda la secuencia: si el precio se va
           al otro lado con un toque pendiente, el toque queda deshecho. Y como
           se salió y volvió, la siguiente jugada de este lado va con R. */
        if (P.cancelarSobreTecho && s.toques.length) {
          filtros.cancelarSobreTecho++;
          if (P.resetPorSalida) s.ciclo++;
          s.toques = [];
          s.avisados = 0;
        }
        s.fallo2B = null;   // el quiebre marginal deja de importar fuera del techo
        s.retesteo = null;  // el retesteo pendiente muere al salir de la tendencia
      }

      /* 1b. Modo Sperandeo: el 2B no se opera con el quiebre sino con su
            FRACASO. Si el cierre vuelve al lado del patrón, se entra al
            contrario con el stop en el extremo marginal que acaba de hacer. */
      if (P.modo2B === 'reversion' && s.fallo2B) {
        const f = s.fallo2B;
        if (venta) f.extremo = Math.min(f.extremo, l[i]);
        else f.extremo = Math.max(f.extremo, h[i]);
        const volvio = venta ? c[i] > f.nivel : c[i] < f.nivel;
        if (volvio) {
          eventos.push(evento(i, venta ? 'COMPRA' : 'VENTA', conReset('2B', s.ciclo), 'entry', c[i], f.extremo, f.nivel, P, clasificarTendencia(c[i], E30, E50, E100)));
          if (P.resetTrasEntrada) s.ciclo++;
          s.toques = []; s.avisados = 0; s.fallo2B = null; s.retesteo = null;
          /* La jugada quedó consumida: el engaño viejo no puede etiquetar
             una 1 en la secuencia siguiente. */
          s.engaño = false; s.enganoBar = -1; s.enganoNivel = null;
          continue;
        }
        if (i - f.bar > P.caducidadFallo2B) s.fallo2B = null;
      }

      /* 1c. Modo retesteo (diccionario del propietario: «quiebre + retesteo»):
            el quiebre no se opera al cierre, se espera a que el precio vuelva a
            probar el nivel y cierre otra vez del lado roto. Ahí se entra. */
      if (P.modo2B === 'retesteo' && s.retesteo) {
        const r = s.retesteo;
        const prueba = venta
          ? h[i] >= r.nivel - P.tolRetesteoAtr * atrI
          : l[i] <= r.nivel + P.tolRetesteoAtr * atrI;
        const sigueRoto = venta ? c[i] < r.nivel : c[i] > r.nivel;
        if (prueba && sigueRoto) {
          const alineadaAhora = venta
            ? (c[i] < E30 && E30 <= E50 && E50 <= E100)
            : (c[i] > E30 && E30 >= E50 && E50 >= E100);
          if (!alineadaAhora) { s.retesteo = null; continue; }
          eventos.push(evento(i, lado, conReset('2B', s.ciclo), 'entry', c[i], r.extremo, r.nivel, P, clasificarTendencia(c[i], E30, E50, E100)));
          if (P.resetTrasEntrada) s.ciclo++;
          s.toques = []; s.avisados = 0; s.retesteo = null;
          s.engaño = false; s.enganoBar = -1; s.enganoNivel = null;
          continue;
        }
        if (!sigueRoto || i - r.bar > P.caducidadRetesteo) s.retesteo = null;
        else continue;   // esperando la vuelta al nivel: la secuencia no se toca
      }

      /* 2. Tendencia comprobada: precio y EMAs alineadas en el sentido de la
            jugada. Si la estructura se invierte, el contador de reset vuelve
            a cero (jugada nueva, sin R). */
      const alineada = venta
        ? (c[i] < E30 && E30 <= E50 && E50 <= E100)
        : (c[i] > E30 && E30 >= E50 && E50 >= E100);
      if (!alineada) {
        filtros.alineada++;
        if (venta ? E30 > E50 : E30 < E50) {
          /* la estructura se invierte: jugada nueva, sin R y sin engaño vivo */
          s.toques = []; s.ciclo = 0; s.avisados = 0; s.fallo2B = null; s.retesteo = null;
          s.engaño = false; s.enganoBar = -1; s.enganoNivel = null;
        }
        continue;
      }
      /* Filtro anti-rango (chop): si las EMAs no están separadas y en pendiente,
         la tendencia es ruido lateral y no se opera. 0 = desactivado. */
      if (P.separacionMinAtr > 0 || P.pendienteMinAtr > 0) {
        const sep1 = venta ? (E50 - E30) : (E30 - E50);
        const sep2 = venta ? (E100 - E50) : (E50 - E100);
        const separacionOk = (P.separacionMinAtr <= 0)
          || (sep1 >= P.separacionMinAtr * atrI && sep2 >= P.separacionMinAtr * atrI);
        let pendienteOk = true;
        if (P.pendienteMinAtr > 0) {
          if (i >= 5 && Number.isFinite(eF[i - 5])) {
            pendienteOk = Math.abs(E100 - eF[i - 5]) >= P.pendienteMinAtr * atrI;
          } else {
            pendienteOk = false;
          }
        }
        if (!separacionOk || !pendienteOk) { filtros.chop++; continue; }
      }

      /* 3. Toque a la EMA30 que NO supera la EMA50. */
      const toca = venta
        ? (extremo >= E30 - P.tolToqueAtr * atrI && extremo <= E50 && c[i] < E30)
        : (extremo <= E30 + P.tolToqueAtr * atrI && extremo >= E50 && c[i] > E30);
      const ultimo = s.toques[s.toques.length - 1];
      /* «la dos… primer toque que supera»: sin extensión no hay 2 ni 3. */
      /* «supera el número dos» es sobre el precio (mínimo en venta, máximo en
         compra), no sobre la mecha que entra en la EMA. */
      const supera = !ultimo || !P.exigirExtension
        || (venta ? l[i] < ultimo.bajo : h[i] > ultimo.alto);
      if (!toca) filtros.toca++;
      else if (!supera) filtros.supera++;
      if (toca && supera && (!ultimo || i - ultimo.bar >= P.separacionToques)) {
        /* «el mínimo anterior»: extremo de las N velas previas al toque */
        let nivel = null;
        for (let k = Math.max(0, i - P.ventanaMin); k < i; k++) {
          if (nivel === null) nivel = venta ? l[k] : h[k];
          else nivel = venta ? Math.min(nivel, l[k]) : Math.max(nivel, h[k]);
        }
        s.toques.push({ bar: i, nivel, extremo, alto: h[i], bajo: l[i] });
        if (s.toques.length > 3) s.toques.shift();

        /* La 1, la 2 y la 3 son señales del catálogo: el toque se entrega
           como señal (precio de cierre, stop en el extremo del toque). */
        if (s.toques.length >= 2 && s.avisados !== s.toques.length) {
          s.avisados = s.toques.length;
          const codigoSenal = conReset(String(s.toques.length), s.ciclo);
          eventos.push(evento(i, lado, codigoSenal, 'entry', c[i], extremo, nivel, P, clasificarTendencia(c[i], E30, E50, E100)));
        }
      }

      /* 4. Quiebre: cierre más allá del nivel, dentro de la caducidad del
            toque. La 1 es la única que exige el engaño previo. */
      const t = s.toques[s.toques.length - 1];
      if (!t || i <= t.bar || i - t.bar > P.caducidad) { filtros.caducidad++; continue; }

      const toques = s.toques.length;
      const enganoVivo = s.engaño && (P.caducidadEngano <= 0 || i - s.enganoBar <= P.caducidadEngano);
      let base;
      if (toques >= 3) base = '3B';
      else if (toques === 2) base = '2B';
      else if (enganoVivo) base = '1';
      else { filtros.enganoVivo++; continue; }                      // 1.er toque sin engaño: no hay código (no existe 1B)

      /* La 1 rompe «el mínimo del engaño» (extremo del tramo fuera del techo),
         no el mínimo de las N velas previas al toque. */
      const nivel = base === '1' && P.nivelUnoPorEngano && Number.isFinite(s.enganoNivel)
        ? s.enganoNivel
        : t.nivel;
      if (!Number.isFinite(nivel)) continue;
      const rompe = venta ? c[i] < nivel : c[i] > nivel;
      if (!rompe) { filtros.rompe++; continue; }

      /* «con cuerpo» solo lo pide la 1: la 2B es «quebró el mínimo anterior». */
      if (base === '1' || !P.cuerpoSoloUno) {
        const cuerpo = Math.abs(c[i] - velas[i].o);
        const rango = h[i] - l[i];
        const cuerpoOk = rango > 0 && cuerpo / rango >= P.cuerpoMin && cuerpo >= P.cuerpoMinAtr * atrI;
        if (!cuerpoOk) { filtros.cuerpoOk++; continue; }
      }

      /* Modo Sperandeo: el 2B no se opera aquí; se guarda el quiebre marginal
         y se espera a que el precio vuelva al otro lado. */
      if (base === '2B' && P.modo2B === 'reversion') {
        if (!s.fallo2B && Math.abs(c[i] - nivel) <= P.margen2BAtr * atrI) {
          s.fallo2B = { bar: i, nivel, extremo: venta ? l[i] : h[i] };
        }
        continue;
      }

      /* «2B con retesteo»: el quiebre queda armado y la entrada espera la
         vuelta al nivel (se resuelve en 1c, con la caducidad del retesteo). */
      if (base === '2B' && P.modo2B === 'retesteo') {
        s.retesteo = { bar: i, nivel, extremo: t.extremo };
        continue;
      }

      const patron = conReset(base, s.ciclo);
      eventos.push(evento(i, lado, patron, 'entry', c[i], t.extremo, nivel, P, clasificarTendencia(c[i], E30, E50, E100)));

      /* jugada consumida: el siguiente patrón de esta dirección va con R
         (con resetTrasEntrada:false el R queda reservado a salir y volver) */
      if (P.resetTrasEntrada) s.ciclo++;
      s.toques = [];
      s.avisados = 0;
      s.engaño = false;
      s.enganoBar = -1;
      s.enganoNivel = null;
    }
  }

  return { eventos, secuencias: seq, filtros };
}

/* Memoización de escaneos idénticos: el mismo array y los mismos parámetros
   devuelven el mismo resultado sin re-trabajar 43k velas. No altera la
   semántica: la clave incluye longitud, última vela y parámetros. */
const _escanearCache = new WeakMap();
function escanear(velas, opciones = {}) {
  if (!Array.isArray(velas)) return _escanearCore(velas, opciones);
  const P = { ...PARAMS, ...opciones };
  const n = velas.length;
  const last = n ? velas[n - 1] : null;
  const stamp = `${n}|${last ? last.t : ''}|${last ? last.c : ''}|${JSON.stringify(P)}`;
  const entry = _escanearCache.get(velas);
  if (entry && entry.stamp === stamp) return entry.result;
  const result = _escanearCore(velas, opciones);
  _escanearCache.set(velas, { stamp, result });
  return result;
}

/* ---------------- estrategia Estructura (impulso + retroceso + quiebre, con puerta EMA) ----------------

   Estrategia paralela a la de Yoel. La estructura detecta impulso, retroceso
   y quiebre, pero solo emite si la pila EMA30/50/100 está alineada en la vela
   del gatillo (quiebre o toque).

   Impulso  = movimiento fuerte en la dirección de la tendencia (≥ estructuraImpulsoMinATR ATR)
   Origen   = extremo opuesto al impulso (techo: el retroceso no lo supera)
   Extremo  = punta del impulso
   Retoceso = pullback que no supera el origen (≤ estructuraRetrocesoMaxATR ATR)
   Toque    = pico del retroceso (contacto)
   Quiebre  = cierre más allá del mínimo/máximo del retroceso en la dirección del impulso

   Códigos: 1E (seductora), 2E/3E (avisos), 2EB/3EB (entradas con quiebre).
   --------------------------------------------------------------------------- */

const nuevaSecuenciaEstructura = (lado) => ({
  lado,
  toques: [],          // { bar, nivel (break level), extremo (contact peak), alto, bajo }
  ciclo: 0,            // 0 = jugada nueva · ≥1 = repetida (lleva R)
  impulso: false,      // si hay un impulso activo
  impulsoBar: -1,      // barra donde se detectó el impulso
  impulsoOrigen: null, // techo del retroceso (high para VENTA, low para COMPRA)
  impulsoExtremo: null,// punta del impulso (low para VENTA, high para COMPRA)
  retracementPeak: null,// pico del retroceso actual (high para VENTA, low para COMPRA)
  ultimaEntradaBar: -1e9,// enfriamiento: evita reentrar en la vela siguiente
});

/**
 * Detecta si en la barra `i` (mirando hacia atrás hasta `maxVelas`) se formó
 * un impulso válido en la dirección indicada. Devuelve { origen, extremo, bar }
 * o null.
 */
function detectarImpulsoEstructura(velas, i, venta, P, a) {
  const atrI = a[i];
  if (!(atrI > 0)) return null;
  const minVelas = Math.max(1, P.estructuraMinVelasImpulso);
  const maxVelas = Math.max(minVelas, P.estructuraMaxVelasImpulso);
  const ventana = P.estructuraVentanaEstructura;
  if (i - ventana + 1 < 0) return null;
  for (let len = minVelas; len <= maxVelas; len++) {
    const inicio = i - len + 1;
    if (inicio < 0) break;
    let maxH = velas[inicio].h, minL = velas[inicio].l;
    for (let j = inicio + 1; j <= i; j++) {
      if (velas[j].h > maxH) maxH = velas[j].h;
      if (velas[j].l < minL) minL = velas[j].l;
    }
    const movimiento = maxH - minL;
    if (movimiento < P.estructuraImpulsoMinATR * atrI) continue;
    // cuerpo: suma de cuerpos en la dirección del impulso
    let bodySum = 0;
    for (let j = inicio; j <= i; j++) bodySum += Math.abs(velas[j].c - velas[j].o);
    const ratio = movimiento > 0 ? bodySum / movimiento : 0;
    if (ratio < P.estructuraCuerpoImpulso) continue;
    // dirección: el cierre final debe estar en la dirección del impulso
    const direccionOk = venta ? (velas[i].c < velas[inicio].o) : (velas[i].c > velas[inicio].o);
    if (!direccionOk) continue;
    /* El impulso tiene que hacer un extremo NUEVO de la ventana: así una vela
       fuerte dentro de un rango no se confunde con una pierna de tendencia. */
    let extremoVentana = venta ? Infinity : -Infinity;
    for (let j = i - ventana + 1; j <= i; j++) {
      extremoVentana = venta ? Math.min(extremoVentana, velas[j].l) : Math.max(extremoVentana, velas[j].h);
    }
    const extremo = venta ? minL : maxH;
    if (venta ? extremo > extremoVentana : extremo < extremoVentana) continue;
    return {
      bar: i,
      origen: venta ? maxH : minL,
      extremo,
    };
  }
  return null;
}

/**
 * Escanea una serie completa con la estrategia Estructura.
 * Puro: mismas velas → mismos eventos.
 */
function escanearEstructura(velas, opciones = {}) {
  const P = { ...PARAMS, ...opciones };
  const n = velas.length;
  const eventos = [];
  const filtros = { sinImpulso: 0, sobreTecho: 0, retrocesoInvalido: 0, sinReversion: 0, caducidad: 0, noRompe: 0, sinAlineacion: 0 };
  if (n < P.atrPeriodo + 5) return { eventos, secuencias: {}, filtros };

  const c = new Array(n), h = new Array(n), l = new Array(n);
  for (let i = 0; i < n; i++) { c[i] = velas[i].c; h[i] = velas[i].h; l[i] = velas[i].l; }
  const a = atr(velas, P.atrPeriodo);
  const e30 = ema(c, P.emaContacto), e50 = ema(c, P.emaTecho), e100 = ema(c, P.emaFondo);

  const seq = { VENTA: nuevaSecuenciaEstructura('VENTA'), COMPRA: nuevaSecuenciaEstructura('COMPRA') };

  for (let i = P.atrPeriodo; i < n; i++) {
    const atrI = a[i];
    if (!(atrI > 0)) continue;

    for (const lado of LADOS) {
      const s = seq[lado];
      const venta = lado === 'VENTA';
      const extremo = venta ? h[i] : l[i];
      const cierre = c[i];

      /* 1. Detectar impulso solo cuando no hay uno activo. Si se reescribiera
            en cada vela de una tendencia sostenida, el retroceso nunca llegaría
            a formarse (cada vela reiniciaría el pico) y no habría señales. */
      let impulsoDetectado = false;
      if (!s.impulso && i - s.ultimaEntradaBar >= P.estructuraEspera) {
        const imp = detectarImpulsoEstructura(velas, i, venta, P, a);
        if (imp) {
          s.impulso = true;
          s.impulsoBar = i;
          s.impulsoOrigen = imp.origen;
          s.impulsoExtremo = imp.extremo;
          s.retracementPeak = null;
          impulsoDetectado = true;
        }
      }

      if (!s.impulso) { filtros.sinImpulso++; continue; }
      /* La vela que forma el impulso no es un retroceso: su propio rango no
         puede sembrar el pico del pullback. */
      if (impulsoDetectado) continue;

      /* 2. Techo: si el precio supera el origen del impulso, la tendencia se rompe.
            Se permite un margen de 0.2 ATR para no cancelar por una mecha. */
      const margenTecho = 0.3 * atrI;
      const sobreTecho = venta ? cierre > s.impulsoOrigen + margenTecho : cierre < s.impulsoOrigen - margenTecho;
      if (sobreTecho) {
        filtros.sobreTecho++;
        s.impulso = false;
        s.impulsoBar = -1;
        s.impulsoOrigen = null;
        s.impulsoExtremo = null;
        s.retracementPeak = null;
        s.toques = [];
        s.ciclo = 0;
        continue;
      }

      /* 3. Quiebre: con un toque vivo, el cierre más allá de su nivel entra
            ANTES de actualizar la punta del impulso (la vela del quiebre suele
            hacer también un mínimo/máximo nuevo y, si no, se perdería). */
      const t = s.toques[s.toques.length - 1];
      if (t && i > t.bar) {
        if (i - t.bar > P.estructuraCaducidad) {
          filtros.caducidad++;
          s.toques = [];
          s.impulso = false;        // la jugada caducó: se busca estructura nueva
          s.retracementPeak = null;
          continue;
        }
        const nivel = t.nivel;
        const rompe = Number.isFinite(nivel) && (venta ? cierre < nivel : cierre > nivel);
        if (!rompe) {
          filtros.noRompe++;
        } else {
          const base = s.toques.length >= 3 ? '3EB' : s.toques.length === 2 ? '2EB' : '1E';
          /* Puerta EMA: la estructura solo emite si la pila está alineada en
             la vela del quiebre. Si no, la jugada se consume igual. */
          const alineada = alineadaEMA(cierre, e30[i], e50[i], e100[i], lado);
          if (alineada) {
            eventos.push(evento(i, lado, conReset(base, s.ciclo), 'entry', c[i], t.extremo, nivel, P, clasificarTendencia(c[i], e30[i], e50[i], e100[i])));
          } else {
            filtros.sinAlineacion++;
          }
          s.ciclo++;
          s.ultimaEntradaBar = i;
          s.toques = [];
          s.impulso = false;
          s.impulsoBar = -1;
          s.impulsoOrigen = null;
          s.impulsoExtremo = null;
          s.retracementPeak = null;
          continue;
        }
      }

      /* 4. Continuación: si la vela hace una punta nueva en la dirección del
            impulso, la pierna sigue y no hay retroceso que valga. */
      const nuevaPunta = venta ? l[i] < s.impulsoExtremo : h[i] > s.impulsoExtremo;
      if (nuevaPunta) {
        s.impulsoExtremo = venta ? l[i] : h[i];
        s.impulsoBar = i;
        s.retracementPeak = null;
        continue;
      }

      /* 4. Retroceso: el precio se aleja de la punta del impulso sin superar su
            origen. Se guarda el pico del retroceso (contacto) para medirlo y
            para colocar la invalidación de la entrada. */
      const enRetroceso = venta
        ? (extremo > s.impulsoExtremo && extremo <= s.impulsoOrigen)
        : (extremo < s.impulsoExtremo && extremo >= s.impulsoOrigen);
      if (enRetroceso) {
        if (s.retracementPeak === null) s.retracementPeak = extremo;
        else if (venta) s.retracementPeak = Math.max(s.retracementPeak, extremo);
        else s.retracementPeak = Math.min(s.retracementPeak, extremo);
      }

      /* 4. Fin del retroceso: primera vela que cierra en la dirección del
            impulso. Ahí se registra el toque y el retroceso se consume, para
            que un toque nuevo exija un retroceso nuevo (no uno cada 2 velas). */
      const reversing = venta ? (i >= 1 && c[i] < c[i - 1]) : (i >= 1 && c[i] > c[i - 1]);

      const retraccionSize = s.retracementPeak !== null
        ? (venta ? s.retracementPeak - s.impulsoExtremo : s.impulsoExtremo - s.retracementPeak)
        : 0;
      const retraccionValida = retraccionSize >= P.estructuraRetrocesoMinATR * atrI
        && retraccionSize <= P.estructuraRetrocesoMaxATR * atrI;
      if (s.retracementPeak !== null && !retraccionValida) filtros.retrocesoInvalido++;

      const ultimo = s.toques[s.toques.length - 1];
      /* Cada toque debe superar al anterior (retroceso más profundo) y guardar
         la separación mínima, igual que la rejilla de Yoel. */
      const superaAlAnterior = !ultimo
        || (venta ? s.retracementPeak > ultimo.extremo : s.retracementPeak < ultimo.extremo);
      const esNuevoToque = s.retracementPeak !== null && retraccionValida && reversing
        && (!ultimo || (i - ultimo.bar >= P.separacionToques && superaAlAnterior));
      if (s.retracementPeak !== null && retraccionValida && !reversing) filtros.sinReversion++;

      if (esNuevoToque) {
        const nivelQuiebre = s.impulsoExtremo;    // nivel a romper: punta del impulso
        const contacto = s.retracementPeak;       // pico del retroceso: invalidación
        s.toques.push({ bar: i, nivel: nivelQuiebre, extremo: contacto, alto: contacto, bajo: nivelQuiebre });
        if (s.toques.length > 3) s.toques.shift();
        s.retracementPeak = null;                 // retroceso consumido

        /* La 1E, la 2E y la 3E son señales: el toque se entrega como señal. */
        if (s.toques.length >= 2) {
          const codigo = s.toques.length === 2 ? conReset('2E', s.ciclo) : conReset('3E', s.ciclo);
          /* La 2E/3E también es señal: solo sale con la pila alineada en el
             toque. El toque se conserva para un quiebre posterior. */
          const alineada = alineadaEMA(c[i], e30[i], e50[i], e100[i], lado);
          if (alineada) {
            eventos.push(evento(i, lado, codigo, 'entry', c[i], contacto, nivelQuiebre, P, clasificarTendencia(c[i], e30[i], e50[i], e100[i])));
          } else {
            filtros.sinAlineacion++;
          }
        }
      }

    }
  }

  return { eventos, secuencias: seq, filtros };
}

/* Evento normalizado: lo que consume app.js y el formateador de Telegram. */
function evento(barIndex, lado, patron, tipo, precio, invalida, nivel, P, tendencia) {
  return {
    barIndex, lado, patron, tipo,
    precio,                                  // cierre de la vela de la señal
    invalida: Number.isFinite(invalida) ? invalida : null,   // extremo del toque
    nivelRoto: Number.isFinite(nivel) ? nivel : null,
    tendencia: tendencia || null,            // ALCISTA / BAJISTA / LATERAL (EMA30/50/100)
    ventanaMin: P.ventanaMin,
  };
}

/* ---------------- motor en vivo ---------------- */

class Nucleo extends EventEmitter {
  constructor(opciones = {}) {
    super();
    this.p = { ...PARAMS, ...opciones.parametros };
    this.tfs = opciones.tfs || TF_ESCANEO;
    this.soloRayas = !!opciones.soloRayas;
    /* El motor puede bloquear el lado contrario por vela; el bot lo desactiva
       y lo hace en la capa de envío, después de los filtros de tendencia. */
    this.bloqueoLado = opciones.bloqueoLado !== false;
    /* Modo de anclaje del histórico guardado. Si cambia, se descarta la
       serie persistida para no mezclar precios anclados con precios crudos. */
    this.anclaje = opciones.anclaje !== false;
    this.s = new Map();
    this.total = 0;
    this.stats = { emitidas: 0, velasViejas: 0, reevaluadas: 0, errores: 0, revisionesContradictorias: 0, filtros: { yoel: {}, estructura: {} } };
    this._emitidos = new Set();
    this._evalPorVela = new Map();
    /* Claves de evalPorVela que venían del disco al arrancar: se usan para no
       enviar señales de velas históricas en un arranque en frío. */
    this._evalPrevio = new Set();
    this._tArranque = Date.now();
    this._ultimoGuardado = Date.now();
    /* Una vela solo puede emitir un LADO. Si el bróker revisa el cierre, o la
       vela de ticks y la del servidor no coinciden, no se manda la contraria:
       se registra y se descarta. Evita el «primero COMPRA, luego VENTA». */
    this._ladoPorVela = new Map();
    this._senales = new Map();   // simbolo|tf -> últimas señales RAPTOR (patrón, lado, barIndex, precio)
    /* TF de referencia para la tendencia mayor. Por defecto H1: es el que
       mira el operador y evita que un M1 compre dentro de un H1 bajista. */
    this.tfTendencia = (opciones.tfTendencia || process.env.MS_TF_TENDENCIA || 'H1').toUpperCase();
    this._emaRef = new Map();    // simbolo|tf -> { n, ultimoT, e30, e50, e100 }
    this._margenSeguridadMs = 3000;   // cierre confirmado, no el primer tick
    // persistencia en disco: evita re-descargar 30 días en cada arranque
    this.archivoPersistencia = (opciones.archivoPersistencia === undefined)
      ? path.join(__dirname, '.estado.json')
      : (opciones.archivoPersistencia || null);
    this._guardarTimer = null;
    this._dirty = false;
    this._cargar();
    this._timer = setInterval(() => this._cerrarExpiradas(), 1000);
    this._timer.unref?.();
  }

  destruir() {
    if (this._guardarTimer) { clearTimeout(this._guardarTimer); this._guardarTimer = null; }
    this.guardar();
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  _cargar() {
    if (!this.archivoPersistencia) return;
    try {
      const j = JSON.parse(fs.readFileSync(this.archivoPersistencia, 'utf8'));
      if (!j || typeof j !== 'object') return;
      /* Si el estado se guardó con otro modo de anclaje, se descarta la
         serie de precios para no mezclar niveles; se conservan
         evalPorVela/ladoPorVela para no reemitir velas históricas. */
      const seriesCompatibles = (j.anclaje !== false) === this.anclaje;
      if (!seriesCompatibles && j.simbolo && typeof j.simbolo === 'object') {
        for (const e of Object.values(j.simbolo)) {
          if (e && typeof e === 'object') { e.velas = {}; e.cur = {}; }
        }
      }
      const corte = Date.now() - this.p.retencionDias * 86400 * 1000;
      if (j.simbolo && typeof j.simbolo === 'object') {
        for (const [simbolo, e] of Object.entries(j.simbolo)) {
          const est = this._estado(simbolo);
          if (e && e.velas && typeof e.velas === 'object') {
            for (const tf of Object.keys(TFS)) {
              const arr = Array.isArray(e.velas[tf]) ? e.velas[tf] : [];
              const max = this._maxVelas(tf);
              const serie = arr
                .filter((v) => velaValida(v) && v.t >= corte)
                .slice(-max)
                .map((v) => ({ t: v.t, o: v.o, h: v.h, l: v.l, c: v.c, fuente: v.fuente || 'server' }));
              /* Descarta bloques de otro instrumento que el terminal haya
                 podido mezclar en la misma serie (salto > 5% entre cierres).
                 Si una vela se salta, la siguiente se compara contra el último
                 cierre VÁLIDO: un campo ausente no corta el resto de la serie. */
              const limpio = [];
              for (const v of serie) {
                if (!limpio.length) { limpio.push(v); continue; }
                const ref = limpio[limpio.length - 1].c;
                if (!Number.isFinite(ref) || ref <= 0) continue;
                if (Math.abs(v.c - ref) / ref > 0.05) continue;
                limpio.push(v);
              }
              est.velas[tf] = limpio;
            }
          }
          if (e && e.cur && typeof e.cur === 'object') {
            for (const tf of Object.keys(TFS)) {
              const c = e.cur[tf];
              est.cur[tf] = (c && Number.isFinite(c.t)) ? { t: c.t, o: c.o, h: c.h, l: c.l, c: c.c } : null;
            }
          }
          if (e && Number.isFinite(e.ahora)) est.ahora = e.ahora;
        }
      }
      if (j.evalPorVela && typeof j.evalPorVela === 'object') {
        for (const [k, v] of Object.entries(j.evalPorVela)) {
          const t = Number(String(k).split('|')[2]);
          if (Number.isFinite(t) && t >= corte) { this._evalPorVela.set(k, v); this._evalPrevio.add(k); }
        }
      }
      if (j.ladoPorVela && typeof j.ladoPorVela === 'object') {
        for (const [k, v] of Object.entries(j.ladoPorVela)) {
          const t = Number(String(k).split('|')[2]);
          if (Number.isFinite(t) && t >= corte && (v === 'COMPRA' || v === 'VENTA')) {
            this._ladoPorVela.set(k, v);
          }
        }
      }
    } catch (e) {
      // primer arranque o fichero corrupto: se ignora
    }
  }

  guardar() {
    if (!this.archivoPersistencia) return false;
    /* Si el destino aún no existe (primer arranque o fichero temporal de
       auditoría), se escribe igual aunque no haya cambios registrados. */
    if (!this._dirty && fs.existsSync(this.archivoPersistencia)) return true;
    try {
      const corte = Date.now() - this.p.retencionDias * 86400 * 1000;
      const simbolo = {};
      for (const [s, e] of this.s) {
        simbolo[s] = { velas: {}, cur: {}, ahora: e.ahora };
        for (const tf of Object.keys(TFS)) {
          const max = this._maxVelas(tf);
          simbolo[s].velas[tf] = (e.velas[tf] || [])
            .filter((v) => v && Number.isFinite(v.t) && v.t >= corte)
            .slice(-max)
            .map((v) => ({ t: v.t, o: v.o, h: v.h, l: v.l, c: v.c, fuente: v.fuente || 'server' }));
          const c = e.cur[tf];
          simbolo[s].cur[tf] = (c && Number.isFinite(c.t)) ? { t: c.t, o: c.o, h: c.h, l: c.l, c: c.c } : null;
        }
      }
      const evalPorVela = {};
      for (const [k, v] of this._evalPorVela) {
        const t = Number(String(k).split('|')[2]);
        if (!Number.isFinite(t) || t >= corte) evalPorVela[k] = v;
      }
      const ladoPorVela = {};
      for (const [k, lado] of this._ladoPorVela) {
        const t = Number(String(k).split('|')[2]);
        if (Number.isFinite(t) && t >= corte) ladoPorVela[k] = lado;
      }
      const j = { version: 2, guardado: Date.now(), anclaje: this.anclaje, simbolo, evalPorVela, ladoPorVela };
      const tmp = `${this.archivoPersistencia}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(j), { mode: 0o600 });
      fs.renameSync(tmp, this.archivoPersistencia);
      this._ultimoGuardado = Date.now();
      this._dirty = false;
      return true;
    } catch (e) {
      return false;
    }
  }

  /* Guardado con freno. El estado pesa ~20 MB y serializarlo bloquea el event
     loop ~0,6 s: reescribirlo en cada vela M1 era ~28 GB/día de flash. Ahora
     como mucho una vez cada MS_GUARDAR_MS (10 min por defecto) y siempre en
     SIGTERM/fallo fatal, que es cuando importa no perder la cola. */
  _guardarDebounced() {
    if (!this.archivoPersistencia) return;
    const intervalo = Number(process.env.MS_GUARDAR_MS) || 10 * 60 * 1000;
    const falta = intervalo - (Date.now() - this._ultimoGuardado);
    if (falta <= 0) {
      this._ultimoGuardado = Date.now();
      this.guardar();
      return;
    }
    if (this._guardarTimer) return;
    this._guardarTimer = setTimeout(() => {
      this._guardarTimer = null;
      this._ultimoGuardado = Date.now();
      this.guardar();
    }, falta);
    this._guardarTimer.unref?.();
  }

  _estado(simbolo) {
    let e = this.s.get(simbolo);
    if (!e) {
      const velas = {}, cur = {};
      for (const tf of Object.keys(TFS)) { velas[tf] = []; cur[tf] = null; }
      e = { velas, cur, ahora: 0 };
      this.s.set(simbolo, e);
    }
    return e;
  }

  _maxVelas(tf) { return Math.ceil((this.p.retencionDias * 86400) / (TFS[tf] || 900)); }

  setHistoria(simbolo, tf, velas) {
    const e = this._estado(simbolo);
    const seg = TFS[tf] || 0;
    /* Una vela con OHLC incoherente envenena las EMAs/ATR de toda la cola. */
    const arr = velas.filter(velaValida).slice(-this._maxVelas(tf));
    /* la vela EN FORMACIÓN del bróker no entra en la serie, pero alimenta el
       acumulador de ticks (apertura/máximo/mínimo reales, no el 1.er tick) */
    let formando = null;
    while (arr.length && seg && arr[arr.length - 1].t + seg * 1000 > Date.now()) formando = arr.pop();
    /* El lote del bróker llega 1-2 velas por detrás del feed de ticks. Si se
       reemplazara la serie tal cual, cada refresco BORRARÍA cierres ya
       construidos con ticks y el motor evaluaría velas de hace un minuto o
       dos (las señales salían atrasadas por esto, no por la conexión).
       Se conservan los cierres que ya teníamos y que el lote aún no incluye;
       en el solape sigue mandando el bróker, que es quien corrige revisiones. */
    const previasSerie = e.velas[tf] || [];
    if (previasSerie.length) {
      const ultimoServidor = arr.length ? arr[arr.length - 1].t : -Infinity;
      for (const v of previasSerie) {
        if (v.t > ultimoServidor && seg && v.t + seg * 1000 <= Date.now()) arr.push(v);
      }
    }
    /* En el solape manda el bróker porque corrige revisiones, pero NO cuando se
       ha ido de nivel: una vela ya cerrada con ticks es el precio que se pudo
       operar. Si el lote se separa más de TOL_TICK_SERVIDOR se conserva la de
       ticks, que es la que coincide con el gráfico del terminal. */
    const guardadasPorT = new Map(previasSerie.map((v) => [v.t, v]));
    e.velas[tf] = arr.map((v) => {
      const fuente = v.fuente || 'server';
      const prev = guardadasPorT.get(v.t);
      if (fuente !== 'tick' && prev && prev.fuente === 'tick'
          && prev.c > 0 && Math.abs(v.c - prev.c) / prev.c > TOL_TICK_SERVIDOR) {
        const claveAviso = `${simbolo}|${tf}`;
        const ahoraMs = Date.now();
        if (ahoraMs - (_avisoTolerancia.get(claveAviso) || 0) > 600000) {
          _avisoTolerancia.set(claveAviso, ahoraMs);
          this.emit('aviso', `${simbolo} ${tf}: el bróker se separa ${((Math.abs(v.c - prev.c) / prev.c) * 100).toFixed(2)} % de la vela de ticks de ${new Date(v.t).toISOString().slice(11, 16)} — se conserva la de ticks`);
        }
        return prev;
      }
      return { ...v, fuente };
    });
    if (formando) this._absorberFormando(simbolo, tf, formando);
    const ult = arr.length ? arr[arr.length - 1] : null;
    if (ult) {
      const skew = Date.now() - (ult.t + seg * 1000);
      if (Math.abs(skew) > Math.max(120000, seg * 2000)) {
        this.emit('aviso', `RELOJ ${simbolo} ${tf}: última vela cerró hace ${Math.round(skew / 1000)} s según el VPS (skew ${Math.round(skew / 1000)} s) — sincroniza NTP (timedatectl)`);
      }
    }
    if (ult && ult.t > e.ahora) e.ahora = ult.t;
    const scan = this._escanear(simbolo, tf, arr);
    this._poblarSenales(simbolo, tf, arr, scan);
    if (ult) this._evaluarSiNuevo(simbolo, tf, ult, scan);
    this._dirty = true;
    this._guardarDebounced();
  }

  _absorberFormando(simbolo, tf, v) {
    if (!velaValida(v)) return;
    const e = this._estado(simbolo);
    const c = e.cur[tf];
    /* El histórico del WebTerminal es OTRA serie que su stream de ticks, así
       que la vela en formación del bróker fijaba la apertura en un nivel que
       el mercado nunca tocó (16:17 abría en 110.089 con el precio real en
       110.216) y el hueco quedaba dentro de la vela cerrada. Si la vela del
       bróker discrepa del tick, la arman los ticks y se descarta la del bróker. */
    if (c && Number.isFinite(c.c) && c.c > 0 && Number.isFinite(v.c)) {
      if (Math.abs(v.c - c.c) / c.c > 0.0005) return;
    }
    if (!c || c.t < v.t) { e.cur[tf] = { ...v }; return; }
    if (c.t > v.t) return;
    e.cur[tf] = {
      t: v.t, o: c.o,
      h: Math.max(v.h, c.h), l: Math.min(v.l, c.l),
      c: Number.isFinite(c.c) ? c.c : v.c,
    };
  }

  _evaluarSiNuevo(simbolo, tf, vela, resPre = null) {
    const seg = TFS[tf] || 300;
    const edad = Date.now() - (vela.t + seg * 1000);
    if (edad < -60000) { this.stats.velasViejas++; this.emit('aviso', `VELA EN EL FUTURO ${simbolo} ${tf}: ${Math.round(-edad / 1000)} s — reloj del VPS atrasado o NTP desincronizado`); return; }
    if (edad > Math.max(120000, seg * 2000)) { this.stats.velasViejas++; this.emit('aviso', `VELA VIEJA ${simbolo} ${tf}: ${Math.round(edad / 1000)} s de antigüedad`); return; }
    const clave = `${simbolo}|${tf}|${vela.t}`;
    const firma = `${vela.o}|${vela.h}|${vela.l}|${vela.c}`;
    const previa = this._evalPorVela.get(clave);
    if (previa === firma) return;
    if (previa !== undefined) this.stats.reevaluadas++;
    this._evalPorVela.set(clave, firma);
    this._evaluar(simbolo, tf, this._estado(simbolo).velas[tf], resPre);
  }

  senalesRecientes(simbolo, tf) {
    return this._senales.get(`${simbolo}|${tf}`) || [];
  }

  historia(simbolo) {
    const e = this.s.get(simbolo);
    if (!e) return null;
    const velas = {};
    for (const tf of Object.keys(TFS)) velas[tf] = e.velas[tf];
    return velas;
  }

  onTick(simbolo, bid, ask, t = Date.now()) {
    const precio = (bid + ask) / 2;
    const e = this._estado(simbolo);
    for (const [tf, seg] of Object.entries(TFS)) {
      const t0 = Math.floor(t / (seg * 1000)) * seg * 1000;
      let c = e.cur[tf];
      if (!c || c.t !== t0) c = e.cur[tf] = { t: t0, o: precio, h: precio, l: precio, c: precio };
      else {
        if (precio > c.h) c.h = precio;
        if (precio < c.l) c.l = precio;
        c.c = precio;
      }
    }
  }

  sembrarEmitidas(claves = []) {
    if (claves && claves.length) this._dirty = true;
    for (const raw of claves) {
      const k = String(raw);
      this._emitidos.add(k);
      /* clave = simbolo|tf|t|tipo|lado|patron */
      const p = k.split('|');
      if (p.length >= 5 && Number.isFinite(Number(p[2]))
          && (p[4] === 'COMPRA' || p[4] === 'VENTA')) {
        this._ladoPorVela.set(`${p[0]}|${p[1]}|${p[2]}`, p[4]);
      }
    }
  }

  /* Devuelve true si la vela todavía no tenía lado o repite el mismo lado;
     false si ya emitió el lado contrario. La primera llamada fija el lado. */
  _puedeEmitirLado(simbolo, tf, t, lado) {
    const k = `${simbolo}|${tf}|${t}`;
    const previo = this._ladoPorVela.get(k);
    if (previo && previo !== lado) return false;
    if (!previo) this._ladoPorVela.set(k, lado);
    return true;
  }

  onVelaCerrada(simbolo, tf, vela) {
    if (!this.tfs.includes(tf)) return;
    if (!velaValida(vela)) { this.emit('aviso', `vela inválida ${simbolo} ${tf} descartada`); return; }
    const clave = `${simbolo}|${tf}|${vela.t}`;
    const firma = `${vela.o}|${vela.h}|${vela.l}|${vela.c}`;
    if (this._evalPorVela.get(clave) === firma) return;
    const fuente = vela.fuente || 'server';
    const e = this._estado(simbolo);
    const arr = e.velas[tf];
    if (arr.length && arr[arr.length - 1].t >= vela.t) {
      const i = arr.findIndex((v) => v.t === vela.t);
      if (i < 0) return;
      /* La vela del servidor manda: una vela construida con ticks no puede
         pisar el OHLC oficial y cambiar la señal después de enviarla. */
      if ((arr[i].fuente || 'server') === 'server' && fuente === 'tick') return;
      arr[i] = { ...vela, fuente };
      this._evalPorVela.set(clave, firma);
      if (i === arr.length - 1) { this.stats.reevaluadas++; this._evaluar(simbolo, tf, arr); }
      this._dirty = true; this._guardarDebounced();
      return;
    }
    if (vela.t > e.ahora) e.ahora = vela.t;
    arr.push({ ...vela, fuente });
    this._evalPorVela.set(clave, firma);
    if (arr.length > this._maxVelas(tf)) arr.shift();
    this._evaluar(simbolo, tf, arr);
    this._dirty = true; this._guardarDebounced();
    this.emit('vela', { simbolo, tf, vela });
  }

  _cerrarExpiradas() {
    const ahora = Date.now() - this._margenSeguridadMs;
    for (const [simbolo, e] of this.s) {
      for (const [tf, c] of Object.entries(e.cur)) {
        if (!c) continue;
        const seg = TFS[tf] || 0;
        if (seg && c.t + seg * 1000 <= ahora) {
          const cerrada = { ...c, fuente: 'tick' };
          e.cur[tf] = null;
          this.onVelaCerrada(simbolo, tf, cerrada);
        }
      }
    }
  }

  /* Tendencia del TF mayor en el momento del cierre de la señal. Se cachean
     las EMAs del TF de referencia y solo se recalculan cuando llega una vela
     nueva; así el escaneo de M1 no paga tres EMAs de H1 por minuto. */
  _tendenciaMayor(simbolo, tCierre) {
    const ref = this.tfTendencia;
    const e = this.s.get(simbolo);
    const arr = e && e.velas ? e.velas[ref] : null;
    if (!arr || arr.length < this.p.emaFondo + 5) return null;
    const seg = TFS[ref] || 3600;
    let lo = 0, hi = arr.length - 1, k = -1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (arr[m].t + seg * 1000 <= tCierre) { k = m; lo = m + 1; }
      else hi = m - 1;
    }
    if (k < this.p.emaFondo) return null;
    const clave = `${simbolo}|${ref}`;
    let c = this._emaRef.get(clave);
    const ultimoT = arr[arr.length - 1].t;
    const ultimoC = arr[arr.length - 1].c;
    /* El cierre también entra en la firma: una revisión del bróker puede
       dejar el mismo número de velas y la misma hora, pero cambiar el EMA. */
    if (!c || c.n !== arr.length || c.ultimoT !== ultimoT || c.ultimoC !== ultimoC) {
      const cierres = arr.map((v) => v.c);
      c = {
        n: arr.length, ultimoT, ultimoC,
        e30: ema(cierres, this.p.emaContacto),
        e50: ema(cierres, this.p.emaTecho),
        e100: ema(cierres, this.p.emaFondo),
      };
      this._emaRef.set(clave, c);
    }
    return {
      tf: ref,
      tendencia: clasificarTendencia(arr[k].c, c.e30[k], c.e50[k], c.e100[k]),
      t: arr[k].t,
    };
  }

  /* Un solo escaneo por (símbolo, TF, serie). Antes setHistoria lo hacía dos
     veces (poblar la gráfica + evaluar) y el M1 de 30 días costaba ~130 ms
     cada uno. */
  _escanear(simbolo, tf, arr) {
    let resYoel;
    try {
      resYoel = escanear(arr, this.p);
      if (resYoel.filtros) this.stats.filtros.yoel = resYoel.filtros;
    } catch (err) {
      this.stats.errores++;
      this.emit('aviso', `núcleo ${simbolo} ${tf}: ${err.message}`);
      return null;
    }
    let resEstructura = null;
    if (tf === 'M5') {
      try {
        resEstructura = escanearEstructura(arr, this.p);
        if (resEstructura && resEstructura.filtros) this.stats.filtros.estructura = resEstructura.filtros;
      } catch (err) {
        this.stats.errores++;
        this.emit('aviso', `núcleo ${simbolo} ${tf}: ${err.message}`);
      }
    }
    return { resYoel, resEstructura };
  }

  _evaluar(simbolo, tf, arr, resPre = null) {
    if (!arr.length) return;
    const pre = resPre || this._escanear(simbolo, tf, arr);
    if (!pre) return;
    const res = { eventos: [...(pre.resYoel.eventos || []), ...(pre.resEstructura ? pre.resEstructura.eventos : [])] };
    const ultima = arr.length - 1;
    /* Guardar TODAS las señales RAPTOR del historial para el render de la
       gráfica (no solo la última vela). Se reconstruye en cada evaluación
       para mantenerse sincronizado con la historia. */
    const __kSen = simbolo + '|' + tf;
    const __arrSen = [];
    for (const __ev of (res.eventos || [])) {
      if (__ev.tipo !== 'entry') continue;
      if (!Number.isFinite(__ev.precio) || __ev.precio <= 0) continue;
      if (!Number.isFinite(__ev.barIndex) || __ev.barIndex < 0 || __ev.barIndex >= arr.length) continue;
      __arrSen.push({ patron: __ev.patron, lado: __ev.lado, barIndex: __ev.barIndex, t: arr[__ev.barIndex].t, precio: __ev.precio });
    }
    if (__arrSen.length > 50000) __arrSen.splice(0, __arrSen.length - 50000);
    this._senales.set(__kSen, __arrSen);
    const seg = TFS[tf] || 300;
    const tCierre = arr[ultima].t + seg * 1000;
    const emitidaEn = Date.now();
    const latenciaMs = emitidaEn - tCierre;

    /* Una sola señal por vela y lado. En M5 pueden coincidir Yoel y
       Estructura en la misma barra (16 casos en 30 días); mandar las dos
       duplica el mensaje y confunde la operación. Se elige la de mayor
       prioridad: entrada > aviso y, dentro de la entrada, tier A > B > C. */
    const porLado = new Map();
    for (const ev of res.eventos) {
      if (ev.barIndex !== ultima) continue;
      if (ev.tipo !== 'entry') continue;
      if (!Number.isFinite(ev.precio) || ev.precio <= 0) continue;
      const prev = porLado.get(ev.lado);
      if (!prev || prioridadEvento(ev) > prioridadEvento(prev)) porLado.set(ev.lado, ev);
    }
    const claveDe = (ev) => `${simbolo}|${tf}|${arr[ultima].t}|${ev.tipo}|${ev.lado}|${ev.patron}`;
    /* El patrón descartado de esta vela/lado queda marcado: no puede salir
       después por una revisión del bróker. La gráfica conserva ambos. */
    for (const [lado, ganador] of porLado) {
      for (const otro of res.eventos) {
        if (otro === ganador) continue;
        if (otro.barIndex !== ultima || otro.lado !== lado) continue;
        if (!Number.isFinite(otro.precio) || otro.precio <= 0) continue;
        this._emitidos.add(claveDe(otro));
      }
    }

    for (const ev of porLado.values()) {
      /* Arranque en frío: si la vela cerró antes de que este proceso existiera
         y no estaba evaluada en el estado persistido, es histórica. Se guarda
         para la gráfica pero no se manda como señal. Una revisión de una vela
         ya conocida sí puede reemitirse. */
      const conocida = this._evalPrevio.has(`${simbolo}|${tf}|${arr[ultima].t}`);
      if (!conocida && tCierre < this._tArranque - 5000) continue;

      const clave = claveDe(ev);
      if (this._emitidos.has(clave)) continue;

      /* Una vela ya emitida no puede cambiar de lado por una revisión del
         bróker ni por la diferencia entre la vela de ticks y la oficial. */
      if (this.bloqueoLado && !this._puedeEmitirLado(simbolo, tf, arr[ultima].t, ev.lado)) {
        this.stats.revisionesContradictorias++;
        this.emit('aviso', `señal ${ev.lado} ${simbolo} ${tf} ${ev.patron} descartada: la vela ${horaHabana(arr[ultima].t)} ya emitió el lado contrario`);
        continue;
      }

      this._emitidos.add(clave);
      if (this._emitidos.size > 50000) {
        let n = 0;
        for (const k of this._emitidos) { this._emitidos.delete(k); if (++n >= 10000) break; }
      }
      if (this._ladoPorVela.size > 50000) {
        let n = 0;
        for (const k of this._ladoPorVela.keys()) { this._ladoPorVela.delete(k); if (++n >= 10000) break; }
      }

      const esEstructura = String(ev.patron).indexOf('E') >= 0;
      const tm = this._tendenciaMayor(simbolo, tCierre);
      const comun = {
        lado: ev.lado, patron: ev.patron, tendencia: ev.tendencia,
        tendenciaMayor: tm ? tm.tendencia : null, tfTendencia: tm ? tm.tf : null,
        simbolo, estrategia: esEstructura ? 'Estructura' : 'Raptor-v03',
        tfZona: tf, tfGatillo: tf,
        nivelRoto: ev.nivelRoto,
        /* t = instante en que se emite (cierre de la vela), para latencia y
           deduplicación. tVela = apertura de la vela que generó la señal: es
           la que se ve en MT5, que etiqueta las velas por su apertura. */
        clave, t: tCierre, tVela: arr[ultima].t, emitidaEn, latenciaMs,
        motivo: esEstructura
          ? `${ev.patron} · impulso+retroceso · cierre ${tf}`
          : `${ev.patron} · toque EMA${this.p.emaContacto} · cierre ${tf}`,
      };

      this.total++;
      this.stats.emitidas++;
      this.emit('senal', { ...comun, tipo: 'entrada', precio: ev.precio, invalida: ev.invalida });
    }
  }

  _poblarSenales(simbolo, tf, arr, resPre = null) {
    if (!arr || !arr.length) return;
    try {
      const pre = resPre || this._escanear(simbolo, tf, arr);
      if (!pre) return;
      const eventos = [...(pre.resYoel.eventos || []), ...(pre.resEstructura ? pre.resEstructura.eventos : [])];
      const kSen = `${simbolo}|${tf}`;
      const arrSen = [];
      for (const ev of eventos) {
        if (ev.tipo !== 'entry') continue;
        if (!Number.isFinite(ev.precio) || ev.precio <= 0) continue;
        if (!Number.isFinite(ev.barIndex) || ev.barIndex < 0 || ev.barIndex >= arr.length) continue;
        arrSen.push({ patron: ev.patron, lado: ev.lado, barIndex: ev.barIndex, t: arr[ev.barIndex].t, precio: ev.precio });
      }
      if (arrSen.length > 50000) arrSen.splice(0, arrSen.length - 50000);
      this._senales.set(kSen, arrSen);
    } catch (e) { /* ignore */ }
  }

  resumen() {
    const out = {};
    for (const [simbolo, e] of this.s) {
      const velas = {};
      for (const tf of Object.keys(TFS)) velas[tf] = e.velas[tf].length;
      out[simbolo] = { motor: 'v03', velas, ahora: e.ahora };
    }
    return out;
  }
}

/* ---------------- jerarquía de señales (calibración 2026-11-14, 16 series M5) ----------------
   Peso sugerido para la operación: 3 = prioridad alta, 2 = media, 1 = baja/cautela,
   0 = evitar (R negativo en la medición). La 2 y la 3 son entradas al toque y rinden
   negativo: no se operan salvo en contextos muy específicos. */
const JERARQUIA = {
  '3RB': { peso: 3, tier: 'A', r: 0.295, pf: 1.78 },
  '2RB': { peso: 2, tier: 'A', r: 0.149, pf: 1.42 },
  '1':   { peso: 1, tier: 'B', r: 0.067, pf: 1.13 },
  '1R':  { peso: 1, tier: 'B', r: 0.022, pf: 1.04 },
  '3B':  { peso: 1, tier: 'B', r: 0.014, pf: 1.03 },
  '2B':  { peso: 0, tier: 'C', r: -0.060, pf: 0.82 },
  '3R':  { peso: 0, tier: 'C', r: -0.161, pf: 0.75 },
  '2':   { peso: 0, tier: 'C', r: -0.163, pf: 0.74 },
  '2R':  { peso: 0, tier: 'C', r: -0.196, pf: 0.71 },
  '3':   { peso: 0, tier: 'C', r: -0.239, pf: 0.65 },
};
function pesoPatron(patron) {
  const j = JERARQUIA[patron];
  return j ? j.peso : 0;
}
/* Forma dinámica: deriva la jerarquía a partir de resultados medidos {patron, r, pf, n}.
   No rompe la estática: si no se llama, JERARQUIA queda con la calibración vigente. */
function calcularJerarquia(resultados) {
  const out = {};
  for (const x of (resultados || [])) {
    const r = Number(x.r);
    const tier = r >= 0.10 ? 'A' : (r >= 0 ? 'B' : 'C');
    const peso = r >= 0.20 ? 3 : (r >= 0.10 ? 2 : (r >= 0 ? 1 : 0));
    out[x.patron] = { peso, tier, r: Number(r.toFixed(3)), pf: Number(Number(x.pf).toFixed(2)), n: x.n };
  }
  return out;
}
function actualizarJerarquia(nueva) {
  if (!nueva || typeof nueva !== 'object') return false;
  Object.keys(JERARQUIA).forEach((k) => delete JERARQUIA[k]);
  Object.assign(JERARQUIA, nueva);
  return true;
}
module.exports = { Nucleo, escanear, escanearEstructura, ema, atr, PARAMS, TFS, TF_ESCANEO, ENTRADAS, conReset, JERARQUIA, pesoPatron, prioridadEvento, calcularJerarquia, actualizarJerarquia };