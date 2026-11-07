# Carpeta `videos/yoel/` — Material fuente de los videos de Yoel (Sifotrader)

**Regla de trabajo:** cada video que se analiza queda respaldado aquí **íntegramente**
(video original + datos crudos del análisis) y se sube a GitHub inmediatamente,
para que nada se pierda si el entorno de trabajo se reinicia.

## Índice de videos

| # | Archivo | Duración | Documento de análisis |
|---|---|---|---|
| 01 | `video_01_original.mp4` | 61 s | `docs/estrategia/video_01_analisis.md` |
| 02 | `video_02_original.mp4` | 87 s | `docs/estrategia/video_02_analisis.md` |

## Hallazgos acumulados (resumen vivo)

- **Video 01 (M1):** jugada intradía — rompimiento → mueve su línea → 1ª entrada «alerta patrón» → 2ª entrada «uno dos tres» → 3ª entrada «engaño o bailar» → stacking. MT4/5 móvil, TF M1.
- **Video 02 (M15+→M5):** existen **estrategias numeradas**; la nº2 y nº3 son para **M15 hacia arriba**. Flujo: **escáner RAPTOR SCANNER v1.2.x (matriz TF × celdas 1/2/3 azules-rojas) → señal M15 → bajar a M5 → línea de tendencia + 1-2-3 → SIEMPRE a favor de la tendencia → filtros de distancia («muy alejada, no lo tomo») y de límite.** Motor del indicador: «RaptorScanEngine»; EMA30 confirmada; universo «14 pairs».

## Estructura

- `video_NN_original.mp4` — el video tal cual fue subido, sin modificar.
- `datos/video_NN_transcripcion.txt` — transcripción completa del audio (ASR, 3 trozos).
- `datos/video_NN_frames/` — frames extraídos cada 4 s (540×960).
- `datos/video_NN_analisis_frames.json` — análisis IA de cada frame (con contexto de audio sincronizado).
- `datos/video_NN_transcripcion_trozos.json` — transcripciones crudas por trozo.

## Método de análisis aplicado

1. **Audio → texto:** extracción WAV 16 kHz mono, división en trozos ≤30 s (límite del ASR), transcripción y unión.
2. **Pantalla:** extracción de frames (1 cada 4 s) y análisis visual individual de CADA frame con IA de visión, inyectando el fragmento de transcripción correspondiente a ese momento como contexto.
3. **Síntesis:** documento en `docs/estrategia/` con transcripción, hallazgos visuales, glosario de términos y secuencia de la estrategia.
