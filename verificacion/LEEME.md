# Carpeta de verificación (respaldo de la auditoría)

Esta carpeta respalda el trabajo de verificación realizado durante las auditorías,
para que nada se pierda si el entorno de trabajo se reinicia.

## Contenido

- **`verificar_hallazgos.js`** — script maestro que re-verifica los hallazgos de la
  auditoría profunda (P0/P1/P2, M1–M6, B1–B10) contra el código real.
- **`verificar_r2.js` … `verificar_r5.js`** — rondas de re-verificación 2 a 5
  (cada ronda verifica los hallazgos de una etapa distinta de la auditoría).
- **`verificar_m6.js`** — verificación específica del hallazgo M6 (reintentos/backoff).
- **`semgrep_resultados.json`** — resultado del escaneo estático con Semgrep.
- **`njsscan_resultados.json`** — resultado del escaneo estático con njsscan.
- **`capturas_canvas/`** — capturas de pantalla de las pruebas en vivo del panel de
  velas en canvas (zoom, paneo, presente/pasado, vista móvil 390×844, etc.).
- **`informe/`** — generador del informe de auditoría en DOCX/PDF:
  - `gen.js` — generador principal (usa la librería `docx` de Node).
  - `helpers.js` — helpers de maquetación (párrafos, tablas, portada).
  - `patch_docx.py` — parche post-generación del DOCX.

Los informes finales generados viven en `docs/informes/`.

## Cómo re-generar el informe

```bash
cd verificacion/informe
npm install docx
node gen.js        # genera el DOCX en download/ (ajustar ruta de salida si hace falta)
```

## Cómo re-ejecutar la verificación

```bash
node verificacion/verificar_hallazgos.js
```
