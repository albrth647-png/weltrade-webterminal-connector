# C1 — Estrés de spread sobre el backtest real

- Spread medido en vivo (2026-11-05T20:43:53.898Z → 2026-11-05T20:51:53.899Z UTC, 1438 ticks): FX Vol 20 = 4.07, FX Vol 60 = 3.94, FX Vol 99 = 8.78. Estables (min ≈ p50 ≈ max durante la ventana).
- Modelo: netR' = netR − λ, λ = s/|precio−sl| (COMPRA paga spread en entrada; VENTA lo paga en TP/SL desplazados). Escenarios 1×/2×/3×.

```
================================================================================================
C1 — ESTRÉS DE SPREAD sobre el backtest real (1 año × FX Vol 20/60/99, 3,341 señales)
Spread medido en vivo 2026-11-05T20:43 UTC (8 min, 1438 ticks):
  FX Vol 20  p50 4.07 · media 4.07 · p90 4.07 · min 4.06 · max 4.07  (n=478)
  FX Vol 60  p50 3.94 · media 3.94 · p90 3.94 · min 3.93 · max 3.95  (n=480)
  FX Vol 99  p50 8.78 · media 8.78 · p90 8.8 · min 8.75 · max 8.8  (n=480)
Modelo: netR' = netR − λ · λ = s/|precio−sl| · escenarios 1×/2×/3× el spread medido (p50)
================================================================================================

— COSTE MEDIO por operación en unidades R (λ = spread / distancia hasta SL) —
FX Vol 20    λ̄(1×) = 0.0170 R/trade  ·  exp base = 0.128 R
FX Vol 60    λ̄(1×) = 0.0164 R/trade  ·  exp base = 0.112 R
FX Vol 99    λ̄(1×) = 0.0197 R/trade  ·  exp base = 0.195 R
GLOBAL       λ̄(1×) = 0.0177 R/trade  ·  exp base = 0.144 R

— RESULTADO POR ESCENARIO (año completo) —
escenario              señales  WR      netR       PF    exp/ñ   flips
SIN coste (base)        3341   45.7%    481.3    1.27   0.144     0
1× spread               3341   45.7%    422.3    1.23   0.126     0
2× spread               3341   45.7%    363.3    1.19   0.109     0
3× spread               3341   45.7%    304.3    1.16   0.091     0

— POR SÍMBOLO Y ESCENARIO —
símbolo     esc   netR       PF    exp/ñ   múltiplo break-even
FX Vol 20   base      142.6    1.23   0.128   m* = 7.5× el spread medido
FX Vol 20   1× spread    123.6    1.20   0.111   
FX Vol 20   2× spread    104.6    1.16   0.094   
FX Vol 20   3× spread     85.5    1.13   0.077   
FX Vol 60   base      128.7    1.20   0.112   m* = 6.9× el spread medido
FX Vol 60   1× spread    109.9    1.17   0.096   
FX Vol 60   2× spread     91.2    1.14   0.080   
FX Vol 60   3× spread     72.5    1.11   0.063   
FX Vol 99   base        210    1.37   0.195   m* = 9.9× el spread medido
FX Vol 99   1× spread    188.8    1.33   0.175   
FX Vol 99   2× spread    167.5    1.29   0.155   
FX Vol 99   3× spread    146.3    1.25   0.136   

— MESES CON COSTE 1× (¿alguno pasa a negativo?) —
2025-11   netR      26  (sin coste: 26.8)  ok
2025-12   netR    40.9  (sin coste: 46)  ok
2026-01   netR     4.9  (sin coste: 9.9)  ok
2026-02   netR    50.4  (sin coste: 54.3)  ok
2026-03   netR    15.7  (sin coste: 20.9)  ok
2026-04   netR    15.7  (sin coste: 20.5)  ok
2026-05   netR    78.7  (sin coste: 84.7)  ok
2026-06   netR     5.2  (sin coste: 10.3)  ok
2026-07   netR    22.2  (sin coste: 27.8)  ok
2026-08   netR    60.7  (sin coste: 66.7)  ok
2026-09   netR    50.4  (sin coste: 55)  ok
2026-10   netR    38.3  (sin coste: 44.1)  ok
2026-11   netR    13.3  (sin coste: 14.3)  ok
Meses en negativo con coste 1×: 0 de 13
```