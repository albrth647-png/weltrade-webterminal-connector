'use strict';
const { horaHabana } = require('./tiempo');
/* Notificación por Telegram (Bot API oficial, sin dependencias).
   Requiere TELEGRAM_TOKEN y TELEGRAM_CHAT en .env o entorno.

   Cola con dos carriles y sin bloqueo en cabeza:
     · alta  = entradas (salen primero)
     · baja  = avisos de zona (toques 1/2/3, aviso intrabar)
   El límite del Bot API (~1 mensaje/s por chat) se respeta con un hueco de
   1,1 s entre arranques, pero un POST lento (timeout 4 s) YA NO frena a los
   siguientes: antes la cola era una cadena de promesas y un timeout de 10 s
   dejaba 10 s parados a todos los mensajes de detrás.

   429 y 5xx se reintentan (son rechazos del servidor). Un timeout NO se
   reintenta: el mensaje pudo llegar y el reintento lo duplicaría. */

function telegramConfigurado() {
  return Boolean(process.env.TELEGRAM_TOKEN && process.env.TELEGRAM_CHAT);
}

const MIN_MS_ENTRE_ENVIOS = 1100;
const TIMEOUT_MS = 4000;
const MAX_PENDIENTES = 200;

const colaAlta = [];   // prioridad 0: entradas
const colaBaja = [];   // prioridad 1: avisos
let proximoPermitido = 0;
let temporizador = null;
const stats = { enviados: 0, fallos: 0, descartados: 0, ultimoMessageId: null };

async function _enviar(texto, intentos) {
  for (let i = 1; i <= intentos; i++) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: process.env.TELEGRAM_CHAT,
          text: texto,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),   // Node >= 17.3
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.ok !== false) return { ok: true, respuesta: j, messageId: j?.result?.message_id ?? null };
      const retry429 = r.status === 429 ? Math.min(5, Number(j?.parameters?.retry_after) || 1) : 0;
      if (i < intentos && (retry429 || r.status >= 500)) {
        await new Promise((ok) => setTimeout(ok, retry429 * 1000 || 2000));
        continue;
      }
      return { ok: false, respuesta: j, motivo: `HTTP ${r.status}${j?.description ? ' — ' + j.description : ''}` };
    } catch (e) {
      /* timeout / red caída: NO se reintenta (podría duplicar el mensaje) */
      return { ok: false, error: e.name === 'TimeoutError' ? `timeout ${TIMEOUT_MS / 1000} s (puede haberse entregado)` : e.message };
    }
  }
}

const _siguiente = () => colaAlta.shift() || colaBaja.shift() || null;

/* Un solo temporizador: cada turno arranca UN envío y agenda el siguiente.
   El envío no se espera, así que un POST de 4 s no retrasa a los de detrás. */
function _bombear() {
  if (temporizador) return;
  const espera = Math.max(0, proximoPermitido - Date.now());
  temporizador = setTimeout(() => {
    temporizador = null;
    const tarea = _siguiente();
    if (!tarea) return;
    proximoPermitido = Date.now() + MIN_MS_ENTRE_ENVIOS;
    _enviar(tarea.texto, tarea.intentos).then((r) => {
      if (r.ok) { stats.enviados++; stats.ultimoMessageId = r.messageId; } else stats.fallos++;
      tarea.resolver(r);
    });
    _bombear();
  }, espera);
}

/* prioridad 0 = entrada, 1 = aviso. Nunca lanza: devuelve {ok, motivo}. */
function enviarTelegram(texto, { intentos = 2, prioridad = 0 } = {}) {
  if (!telegramConfigurado()) return Promise.resolve({ ok: false, motivo: 'telegram no configurado' });
  return new Promise((resolver) => {
    if (colaAlta.length + colaBaja.length >= MAX_PENDIENTES) {
      /* con la cola llena se descarta el aviso más viejo, nunca una entrada */
      const victima = colaBaja.shift() || colaAlta.shift();
      stats.descartados++;
      if (victima) victima.resolver({ ok: false, motivo: 'cola llena: descartado' });
    }
    (prioridad > 0 ? colaBaja : colaAlta).push({ texto, intentos, resolver });
    _bombear();
  });
}

