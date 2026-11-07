# Video 01 de Yoel — Análisis completo (transcripción + pantalla + audio)

**Fecha de análisis:** 2026-11-08
**Fuente:** `videos/yoel/video_01_original.mp4` (respaldo íntegro en este repo)
**Método:** transcripción ASR del audio (3 trozos de ~21 s) + análisis visual frame a frame (15 frames cada 4 s) con IA de visión, con contexto de audio sincronizado por frame. Datos crudos en `videos/yoel/datos/`.

## 1. Metadatos técnicos del video

| Campo | Valor |
|---|---|
| Duración | 61.09 s |
| Resolución | 720×1280 (vertical 9:16, formato TikTok/Reels/Short) |
| Códecs | H.264 (30 fps) + AAC estéreo |
| Tamaño | 3.7 MB |
| Formato del contenido | Pantalla dividida: arriba (~40 %) rostro del trader, abajo (~60 %) gráfico de velas |
| Stickers visibles | «FOLLOW ME» (degradado naranja-morado), pulgar 3D de like |

## 2. Transcripción completa del audio (con marcas de tiempo)

> Transcripción automática (ASR). Los «[...]» unen trozos consecutivos.

**0:00–0:21**
«El precio rompe, le vendo, vea ahora mi línea la muevo hacia este lugar de acá entonces primera entrada porque fue alerta patrón [...] voy a tirar el micrófono lo tiro o no lo tiro quién sabe lo que voy a decir segunda entrada porque fue...»

**0:21–0:42**
«...por el uno dos tres, tercera entrada puede ser por el engaño o por bailar. Entonces a partir de ahora qué es lo que ustedes se tienen que aprender de memoria: el patrón, el uno dos tres y a bailar...»

**0:42–1:01**
«Cuando te sabes hacer eso, se convierte en un stacking, entrar y salir lo que te dé la gana, se convierte en plata familia, literalmente se convierte en plata. Es todo lo que yo he estado haciendo en mis videos de YouTube: es todo alerta patrón, uno dos tres, bailar pegado, si hay un engaño, que sea plata.»

## 3. Qué se ve en pantalla (análisis visual)

**Plataforma:** MetaTrader 4/5 en móvil (barra de herramientas de dibujo con iconos característicos y fila de temporalidades M1–H8). El gráfico está recortado en el encuadre: **no se ve el nombre del par, ni la escala de precios, ni la hora del teléfono**. Ningún precio es legible en ningún frame (no inventar).

**Temporalidad:** la pestaña **M1 (1 minuto)** aparece resaltada en varios frames (f_10, f_12, f_13, f_14, f_15). Es el TF de trabajo del video.

**Elementos dibujados en el gráfico:**

1. **Líneas de tendencia blancas diagonales** trazadas a mano (gruesas, estilo trazo libre):
   - Una bajista principal larga que conecta máximos decrecientes (canal de la caída).
   - Una o más paralelas que forman canal bajista.
   - Una línea ascendente que cruza la bajista formando una «X» visible en el centro del gráfico.
   - Un **punto/nodo ancla** en el extremo superior de la línea (el punto que él arrastra: «mi línea la muevo hacia este lugar de acá»).
2. **Zonas rectangulares cian/turquesa** apiladas (4 visibles): bloques horizontales tipo **order block / zona de oferta-demanda** — dos arriba a la izquierda, una en el centro, una abajo a la derecha donde ocurre el último impulso.
3. **Líneas escalonadas amarillas** (y gemelas blancas/finas) descendentes por peldaños en la parte superior: niveles dinámicos tipo «escalones» (posible indicador de niveles por sesión/pivotes o trailing escalonado — identidad exacta sin confirmar).

**Acción del precio visible:** tendencia bajista con rompimiento de la línea (coincide con «el precio rompe»), impulso que rebota en la zona cian inferior derecha, estructura escalonada descendente.

**Momento de dibujo:** en f_02 (~6 s) el botón de línea de tendencia está seleccionado y se ve el nodo de arrastre → está **moviendo la línea en vivo** justo cuando el audio dice «mi línea la muevo hacia este lugar de acá».

