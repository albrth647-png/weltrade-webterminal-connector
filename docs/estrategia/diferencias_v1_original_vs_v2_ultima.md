# Análisis de diferencias — Estrategia ORIGINAL (v1, `raptor_default.json` + `estrategia.js`) vs ÚLTIMA (v2, `raptor_strategy.py`)

**Fecha:** 2026-11-08
**Objeto:** responder a la pregunta del propietario: *«la primera versión de la estrategia, es decir
la original, tiene cosas que esta última no tiene»* — verificar si es cierto, enumerar QUÉ cosas,
con cita de código y de datos reales, y decir qué conviene hacer con cada una.
**Método:** contraste pieza a pieza del código de las dos estrategias del repo + los números del
backtest real de 1 año de la v1 (`backtest_raptor/reporte.md`) + el estado v2 post-auditoría
(`docs/estrategia/auditoria_raptor_strategy.md`, `correcciones_aplicadas_v2.md`).
**Tono:** real, sin inventar. Cada pieza lleva su archivo y función. Lo que es interpretación, se marca.

---

## 1. Qué ES cada una (no son lo mismo, y esto es clave)

| | **ORIGINAL — v1 «Raptor-propio»** | **ÚLTIMA — v2 «catálogo de Yoel»** |
|---|---|---|
| Archivos | `motor-senales/estrategias/raptor_default.json` (documento, `"version": 1`) + `estrategia.js` (motor) + `doc_estrategia.js` (esquema) + `gestor_estrategia.js` (carga/activa) | `motor-senales/estrategias/raptor_strategy.py` (post-auditoría, 8 correcciones) |
| Procedencia | Diseño propio del repo, construido ANTES de tener el catálogo completo de Yoel — por eso el backtest la llama «RAPTOR-like» | Transcripción literal de los 3 vídeos de Yoel (Sifotrader): EMAs 30/50/100, el engaño, toques 1-2-3, sufijos R/B |
| Nivel que se toca | Zona estática S/R: pivote fractal confirmado en M15 | Banda dinámica EMA30–EMA50 |
| Validación | **Backtest real 1 año × FX Vol 20/60/99 (Weltrade demo): 3.341 señales, WR 45,7 %, PF 1,27, Net R 481,31, expectativa 0,144 R** + 3 experimentos walk-forward (spread, gatillo, empine) | 34 tests unitarios + backtest de cumplimiento 10 días BTCUSDT (331 señales, 0 violaciones de 12 reglas; **sin win-rate porque no define TP/SL**) |
| Forma de la señal | `{lado, fase, simbolo, nivel, precio, score, sl, tp, sesgo, fuerzaZona, toques}` | `{time, bar_index, timeframe, direction, kind, pattern, entry, invalidation, broken_level}` |

**Veredicto de partida:** la afirmación del propietario es **CIERTA**. La v1 tiene **15 piezas
funcionales** que la v2 no tiene. Pero casi todas son de dos tipos muy distintos: (a) infraestructura
de ejecución/riesgo que toda estrategia operable necesita, y (b) conceptos de LA OTRA estrategia
(zonas, fases, score) que NO deben mezclarse con el catálogo de Yoel. Detalle abajo.

---

## 2. Lo que la ORIGINAL tiene y la ÚLTIMA NO tiene (la respuesta directa)

### 2.1 Inventario completo (15 piezas)

