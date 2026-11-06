# EMPINE — diagnóstico y filtro anti-impulso (walk-forward)

- 3341 señales reales del backtest base (1 año × FX Vol 20/60/99).
- empine = retorno firmado de las últimas W velas M5 ÷ ATR de la señal (|tp−precio|/2).
- IN: señales < 2026-05-15 (elección) · OUT: ≥ (validación sin retocar).

```
======================================================================================
EMPINE — diagnóstico y filtro anti-impulso (datos reales, 1 año × FX Vol 20/60/99)
empine = retorno firmado de las últimas W velas M5 ÷ ATR de la señal (|tp−precio|/2)
positivo = impulso acompaña · negativo = impulso contra la señal
Walk-forward: IN = señales < 2026-05-15 · OUT = ≥ (elección en IN, validación en OUT)
======================================================================================
Señales: 3341 · sin vela M5 localizable: 0 · sin ATR: 0

— DIAGNÓSTICO por bucket de empine (W=6, año completo) —
bucket                  señales   WR      netR      PF
≤ -2 (contra fuerte)        37    40.5%      4.22   1.19
-2 .. -1                   804    44.2%    140.34   1.31
-1 .. -0.5                 970    46.3%    171.77   1.33
-0.5 .. 0                  942    44.9%     94.12   1.18
0 .. 0.5                   489    48.3%     63.31   1.25
0.5 .. 1                    89    51.7%     11.49   1.27
1 .. 2                      10    30.0%     -3.96   0.43
≥ 2 (a favor fuerte)              0

— DIAGNÓSTICO por bucket de empine (W=12, año completo) —
bucket                  señales   WR      netR      PF
≤ -2 (contra fuerte)       231    50.2%     70.47   1.61
-2 .. -1                   854    48.0%    212.49   1.48
-1 .. -0.5                 807    42.5%     68.34   1.15
-0.5 .. 0                  847    44.3%     76.03   1.16
0 .. 0.5                   500    47.8%     59.48   1.23
0.5 .. 1                    88    42.0%     -7.35   0.86
1 .. 2                      14    50.0%      1.84   1.26
≥ 2 (a favor fuerte)              0

— VARIANTES: IN (elección) vs OUT (validación walk-forward) —
variante        IN: señ WR     netR      PF   |  OUT: señ WR     netR      PF
BASE             1620  45.2%   203.51  1.23  |   1721  46.2%   277.79  1.30
A(W=6,k=0.5)      744  45.7%     65.8  1.16  |    786  46.8%    99.16  1.24
A(W=6,k=1)       1193  45.9%   141.48  1.22  |   1307  46.7%   195.26  1.28
A(W=6,k=1.5)     1512  45.3%   189.37  1.23  |   1608  46.1%   246.43  1.28
A(W=6,k=2)       1604  45.3%   206.95  1.24  |   1700  46.2%   270.13  1.30
B(W=6,k=1)       1284  45.9%   154.72  1.22  |   1388  46.7%   210.25  1.28
B(W=6,k=1.5)     1535  45.2%   189.47  1.23  |   1624  46.3%   258.88  1.30
C(W=6)             48  54.2%     8.03  1.37  |     51  45.1%     -0.5  0.98
A(W=12,k=0.5)     693  45.2%    49.15  1.13  |    756  45.6%    80.85  1.20
A(W=12,k=1)      1072  44.9%       98  1.17  |   1184  43.9%   100.34  1.15
A(W=12,k=1.5)    1332  45.0%   148.45  1.20  |   1449  44.8%   164.59  1.21
A(W=12,k=2)      1504  45.4%   192.42  1.23  |   1606  45.3%   218.41  1.25
B(W=12,k=1)      1170  45.0%   109.22  1.17  |   1279  44.4%   123.24  1.17
B(W=12,k=1.5)    1381  45.0%   153.68  1.20  |   1491  45.3%   189.45  1.23
C(W=12)            47  46.8%     0.38  1.02  |     55  40.0%    -5.89  0.82

— Criterio en IN: señales ≥ 60% de la base, netR y PF mejores que la base —
A(W=6,k=2)       OUT: 1700 señ · WR 46.2% · netR 270.13 · PF 1.30 → NO se sostiene en OUT
Ninguna elegible en IN se sostiene en OUT → NO se adopta (protección walk-forward).
```

Detalle por señal en `senales_empine.csv` (columnas empine6/empine12).
### Chequeo exploratorio del hallazgo inverso (W=12: empine contra fuerte)

```
— IN (W=12) —
≤ -2 (contra fuerte)   116 · WR  42.2% · netR    11.09 · PF 1.17
-2 .. -1               432 · WR  46.8% · netR    94.42 · PF 1.41
-1 .. 0                781 · WR  43.8% · netR    67.55 · PF 1.15
≥ 0 (a favor)          291 · WR  47.8% · netR    30.45 · PF 1.20
— OUT (W=12) —
≤ -2 (contra fuerte)   115 · WR  58.3% · netR    59.37 · PF 2.24
-2 .. -1               422 · WR  49.3% · netR   118.08 · PF 1.55
-1 .. 0                872 · WR  43.0% · netR     75.6 · PF 1.15
≥ 0 (a favor)          312 · WR  46.5% · netR    24.73 · PF 1.15
— bucket ≤ -2 (W=12) por símbolo y mitad —
FX Vol 20  IN    40 · WR  42.5% · netR    4.18 · PF 1.18
FX Vol 20  OUT    33 · WR  63.6% · netR   23.15 · PF 2.93
FX Vol 60  IN    39 · WR  53.8% · netR   15.74 · PF 1.87
FX Vol 60  OUT    39 · WR  56.4% · netR   18.06 · PF 2.06
FX Vol 99  IN    37 · WR  29.7% · netR   -8.83 · PF 0.66
FX Vol 99  OUT    43 · WR  55.8% · netR   18.16 · PF 1.96
```

Conclusión exploratoria: el efecto solo aparece en la mitad OUT (PF 2.24) pero en IN rinde PEOR que la base (PF 1.17 vs 1.23) y por símbolo es inconsistente (FX Vol 99 IN PF 0.66). Muestras pequeñas (~115 por mitad). No es robusto: también se descarta la hipótesis inversa. Queda documentado para un futuro test pre-registrado con más datos.
