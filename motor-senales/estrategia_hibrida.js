'use strict';
/* ============================================================
   MOTOR EN VIVO — RAPTOR HÍBRIDA
   ------------------------------------------------------------
   Una sola estrategia, como pidió el propietario:
     catálogo del propietario (toques 1/2/3 · rompimientos 1R/2R/3R)
     + zonas fractales con fuerza y TN
     + fases EARLY / MAIN / LATE
     + sesgo EMA30 + gatillo direccional + score

   Cada temporalidad aplica la estrategia COMPLETA con sus propias
   velas (`independiente: true`): M5 no lee M15.

   Misma interfaz pública que estrategia.js (setHistoria, historia,
   onTick, onVelaCerrada, resumen) para que app.js no cambie.

   Verificado contra el Python: validacion/comparar.js → 1.650
   señales, 0 diferencias (patrón, fase, zona, sesgo y score).
   ============================================================ */
const { EventEmitter } = require('events');
const core = require('./raptor_core');
const H = require('./raptor_hibrida');
const VERBOSO = process.env.MS_VERBOSO === '1';
/* La seductora (engaño sobre EMA50 + regreso + cuerpo) NO es ninguna de las
   tres estrategias del propietario — 1/2/3 son toques y sus rompimientos
   1R/2R/3R, 1RB/2RB/3RB —, pero el catálogo del vídeo 03 la incluye, así que va
   ENCENDIDA; MS_SEDUCTORA=0 la apaga. Sale con su código propio 1S, nunca como R. */
const SEDUCTORA = process.env.MS_SEDUCTORA !== '0';

const TFS = { M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400 };
const DIAS_RETENCION = 30;
const barrasDeUnMes = (tf) => Math.ceil((DIAS_RETENCION * 86400) / (TFS[tf] || 900));

/* temporalidades que la híbrida escanea (las del backtest de 30 días) */
const TF_HIBRIDA = ['M5', 'M15', 'M30', 'H1'];

class EstrategiaHibrida extends EventEmitter {
  constructor(cfg) {
    super();
    if (!cfg || typeof cfg !== 'object') throw new Error('EstrategiaHibrida requiere la configuración de docACfg().');
    this.cfg = cfg;
    this.s = new Map();
    this.total = 0;
    /* Una sola emisión por vela, clase (entrada / aviso) y dirección.
       Antes era una clave global por símbolo (patrón + precio) que no
       caducaba nunca: además del duplicado real, borraba señales distintas
       que caían al mismo precio (2,9 % de las entradas medidas en 30 días). */
    this._emitidos = new Map();
    /* Velas ya evaluadas: clave -> firma OHLC. Guardar la firma permite que
       la vela REAL del bróker re-evalúe (y corrija) la que cerró el tick. */
    this._evalPorVela = new Map();
    /* Contadores para /estado: sin esto, una señal perdida no deja rastro. */
    this.stats = { emitidas: 0, avisos: 0, intrabar: 0, suprimidas: 0, velasViejas: 0, reevaluadas: 0, errores: 0 };
    /* Ventana en la que el mismo movimiento (símbolo + dirección + nivel de
       zona) se manda UNA vez aunque lo vean M5, M15, M30 y H1. */
    this._ventanaZonaMs = 30 * 60 * 1000;
    this._ultimaEntradaZona = new Map();
    this._zonasIntrabar = new Map();

    /* Parámetros: los del DOCUMENTO donde coinciden con la híbrida; el resto,
       los valores del port validado contra Python (no se inventa ninguno). */
    this.p = H.hibridaParams({
      v2: core.params({ emitTouchesFrom: 'M1', seductora: SEDUCTORA }),
      zonas: {
        alas: cfg.alasPivote, tolPivoteAtr: cfg.tolPivoteAtr, tolPivoteRel: cfg.tolPivoteRel,
        tnAtr: cfg.tnAtr, excursionAtr: cfg.excursionAtr,
        bandaToqueAtr: cfg.bandaToqueAtr, atrPeriodo: cfg.atrPeriodo,
      },
      score: {
        pesoFase: { ...cfg.pesoFase },
        pesoFuerzaMax: cfg.pesoFuerzaMax, pesoFuerzaPorPivote: cfg.pesoFuerzaPorPivote,
        pesoSesgo: cfg.pesoSesgo, pesoGatillo: cfg.pesoGatillo,
        min: 0,                     // el score ORDENA, no decide (igual que el backtest)
      },
      independiente: true,
      /* la verdad del backtest: sin filtros extra y sin score mínimo */
      filtrarSesgo: false, filtrarConfluencia: false, filtrarGatillo: false, scoreMin: 0,
    });

    /* Temporizador de cierre de velas: cada segundo cierra las velas en curso
       que ya expiraron (hora de inicio + duración < ahora - margenSeguridad).
       Así las señales se generan SOLO cuando la vela está realmente cerrada,
       no en el primer tick del nuevo intervalo. */
    this._margenSeguridadMs = 3000;   // no cerrar hasta 3 s después del cierre teórico
    this._temporizador = setInterval(() => this._cerrarVelasExpiradas(), 1000);
    this._temporizador.unref?.();     // no impida que Node salga si no hay más trabajo
  }