function estadoTelegram() {
  return { ...stats, pendientes: colaAlta.length + colaBaja.length };
}

/* escHTML: el símbolo viene del catálogo del servidor — si trajera <, > o &
   el parse_mode HTML devolvía 400 y la señal NUNCA llegaba */
const escTg = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
/* Recorte previo al escape: Telegram rechaza mensajes > 4096 caracteres.
   Se truncan campos de texto libre (simbodo, temporalidad, patrón, estrategia,
   tendencia) sin tocar entidades HTML ni el formato de los números. */
const _recortarTg = (v, max) => {
  const s = String(v ?? '');
  return s.length > max ? s.slice(0, max) + '…' : s;
};

/* Formatea un precio: máximo 5 decimales, sin ceros sobrantes.
   195767.89 no se convierte en 195767.89000. Devuelve '—' si no es válido. */
function _fmtPrecio(v) {
  if (!Number.isFinite(v) || v <= 0) return '—';
  return Number(v).toFixed(5).replace(/0+$/, '').replace(/\.$/, '');
}

/* Tendencia que el operador ve en el gráfico; se muestra junto al lado para
   que no haya duda de que la señal va a favor de la pila EMA30/50/100. */
function _tendenciaTxt(t) {
  if (t === 'ALCISTA') return 'ALCISTA (EMA30 > EMA50 > EMA100)';
  if (t === 'BAJISTA') return 'BAJISTA (EMA30 < EMA50 < EMA100)';
  if (t === 'LATERAL') return 'LATERAL (precio y EMAs no alineados)';
  return '—';
}

/* El TF mayor va corto: ALCISTA/BAJISTA ya se entienden. En LATERAL se
   aclara que no siempre son EMAs cruzadas: también puede ser precio en el
   lado contrario de la EMA30 (retroceso dentro de una pila alineada). */
const _tendenciaMayorTxt = (t) => (t === 'LATERAL' ? 'LATERAL (precio y EMAs no alineados)' : t);

/* Formato pedido: lado + 5 campos numerados (activo, temporalidad,
   estrategia, precio, hora). Sin SL/TP: el mensaje es la señal, no
   una orden con niveles (y el SL/TP anterior se calculaba con la
   distancia en ATR como si fueran puntos de precio).
     🟢 COMPRA
     1. Activo: SFX Vol 40
     2. Temporalidad: M15 · entrada M5
     3. Estrategia: Raptor-híbrida
     4. Precio entrada: 2458.12 (vela cerrada)
     5. Hora: 2026-11-08 09:35 (Habana) */
function formatearSenal(s) {
  const icono = s.lado === 'COMPRA' ? '🟢' : '🔴';
  /* La hora que se enseña es la de la VELA (su apertura), que es como la
     etiqueta MT5; s.t es el instante de emisión (cierre) y se usa solo si no
     viene tVela. */
  const hora = horaHabana(s.tVela ?? s.t ?? Date.now());
  const tf = s.tfGatillo && s.tfGatillo !== s.tfZona
    ? `${_recortarTg(s.tfZona, 24)} · entrada ${_recortarTg(s.tfGatillo, 24)}`
    : _recortarTg(s.tfZona, 48);
  /* el código de patrón del vídeo 03 (1 · 2B · 2RB · 3B · 3RB y las
     entradas al toque 2/3 · 2R/3R) es lo que identifica la jugada */
  const etiquetaEstrategia = s.patron
    ? `${escTg(_recortarTg(s.patron, 24))} · ${escTg(_recortarTg(s.estrategia || 'Raptor-v03', 48))}`
    : escTg(_recortarTg(s.estrategia || 'Raptor-v03', 48));
  return [
    `${icono} <b>${escTg(s.lado || (icono === '🟢' ? 'COMPRA' : 'VENTA'))}</b>`,
    `<b>1. Activo:</b> ${escTg(_recortarTg(s.simbolo, 64))}`,
    `<b>2. Temporalidad:</b> ${escTg(tf || '—')}`,
    `<b>3. Estrategia:</b> ${etiquetaEstrategia}`,
    `<b>4. Tendencia:</b> ${escTg(_recortarTg(_tendenciaTxt(s.tendencia), 48))}${s.tfTendencia && s.tfTendencia !== s.tfZona && s.tendenciaMayor ? ` · ${escTg(_recortarTg(s.tfTendencia, 24))} ${escTg(_recortarTg(_tendenciaMayorTxt(s.tendenciaMayor), 48))}` : ''}`,
    `<b>5. Precio entrada:</b> ${_fmtPrecio(s.precio)} (vela cerrada)`,
    `<b>6. Hora:</b> ${hora} (Habana)`,
  ].join('\n');
}

