'use strict';
/* ============================================================
   PERSISTENCIA DE VELAS — IndexedDB (WT Motor PWA)
   ------------------------------------------------------------
   Guarda el histórico descargado por cmd 11 para que sobreviva
   al cierre de la app y a las reconexiones:

     clave   = "SIMBOLO|TF"   (p. ej. "FX Vol 20|M15")
     registro= { clave, simbolo, tf, guardado, velas: [[t,o,h,l,c], …] }

   Se guardan arrays compactos (5 números por vela) en vez de
   objetos con nombre, ~40 B por vela. localStorage NO sirve:
   su límite ronda 5 MB y el histórico completo pasa de 15 MB.

   Todas las funciones son asíncronas y devuelven promesas; si
   IndexedDB no está disponible o la cuota está llena, el error
   se propaga y la app sigue funcionando solo con memoria.
   ============================================================ */

const DB_NOMBRE = 'wt_pwa_velas';
const DB_VERSION = 1;
const ALMACEN = 'velas';

let _db = null;
let _error = null;

/** Abre (o crea) la base. Devuelve el IDBDatabase. */
export function abrirVelasDB() {
  if (_db) return Promise.resolve(_db);
  if (_error) return Promise.reject(_error);
  if (typeof indexedDB === 'undefined') {
    _error = new Error('IndexedDB no disponible');
    return Promise.reject(_error);
  }
  return new Promise((resolver, rechazar) => {
    let req;
    try { req = indexedDB.open(DB_NOMBRE, DB_VERSION); }
    catch (e) { _error = e; return rechazar(e); }

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ALMACEN)) db.createObjectStore(ALMACEN, { keyPath: 'clave' });
    };
    req.onsuccess = () => {
      _db = req.result;
      _db.onversionchange = () => { try { _db.close(); } catch (e) { } _db = null; };
      resolver(_db);
    };
    req.onerror = () => { _error = req.error || new Error('no se pudo abrir IndexedDB'); rechazar(_error); };
    req.onblocked = () => { /* otra pestaña con versión antigua: se reintenta al recargar */ };
  });
}

const _almacen = (db, modo) => db.transaction(ALMACEN, modo).objectStore(ALMACEN);
const claveDe = (simbolo, tf) => `${simbolo}|${tf}`;
const aFila = (v) => [v.t, v.o, v.h, v.l, v.c];
const aVela = (f) => ({ t: f[0], o: f[1], h: f[2], l: f[3], c: f[4] });

/**
 * Guarda las velas de un símbolo/TF. Si maxVelas > 0 recorta a las últimas N.
 * Devuelve cuántas velas quedaron guardadas.
 */
export async function guardarVelas(simbolo, tf, velas, maxVelas = 0) {
  // La copia compacta se hace ANTES de cualquier await, para que el motor
  // no pueda mutar el array mientras la transacción está en curso.
  const lista = (maxVelas > 0 ? velas.slice(-maxVelas) : velas).map(aFila);
  const reg = { clave: claveDe(simbolo, tf), simbolo, tf, guardado: Date.now(), velas: lista };
  const db = await abrirVelasDB();
  return new Promise((resolver, rechazar) => {
    const r = _almacen(db, 'readwrite').put(reg);
    r.onsuccess = () => resolver(lista.length);
    r.onerror = () => rechazar(r.error || new Error('no se pudo guardar'));
  });
}

/** Devuelve las velas guardadas ([] si no hay nada). */
export async function cargarVelas(simbolo, tf) {
  const db = await abrirVelasDB();
  return new Promise((resolver, rechazar) => {
    const r = _almacen(db, 'readonly').get(claveDe(simbolo, tf));
    r.onsuccess = () => {
      const reg = r.result;
      if (!reg || !Array.isArray(reg.velas)) return resolver([]);
      resolver(reg.velas.map(aVela));
    };
    r.onerror = () => rechazar(r.error || new Error('no se pudo leer'));
  });
}

/** Borra el histórico de un símbolo (todos sus TF) o de un TF concreto. */
export async function borrarVelas(simbolo, tf = null) {
  const db = await abrirVelasDB();
  const claves = tf ? [claveDe(simbolo, tf)] : ['M5', 'M15', 'H1'].map((x) => claveDe(simbolo, x));
  return new Promise((resolver, rechazar) => {
    const os = _almacen(db, 'readwrite');
    claves.forEach((k) => os.delete(k));
    os.transaction.oncomplete = () => resolver(claves.length);
    os.transaction.onerror = () => rechazar(os.transaction.error);
  });
}

/** Vacía todo el almacén de velas. */
export async function borrarTodasLasVelas() {
  const db = await abrirVelasDB();
  return new Promise((resolver, rechazar) => {
    const r = _almacen(db, 'readwrite').clear();
    r.onsuccess = () => resolver(true);
    r.onerror = () => rechazar(r.error || new Error('no se pudo vaciar'));
  });
}

/** Nº de registros y tamaño estimado del origen (útil para depurar). */
export async function medidasVelas() {
  const db = await abrirVelasDB();
  const registros = await new Promise((resolver, rechazar) => {
    const r = _almacen(db, 'readonly').count();
    r.onsuccess = () => resolver(r.result);
    r.onerror = () => rechazar(r.error);
  });
  let uso = 0;
  try {
    const est = await navigator.storage?.estimate?.();
    uso = est?.usage || 0;
  } catch (e) { /* sin estimate */ }
  return { registros, uso };
}