| # | Pieza | Dónde vive en v1 | Estado en v2 |
|---|---|---|---|
| 1 | **Zonas S/R por pivotes fractales M15** (alas 2, tolerancia `max(0,0008·nivel, 0,30·ATR)`, vigencia 48 h con purga) | `estrategia.js` `_chequearPivote`/`_agregarPivote`/`_detectarPivotes` (líneas 148-190) | ❌ no existe ningún concepto de zona estática; su «zona» es la banda EMA30–EMA50, que se mueve con el precio |
| 2 | **Fuerza de zona** (cada pivote cercano refuerza la zona y sube `fuerza`; el nivel se re-promedia ponderado) | `_agregarPivote` (174-189): `z.nivel = (z.nivel·z.fuerza + nivel)/(z.fuerza+1)` | ❌ sin equivalente |
| 3 | **TN — cancelación de zona** (cierre M15 más allá de `nivel ± 0,5·ATR` → zona «muerta» + evento `tn`) | `_chequearTN`/`_fueraDeZona` (192-209) | ⚠️ lo más cercano es `exceeds50` (superar la EMA50 cancela la secuencia de toques), pero no «mata» ningún nivel ni emite evento |
| 4 | **Fases de toque EARLY/MAIN/LATE** con excursión mínima (`excursionAtr` 1,20: 1.er toque=EARLY; toque tras excursión ≥1,2·ATR=MAIN; resto=LATE) | `_chequearToque` (212-231) | ❌ v2 cuenta el 1.º/2.º/3.er toque pero no clasifica fases ni exige excursión; su análogo parcial es `require_extension` (mínimo nuevo entre toques) |
| 5 | **Sesgo H1 EMA(30) con pendiente de 3 velas y estado LATERAL tolerante** | `_recalcSesgo` (131-146): alza si `cierre>EMA` y `EMA` sube 3 velas; baja si el espejo; **lateral deja pasar ambos lados** | ⚠️ distinta semántica: la tendencia v2 intra-TF (30<50<100 + pendiente EMA100) es binaria — sin tendencia, 0 señales; y `filter_trend_confirmed` es consenso duro H1+H4 (desacuerdo = 0 señales). La v1 tolera la lateralidad; la v2 la bloquea |
| 6 | **Gatillo direccional**: la vela del toque debe CERRAR a favor (soporte→vela alcista `c>o`; resistencia→bajista `c<o`) | `_chequearToque` `dirOk` (237-241) | ❌ los avisos 2/3/2R/3R de v2 no exigen vela direccional; la direccionalidad v2 vive en la quiebra (cuerpo en la «1»; `close < ref_low` en las B) |
| 7 | **Scoring con pesos y umbral** (`score.min` 60 = fase + min(25, fuerza·5) + sesgo 25 + gatillo 10, cap 100) | `_chequearToque` (247-252) + `doc_estrategia.js` esquema | ❌ v2 es todo-o-nada: o la señal cumple sus reglas o no existe |
| 8 | **Dedup temporal por zona** (45 min: misma zona no emite dos señales seguidas) | `_chequearToque` `ultSenalZona` (244-254) | ❌ v2 no tiene dedup; su anti-repetición es el estado de secuencia, y por DISEÑO puede emitir en velas consecutivas (2 → 2B) |
| 9 | **Riesgo explícito SL/TP en ATR en cada señal** (`sl = nivel ∓ 1,0·ATR`, `tp = precio ± 2,0·ATR`, campo `rr`) | `_chequearToque` (255-263) | ❌ v2 solo da `invalidation` (máximo estructural del engaño/toque) y `broken_level`; **sin TP ni distancia ATR — por eso su backtest no calcula win-rate** |
| 10 | **Gestión de velas y reloj de mercado**: `maxVelas` por TF (M1:1200…D1:100), descarte de la vela EN FORMACIÓN del servidor, reloj de mercado `e.ahora` (no de pared) para dedup/vigencia | `estrategia.js` `setHistoria` (44-70), `onVelaCerrada` (100-116) | ❌ v2 confía en el caller (DataFrames de velas ya cerradas); no gestiona buffers ni vela en formación |
| 11 | **Whitelist de símbolos** (`"simbolos": []` = todos; filtrado en `docACfg`) | `raptor_default.json` + `doc_estrategia.js` | ❌ v2 opera sobre el df que le den, sin lista de símbolos |
| 12 | **D1 entre las TF válidas** (M1…D1) | `estrategia.js` `TFS` + `doc_estrategia.js` `TFS_VALIDAS` | ❌ v2 llega hasta H4 (a cambio incluye M1, que en v1 ya estaba) |
| 13 | **Arquitectura de DOCUMENTO validado + importador** (`.set/.tpl/.mq5/.ex5` → JSON → validación estricta → `activa.json`; activar/restaurar/importar) | `gestor_estrategia.js` + `doc_estrategia.js` + `importador.js` | ⚠️ v2 tiene los parámetros en una `dataclass` en código: ajustables, pero no importables/validables como documento |
| 14 | **Eventos en vivo** por EventEmitter: `zona` (nueva/refuerzo), `toque` (con fase), `tn`, `senal` — pensado para streaming (Telegram/UI) | `estrategia.js` (emit en 181, 206, 231, 256) | ⚠️ v2 es batch histórico (DataFrames); `scan_last` sirve para vivo pero no hay eventos |
| 15 | **Evidencia estadística de 1 año + 3 experimentos walk-forward** | `backtest_raptor/` (reporte.md, reporte_spread.md C1, reporte_gatillo.md C2, reporte_empine.md) | ⚠️ v2 tiene 1 backtest de cumplimiento (10 días, un símbolo) sin capa de riesgo |

