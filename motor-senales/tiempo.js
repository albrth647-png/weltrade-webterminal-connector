'use strict';
/* Hora de La Habana (America/Havana), con horario de verano incluido.
   El motor trabaja con epoch UTC; solo la PRESENTACIÓN cambia de zona. */

const TZ_HABANA = 'America/Havana';

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ_HABANA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/* Devuelve "YYYY-MM-DD HH:mm" en hora de La Habana. */
function horaHabana(t = Date.now()) {
  const d = new Date(t);
  if (!Number.isFinite(d.getTime())) return '—';
  const p = {};
  for (const { type, value } of fmt.formatToParts(d)) p[type] = value;
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

module.exports = { horaHabana, TZ_HABANA };
