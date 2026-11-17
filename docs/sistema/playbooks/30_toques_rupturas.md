---
id: rayas.toques
version: 1
estado: activo
fuente: [rayas]
parametros:
  toqueAtr: 0.15
  margenAtr: 0.10
  ventana: 6
  minToques: 1
checks: [C06, C07, C08, C09]
casos: []
---

# Toques y engaños

## Toque sobre raya vigente

Un toque no es una mecha que roza: es una **vela cuyo cuerpo contiene el valor de
la recta**. Después hace falta confirmación.

1. `min(o,c) ≤ recta(i) ≤ max(o,c)` — el cuerpo atraviesa la recta.
2. La vela siguiente cierra **a favor** de la tendencia vigente.
3. La raya sigue sin romperse.

Si se cumplen las tres, hay toque. Se avisa **siempre** que supere el mínimo
anterior, aunque no llegue a entrada.

## Cambio y engaño

- **Cambio**: cierre más allá de la recta por `margenAtr` (0.10 ATR). Se emite en
  la vela de la ruptura, sin esperar.
- **Engaño**: dentro de la ventana de `ventana` velas (6), el precio regresa a la
  recta por cierre. Se emite en la vela de regreso, con prioridad baja.

## Reglas

- **C06** — El toque se mide por **cuerpo**, no por mecha.
- **C07** — El toque exige confirmación de la vela siguiente; sin ella no hay
  evento.
- **C08** — El engaño solo cuenta dentro de la ventana; fuera de ella caduca.
- **C09** — El toque se avisa siempre que supere el mínimo anterior, aunque no
  cumpla los requisitos de entrada.
