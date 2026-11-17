# Informe: Sistemas para dibujar rayas (tendencia) automaticamente

Fecha: 2026-11-12. Alcance: busqueda exhaustiva en internet de sistemas modernos (2025-2026) que detecten/dibujen rayas (tendencias/fan/abanico) sin marcar ejemplos a mano.

## 1. Resumen ejecutivo

Tu estrategia = "fan principle" / abanico: rayas desde un origen comun, cambio por cierre con margen 0.10 ATR, engano si regresa en <=6 velas, toque por cuerpo. Ya existe como concepto clasico (Murphy) y hay implementaciones automaticas modernas. Conclusion principal: NO necesitas ML/CV ni LLM para dibujar bien; el mejor camino para tu motor (Node.js, determinista, sin deps) es portar logica de deteccion de pivots + fan desde Pine Script open source (MarkitTick Fan Principle, Gann Fan UAlgo) a JS. Las opciones "AI" (TrendSpider Sidekick, Agensi skill, VLM) son utiles como capa opcional pero no reemplazan el nucleo determinista y rompen tu regla "sin LLM en plantillas".

## 2. Lo que existe (2025-2026) por categoria

### A. Pine Script open source (TradingView) — mejor referencia para tu motor
- MarkitTick Fan Principle Signals: fan de 3 patas desde origen comun, pivots simetricos, ATR-adaptive, volume/HTF filters. Codigo abierto. EXACTAMENTE tu abanico.
- Gann Fan [UAlgo]: pivots highs/lows, secuencia alternante high/low, fan automatico alcista/bajista, 9 angulos. Open source.
- Auto Trendlines [Metrify]: pivot clustering + scoring, "como dibuja humano", no hallucina lineas si mercado sucio. Open source.
- Auto Trendlines [AFD]: validacion estricta, solo dibuja si linea sobrevive filtros. Open source.
- Auto Trend [theUltimator5]: best-fit iterativo, sin pivot logic, divide lookback en tercios. Open source.
- casoon/pine-scripts auto_trendlines: combinatorial pair scan + OLS refinement + composite score + greedy non-overlap.
- Trendline Breakout Navigator [LuxAlgo]: 3 trendlines de distinta significancia entre swing points, dots en pierce sin break. Open source.
- Trendline Toolkit w/ Breaks [EliCobra]: trendlines en osciladores via trailing stop, no solo precio.
- PivotTrendlines library [ricardo313]: fuerte (3 pivots con tolerancia canal) + debil (2 pivots), exportable.

### B. Python (para microservicio opcional)
- pytrendline (ednunezg): scan exhaustivo O(N^3) entre puntos, pivot-based, scoring, plotting. Bueno para offline/pequenos datasets.
- auto_trendline (algo2ai-analytics): linear regression channels + pivots, forward extension, log scale. Research.
- pytrendseries: etiquetado de tendencias para ML (uptrend/downtrend/notrend).
- ta-lib JS (WaiSiuKei): ATR, pivots, patron recognition en JS.

### C. Plataformas comerciales con auto-trendline
- TrendSpider: auto trendlines + Fibs + pattern recognition + scanner + backtest + Sidekick AI (LLM que ve el chart). Pricing ~$50-230/mes. Sidekick: chart awareness, anotaciones, deep research, no internet.
- LuxAlgo Vela: charting engine open source (Apache 2.0) + indicators + Quant coding agent. Auto Trend Drawing, Machine Learning Trendlines Cluster (k-means), Rolling Trendline, Trendlines Oscillator.
- TradingView: auto trendlines via Pine Script (gratis). No auto-dibujo nativo sin script.

### D. AI / vibe-coding (2026)
- Agensi "Draw Trendlines" skill ($9-14): skill para Claude/Cursor que dibuja fans de trendlines en TradingView via MCP. Literalmente un agente IA que dibuja por ti.
- LLM_trader (qrak): agente LLM que renderiza chart 1920x1080 + 65 indicadores + memoria de trades cerrados -> modelo multimodal -> reglas deterministicas -> paper trade. Experimental.
- QuantAgent (Y-Research-SBU): 4 agentes especializados sobre OHLC crudo, genera imagen de trendlines.
- VLM chart reading (Claude/Gemini): audit 2026 muestra que VLMs luchan con precision; narrativa fluida no = precision. ~0.7 accuracy en CNN puro.