  /** Limpieza: detener el temporizador de cierre. Llamar al salir del proceso. */
  destruir() {
    if (this._temporizador) { clearInterval(this._temporizador); this._temporizador = null; }
  }

  _estado(simbolo) {
    let e = this.s.get(simbolo);
    if (!e) {
      const velas = {}, cur = {};
      for (const tf of Object.keys(TFS)) { velas[tf] = []; cur[tf] = null; }
      e = { velas, cur, ahora: 0, zonasVigentes: {}, ultimoIntrabar: 0 };
      this.s.set(simbolo, e);
    }
    return e;
  }

  _maxVelas(tf) { return barrasDeUnMes(tf); }

  /* ---------- semilla de historia (velas del servidor) ---------- */
  setHistoria(simbolo, tf, velas) {
    const e = this._estado(simbolo);
    const seg = TFS[tf] || 0;
    const arr = velas.slice(-this._maxVelas(tf));
    /* El servidor manda al final la vela EN FORMACIÓN: no entra en la serie,
       pero SÍ alimenta el acumulador de ticks. Así la vela en curso arranca
       con la apertura y el máximo/mínimo reales del bróker en vez de con el
       primer tick que veamos (origen de una apertura falsa y de un high/low
       truncado al arrancar o al reconectar). */
    let formando = null;
    while (arr.length && seg && arr[arr.length - 1].t + seg * 1000 > Date.now()) formando = arr.pop();
    e.velas[tf] = arr.map((v) => ({ ...v }));
    if (formando) this._absorberFormando(simbolo, tf, formando);
    const ult = arr.length ? arr[arr.length - 1] : null;
    if (ult && ult.t > e.ahora) e.ahora = ult.t;
    /* Evaluar la última vela sembrada: puede contener una señal que el motor
       no llegó a ver (p. ej. tras un reinicio). Con guard de frescura. */
    if (ult) this._evaluarSiNuevo(simbolo, tf, ult);
    /* Las zonas del aviso intrabar tienen que existir desde el arranque, aunque
       la vela sembrada sea vieja y el guard de frescura no la evalúe. */
    if (!this._estado(simbolo).zonasVigentes[tf]) this._refrescarZonas(simbolo, tf);
  }

  /* Cache de zonas activas + ATR de la última vela: lo usa el aviso intrabar. */
  _refrescarZonas(simbolo, tf) {
    const e = this._estado(simbolo);
    const arr = e.velas[tf];
    if (!arr.length) return;
    try {
      const zc = H.detectarZonas(this._df(arr), this.p.zonas);
      e.zonasVigentes[tf] = {
        zonas: H.zonasActivasEn(zc.zonas, arr[arr.length - 1].t),
        atr: zc.atr[arr.length - 1] || 0,
      };
    } catch (err) {
      this.stats.errores++;
    }
  }

