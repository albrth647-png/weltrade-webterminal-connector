# Video 02 de Yoel — Análisis completo (transcripción + pantalla + audio)

**Fecha de análisis:** 2026-11-08
**Fuente:** `videos/yoel/video_02_original.mp4` (respaldo íntegro en este repo)
**Método:** transcripción ASR (trozos ≤30 s; el tramo 0–10 s se detectó en chino por error del ASR y se reconstruyó combinando su traducción con re-transcripciones parciales) + análisis visual de 22 frames cada 4 s con IA de visión y audio sincronizado. Datos crudos en `videos/yoel/datos/video_02_*`.

## 1. Metadatos técnicos

| Campo | Valor |
|---|---|
| Duración | 86.78 s |
| Resolución | 720×1280 (vertical 9:16) |
| Códecs | H.264 + AAC |
| Tamaño | 3.0 MB |
| Particularidad | **Subtítulos quemados en el video** (blanco con borde negro) que confirman el audio; ventana flotante del **Raptor Scanner** sobre el gráfico |

## 2. Transcripción completa (reconstruida)

> El ASR detectó el tramo inicial (0–10 s) como chino; ese fragmento se recuperó
> traduciendo la salida china y combinándola con las re-transcripciones que sí
> salieron en español. Los trozos crudos quedan en
> `datos/video_02_transcripcion_trozos.json` para re-verificación.

**0:00–0:29** *(reconstruido)*
«Vamos a analizar la **estrategia número dos**. La dos y la tres **no aplican para temporalidades menores**, escúchenme bien. Pero para operar esta, tú tienes que **esperar a que ella rompa este nivel**, porque es una estrategia número dos. **Fue creada para temporalidades mayores, de M15 por arriba**. ¿A qué me refiero? Aquí tengo en M15 esta dos o esta… aquí buscamos un…»

**0:29–0:58**
«¿Cómo lo hacemos? **Nos vamos a temporales menores y buscamos una entrada**. Si se dan cuenta, **las EMAs se mantienen**, ya no tienes que agregarlas tú, se mantienen las EMAs. Si están viendo esto, **tú pones tu línea de tendencia y buscas una oportunidad con el uno-dos-tres**, como tú quieras tomar la entrada. Aquí tiene un **cierre del ciclo**, si me entiendes. O sea, todo esto lo puedes ir… Bien, esta es la número dos, y **lo mismo para la número tres, cuando el precio toque**, por qué…»

**0:58–1:27**
«…que **no salió el tres porque el precio nunca superó**. Tiene en cuenta todas esas cosas, pero **siempre vas a estar operando a favor de la tendencia. Siempre.** Sígueme: va a estar operando a favor de la tendencia, listo. Por ejemplo, **si yo regreso acá al escáner** y vino para esta, aquí tú tienes que ver cómo se mueve: **me gusta, no me gusta, está muy alejada, no lo tomo**. Llegas aquí, **estás en tu límite, te dice ya no puedes pasar de aquí**, estás en tu límite, no te puedes pasar ahí, listo.»

## 3. Qué se ve en pantalla (análisis visual)

### 3.1 ¡EL RAPTOR SCANNER ES VISIBLE! (panel flotante sobre el gráfico)

Los frames 01, 02, 03, 05, 06, 07, 08, 09, 19, 20, 21 y 22 muestran la ventana **«RAPTOR SCANNER»** (se leyeron versiones v1.2 / v1.2A / v1.2.5 / v1.2.8 — es la v1.2.x). Esto **confirma el nombre real del producto** que el dossier documentaba como preventa.

**Estructura del panel:**

| Elemento | Detalle leído en pantalla |
|---|---|
| Filas (matriz) | Temporalidades: M1, M3, M5, M15, M30, H1, H2, H4, H8, H12, D1, W1, MN |
| Columnas | «Flip 1, Flip 2, Flip 3, Flip 4, Flip 5» + columnas «FX Volatile/Volatility» + columnas «Step/Snap 200, 500, 800 (también se leyó 100/50/20 en algún frame)» |
| Cabecera | «TF / PAIR» |
| Celdas | **Azules** (alcistas) con números «1», «2»; **rojas** (bajistas) con «2», «3», «M3», «M»; grises («ZM», «2M») |
| Toggles | «EMAs Only», «Break Box/Break Line/Break bar», «Alerts», «EMA Sweep», «Sweep Line», «End Bars», «Block line», «Asset» |
| Filtros | «Pairs: **14 pairs**», «Side: **BOTH**», «Show: …» |

**Interpretación de las celdas (hipótesis, aún no confirmada):** los números «1», «2», «3» de las celdas coinciden con la **numeración de sus estrategias** (la celda «2» aparecería cuando la estrategia nº2 está activa en ese TF). «R»/«M»/«ZM» sin identificar aún.

### 3.2 El gráfico y sus indicadores

- Plataforma: **MT4/MT5 móvil** (la mayoría de los frames); un frame (f_04) muestra etiquetas de posición estilo TradingView con **«TP +$281.31 0.28%»** y **«BUY 0.86 $53.34»** (posibles valores de una operación mostrada).
- Tooltip del indicador (f_10): **«RaptorScanEngine»**, «Time: 2026.10.21 01:24», **«EMA30: 144995.190»** — el valor (~145 000) sugiere un activo de cotización alta (índice/sintético/cripto). **El nombre del motor del indicador es «RaptorScanEngine»**.
- Etiquetas **«1 EMA» / «2 EMA»** junto a dos líneas (f_01) y **EMA30** en el tooltip → las EMAs que él dice que «se mantienen».
- Líneas escalonadas (como las amarillas del video 1) visibles de nuevo.
- Líneas horizontales de nivel, línea de tendencia dibujada por él, y un **rectángulo azul translúcido de selección** (f_17).