### E. ML/CV academico
- CNN en imagenes de candlesticks: MobileNetV2 91.67% en patrones (head/shoulders, double top/bottom). YOLOv8 para deteccion de patrones. Pero precision en tendencias (no patrones) es baja (~0.7).
- SAP patent US12393646B2: deteccion de patrones en dashboards con CNN.
- Conclusion academica: CNN en imagenes captura info util pero no supera modelos de series temporales; VLM no lee charts con precision suficiente para trading.

### F. MQL5 / MT5
- Auto Trend Lines (tradingfinder): swing points + trend lines + channels 3 timeframes + ATR filter. Open source MQL4/5.
- MQL5 trendline breakout con R-squared goodness of fit.
- "Trendline with break" indicator ($30, MT5 marketplace).

## 3. Tabla comparativa

| Sistema | Tipo | Costo | Precision | Fit para tu motor | Veredicto |
|---|---|---|---|---|---|
| Portar MarkitTick/Gann Fan a JS | Algoritmo determinista | Gratis | Alta (pivot-based) | Excelente (sin deps, JS) | RECOMENDADO nucleo |
| casoon combinatorial scan | Algoritmo | Gratis | Alta | Bueno (mas complejo) | Alternativa |
| pytrendline (Python) | Exhaustivo O(N^3) | Gratis | Media-alta | Requiere microservicio | Solo offline |
| ta-lib JS | Libreria | Gratis | N/A (indicadores) | Buena (ATR, pivots) | Usar para ATR |
| TrendSpider | Comercial | $50-230/mes | Alta (algo) | No (cerrado, no exporta logica) | Referencia UX |
| LuxAlgo Vela | Freemium + open source core | Gratis core | Alta | Parcial (charting engine) | Inspiracion |
| Agensi Draw Trendlines | Skill AI | $9-14 | Media | No (depende de TradingView+MCP) | Vibe-coding ejemplo |
| LLM/VLM chart reading | IA | API cost | Baja-media (~0.7) | Rompe "sin LLM plantillas" | NO para nucleo |
| CNN imagenes | ML | Entrenamiento | Alta en patrones, baja en tendencias | Requiere dataset+training | NO ahora |

## 4. Recomendacion principal

Implementar deteccion automatica de fan/abanico en tu motor JS, portando la logica de MarkitTick Fan Principle + Gann Fan UAlgo, adaptada a tu estrategia (abanico desde origen, cambio por cierre 0.10 ATR, engano <=6 velas, toque por cuerpo).

Pasos minimos:
1. Funcion detectarPivots(velas, pivotLen): swing highs/lows simetricos (ta.pivothigh/pivotlow equivalente).
2. Secuencia alternante: si nuevo pivot mismo tipo que ultimo, conservar el mas extremo; si opuesto, append.
3. Fan: desde origen comun (ultimo pivot significativo), conectar a 3 pivots sucesivos del mismo lado, produciendo 3 lineas de steepness creciente.
4. Validacion: linea valida solo si precio no la penetra entre pivots (no wrong-side wicks) y ATR filter (diferencial entre pivots >= k*ATR).
5. Cambio de tendencia: cierre mas alla de la raya por >= 0.10 ATR -> nueva raya desde nuevo origen.
6. Engano: si regresa a la raya anterior en <=6 velas -> marcar engano (raya corta horizontal = trampa).
7. Toque: cuerpo contiene la raya + siguiente vela cierra con cuerpo a favor -> aviso toque.
8. Dibujar en /grafica canvas (ya tienes la infraestructura).

Esto elimina la necesidad de marcar cientos de ejemplos: el motor detecta y dibuja solo, y los casos aprobados (casos.jsonl) sirven para validar/calibrar, no para enseñar a dibujar.

## 5. Alternativas modernas (capa opcional, no nucleo)