## 4. Glosario de la terminología de Yoel (lo que hay que aprender de memoria)

Según sus propias palabras, **esto es lo que hay que aprender de memoria**:

| Término | Qué significa (según el video) | Rol en la entrada |
|---|---|---|
| **Alerta patrón** | La alerta que dispara el patrón que él vigila (el patrón en sí se ve en pantalla, aún sin nombrar en este video) | **1ª entrada**: «primera entrada porque fue alerta patrón» |
| **Uno dos tres (1-2-3)** | El patrón clásico 1-2-3 (pivote-rompimiento-retorno) | **2ª entrada**: «segunda entrada porque fue por el uno dos tres» |
| **El engaño** | El movimiento trampa/engañoso del precio (a validar con más videos: parece el barrido previo a la jugada real) | **3ª entrada** (opción A): «tercera entrada puede ser por el engaño o por bailar» |
| **Bailar / bailar pegado** | Entrar pegado al movimiento en curso, acompañando el precio vela a vela | **3ª entrada** (opción B) + modo general: «bailar pegado» |
| **Stacking** | Acumular varias entradas en la misma jugada (entrar y salir a voluntad) | Gestión: «se convierte en un stacking, entrar y salir lo que te dé la gana» |
| **«El precio rompe» + «mi línea la muevo»** | Tras el rompimiento de su línea, él la **reposiciona** hacia el nuevo nivel de referencia | Técnica de seguimiento de estructura |

**Secuencia completa de una jugada según este video:**

```
[El precio rompe la línea] → [él mueve su línea al nuevo nivel]
   → 1ª ENTRADA: alerta patrón
   → 2ª ENTRADA: uno dos tres
   → 3ª ENTRADA: engaño o bailar
   → STACKING: entrar/salir repetidamente con la jugada ya confirmada
```

Y su resumen final del método completo (cita textual): **«alerta patrón, uno dos tres, bailar pegado, si hay un engaño, que sea plata»**.

## 5. Hipótesis de mapeo con nuestro motor Raptor (a validar — NO son conclusiones)

| Concepto de Yoel | Concepto en nuestro motor (`motor-senales`) | Confianza |
|---|---|---|
| 1ª entrada «alerta patrón» | Fase **EARLY** del toque (25 pts) | Media — encaja en espíritu (primera reacción a la zona) |
| 2ª entrada «uno dos tres» | Confirmación direccional del **gatillo** + fase **MAIN** (40 pts) | Media |
| 3ª entrada «engaño/bailar» | Fase **LATE** (15 pts) o evento **TN** (cancelación/barrido) | Baja — requiere más videos |
| Zonas cian (order blocks) | Zonas fractales M15 (`zonas` en `raptor_default.json`) | Alta visualmente (misma idea de zonas horizontales) |
| Líneas escalonadas amarillas | Sin equivalente claro en el motor aún | — |
| Stacking | No implementado en el motor (el motor emite señales, no gestiona stack) | — |

⚠️ Estas correspondencias son **hipótesis de trabajo** para guiar la validación con los próximos videos. Nada está confirmado mientras Yoel no explique cada término explícitamente.

## 6. Preguntas abiertas para los próximos videos

1. ¿Qué es exactamente «el patrón» que dispara la «alerta patrón»? (¿su indicador Raptor? ¿un patrón de velas?)
2. ¿Cómo define él el «1-2-3»: pivote-rompimiento-retest clásico o su propia variante?
3. ¿Qué es exactamente «el engaño»? (¿barrido de liquidez, falso rompimiento?)
4. ¿Qué reglas tiene «bailar pegado»? (¿cuándo se considera pegado?)
5. ¿Qué indicador produce las líneas escalonadas amarillas?
6. ¿Sobre qué par/activo opera? (no visible en este video)
7. ¿Qué gestión de riesgo usa en el stacking? (¿mismo SL para todas las entradas? ¿SL escalonado?)

---
*Documento generado automáticamente a partir de la transcripción ASR y el análisis visual frame a frame. Los datos crudos están respaldados en `videos/yoel/datos/` para re-verificación.*
