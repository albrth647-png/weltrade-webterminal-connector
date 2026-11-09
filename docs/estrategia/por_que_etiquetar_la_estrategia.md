# Por qué la señal dice QUÉ estrategia es (1, 2, 3, 2B…) — y cómo se verifica

**Fecha:** 2026-11-08 · **Estado:** implementado y validado
**Base:** `video03_fichas_estrategias.md`, `strategias/raptor_strategy.py`,
`estrategias/raptor_hibrida.py`, `motor-senales/raptor_core.js`,
`motor-senales/raptor_hibrida.js`, `motor-senales/estrategia_hibrida.js`.

## 1. La etiqueta no es adorno: ES la señal

«UNO DOS TRES ES TOQUE» (v3 1:27–2:25). Los números son toques de la EMA30; los
sufijos dicen qué pasó después:

| Código | Qué es | Tipo |
|---|---|---|
| `1` | primer toque de la EMA30 (deja el nivel de referencia) | **AVISO** |
| `1R` | rompimiento del nivel del 1.er toque | **ENTRADA** |
| `2` | segundo toque de la EMA30 | **AVISO** («ve a buscar la entrada») |
| `2R` | rompimiento del nivel del 2.º toque | **ENTRADA** (la mejor) |
| `3` | tercer toque tras superar el segundo | **AVISO** |
| `3R` | rompimiento del nivel del 3.er toque | **ENTRADA** |
| `1S` | la seductora (engaño sobre EMA50 + quiebre con cuerpo) — **no** es el rompimiento de un toque | **ENTRADA** (con `seductora: true`) |

**La R es ROMPIMIENTO, no reset.** El reset (la jugada repetida en la misma
dirección) ya no viaja en la etiqueta: va como dato del evento (`reset`, `ciclo`).

Consecuencias que obligan a etiquetar:

1. **`2` y `3` no se operan.** Sin código, un aviso se confunde con una entrada.
2. **`2B`/`2RB` son «las mejores, por encima de cualquier cosa»** (4:21–4:50) y pesan
   40 en el score frente a 30 de las demás entradas y 10 de los avisos. Si el mensaje
   no dice el código, esa jerarquía se pierde.
3. **La R dice rompimiento y el número dice de qué toque**: `2R` es el quiebre
   del nivel que dejó el 2.º toque, no un toque nuevo. Ahí está la entrada y ahí
   está la invalidación (el máximo de ese toque).

## 2. Qué corre ahora en vivo

El motor en vivo **es la híbrida**, no la v1 con fases renombradas:

```
raptor_core.js      catálogo 1/2/3 (toques) · 1R/2R/3R (sus rompimientos) · 1S (seductora)
raptor_hibrida.js   zonas fractales + fuerza + TN, fases EARLY/MAIN/LATE, sesgo, score
estrategia_hibrida.js  motor en vivo: velas → señal con patrón + fase
```

Cada temporalidad (M5, M15, M30, H1) aplica **la estrategia completa con sus propias
velas**: M5 no lee M15. `MS_MOTOR=v1` conserva el motor anterior solo para comparar.

Los parámetros salen del documento activo donde coinciden (zonas, TN, banda, excursión,
pesos de fase, sesgo, ATR); el resto son los del port, sin inventar ninguno.

## 3. Cómo se comprobó que cada etiqueta es la suya

**a) El port es idéntico al Python.** `npm run validar:port` corre la híbrida de Python
y la de Node sobre los 16 CSV de 30 días (4 activos × 4 TF) y compara **señal a señal**
tiempo, patrón, dirección, entrada, invalidación, zona, fase, sesgo y score:

```
FX_Vol_20: 466 / 466 · FX_Vol_40: 408 / 408 · SFX_Vol_20: 378 / 378 · SFX_Vol_40: 398 / 398
TOTAL: 1650 filas comparadas · 0 diferencias
```

**b) Cada etiqueta cumple su regla.** `npm run validar:reglas` **no confía en el motor**:
recalcula EMAs, ATR y toques por su cuenta y audita cada señal:

| Regla | Qué comprueba |
|---|---|
| R01 | patrón dentro del catálogo; `2/2R/3/3R` son avisos y el resto entradas |
| R02 | la señal nace con EMA30<EMA50<EMA100 y pendiente (espejo en COMPRA) |
| R03 | `entry` = cierre exacto de su vela |
| R04 | `t` = apertura de la vela de la señal (el mensaje suma el cierre) |
| R05 | en las `R`: hay toque previo (≤6 velas) y el cierre **rompe** su mínimo |
| R06 | la invalidación es el máximo del tramo del toque |
| R07 | en la `1`: cuerpo ≥50 % del rango y ≥0,3·ATR, con salida previa sobre la EMA50 |
| R08 | la fase es EARLY/MAIN/LATE o no hay fase |
| R09 | score en 0..100 |