  /* La vela en formación del bróker manda en apertura y recorrido; los ticks
     que ya tenemos mandan en el último precio (son más recientes). */
  _absorberFormando(simbolo, tf, v) {
    const e = this._estado(simbolo);
    const c = e.cur[tf];
    if (!c || c.t < v.t) { e.cur[tf] = { ...v }; return; }
    if (c.t > v.t) return;                       // el acumulador ya es de una vela posterior
    e.cur[tf] = {
      t: v.t, o: v.o,
      h: Math.max(v.h, c.h), l: Math.min(v.l, c.l),
      c: Number.isFinite(c.c) ? c.c : v.c,
    };
  }

  /* Evalúa una vela solo si es reciente y sus datos cambiaron.
     - Frescura: una vela cuyo cierre ya pasó hace más de medio TF (+2 min)
       es histórica; emitirla manda una señal que el mercado ya recorrió
       (era el caso de la siembra/reconexión y del reinicio).
     - Firma: si el bróker entrega la misma vela con otra apertura/cierre, se
       vuelve a evaluar para no perder la señal que la vela sintética no vio. */
  _evaluarSiNuevo(simbolo, tf, vela) {
    const seg = TFS[tf] || 300;
    const edadMs = Date.now() - (vela.t + seg * 1000);
    const topeMs = Math.max(120000, (seg * 1000) / 2);
    if (edadMs > topeMs) { this.stats.velasViejas++; return; }
    const clave = `${simbolo}|${tf}|${vela.t}`;
    const firma = `${vela.o}|${vela.h}|${vela.l}|${vela.c}`;
    const previa = this._evalPorVela.get(clave);
    if (previa !== undefined) {
      if (previa === firma) return;
      this.stats.reevaluadas++;
    }
    this._evalPorVela.set(clave, firma);
    this._evaluar(simbolo, tf, this._estado(simbolo).velas[tf]);
  }

  historia(simbolo) {
    const e = this.s.get(simbolo);
    if (!e) return null;
    const velas = {};
    for (const tf of Object.keys(TFS)) velas[tf] = e.velas[tf];
    return velas;
  }

  /* ---------- ticks: SOLO actualiza la vela en curso, NUNCA cierra ni evalúa ----------
     El cierre de vela lo hace _cerrarVelasExpiradas() con margen de seguridad,
     para que las señales usen el cierre confirmado, no el primer tick del nuevo intervalo. */
  onTick(simbolo, bid, ask, t = Date.now()) {
    const precio = (bid + ask) / 2;
    const e = this._estado(simbolo);
    for (const [tf, seg] of Object.entries(TFS)) {
      const t0 = Math.floor(t / (seg * 1000)) * seg * 1000;
      let c = e.cur[tf];
      if (!c || c.t !== t0) {
        c = e.cur[tf] = { t: t0, o: precio, h: precio, l: precio, c: precio };
      } else {
        if (precio > c.h) c.h = precio;
        if (precio < c.l) c.l = precio;
        c.c = precio;
      }
    }
    /* Aviso INTRABAR (opcional): el precio ha llegado a la banda de una zona.
       Se pasa la cotización REAL (bid/ask): antes el mensaje enseñaba el punto
       medio (bid+ask)/2, un precio que no existe en el mercado. */
    this._chequearIntrabar(simbolo, precio, t, { bid, ask });
  }

  _claveZona(simbolo, lado, nivel) {
    return `${simbolo}|${lado}|${Number(nivel).toFixed(2)}`;
  }

  _zonaYaAvisada(mapa, simbolo, lado, nivel, ahora = Date.now()) {
    if (nivel == null) return false;
    const t = mapa.get(this._claveZona(simbolo, lado, nivel)) || 0;
    return ahora - t < this._ventanaZonaMs;
  }

