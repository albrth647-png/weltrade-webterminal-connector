'use strict';
/* ============================================================
   MOTOR DE ESTRATEGIAS — vocabulario genérico (sin estrategia)
   ------------------------------------------------------------
   Este archivo NO contiene ninguna estrategia: solo las piezas
   (pivotes fractales, toques por fases, cancelación TN, sesgo
   por EMA, scoring por pesos) y TODOS los valores vienen de un
   documento de estrategia validado (doc_estrategia.js ->
   docACfg). Sin cfg completa, el motor no arranca.

   Señal = { lado, fase, simbolo, nivel, precio, score, sl, tp, ... }
   Todo se calcula con velas CERRADAS (sin look-ahead).
   ============================================================ */
const { EventEmitter } = require('events');

const TFS = { M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400 };

class Estrategia extends EventEmitter {
  constructor(cfg) {
    super();
    if (!cfg || typeof cfg !== 'object') {
      throw new Error('Estrategia requiere una configuración generada desde un documento de estrategia (docACfg).');
    }
    for (const k of ['tfZona', 'tfToque', 'tfSesgo', 'atrPeriodo', 'scoreMin', 'pesoFase']) {
      if (cfg[k] === undefined) throw new Error(`config incompleta: falta "${k}" — la estrategia debe venir de un documento`);
    }
    this.cfg = cfg;
    this.s = new Map();   // simbolo -> estado
    this.seq = 0;
  }

  _estado(simbolo) {
    let e = this.s.get(simbolo);
    if (!e) {
      const velas = {}, cur = {};
      for (const tf of Object.keys(TFS)) { velas[tf] = []; cur[tf] = null; }
      e = { velas, cur, atr: 0, zonas: [], sesgo: this.cfg.sesgoActivo ? 'lateral' : 'neutral', ultSenalZona: new Map(), ahora: 0 };
      this.s.set(simbolo, e);
    }
    return e;
  }

  /* ---------- semilla de historia (velas del servidor) ---------- */
  setHistoria(simbolo, tf, velas) {
    const e = this._estado(simbolo);
    const max = this.cfg.maxVelas[tf] || 300;
    const arr = velas.slice(-max);
    /* El servidor incluye al final la vela EN FORMACIÓN. Sin quitarla
       queda congelada para siempre (mismo t bloquea el cierre real) y
       envenena TN y pivotes con un cierre parcial. */
    const seg = TFS[tf] || 0;
    while (arr.length && seg && arr[arr.length - 1].t + seg * 1000 > Date.now()) arr.pop();
    e.velas[tf] = arr;
    const ult = e.velas[tf][e.velas[tf].length - 1];
    if (ult && ult.t > e.ahora) e.ahora = ult.t;   // reloj de mercado (no de pared)
    if (tf === this.cfg.tfSesgo) this._recalcSesgo(simbolo);
    if (tf === this.cfg.tfZona) {
      this._recalcAtr(simbolo);
      // escaneo de pivotes sobre toda la historia -> zonas listas al arrancar
      const m = e.velas[tf], w = this.cfg.alasPivote;
      for (let i = w; i <= m.length - 1 - w; i++) this._chequearPivote(simbolo, i);
      // barrido silencioso de TN: mata zonas que el último cierre ya invalidó
      if (this.cfg.tnActivo && ult && e.atr) {
        for (const z of e.zonas) {
          if (z.estado !== 'activa') continue;
          if (this._fueraDeZona(z, ult.c, e.atr)) { z.estado = 'muerta'; z.muertaEn = e.ahora; }
        }
      }
    }
  }

  /* ---------- lectura del histórico vivo (para re-sembrado incremental) ---------- */
  historia(simbolo) {
    const e = this.s.get(simbolo);
    if (!e) return null;
    const velas = {};
    for (const tf of Object.keys(TFS)) velas[tf] = e.velas[tf];
    return velas;
  }

  /* ---------- entrada de ticks: agrega velas por TF ---------- */
  onTick(simbolo, bid, ask, t = Date.now()) {
    const precio = (bid + ask) / 2;
    const e = this._estado(simbolo);
    for (const [tf, seg] of Object.entries(TFS)) {
      const t0 = Math.floor(t / (seg * 1000)) * seg * 1000;
      let c = e.cur[tf];
      if (!c || c.t !== t0) {
        if (c) this.onVelaCerrada(simbolo, tf, c);
        c = e.cur[tf] = { t: t0, o: precio, h: precio, l: precio, c: precio };
      } else {
        if (precio > c.h) c.h = precio;
        if (precio < c.l) c.l = precio;
        c.c = precio;
      }
    }
  }

