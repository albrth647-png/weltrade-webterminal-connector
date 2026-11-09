# Contraste — VÍDEO 03 (material real) vs RAPTOR HÍBRIDA implementada

**Fecha:** 2026-11-08
**Petición:** «buscar las transcripciones y fotos y demás del vídeo #3, que es el vídeo más
importante de todo, y compáralo vs la estrategia híbrida».

## 0. Material usado (extraído del propio repo)

| Archivo | Qué contiene | Estado |
|---|---|---|
| `videos/yoel/datos/video_03_transcripcion.txt` | 18 trozos ASR (0–514 s) | ✅ revisado |
| `videos/yoel/datos/video_03_transcripcion_trozos.json` | los mismos trozos con marcas de tiempo | ✅ revisado |
| `videos/yoel/datos/video_03_frames/` | 64 frames (1 cada 8 s, 960×540) | ✅ 8 frames inspeccionados a ojo |
| `videos/yoel/datos/video_03_analisis_frames.json` | análisis IA de los 64 frames con audio sincronizado | referencia |
| `docs/estrategia/video_03_analisis.md` | síntesis previa del vídeo | referencia |

Los frames estaban versionados con la marca *skip-worktree* (sparse checkout: `!/videos/`),
así que se materializaron con `git show HEAD:<ruta>` **sin descargar ningún mp4**. No hay
ningún vídeo en el árbol de trabajo.

Vídeo: 514 s, FX **Volatility 40 (1s)** en **M1**, cuenta demo «BotsburyMarkets-DG Live Demo
Account • Hedge», panel **RAPTOR SCANNER v1.2** y panel **«Ordena»**.

---

## 1. Lo que confirman los frames (evidencia directa)

| Frame | Evidencia leída |
|---|---|
| f_031 | Pizarra a mano: **«2B  2RB»** encima de la gráfica; el gráfico con etiquetas rosas en los toques de EMA |
| f_035 | Pizarra completa: **«2B 2RB» / «3B 3RB»** (las cuatro variantes B) |
| f_024, f_028 | Pizarra **«2 2B» / «3 3B»** + dibujo a mano de la secuencia de toques (1→2→3 sobre la EMA) y las tres EMAs en pantalla |
| f_037 | **RAPTOR SCANNER v1.2**: matriz TF × Flip 1-5, filas M1…MN, celdas rojas en M1–M15, filtros «14 pairs», «Step 200/500/800»; en el gráfico etiquetas **1R / 2R** |
| f_044, f_048 | Recuadro hecho a mano alrededor de «2B 2RB / 3B 3RB», zigzag de la jugada, etiquetas **1R**, **2RB** y **zonas rojas** sobre los mínimos quebrados |
| f_059 | Las **tres EMAs** (blanca rápida, amarilla, oscura), precio por debajo de las tres; etiquetas **1R** y **2RB** en los retrocesos; zona roja en el mínimo quebrado; desplome posterior |

La transcripción literal (trozos 2–6, 11–14) coincide con el doc previo:
«la uno… quiebra con cuerpo», «la dos… primer toque que supera y segundo toque»,
«la tres… supera el número dos y toca nuevamente la EMA de treinta y cincuenta»,
«**R significa R de reset**», «**uno dos tres es toque**, no es quiebre… es para que tú
vayas a buscar la entrada», «la dos B… segundo toque pero también quebró el mínimo
anterior», «para que suceda el dos B el precio tiene que **tocar la EMA de treinta, no
superar la de cincuenta y respetar** la de treinta y cincuenta».

---

## 2. Contraste regla por regla

Leyenda: ✅ cumple · 🟡 cumple con un parámetro propio que el vídeo no define · ❌ no implementado.

