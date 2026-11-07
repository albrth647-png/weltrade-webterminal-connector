# Correcciones aplicadas a `raptor_strategy.py` (v2) + backtesting

**Fecha:** 2026-11-08
**Origen:** §4 de `docs/estrategia/auditoria_raptor_strategy.md` (8 correcciones
priorizadas). Este documento registra QUÉ se cambió, CON QUÉ EVIDENCIA y CÓMO se
verificó. Nada se inventó: cada decisión cita el vídeo, la auditoría o queda
marcada como pregunta abierta.

**Archivos tocados:**
- `motor-senales/estrategias/raptor_strategy.py` — v2 (motor)
- `motor-senales/estrategias/test_raptor_strategy.py` — 34 comprobaciones (A-N)
- `motor-senales/estrategias/backtest_raptor.py` — backtest + verificador independiente
- `docs/backtest/backtest_raptor_20261107.md` + CSV de señales — resultado

---

## 1. Las 8 correcciones, una a una

### 🔴 Corrección 1 — Temporalidades: M1 + gating por TF
**Problema:** el código no tenía M1 (el TF estrella de Yoel) y emitía los avisos 2/3
en M5, contradiciendo al vídeo 02.
**Evidencia:** «La dos y la tres **no aplican para temporalidades menores**… fue creada
para temporalidades mayores, **de M15 por arriba**» (v2 0:00-0:29) + «**nos vamos a
temporales menores y buscamos una entrada**» (v2 29-58 s) + el catálogo completo
demostrado en M1 (v3).
**Solución:** `TIMEFRAMES = ["M1","M5","M15","M30","H1","H4"]` y parámetro
`emit_touches_from="M15"`: los AVISOS (2, 3, 2R, 3R) solo se emiten desde M15;
las ENTRADAS (1, 1R, 2B, 2RB, 3B, 3RB) se emiten en TODAS las TF. TF desconocido
→ `ValueError`. La tensión v2↔v3 queda documentada en el docstring.
**Test:** escenario G (5 comprobaciones).

### ⚠️ Corrección 2 — `1RB`
**Problema:** el gráfico de Yoel muestra `1RB` (11 menciones) además de `1R`
(260); el audio no resuelve la diferencia (v3 3:52-4:21, ambiguo).
**Solución:** parámetro `fake_reset_label` (`"1R"` por defecto — etiqueta dominante
en pantalla y coherente con «cae, hace un uno nuevamente R» (v3 1:56-2:25);
`"1RB"` activable). Queda como **pregunta abierta** para el próximo vídeo.
**Test:** escenario K.

### ❌ Corrección 3 — Filtro de distancia
**Problema:** «está muy alejada, no lo tomo» (v2 58-87 s) no estaba implementado.
**Solución:** parámetro `max_dist_atr=2.0` (ajustable, valor propio): un toque cuyo
cierre quede a más de k·ATR de la EMA30 se rechaza (no cuenta, no fija pendiente).
`None` lo desactiva.
**Test:** escenario H (rechazado con 2.0 / aceptado con None).

### 🔴 Corrección 4 — Reset del engaño incompleto (salida huérfana)
**Problema:** una salida sobre la EMA50 sin quiebra posterior no incrementaba el
ciclo: la secuencia siguiente salía sin R.
**Evidencia:** «se salió, volvió, lo hizo de nuevo» (v3 1:27-2:25).
**Solución:** `reset_on_abandoned_exit=True`: la salida marca `exit_open`; cuando el
precio vuelve a tocar la EMA30, el ciclo se incrementa y esa salida queda
consumida (`min_exit_bar`) para que tampoco pueda dar un engaño después. Si la
tendencia se pierde antes del retorno, el reset no cuenta (el retorno nunca llegó).
**Test:** escenario I (`2R` con el reset; `2` con `reset_on_abandoned_exit=False`).

### 🟡 Corrección 5 — Política del 4.º toque
**Decisión:** mantener el comportamiento (por encima del 3.er toque no emite nada
y no reemplaza el pendiente; una quiebra posterior sale etiquetada 3B) y
documentarlo explícitamente en el docstring como decisión propia. Yoel no define
el 4.º toque.