### 2.2 Las piezas que hacen trabajo REAL (números del año completo, no teoría)

De `backtest_raptor/reporte.md` (1 año × FX Vol 20/60/99, datos reales Weltrade demo):

- **El funnel v1 filtra 43×**: 145.074 toques → 3.341 señales (2,3 %). El embudo es
  sesgo + gatillo + dedup + score. La v2 no tiene ese embudo: emite TODO lo que cumple sus reglas.
- **TN está muy vivo**: 14.639 cancelaciones frente a 14.958 zonas nuevas (≈ 0,98 por zona).
  Sin TN, la v1 habría seguido operando zonas ya inválidas.
- **El score crea un umbral oculto por fuerza** (aritmética directa de los pesos del JSON):
  `LATE` con fuerza 1 = 15 + 5 + 25 + 10 = **55 < 60 → no pasa**; LATE exige fuerza ≥ 2 (60).
  `EARLY` fuerza 1 = 65, `MAIN` fuerza 1 = 80. Por eso en el año hay 2.131 señales LATE
  (zonas ya reforzadas) frente a 844 EARLY y 366 MAIN.
- **El gatillo direccional es estructural**: el propio informe C2 lo constata — `cuerpDir ≥ 0`
  «por construcción del motor (exige vela de dirección)». La v2 emite avisos 2/3 sin esa condición.
- **Spread medido en vivo** (C1): FX Vol 20 = 4,07, FX Vol 60 = 3,94, FX Vol 99 = 8,78 — el
  backtest v1 se puede estresar con spread real; el de v2 no puede todavía (no tiene SL/TP).

### 2.3 Lecciones walk-forward que SOLO la v1 tiene (porque solo la v1 se ha podido probar así)

- **C2 gatillo (REFUTADO y documentado):** ninguna variante de filtro de vela gatillo superó el
  criterio pre-registrado en IN → no se adoptó. Y la hipótesis «vela grande → muerte rápida» salió
  refutada (perdedores rápidos: rango 0,555 ATR vs 0,602 del resto).
- **C2 hallazgo exploratorio:** la PROFUNDIDAD de penetración en la zona (`penetr ≥ 0,5 ATR`) es el
  mejor discriminador pre-entrada hasta ahora (expectativa 0,344 IN / 0,378 OUT, PF 1,60/1,67,
  estable) — pre-registrada como candidata de sizing con más historia.
- **EMPINE (descartado):** el filtro anti-impulso no es robusto (IN PF 1,17 peor que la base 1,23;
  por símbolo inconsistente, FX Vol 99 IN PF 0,66). Queda documentado para no volver a probarlo a ciegas.

La v2 no tiene todavía NINGUNA de estas lecciones sobre sus propias señales — y no puede tenerlas
hasta que defina TP/SL (pieza 9).

---

## 3. Lo que la ÚLTIMA tiene y la ORIGINAL no tiene (para el equilibrio)

Ya detallado en la auditoría (`auditoria_raptor_strategy.md`); resumen:

