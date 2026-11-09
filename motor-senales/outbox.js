'use strict';
/* ============================================================
   OUTBOX PERSISTENTE — ni una señal se pierde ni se duplica
   ------------------------------------------------------------
   Dos cosas que antes vivían solo en memoria y se perdían al
   reiniciar el proceso:

   · `pendientes`: el texto ya formateado de una señal que todavía
     no ha confirmado Telegram. Al arrancar se reenvía.
   · `emitidas`: las claves de vela ya emitidas (símbolo|TF|t|clase|
     dirección). Al arrancar se cargan en el motor para que la
     siembra no repita un mensaje que ya salió.

   Fichero JSON pequeño, escritura atómica (tmp + rename) y modo
   0600. Si el disco falla, el motor sigue: se pierde la garantía,
   no la señal en curso.
   ============================================================ */
const fs = require('fs');
const path = require('path');

const ARCHIVO = process.env.MS_OUTBOX || path.join(__dirname, '.outbox.json');
const MAX_EMITIDAS = 800;
const MAX_PENDIENTES = 100;

let estado = { emitidas: [], pendientes: [] };

function cargar() {
  try {
    const j = JSON.parse(fs.readFileSync(ARCHIVO, 'utf8'));
    estado = {
      emitidas: Array.isArray(j.emitidas) ? j.emitidas.slice(-MAX_EMITIDAS) : [],
      pendientes: Array.isArray(j.pendientes) ? j.pendientes.slice(-MAX_PENDIENTES) : [],
    };
  } catch (e) {
    estado = { emitidas: [], pendientes: [] };   // primer arranque o fichero corrupto
  }
  return estado;
}

function _escribir() {
  try {
    const tmp = `${ARCHIVO}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(estado), { mode: 0o600 });
    fs.renameSync(tmp, ARCHIVO);                 // atómico: nunca queda a medias
    return true;
  } catch (e) {
    return false;
  }
}

function yaEmitida(clave) {
  return estado.emitidas.includes(String(clave));
}

function marcarEmitida(clave) {
  const k = String(clave);
  if (estado.emitidas.includes(k)) return;
  estado.emitidas.push(k);
  if (estado.emitidas.length > MAX_EMITIDAS) estado.emitidas.splice(0, estado.emitidas.length - MAX_EMITIDAS);
  _escribir();
}

function pendiente(clave, texto, prioridad = 0) {
  const k = String(clave);
  const i = estado.pendientes.findIndex((p) => p.clave === k);
  if (i >= 0) {
    estado.pendientes[i].texto = texto;
  } else {
    estado.pendientes.push({ clave: k, texto, prioridad, desde: Date.now() });
    if (estado.pendientes.length > MAX_PENDIENTES) estado.pendientes.shift();
  }
  _escribir();
}

function entregada(clave) {
  const k = String(clave);
  const antes = estado.pendientes.length;
  estado.pendientes = estado.pendientes.filter((p) => p.clave !== k);
  if (estado.pendientes.length !== antes) _escribir();
}

function pendientes() {
  return estado.pendientes.map((p) => ({ ...p }));
}

/* claves cuyo campo 2 es el tiempo de la vela (ms): descarta las antiguas */
function emitidasRecientes(ms = 3 * 86400000) {
  const corte = Date.now() - ms;
  return estado.emitidas.filter((k) => {
    const t = Number(String(k).split('|')[2]);
    return Number.isFinite(t) && t >= corte;
  });
}

const tamano = () => ({ emitidas: estado.emitidas.length, pendientes: estado.pendientes.length });

module.exports = { ARCHIVO, cargar, yaEmitida, marcarEmitida, pendiente, entregada, pendientes, emitidasRecientes, tamano };
