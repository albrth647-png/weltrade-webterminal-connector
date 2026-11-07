# Carpeta `videos/yoel/` — Material fuente de los videos de Yoel (Sifotrader)

**Regla de trabajo:** cada video que se analiza queda respaldado aquí **íntegramente**
(video original + datos crudos del análisis) y se sube a GitHub inmediatamente,
para que nada se pierda si el entorno de trabajo se reinicia.

## Índice de videos

| # | Archivo | Duración | Documento de análisis |
|---|---|---|---|
| 01 | `video_01_original.mp4` | 61 s | `docs/estrategia/video_01_analisis.md` |

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
