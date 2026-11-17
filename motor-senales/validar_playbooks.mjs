#!/usr/bin/env node
'use strict';

/*
 * Linter documental de F0.
 *
 * Comprueba que los playbooks y el código no se contradicen:
 *   1. frontmatter válido y completo
 *   2. ids únicos y versiones enteras
 *   3. parámetros del .md = PARAMS del módulo que declara `fuente`
 *   4. todo check citado está definido en 50_validacion.md, y viceversa
 *   5. todo caso citado existe en datos/casos.jsonl (si el archivo existe)
 *
 * Sin dependencias. Falla con exit 1 y dice archivo:línea.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.join(RAIZ, '..', 'docs', 'sistema');
const DIR_PLAYBOOKS = path.join(DOCS, 'playbooks');
const DEF_CHECKS = path.join(DIR_PLAYBOOKS, '50_validacion.md');
const CASOS = path.join(RAIZ, 'datos', 'casos.jsonl');

const FUENTES = {
  rayas: path.join(RAIZ, 'rayas.js'),
  nucleo: path.join(RAIZ, 'nucleo.js'),
  escaner: path.join(RAIZ, 'escaner.js'),
};
const ESTADOS = new Set(['activo', 'borrador', 'deprecado']);

let fallos = 0;
let avisos = 0;
const ok = [];
const error = (archivo, linea, msg) => { fallos++; console.log(`${archivo}:${linea}  ERROR  ${msg}`); };
const aviso = (archivo, linea, msg) => { avisos++; console.log(`${archivo}:${linea}  aviso  ${msg}`); };

/* ---------- frontmatter (YAML mínimo, sin dependencias) ---------- */

function valorCrudo(v) {
  const t = v.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null' || t === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t.replace(/^["']|["']$/g, '');
}

