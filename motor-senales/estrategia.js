'use strict';
/* ============================================================
   ESTRATEGIA "RAPTOR-LIKE" — motor de señales original
   ------------------------------------------------------------
   Reproduce la taxonomía observable del sistema de señales de
   SIFO (documentada en docs/RAPTOR_dossier_intel.md) con lógica
   100% propia:

     · ZONAS   : soportes/resistencias por pivotes fractales de
                 M15, agrupados por proximidad (fuerza = nº pivotes).
     · TOQUES  : 3 fases — EARLY (1er contacto), MAIN (retest tras
                 rebote ≥ 1.2×ATR), LATE (contactos adicionales).
     · TN      : cancelación — cierre M15 más allá de 0.5×ATR del
                 nivel mata la zona (evento 'tn').
     · SESGO   : rol de H1 — EMA(30) y su pendiente definen alza /
                 baja / lateral. Las señales solo a favor del sesgo.
     · GATILLO : vela M5 direccional tocando la zona alineada.

   Señal = { lado, fase, simbolo, nivel, precio, score, sl, tp, ... }
   score (0..100) = fase + fuerza de zona + alineación H1 + vela M5.

   Todo se calcula con velas CERRADAS (sin look-ahead).
   ============================================================ */
const { EventEmitter } = require('events');

const TFS = { M5: 300, M15: 900, H1: 3600 };
const PESO_FASE = { EARLY: 25, MAIN: 40, LATE: 15 };

class Estrategia extends EventEmitter {
  constructor(cfg = {}) {
    super();
    this.cfg = {
      atrPeriodo: 14,
      tolPivoteAtr: 0.30,      // agrupación de pivotes en una zona
      bandaToqueAtr: 0.15,     // ancho de la banda de toque
      tnAtr: 0.50,             // cierre M15 más allá del nivel × ATR = TN
      excursionAtr: 1.20,      // rebote mínimo entre toque y retest (fase MAIN)
      emaH1: 30,
      scoreMin: Number(cfg.scoreMin ?? 60),
      dedupMin: Number(cfg.dedupMin ?? 45),
      maxVelas: { M5: 600, M15: 400, H1: 300 },
      ...cfg,
    };
    this.s = new Map();   // simbolo -> estado
    this.seq = 0;
  }

  _estado(simbolo) {
    let e = this.s.get(simbolo);
    if (!e) {
      e = {
        velas: { M5: [], M15: [], H1: [] }, cur: {}, atr: 0,
        zonas: [], sesgo: 'lateral', ultSenalZona: new Map(), ahora: 0,
      };
      this.s.set(simbolo, e);
    }
    return e;
  }

  /* ---------- semilla de historia (velas del servidor) ---------- */
  setHistoria(simbolo, tf, velas) {
    const e = this._estado(simbolo);
    e.velas[tf] = velas.slice(-this.cfg.maxVelas[tf]);
    const ult = e.velas[tf][e.velas[tf].length - 1];
    if (ult && ult.t > e.ahora) e.ahora = ult.t;   // reloj de mercado (no de pared)
    if (tf === 'H1') this._recalcSesgo(simbolo);
    if (tf === 'M15') {
      this._recalcAtr(simbolo);
      // escaneo de pivotes sobre toda la historia -> zonas listas al arrancar
      const m = e.velas.M15;
      for (let i = 2; i <= m.length - 3; i++) this._chequearPivote(simbolo, i);
      // barrido silencioso de TN: mata zonas que el último cierre ya invalidó
      const ult = m[m.length - 1];
      if (ult && e.atr) {
        for (const z of e.zonas) {
          if (z.estado !== 'activa') continue;
          const fuera = z.tipo === 'soporte'
            ? ult.c < z.nivel - this.cfg.tnAtr * e.atr
            : ult.c > z.nivel + this.cfg.tnAtr * e.atr;
          if (fuera) { z.estado = 'muerta'; z.muertaEn = e.ahora; }
        }
      }
    }
  }

