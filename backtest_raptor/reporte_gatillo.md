# C2 — VELA GATILLO: diagnóstico y filtro pre-entrada (walk-forward)

- 3341 señales reales del backtest base (1 año × FX Vol 20/60/99).
- features de la vela M5 gatillo: rangoATR, cuerpoATR, cuerpDir, penetr, cierreNivel (todas knowable al emitir).
- IN: señales < 2026-05-15 (elección) · OUT: ≥ (validación ciega).
- Criterios pre-registrados en el script (escritos antes de ver resultados): n ≥ 60% base, netR+PF+expectativa > base en IN, confirmado en OUT, por símbolo no empeora, sin mes nuevo en pérdida, racha ≤ base.

```
================================================================================================
C2 — VELA GATILLO: diagnóstico y filtro pre-entrada (datos reales, 1 año × FX Vol 20/60/99)
features de la vela M5 que dispara la señal · ATR = |tp−precio|/2 · rápido = resuelve en <30 min
Walk-forward: IN < 2026-05-15 (elección) · OUT ≥ (validación ciega)
================================================================================================
Señales: 3341 · sin vela localizable: 0

— PERFIL MEDIO de cada feature: perdedores rápidos vs ganadores rápidos vs resto —
feature        perdRáp(n=277)  ganRáp(n=78)  resto(n=2986)   ¿separa?
rangoATR           0.555      0.641      0.602
cuerpoATR          0.241      0.298      0.291
cuerpDir           0.241      0.298      0.291
penetr             0.231      0.193      0.096
cierreNivel        0.181      0.317      0.390

— RANGO de la vela gatillo ÷ ATR (año completo) —
bucket                señales   WR      netR      PF    exp/ñ   %ráp  netR_ráp
< 0.5                   1128    43.6%    185.37   1.29   0.164    12%      -86
0.5-0.75                1564    44.8%    176.03   1.20   0.113    11%    -64.8
0.75-1.0                 561    50.8%    101.47   1.37   0.181     9%     -1.5
1.0-1.5                   88    56.8%     18.42   1.48   0.209     6%      1.9
1.5-2.0                         0
≥ 2.0                           0

— CIERRE a favor (cuerpDir) ÷ ATR (año completo) —
bucket                señales   WR      netR      PF    exp/ñ   %ráp  netR_ráp
≤ -1 (en contra)                0
-1 .. -0.5                      0
-0.5 .. 0                       0
0 .. 0.5                2765    44.9%    407.98   1.27   0.148    11%   -143.8
0.5 .. 1                 562    49.1%     68.42   1.24   0.122     8%     -6.6
≥ 1 (rechazo fuerte)      14    64.3%       4.9   1.98   0.350     0%        0

— PENETRACIÓN en la zona ÷ ATR (año completo) —
bucket                señales   WR      netR      PF    exp/ñ   %ráp  netR_ráp
≤ 0 (ni llegó al nivel)  1487    48.2%    157.69   1.20   0.106     6%    -39.6
0-0.25                   996    45.3%     123.9   1.23   0.124    11%    -35.8
0.25-0.5                 581    41.3%     101.4   1.30   0.175    17%    -58.2
0.5-1.0                  275    42.5%      94.5   1.60   0.344    23%    -16.8
1.0-1.5                    2   100.0%      3.81    inf   1.905     0%        0
≥ 1.5 (atravesó hondo)          0

— CIERRE vs nivel ÷ ATR (año completo) —
bucket                señales   WR      netR      PF    exp/ñ   %ráp  netR_ráp
≤ -1 (atravesó el nivel)          0
-1 .. -0.5                      0
-0.5 .. 0                427    38.4%     116.9   1.44   0.274    24%    -50.5
0 .. 0.5                1778    44.4%    241.64   1.24   0.136    11%    -92.1
≥ 0.5 (rechazó y subió)  1136    50.4%    122.76   1.22   0.108     6%     -7.8

— VARIANTES: IN (elección) vs OUT (validación ciega) —
variante            IN: señ WR     netR      PF    exp/ñ  |  OUT: señ WR     netR      PF    exp/ñ
BASE                 1620  45.2%   203.51   0.126  |   1721  46.2%   277.79   0.161
A rango≥1            1576  44.9%   197.94   0.126  |   1677  45.9%   264.93   0.158
A rango≥1.25         1617  45.2%   204.51   0.126  |   1718  46.1%   274.48   0.160
A rango≥1.5          1620  45.2%   203.51   0.126  |   1721  46.2%   277.79   0.161
B penetr≥0.5         1488  45.4%   158.11   0.106  |   1576  46.4%   224.88   0.143
B penetr≥1           1620  45.2%   203.51   0.126  |   1719  46.1%   273.98   0.159
C cierre≤-0.5        1620  45.2%   203.51   0.126  |   1721  46.2%   277.79   0.161
C cierre≤-1          1620  45.2%   203.51   0.126  |   1721  46.2%   277.79   0.161
D cuerpo≤-0.25       1620  45.2%   203.51   0.126  |   1721  46.2%   277.79   0.161
D cuerpo≤-0.5        1620  45.2%   203.51   0.126  |   1721  46.2%   277.79   0.161
D cuerpo≤-1          1620  45.2%   203.51   0.126  |   1721  46.2%   277.79   0.161
E rang≥1+cuerp≤-.5   1576  44.9%   197.94   0.126  |   1677  45.9%   264.93   0.158
F rang≥1.25+pen≥.5   1486  45.4%   158.11   0.106  |   1574  46.4%    223.1   0.142

— Criterio pre-registrado en IN: n ≥ 60% base · netR y PF y exp/ñ > base —
NINGUNA variante supera el criterio en IN → el filtro de vela gatillo NO se adopta.
```