  /* ---------- procesado de vela cerrada (punto de entrada público para tests) ---------- */
  onVelaCerrada(simbolo, tf, vela) {
    const e = this._estado(simbolo);
    const arr = e.velas[tf];
    if (arr.length && arr[arr.length - 1].t >= vela.t) return; // duplicado/fuera de orden
    if (vela.t > e.ahora) e.ahora = vela.t;                    // reloj de mercado
    arr.push({ ...vela });
    const max = this.cfg.maxVelas[tf] || 300;
    if (arr.length > max) arr.shift();

    if (tf === this.cfg.tfSesgo) this._recalcSesgo(simbolo);
    if (tf === this.cfg.tfZona) {
      this._recalcAtr(simbolo);
      this._detectarPivotes(simbolo);
      if (this.cfg.tnActivo) this._chequearTN(simbolo, vela);
    }
    if (tf === this.cfg.tfToque) this._chequearToque(simbolo, vela);
  }

  /* ---------- indicadores ---------- */
  _recalcAtr(simbolo) {
    const e = this._estado(simbolo);
    const m = e.velas[this.cfg.tfZona], p = this.cfg.atrPeriodo;
    if (m.length < p + 1) return;
    let suma = 0;
    for (let i = m.length - p; i < m.length; i++) {
      const prevC = m[i - 1].c;
      suma += Math.max(m[i].h - m[i].l, Math.abs(m[i].h - prevC), Math.abs(m[i].l - prevC));
    }
    e.atr = suma / p;
  }

  _recalcSesgo(simbolo) {
    const e = this._estado(simbolo);
    if (!this.cfg.sesgoActivo) { e.sesgo = 'neutral'; return; }
    const h = e.velas[this.cfg.tfSesgo], p = this.cfg.emaH1, atras = this.cfg.emaVelasPendiente;
    if (h.length < p + atras + 1) { e.sesgo = 'lateral'; return; }
    const k = 2 / (p + 1);
    let ema = h.slice(0, p).reduce((a, v) => a + v.c, 0) / p;
    const serie = [ema];
    for (let i = p; i < h.length; i++) { ema = h[i].c * k + ema * (1 - k); serie.push(ema); }
    const emaUlt = serie[serie.length - 1];
    const emaAntes = serie[serie.length - 1 - atras];
    const ultima = h[h.length - 1].c;
    if (ultima > emaUlt && emaUlt > emaAntes) e.sesgo = 'alza';
    else if (ultima < emaUlt && emaUlt < emaAntes) e.sesgo = 'baja';
    else e.sesgo = 'lateral';
  }

  /* ---------- zonas: pivotes fractales confirmados (alas configurables) ---------- */
  _detectarPivotes(simbolo) {
    const e = this._estado(simbolo);
    const w = this.cfg.alasPivote;
    if (e.velas[this.cfg.tfZona].length < 2 * w + 1 || !e.atr) return;
    this._chequearPivote(simbolo, e.velas[this.cfg.tfZona].length - 1 - w);
    // purga: zonas muertas hace más de vigenciaHoras (en tiempo de mercado)
    const corte = e.ahora - this.cfg.vigenciaHoras * 3600e3;
    e.zonas = e.zonas.filter((z) => !(z.estado === 'muerta' && z.muertaEn < corte));
  }

  _chequearPivote(simbolo, i) {
    const e = this._estado(simbolo);
    const m = e.velas[this.cfg.tfZona], w = this.cfg.alasPivote;
    if (i < w || i > m.length - 1 - w || !e.atr) return;
    const v = m[i];
    let techo = true, piso = true;
    for (let k = 1; k <= w; k++) {
      if (!(v.h > m[i - k].h && v.h > m[i + k].h)) techo = false;
      if (!(v.l < m[i - k].l && v.l < m[i + k].l)) piso = false;
      if (!techo && !piso) break;
    }
    if (techo) this._agregarPivote(simbolo, v.h, 'resistencia', v.t);
    if (piso) this._agregarPivote(simbolo, v.l, 'soporte', v.t);
  }

  _agregarPivote(simbolo, nivel, tipo, t) {
    const e = this._estado(simbolo);
    const tol = Math.max(this.cfg.tolPivoteRel * nivel, this.cfg.tolPivoteAtr * (e.atr || 0));
    const z = e.zonas.find((x) => x.tipo === tipo && x.estado === 'activa' && Math.abs(x.nivel - nivel) <= tol);
    if (z) {
      z.nivel = (z.nivel * z.fuerza + nivel) / (z.fuerza + 1);
      z.fuerza++; z.ultimoPivote = t;
      this.emit('zona', { simbolo, zona: this._vista(z), evento: 'refuerzo' });
    } else {
      const nz = {
        id: ++this.seq, tipo, nivel, fuerza: 1, toques: 0, excur: 0,
        estado: 'activa', nacida: t, ultimoPivote: t, ultimaToque: 0, muertaEn: 0,
      };
      e.zonas.push(nz);
      this.emit('zona', { simbolo, zona: this._vista(nz), evento: 'nueva' });
    }
  }

