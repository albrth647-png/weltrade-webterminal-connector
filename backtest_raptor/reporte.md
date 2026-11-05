# Backtest — Estrategia "RAPTOR-like" (motor-senales)

- Fecha: 2026-11-05 · Datos: Weltrade demo (mt5.demo.weltrade.org) vía conector nativo (cmd 11)
- Ventana: 1 año por símbolo (FX Vol 20, FX Vol 60, FX Vol 99)
- Reglas evaluadas: zonas M15 por pivotes fractales; toques EARLY/MAIN/LATE en M5;
  sesgo H1 EMA(30); TN = cierre M15 a 0.5×ATR más allá de la zona; SL = nivel∓1×ATR;
  TP = precio±2×ATR; dedup 45 min/zona; score mínimo 60.
- Conservador: TP y SL dentro de la misma vela M5 = PÉRDIDA. Sin spread, comisión ni deslizamiento.

```
==========================================================================
BACKTEST — Estrategia "RAPTOR-like" (zonas M15 + toques 3 fases + sesgo H1)
Datos reales Weltrade demo · 1 año por símbolo · SL=1×ATR, TP=2×ATR (R fijo ≈ 2)
Ambiguas (TP y SL en la misma vela M5) contadas como PÉRDIDA · sin spread/comisión
==========================================================================
FX Vol 20: M5 100052 velas (2025-11-22 → 2026-11-05)
FX Vol 60: M5 100056 velas (2025-11-22 → 2026-11-05)
FX Vol 99: M5 100058 velas (2025-11-22 → 2026-11-05)

Eventos: zonas nuevas 14958 · refuerzos 12026 · toques 145074 · TN (cancelaciones) 14639
Toques por fase: EARLY 13822 · MAIN 13453 · LATE 117799

— RESULTADO GLOBAL —
Señales: 3341 (resueltas 3341, abiertas 0)
Ganadas 1527 · Perdidas 1814 (ambiguas 0)
WIN RATE: 45.7%   |   Net R: 481.31   |   Profit Factor: 1.27   |   Expectativa: 0.144 R/señal
Racha perdedora máx: 15   |   Duración mediana: 80 min

— POR SIMBOLO —
FX Vol 99    señales 1078 · WR  47.9% · netR     210 · PF 1.37 · racha 17
FX Vol 20    señales 1118 · WR  44.8% · netR  142.63 · PF 1.23 · racha 15
FX Vol 60    señales 1145 · WR  44.5% · netR  128.68 · PF 1.20 · racha 14

— POR FASE —
EARLY        señales  844 · WR  47.9% · netR   82.67 · PF 1.19 · racha 7
LATE         señales 2131 · WR  44.1% · netR  345.23 · PF 1.29 · racha 22
MAIN         señales  366 · WR  50.0% · netR   53.41 · PF 1.29 · racha 7

— POR LADO —
COMPRA       señales 1636 · WR  44.8% · netR  207.91 · PF 1.23 · racha 14
VENTA        señales 1705 · WR  46.6% · netR  273.39 · PF 1.30 · racha 15

— POR MES (estabilidad) —
mes        señales  WR     netR
2025-11      58     58.6%    26.81
2025-12     314     46.5%    45.96
2026-01     283     41.7%     9.94
2026-02     241     49.0%    54.34
2026-03     321     42.4%    20.86
2026-04     272     42.3%    20.48
2026-05     323     50.8%    84.71
2026-06     296     41.9%    10.34
2026-07     285     44.2%    27.75
2026-08     311     47.6%     66.7
2026-09     248     48.4%    55.02
2026-10     333     45.0%    44.09
2026-11      56     50.0%     14.3

```

Detalle señal a señal en `senales.csv`.