  /* ---------- entrada de ticks: agrega velas por TF ---------- */
  onTick(simbolo, bid, ask, t = Date.now()) {
    const precio = (bid + ask) / 2;
    const e = this._estado(simbolo);
    for (const [tf, seg] of Object.entries(TFS)) {
      const t0 = Math.floor(t / (seg * 1000)) * seg * 1000;
      let cur = e.cur[tf];
      if (!cur || cur.t !== t0) {
        if (cur) this.onVelaCerrada(simbolo, tf, cur);
        cur = e.cur[tf] = { t: t0, o: precio, h: precio, l: precio, c: precio };
      } else {
        if (precio > cur.h) cur.h = precio;
        if (precio < cur.l) cur.l = precio;
        cur.c = precio;
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
    if (arr.length > this.cfg.maxVelas[tf]) arr.shift();

    if (tf === 'H1') return this._recalcSesgo(simbolo);
    if (tf === 'M15') {
      this._recalcAtr(simbolo);
      this._detectarPivotes(simbolo);
      this._chequearTN(simbolo, vela);
    }
    if (tf === 'M5') this._chequearToque(simbolo, vela);
  }

  /* ---------- indicadores ---------- */
  _recalcAtr(simbolo) {
    const e = this._estado(simbolo);
    const m = e.velas.M15, p = this.cfg.atrPeriodo;
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
    const h = e.velas.H1, p = this.cfg.emaH1;
    if (h.length < p + 4) { e.sesgo = 'lateral'; return; }
    const k = 2 / (p + 1);
    let ema = h.slice(0, p).reduce((a, v) => a + v.c, 0) / p;
    const serie = [ema];
    for (let i = p; i < h.length; i++) { ema = h[i].c * k + ema * (1 - k); serie.push(ema); }
    const emaUlt = serie[serie.length - 1];
    const emaAntes = serie[serie.length - 4];
    const ultima = h[h.length - 1].c;
    if (ultima > emaUlt && emaUlt > emaAntes) e.sesgo = 'alza';
    else if (ultima < emaUlt && emaUlt < emaAntes) e.sesgo = 'baja';
    else e.sesgo = 'lateral';
  }

  /* ---------- zonas: pivotes fractales M15 (confirmados con 2 velas) ---------- */
  _detectarPivotes(simbolo) {
    const e = this._estado(simbolo);
    if (e.velas.M15.length < 6 || !e.atr) return;
    this._chequearPivote(simbolo, e.velas.M15.length - 3);
    // purga: zonas muertas hace más de 48 h (en tiempo de mercado)
    const corte = e.ahora - 48 * 3600e3;
    e.zonas = e.zonas.filter((z) => !(z.estado === 'muerta' && z.muertaEn < corte));
  }

  _chequearPivote(simbolo, i) {
    const e = this._estado(simbolo);
    const m = e.velas.M15;
    if (i < 2 || i > m.length - 3 || !e.atr) return;
    const v = m[i];
    const esTecho = v.h > m[i - 1].h && v.h > m[i - 2].h && v.h > m[i + 1].h && v.h > m[i + 2].h;
    const esPiso = v.l < m[i - 1].l && v.l < m[i - 2].l && v.l < m[i + 1].l && v.l < m[i + 2].l;
    if (esTecho) this._agregarPivote(simbolo, v.h, 'resistencia', v.t);
    if (esPiso) this._agregarPivote(simbolo, v.l, 'soporte', v.t);
  }

  _agregarPivote(simbolo, nivel, tipo, t) {
    const e = this._estado(simbolo);
    const tol = Math.max(0.0008 * nivel, this.cfg.tolPivoteAtr * (e.atr || 0));
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
  _chequearTN(simbolo, vela) {
    const e = this._estado(simbolo);
    if (!e.atr) return;
    for (const z of e.zonas) {
      if (z.estado !== 'activa') continue;
      const fuera = z.tipo === 'soporte'
        ? vela.c < z.nivel - this.cfg.tnAtr * e.atr
        : vela.c > z.nivel + this.cfg.tnAtr * e.atr;
      if (fuera) {
        z.estado = 'muerta'; z.muertaEn = e.ahora;
        this.emit('tn', { simbolo, zona: this._vista(z), vela, motivo: 'cierre M15 más allá de la zona' });
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

      const compra = z.tipo === 'soporte' && e.sesgo === 'alza' && vela.c > vela.o;
      const venta = z.tipo === 'resistencia' && e.sesgo === 'baja' && vela.c < vela.o;
      if (!compra && !venta) continue;
      const lado = compra ? 'COMPRA' : 'VENTA';

      const ult = e.ultSenalZona.get(z.id) || 0;
      if (e.ahora - ult < this.cfg.dedupMin * 60e3) continue;

      let score = PESO_FASE[fase]
        + Math.min(25, z.fuerza * 5)   // fuerza de zona (pivotes acumulados)
        + 25                           // alineación con sesgo H1 (ya requerida)
        + 10;                          // vela M5 direccional (ya requerida)
      score = Math.min(100, score);
      if (score < this.cfg.scoreMin) continue;

      e.ultSenalZona.set(z.id, e.ahora);
      this.emit('senal', {
        lado, fase, simbolo,
        nivel: +z.nivel.toFixed(2),
        precio: +vela.c.toFixed(2),
        score, tfZona: 'M15', tfGatillo: 'M5',
        sesgo: e.sesgo, fuerzaZona: z.fuerza, toques: z.toques,
        sl: compra ? +(z.nivel - e.atr).toFixed(2) : +(z.nivel + e.atr).toFixed(2),
        tp: compra ? +(vela.c + 2 * e.atr).toFixed(2) : +(vela.c - 2 * e.atr).toFixed(2),
        t: e.ahora,
        motivo: `${fase} en ${z.tipo} (fuerza ${z.fuerza}) con sesgo H1 al ${e.sesgo}`,
      });
    }
  }

  _vista(z) { return { id: z.id, tipo: z.tipo, nivel: +z.nivel.toFixed(2), fuerza: z.fuerza, toques: z.toques, estado: z.estado }; }

  /* ---------- resumen serializable para /estado ---------- */
  resumen() {
    const out = {};
    for (const [simbolo, e] of this.s) {
      out[simbolo] = {
        sesgo: e.sesgo, atr: +e.atr.toFixed(3),
        zonasActivas: e.zonas.filter((z) => z.estado === 'activa').length,
        velas: { M5: e.velas.M5.length, M15: e.velas.M15.length, H1: e.velas.H1.length },
      };
    }
    return out;
  }
}

module.exports = { Estrategia, TFS };
