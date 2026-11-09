# VÍDEO 03 — Fichas de cada estrategia y señal (lo esencial, extraído del material real)

**Fuente:** `videos/yoel/datos/video_03_transcripcion.txt` (18 trozos ASR, 0–514 s),
`video_03_frames/` (64 frames; inspeccionados f_024, f_028, f_031, f_035, f_037, f_044,
f_048, f_059) y `docs/estrategia/video_03_analisis.md`.
**Vídeo:** «De $100 a $1,000 con las estrategias de raptor» · 8 min 34 s · FX **Volatility 40
(1s)** en **M1** · RAPTOR SCANNER v1.2 + panel «Ordena».
**Motor de referencia:** `raptor_strategy.py` (núcleo) · `raptor_hibrida.py` (capas) ·
`backtest_hibrida.py` (riesgo).

> **Nomenclatura vigente desde 2026-11-09.** Este documento es la lectura del vídeo,
> donde **R = reset** y **B = quiebre**. El propietario fijó después, sobre su propia
> gráfica (`evidencia/capturas_usuario/ultima_captura.jpg`), que **el número es el toque
> y la R es su ROMPIMIENTO**. Traducción final (catálogo completo): los toques siguen
> siendo `1`/`2`/`3`; `2B` → `2R` y `2RB` → `2RB`; `3B` → `3R` y `3RB` → `3RB`; la
> seductora (`1`/`1R` del vídeo) → `1S`. Se añaden `1` (aviso del 1.er toque) y `1R`
> (su rompimiento sin reset). **La R es el rompimiento del toque y la B añade que la
> secuencia venía reseteada** (`1RB`/`2RB`/`3RB`), como aparece escrito en su gráfica.
> El motor emite ya la nomenclatura nueva; lo de abajo se conserva como fuente.

---

## 0. Resumen ejecutivo

| Código | Qué es | Tipo | Estado en el motor |
|---|---|---|---|
| `1` | primer toque de la EMA30 | **AVISO** | ✅ |
| `1R` | rompimiento del nivel del 1.er toque | **ENTRADA** | ✅ |
| `2` | segundo toque de la EMA30 | **AVISO** | ✅ |
| `2R` | rompimiento del nivel del 2.º toque («la mejor») | **ENTRADA** | ✅ (antes `2B`/`2RB`) |
| `3` | tercer toque, tras superar el 2 | **AVISO** | ✅ |
| `3R` | rompimiento del nivel del 3.er toque | **ENTRADA** | ✅ (antes `3B`) |
| `1RB` `2RB` `3RB` | el mismo rompimiento cuando la secuencia venía de un reset («se salió, volvió y la hizo de nuevo») | **ENTRADA** | ✅ (antes `2RB`/`3RB`) |
| `1S` (seductora) | engaño sobre EMA50 + regreso + quiebre **con cuerpo** | **ENTRADA** | ✅ encendida por defecto (`MS_SEDUCTORA=0` la apaga) |

Frase que ordena todo (1:27–2:25): **«UNO DOS TRES ES TOQUE»** — los números son toques de
EMA; **el quiebre es un sufijo**, no una estrategia aparte. Y 2/3 son **aviso**
(«es para que tú vayas a buscar la entrada», 2:25–2:54), no operación.

---

## 1. Andamiaje común (lo que aplica a TODAS)

| Elemento | Regla del vídeo | En el motor |
|---|---|---|
| **EMA30** (blanca) | «el precio **tiene que tocar la EMA de TREINTA**» (5:19) | `touch_zone` con tolerancia `tol_atr=0,10` |
| **EMA50** (amarilla) | «**NO SUPERAR** la de CINCUENTA» (5:48) | `exceeds50` = mecha por encima → **mata la secuencia** |
| **EMA100** (oscura) | tendencia de fondo; estructura `precio < EMA30 < EMA50 < EMA100` (f_059) | alineación + pendiente de EMA100 en `slope_bars=10` |
| **Siempre a favor de la tendencia** | repetido en los 3 vídeos | `trend` obligatorio para emitir cualquier señal |
| **Filtro de distancia** | «está **muy alejada, no lo tomo**» (vídeo 02, 58–87 s) | `max_dist_atr = 2,0` |
| **«El límite»** | «estás en tu límite, ya no puedes pasar de aquí» | la EMA50 como techo duro del retroceso |
| **«Tendencia comprobada»** | «el quiebre significa dominio vendedor **con tendencia comprobada**» (5:19–5:48) | alineación EMA en la TF + `filter_trend_confirmed()` (multi-TF, opcional) |

