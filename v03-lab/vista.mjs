#!/usr/bin/env node
/* Vista v03 — servidor local de la gráfica del vídeo 03.

   Vive aparte a propósito: no toca servidor.js ni la web del motor.
   Solo lee /velas del motor, calcula EMAs y eventos con el MISMO núcleo
   (se importa escanear, no se reimplementa) y sirve vista.html.

   Uso:  node v03-lab/vista.mjs
         MS_URL=http://127.0.0.1:3000 VISTA_PORT=3100 node v03-lab/vista.mjs
*/
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import nucleo from '../motor-senales/nucleo.js';

const { escanear, ema, PARAMS } = nucleo;

const AQUI = dirname(fileURLToPath(import.meta.url));
const MOTOR = (process.env.MS_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const TOKEN = process.env.ESTADO_TOKEN || '';
const PUERTO = Number(process.env.VISTA_PORT || 3100);
const HOST = process.env.VISTA_HOST || '127.0.0.1';

const cabeceras = {
  'Access-Control-Allow-Origin': '*',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

async function motor(ruta) {
  const r = await fetch(MOTOR + ruta, {
    headers: TOKEN ? { 'x-estado-token': TOKEN } : {},
    signal: AbortSignal.timeout(15000),
  });
  const texto = await r.text();
  let cuerpo;
  try { cuerpo = JSON.parse(texto); } catch (e) { cuerpo = { ok: false, error: texto.slice(0, 200) }; }
  return { ok: r.ok, status: r.status, cuerpo };
}

/* Caché corta: dos pestañas abiertas no duplican el escaneo. */
const cache = new Map();
const TTL = 3000;

/* Reloj del motor: distingue «vela en curso» de «el motor se quedó sin ticks». */
let estadoCache = { t: 0, j: null };
async function ahoraMotor(simbolo) {
  if (Date.now() - estadoCache.t > 5000) {
    try {
      const r = await motor('/estado');
      estadoCache = { t: Date.now(), j: r.ok ? r.cuerpo : null };
    } catch (e) { estadoCache = { t: Date.now(), j: null }; }
  }
  const s = estadoCache.j && estadoCache.j.simbolos && estadoCache.j.simbolos[simbolo];
  return s && Number.isFinite(s.ahora) ? s.ahora : null;
}

/* Desviación típica de los retornos (en puntos base) de las últimas velas:
   sirve para comprobar que cada nombre lleva SU serie (Vol 40 ≈ 2× Vol 20). */
function volatilidad(vs, n = 500) {
  const trozo = vs.slice(-Math.min(n, vs.length));
  const ret = [];
  for (let i = 1; i < trozo.length; i++) ret.push(Math.log(trozo[i].c / trozo[i - 1].c));
  if (ret.length < 10) return null;
  const m = ret.reduce((a, b) => a + b, 0) / ret.length;
  const v = ret.reduce((a, b) => a + (b - m) ** 2, 0) / ret.length;
  return Math.sqrt(v) * 1e4;
}

function json(res, status, cuerpo) {
  res.writeHead(status, { ...cabeceras, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(cuerpo));
}

async function velas(simbolo, tf, soloUltima, barras = 3000) {
  const clave = `${simbolo}|${tf}|${soloUltima ? 1 : 0}|${barras}`;
  const hit = cache.get(clave);
  if (hit && Date.now() - hit.t < TTL) return hit.v;

  const r = await motor(`/velas?simbodo=${encodeURIComponent(simbolo)}&tf=${encodeURIComponent(tf)}`);
  if (!r.ok || !r.cuerpo || !Array.isArray(r.cuerpo.velas)) {
    return { error: (r.cuerpo && r.cuerpo.error) || `sin velas (${r.status})` };
  }
  const vs = r.cuerpo.velas;
  if (!vs.length) return { error: 'sin velas' };

  let salida;
  if (soloUltima) {
    salida = {
      simbolo, tf, n: vs.length, ultima: vs[vs.length - 1], sd: volatilidad(vs),
      desde: vs[0].t, hasta: vs[vs.length - 1].t,
    };
  } else {
    const cierres = vs.map((v) => v.c);
    /* Se escanea SIEMPRE la serie completa (las EMAs y el estado del motor
       dependen de todo el histórico) y luego se recorta lo que se envía. */
    const offset = Math.max(0, vs.length - barras);
    const eventos = [];
    let conteo = { roturas: 0, toques: 0 };
    let estadoMotor = null;
    try {
      const esc = escanear(vs);
      for (const e of esc.eventos) {
        const vela = vs[e.barIndex];
        if (!vela) continue;
        const rotura = e.patron.endsWith('B');
        if (rotura) conteo.roturas++; else conteo.toques++;
        eventos.push({
          bar: e.barIndex - offset, t: vela.t, patron: e.patron, lado: e.lado, tipo: e.tipo,
          precio: e.precio, invalida: e.invalida, nivel: e.nivelRoto, rotura,
        });
      }
      /* Lo que el motor está esperando ahora mismo (toques vivos del final). */
      const vivo = (s) => s && ({
        toques: s.toques.length,
        nivel: s.toques.length ? s.toques[s.toques.length - 1].nivel : null,
        extremo: s.toques.length ? s.toques[s.toques.length - 1].extremo : null,
        ciclo: s.ciclo,
        engano: !!s.engaño,
      });
      estadoMotor = { VENTA: vivo(esc.secuencias.VENTA), COMPRA: vivo(esc.secuencias.COMPRA) };
    } catch (e) {
      conteo = { roturas: 0, toques: 0, error: e.message };
    }
    salida = {
      simbolo, tf, n: vs.length, offset, barras: vs.length - offset,
      ahora: await ahoraMotor(simbolo), sd: volatilidad(vs),
      desde: vs[offset].t, hasta: vs[vs.length - 1].t,
      velas: vs.slice(offset),
      emas: {
        [`${PARAMS.emaContacto}`]: ema(cierres, PARAMS.emaContacto).slice(offset),
        [`${PARAMS.emaTecho}`]: ema(cierres, PARAMS.emaTecho).slice(offset),
        [`${PARAMS.emaFondo}`]: ema(cierres, PARAMS.emaFondo).slice(offset),
      },
      eventos, conteo, estadoMotor,
      params: {
        contacto: PARAMS.emaContacto, techo: PARAMS.emaTecho, fondo: PARAMS.emaFondo,
        ventanaMin: PARAMS.ventanaMin, caducidad: PARAMS.caducidad,
        tolToqueAtr: PARAMS.tolToqueAtr, resetPorSalida: PARAMS.resetPorSalida,
      },
    };
  }
  cache.set(clave, { t: Date.now(), v: salida });
  if (cache.size > 40) cache.delete(cache.keys().next().value);
  return salida;
}

const srv = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/' || url.pathname === '/vista.html') {
      const html = await readFile(join(AQUI, 'vista.html'));
      res.writeHead(200, { ...cabeceras, 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }
    if (url.pathname === '/api/estado') {
      const r = await motor('/estado');
      if (!r.ok) return json(res, r.status, { ok: false, error: r.cuerpo.error || 'motor no responde' });
      const j = r.cuerpo;
      return json(res, 200, {
        conexion: j.conexion, motor: j.motor, senalesHoy: j.senalesHoy,
        simbolos: j.simbolos || {}, parametros: j.parametros || {},
      });
    }
    if (url.pathname === '/api/velas') {
      const simbolo = (url.searchParams.get('simbolo') || '').trim();
      const tf = (url.searchParams.get('tf') || 'M5').toUpperCase();
      const ultima = url.searchParams.get('ultima') === '1';
      if (!simbolo) return json(res, 400, { ok: false, error: 'falta simbolo' });
      const barras = Math.min(6000, Math.max(200, Number(url.searchParams.get('barras') || 3000) || 3000));
      const v = await velas(simbolo, tf, ultima, barras);
      if (v.error) return json(res, 404, { ok: false, error: v.error });
      return json(res, 200, v);
    }
    return json(res, 404, { ok: false, error: 'ruta desconocida' });
  } catch (e) {
    return json(res, 502, { ok: false, error: `motor inaccesible: ${e.message}` });
  }
});

srv.listen(PUERTO, HOST, () => {
  console.log(`vista v03 en http://${HOST}:${PUERTO}  ·  motor ${MOTOR}`);
});