/* Formato para avisos: no son entradas. Dos orígenes:
   · 'cierre'   — el toque 1/2/3 aparece al cerrar la vela (nivel a romper)
   · 'intrabar' — el precio acaba de entrar en la banda de la zona (aviso inmediato)
   Acepta también un texto plano (compatibilidad). */
function formatearAviso(m) {
  if (!m || typeof m !== 'object') return `⚠️ <b>AVISO (no es entrada)</b>\n${escTg(String(m ?? ''))}`;
  const esIntrabar = m.origen === 'intrabar';
  const icono = m.lado === 'COMPRA' ? '🟢' : '🔴';
  const hora = horaHabana(m.t || Date.now());
  const zona = m.zonaTipo
    ? `${escTg(m.zonaTipo)}${m.zonaFuerza ? ` (fuerza ${m.zonaFuerza})` : ''}`
    : 'sin zona';
  /* Aviso de zona: NO es una señal de la estrategia y el mensaje lo dice.
     Lleva la cotización real (bid/ask) y la distancia a la zona en ATR. */
  if (esIntrabar) {
    const dist = Number.isFinite(m.distZonaAtr) ? ` · ${m.distZonaAtr.toFixed(2)} ATR` : '';
    const cot = Number.isFinite(m.bid) && Number.isFinite(m.ask)
      ? ` (bid ${_fmtPrecio(m.bid)} / ask ${_fmtPrecio(m.ask)})` : '';
    return [
      '🔔 <b>ZONA</b> — el precio ha llegado a una zona',
      '<i>No es una entrada del catálogo (1 · 2B · 3B / reset R).</i>',
      `${icono} <b>${escTg(m.lado)}</b>`,
      `<b>1. Activo:</b> ${escTg(m.simbolo)}`,
      `<b>2. Temporalidad:</b> ${escTg(m.tfZona || '—')}`,
      `<b>3. Zona:</b> ${zona}`,
      `<b>4. Precio ahora:</b> ${_fmtPrecio(m.precio)}${cot}`,
      `<b>5. Nivel de la zona:</b> ${_fmtPrecio(m.nivelRoto)}${dist}`,
      `<b>6. Hora:</b> ${hora} (Habana)`,
    ].join('\n');
  }
  /* El nivel del toque es el extremo de las 8 velas anteriores. Si la propia
     vela del toque ya cerró más allá de él (7 % de los toques medidos), el
     nivel queda DETRÁS del precio: decir «nivel a romper» sobre un nivel ya
     superado parecía una señal invertida. Se nombra como lo que es. */
  const nivelDetras = Number.isFinite(m.precio) && Number.isFinite(m.nivelRoto)
    && (m.lado === 'COMPRA' ? m.nivelRoto <= m.precio : m.nivelRoto >= m.precio);
  /* RAPTOR no usa zonas: si no hay zona, no se inventa «sin zona» ni se
     deja un hueco en la numeración. */
  const nivelLabel = nivelDetras ? 'Nivel del toque' : 'Nivel a romper';
  const nivelValor = nivelDetras
    ? `${_fmtPrecio(m.nivelRoto)} — ya superado por la vela del toque; la entrada llega con el cierre de continuación`
    : _fmtPrecio(m.nivelRoto);
  const lineas = [
    `⚠️ <b>AVISO ${escTg(m.patron)} — no es entrada</b>`,
    `${icono} <b>${escTg(m.lado)}</b>`,
    `<b>1. Activo:</b> ${escTg(m.simbolo)}`,
    `<b>2. Temporalidad:</b> ${escTg(m.tfZona || '—')}`,
    `<b>3. Estrategia:</b> ${escTg(m.estrategia || (String(m.patron || '').includes('E') ? 'Estructura' : 'Raptor-v03'))}`,
    `<b>4. Tendencia:</b> ${escTg(_tendenciaTxt(m.tendencia))}${m.tfTendencia && m.tfTendencia !== m.tfZona && m.tendenciaMayor ? ` · ${escTg(m.tfTendencia)} ${escTg(_tendenciaMayorTxt(m.tendenciaMayor))}` : ''}`,
  ];
  let n = 5;
  if (m.zonaTipo) lineas.push(`<b>${n++}. Zona:</b> ${zona}`);
  lineas.push(`<b>${n++}. Precio de referencia:</b> ${_fmtPrecio(m.precio)} (cierre de la vela del toque)`);
  lineas.push(`<b>${n++}. ${nivelLabel}:</b> ${nivelValor}`);
  lineas.push(`<b>${n++}. Hora:</b> ${hora} (Habana)`);
  return lineas.join('\n');
}