Detalle por señal en `senales_gatillo.csv`.
### Chequeo exploratorio (dirección NO pre-registrada — solo documenta)

```
— IN —
penetr ≤ 0 (solo banda, sin tocar)   698 · WR  48.9% · netR    80.4 · PF  1.23 · exp/ñ 0.115
0 < penetr < 0.25 (toque real)       515 · WR  43.7% · netR    44.5 · PF  1.15 · exp/ñ 0.086
0.25 ≤ penetr < 0.5 (honda)          275 · WR  40.0% · netR    33.2 · PF  1.20 · exp/ñ 0.121
penetr ≥ 0.5 (muy honda)             132 · WR  42.4% · netR    45.4 · PF  1.60 · exp/ñ 0.344
— OUT —
penetr ≤ 0 (solo banda, sin tocar)   791 · WR  47.8% · netR    80.4 · PF  1.19 · exp/ñ 0.102
0 < penetr < 0.25 (toque real)       475 · WR  46.7% · netR    74.5 · PF  1.29 · exp/ñ 0.157
0.25 ≤ penetr < 0.5 (honda)          309 · WR  42.4% · netR    67.7 · PF  1.38 · exp/ñ 0.219
penetr ≥ 0.5 (muy honda)             146 · WR  43.8% · netR    55.2 · PF  1.67 · exp/ñ 0.378
— "penetr > 0 (toque real)" por símbolo y mitad —
FX Vol 20 IN                         322 · WR  43.5% · netR    58.9 · PF  1.32 · exp/ñ 0.183
FX Vol 20 OUT                        322 · WR  45.3% · netR    70.3 · PF  1.40 · exp/ñ 0.218
FX Vol 60 IN                         289 · WR  39.8% · netR    17.3 · PF  1.10 · exp/ñ 0.060
FX Vol 60 OUT                        348 · WR  42.5% · netR    48.8 · PF  1.24 · exp/ñ 0.140
FX Vol 99 IN                         311 · WR  43.7% · netR    46.9 · PF  1.27 · exp/ñ 0.151
FX Vol 99 OUT                        260 · WR  47.3% · netR    78.3 · PF  1.57 · exp/ñ 0.301
```

Lectura: la hipótesis original (vela gatillo grande → muerte rápida) sale REFUTADA (perdedores rápidos: rango 0.555 ATR vs 0.602 del resto; las velas grandes rinden MEJOR). Además cuerpDir ≥ 0 por construcción del motor (exige vela de dirección). El hallazgo real: la PROFUNDIDAD de penetración en la zona es el mejor discriminador pre-entrada hasta ahora — penetr ≥ 0.5 ATR: exp 0.344 IN / 0.378 OUT (PF 1.60/1.67, estable), toques de banda sin llegar al nivel (penetr ≤ 0, 45% de señales): PF ~1.2, exp ~0.11. Con n=278 no es adoptable (falla retención ≥60% y muestras pequeñas); queda pre-registrada como candidata de sizing para un futuro test con más historia.