  _marcarZonaAvisada(mapa, simbolo, lado, nivel, ahora = Date.now()) {
    if (nivel == null) return;
    mapa.set(this._claveZona(simbolo, lado, nivel), ahora);
    if (mapa.size > 5000) mapa.delete(mapa.keys().next().value);   // poda FIFO
  }

  /* Se comprueba como mucho una vez por segundo y símbolo: los ticks llegan a
     decenas por segundo y esto corre dentro del manejador de ticks. */
  /* OPCIONAL (MS_AVISO_INTRABAR=1): el precio ha llegado a la banda de una zona.
     NO es una señal de la estrategia — los toques son 1/2/3 y sus rompimientos
     1R/2R/3R —, así que el mensaje ya no lo llama «toque». El precio que viaja
     es la cotización REAL que dispara el aviso (ask al comprar, bid al vender),
     no el punto medio (bid+ask)/2. */
  _chequearIntrabar(simbolo, precio, ahora, cot = null) {
    const e = this.s.get(simbolo);
    if (!e) return;
    const tf = TF_HIBRIDA[0];              // la TF más rápida: avisa antes que ninguna
    const z = e.zonasVigentes[tf];
    if (!z || !(z.atr > 0) || !z.zonas.length) return;
    if (ahora - (e.ultimoIntrabar || 0) < 1000) return;
    e.ultimoIntrabar = ahora;
    const banda = this.p.zonas.bandaToqueAtr * z.atr;
    /* Un solo aviso por símbolo y dirección en la ventana: antes dos soportes
       a 29 puntos mandaban dos mensajes con 5 minutos de diferencia. */
    const vistas = this._avisoIntrabarSim = this._avisoIntrabarSim || new Map();
    for (const zona of z.zonas) {
      if (precio > zona.nivel + banda || precio < zona.nivel - banda) continue;
      const lado = zona.tipo === 'soporte' ? 'COMPRA' : 'VENTA';
      if (this._zonaYaAvisada(this._zonasIntrabar, simbolo, lado, zona.nivel, ahora)) continue;
      const claveSim = `${simbolo}|${lado}`;
      if (ahora - (vistas.get(claveSim) || 0) < this._ventanaZonaMs) continue;
      vistas.set(claveSim, ahora);
      if (vistas.size > 2000) vistas.delete(vistas.keys().next().value);
      this._marcarZonaAvisada(this._zonasIntrabar, simbolo, lado, zona.nivel, ahora);
      const clave = `${simbolo}|${tf}|${ahora}|intrabar|${lado}`;
      this._emitidos.set(clave, 1);
      this.stats.intrabar++;
      const precioReal = cot ? (lado === 'COMPRA' ? cot.ask : cot.bid) : precio;
      const distAtr = Math.abs(precioReal - zona.nivel) / z.atr;
      this.emit('alerta', {
        origen: 'intrabar', lado, patron: null, fase: null,
        simbolo, estrategia: this.cfg.nombre || 'Raptor-híbrida',
        zonaTipo: zona.tipo, zonaNivel: zona.nivel, zonaFuerza: zona.fuerza, distZonaAtr: distAtr,
        confluencia: false, confluenciaFavor: false, sesgo: null, score: null,
        tfZona: tf, tfGatillo: tf, tipo: 'intrabar', clave,
        precio: precioReal, bid: cot ? cot.bid : null, ask: cot ? cot.ask : null,
        nivelRoto: zona.nivel, invalida: null,
        t: ahora, emitidaEn: ahora, latenciaMs: 0,
        motivo: `el precio ha llegado a la banda de la zona (${zona.tipo} ${zona.nivel})`,
      });
    }
  }

  /* Claves que ya se emitieron y no deben repetirse tras un reinicio. */
  sembrarEmitidas(claves = []) {
    for (const k of claves) this._emitidos.set(k, 1);
  }

