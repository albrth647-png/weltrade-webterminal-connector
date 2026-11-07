# Backtest Raptor v2 — cumplimiento de reglas con datos reales

- **Datos:** BTCUSDT 1m (Binance Spot, público) — últimos 10 días (2026-10-28 23:09:00+00:00 → 2026-11-07 23:08:00+00:00 UTC), remuestreado a M5/M15/M30/H1.
- **Aviso honesto:** NO es el sintético FX Volatility 40 (1s) de los vídeos (sin histórico público). El objetivo es verificar que el motor cumple las reglas al pie de la letra y medir la frecuencia de señales. **No hay win-rate: los vídeos no definen TP/SL y no se inventa.**
- **Parámetros:** todos por defecto (`rs.Params()`) — EMAs 30/50/100, tol 0.10 ATR, max_dist_atr 2.0, avisos solo desde M15.

## Señales por TF

| TF | total | desglose |
|---|---|---|
| M1 | 245 | 1R×162, 1×33, 2RB×31, 3RB×12, 2B×6, 3B×1 |
| M5 | 42 | 1R×21, 2RB×10, 1×7, 3RB×4 |
| M15 | 33 | 2R×13, 1R×6, 2RB×5, 1×3, 3R×3, 2×1, 3×1, 3B×1 |
| M30 | 9 | 1×3, 2R×2, 1R×2, 2×1, 3×1 |
| H1 | 2 | 1×1, 1R×1 |

## Verificación de reglas (independiente, al pie de la letra)

- **R01** gramática del catálogo: ✅ sin violaciones
- **R02** kind ↔ patrón (toque/entrada): ✅ sin violaciones
- **R03** gating por TF (avisos solo M15+): ✅ sin violaciones
- **R04** tendencia alineada 30<50<100 + pendiente: ✅ sin violaciones
- **R05** zona de toque (EMA30±tol, no superar EMA50, cierre bajo EMA30): ✅ sin violaciones
- **R06** «el límite»: EMA50 no superada entre toque y quiebra: ✅ sin violaciones
- **R07** «muy alejada, no lo tomo»: distancia ≤ 2 ATR: ✅ sin violaciones
- **R08** «supera»: mínimo nuevo entre toques: ✅ sin violaciones
- **R09** quiebra del ref_low dentro de max_bars_to_break: ✅ sin violaciones
- **R10** cuerpo: siempre en la 1; en 2B/3B según parámetro: ✅ sin violaciones
- **R11** engaño: salida sobre EMA50 + cierre bajo su mínimo de referencia: ✅ sin violaciones
- **R12** campos entry/invalidation/broken_level consistentes: ✅ sin violaciones

**Resultado: 0 violaciones en todas las señales emitidas.**

## Estadística descriptiva de entradas (MFE/MAE en ATR, horizonte 30 velas)

Máximo a favor / en contra tras la entrada. Solo describe el mercado; no valida la promesa $100→$1,000 (eso depende de TP/SL, lotaje y ejecución, que los vídeos no definen).

| patrón | n | MFE mediana | MAE mediana |
|---|---|---|---|
| 1 | 47 | 3.96 | 2.25 |
| 1R | 192 | 3.19 | 3.17 |
| 2B | 6 | 1.12 | 4.91 |
| 2RB | 46 | 2.86 | 3.64 |
| 3B | 2 | 0.86 | 3.81 |
| 3RB | 16 | 2.46 | 1.94 |

## Determinismo y filtros

- Re-escaneo idéntico (determinismo): ✅ comprobado en cada TF.
- Capa «tendencia comprobada» (H1): 331 → 171 señales.

CSV completo: `senales_raptor_BTCUSDT_20261107.csv`
