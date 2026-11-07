# Carpeta `videos/yoel/` — Material fuente de los videos de Yoel (Sifotrader)

**Regla de trabajo:** cada video que se analiza queda respaldado aquí **íntegramente**
(video original + datos crudos del análisis) y se sube a GitHub inmediatamente,
para que nada se pierda si el entorno de trabajo se reinicia.

## Índice de videos

| # | Archivo | Duración | Documento de análisis |
|---|---|---|---|
| 01 | `video_01_original.mp4` | 61 s | `docs/estrategia/video_01_analisis.md` |
| 02 | `video_02_original.mp4` | 87 s | `docs/estrategia/video_02_analisis.md` |
| 03 | `video_03_original.mp4` | 8 min 34 s | `docs/estrategia/video_03_analisis.md` — **LA REVELACIÓN COMPLETA** |

## Hallazgos acumulados (resumen vivo)

- **Video 01 (M1):** jugada intradía — rompimiento → mueve su línea → 1ª entrada «alerta patrón» → 2ª entrada «uno dos tres» → 3ª entrada «engaño o bailar» → stacking. MT4/5 móvil, TF M1. Sin marcadores de señal en pantalla (gráfico limpio).
- **Video 02 (M15+→M5):** existen **estrategias numeradas**; la nº2 y nº3 son para **M15 hacia arriba**. Flujo: **escáner RAPTOR SCANNER v1.2.x (matriz TF × celdas 1/2/3 azules-rojas) → señal M15 → bajar a M5 → línea de tendencia + 1-2-3 → SIEMPRE a favor de la tendencia → filtros de distancia («muy alejada, no lo tomo») y de límite.** Motor del indicador: «RaptorScanEngine»; EMA30 confirmada; universo «14 pairs».
- **Marcadores de señal (re-análisis dedicado):** en el gráfico las señales son **etiquetas numéricas azul/rojo ancladas a las EMAs** (no puntos circulares). Los colores coinciden con las celdas del escáner. Línea horizontal roja = «el límite».
- **Video 03 (⭐ REVELACIÓN, 8:34 min):** Yoel revela TODO el sistema sobre MT5 (Botsbury Markets, FX Volatility 40 (1s), M1) con RAPTOR SCANNER v1.2 + panel «Ordena»:
  - **Catálogo completo: todo sale de 1, 2, 3** (TOQUES de EMA) → **1 «LA SEDUCTORA»** (engaño: sale de tendencia, regresa y **quiebra CON CUERPO**), **2** (1er+2º toque de EMA), **3** (supera el 2 y toca otra vez EMA30/50 = 3er toque).
  - **Sufijos: R = RESET** (el precio repite la estrategia en la misma dirección: 1R/2R/3R; «tu EX que te engaña de nuevo») y **B = BREAK/quiebra** (2B = 2º toque + quiebra del mínimo; RB = reset+break: 2RB/3RB).
  - **EMAs 30/50/100**: blanca=30 (la de contacto), amarilla=50 (**NO superar**), negra/gris=100 (sesgo de fondo). Regla: tocar EMA30, no superar EMA50, respetar ambas, dominio + **retesteo** del quiebre.
  - **«Las mejores»: 2B y 2RB**; frecuencia diaria «un chingo» (2B, 2RB y 1); setups malos «no son muchos» pero hay que descartarlos a ojo.
  - **Colores = DIRECCIÓN** (azul alcista / rojo bajista), **texto = código de estrategia** (1/2/3 + sufijos R/B), anclados a la vela que toca la EMA.
  - **Scanner**: matriz TF×Flip1-5/FX Volatility/Step 200-500-800 con celdas azul/rojo (número=código de estrategia), celdas naranjas = señal activa, **lista lateral de señales con horas**.
  - **Panel «Ordena»**: CONFIANZA %, PROBABILIDAD, **LOTAJE SUGERIDO**, POTENCIA GANANCIA/RIESGO, botones COMPRA/VENDER — el Raptor sugiere riesgo y ejecuta.
  - Propuesta del título: «con 100 dólares → 1,000 en un día» operando 2B/2RB/1 en M1 sintético.
- **Auditoría de la primera implementación (2026-11-08):** `docs/estrategia/auditoria_raptor_strategy.md`
  contrasta `motor-senales/estrategias/raptor_strategy.py` con los 3 vídeos. Veredicto:
  gramática 1/2/3+R+B fiel al vídeo 03 y 13/13 pruebas funcionales OK; faltan `1RB`, M1,
  la regla M15+ para 2/3 y los filtros de distancia/límite/multi-TF; la pendiente de la
  EMA100, el cierre bajo EMA30 y el cuerpo en todas las B son decisiones propias (no vídeo).

## Estructura

- `video_NN_original.mp4` — el video tal cual fue subido, sin modificar.
- `datos/video_NN_transcripcion.txt` — transcripción completa del audio (ASR por trozos ≤30 s).
- `datos/video_NN_frames/` — frames extraídos (video 01-02: cada 4 s a 540×960; video 03: cada 8 s a 960×540).
- `datos/video_NN_analisis_frames.json` — análisis IA de cada frame (con contexto de audio sincronizado).
- `datos/video_NN_transcripcion_trozos.json` — transcripciones crudas por trozo.

## Método de análisis aplicado

1. **Audio → texto:** extracción WAV 16 kHz mono, división en trozos ≤30 s (límite del ASR), transcripción y unión.
2. **Pantalla:** extracción de frames (1 cada 4 s) y análisis visual individual de CADA frame con IA de visión, inyectando el fragmento de transcripción correspondiente a ese momento como contexto.
3. **Síntesis:** documento en `docs/estrategia/` con transcripción, hallazgos visuales, glosario de términos y secuencia de la estrategia.