1. **EMAs 30/50/100 como estructura central** (la v1 solo usa una EMA(30) en H1 como sesgo).
2. **El catálogo completo de Yoel**: 1, 1R, 1RB, 2, 2R, 2B, 2RB, 3, 3R, 3B, 3RB, con la semántica
   exacta toque=aviso («es para que tú vayas a buscar la entrada», v3 2:25-2:54) vs entrada.
3. **El engaño** (estrategia 1) como entrada, con cuerpo confirmado.
4. **Reset R** con cascada (dos vías) + exigencia de salida nueva (`min_exit_bar`).
5. **Filtro de distancia** («muy alejada, no lo tomo» → `max_dist_atr`).
6. **«El límite»**: la EMA50 como techo duro del retroceso (`exceeds50`).
7. **Gating de avisos M15+** (`emit_touches_from`) — la regla del vídeo 02.
8. **Capa multi-TF «tendencia comprobada»** observable (`multi_tf_trend` + `filter_trend_confirmed`).
9. **Simetría BUY/SELL exacta** por espejo (la v1 la tiene por construcción de zonas, pero la v2
   la verifica numéricamente: prueba E).

---

## 4. Equivalencias PARCIALES (se parecen, pero NO son lo mismo)

| Concepto | v1 ORIGINAL | v2 ÚLTIMA | Diferencia de fondo |
|---|---|---|---|
| Nivel de referencia | Pivote fractal M15 (estático, con fuerza) | EMA30 (dinámica) | Estático vs dinámico: el backtest de uno no vale para el otro |
| Banda de toque | `±0,15·ATR` alrededor del nivel | entre EMA30 y EMA50, cierre del otro lado de la EMA30, tolerancia 0,10·ATR | v1 mide proximidad; v2 exige ATRAVESAR la EMA30 |
| Separación entre toques | `excursionAtr` 1,20 desde la zona | `require_extension`: mínimo nuevo más allá del low del toque | excursión lejos del nivel vs mínimo nuevo en el lado de la tendencia |
| Direccionalidad | vela del toque a favor (gatillo) | cuerpo en la quiebra de la «1» | v1 filtra el AVISO; v2 filtra la ENTRADA |
| Tendencia | sesgo EMA30 H1, lateral tolerante, componente de score | alineación 30<50<100 + pendiente EMA100 + consenso H1/H4, binaria | v1 degrada el score; v2 bloquea la señal |
| Anti-repetición | dedup 45 min por zona | estado de secuencia (toques/pend/ciclo) | tiempo vs máquina de estados |
| Invalidez | TN mata la zona (cierre ±0,5 ATR) | `exceeds50` cancela la secuencia | muerte del nivel vs muerte de la secuencia |
| Riesgo | SL/TP ATR explícitos | `invalidation` estructural | v2 no puede estimar win-rate hoy |
| ATR | SMA de TR(14) sobre M15 | EWM(α=1/14) sobre el TF escaneado | mismo propósito, fórmula distinta |

---

## 5. Diagnóstico honesto

1. **«La original tiene cosas que esta última no tiene» — VERDADERO**, y son 15 piezas (§2.1).
2. Pero **no son dos versiones de una misma estrategia: son DOS ESTRATEGIAS DISTINTAS** con un
   vocabulario común (toque, tendencia, ATR, velas cerradas). La v1 es «Raptor-like» propio —
   construida antes del catálogo completo de los vídeos, y validada estadísticamente. La v2 es el
   catálogo de Yoel — fiel a los vídeos y aún sin capa de riesgo ni estadística de 1 año.
3. De las 15 piezas, **ninguna del grupo conceptual (1-5, 7) debe importarse a la v2**: mezclar
   zonas fractales, fases o score con el catálogo de EMAs produce un híbrido que ya no es el
   Raptor de Yoel ni es la v1 validada. El score en particular NO existe en ningún vídeo.
4. Las piezas del grupo de **infraestructura (8, 9, 10, 11, 13, 14)** sí son portables y, de hecho,
   la v2 las necesita para operar en real: sin SL/TP no hay win-rate ni sizing; sin dedup puede
   llover de señales en tendencias largas; sin gestión de velas no corre dentro del motor JS/PWA.
   En la v2 deben entrar marcadas como «decisión de implementación» (mismo estándar de honestidad
   que ya usa su docstring), nunca como regla de Yoel.