### 3.3 Temporalidades observadas (coinciden con el audio)

| Tramo | TF activo en pantalla | Qué hace |
|---|---|---|
| ~14–28 s | **M15** (f_08 resaltada) | Señala la señal nº2 en M15 con el escáner |
| ~48–66 s | **M5** (f_13, f_14, f_15 resaltadas) | Baja a temporales menores a buscar la entrada |
| ~70 s | M2 leída en f_18 (posible, o M5 por lectura borrosa) | Sigue buscando la entrada |
| ~72–87 s | Escáner Raptor de nuevo | Revisa la matriz: «me gusta / no me gusta / muy alejada / límite» |

## 4. Lo que este video añade a la estrategia (hallazgos principales)

1. **El sistema tiene ESTRATEGIAS NUMERADAS (1, 2, 3…).** El video 1 mostraba la jugada de M1 (probablemente la nº1). La **nº2 y la nº3 son para M15 hacia arriba** — explícito: «no aplican para temporalidades menores».
2. **Flujo multi-temporalidad (la clave del video):** señal en TF alto (M15 con el escáner) → **bajar a temporales menores (M5) a ejecutar la entrada** con línea de tendencia + uno-dos-tres.
3. **Condición de disparo nº2/nº3:** **esperar a que el precio ROMPA el nivel** antes de operar. Y la nº3 exige que el precio **supere** el nivel: «no salió el tres porque el precio nunca superó».
4. **Las EMAs son parte del gráfico base** (EMA30 confirmada en tooltip; etiquetas 1 EMA / 2 EMA; toggles «EMAs Only», «EMA Sweep» en el escáner).
5. **Regla de oro repetida 3 veces: SIEMPRE a favor de la tendencia.**
6. **Filtro de distancia:** si la señal «está muy alejada, no lo tomo» — hay una distancia máxima aceptable desde la zona/nivel.
7. **El LÍMITE:** «estás en tu límite, te dice ya no puedes pasar de aquí» — existe un marcador/nivel que invalida la entrada si el precio lo pasó.
8. **El escáner es la fuente de las señales:** «si yo regreso acá al escáner…» — el flujo real de trabajo es: escáner → evaluar señal → ir al gráfico → ejecutar.
9. **«Cierre del ciclo»** aparece como subtítulo quemado y en el audio — concepto de él aún sin definir (a validar).
10. **14 pares** es el universo por defecto del escáner («Pairs: 14 pairs»).

## 5. Estado actualizado de las preguntas abiertas (del video 01)

| # | Pregunta | Estado tras video 02 |
|---|---|---|
| 1 | ¿Qué es la «alerta patrón»? | **Parcialmente respondido:** el patrón dispara entradas numeradas; el escáner marca las celdas. Falta la definición exacta del patrón |
| 2 | ¿Cómo define el 1-2-3? | Sigue pendiente; se usa como oportunidad de entrada en el TF menor tras la señal |
| 3 | ¿Qué es «el engaño»? | Pendiente |
| 4 | ¿Reglas de «bailar pegado»? | Pendiente |
| 5 | ¿Qué indicador produce las líneas escalonadas? | **Pista:** el motor se llama «RaptorScanEngine»; las escalonadas siguen visibles. Pendiente de confirmar |
| 6 | ¿Qué par/activo opera? | **Nuevo dato:** el escáner cubre «14 pairs»; el activo del gráfico tiene cotización ~145 000 (EMA30). Nombre exacto pendiente |
| 7 | ¿Gestión del stacking? | Pendiente |
| **NUEVAS** | ¿Qué significan «R», «M», «ZM» en las celdas del escáner? | Pendiente |
| **NUEVAS** | ¿Qué son exactamente las columnas «Flip 1–5» y «Step/Snap 200/500/800»? | Pendiente (hipótesis: Flips = estados de sus estrategias 1–5; Steps = EMAs/medias de 200/500/800) |
| **NUEVAS** | ¿Qué es el «cierre del ciclo»? | Pendiente |
| **NUEVAS** | ¿Cómo se mide «muy alejada» y dónde está «el límite»? | Pendiente (parecen filtros integrados: toggles «Break Line», «Block line») |

## 6. Nuestra conclusión operativa para el motor (hipótesis marcadas)

El flujo real de Yoel que este video muestra: **escáner multi-TF (matriz de celdas por temporalidad) → señal en M15+ → bajar a M5 → línea de tendencia + 1-2-3 a favor de la tendencia → filtros de distancia y límite → entrada**.

Esto se mapea (hipótesis) con nuestro motor así:
- La **matriz del escáner** ↔ nuestra tabla de zonas/toques por TF (`gestor_estrategia`).
- La **señal en M15+** ↔ nuestros toques EARLY/MAIN/LATE calculados en TF alto.
- **Bajar a M5 para el gatillo** ↔ nuestro `gatillo.direccional` en M5 (¡mismo concepto de confirmación en TF menor!).
- **EMA30 + «a favor de la tendencia»** ↔ nuestro filtro de sesgo EMA(30) H1.
- **Filtro de distancia («muy alejada»)** ↔ nuestras tolerancias `tolPivoteAtr`/`bandaAtr`.
- **El «límite»** ↔ candidato a nuevo filtro: distancia máxima recorrida desde la zona antes de invalidar la entrada (no implementado aún como tal).

⚠️ Todo esto son hipótesis de trabajo para diseñar la validación con los próximos videos.

---
*Documento generado a partir de la transcripción ASR (con reconstrucción del tramo 0–10 s) y el análisis visual frame a frame (22 frames). Datos crudos en `videos/yoel/datos/`.*
