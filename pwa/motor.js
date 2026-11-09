'use strict';
/* ============================================================
   ESTRATEGIA "RAPTOR-LIKE" — portado al navegador (PWA)
   ------------------------------------------------------------
   Idéntico al motor validado (motor-senales/estrategia.js),
   sin Node: EventEmitter sustituido por un emisor mínimo.

   · ZONAS   : pivotes fractales de M15, agrupados por proximidad
   · TOQUES  : EARLY / MAIN / LATE
   · TN      : cierre M15 a 0.5×ATR del nivel mata la zona
   · SESGO   : H1 — EMA(30) y su pendiente -> alza/baja/lateral
   · GATILLO : vela M5 direccional tocando la zona alineada
   Todo con velas CERRADAS (sin look-ahead).
   ============================================================ */

const TFS = { M5: 300, M15: 900, H1: 3600 };

/* Búfer de velas por TF que el motor conserva en memoria.
   M5 3000 ≈ 10,4 días · M15 2000 ≈ 20,8 días · H1 1000 ≈ 41,7 días.
   app.js usa esta misma tabla para recortar lo que guarda en IndexedDB. */
export const MAX_VELAS_TF = { M5: 3000, M15: 2000, H1: 1000 };
const PESO_FASE = { EARLY: 25, MAIN: 40, LATE: 15 };

class Emisor {
  constructor() { this._l = {}; }
  on(ev, fn) { (this._l[ev] ??= []).push(fn); return this; }
  emit(ev, d) { for (const f of this._l[ev] || []) { try { f(d); } catch (e) { console.error(e); } } }
}

export class Estrategia extends Emisor {
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
      maxVelas: { ...MAX_VELAS_TF },
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
    const arr = velas.slice(-this.cfg.maxVelas[tf]);
    /* El servidor incluye al final la vela EN FORMACIÓN. Sin quitarla
       queda congelada para siempre: bloquea el cierre real (mismo t en
       onVelaCerrada) y envenena TN y pivotes con un cierre parcial. */
    const seg = TFS[tf] || 0;
    while (arr.length && seg && arr[arr.length - 1].t + seg * 1000 > Date.now()) arr.pop();
    e.velas[tf] = arr;
    const ult = e.velas[tf][e.velas[tf].length - 1];
    if (ult && ult.t > e.ahora) e.ahora = ult.t;   // reloj de mercado (no de pared)
    if (tf === 'H1') this._recalcSesgo(simbolo);
    if (tf === 'M15') {
      this._recalcAtr(simbolo);
      // escaneo de pivotes sobre toda la historia -> zonas listas al arrancar
      const m = e.velas.M15;
      for (let i = 2; i <= m.length - 3; i++) this._chequearPivote(simbolo, i);
      // barrido silencioso de TN: mata zonas que el último cierre ya invalidó
      const ult15 = m[m.length - 1];
      if (ult15 && e.atr) {
        for (const z of e.zonas) {
          if (z.estado !== 'activa') continue;
          const fuera = z.tipo === 'soporte'
            ? ult15.c < z.nivel - this.cfg.tnAtr * e.atr
            : ult15.c > z.nivel + this.cfg.tnAtr * e.atr;
          if (fuera) { z.estado = 'muerta'; z.muertaEn = e.ahora; }
        }
      }
    }
  }

  /* ---------- lectura del histórico vivo (para persistirlo y para el gráfico) ---------- */
  historia(simbolo) {
    const e = this.s.get(simbolo);
    if (!e) return null;
    return { M5: e.velas.M5, M15: e.velas.M15, H1: e.velas.H1 };
  }

  /* Zonas activas de un símbolo (vista serializable) — para el panel canvas. */
  zonasDe(simbolo) {
    const e = this.s.get(simbolo);
    if (!e) return [];
    return e.zonas.filter((z) => z.estado === 'activa').map((z) => this._vista(z));
  }

  /* Vela en formación (agregada de ticks) de un símbolo/TF — para el panel canvas. */
  velaActual(simbolo, tf) {
    const e = this.s.get(simbolo);
    return e ? (e.cur[tf] || null) : null;
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

  /* ---------- procesado de vela cerrada ---------- */
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
    if (m.length < p + 1) { e.atr = 0; return; }
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
        t: e.ahora,
        motivo: `${fase} en ${z.tipo} (fuerza ${z.fuerza}) con sesgo H1 al ${e.sesgo}`,
      });
    }
  }

  _vista(z) { return { id: z.id, tipo: z.tipo, nivel: +z.nivel.toFixed(2), fuerza: z.fuerza, toques: z.toques, estado: z.estado }; }

  /* ---------- resumen serializable ---------- */
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

/* ---------- Telegram directo desde el navegador (Bot API, CORS OK) ---------- */
const escTg = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/* Con timeout (10 s) y 1 reintento: sin AbortController un Telegram
   colgado dejaba la señal en el limbo y el log sin explicación.
   429 respeta retry_after del Bot API (máx 5 s). */
export async function enviarTelegram(token, chat, texto, { intentos = 2 } = {}) {
  if (!token || !chat) return { ok: false, motivo: 'telegram no configurado' };
  for (let i = 1; i <= intentos; i++) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text: texto, parse_mode: 'HTML', disable_web_page_preview: true }),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok !== false) return { ok: true, respuesta: j };
      const retry429 = r.status === 429 ? Math.min(5, Number(j?.parameters?.retry_after) || 1) : 0;
      if (i < intentos && (retry429 || r.status >= 500)) {
        await new Promise((ok) => setTimeout(ok, retry429 * 1000 || 2000));
        continue;
      }
      return { ok: false, respuesta: j, motivo: `HTTP ${r.status}${j?.description ? ' — ' + j.description : ''}` };
    } catch (e) {
      if (i < intentos) { await new Promise((ok) => setTimeout(ok, 2000)); continue; }
      return { ok: false, error: e.name === 'AbortError' ? 'timeout 10 s' : e.message };
    }
  }
}

export function formatearSenal(s) {
  const icono = s.lado === 'COMPRA' ? '🟢' : '🔴';
  const hora = new Date(s.horaPared || s.t || Date.now()).toISOString().slice(0, 16).replace('T', ' ');
  /* escHTML: el símbolo viene del catálogo del servidor — si trajera <, >
     o &, el parse_mode HTML devolvía 400 y la señal NUNCA llegaba */
  return [
    `${icono} <b>${escTg(s.lado)} · ${escTg(s.simbolo)}</b>  (score ${s.score})`,
    `Fase: <b>${escTg(s.fase)}</b> · Sesgo H1: ${escTg(s.sesgo)}`,
    `Nivel (${escTg(s.tfZona)}): ${s.nivel} · Precio: ${s.precio}`,
    `${escTg(s.motivo)}`,
    `Hora: ${hora} UTC`,
  ].join('\n');
}