  /* ---------- TN: cancelación por cierre más allá de la zona ---------- */
  _fueraDeZona(z, cierre, atr) {
    return z.tipo === 'soporte'
      ? cierre < z.nivel - this.cfg.tnAtr * atr
      : cierre > z.nivel + this.cfg.tnAtr * atr;
  }

  _chequearTN(simbolo, vela) {
    const e = this._estado(simbolo);
    if (!e.atr) return;
    for (const z of e.zonas) {
      if (z.estado !== 'activa') continue;
      if (this._fueraDeZona(z, vela.c, e.atr)) {
        z.estado = 'muerta'; z.muertaEn = e.ahora;
        this.emit('tn', { simbolo, zona: this._vista(z), vela, motivo: `cierre ${this.cfg.tfZona} más allá de la zona` });
      }
    }
  }

  /* ---------- toques en 3 fases + gatillo de señal ---------- */
  _chequearToque(simbolo, vela) {
    const e = this._estado(simbolo);
    if (!e.atr) return;
    const banda = this.cfg.bandaToqueAtr * e.atr;
    for (const z of e.zonas) {
      if (z.estado !== 'activa') continue;
      const toca = vela.l <= z.nivel + banda && vela.h >= z.nivel - banda;

      if (!toca) {
        if (z.toques > 0) {   // excursión desde el nivel tras un toque (habilita MAIN)
          const ex = z.tipo === 'soporte' ? vela.h - z.nivel : z.nivel - vela.l;
          if (ex > 0) z.excur = Math.max(z.excur, ex);
        }
        continue;
      }

      const rebote = z.excur >= this.cfg.excursionAtr * e.atr;
      const fase = z.toques === 0 ? 'EARLY' : (rebote ? 'MAIN' : 'LATE');
      z.toques++; z.ultimaToque = vela.t; z.excur = 0;
      this.emit('toque', { simbolo, zona: this._vista(z), fase, vela });

      // filtros de dirección: sesgo (si activo) + gatillo direccional (si activo)
      const sesgoOk = !this.cfg.sesgoActivo || e.sesgo === 'neutral'
        ? true
        : (z.tipo === 'soporte' ? e.sesgo === 'alza' : e.sesgo === 'baja');
      const dirOk = !this.cfg.gatilloDireccional
        || (z.tipo === 'soporte' ? vela.c > vela.o : vela.c < vela.o);
      const compra = z.tipo === 'soporte' && sesgoOk && dirOk;
      const venta = z.tipo === 'resistencia' && sesgoOk && dirOk;
      if (!compra && !venta) continue;
      const lado = compra ? 'COMPRA' : 'VENTA';

      const ult = e.ultSenalZona.get(z.id) || 0;
      if (e.ahora - ult < this.cfg.dedupMin * 60e3) continue;

      let score = (this.cfg.pesoFase[fase] || 0)
        + Math.min(this.cfg.pesoFuerzaMax, z.fuerza * this.cfg.pesoFuerzaPorPivote)
        + this.cfg.pesoSesgo
        + this.cfg.pesoGatillo;
      score = Math.min(100, score);
      if (score < this.cfg.scoreMin) continue;

      e.ultSenalZona.set(z.id, e.ahora);
      const sl = this.cfg.slAtr * e.atr, tp = this.cfg.tpAtr * e.atr;
      this.emit('senal', {
        lado, fase, simbolo,
        nivel: +z.nivel.toFixed(2),
        precio: +vela.c.toFixed(2),
        score, tfZona: this.cfg.tfZona, tfGatillo: this.cfg.tfToque,
        sesgo: e.sesgo, fuerzaZona: z.fuerza, toques: z.toques,
        sl: +(compra ? z.nivel - sl : z.nivel + sl).toFixed(2),
        tp: +(compra ? vela.c + tp : vela.c - tp).toFixed(2),
        t: e.ahora,
        motivo: `${fase} en ${z.tipo} (fuerza ${z.fuerza}) con sesgo ${this.cfg.sesgoActivo ? 'H1 al ' + e.sesgo : 'desactivado'}`,
      });
    }
  }

  _vista(z) { return { id: z.id, tipo: z.tipo, nivel: +z.nivel.toFixed(2), fuerza: z.fuerza, toques: z.toques, estado: z.estado }; }

  /* ---------- resumen serializable para /estado ---------- */
  resumen() {
    const out = {};
    for (const [simbolo, e] of this.s) {
      const velas = {};
      for (const tf of Object.keys(TFS)) velas[tf] = e.velas[tf].length;
      out[simbolo] = {
        sesgo: e.sesgo, atr: +e.atr.toFixed(3),
        zonasActivas: e.zonas.filter((z) => z.estado === 'activa').length,
        velas,
      };
    }
    return out;
  }
}

module.exports = { Estrategia, TFS };
