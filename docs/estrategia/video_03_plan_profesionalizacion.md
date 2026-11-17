# Vídeo 03 — Plan de profesionalización del Sistema RAPTOR

Documento vivo. Recoge el análisis técnico del sistema y los pasos de implementación
sobre el proyecto (`motor-senales/nucleo.js` + `v03-lab/`). La fuente de verdad es
el motor JS; el indicador MQL5 (`RAPTOR_System_v1_3.mq5`) es solo referencia visual.

## 0. Análisis técnico de referencia (resumen)

El Sistema RAPTOR es una estrategia híbrida de **seguimiento de tendencia**
(Trend-Following) + **estructura de mercado** (Market Structure / SMC) +
**retrocesos dinámicos** (Dynamic Pullbacks). Resuelve el problema clásico del
trading tendencial: entrar demasiado pronto en un retroceso (que revierte la
tendencia) o demasiado tarde cuando el impulso ya está agotado.

Tres capas:
1. Dirección y régimen de mercado mediante abanico de EMAs (30, 50, 100).
2. Confirmación de flujo institucional mediante quiebres de estructura con cuerpo
   (etiqueta `B` y rectángulos horizontales).
3. Sincronización fractal mediante confluencia multi-temporalidad (RAPTOR Scanner).

### Herramientas
- **EMA 30** controla la aceleración del impulso sano.
- **EMA 50** es el límite de tolerancia de momentum: si el precio la rompe con
  cuerpo, la velocidad de la tendencia previa se degradó y el retroceso deja de
  ser saludable.
- **EMA 100** filtro macro-direccional.
- **Zonas horizontales + quiebre con cuerpo**: filtran barridas de liquidez
  (liquidity sweeps / stop hunts) y falsas rupturas.
- **RAPTOR Scanner (M1–H1)**: la verdadera ventaja proviene de alinear marcos con
  separación fractal real (M15/H1 para sesgo, M1/M5 para gatillo). M1–M5 están
  altamente correlacionados → falsa ilusión de confluencia.

### Anatomía probabilística de las señales
- **`1` y `1R` (el engaño)**: toma de liquidez (Stop Hunt / Turtle Soup) seguida
  de cambio de carácter (MSS/ChoCh). Captura giros tempranos explosivos pero
  requiere Stop Loss amplio (peor R:R).
- **`2` y `3` (al toque de EMA 30/50)**: entradas pasivas en retroceso. R:R
  atractivo pero Win Rate menor; la `3` aparece en fase madura (mayor probabilidad
  de agotamiento).
- **`2B` y `2RB` (las favoritas)**: combinan ubicación + momentum (toca EMA 30,
  NO supera EMA 50) + confirmación direccional (quiebre con cuerpo, BoS) +
  optimización de entrada (retesteo). Sweet spot del sistema.
- **`3B` y `3RB`**: tercer impulso; riesgo de comprar en techo / vender en suelo.
- **`R` (reset)**: adaptación al ruido moderno. Peligro: múltiples resets en la
  misma zona = acumulación/distribución (rango), no tendencia sana.

### Comportamiento en activos sintéticos
- **FX Volatility 40 (1s)**: tendencias limpias, ideales para `2B`. Peligro:
  slippage y spread al cazar quiebres directos en M1; el retesteo de `2B/2RB`
  es prácticamente obligatorio.
- **Step 500**: fases de consolidación / escaleras laterales prolongadas.
  `2`, `3` y múltiples resets generan whipsaws en rangos. Filtro EMA 100 +
  alineación M15/H1 vitales.

### Puntos ciegos críticos
1. Ausencia de gestión de riesgo mecánica (SL/TP no definidos).
2. Vulnerabilidad en mercados laterales (chop): EMAs planas/enredadas → falsas
   rupturas constantes.
3. Sobre-operativa por exceso de etiquetas (10 variantes × 8 marcos).
4. Retraso al cierre de vela y posible repintado.

### Plan de optimización propuesto
- Filtro de régimen (regla anti-rango): no operar si las 3 EMAs no están
  claramente separadas, en orden secuencial estricto y con pendiente visible.
- Protocolo top-down real: H1/M15 para sesgo, M5/M1 para gatillo; ignorar
  M2/M3/M4.
- Jerarquía estricta de señales: 80–90 % del capital en `2B`/`2RB`; la `1`
  como contexto previo; evitar `2/3/3B/3RB` cuando el precio esté extendido.
- Mecánica de SL/TP: SL detrás del último swing previo al quiebre (cubierto por
  EMA 50 + margen de spread); mínimo 1:1.5 R:R; toma parcial en 1:1.5 o 1:2 y
  trailing con EMA 30/50.
- Auditoría estadística separada: 100 trades por activo separando Win Rate y
  Profit Factor de `2B/2RB` frente al resto.

---

## 1. Estado actual del proyecto (lo que ya tenemos)

### Motor `motor-senales/nucleo.js`
- Diccionario rectificado: `2` y `3` son entradas al toque, `R` es reset de la
  secuencia, cuerpo en **todas** las `B`, `2B`/`2RB` con retesteo.
- Parámetros: `cuerpoSoloUno: false`, `modo2B: 'retesteo'`,
  `caducidadRetesteo: 3`, `tolRetesteoAtr: 0.30`.
