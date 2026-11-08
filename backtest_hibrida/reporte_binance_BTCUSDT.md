# Backtest Híbrida — binance · BTCUSDT · 10 días

- Fecha: 2026-11-08T10:16:36+00:00
- Capas activas: {'zonas': True, 'fases': True, 'sesgo': True} · núcleo v2 CONGELADO (test T0 de igualdad en verde)
- Riesgo: SL 1·ATR(M15 SMA14), TP 2·ATR, ambigua=pérdida (idéntico al baseline v1)
- M5: 2881 velas (2026-10-29 10:15:00+00:00 → 2026-11-08 10:15:00+00:00)
- M15: 961 velas (2026-10-29 10:15:00+00:00 → 2026-11-08 10:15:00+00:00)
- M30: 481 velas (2026-10-29 10:00:00+00:00 → 2026-11-08 10:00:00+00:00)
- H1: 241 velas (2026-10-29 10:00:00+00:00 → 2026-11-08 10:00:00+00:00)

## E0/E1 — v2 pura con contexto (capas OFF, sin filtrar)
- entradas 64 (avisos 26) · WR 32.8% · netR -1.0 · PF 0.98

### Por patrón (jerarquía de Yoel: ¿2B/2RB por encima?)
```
        señales    wr  netR    pf
patron                           
1            12  33.3   0.0  1.00
1R           32  28.1  -5.0  0.78
2RB          15  46.7   6.0  1.75
3B            1   0.0  -1.0  0.00
3RB           4  25.0  -1.0  0.67
```

### Por quintil de score (¿el score separa?)
```
                señales     wr  netR    pf
q_score                                   
(44.999, 60.0]       16   50.0   8.0  2.00
(60.0, 80.0]         11    9.1  -8.0  0.20
(80.0, 85.0]         22   27.3  -4.0  0.75
(85.0, 92.0]          2  100.0   4.0   inf
(92.0, 100.0]        13   30.8  -1.0  0.89
```

## E2/E3/E4 — filtros individuales (cada uno ON por separado)
- E2 sesgo: 53 entradas (+26 avisos) · WR 34.0% · netR 1.0 · PF 1.03
- E3 confluencia a favor: 0 entradas (+2 avisos) · WR nan% · netR 0.0 · PF nan
- E4 gatillo direccional: 64 entradas (+14 avisos) · WR 32.8% · netR -1.0 · PF 0.98

### E3-bis — sensibilidad del radio de confluencia (dist_zona_atr ≤ r·ATR)
| r (×ATR) | señales ≤ r | a favor |
|---|---|---|
| 0.5 | 12 | 2 |
| 1.0 | 16 | 4 |
| 2.0 | 25 | 6 |
| 3.0 | 33 | 10 |
| 5.0 | 38 | 11 |

- dist_zona_atr p25/p50/p75 = 1.8/11.8/22.6 — el radio por defecto (0,5) es estrecho por diseño; subirlo relaja la confluencia (parámetro `confluencia_atr`).

## E5 — curva score_min (walk-forward IN=1.ª mitad / OUT=2.ª mitad)
| score_min | señales | WR IN | PF IN | WR OUT | PF OUT |
|---|---|---|---|---|---|
| 0 | 64 | 36.8 | 1.17 | 26.9 | 0.74 |
| 30 | 64 | 36.8 | 1.17 | 26.9 | 0.74 |
| 40 | 64 | 36.8 | 1.17 | 26.9 | 0.74 |
| 50 | 62 | 36.8 | 1.17 | 25.0 | 0.67 |
| 55 | 61 | 36.8 | 1.17 | 21.7 | 0.56 |
| 60 | 60 | 36.8 | 1.17 | 18.2 | 0.44 |
| 65 | 48 | 34.6 | 1.06 | 18.2 | 0.44 |
| 70 | 47 | 34.6 | 1.06 | 19.0 | 0.47 |

## Nota honesta
- Datos BTCUSDT (Binance): validan el ENGRANAJE, no son los sintéticos de Weltrade.
- Comparación con el baseline v1 (zonas+fases+score, PF 1,27 / WR 45,7 % / 3.341 señales
  en 1 año × FX Vol 20/60/99): solo como REFERENCIA; son estrategias distintas.
- Sin spread/comisión/deslizamiento (igual que el baseline v1).