### 🟡 Corrección 6 — Cuerpo de las variantes B
**Problema:** «con cuerpo» solo está verbalizado para la 1 (v3 0:29-0:58); exigirlo
en 2B/3B era una extensión propia que descartaba quiebras que Yoel contaría.
**Solución:** `require_body_on_break=False` por defecto: 2B/3B = «quebró» (close
más allá del extremo, cualquier cuerpo); la 1 SIEMPRE exige cuerpo (confirmado).
Activando el parámetro se recupera el filtro estricto.
**Test:** escenario J (misma quiebra fina: 2B por defecto, nada exigiendo cuerpo).

### 🟡 Corrección 7 — Docstring re-etiquetado
**Solución:** el docstring ahora separa **PARTE A — «según los vídeos» (con citas y
marcas de tiempo)** de **PARTE B — «decisiones de implementación (NO dichas en
vídeo)»**: pendiente de la EMA100, cierre bajo la EMA30 en el toque, tolerancias,
ventanas, caducidad, entrada al cierre, política del 4.º toque, prioridad
quiebra>engaño y el requisito de salida nueva para un segundo engaño.

### 🔮 Corrección 8 — Capa multi-TF «tendencia comprobada»
**Problema:** «EL QUIEBRE SIGNIFICA DOMINIO VENDEDOR CON TENDENCIA COMPROBADA»
(v3 5:19-5:48) y los bloques multi-TF del scanner no tenían equivalente.
**Solución (capa separada, sin inventar el motor de Yoel):**
`multi_tf_trend(dfs)` (alineación precio/EMA30/EMA50/EMA100 por TF — lo único
observable, f_059) y `filter_trend_confirmed(signals, dfs, higher=("H1","H4"))`
con consenso estricto: TFs de acuerdo → solo pasan señales de esa dirección;
en desacuerdo → sin confirmación (0 señales); sin alineación → filtro inerte.
El motor real (RaptorScanEngine, Flip 1-5, Step 200/500/800) NO es público y así
se declara.
**Test:** escenario M (5 comprobaciones).

---

## 2. Correcciones extra detectadas al implementar (hallazgos 1-2 de la auditoría)

- **Re-disparo del engaño corregido** (hallazgo 2): un segundo engaño exige una
  salida sobre la EMA50 POSTERIOR al engaño anterior (`min_exit_bar`). Antes, la
  misma salida podía dar `1R, 1R`. **Test:** escenario L.
- **Salida sobre la EMA50 resetea la secuencia de toques siempre** (antes solo
  cuando había pendiente activa): coherente con «NO SUPERAR la de CINCUENTA».

---

## 3. Verificación triple

1. **Tests unitarios:** 34/34 comprobaciones (A-F originales + G-N nuevas) con
   series sintéticas vela a vela y EMAs/ATR leídas en vivo.
2. **Backtesting con datos reales:** BTCUSDT 1m (Binance Spot, 10 días,
   14 400 velas) remuestreado a M5/M15/M30/H1 → **331 señales** escaneadas,
   0 violaciones de las 12 reglas verificadas por un verificador INDEPENDIENTE
   (recalcula EMAs/ATR/tendencia por su cuenta y comprueba cada señal contra
   cada regla; lógica direccional exacta — el BUY se escanea en espejo).
   Detalle y estadística MFE/MAE en `docs/backtest/backtest_raptor_20261107.md`.
3. **Determinismo:** doble escaneo idéntico en cada TF.

**Nota honesta del backtest:** los datos NO son el sintético FX Volatility 40 (1s)
de los vídeos (sin histórico público). No se calcula win-rate: los vídeos no
definen TP/SL y no se inventa nada.

## 4. Pendiente (preguntas abiertas que siguen vivas)

1. `1R` vs `1RB` — parámetro listo; cerrar con el próximo vídeo de Yoel.
2. Definición exacta de «cuando está mal» (v3 6:46-7:15) — filtro discrecional
   sin regla programable conocida.
3. Integrar `filter_trend_confirmed` en el flujo del scanner de la PWA
   (los bloques multi-TF antes de mirar el gráfico).