| # | Regla del vídeo 03 | Implementación | Veredicto |
|---|---|---|---|
| 1 | Todo sale de 1, 2, 3 y sus sufijos R/B (0:00–1:27) | Catálogo completo en `raptor_strategy.ENTRY_PATTERNS`/escáner: 1, 1R, 1RB, 2, 2R, 2B, 2RB, 3, 3R, 3B, 3RB | ✅ |
| 2 | **«UNO DOS TRES ES TOQUE»**: 2 y 3 son avisos, no entradas (2:25–2:54) | 2/3/2R/3R salen con `kind="touch"` y el backtest **no los cuenta como operaciones** (columna `resultado="aviso"`) | ✅ |
| 3 | **1 = la seductora**: tendencia → sale (engaño) → regresa → **quiebra con cuerpo** (0:29–0:58) | `body_break` = vela bajista con cuerpo/rango ≥ 0,50 **y** cuerpo ≥ 0,30·ATR; exige una salida previa sobre la EMA50 (`exceeds50`) en `fake_lookback` velas | ✅ (el 0,50/0,30 es propio) |
| 4 | **2 = primer toque que supera + segundo toque** (0:58) | `touches == 2` con `touch_zone` (mecha toca EMA30, cierre bajo EMA30, sin superar EMA50) | 🟡 «supera» se mide como mínimo más bajo entre toques (`require_extension`), métrica propia |
| 5 | **3 = supera el 2 y vuelve a tocar EMA30/50** (0:58–1:27) | `touches == 3` con la misma exigencia de extensión | 🟡 ídem |
| 6 | **R = RESET**: la estrategia se repite en la misma dirección (1:27–2:25) | Contador `cycle`: +1 tras cada entrada y tras cada salida+retorno; etiqueta con sufijo R. Soportes: `min_exit_bar`, `exit_open`, `reset_on_abandoned_exit`, `new_trend_gap=60` | ✅ (la caducidad de 60 velas es propia) |
| 7 | **B = quiebra** del mínimo anterior (4:50–5:19) | `2B/3B` cuando el cierre rompe `ref_low` = mínimo de las `swing_lookback=8` velas previas al toque | 🟡 la ventana de 8 velas es propia (el vídeo dice «el mínimo anterior», sin ventana) |
| 8 | **2B**: tocar EMA30, **no superar** EMA50 y **respetar** 30/50 (5:19–6:17) | `touch_zone` exige `high ≥ EMA30−tol` y `high ≤ EMA50+tol`; cualquier vela que supere EMA50 (`exceeds50`) **mata la secuencia pendiente** | ✅ |
| 9 | **2RB / 3RB** existen como señal autónoma (3:52–4:50 + pizarra f_035) | `2RB`/`3RB` se emiten cuando el toque con reset desemboca en quiebra | ✅ |
| 10 | **2B y 2RB son «las mejores, por encima de cualquier cosa»** (4:21–4:50) | `PESO_PATRON_DEFAULT`: 2B/2RB = 40, entradas 1/1R/1RB/3B/3RB = 30, avisos = 10 | 🟡 solo **ordena** el score; no filtra (decisión del diseño) |
| 11 | **«El quiebre = dominio vendedor con tendencia comprobada»** (5:19–5:48) | `filter_trend_confirmed()` (consenso de TFs superiores) + alineación EMA30<EMA50<EMA100 con pendiente en cada TF | 🟡 el filtro multi-TF **no se usa** en modo independiente (lo prohíbe la nueva regla del propietario); la alineación sí se aplica dentro de cada TF |
| 12 | **Zonas rojas** = mínimo/máximo que se quiebra (presentes en ~40 frames) | `detectar_zonas()` (pivotes fractales) + `zona_tipo/zona_fuerza` + `confluencia` | 🟡 aproximación estructural; no dibuja el rectángulo del quiebre exacto |
| 13 | **«Hay que tener vista para identificar cuándo está mal; no son muchos»** (6:46–7:15) | — | ❌ no programable con lo que dice el vídeo (no da criterio medible) |
| 14 | **Escáner multi-TF** (Flip 1-5, Step 200/500/800, celdas por TF) | No replicado (motor `RaptorScanEngine` no público). Con el modo independiente, además, queda **fuera de la regla del propietario** | ❌ por diseño |
| 15 | **Panel «Ordena»** (confianza, probabilidad, lotaje, botones COMPRA/VENDER) | Fuera de alcance: el proyecto es **bot de señales**, el propietario opera a mano | ❌ por alcance |

---

## 3. Lo que el vídeo 03 no permite programar

1. **«Cuándo está mal»**: dice que se ve «a ojo» y que «no son muchos». No hay métrica.
2. **Ventana del «mínimo anterior»** en el B: el vídeo no dice cuántas velas atrás.
3. **Diferencia 1R vs 1RB**: el audio es ambiguo (3:52–4:21); en pantalla aparecen las dos.
   El motor emite `1R` por defecto (`fake_reset_label`).