  /* ---------- vela cerrada: toda la lógica se recalcula con velas cerradas ---------- */
  onVelaCerrada(simbolo, tf, vela) {
    if (!TF_HIBRIDA.includes(tf)) return;   // la estrategia corre en M5/M15/M30/H1
    const clave = `${simbolo}|${tf}|${vela.t}`;
    const firma = `${vela.o}|${vela.h}|${vela.l}|${vela.c}`;
    if (this._evalPorVela.get(clave) === firma) return;   // ya evaluada con estos datos
    const e = this._estado(simbolo);
    const arr = e.velas[tf];
    if (arr.length && arr[arr.length - 1].t >= vela.t) {
      /* la vela ya estaba en la serie (llegó antes por el bróker o por el
         tick): se corrige y se re-evalúa solo si sus datos cambiaron */
      const i = arr.findIndex((v) => v.t === vela.t);
      if (i < 0) return;
      arr[i] = { ...vela };
      this._evalPorVela.set(clave, firma);
      if (i === arr.length - 1) {
        this.stats.reevaluadas++;
        this._evaluar(simbolo, tf, arr);
      }
      return;
    }
    if (vela.t > e.ahora) e.ahora = vela.t;
    arr.push({ ...vela });
    this._evalPorVela.set(clave, firma);
    const max = this._maxVelas(tf);
    if (arr.length > max) arr.shift();

    this._evaluar(simbolo, tf, arr);
  }

  /* Cierra las velas en curso que ya expiraron (hora de inicio + duración
     < ahora - margenSeguridad). Se llama cada segundo por el temporizador.
     Así las señales usan el cierre confirmado, no el primer tick del nuevo intervalo. */
  _cerrarVelasExpiradas() {
    const ahora = Date.now() - this._margenSeguridadMs;
    for (const [simbolo, e] of this.s) {
      for (const [tf, c] of Object.entries(e.cur)) {
        if (!c) continue;
        const seg = TFS[tf] || 0;
        if (seg && c.t + seg * 1000 <= ahora) {
          /* la vela expiró: cerrarla y evaluar, luego crear una nueva en curso vacía */
          const velaCerrada = { ...c };
          e.cur[tf] = null;
          this.onVelaCerrada(simbolo, tf, velaCerrada);
        }
      }
    }
  }

  _df(arr) {
    const n = arr.length;
    const df = { t: new Array(n), o: new Array(n), h: new Array(n), l: new Array(n), c: new Array(n) };
    for (let i = 0; i < n; i++) {
      const v = arr[i];
      df.t[i] = v.t; df.o[i] = v.o; df.h[i] = v.h; df.l[i] = v.l; df.c[i] = v.c;
    }
    return df;
  }

