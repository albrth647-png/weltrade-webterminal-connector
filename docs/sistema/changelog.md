# Changelog del sistema de conocimiento

Formato: fecha · fase · qué cambió · por qué.

## 2026-11-14 · V03 — pasos 3-5: top-down, SL/TP, bitácora, filtro 0.4/0.2, jerarquía dinámica

- `escaner.js`: `TFS_ESCANER` pasa de `H1/M30/M15/M5` a `H1/M15/M5/M1`
  (top-down: H1/M15 sesgo, M5/M1 gatillo). Pesos recalibrados.
- `v03-lab/vista.html`: selector de TF actualizado (M1 en lugar de M30).
- `docs/sistema/playbooks/80_sl_tp_mecanicos.md`: reglas SL/TP mecánicas,
  TP mínimo 1.5R, notificación por Telegram por cada señal, sin límite de tiempo.
- `docs/sistema/casos/_plantilla_bitacora.md`: plantilla de bitácora de 100
  trades con separación Tier A (2B/2RB) vs resto.
- `v03-lab/evaluar.mjs`: nueva variante «filtro medio (0.4/0.2 ATR)» y su
  versión roturas-only. Medición: roturas + medio +0.113R (n=165, PF 1.27),
  entre estricto +0.230R (n=66) y suave +0.073R (n=248).
- `nucleo.js`: `calcularJerarquia(resultados)` y `actualizarJerarquia(nueva)`
  derivan la jerarquía de datos medidos sin romper la estática por defecto.

## 2026-11-14 · V03 — paso 2: jerarquía de señales

- `nucleo.js`: constante `JERARQUIA` (tier A/B/C, peso 0-3, R y PF medidos) y
  función `pesoPatron(patron)`, exportadas.
- `v03-lab/evaluar.mjs`: sección «Jerarquía de señales (peso operativo)» en el
  reporte, ordenada por R descendente.
- Tier A: `3RB` (+0,295, PF 1,78), `2RB` (+0,149, PF 1,42). Tier B: `1`, `1R`,
  `3B` (R marginal). Tier C (evitar): `2B`, `2`, `2R`, `3`, `3R`.

## 2026-11-14 · V03 — paso 1: filtro anti-rango

- `nucleo.js`: añadidos `separacionMinAtr` y `pendienteMinAtr` (por defecto 0,
  desactivados). En `escanear`, si están activos y las EMAs no están separadas /
  en pendiente, la etiqueta se descarta (`filtros.chop`).
- `v03-lab/evaluar.mjs`: variantes «con filtro anti-rango estricto (0,5/0,3)» y
  «suave (0,3/0,15)», más «roturas + filtro».
- Medición: roturas base +0,070R (n=470) → estricto **+0,230R (n=66, PF 1,62)**,
  suave +0,073R (n=248). El estricto mejora mucho pero con n=66 no es fiable;
  queda como parámetro opcional hasta recalibrar umbral intermedio.
- `docs/estrategia/video_03_plan_profesionalizacion.md`: plan y resultados del paso 1.

## 2026-11-14 · V03

- **`nucleo.js` cambia de comportamiento**, no solo de etiqueta, según el
  diccionario del propietario: el quiebre exige **cuerpo en todas las `B`**
  (`cuerpoSoloUno: false`) y la `2B`/`2RB` se opera en el **retesteo** del nivel
  (`modo2B: 'retesteo'`, caducidad 3 velas, tolerancia 0,30 ATR). Pruebas:
  `test_nucleo.mjs` 40 OK.
- **La `2` y la `3` son entradas** al toque y **`R` es el reset** de la secuencia
  1/2/3, no un patrón: cerrado el 2026-11-14. `v03-lab/` deja de llamarlas
  «avisos» en el reporte y en la gráfica.
- `docs/estrategia/video_03_estado.md`: auditoría actualizada: 13 reglas cumplen,
  3 son más estrictas, **0 desvíos abiertos** y 1 pendiente (mecha vs cierre en
  «el 2 supera al 1»).
- `v03-lab/`: banco de pruebas que importa `escanear()`, no lo reimplementa.
  Con cuerpo + retesteo: roturas **+0,070R** (n=470, PF 1,15, train +0,056 /
  validación +0,096) y solo toque −0,186R (n=1.040). Antes de la rectificación:
  roturas +0,046R (n=558), 1.596 señales.
- `nucleo.js`: `resetTrasEntrada` sigue siendo parámetro (por defecto `true`).

## 2026-11-12 · F0