- TrendSpider (referencia de UX): estudiar su UI de auto-trendline + tuning (analysis type, drawing input, quality, all/unfiltered). Adoptar los controles de "cuantas lineas" y "relevancia" en tu /grafica.
- Agensi Draw Trendlines skill: ejemplo de "vibe coding" donde un agente IA dibuja en TradingView. Tu motor ya hace algo equivalente pero propio y sin dependencia de TradingView.
- LLM vision (Claude/Gemini): usar SOLO como segunda opinion / explicacion, NO como detector. El audit 2026 muestra que VLMs no leen charts con precision suficiente.
- LuxAlgo Vela open source core: si algun dia quieres migrar el canvas a WebGL2, su engine (Apache 2.0) es candidato. No urgente.

## 6. Lo que NO recomiendo (y por que)

- LLM/VLM como detector principal: audit 2026 (Antonov) muestra VLMs no leen charts con precision; narrativa fluida != precision. Rompe regla "sin LLM en plantillas".
- CNN sobre imagenes: 91.67% en patrones clasicos pero ~0.7 en tendencias; requiere dataset etiquetado enorme; tu estrategia es tendencia/fan, no patrones clasicos.
- TrendSpider como dependencia: cerrado, no exporta logica, $50-230/mes; usalo como referencia de UX, no como motor.
- pytrendline en produccion: O(N^3), demasiado lento para tiempo real; solo para analisis offline/calibracion.
- Agensi skill: depende de TradingView + MCP, no se integra a tu motor; es ejemplo de vibe-coding, no solucion.

## 7. Fuentes consultadas (exhaustivo)

Pine Script open source: MarkitTick Fan Principle Signals, Gann Fan [UAlgo], Auto Trendlines [Metrify], Auto Trendlines [AFD], Auto Trend [theUltimator5], casoon/pine-scripts auto_trendlines, Trendline Breakout Navigator [LuxAlgo], Trendline Toolkit w/ Breaks [EliCobra], PivotTrendlines [ricardo313], Auto Trend Lines v1.0 [eagle2586], Auto Trendline Breaks [ADXAE], Trendline Detector 3 Timeframes [ariel_kopi], Simple Auto Trend Lines [ire0n], Auto Trend Lines [ZOM], Planetary Fan Array [BlueprintResearch], MTF Pivot Fib Speed Resistance Fans [gggoaaat], NotLazyBear Trendline Breakout, TrendLine Toolkit [EliCobra], LuxAlgo Trend Lines, LuxAlgo Trendlines Oscillator, LuxAlgo Rolling Trendline, LuxAlgo Auto Trend Drawing, LuxAlgo Machine Learning Trendlines Cluster.

Python: pytrendline (ednunezg), pytrendlineAITA (IvanLetteri), auto_trendline (algo2ai-analytics), pytrendseries (rafael.rafarod), ta-lib JS (WaiSiuKei).

Plataformas: TrendSpider (auto trendlines, Sidekick AI, pricing, customization docs), LuxAlgo Vela (open source core Apache 2.0, Quant coding agent), TradingView (Pine Script v6).

AI/vibe-coding: Agensi Draw Trendlines skill ($9-14), LLM_trader (qrak), QuantAgent (Y-Research-SBU), QuantHarness trend_agent, cvikasreddy/trad llm-chart-analysis, FLAG-TRADER.

Academico: arXiv 2501.12239 (CNN market strength), PeerJ cs-2719 (CNN candlestick patterns), Advances in Science and Technology Research Journal 2025 (image-based trend classification), ACM ICSCA 2023 (object detection chart patterns), US patent US12393646B2 (SAP chart pattern detection), Antonov 2026 audit (VLM chart reading).

MQL5/MT5: tradingfinder Auto Trend Lines (MQL4/5), MQL5 articles (trendline breakout R-squared), MT5 marketplace "Trendline with break".

Referencias teoricas: John Murphy "Technical Analysis of Financial Markets" (Fan Principle, cap. 4), LuxAlgo Library concept fan-principle, TradingSim fan principle, ArabicTrader fan lines.

## 8. Siguiente paso sugerido

Si quieres, implemento el detector de pivots + fan en motor-senales/rayas.js (funcion detectarFan) y lo dibujo en /grafica, con parametros calibrables (pivotLen, k ATR, n lineas fan). Tests en test_rayas.mjs. Sin dependencias nuevas. Confirmo antes de tocar codigo.
