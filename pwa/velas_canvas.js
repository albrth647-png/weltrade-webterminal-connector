'use strict';
/* ============================================================
   PANEL DE VELAS EN <canvas> — WT Motor PWA
   ------------------------------------------------------------
   Gráfico nativo (sin librerías, sin red: dibuja lo que ya
   vive en el motor) con:

   · velas del TF elegido (M5/M15/H1) + vela en formación
     semitransparente reconstruida de ticks en vivo
   · zonas activas dibujadas: soporte verde, resistencia roja,
     con su fuerza (nº de pivotes)
   · marcadores de las últimas señales del símbolo (▲ COMPRA
     bajo la vela, ▼ VENTA sobre la vela) con su score
   · línea punteada del último precio con etiqueta en el eje
   · gestos: arrastrar = desplazar · pellizco/rueda = zoom ·
     doble toque = volver al presente (seguir en vivo)
   · hover de ratón: crosshair + OHLC de la vela apuntada

   Escala de dispositivo (devicePixelRatio) para nitidez en
   móviles; render bajo requestAnimationFrame y SOLO cuando
   cambian datos o vista (0 CPU en reposo).
   ============================================================ */

const C = {
  fondo: '#0d1117', rejilla: '#21262d', eje: '#8b949e', texto: '#c9d1d9',
  alza: '#3fb950', baja: '#f85149', soporte: '#3fb950', resistencia: '#f85149',
  precio: '#58a6ff', crosshair: '#8b949e',
};

const EJE_ANCHO = 58;      // px reservados a la derecha para precios
const EJE_ALTO = 20;       // px reservados abajo para horas
const PASO_MIN = 2.2;      // vela más estrecha (px por vela)
const PASO_MAX = 34;
const PAD = 0.08;          // holgura vertical del rango visible

