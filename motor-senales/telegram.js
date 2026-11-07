'use strict';
/* Notificación por Telegram (Bot API oficial, sin dependencias).
   Requiere TELEGRAM_TOKEN y TELEGRAM_CHAT en .env o entorno.
   Con timeout (10 s) y 1 reintento: sin timeout, un Telegram colgado
   dejaba la señal en el limbo sin explicación en el log. 429 respeta
   retry_after del Bot API (máx 5 s). */

function telegramConfigurado() {
  return Boolean(process.env.TELEGRAM_TOKEN && process.env.TELEGRAM_CHAT);
}

async function enviarTelegram(texto, { intentos = 2 } = {}) {
  if (!telegramConfigurado()) return { ok: false, motivo: 'telegram no configurado' };
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
        signal: AbortSignal.timeout(10000),   // Node >= 17.3
      });
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
      return { ok: false, error: e.name === 'TimeoutError' ? 'timeout 10 s' : e.message };
    }
  }
}

/* escHTML: el símbolo viene del catálogo del servidor — si trajera <, >
   o &, el parse_mode HTML devolvía 400 y la señal NUNCA llegaba */
const escTg = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function formatearSenal(s) {
  const icono = s.lado === 'COMPRA' ? '🟢' : '🔴';
  const hora = new Date(s.t || Date.now()).toISOString().slice(0, 16).replace('T', ' ');
  return [
    `${icono} <b>${escTg(s.lado)} · ${escTg(s.simbolo)}</b>  (score ${s.score})`,
    `Fase: <b>${escTg(s.fase)}</b> · Sesgo H1: ${escTg(s.sesgo)}`,
    `Nivel (${escTg(s.tfZona)}): ${s.nivel} · Precio: ${s.precio}`,
    `SL: ${s.sl} · TP: ${s.tp}`,
    `${escTg(s.motivo)}`,
    `Hora: ${hora} UTC`,
  ].join('\n');
}

module.exports = { enviarTelegram, formatearSenal, telegramConfigurado };