> Con la regla nueva del propietario, **todo esto se mide dentro de cada TF**, sin leer velas
> de otra temporalidad.

---

## 2. `1` — «LA SEDUCTORA» (el engaño)

**Definición (0:29–0:58, literal):** «venía con tendencia, **se sale** —le decimos **engaño**—,
cuando se sale de la tendencia **regresa a su tendencia**, **quiebra con cuerpo**: aquí te da
la entrada».

| Pieza | Regla | Implementación |
|---|---|---|
| 1. Tendencia | alineada y con pendiente | `trend[i]` |
| 2. Engaño | el precio **sale** por encima de la EMA50 (retroceso que rompe el límite) | `exceeds50` previo en `fake_lookback=12` velas |
| 3. Regreso | vuelve y cierra bajo la EMA30 | `c[i] < e30[i]` |
| 4. Quiebre | **con cuerpo**, no mecha | `body_break`: cuerpo/rango ≥ 0,50 **y** cuerpo ≥ 0,30·ATR |
| 5. Nivel quebrado | mínimo del tramo del engaño | `ref = low[max(0, k−5):i].min()`, exige `c[i] < ref` |
| 6. Entrada | al cierre de la vela del quiebre | `entry = close[i]` |
| 7. Invalidación | extremo del tramo del engaño | `invalidation = high[k:i].max()` |

**Notas:** es la **única** a la que el vídeo le exige cuerpo («con cuerpo» solo se dice de la
1). Es la más frecuente junto a 2B/2RB («un chingo», 8:13–8:34).

## 3. `1R` / `1RB` — la seductora reseteada

**Definición (1:27–2:25):** «hizo la una… **se salió, volvió y la hizo de nuevo**»; «esta es tu
EX que te engañó la primera vez; esta fue cuando tú regresaste con ella».

| Pieza | Regla | Implementación |
|---|---|---|
| Reset | misma jugada repetida en la misma dirección | contador `cycle` ≥ 1 → sufijo `R` |
| Cuándo resetea | tras una entrada, o tras salida+retorno sin quiebre | `reset_after_signal`, `reset_on_abandoned_exit` |
| Reset «huérfano» | salida sobre EMA50 que vuelve a la EMA30 | `exit_open` + `min_exit_bar` (cada engaño exige salida **nueva**) |
| Tendencia nueva vs reset | ausencia larga de tendencia = original | `new_trend_gap = 60` velas |
| Etiqueta `1R` vs `1RB` | el audio **no lo aclara** (3:52–4:21); en pantalla salen las dos | `fake_reset_label="1R"` por defecto, `"1RB"` conmutable |

## 4. `2` / `2R` — segundo toque (AVISO)

**Definición (0:58):** «el precio viene con las EMAs: **primer toque que supera** y **segundo
toque**: esa es la número dos, **al toque**».

| Pieza | Regla | Implementación |
|---|---|---|
| Toque | la mecha toca la EMA30 y el cierre queda por debajo | `touch_zone` (con `tol_atr`) |
| «Supera» | entre el 1.º y el 2.º toque hay un mínimo más bajo | `require_extension`, ventana entre toques |
| Emisión | en el 2.º toque | `touches == 2` → `kind="touch"` |
| Uso | **aviso**: «ve a buscar la entrada»; el backtest no lo cuenta como trade | `resultado="aviso"` |

## 5. `3` / `3R` — tercer toque (AVISO)

**Definición (0:58–1:27):** «cuando **supera el número dos** y **toca nuevamente** la EMA de
treinta y cincuenta: estamos hablando del **tercer toque**».

| Pieza | Regla | Implementación |
|---|---|---|
| Superación | se rompe el mínimo del 2.º toque | misma `require_extension` |
| Emisión | en el 3.er toque | `touches == 3` |
| 4.º toque | el vídeo no lo contempla | no emite y **no reemplaza** el pendiente del 3.º |

## 6. `2B` / `2RB` — «LAS MEJORES»

**Definición (4:50–6:17, literal):** «**la DOS B** significa que el precio hizo el **SEGUNDO
TOQUE pero también QUEBRÓ**, en este caso **el MÍNIMO anterior**»; «para que suceda el dos B el
precio **tiene que tocar la EMA de TREINTA**, **NO SUPERAR la de CINCUENTA** y **RESPETAR** la
EMA de treinta y cincuenta».