function lista(v) {
  const t = v.trim();
  if (!t || t === '[]') return [];
  if (t.startsWith('[') && t.endsWith(']')) {
    return t.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean)
      .map((s) => s.replace(/^["']|["']$/g, ''));
  }
  return [valorCrudo(t)];
}

function parseFrontmatter(texto) {
  const lineas = texto.split(/\r?\n/);
  if (lineas[0].trim() !== '---') return { error: 'falta el bloque --- al inicio', linea: 1 };
  let cierre = -1;
  for (let i = 1; i < lineas.length; i++) {
    if (lineas[i].trim() === '---') { cierre = i; break; }
  }
  if (cierre < 0) return { error: 'falta el --- de cierre', linea: 1 };

  const fm = { parametros: {}, checks: [], casos: [], fuente: [] };
  let bloque = null;
  for (let i = 1; i < cierre; i++) {
    const cruda = lineas[i];
    if (!cruda.trim() || cruda.trim().startsWith('#')) continue;
    if (/^\s/.test(cruda)) {
      if (bloque !== 'parametros') return { error: 'indentación inesperada', linea: i + 1 };
      const m = cruda.trim().match(/^([A-Za-z0-9_.]+)\s*:\s*(.+)$/);
      if (!m) return { error: 'parámetro mal formado', linea: i + 1 };
      fm.parametros[m[1]] = valorCrudo(m[2]);
      continue;
    }
    const m = cruda.match(/^([A-Za-z0-9_]+)\s*:\s*(.*)$/);
    if (!m) return { error: 'clave mal formada', linea: i + 1 };
    const clave = m[1];
    const resto = m[2];
    bloque = null;
    if (clave === 'parametros') {
      if (resto.trim() === '{}' || !resto.trim()) { bloque = resto.trim() ? null : 'parametros'; continue; }
      return { error: 'parametros debe ir en bloque indentado o vacío', linea: i + 1 };
    }
    if (clave === 'checks' || clave === 'casos' || clave === 'fuente') {
      fm[clave] = lista(resto);
      continue;
    }
    fm[clave] = resto.trim() ? valorCrudo(resto) : '';
  }
  return { fm, lineas, cierre };
}

/* ---------- comparación de parámetros ---------- */

function iguales(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  return a === b;
}

function describir(v) {
  return typeof v === 'string' ? JSON.stringify(v) : String(v);
}

/* ---------- checks definidos ---------- */

function checksDefinidos() {
  if (!fs.existsSync(DEF_CHECKS)) return { error: 'no existe 50_validacion.md' };
  const lineas = fs.readFileSync(DEF_CHECKS, 'utf8').split(/\r?\n/);
  const defs = new Map();
  lineas.forEach((l, i) => {
    const m = l.match(/^\|\s*([A-Z]\d{2})\s*\|\s*(.+?)\s*\|/);
    if (m && !defs.has(m[1])) defs.set(m[1], i + 1);
  });
  if (!defs.size) return { error: '50_validacion.md no define ningún check en tabla' };
  return { defs };
}

/* ---------- casos existentes ---------- */

function casosExistentes() {
  if (!fs.existsSync(CASOS)) return { existe: false, ids: new Set() };
  const ids = new Set();
  const lineas = fs.readFileSync(CASOS, 'utf8').split(/\r?\n/);
  for (const l of lineas) {
    if (!l.trim()) continue;
    try {
      const j = JSON.parse(l);
      if (j && typeof j.id === 'string') ids.add(j.id);
    } catch (e) {
      return { existe: true, ids, corrupto: true };
    }
  }
  return { existe: true, ids };
}

/* ---------- principal ---------- */

function main() {
  const defs = checksDefinidos();
  if (defs.error) { error('docs/sistema/playbooks/50_validacion.md', 1, defs.error); return; }

  const archivos = fs.existsSync(DIR_PLAYBOOKS)
    ? fs.readdirSync(DIR_PLAYBOOKS).filter((f) => f.endsWith('.md')).sort()
    : [];

  if (!archivos.length) { error('docs/sistema/playbooks/', 1, 'no hay playbooks'); return; }

  const idsVistos = new Map();
  const checksUsados = new Map();
  const cobertura = new Map(Object.keys(FUENTES).map((f) => [f, new Set()]));
  const casos = casosExistentes();
  let totalCasos = 0;

  for (const archivo of archivos) {
    const ruta = path.join(DIR_PLAYBOOKS, archivo);
    const rel = path.relative(RAIZ, ruta);
    const texto = fs.readFileSync(ruta, 'utf8');
    const p = parseFrontmatter(texto);

    if (p.error) { error(rel, p.linea || 1, p.error); continue; }
    const { fm } = p;
    const lineaDe = (clave) => {
      const i = texto.split(/\r?\n/).findIndex((l) => l.trim().startsWith(clave + ':'));
      return i >= 0 ? i + 1 : 1;
    };

    for (const obligatoria of ['id', 'version', 'estado', 'fuente', 'checks']) {
      if (fm[obligatoria] === undefined || fm[obligatoria] === '') {
        error(rel, 1, `falta la clave obligatoria "${obligatoria}"`);
      }
    }
    if (fm.id && !/^[a-z0-9][a-z0-9._-]*$/.test(String(fm.id))) {
      error(rel, lineaDe('id'), `id inválido: ${fm.id}`);
    }
    if (fm.id) {
      if (idsVistos.has(fm.id)) error(rel, lineaDe('id'), `id duplicado: ${fm.id} (ya en ${idsVistos.get(fm.id)})`);
      else idsVistos.set(fm.id, rel);
    }
    if (!Number.isInteger(fm.version) || fm.version < 1) {
      error(rel, lineaDe('version'), 'version debe ser un entero ≥ 1');
    }
    if (!ESTADOS.has(fm.estado)) {
      error(rel, lineaDe('estado'), `estado inválido: ${fm.estado} (activo|borrador|deprecado)`);
    }

    /* parámetros contra el módulo declarado */
    const fuentes = Array.isArray(fm.fuente) ? fm.fuente.filter(Boolean) : [];
    /* Un playbook sin fuente solo es legítimo si no declara parámetros
       (principios, validación): no hay nada que comparar con el código. */
    if (!fuentes.length && Object.keys(fm.parametros).length && fm.estado !== 'borrador') {
      error(rel, lineaDe('fuente'), 'declara parámetros sin fuente; solo puede estar en borrador');
    }
    for (const f of fuentes) {
      const modulo = FUENTES[f];
      if (!modulo) { error(rel, lineaDe('fuente'), `fuente desconocida: ${f}`); continue; }
      const PARAMS = require(modulo).PARAMS;
      for (const [clave, valor] of Object.entries(fm.parametros)) {
        if (!(clave in PARAMS)) {
          error(rel, lineaDe(clave), `parámetro "${clave}" no existe en ${f}.js`);
          continue;
        }
        if (!iguales(valor, PARAMS[clave])) {
          error(rel, lineaDe(clave),
            `"${clave}" dice ${describir(valor)} y ${f}.js tiene ${describir(PARAMS[clave])}`);
        }
        cobertura.get(f).add(clave);
      }
    }

    /* checks */
    if (!Array.isArray(fm.checks) || !fm.checks.length) {
      error(rel, lineaDe('checks'), 'un playbook debe citar al menos un check');
    }
    for (const c of fm.checks) {
      if (!defs.defs.has(c)) {
        error(rel, lineaDe('checks'), `check "${c}" no está definido en 50_validacion.md`);
      }
      checksUsados.set(c, (checksUsados.get(c) || 0) + 1);
    }

    /* casos */
    for (const id of fm.casos) {
      totalCasos++;
      if (!casos.existe) {
        aviso(rel, lineaDe('casos'), `cita ${id} pero la memoria está vacía (aún sin casos.jsonl)`);
      } else if (!casos.ids.has(id)) {
        error(rel, lineaDe('casos'), `el caso ${id} no existe en datos/casos.jsonl`);
      }
    }

    ok.push(rel);
  }

  /* checks definidos sin uso */
  for (const [c, linea] of defs.defs) {
    if (!checksUsados.has(c)) {
      error('docs/sistema/playbooks/50_validacion.md', linea, `check ${c} definido pero sin uso`);
    }
  }
  if (casos.corrupto) error('motor-senales/datos/casos.jsonl', 1, 'hay una línea que no es JSON válido');

  /* parámetros del código que ningún playbook documenta */
  for (const [f, modulo] of Object.entries(FUENTES)) {
    const PARAMS = require(modulo).PARAMS;
    for (const clave of Object.keys(PARAMS)) {
      if (!cobertura.get(f).has(clave)) {
        aviso(`${f}.js`, 1, `el parámetro "${clave}" no está documentado en ningún playbook`);
      }
    }
  }

  console.log('');
  console.log(`playbooks: ${ok.length} · checks definidos: ${defs.defs.size} · casos citados: ${totalCasos}`);
  console.log(`memoria: ${casos.existe ? casos.ids.size + ' casos en casos.jsonl' : 'vacía (aún sin marcas)'}`);
  console.log(`resultado: ${fallos ? fallos + ' fallo(s)' : 'verde'} · ${avisos} aviso(s)`);
  process.exitCode = fallos ? 1 : 0;
}

main();