4. **Semántica de Flip 1-5 / Step 200-500-800**: no se explica en ningún frame.
5. **«La matadora» / «la que más da»**: apodo sin definir (se corrige a sí mismo en 4:00).

---

## 4. Independencia por temporalidad (lo que se rectificó)

Requisito del propietario: **cada temporalidad aplica la estrategia completa mirando solo
sus propias velas** («M5 no puede mirar M15 ni ninguna otra temporalidad»).

Antes la híbrida tomaba prestadas piezas de otras TF para todas las señales; ahora
`HibridaParams.independiente=True` (por defecto) las toma de la TF de la señal:

| Pieza | Antes (modo v1 compartido) | Ahora (independiente) |
|---|---|---|
| Zonas S/R fractales | M15 para todas | la TF de la señal |
| Fases EARLY/MAIN/LATE | velas M5 | velas de la TF de la señal |
| Sesgo EMA30 + pendiente | H1 | la TF de la señal |
| ATR del SL/TP | M15 | la TF de la señal |
| Recorrido del resultado | M5 | la TF de la señal |
| Catálogo | avisos 2/3 solo desde M15 (vídeo 02) | **catálogo completo en cada TF** (vídeo 03 lo muestra entero en M1) |

`independiente=False` reproduce el comportamiento anterior para poder comparar.
Verificado con el test **T8**: al destruir M15/M30/H1 (×3 + 1000), las señales de M1 y M5
salen **idénticas**; y una señal M5 calcula sus capas solo con M5.

> Nota de coherencia: el vídeo 02 decía que la 2 y la 3 «no aplican para temporalidades
> menores»; el vídeo 03 (el importante) muestra el catálogo completo en M1. Se siguió el 03
> y el requisito del propietario. Reversible: `Params(emit_touches_from="M15")`.

---

## 5. Backtest real con el modo independiente (10 días, 4 activos)

Datos: velas reales descargadas por el conector (M5 2.857 / M15 954 / M30 477 / H1 239 por
activo, 2026-10-29 → 2026-11-08). Riesgo: SL 1·ATR(TF de la señal), TP 2·ATR, recorrido en
la misma TF, vela ambigua = pérdida. Sin spread ni comisión.

| Activo | Entradas | Avisos | WR | netR | PF |
|---|---|---|---|---|---|
| FX Vol 20 | 78 | 64 | 30,8 % | −6,0 | 0,89 |
| FX Vol 40 | 63 | 72 | 27,0 % | −12,0 | 0,74 |
| SFX Vol 20 | 69 | 63 | 37,7 % | +9,0 | 1,21 |
| SFX Vol 40 | 59 | 56 | 44,1 % | +19,0 | 1,58 |

Por temporalidad (SFX Vol 40): M5 42 entradas WR 50,0 % PF 2,00 · M15 9 / 11,1 % / 0,25 ·
M30 5 / 40,0 % / 1,33 · H1 3 / 66,7 % / 4,00.

Lectura honesta: 269 entradas en 10 días no son muestra suficiente para concluir nada; el
resultado agregado ronda el equilibrio (+10R) con dispersión enorme entre activos. El filtro
de confluencia con el radio por defecto (0,5·ATR) deja **0 entradas** en modo independiente:
las distancias reales a la zona tienen mediana 3–13·ATR, así que ese umbral hay que
re-calibrarlo por TF antes de usarlo.

---

## 6. Decisiones pendientes (para el propietario)

1. **M1**: el vídeo 03 opera el catálogo completo en M1 y hoy no lo descargamos (empezamos en
   M5). Si quieres replicar el vídeo, hay que añadir M1 al conector y al backtest.
2. **1R vs 1RB**: elegir etiqueta por defecto cuando el engaño se resetea.
3. **Filtro de confluencia**: subir `confluencia_atr` (p. ej. 3,0) o desactivarlo.
4. **Avisos por TF**: mantener el catálogo completo en todas (actual) o volver al reparto del
   vídeo 02 (`emit_touches_from="M15"`).
5. **«Cuándo está mal»**: sin criterio del vídeo no se puede programar; si aparece en otro
   vídeo, se añade como filtro.