- Creada la estructura `docs/sistema/`: índice, `playbooks/`, `aprendizajes/`,
  `casos/` (vacía hasta la primera marca) y este changelog.
- Ocho playbooks, uno por tema: principios, escáner, rayas, toques, niveles,
  catálogo Yoel, estructura M5 y validación.
- Añadido `validar_playbooks.mjs`: frontmatter, ids únicos, parámetros contra
  `PARAMS` del código, checks definidos/usados y casos citados.
- Añadido `npm run validar:docs`.
- Sin cambios de comportamiento: `escanear`, `escanearEstructura`, el envío a
  Telegram y `soloRayas` quedan igual.
- **Deuda declarada:** `R01`–`R09` se quedaron sin fixture automático al retirarse
  `validar_reglas.js`. Se reconstruye en F2; el linter documental no lo disimula.

## 2026-11-12 · F3

- `sugerencia.js`: k-NN con distancia de Gower ponderada sobre la huella, top 8,
  decaimiento temporal de 90 días y preferencia por símbolo/TF. Solo casos
  **aprobados** y solo del **pasado** (`t ≤ consulta`).
- Con menos de 3 vecinos o confianza < 0.6 **no hay fantasma**: se explica el
  motivo en vez de inventar una línea.
- La línea fantasma se calcula con la pendiente mediana de los vecinos sobre el
  ancla de la línea seleccionada. Se pinta discontinua y **nada se aplica sin
  pulsar Aceptar**.
- `POST /sugerencias` y `PATCH /casos/:id` (borrador · aprobado · rechazado).
- Las etiquetas van en `datos/casos.etiquetas.jsonl`, append-only: cambiar de
  estado no reescribe el caso original.
- Aceptar una sugerencia guarda el caso como aprobado con los ids de sus vecinos.
- Pruebas: `test_sugerencia.mjs` y 5 checks nuevos en `test_servidor.mjs`.
- Sin LLM: la explicación es una plantilla con recuentos reales
  («3 de 5 anclaron en el cierre»).

## 2026-11-12 · F2

- `escaner.js` puro: régimen (ATR% y percentiles), fuerza (ER20, R², ADX14,
  pendiente en ATR), estructura por pivotes, niveles en clústeres ±0.35 ATR y
  matriz MTF con pesos 0.40/0.30/0.20/0.10.
- Máquina de estados RANGO · TENDENCIA · DEBIL · AGOTAMIENTO con umbrales de
  entrada ≠ salida, confirmación y cooldown de 5 velas; corre sobre las últimas
  60 velas de la serie, así que la histéresis no depende de estado guardado.
- Ventana acotada a 400 velas: el coste no crece con la historia.
- `GET /escaner?simbodo=…` devuelve las 4 temporalidades, la matriz y `ms`.
- Panel «Tendencia» en `/grafica`: estado por TF, fuerza y sesgo global; se
  refresca cada 30 s y al cambiar símbolo o TF.
- Pruebas: `test_escaner.mjs` (determinismo, sin fuga de futuro, estados,
  matriz y p95) y 6 checks nuevos en `test_servidor.mjs`.
- Sigue sin avisar, sin enviar y sin filtrar señales. Umbrales `[EST]`.

## 2026-11-12 · F1

- `memoria.js`: un caso = marca + huella calculada al guardar (ER20, R², ADX14,
  ATR%, pila EMA, estructura, posición Donchian, sesión, día). Solo usa velas
  `≤ i2`: sin fuga de futuro.
- Almacén append-only en `datos/casos.jsonl`; ids `c-AAAA-MM-DD-NNNN`; el archivo
  no existe hasta la primera marca.
- `POST /marcas` (201 + `Location`), `GET /casos` (filtros símbolo/TF/estado,
  `limite`), `GET /casos/:id` (404 si no existe).
- Botón **«Guardar en memoria»** en `/grafica`: guarda la línea seleccionada y
  muestra el id devuelto. `localStorage` sigue siendo el borrador local.
- Duplicados: la misma línea (mismo `lineaId`, símbolo y TF) devuelve 409.
- Pruebas: `test_memoria.mjs` y ampliación de `test_servidor.mjs`.
- Sin tocar `escanear`, `escanearEstructura`, Telegram ni `soloRayas`.

## 2026-11-12 · Decisión

- **LLM descartado.** La explicación se redacta con plantillas deterministas.
  Eliminada la fase F5.
- **Retención 30 días**, igual que el sistema actual. `casos.jsonl` no caduca.
- El escáner es **contexto de marcación**: no avisa ni filtra señales.
