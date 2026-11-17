'use strict';
/* ============================================================
   DATOS DEL LABORATORIO v03
   ------------------------------------------------------------
   Fuente por defecto: los CSV de 30 días que ya están en
   `backtest_hibrida/datos/` (16 series = 4 símbolos × M5/M15/M30/H1).

   También puede bajarlas del motor vivo y cachearlas en JSON:

     node v03-lab/evaluar.mjs --url http://127.0.0.1:3000

   Nunca escribe fuera de `v03-lab/`.
   ============================================================ */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
export const RAIZ = join(AQUI, '..');
const CSV_DIR = join(RAIZ, 'backtest_hibrida', 'datos');
const CACHE_DIR = join(AQUI, 'datos');

export const SIMBOLOS = ['FX Vol 20', 'FX Vol 40', 'SFX Vol 20', 'SFX Vol 40'];
export const TFS = ['M5', 'M15', 'M30', 'H1'];

const num = (x) => {
  const v = Number(x);
  return Number.isFinite(v) ? v : null;
};

/** «FX Vol 20» + «M30» → «FX_Vol_20_M30» */
export const clave = (simbolo, tf) => `${simbolo.replace(/\s+/g, '_')}_${tf}`;

/** Parsea un CSV `time,open,high,low,close,volume` a velas normalizadas. */
export function parseCsv(texto) {
  const lineas = texto.trim().split(/\r?\n/);
  const cab = lineas.shift().split(',').map((s) => s.trim().toLowerCase());
  const col = (n) => cab.indexOf(n);
  const iT = col('time'), iO = col('open'), iH = col('high'), iL = col('low'), iC = col('close');
  if ([iT, iO, iH, iL, iC].some((i) => i < 0)) throw new Error('CSV sin columnas time/open/high/low/close');
  const out = [];
  for (const linea of lineas) {
    if (!linea.trim()) continue;
    const f = linea.split(',');
    const t = Date.parse(f[iT]);
    const o = num(f[iO]), h = num(f[iH]), l = num(f[iL]), c = num(f[iC]);
    if (!Number.isFinite(t) || o === null || h === null || l === null || c === null) continue;
    if (!(h >= l) || o <= 0 || c <= 0) continue;
    out.push({ t, o, h, l, c });
  }
  return normalizar(out);
}

/** Ordena por tiempo, quita duplicados y cierres absurdos. */
export function normalizar(velas) {
  const v = velas.slice().sort((a, b) => a.t - b.t);
  const out = [];
  let ultimoT = -Infinity, ultimoC = null;
  for (const x of v) {
    if (x.t === ultimoT) { out[out.length - 1] = x; continue; }
    if (ultimoC !== null && ultimoC > 0 && Math.abs(x.c - ultimoC) / ultimoC > 0.05) continue;
    out.push(x);
    ultimoT = x.t; ultimoC = x.c;
  }
  return out;
}

function leerCache(ruta) {
  try {
    const j = JSON.parse(readFileSync(ruta, 'utf8'));
    if (Array.isArray(j) && j.length) return j;
  } catch (e) { /* sin caché */ }
  return null;
}

/**
 * Carga las 16 series. `--url` intenta el motor vivo para cada serie y cachea
 * el resultado; si falla, cae al CSV. Devuelve [{simbolo, tf, velas, fuente}].
 */
export async function cargarSeries({ url = null, simbolos = SIMBOLOS, tfs = TFS, verbose = false } = {}) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const salida = [];
  for (const tf of tfs) {
    for (const simbolo of simbolos) {
      const nombre = clave(simbolo, tf);
      let velas = null, fuente = null;

      if (url) {
        const cache = join(CACHE_DIR, nombre + '.json');
        velas = leerCache(cache);
        if (velas) fuente = 'cache';
        else {
          try {
            const r = await fetch(`${url.replace(/\/$/, '')}/velas?simbodo=${encodeURIComponent(simbolo)}&tf=${tf}`);
            if (!r.ok) throw new Error('HTTP ' + r.status);
            const j = await r.json();
            const arr = Array.isArray(j && j.velas) ? j.velas : [];
            if (arr.length) {
              velas = normalizar(arr.map((v) => ({ t: v.t, o: v.o, h: v.h, l: v.l, c: v.c })));
              if (velas.length) {
                writeFileSync(cache, JSON.stringify(velas));
                fuente = 'servidor';
                if (verbose) console.log(`  ${nombre}: ${velas.length} velas del servidor`);
              }
            }
          } catch (e) {
            if (verbose) console.log(`  ${nombre}: servidor no disponible (${e.message}) — uso CSV`);
          }
        }
      }

      if (!velas) {
        const ruta = join(CSV_DIR, nombre + '.csv');
        try {
          velas = parseCsv(readFileSync(ruta, 'utf8'));
          fuente = 'csv';
        } catch (e) {
          if (verbose) console.log(`  ${nombre}: sin CSV (${e.message})`);
        }
      }
      if (velas && velas.length) salida.push({ simbolo, tf, velas, fuente });
    }
  }
  return salida;
}

/** Nombres de CSV disponibles (para mensajes de error). */
export function csvDisponibles() {
  try { return readdirSync(CSV_DIR).filter((f) => f.endsWith('.csv')).sort(); }
  catch (e) { return []; }
}
