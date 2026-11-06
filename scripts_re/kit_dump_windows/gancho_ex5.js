'use strict';
/* ============================================================
   GANCHO EX5 — agente Frida para terminal64.exe (MT5)
   ------------------------------------------------------------
   La idea del usuario, versión quirúrgica:
   NO desarmamos MT5 entero. El lector de MT5 tiene que
   DESCIFRAR el .ex5 para ejecutarlo; en ese momento el
   bytecode en claro vive en la RAM del proceso. Este agente
   escanea la memoria buscando la firma "EX5" (45 58 35) con
   versión de formato válida y envía al host los bloques
   alrededor de cada hallazgo.

   Host side: ejecutar_gancho.py (frida + frida-tools en Windows)
   ============================================================ */

const MAGIAS = ['45 58 35 02', '45 58 35 01']; // "EX5" + versión de formato 2 / 1
const MIN_RANGO = 64 * 1024;        // ignorar regiones diminutas
const PRE = 0x1000;                 // capturar 4 KB antes del hallazgo
const MAX_CAP = 16 * 1024 * 1024;   // tope por hallazgo: 16 MB
const MAGIC_LEN = 4;

function rangosLegibles() {
  return Process.enumerateRangesSync('r--').filter(function (r) {
    return r.size >= MIN_RANGO;
  });
}

/* valida que un hallazgo parezca cabecera EX5 y no texto "EX5" suelto:
   versión de formato 1|2 y tamaño restante de la región suficiente */
function esCabeceraEx5(addr, rango) {
  try {
    const ver = addr.add(3).readU8();
    if (ver !== 1 && ver !== 2) return false;
    // queda al menos 32 KB por delante dentro de la región
    const restante = rango.base.add(rango.size).sub(addr).toInt32();
    return restante >= 32 * 1024;
  } catch (e) {
    return false;
  }
}

function capturar(addr, rango) {
  const inicio = addr.sub(PRE);
  const base = inicio < rango.base ? rango.base : inicio;
  const finR = rango.base.add(rango.size);
  let fin = addr.add(MAX_CAP);
  if (fin > finR) fin = finR;
  const tam = fin.sub(base).toInt32();
  if (tam <= 0) return null;
  const datos = base.readByteArray(tam);
  return { base: base.toString(), tam: tam, datos: datos };
}

function escanear() {
  const rangos = rangosLegibles();
  send({ tipo: 'info', msg: 'regiones legibles: ' + rangos.length +
        ' (' + Math.round(rangos.reduce(function (a, r) { return a + r.size; }, 0) / 1048576) + ' MB)' });

  const enviados = [];
  for (const magia of MAGIAS) {
    let n = 0;
    for (const r of rangos) {
      let hits = [];
      try {
        hits = Memory.scanSync(r.base, r.size, magia);
      } catch (e) {
        continue; // algunas regiones no se pueden leer al vuelo
      }
      for (const h of hits) {
        if (!esCabeceraEx5(h.address, r)) continue;
        const cap = capturar(h.address, r);
        if (!cap) continue;
        n++;
        send({ tipo: 'hit', magia: magia, direccion: h.address.toString(),
               base: cap.base, tamano: cap.tam, version_formato: magia.split(' ')[3] }, cap.datos);
      }
      send({ tipo: 'progreso', magia: magia, region: r.base.toString(), hits: n });
    }
    if (n > 0) enviados.push({ magia: magia, hits: n });
  }
  send({ tipo: 'fin', resumen: enviados });
}

rpc.exports = {
  escanear: escanear,
  ping: function () { return 'gancho vivo'; }
};