  /* La híbrida es independiente por TF: escanear SOLO esa TF produce exactamente
     las mismas señales que el escaneo conjunto (validado contra Python). */
  _evaluar(simbolo, tf, arr) {
    const df = this._df(arr);
    let res;
    try {
      res = H.scanHibrida({ [tf]: df }, this.p);
    } catch (err) {
      this.emit('aviso', `híbrida ${simbolo} ${tf}: ${err.message}`);
      return;
    }
    const ultima = arr.length - 1;
    const seg = TFS[tf] || 300;
    const tCierre = arr[ultima].t + seg * 1000;    // hora de CIERRE: cuando nace la señal
    const emitidaEn = Date.now();
    const latenciaMs = emitidaEn - tCierre;        // cierre -> decisión del motor
    /* Zonas vivas de esta TF para el aviso intrabar: se refrescan en cada cierre,
       sin recalcularlas en cada tick. */
    const zc = res.zonasCache && res.zonasCache.get(tf);
    if (zc) {
      this._estado(simbolo).zonasVigentes[tf] = {
        zonas: H.zonasActivasEn(zc.zonas, tCierre),
        atr: zc.atr[ultima] || 0,
      };
    }
    for (const s of res.senales) {
      if (s.barIndex !== ultima) continue;
      /* Una emisión por vela, clase y dirección: la re-evaluación de la vela
         corregida puede AÑADIR una señal que la sintética no vio, pero nunca
         repetir la que ya se mandó. */
      const claveEv = `${simbolo}|${tf}|${arr[ultima].t}|${s.kind}|${s.direction}`;
      if (this._emitidos.has(claveEv)) continue;
      const lado = s.direction === 'SELL' ? 'VENTA' : 'COMPRA';
      const senal = {
        lado, patron: s.pattern, fase: s.faseZona || null,
        simbolo, estrategia: this.cfg.nombre || 'Raptor-híbrida',
        score: s.score, sesgo: s.sesgo,
        zonaTipo: s.zonaTipo, zonaNivel: s.zonaNivel ?? null,
        zonaFuerza: s.zonaFuerza, distZonaAtr: s.distZonaAtr,
        confluencia: s.confluencia, confluenciaFavor: s.confluenciaFavor,
        tfZona: tf, tfGatillo: tf,
        invalida: +Number(s.invalidation),
        tipo: s.kind,
        clave: claveEv,
        t: tCierre, emitidaEn, latenciaMs,
        motivo: `${s.pattern}${s.faseZona ? ' ' + s.faseZona : ''} · ${s.zonaTipo || 'sin zona'} · score ${s.score}`,
      };
      if (s.kind === 'entry') {
        const precioEntrada = +Number(s.entry);
        /* Validación: descarta entradas con precio no válido */
        if (!Number.isFinite(precioEntrada) || precioEntrada <= 0) {
          if (VERBOSO) this.emit('aviso', `híbrida ${simbolo} ${tf}: precio de entrada inválido (${s.entry}), se descarta`);
          continue;
        }
        /* el mismo movimiento visto por otra temporalidad: una entrada por
           zona/dirección en la ventana (antes se mandaba hasta 4 veces) */
        if (this._zonaYaAvisada(this._ultimaEntradaZona, simbolo, lado, s.zonaNivel, emitidaEn)) {
          this.stats.suprimidas++;
          continue;
        }
        this._marcarEmitido(claveEv);
        this.total++;
        this.stats.emitidas++;
        this._marcarZonaAvisada(this._ultimaEntradaZona, simbolo, lado, s.zonaNivel, emitidaEn);
        this.emit('senal', { ...senal, precio: precioEntrada });
      } else {
        /* Avisos de toque 1/2/3: «ve a buscar la entrada», NO son operaciones.
           El núcleo los crea con entry = NaN, así que validar el precio antes
           de mirar el kind los borraba en silencio: 0 de 768 emitidos. */
        this._marcarEmitido(claveEv);
        this.stats.avisos++;
        /* si ya avisamos el toque intrabar, el cierre no repite el mensaje */
        this._marcarZonaAvisada(this._zonasIntrabar, simbolo, lado, s.zonaNivel, emitidaEn);
        this.emit('alerta', {
          ...senal,
          precio: arr[ultima].c,        // cierre de la vela del toque (referencia)
          nivelRoto: +Number(s.brokenLevel),
        });
      }
    }
  }

  _marcarEmitido(clave) {
    this._emitidos.set(clave, 1);
    if (this._emitidos.size > 50000) {          // poda FIFO: nunca crece sin límite
      let i = 0;
      for (const k of this._emitidos.keys()) {
        this._emitidos.delete(k);
        if (++i >= 10000) break;
      }
    }
  }

  resumen() {
    const out = {};
    for (const [simbolo, e] of this.s) {
      const velas = {};
      for (const tf of Object.keys(TFS)) velas[tf] = e.velas[tf].length;
      out[simbolo] = { motor: 'hibrida', velas, ahora: e.ahora };
    }
    return out;
  }
}

module.exports = { EstrategiaHibrida, TF_HIBRIDA, DIAS_RETENCION };
