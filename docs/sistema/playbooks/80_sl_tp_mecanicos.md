---
id: sltp.mecanicos
version: 1
estado: activo
fuente: []
parametros: {}
checks: [S01, S02, S03, S04, S05]
casos: []
---

# SL/TP mecánicos (ejecución de las señales del catálogo)

La estrategia **sí** tiene Take Profit (TO) y **no** tiene límite de tiempo ni de
trades (sin TL): cada señal se opera hasta que el stop o el objetivo se tocan,
sin caducidad por tiempo. Cada señal se notifica a Telegram al cerrarse la vela.

## Reglas

- **S01** — El Stop Loss va **detrás del último swing previo al quiebre** (el
  extremo de las `ventanaMin` velas anteriores), cubierto por la EMA50 más un
  margen de `margenSlAtr` ATR de spread/slippage. Es el `invalida` que el motor
  ya calcula y envía en el mensaje.
- **S02** — El Take Profit mínimo es **1.5 R** (`tpMinimoR`). No se toma una
  entrada si el nivel a romper no permite al menos 1.5R de distancia al stop.
- **S03** — Toma parcial en **1.5 R** o **2.0 R** (`tpParcial1R`/`tpParcial2R`):
  cerrar la mitad y mover el stop al punto de entrada (breakeven).
- **S04** — Trailing con la **EMA30/EMA50**: una vez en beneficio, el stop
  sigue al cierre por debajo (compra) / por encima (venta) de la EMA30; si la
  tendencia se acelera, usar la EMA50 como trailing más amplio.
- **S05** — Notificar **cada señal a Telegram** (prioridad alta). El mensaje
  lleva el precio de entrada (cierre de la vela) y el stop (`invalida`) como
  referencia; el TP no se envía en el mensaje, se calcula con la regla SL02.

## Referencia en el mensaje

El mensaje de Telegram conserva el formato de 5 campos (activo, temporalidad,
estrategia, precio entrada, hora) y añade el stop como referencia operativa.
El TP (mínimo 1.5R) se calcula por el operador con la regla SL02; no se envía
en el mensaje para no duplicar niveles que dependen del spread real.

## Lo que NO se hace

- No se pone un límite de tiempo a la operación (sin TL): si la tendencia sigue,
  se deja correr con trailing.
- No se opera si el R:R disponible es menor a 1.5.
- No se mueve el stop en contra de la posición.
