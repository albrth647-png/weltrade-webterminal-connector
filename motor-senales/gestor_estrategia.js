'use strict';
/* ============================================================
   GESTOR DE ESTRATEGIA — carga / activa / persiste documentos
   ------------------------------------------------------------
   Única fuente de verdad de qué estrategia corre el motor.
   Prioridad: estrategias/activa.json  >  raptor_default.json
   (ambos son DOCUMENTOS en disco; el código no tiene ninguna).
   ============================================================ */
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { validarDoc } = require('./doc_estrategia');
const { importarDocumento } = require('./importador');

class GestorEstrategia extends EventEmitter {
  constructor(dir = path.join(__dirname, 'estrategias')) {
    super();
    this.dir = dir;                                   // datos en runtime: activa.json + importados/
    this.plantilla = path.join(__dirname, 'estrategias', 'raptor_default.json');  // la plantilla viaja con el paquete
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(dir, 'importados'), { recursive: true });
    this.doc = null;
    this.fuente = '';
    this._cargar();
  }

  _cargar() {
    const activa = path.join(this.dir, 'activa.json');
    if (fs.existsSync(activa)) {
      try {
        const v = validarDoc(JSON.parse(fs.readFileSync(activa, 'utf8')));
        if (v.ok) { this.doc = v.doc; this.fuente = 'estrategias/activa.json'; return; }
        console.error(`[AVISO] activa.json inválido (${v.errores[0]}) — cayendo a la plantilla`);
      } catch (e) { console.error('[AVISO] activa.json ilegible — cayendo a la plantilla'); }
    }
    const v = validarDoc(JSON.parse(fs.readFileSync(this.plantilla, 'utf8')));
    if (!v.ok) throw new Error('plantilla raptor_default.json inválida: ' + v.errores[0]);
    this.doc = v.doc;
    this.fuente = 'estrategias/raptor_default.json (integrada)';
  }

  actual() { return { doc: this.doc, fuente: this.fuente }; }

  validar(doc) { return validarDoc(doc); }

  activar(doc, origen = 'web') {
    const v = validarDoc(doc);
    if (!v.ok) return { ok: false, errores: v.errores };
    v.doc.meta.activada = new Date().toISOString();
    v.doc.meta.origen = origen;
    fs.writeFileSync(path.join(this.dir, 'activa.json'), JSON.stringify(v.doc, null, 2));
    this.doc = v.doc;
    this.fuente = 'estrategias/activa.json';
    this.emit('cambio', v.doc);
    return { ok: true, doc: v.doc };
  }

  importar(nombre, buf) {
    const inf = importarDocumento(nombre, buf);
    const seguro = String(nombre || 'documento').replace(/[^\w.\- ]+/g, '_').slice(-80) || 'documento';
    try { fs.writeFileSync(path.join(this.dir, 'importados', `${Date.now()}_${seguro}`), buf); } catch (e) { /* auditoría es lo de menos */ }
    return inf;
  }

  restaurarIntegrada() { return this.activar(JSON.parse(fs.readFileSync(this.plantilla, 'utf8')), 'restaurada'); }
}

module.exports = { GestorEstrategia };
