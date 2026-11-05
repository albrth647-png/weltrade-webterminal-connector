'use strict';
/* Servidor HTTP mínimo (sin dependencias):
     GET /salud  -> "ok"        (para Render y el pinger externo)
     GET /estado -> JSON con métricas del motor
   IMPORTANTE (Render free): el servicio se duerme tras 15 min sin
   tráfico ENTRANTE; el WebSocket saliente NO cuenta como actividad.
   Configura un pinger externo (cron-job.org / UptimeRobot) que
   golpee /salud cada 5-10 min. */
const http = require('http');

function crearServidor(getEstado, port = Number(process.env.PORT || 3000)) {
  const srv = http.createServer((req, res) => {
    if (req.url === '/salud') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('ok\n');
    }
    if (req.url === '/estado') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify(getEstado(), null, 2));
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('ruta no encontrada\n');
  });
  return new Promise((resolver) => {
    srv.listen(port, () => resolver(srv));
  });
}

module.exports = { crearServidor };
