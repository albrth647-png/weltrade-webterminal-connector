# Backtesting de la RAPTOR HÍBRIDA — estado y uso

**Diseño:** `docs/estrategia/hibrida_diseno.md` · **Núcleo v2:** congelado (tests 34/34)
**Híbrida:** `motor-senales/estrategias/raptor_hibrida.py` (tests 45/45, incl. T0 de igualdad con v2)

## Qué hay ya funcionando

| Pieza | Estado |
|---|---|
| `raptor_hibrida.py` — capas A-G (zonas fractales M15, fuerza, TN, fases E/M/L, sesgo H1 tolerante, gatillo, score) | ✅ 45/45 tests, T0 igualdad con el núcleo en verde |
| `backtest_hibrida.py` — capa de riesgo v1 (SL 1·ATR(M15 SMA14) / TP 2·ATR, ambigua=pérdida) + experimentos E0-E5 | ✅ validado extremo a extremo |
| Dry-run con datos reales (BTCUSDT, Binance público) | ✅ `reporte_binance_BTCUSDT.md` — valida el ENGRANAJE, no son los sintéticos |
| Descarga de velas REALES de los índices sintéticos (cmd 11 del protocolo) | ⏳ herramienta lista, espera credenciales demo |

## Lo único que falta para el backtest con los pares sintéticos de tu GitHub

El servidor de demo (`mt5.demo.weltrade.org`) está vivo y el protocolo funciona
(handshake + sesión anónima cmd 29 OK), pero la **creación de cuenta demo por el
propio protocolo (cmd 30, «Open Demo account» del WebTerminal) la rechaza el
servidor (dd=1)** — probado con/sin envoltorio del cliente, con huella de
dispositivo realista y con 10 grupos distintos. Es coherente con que el dominio
de la config del broker (`weltrade.org`, que definía los grupos demo) está caído.
Además: el registro web exige Cloudflare y no hay credenciales guardadas en el
repo (correcto — `.env` está gitignoreado).

**Solución: necesito el login y la contraseña de UNA cuenta demo de Weltrade**
(la que usaste para el backtest v1 vale, o creas otra en 2 minutos). Con ella:

```bash
# 1) guarda las credenciales (solo local, gitignoreado)
#    motor-senales/.env  →  WT_LOGIN=..., WT_PASS=..., WT_HOST=mt5.demo.weltrade.org
# 2) descarga 1 año de velas reales de los pares del repo (FX Vol 20/60/99,
#    SFX Vol 20/60/99, Step Index) en M5/M15/M30/H1:
node conector/abrir_demo.js velas --dias 366
# 3) lanza el backtest real:
cd motor-senales/estrategias && python3 backtest_hibrida.py --fuente weltrade --simbolo "FX Vol 20"
```

Los pares a usar están en el propio repo (`scripts_re/wt_correlate.js`: catálogo
de símbolos sintéticos Weltrade) y el cmd 11 de velas está verificado en el
proyecto (`conector/LEEME.md`).

## Uso del backtester

```bash
cd motor-senales/estrategias
python3 backtest_hibrida.py --fuente weltrade --simbolo "FX Vol 20" [--dias 366]
python3 backtest_hibrida.py --fuente binance --simbolo BTCUSDT --dias 10   # dry-run
```

Salida: `reporte_<fuente>_<simbolo>.md` (E0-E5) + `senales_hibrida_<fuente>_<simbolo>.csv`
(cada señal con zona, fuerza, fase_zona, sesgo_h1, gatillo, score, SL/TP y resultado).

## Ajustes disponibles (todos en `HibridaParams`)

- `zonas.confluencia_atr` (0,5): radio señal↔zona en ATR(M15). En tendencia dura
  los pivotes recientes quedan lejos (ver tabla E3-bis del reporte); súbelo si
  quieres confluencia más laxa.
- `score.min` (0): el score ORDENA; sube `score_min` en `filtrar` solo con datos.
- Interruptores: `filtrar_sesgo`, `filtrar_confluencia`, `filtrar_gatillo` — OFF por
  defecto (contrato de no-choque; T0 verifica igualdad con el núcleo).