- Pruebas: `test_nucleo.mjs` 40 OK · `v03-lab/probar.mjs` 23 OK.
- Medición: roturas +0,070R (n=470, PF 1,15), solo toque −0,186R (n=1.040).
  El catálogo completo es −0,107R: solo funciona separando roturas de toques.

### Lo que falta (5 puntos)
1. Filtro anti-rango (chop) — código medible.
2. Jerarquía de señales en el reporte — ponderación por R medido.
3. Top-down en el Scanner — mostrar solo M15/H1/M5/M1.
4. SL/TP mecánicos — regla de ejecución, fuera del motor.
5. Bitácora de 100 trades — operación, no código.

## 2. Plan de implementación (en orden de impacto)

### Paso 2 — COMPLETADO (2026-11-14)

- `nucleo.js`: añadida constante `JERARQUIA` (tier A/B/C, peso 0-3, R y PF medidos)
  y función `pesoPatron(patron)`, exportadas.
- `v03-lab/evaluar.mjs`: sección «Jerarquía de señales (peso operativo)» en el
  reporte con tabla código/tier/peso/n/R/PF/acierto/recomendación.
- Resultado: Tier A = `3RB` (+0,295, PF 1,78) y `2RB` (+0,149, PF 1,42);
  Tier B = `1`, `1R`, `3B` (R marginal); Tier C = `2B`, `2`, `2R`, `3`, `3R`
  (R negativo, evitar).


| Paso | Qué | Dónde | Medible |
|---|---|---|---|
| 1 | Filtro anti-rango: parámetros `separacionMinAtr` y `pendienteMinAtr`. Descartar etiqueta si las EMAs no están separadas/en orden/con pendiente. | `nucleo.js` (escanear) + `v03-lab/evaluar.mjs` (variante) | Sí |
| 2 | Jerarquía en reporte: tabla de códigos ordenada por R medido. | `v03-lab/reporte.md` | Sí (lectura) |
| 3 | Top-down en Scanner: vista solo M15/H1/M5/M1. | `v03-lab/vista.*` | No (visual) |
| 4 | SL/TP mecánicos: documento de reglas de ejecución. | `docs/sistema/playbooks/` | No (operación) |
| 5 | Bitácora: plantilla de registro. | `docs/sistema/casos/` | No (operación) |

---

## Paso 1 — Filtro anti-rango (EN CURSO)

### Qué hace
Descarta una etiqueta cuando las 3 EMAs no están separadas y en pendiente:
- `separacionMinAtr`: distancia mínima entre EMA30↔EMA50 y EMA50↔EMA100, en ATR.
- `pendienteMinAtr`: pendiente mínima de la EMA100 en ATR por 5 velas.

Si cualquiera de los dos es `0`, el filtro queda desactivado (comportamiento actual).

### Implementación en `nucleo.js`
- Añadir los dos parámetros a `PARAMS` (por defecto `0`, desactivado, para no
  romper tests ni medición anterior).
- En `escanear`, dentro del bloque de tendencia alineada, calcular `separacionOk`
  y `pendienteOk`; si fallan, incrementar `filtros.chop` y `continue`.
- Añadir `chop: 0` a `filtros`.

### Medición en `v03-lab/evaluar.mjs`
- Añadir variante `con filtro anti-rango` con `separacionMinAtr: 0.5`,
  `pendienteMinAtr: 0.3`.
- Regenerar reporte y comparar roturas vs. base (+0,070R).

### Resultado de la medición (2026-11-14)

| Variante | n | Esperanza R | Acierto | PF | Train | Validación |
|---|---|---|---|---|---|---|
| roturas (base) | 470 | +0,070 | 47,2 % | 1,15 | +0,056 (n=308) | +0,096 (n=162) |
| roturas + filtro suave (0,3/0,15 ATR) | 248 | +0,073 | 47,2 % | 1,17 | +0,113 (n=154) | +0,008 (n=94) |
| roturas + filtro estricto (0,5/0,3 ATR) | 66 | **+0,230** | 60,6 % | 1,62 | +0,239 (n=40) | +0,217 (n=26) |

- El filtro **estricto** sube las roturas de +0,070R a **+0,230R** (PF 1,15 → 1,62),
  pero reduce n de 470 a 66 (−86 %). Muestra demasiado pequeña para ser fiable.
- El filtro **suave** apenas mejora (+0,073R) y degrada la validación (+0,008R).
- Los toques (2/3) también se filtran, pero siguen negativos.

### Decisión
El filtro anti-rango es **prometedor pero no concluyente**: el estricto mejora mucho
pero con n=66 no se puede confiar. Se deja como **parámetro opcional** (por defecto 0,
 desactivado) hasta tener más datos o un umbral intermedio (0,4/0,2 ATR) que
 mantenga n ≥ 150 y R ≥ +0,15R. El motor no cambia su comportamiento por defecto.

### Criterio de éxito (revisado)
Las roturas suben del +0,070R con n ≥ 150 y PF ≥ 1,30, y la validación no se
degrada. Con los umbrales actuales no se cumple; queda abierto para recalibrar.

---

## Notas
- El archivo `RAPTOR_System_v1_3.mq5` es referencia visual externa; no pertenece
  al proyecto. Se puede borrar.
- El motor es la fuente de verdad; el MQL5 debe adaptarse al motor, no al revés.