export class PanelVelas {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this._datos = { velas: [], formando: null, zonas: [], senales: [] };
    this._paso = 7;            // px por vela (zoom)
    this._offsetFin = 0;       // velas escondidas desde el borde derecho (0 = en vivo)
    this._sucio = true;
    this._raf = 0;
    this._hover = null;        // {x,y} del ratón
    this._ultToqueFin = 0;     // para doble toque
    this._render = this._render.bind(this);
    this._anclar();
    this._observarTamano();
    this._programar();
  }

  /* ---------- datos ---------- */
  /* velas puede ser la referencia VIVA del motor: se lee en cada pintado */
  actualizar({ velas = [], formando = null, zonas = [], senales = [] } = {}) {
    this._datos = { velas, formando, zonas, senales };
    this._sucio = true;
    this._programar();
  }

  destruir() {
    cancelAnimationFrame(this._raf);
    this._ro?.disconnect();
    // todos los listeners van sobre this.cv: al quitar el nodo, mueren solos
  }

  /* ---------- infraestructura ---------- */
  _observarTamano() {
    const medir = () => {
      const r = this.cv.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
      if (this.cv.width !== w || this.cv.height !== h) {
        this.cv.width = w; this.cv.height = h;
        this._dpr = dpr;
        this._w = r.width; this._h = r.height;
        this._sucio = true;
        this._programar();
      }
    };
    this._ro = new ResizeObserver(medir);
    this._ro.observe(this.cv);
    medir();
  }

  _programar() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; if (this._sucio) { this._sucio = false; this._render(); } });
  }

  _plot() {
    return { x0: 0, x1: this._w - EJE_ANCHO, y0: 0, y1: this._h - EJE_ALTO };
  }

  /* índice global de la vela dibujada en x (float) */
  _idxEn(x) {
    const p = this._plot();
    const n = this._datos.velas.length;
    return (n - 1 - this._offsetFin) - (p.x1 - x) / this._paso;
  }
  _xDe(idx) {
    const p = this._plot();
    const n = this._datos.velas.length;
    return p.x1 - ((n - 1 - this._offsetFin) - idx) * this._paso;
  }

  /* ---------- gestos ---------- */
  _anclar() {
    const cv = this.cv;
    cv.style.touchAction = 'none';

    let puntero = null;   // {x, offset0} en paneo
    let pinza = null;     // {d, paso0, idxAncla, xAncla}

    cv.addEventListener('touchstart', (ev) => {
      if (ev.touches.length === 1) {
        const t = ev.touches[0];
        puntero = { x: t.clientX, offset0: this._offsetFin, movio: 0, t0: Date.now() };
      } else if (ev.touches.length === 2) {
        puntero = null;
        const [a, b] = ev.touches;
        const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const xm = (a.clientX + b.clientX) / 2;
        pinza = { d, paso0: this._paso, idxAncla: this._idxEn(xm), xAncla: xm - cv.getBoundingClientRect().left };
      }
    }, { passive: true });

    cv.addEventListener('touchmove', (ev) => {
      ev.preventDefault();   // el panel se come el gesto: la página no scrollea
      const r = cv.getBoundingClientRect();
      if (ev.touches.length === 2 && pinza) {
        const [a, b] = ev.touches;
        const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        this._paso = Math.min(PASO_MAX, Math.max(PASO_MIN, pinza.paso0 * (d / (pinza.d || 1))));
        this._irAAncla(pinza.idxAncla, pinza.xAncla);
        this._sucio = true; this._programar();
      } else if (ev.touches.length === 1 && puntero) {
        const t = ev.touches[0];
        const dx = t.clientX - puntero.x;
        puntero.movio += Math.abs(dx);
        this._offsetFin = Math.max(0, Math.min(this._maxOffset(), puntero.offset0 + dx / this._paso));
        this._sucio = true; this._programar();
      }
    }, { passive: false });

    cv.addEventListener('touchend', (ev) => {
      if (puntero && puntero.movio < 8 && Date.now() - puntero.t0 < 250) {
        const ahora = Date.now();
        if (ahora - this._ultToqueFin < 300) {   // doble toque: volver al presente
          this._offsetFin = 0;
          this._ultToqueFin = 0;
        } else {
          this._ultToqueFin = ahora;
        }
        this._sucio = true; this._programar();
      }
      if (ev.touches.length < 2) pinza = null;
      if (!ev.touches.length) puntero = null;
    }, { passive: true });

    /* ratón: paneo con arrastre + zoom con rueda + crosshair */
    cv.addEventListener('mousedown', (ev) => {
      const r = cv.getBoundingClientRect();
      puntero = { x: ev.clientX, offset0: this._offsetFin, movio: 0, t0: Date.now() };
      this._hover = { x: ev.clientX - r.left, y: ev.clientY - r.top };
    });
    window.addEventListener('mousemove', (ev) => {
      const r = cv.getBoundingClientRect();
      if (puntero && puntero.movio !== undefined) {
        const dx = ev.clientX - puntero.x;
        puntero.movio += Math.abs(dx);
        if (puntero.movio > 2) {
          this._offsetFin = Math.max(0, Math.min(this._maxOffset(), puntero.offset0 + dx / this._paso));
          this._sucio = true; this._programar();
        }
      }
      this._hover = (ev.clientY >= r.top && ev.clientY <= r.bottom && ev.clientX >= r.left && ev.clientX <= r.right)
        ? { x: ev.clientX - r.left, y: ev.clientY - r.top } : null;
      this._sucio = true; this._programar();
    });
    window.addEventListener('mouseup', () => { puntero = null; });
    cv.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const r = cv.getBoundingClientRect();
      const xAncla = ev.clientX - r.left;
      const idxAncla = this._idxEn(xAncla);
      const factor = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
      this._paso = Math.min(PASO_MAX, Math.max(PASO_MIN, this._paso * factor));
      this._irAAncla(idxAncla, xAncla);
      this._sucio = true; this._programar();
    }, { passive: false });
  }

  /* mantiene el índice ancla en la misma x tras un zoom */
  _irAAncla(idxAncla, xAncla) {
    const p = this._plot();
    const n = this._datos.velas.length;
    const nuevo = idxAncla + (p.x1 - xAncla) / this._paso;
    this._offsetFin = Math.max(0, Math.min(this._maxOffset(), n - 1 - nuevo));
  }

  _maxOffset() {
    const p = this._plot();
    const visibles = Math.max(3, Math.floor((p.x1 - p.x0) / this._paso));
    return Math.max(0, this._datos.velas.length + (this._datos.formando ? 1 : 0) - Math.floor(visibles * 0.4));
  }

  /* ---------- render ---------- */
  _decimales(p) { return p < 10 ? 4 : p < 100 ? 3 : p < 1000 ? 2 : 2; }

  _render() {
    const ctx = this.ctx;
    const { velas, formando, zonas, senales } = this._datos;
    const w = this._w, h = this._h;
    if (!w || !h) return;
    ctx.setTransform(this._dpr || 1, 0, 0, this._dpr || 1, 0, 0);
    ctx.fillStyle = C.fondo;
    ctx.fillRect(0, 0, w, h);

    const p = this._plot();
    const total = velas.length + (formando ? 1 : 0);
    if (!total) {
      ctx.fillStyle = C.eje;
      ctx.font = '13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('sin velas todavía — conecta el motor', w / 2, h / 2);
      return;
    }

    /* ventana visible */
    const visibles = Math.max(3, Math.ceil((p.x1 - p.x0) / this._paso));
    const desde = Math.max(0, Math.floor(velas.length - visibles - this._offsetFin));
    const hasta = Math.min(velas.length, Math.ceil(velas.length - this._offsetFin) + 1);
    const vista = velas.slice(desde, hasta);
    /* la vela viva solo entra si la ventana llega al borde actual
       (viajando al pasado no debe estirar la escala con su precio) */
    if (formando && this._offsetFin <= 1) vista.push(formando);

    /* rango de precios visible */
    let ymin = Infinity, ymax = -Infinity;
    for (const v of vista) { if (v.l < ymin) ymin = v.l; if (v.h > ymax) ymax = v.h; }
    if (!Number.isFinite(ymin)) { ymin = 0; ymax = 1; }
    const margen = Math.max((ymax - ymin) * PAD, ymax * 1e-6);
    ymin -= margen; ymax += margen;
    const py = (precio) => p.y1 - ((precio - ymin) / (ymax - ymin)) * (p.y1 - p.y0);
    const dec = this._decimales((ymin + ymax) / 2);

    /* rejilla horizontal + eje de precios */
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const precio = ymin + ((ymax - ymin) * i) / 4;
      const y = Math.round(py(precio)) + 0.5;
      ctx.strokeStyle = C.rejilla;
      ctx.beginPath(); ctx.moveTo(p.x0, y); ctx.lineTo(p.x1, y); ctx.stroke();
      ctx.fillStyle = C.eje;
      ctx.fillText(precio.toFixed(dec), p.x1 + 6, y);
    }

    /* zonas activas (soporte/resistencia) dentro del rango */
    ctx.setLineDash([5, 4]);
    for (const z of zonas) {
      if (z.nivel < ymin || z.nivel > ymax) continue;
      const y = Math.round(py(z.nivel)) + 0.5;
      ctx.strokeStyle = z.tipo === 'soporte' ? C.soporte : C.resistencia;
      ctx.beginPath(); ctx.moveTo(p.x0, y); ctx.lineTo(p.x1, y); ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.textAlign = 'left';
      ctx.fillText(`${z.tipo === 'soporte' ? 'S' : 'R'} ${z.nivel.toFixed(dec)} · fuerza ${z.fuerza}`, p.x0 + 4, y - 8);
    }
    ctx.setLineDash([]);

    /* velas */
    const cuerpo = Math.max(1, Math.min(this._paso - 1.5, Math.floor(this._paso * 0.72)));
    for (let k = 0; k < vista.length; k++) {
      const v = vista[k];
      const esFormando = formando && k === vista.length - 1 && velas.length && v.t === formando.t;
      const x = Math.round(this._xDe(desde + k)) + 0.5;
      if (x < p.x0 - this._paso || x > p.x1 + this._paso) continue;
      const alza = v.c >= v.o;
      ctx.globalAlpha = esFormando ? 0.55 : 1;
      ctx.strokeStyle = alza ? C.alza : C.baja;
      ctx.fillStyle = alza ? C.alza : C.baja;
      /* mecha */
      ctx.beginPath();
      ctx.moveTo(x, py(v.h));
      ctx.lineTo(x, py(v.l));
      ctx.stroke();
      /* cuerpo */
      const yo = py(v.o), yc = py(v.c);
      const arriba = Math.min(yo, yc), alto = Math.max(1, Math.abs(yc - yo));
      if (this._paso >= 3.2) ctx.fillRect(x - cuerpo / 2, arriba, cuerpo, alto);
      if (esFormando) {   // borde punteado para distinguir la vela viva
        ctx.setLineDash([2, 2]);
        ctx.strokeRect(x - cuerpo / 2 - 0.5, arriba - 0.5, cuerpo + 1, alto + 1);
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;
    }

    /* marcadores de señales recientes del símbolo */
    for (const s of senales) {
      if (!s.t) continue;
      const idx = this._idxDeTiempo(velas, s.t);
      if (idx === -1) continue;
      const x = this._xDe(idx);
      if (x < p.x0 || x > p.x1) continue;
      const v = velas[idx];
      const compra = s.lado === 'COMPRA';
      const y = compra ? py(v.l) + 10 : py(v.h) - 10;
      ctx.fillStyle = compra ? C.alza : C.baja;
      ctx.beginPath();
      if (compra) { ctx.moveTo(x, y + 6); ctx.lineTo(x - 5, y - 3); ctx.lineTo(x + 5, y - 3); }
      else { ctx.moveTo(x, y - 6); ctx.lineTo(x - 5, y + 3); ctx.lineTo(x + 5, y + 3); }
      ctx.closePath(); ctx.fill();
      if (this._paso >= 6) {
        ctx.fillStyle = C.texto;
        ctx.font = '9px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(String(s.score ?? ''), x, compra ? y + 14 : y - 12);
      }
    }

    /* último precio + etiqueta en el eje */
    const ult = formando || velas[velas.length - 1];
    if (ult) {
      const y = Math.round(py(ult.c)) + 0.5;
      if (y >= p.y0 && y <= p.y1) {
        ctx.strokeStyle = C.precio;
        ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(p.x0, y); ctx.lineTo(p.x1, y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = C.precio;
        ctx.fillRect(p.x1 + 2, y - 8, EJE_ANCHO - 4, 16);
        ctx.fillStyle = '#0d1117';
        ctx.textAlign = 'left';
        ctx.font = 'bold 11px ui-monospace, monospace';
        ctx.fillText(ult.c.toFixed(dec), p.x1 + 6, y);
      }
    }

    /* eje de tiempos */
    ctx.fillStyle = C.eje;
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const cadaCuantas = Math.max(1, Math.round(80 / this._paso));
    for (let k = vista.length - 1; k >= 0; k -= cadaCuantas) {
      const v = vista[k];
      const x = this._xDe(desde + k);
      if (x < p.x0 + 14 || x > p.x1 - 14) continue;
      const d = new Date(v.t);
      ctx.fillText(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, x, p.y1 + 14);
    }

    /* crosshair (ratón) + OHLC de la vela apuntada */
    if (this._hover && this._hover.x < p.x1) {
      const idx = Math.round(this._idxEn(this._hover.x));
      if (idx >= desde && idx < desde + vista.length) {
        const v = velas[idx] || (formando && idx === velas.length ? formando : null);
        const x = Math.round(this._xDe(idx)) + 0.5;
        ctx.strokeStyle = C.crosshair;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(x, p.y0); ctx.lineTo(x, p.y1); ctx.stroke();
        if (this._hover.y < p.y1) {
          ctx.beginPath(); ctx.moveTo(p.x0, this._hover.y); ctx.lineTo(p.x1, this._hover.y); ctx.stroke();
        }
        ctx.setLineDash([]);
        if (v) {
          const dec2 = this._decimales(v.c);
          ctx.fillStyle = C.texto;
          ctx.font = '11px ui-monospace, monospace';
          ctx.textAlign = 'left';
          ctx.fillText(
            `${new Date(v.t).toLocaleString()}  O ${v.o.toFixed(dec2)}  H ${v.h.toFixed(dec2)}  L ${v.l.toFixed(dec2)}  C ${v.c.toFixed(dec2)}`,
            p.x0 + 6, p.y0 + 12);
        }
      }
    }
  }

  _idxDeTiempo(velas, t) {
    if (!velas.length) return -1;
    let a = 0, b = velas.length - 1;
    if (t < velas[a].t || t > velas[b].t + 300e3) return -1;
    while (a < b) {
      const m = (a + b) >> 1;
      if (velas[m].t < t) a = m + 1; else b = m;
    }
    return a;
  }
}
