'use strict';
/* ============================================================
   CARRIL URGENTE — push instantáneo + alarma local
   ------------------------------------------------------------
   Telegram es el registro; esto es la ALARMA. Dos canales, sin
   dependencias y sin pasar por Firebase:

     · ntfy: un POST de texto plano a NTFY_URL/NTFY_TOPIC. Con la
       app de ntfy (versión F-Droid, que no usa FCM) el aviso llega
       en menos de un segundo, también con el móvil dormido. Es el
       punto débil de Telegram en Android: Doze retrasa la entrega
       minutos u horas.
     · alarma local: BEL en la consola del PC que corre el motor
       (latencia cero) y, si se define MS_ALARMA_CMD, el sonido que
       se quiera (`MS_ALARMA_CMD=mpv /ruta/alarma.mp3`).

   La configuración se lee en cada envío (no al cargar el módulo):
   así se puede probar y cambiar sin reiniciar nada más.

   Prioridades: entrada = `urgent`; nivel en juego = `high`.
   ============================================================ */
const { spawn } = require('child_process');

const TIMEOUT_MS = 4000;

const stats = { enviados: 0, fallos: 0, ultimo: null };

const urlNtfy = () => (process.env.NTFY_URL || 'https://ntfy.sh').replace(/\/+$/, '');
const temaNtfy = () => (process.env.NTFY_TOPIC || '').trim();
const tokenNtfy = () => (process.env.NTFY_TOKEN || '').trim();
const alarmaActiva = () => process.env.MS_ALARMA !== '0';
const comandoAlarma = () => (process.env.MS_ALARMA_CMD || '').trim();

function ntfyConfigurado() { return Boolean(temaNtfy()); }

/* precio legible: 5 decimales como mucho y sin ceros de relleno.
   112314.62 se queda en 112314.62, no en 112314.62000. */
function _p(v) {
  if (!Number.isFinite(v) || v <= 0) return '—';
  return String(Number(Number(v).toFixed(5)));
}

const _hora = (t) => new Date(t || Date.now()).toISOString().slice(0, 16).replace('T', ' ');

/* Texto de una entrada confirmada (etapa 2). Va en el push, más corto que el
   mensaje de Telegram a propósito: se lee de un vistazo en la pantalla. */
function textoEntrada(s) {
  const icono = s.lado === 'COMPRA' ? '🟢' : '🔴';
  const tf = s.tfGatillo && s.tfGatillo !== s.tfZona ? `${s.tfZona}·${s.tfGatillo}` : (s.tfZona || '—');
  const stop = Number.isFinite(s.invalida) ? ` · invalida ${_p(s.invalida)}` : '';
  return [
    `${icono} ${s.lado} · ${s.simbolo} · ${tf} · ${s.patron || '—'}`,
    `precio ${_p(s.precio)}${stop}`,
    `${_hora(s.t)} UTC`,
  ].join('\n');
}

/* Texto de la etapa 1: el precio acaba de entrar en la banda de la zona.
   No es una entrada; es el aviso de que el nivel está en juego AHORA. */
function textoNivelEnJuego(a) {
  const icono = a.lado === 'COMPRA' ? '🟢' : '🔴';
  const dist = Number.isFinite(a.distZonaAtr) ? ` · ${a.distZonaAtr.toFixed(2)} ATR` : '';
  return [
    `🔔 NIVEL EN JUEGO · ${a.simbolo} · ${a.tfZona || '—'}`,
    `${icono} ${a.lado} · ${a.zonaTipo || 'zona'} ${_p(a.zonaNivel ?? a.nivelRoto)}${dist}`,
    `precio ${_p(a.precio)} · ${_hora(a.t)} UTC`,
    'no es entrada: la confirmación (1R/2R/3R) llega al cierre',
  ].join('\n');
}

/* Alarma local: BEL (+ comando propio). Con freno de 1 s para que una ráfaga
   de ticks no convierta el PC en una pitido constante. */
let ultimaAlarma = 0;
function alarmaLocal() {
  if (!alarmaActiva()) return false;
  const ahora = Date.now();
  if (ahora - ultimaAlarma < 1000) return false;
  ultimaAlarma = ahora;
  try { process.stdout.write('\x07'); } catch (e) { /* consola sin soporte */ }
  const cmd = comandoAlarma();
  if (cmd) {
    try {
      spawn(cmd, { shell: true, stdio: 'ignore', detached: true }).unref();
    } catch (e) { /* el sonido es opcional: nunca tumba el motor */ }
  }
  return true;
}

/* POST a ntfy. Nunca lanza: devuelve {ok, motivo|error}. */
async function enviarNtfy({ titulo, mensaje, prioridad = 'default', tags = [] }) {
  if (!ntfyConfigurado()) return { ok: false, motivo: 'ntfy no configurado (falta NTFY_TOPIC)' };
  const cabeceras = {
    'Content-Type': 'text/plain; charset=utf-8',
    // las cabeceras HTTP no admiten emoji: el título va en ASCII
    'X-Title': String(titulo || 'Raptor').replace(/[^\x20-\x7E]/g, ' ').trim() || 'Raptor',
    'X-Priority': prioridad,
  };
  if (tags.length) cabeceras['X-Tags'] = tags.join(',');
  if (tokenNtfy()) cabeceras.Authorization = `Bearer ${tokenNtfy()}`;
  try {
    const r = await fetch(`${urlNtfy()}/${encodeURIComponent(temaNtfy())}`, {
      method: 'POST',
      headers: cabeceras,
      body: String(mensaje ?? ''),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!r.ok) {
      stats.fallos++;
      const j = await r.json().catch(() => ({}));
      return { ok: false, motivo: `HTTP ${r.status}${j && j.error ? ' — ' + j.error : ''}` };
    }
    stats.enviados++;
    stats.ultimo = Date.now();
    return { ok: true };
  } catch (e) {
    stats.fallos++;
    return { ok: false, error: e.name === 'TimeoutError' ? `timeout ${TIMEOUT_MS / 1000} s` : e.message };
  }
}

/* Etapa 2 — entrada confirmada al cierre de la vela. */
async function enviarEntradaUrgente(s) {
  alarmaLocal();
  return enviarNtfy({
    titulo: `${s.lado} ${s.simbolo} ${s.tfGatillo || s.tfZona || ''} ${s.patron || ''}`,
    mensaje: textoEntrada(s),
    prioridad: 'urgent',
    tags: [s.lado === 'COMPRA' ? 'green_circle' : 'red_circle', 'chart_with_upwards_trend'],
  });
}

/* Etapa 1 — el precio entra en la banda de la zona (aviso intrabar). */
async function enviarNivelUrgente(a) {
  alarmaLocal();
  return enviarNtfy({
    titulo: `NIVEL EN JUEGO ${a.lado} ${a.simbolo} ${a.tfZona || ''}`,
    mensaje: textoNivelEnJuego(a),
    prioridad: 'high',
    tags: ['bell'],
  });
}

function estadoUrgente() {
  return { ntfy: ntfyConfigurado(), alarma: alarmaActiva(), ...stats };
}

module.exports = {
  ntfyConfigurado, alarmaLocal, enviarNtfy, enviarEntradaUrgente, enviarNivelUrgente,
  textoEntrada, textoNivelEnJuego, estadoUrgente,
};