## 6. Recomendación (dos caminos, sin mezclar conceptos)

1. **Camino A — decidir con datos (recomendado primero):** correr la v2 sobre el MISMO dataset del
   backtest v1 (1 año × FX Vol 20/60/99 M5/M15) con la MISMA capa de riesgo (SL 1·ATR / TP 2·ATR,
   ambigua=pérdida) y comparar contra el baseline v1 (3.341 señales, PF 1,27). Es barato y dice
   cuál de las dos gana con la misma evidencia. El verificador independiente del backtest v2 ya
   existe y sirve para validar las reglas de Yoel sobre esos datos.
2. **Camino B — portar solo la capa de ejecución** (dedup por nivel/dirección, `slAtr`/`tpAtr`
   opcionales, `maxVelas` + vela en formación, whitelist, exportación de `Params` a documento JSON
   con esquema) y congelar la v1 como «legacy con su baseline». La capa multi-TF
   (`filter_trend_confirmed`) ya cubre lo que el sesgo H1 hacía en la v1, con semántica más dura.
3. **En ambos caminos:** no resucitar zonas/fases/score dentro de la v2. Si el propietario quiere
   conservarlas, quedan en la v1, que ya está congelada con su PF 1,27 y sus experimentos.

---

## 7. Anexo — la otra lectura: v1→v2 del PROPIO archivo `raptor_strategy.py`

Si «la original» se lee como la primera versión del propio archivo de Yoel (la subida del
propietario, auditada en `df593f6`), también tenía cosas que la v2 corregida **ya no hace por
defecto** — y cada una fue un cambio documentado con evidencia:

| La v1 original del archivo… | La v2 ahora… | Por qué (cita) |
|---|---|---|
| Exigía cuerpo en TODAS las quiebras B | `require_body_on_break=False`: cuerpo solo en la «1» | «con cuerpo» solo está verbalizado para la 1 (v3 0:29-0:58); para 2B/3B dice solo «quebró» |
| Emitía avisos 2/3 en M5 | `emit_touches_from="M15"` | «la 2 y la 3… de M15 por arriba» (v2 0:00-0:29) |
| No filtraba por distancia | `max_dist_atr=2.0` activo | «está muy alejada, no lo tomo» (v2 58-87 s) |
| Re-disparaba el engaño sin salida nueva (`1R, 1R`) | exige salida sobre la EMA50 posterior (`min_exit_bar`) | definición de Yoel: «se sale… regresa… quiebra» |
| Las salidas huérfanas no reseteaban | `reset_on_abandoned_exit=True` | «se salió, volvió, lo hizo de nuevo» (v3 1:27-2:25) |
| No tenía M1, `1RB`, multi-TF ni docstring A/B | todo añadido | catálogo v3 en M1; etiquetas 1RB en pantalla; «tendencia comprobada» (v3 5:19-5:48) |

Ninguna de esas decisiones se tomó a ciegas: cada una está en `correcciones_aplicadas_v2.md` con
su cita de vídeo y su test (escenarios G-N).

## 8. Fuentes

- Código v1: `motor-senales/estrategia.js`, `doc_estrategia.js`, `gestor_estrategia.js`,
  `motor-senales/estrategias/raptor_default.json`, `LEEME.md`.
- Código v2: `motor-senales/estrategias/raptor_strategy.py` (+ su docstring PARTES A/B).
- Datos v1: `backtest_raptor/reporte.md`, `reporte_spread.md`, `reporte_gatillo.md`,
  `reporte_empine.md`, `senales.csv`.
- Auditoría v2: `docs/estrategia/auditoria_raptor_strategy.md`, `correcciones_aplicadas_v2.md`,
  `docs/backtest/backtest_raptor_20261107.md`.
- Vídeos: `videos/yoel/datos/video_0{1,2,3}_transcripcion.txt` y análisis en `docs/estrategia/`.
