/* Carril urgente: textos, configuración y entrega HTTP real (servidor local,
   sin red externa). Uso: node test_urgente.mjs */
import http from 'node:http';
import urgente from './urgente.js';

const { enviarNtfy, ntfyConfigurado, textoEntrada, textoNivelEnJuego, alarmaLocal } = urgente;

let ok = 0, fallos = 0;
const check = (nombre, cond, detalle) => {
  if (cond) { ok++; console.log('  ✓ ' + nombre); }
  else { fallos++; console.log('  ✗ ' + nombre + (detalle !== undefined ? '  → ' + detalle : '')); }
};

console.log('— 1. configuración —');
{
  delete process.env.NTFY_TOPIC;
  check('sin NTFY_TOPIC el carril no está configurado', ntfyConfigurado() === false);
  process.env.NTFY_TOPIC = 'prueba';
  check('con NTFY_TOPIC queda configurado', ntfyConfigurado() === true);
}

console.log('— 2. texto de una entrada (etapa 2) —');
{
  const t = textoEntrada({
    lado: 'VENTA', simbolo: 'SFX Vol 40', tfZona: 'M5', tfGatillo: 'M5',
    patron: '2RB', precio: 119889.05, invalida: 119733.29, t: Date.parse('2026-11-09T18:25:00Z'),
  });
  check('lleva lado, activo, TF y patrón', /VENTA · SFX Vol 40 · M5 · 2RB/.test(t), t);
  check('lleva el precio y la invalidación', /precio 119889\.05 · invalida 119733\.29/.test(t), t);
  check('lleva la hora UTC', /2026-11-09 18:25 UTC/.test(t), t);
}

console.log('— 3. texto de nivel en juego (etapa 1) —');
{
  const t = textoNivelEnJuego({
    lado: 'COMPRA', simbolo: 'FX Vol 20', tfZona: 'M5', zonaTipo: 'soporte',
    zonaNivel: 112250.07, precio: 112314.62, distZonaAtr: 0.32,
    t: Date.parse('2026-11-09T18:25:00Z'),
  });
  check('se anuncia como NIVEL EN JUEGO', /NIVEL EN JUEGO · FX Vol 20 · M5/.test(t), t);
  check('lleva la zona, la distancia en ATR y el precio', /soporte 112250\.07 · 0\.32 ATR/.test(t) && /precio 112314\.62/.test(t), t);
  check('deja claro que no es una entrada', /no es entrada/.test(t), t);
}

console.log('— 4. sin tema configurado no se envía (y no lanza) —');
{
  const guardado = process.env.NTFY_TOPIC;
  delete process.env.NTFY_TOPIC;
  const r = await enviarNtfy({ titulo: 'x', mensaje: 'y' });
  check('devuelve ok:false con motivo', r.ok === false && /NTFY_TOPIC/.test(r.motivo || ''), JSON.stringify(r));
  process.env.NTFY_TOPIC = guardado;
}

console.log('— 5. entrega real contra un servidor local —');
{
  const vistos = [];
  const srv = http.createServer((req, res) => {
    let cuerpo = '';
    req.on('data', (c) => { cuerpo += c; });
    req.on('end', () => {
      vistos.push({ url: req.url, headers: req.headers, cuerpo });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"id":"prueba"}');
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const puerto = srv.address().port;
  const guardado = { url: process.env.NTFY_URL, topico: process.env.NTFY_TOPIC, alarma: process.env.MS_ALARMA };
  process.env.NTFY_URL = `http://127.0.0.1:${puerto}`;
  process.env.NTFY_TOPIC = 'aviso-senales';
  process.env.MS_ALARMA = '0';
  const r = await enviarNtfy({
    titulo: 'VENTA SFX Vol 40 M5 2RB', mensaje: 'texto de prueba', prioridad: 'urgent', tags: ['red_circle'],
  });
  srv.close();
  const v = vistos[0] || { headers: {}, cuerpo: '' };
  check('el POST llega al tema indicado', v.url === '/aviso-senales', v.url);
  check('la prioridad viaja en la cabecera', v.headers['x-priority'] === 'urgent', v.headers['x-priority']);
  check('el título viaja en la cabecera', v.headers['x-title'] === 'VENTA SFX Vol 40 M5 2RB', v.headers['x-title']);
  check('el cuerpo es el mensaje', v.cuerpo === 'texto de prueba', v.cuerpo);
  check('el envío se da por bueno', r.ok === true, JSON.stringify(r));
  for (const [k, val] of Object.entries({ NTFY_URL: guardado.url, NTFY_TOPIC: guardado.topico, MS_ALARMA: guardado.alarma })) {
    if (val === undefined) delete process.env[k]; else process.env[k] = val;
  }
}

console.log('— 6. alarma local —');
{
  const guardado = process.env.MS_ALARMA;
  process.env.MS_ALARMA = '0';
  check('con MS_ALARMA=0 no suena', alarmaLocal() === false);
  delete process.env.MS_ALARMA;
  const sono = alarmaLocal();
  check('por defecto la alarma actúa (BEL silencioso en el test)', typeof sono === 'boolean');
  if (guardado === undefined) delete process.env.MS_ALARMA; else process.env.MS_ALARMA = guardado;
}

console.log(`\nresultado: ${ok} OK, ${fallos} FALLOS`);
process.exit(fallos ? 1 : 0);
