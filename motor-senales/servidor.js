'use strict';
/* Servidor HTTP mínimo (sin dependencias):
     GET  /                       -> página con el botón de importar estrategia
     GET  /salud                  -> "ok" (para Render y el pinger externo)
     GET  /estado                 -> JSON con métricas del motor
     GET  /estrategia             -> documento activo + fuente
     POST /importar?nombre=x.ext  -> importa documento (cuerpo = bytes crudos)
     POST /estrategia/validar     -> valida documento (cuerpo = JSON)
     POST /estrategia/activar     -> activa documento (cuerpo = JSON)
     POST /estrategia/restaurar   -> vuelve a la integrada (raptor_default.json)
   IMPORTANTE (Render free): el servicio se duerme tras 15 min sin
   tráfico ENTRANTE; el WebSocket saliente NO cuenta como actividad.
   Configura un pinger externo (cron-job.org / UptimeRobot) que
   golpee /salud cada 5-10 min. */
const http = require('http');
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 8 * 1024 * 1024;

function _cuerpo(req) {
  return new Promise((resolver, rechazar) => {
    let n = 0;
    const trozos = [];
    req.on('data', (c) => {
      n += c.length;
      if (n > MAX_BYTES) { rechazar(new Error('cuerpo demasiado grande (máx 8 MB)')); req.destroy(); return; }
      trozos.push(c);
    });
    req.on('end', () => resolver(Buffer.concat(trozos)));
    req.on('error', rechazar);
  });
}

const _json = (res, codigo, obj) => {
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj, null, 2));
};

function crearServidor(getEstado, gestor, port = Number(process.env.PORT || 3000)) {
  const srv = http.createServer(async (req, res) => {
    const ruta = req.url.split('?')[0];
    try {
      if (req.method === 'GET' && (ruta === '/' || ruta === '/index.html')) {
        const html = fs.readFileSync(path.join(__dirname, 'ui.html'));
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(html);
      }
      if (req.method === 'GET' && ruta === '/salud') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        return res.end('ok\n');
      }
      if (req.method === 'GET' && ruta === '/estado') return _json(res, 200, getEstado());
      if (req.method === 'GET' && ruta === '/estrategia') return _json(res, 200, gestor.actual());

      if (req.method === 'POST' && ruta === '/importar') {
        const q = new URL(req.url, 'http://x').searchParams;
        const nombre = q.get('nombre') || 'documento';
        const buf = await _cuerpo(req);
        return _json(res, 200, gestor.importar(nombre, buf));
      }
      if (req.method === 'POST' && ruta === '/estrategia/validar') {
        const doc = JSON.parse((await _cuerpo(req)).toString('utf8') || '{}');
        const v = gestor.validar(doc);
        return _json(res, 200, { ok: v.ok, errores: v.errores, avisos: v.avisos || [] });
      }
      if (req.method === 'POST' && ruta === '/estrategia/activar') {
        const doc = JSON.parse((await _cuerpo(req)).toString('utf8') || '{}');
        const r = gestor.activar(doc);
        return _json(res, r.ok ? 200 : 400, r);
      }
      if (req.method === 'POST' && ruta === '/estrategia/restaurar') {
        return _json(res, 200, gestor.restaurarIntegrada());
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('ruta no encontrada\n');
    } catch (e) {
      _json(res, 400, { ok: false, error: e.message });
    }
  });
  return new Promise((resolver) => {
    srv.listen(port, () => resolver(srv));
  });
}

module.exports = { crearServidor };
