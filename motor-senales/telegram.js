'use strict';
/* Notificación por Telegram (Bot API oficial, sin dependencias).
   Requiere TELEGRAM_TOKEN y TELEGRAM_CHAT en .env o entorno. */

function telegramConfigurado() {
  return Boolean(process.env.TELEGRAM_TOKEN && process.env.TELEGRAM_CHAT);
}

async function enviarTelegram(texto) {
  if (!telegramConfigurado()) return { ok: false, motivo: 'telegram no configurado' };
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
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok && j.ok !== false, respuesta: j };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function formatearSenal(s) {
  const icono = s.lado === 'COMPRA' ? '🟢' : '🔴';
  return [
    `${icono} <b>${s.lado} · ${s.simbolo}</b>  (score ${s.score})`,
    `Fase: <b>${s.fase}</b> · Sesgo H1: ${s.sesgo}`,
    `Nivel (${s.tfZona}): ${s.nivel} · Precio: ${s.precio}`,
    `SL: ${s.sl} · TP: ${s.tp}`,
    `${s.motivo}`,
  ].join('\n');
}

module.exports = { enviarTelegram, formatearSenal, telegramConfigurado };