| Pieza | Regla | Implementación |
|---|---|---|
| 1. Toque | mecha en EMA30, cierre debajo, sin superar EMA50 | `touch_zone` |
| 2. Respeto | el retroceso **no atraviesa** EMA30/50 | `exceeds50` cancela el pendiente |
| 3. Quiebre | cierre rompe el mínimo anterior | `pend["ref_low"] = low[i−8:i].min()` |
| 4. Ventana | el vídeo no la define | `max_bars_to_break = 6` velas |
| 5. Entrada | al cierre de la vela del quiebre | `entry = close[i]` |
| 6. Invalidación | máximo del toque | `invalidation = high[i]` |

**Ranking declarado (4:21–4:50):** «**la 2B y la 2RB van a ser, por encima de cualquier cosa,
LAS MEJORES**». En el score pesan 40 (entradas 1/1R/1RB/3B/3RB = 30; avisos = 10).
**Frecuencia (8:13–8:34):** «la 2B, la 2RB y la 1… **¡un chingo!**».

## 7. `3B` / `3RB` — tercer toque con quiebre

**Definición (6:17–6:46 + 7:44–8:13, literal):** «viene con el primer toque uno, segundo toque
dos, tercer toque… **¡ROMPE!** TRES B»; «el primer impulso… uno, dos, y el tercero **que
quebró**: aquí toma la entrada. Ese es TRES B, **por el quiebre**».

| Pieza | Regla | Implementación |
|---|---|---|
| Secuencia | 1.º, 2.º y 3.er toque respetando EMA30/50 | `touches == 3` |
| Quiebre | cierre rompe el mínimo de referencia del 3.er toque | mismo `pend` que el 2B |
| Entrada / invalidación | cierre del quiebre / máximo del toque | igual que 2B |

---

## 8. La gramática de los sufijos

| Sufijo | Significado (palabras de Yoel) | Efecto en el motor |
|---|---|---|
| **R** | **RESET** — «se salió, volvió y la hizo de nuevo **en la misma dirección**» | `cycle` ≥ 1 → sufijo en la etiqueta |
| **B** | **BREAK / QUIEBRA** — «hizo el toque **pero también quebró**» | la señal se emite en la vela del quiebre |
| **RB** | reset + quiebre | ambas condiciones a la vez |

Colores: **azul = alcista, rojo/rosa = bajista** (f_031, f_037, f_044, f_059). El color es la
dirección; el texto es el código.

---

## 9. Cómo se ve una jugada completa (secuencia de los frames)

1. Tendencia bajista alineada: `precio < EMA30 < EMA50 < EMA100` (f_059).
2. Retroceso que **toca la EMA30** sin superar la EMA50 → etiqueta `1R` o `2R` anclada al toque.
3. Rechazo y **quiebre del mínimo** (el frame marca el mínimo quebrado con una **zona roja**).
4. Etiqueta `2B` / `2RB` roja en la vela del quiebre → **ahí está la entrada**.
5. Si «se fue y volvió a hacerlo»: la siguiente sale `1RB` / `2RB` / `3RB`.
6. Gestión: en el vídeo la hace el panel «Ordena» (confianza, lotaje, COMPRA/VENDER). **Fuera
   de nuestro alcance: este proyecto es bot de señales y el propietario opera a mano.**

---

## 10. Lo que el vídeo 03 NO define (y por eso son parámetros nuestros)

| Hueco | Nuestro valor | Dónde |
|---|---|---|
| Ventana del «mínimo anterior» del B | 8 velas (`swing_lookback`) | `Params` |
| Caducidad del quiebre | 6 velas (`max_bars_to_break`) | `Params` |
| Ventana del engaño | 12 velas (`fake_lookback`), mínimo con 5 velas previas | `Params` |
| Cuerpo mínimo del quiebre de la 1 | 50 % del rango y 0,30·ATR | `Params` |
| Tolerancia del toque | 0,10·ATR | `Params` |
| Pendiente de tendencia | 10 velas de EMA100 | `Params` |
| Reset por tendencia nueva | 60 velas sin tendencia | `Params` |
| `1R` vs `1RB` | `1R` por defecto | `Params.fake_reset_label` |

Criterio de validación: no se toca ninguno de estos valores «a ojo»; se ajustan con el
backtest (`backtest_hibrida.py`, experimentos E0–E5).