/* Formato para los avisos de RAYA de tendencia (M5/M15/M30/H1).
   Tres casos:
     · 'cambio' — el precio cruzó la raya y no regresó.
     · 'engano' — el precio cruzó la raya y volvió al lado viejo.
     · 'toque'  — el precio tocó la raya con el cuerpo y continuó
                   con la tendencia vigente.
   No es una entrada del catálogo; es un aviso de la raya de tendencia. */
function formatearRaya(e) {
  if (!e || typeof e !== 'object') return `⚠️ <b>RAYA</b>\n${escTg(String(e ?? ''))}`;
  const esCambio = e.clase === 'cambio';
  const esToque = e.clase === 'toque';
  const icono = e.lado === 'COMPRA' ? '🟢' : '🔴';
  const hora = horaHabana(e.t || Date.now());
  const r = e.raya || {};
  const tipoRaya = r.tipo === 'bajista' ? 'bajista (máximos)' : 'alcista (mínimos)';
  const titulo = esCambio
    ? '📈 <b>CAMBIO de tendencia — el precio cruzó la raya y no regresó</b>'
    : esToque
      ? '🫳 <b>TOQUE — el precio tocó la raya y continúa con la tendencia</b>'
      : '🪤 <b>ENGAÑO — el precio cruzó la raya y volvió al lado viejo</b>';
  return [
    titulo,
    '<i>No es una entrada del catálogo; es un aviso de la raya de tendencia.</i>',
    `${icono} <b>${escTg(e.lado)}</b>`,
    `<b>1. Activo:</b> ${escTg(e.simbodo)}`,
    `<b>2. Temporalidad:</b> ${escTg(e.tf || '—')}`,
    `<b>3. Raya:</b> ${escTg(tipoRaya)} · ${r.toques ?? 0} toques${e.nToque ? ` · toque nº ${e.nToque}` : ''}`,
    `<b>4. Precio:</b> ${_fmtPrecio(e.precio)}`,
    `<b>5. Ruptura de la raya:</b> ${_fmtPrecio(r.valorRuptura)}`,
    `<b>6. Evento:</b> ${_fmtPrecio(r.valorEvento)}`,
    `<b>7. Hora:</b> ${hora} (Habana)`,
  ].join('\n');
}

module.exports = { enviarTelegram, formatearSenal, formatearAviso, formatearRaya, telegramConfigurado, estadoTelegram };