Resultado: **1.650 señales verificadas · 0 violaciones.**

**c) En vivo.** `npm run demo:hibrida` reengancha velas reales por el mismo camino que
los ticks y produce, por ejemplo, `2B · Raptor-híbrida v2` o `3B · MAIN · Raptor-híbrida v2`.

## 4. Qué llega al móvil

```
🟢 COMPRA
1. Activo: SFX Vol 40
2. Temporalidad: H1
3. Estrategia: 3R · MAIN · Raptor-híbrida v2
4. Precio: 119652.19
5. Hora: 2026-11-08 13:00 UTC
```

Los **avisos `2`/`3` no se envían como operación** (son «ve a buscar la entrada»): se
registran por consola con su código y su precio. Si quieres recibirlos también, es un
interruptor, no un cambio de lógica.

## 5. Límites honestos

- **M1** no se descarga todavía: el vídeo 03 opera el catálogo completo en M1 y el motor
  empieza en M5. Añadirlo es ampliar el conector y el backtest, no tocar la estrategia.
- **`1R` del primer toque**: es regla nueva del propietario (2026-11-09); el
  Python de referencia no la tiene y por eso la paridad se mide con
  `ruptura1: false` (mismo estado que el Python) y etiquetas normalizadas.
- **Score**: ordena, no filtra (`min=0`), igual que en el backtest.
- La muestra de 30 días sigue siendo corta para concluir rentabilidad: la etiqueta dice
  **qué jugada es**, no que gane.

## 6. Cambio de vocabulario (2026-11-09)

El propietario marcó el vocabulario definitivo sobre su propia gráfica
(`evidencia/capturas_usuario/ultima_captura.jpg`, SFX Vol 20 H1):

```
1  = estrategia 1  (primer toque)
2  = estrategia 2  (segundo toque)
1R = ROMPIMIENTO de la 1   (vela COMPLETA: el cierre queda más allá del nivel)
2R = ROMPIMIENTO de la 2
```

Consecuencias aplicadas en el motor:

| Antes | Ahora |
|---|---|
| `2` / `2R` = toque (R = reset) | `2` = toque; `2R` = **rompimiento** |
| `2B` / `2RB` = rompimiento | `2R` |
| `3B` / `3RB` = rompimiento | `3R` |
| `1` / `1R` = la seductora (R = reset) | `1S` con `seductora: true`; `1` = primer toque (aviso) |
| la seductora metida en la R del rompimiento | fuera del catálogo de R: `1R` es SIEMPRE el rompimiento del 1.er toque |
| el 1.er toque no emitía ni se rompía | `1` (aviso) y `1R` (entrada) |
| reset en la etiqueta | `reset` / `ciclo` en el evento |

Las tres R son, cada una, el **rompimiento de su estrategia**: `1R` → la 1,
`2R` → la 2, `3R` → la 3. No hay más R en el catálogo.

El **reset no se envía como señal**: viaja como dato, así que quitar la R de
reset no pierde información. El Python de referencia sigue con su vocabulario
antiguo: no se reescribe, se traduce al comparar.

## 7. La seductora salió del `1R` (2026-11-09, tras revisar todas las R)

El propietario reportó que las señales `R` le llegaban «al revés: en vez de la
continuación, lo inverso». Medido sobre el volcado de referencia (`py.json`,
882 entradas), el rompimiento **no estaba invertido**: 0 entradas con el cierre
en el lado contrario de su nivel y 0 invalidaciones al revés. Lo que estaba mal
era la **etiqueta**: `1R` se usaba para dos jugadas distintas.

- `1R`/`2R`/`3R` (gráfica del propietario, `ultima_captura.jpg`): el cierre
  rompe el **mínimo del toque `n`**, en tendencia limpia y sin engaño sobre la
  EMA50. Eso es rompimiento **y** continuación.
- La **seductora** exige haber salido sobre la EMA50 (contra la tendencia),
  volver y cerrar con cuerpo: es otra jugada. Representaba **684 de 882
  entradas (78 %)** y salía con el mismo `1R`, así que en la gráfica aparecía
  donde no hay ningún toque ni nivel que romper.

Ahora la seductora va como **`1S`** y `R` significa solo rompimiento de toque.
Además está **apagada por defecto**: el catálogo del propietario son las tres
estrategias con sus tres rompimientos. `MS_SEDUCTORA=1` la vuelve a encender
(siempre como `1S`, nunca como `R`).
`validar_reglas.js` ya no acepta el atajo «si es `1R`, prueba la seductora»:
toda `R` tiene que pasar la ruptura estricta (R05) y, además, el nivel que se
manda en el mensaje tiene que ser el que se rompió (R06b).
