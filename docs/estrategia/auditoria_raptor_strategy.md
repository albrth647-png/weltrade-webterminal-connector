# Auditoría de `raptor_strategy.py` contra los vídeos de Yoel

**Fecha:** 2026-11-08
**Objeto:** verificar si la implementación `raptor_strategy.py` (subida por el propietario
del repo) corresponde a lo que Yoel (Sifotrader) realmente dice y muestra en sus vídeos.
**Método:** contraste línea a línea contra las transcripciones completas de los 3 vídeos,
el análisis de 101 frames (15+22+64) con IA de visión, el re-análisis dedicado a los
marcadores de señal y el catálogo manuscrito en pantalla del vídeo 03 — más una batería
de **pruebas funcionales** con datos sintéticos controlados para comprobar qué hace el
código de verdad (no solo lo que dice el docstring).
**Tono exigido:** real y sin inventar nada. Cada afirmación de este informe lleva su cita.

**Archivos de evidencia:** `videos/yoel/datos/video_0{1,2,3}_transcripcion.txt`,
`videos/yoel/datos/video_03_analisis_frames.json`, `docs/estrategia/video_0{1,2,3}_analisis.md`,
`scripts/test_raptor_strategy.py` (copia ejecutable: `motor-senales/estrategias/`).

---

## 1. Veredicto en una mirada

| Dimensión | Veredicto |
|---|---|
| Gramática del catálogo (1/2/3 + sufijos R y B) | ✅ **Coincide con la revelación del vídeo 03** |
| Núcleo de las 3 estrategias (engaño, 2º toque, 3er toque) | ✅ Correcto, con 4 micro-reglas propias (§3) |
| Semántica «aviso» (touch) vs «entrada» (entry) | ✅ **Exacta**: replica la frase de Yoel «es para que tú vayas a buscar la entrada» |
| Simetría alcista/bajista (espejo) | ✅ Verificada numéricamente (prueba E) |
| Funcionamiento del código | ✅ 13/13 comprobaciones pasan (§4) |
| Cobertura del catálogo de señales | ⚠️ **Falta `1RB`** (existe en el gráfico de Yoel) |
| Temporalidades | 🔴 **Contradice al vídeo 02** (emite 2/3 en M5) y **omite M1** (el TF estrella de Yoel) |
| Filtros declarados por Yoel («muy alejada», «el límite», multi-TF, «cuando está mal») | ❌ No implementados (§3.3) |
| Valores numéricos (tolerancias, ventanas, cuerpos) | 🟡 Elección propia — **bien declarada** en el docstring como «AJUSTABLES, no valores del vídeo» |

**Conclusión corta:** la base está **bien hecha y honesta** — la gramática completa que Yoel
reveló en el vídeo 03 está replicada con fidelidad y el código funciona según sus propias
reglas. Pero **todavía no es una réplica fiel del Raptor**: le faltan piezas confirmadas en
los vídeos (`1RB`, M1, la regla M15+ para 2/3, los filtros de distancia y límite, la
confirmación multi-TF) y añade micro-reglas propias que los vídeos no dicen. Detalle y
correcciones abajo.

---

## 2. Correspondencia claim por claim

Leyenda: ✅ confirmado en audio/pantalla · 🟡 interpretación razonable (el vídeo no lo
dice así, pero no lo contradice) · 🔴 añadido propio (no está en los vídeos) ·
⚠️ contradice o falta algo que los vídeos sí muestran.

### 2.1 Lo que el código tiene y SÍ está en los vídeos

| # | Elemento del código | Evidencia en los vídeos | Veredicto |
|---|---|---|---|
| 1 | `ema_fast=30, ema_mid=50, ema_slow=100` | «el precio tiene que tocar la EMA de TREINTA… NO SUPERAR la de CINCUENTA» (v3 5:19-6:17); colores en pantalla: blanca=30, amarilla=50, oscura=100 (§4.1 del análisis v3, consistente en ~15 frames); EMAs 30/50/100 confirmadas además por el propietario | ✅ |
| 2 | Toque = el precio llega a la EMA30 | «tocó la EMA» / «tocar la EMA de treinta» (v3 2:25-2:54, 5:19-5:48) | ✅ |
| 3 | Toque = no supera la EMA50 | «NO SUPERAR la de CINCUENTA» (v3 5:48-6:17) | ✅ |
| 4 | `exceeds50` cancela la secuencia (invalidación) | «RESPETAR a la EMA de treinta y cincuenta» (v3 5:48-6:17): si la cruza, el retroceso dejó de respetar | ✅ |
| 5 | Estrategia 1 = engaño: sale de la tendencia, regresa y quiebra con cuerpo → entrada | «la UNO es que venía con tendencia, se sale —le decimos engaño—, regresa a su tendencia, **quiebra con cuerpo**: aquí te da la entrada» (v3 0:29-0:58) | ✅ |
| 6 | Estrategia 2 = segundo toque | «la número DOS es cuando el precio viene con las EMAs: primer toque que supera y segundo toque» (v3 0:29-0:58) | ✅ |
| 7 | Estrategia 3 = supera el nivel del 2 y toca de nuevo (3er toque) | «la número TRES es cuando supera el número dos y toca nuevamente la EMA de treinta y cincuenta» (v3 0:58-1:27) | ✅ |
| 8 | «Supera» como requisito entre toques (`require_extension`) | «primer toque **que supera** y segundo toque» (v3 0:29-0:58); «no salió el tres porque el precio **nunca superó**» (v2 0:58-1:27) | ✅ el requisito existe; 🟡 la métrica exacta es interpretación (ver #15) |
| 9 | 2B = segundo toque + quiebra del mínimo anterior | «el DOS B significa que el precio hizo el SEGUNDO TOQUE pero también QUEBRÓ, en este caso, el MÍNIMO anterior» (v3 4:50-5:19) | ✅ |
| 10 | 3B = tercer toque + quiebra → entrada | «uno, dos, y el tercero que quebró: **aquí toma la entrada**… ese es TRES B, por el quiebre» (v3 7:44-8:13) | ✅ |
| 11 | R = reset: la estrategia repetida en la misma dirección | «R significa R de RESET… hizo la una, se salió, volvió, hizo nuevamente… desata el 1R» (v3 1:27-1:56); cascada «cae, hace un uno nuevamente R y hace un dos R» (v3 1:56-2:25) | ✅ |
| 12 | `kind="touch"` para 2/3/2R/3R y `kind="entry"` para 1/1R/*B | «UNO DOS TRES ES TOQUE… no es quiebre, es toque: tocó la EMA… **es para que tú vayas a buscar la entrada**» (v3 2:25-2:54) — los toques son avisos; las B y la 1 son la entrada | ✅ **Exacto** |
| 13 | Alcista = espejo exacto del bajista | Sistema simétrico en el gráfico (azul=alcista, rojo=bajista, mismos códigos); verificado numéricamente en la prueba E | ✅ |
| 14 | Prioriza 2B/2RB/1 (emite todos) | «la DOS B y la DOS RB van a ser, por encima de cualquier cosa, LAS MEJORES» (v3 4:21-4:50); frecuencia diaria «un chingo» de 2B/2RB y la UNO (v3 8:13-8:34) | ✅ coherente |

### 2.2 Lo que el código AÑADE que NO está en los vídeos (reglas propias)

| # | Regla del código | Lo que dicen los vídeos | Veredicto |
|---|---|---|---|
| 15 | «Supera» = mínimo nuevo **más bajo que el LOW de la vela del toque anterior** | Yoel solo dice «supera» sin definir contra qué se mide. Si el toque tiene mecha inferior larga, el requisito se endurece (el precio tendría que bajar más) | 🟡 interpretación; conviene documentarla o medir contra el cierre/mínimo estructural |
| 16 | Tendencia = EMA30<EMA50<EMA100 **+ pendiente de la EMA100 en 10 velas** (`slope_bars`) | La alineación se observa en pantalla (f_059: «precio < EMA30 < EMA50 < EMA100 = tendencia bajista alineada») pero Yoel **nunca la verbaliza como definición**; la pendiente numérica no aparece en ningún vídeo | 🟡 la alineación / 🔴 la pendiente |
| 17 | El toque exige **cierre del otro lado de la EMA30** (`c < e30`) | «tocó la EMA» no exige cierre; «respetar» lo sugiere. El código es MÁS ESTRICTO: un toque que cierra por encima de la EMA30 no cuenta | 🟡 puede perder toques que Yoel sí contaría |
| 18 | Tolerancia `tol_atr=0.10`: el high puede rebasar la EMA50 hasta +0.1 ATR y sigue siendo «toque» | «NO SUPERAR la de cincuenta» suena estricto; el +10% de ATR es un colchón propio | 🟡 valor propio, declarado ajustable |
| 19 | Quiebra CON CUERPO para **TODAS** las variantes B (ratio ≥ 0.5 y cuerpo ≥ 0.3 ATR) | «con cuerpo» solo está verbalizado en la estrategia 1 (v3 0:29-0:58); para 2B/3B dice solo «quebró» | 🟡 extensión propia; puede descartar quiebras por mecha que Yoel contaría |
| 20 | Salida del engaño = máximo sobre la EMA50 (`h > e50+tol`) | «se sale de la tendencia» sin especificar frontera; usar la EMA50 (el «techo» del retroceso) es razonable | 🟡 |
| 21 | Referencia del mínimo del engaño: mínimo de 5 velas antes de la salida → 12 atrás (`fake_pre_bars`, `fake_lookback`) | Yoel no define cuál mínimo quiebra el engaño (pregunta abierta nº1 del análisis v3: lo dibuja como 1-3 velas fuera) | 🔴 elección propia |
| 22 | `swing_lookback=8` define «el mínimo anterior» del 2B/3B | «el MÍNIMO anterior» sin ventana definida | 🔴 elección propia |
| 23 | `max_bars_to_break=6` (la quiebra caduca a las 6 velas) | No hay límite temporal en los vídeos | 🔴 elección propia |
| 24 | Reset por contador con dos vías: post-entrada (`reset_after_signal`) y vuelta rápida de tendencia (<60 velas); ausencia larga = tendencia nueva (original) | «la misma tendencia ya se había hecho originalmente; se fue y volvió a hacerlo en la misma dirección» (v3 3:23-3:52). El umbral 60 y la vía post-entrada son interpretación | 🟡 |
| 25 | Entrada al CIERRE de la vela de quiebra | Yoel dice «aquí te da la entrada» sin precisar precio de ejecución (close vs stop bajo el mínimo) | 🟡 |

El docstring declara honestamente: «los valores numéricos son parámetros AJUSTABLES, no
valores del vídeo». Eso es correcto y es la actitud right — pero ojo: tres de las reglas
de arriba (#16 pendiente EMA100, #17 cierre bajo EMA30, #19 cuerpo en todas las B) son
**definiciones**, no valores, y el docstring las presenta dentro de «Definiciones (según
los vídeos)». Conviene re-etiquetarlas como decisiones de implementación.

### 2.3 Lo que los vídeos muestran y el código NO tiene

| # | Pieza | Evidencia | Estado |
|---|---|---|---|
| 26 | **`1RB`** | Etiquetas `1RB` visibles en el gráfico del vídeo 03 (frames 032, 036, 040, 045, 048, 059, 061-064; 11 menciones en `video_03_analisis_frames.json`). El código solo puede emitir `1`/`1R` (el engaño ya incluye la quiebra, así que su `1R` ≡ engaño reseteado con quiebra) | ⚠️ falta. La distinción exacta 1R vs 1RB no está resuelta verbalmente por Yoel (audio ambiguo en 3:52-4:21) — pero el gráfico la distingue |
| 27 | **M1 en `TIMEFRAMES`** | El vídeo 03 demuestra TODO el catálogo en **M1** (FX Volatility 40 (1s), Botsbury Markets) y la promesa $100→$1,000 es en M1; el vídeo 01 también es M1. La lista del código es `["M5","M15","M30","H1","H4"]` | ⚠️ M1 ausente siendo el TF estrella |
| 28 | **Regla «la 2 y la 3 no aplican en temporalidades menores»** | «La dos y la tres **no aplican para temporalidades menores**, escúchenme bien… Fue creada para temporalidades mayores, **de M15 por arriba**» (v2 0:00-0:29). El código emite 2/2B/3/3B en **todos** sus TF, incluido M5 | ⚠️ contradicción directa — con un matiz honesto: el vídeo 03 muestra 2B/3B en M1, así que la regla de v2 podría referirse a la señal del ESCÁNER (detectada en M15+) y no al evento en el TF de ejecución. Convención recomendada: parámetro por TF, documentando ambas citas |
| 29 | **Filtro de distancia** | «me gusta, no me gusta, **está muy alejada, no lo tomo**» (v2 0:58-1:27) | ❌ no implementado |
| 30 | **«El límite»** | «estás en tu límite, te dice ya no puedes pasar de aquí» (v2 0:58-1:27) | 🟡 parcial: el cancel por `exceeds50` actúa de límite duro en la EMA50, pero el nivel/marcador de Yoel no existe |
| 31 | **Confirmación multi-TF («tendencia comprobada»)** | El scanner con bloques rojos/azules multi-TF es la «tendencia comprobada» de Yoel (v2 72-87 s; v3 §5.1); «EL QUIEBRE SIGNIFICA DOMINIO VENDEDOR CON TENDENCIA COMPROBADA» (v3 5:19-5:48) | ❌ el código solo mira las EMAs del propio TF |
| 32 | **«Tienen que tener vista para identificar cuándo está mal»** | (v3 6:46-7:15) — setups malformados que se descartan a ojo | ❌ discrescional; razonable no implementarlo aún, pero conviene registrarlo como filtro manual |
| 33 | Conceptos de ejecución del vídeo 01 («alerta patrón», «bailar», «stacking») | v1 completo | ℹ️ fuera del alcance de este archivo (es la lógica de señales del catálogo v3); documentar como capa separada |

---

## 3. Comportamiento real verificado (pruebas funcionales)

Script: `motor-senales/estrategias/test_raptor_strategy.py` — construye series sintéticas
vela a vela (con EMAs/ATR leídas en vivo) y comprueba qué señales emite el código real.
**Resultado: 13/13 comprobaciones pasan.**

| Escenario | Qué simula | Señales emitidas | Resultado |
|---|---|---|---|
| A | 2 → 2B → engaño reseteado → 2R → 2RB | `2, 2B, 1R, 2R, 2RB` (todas SELL) | ✅ |
| B | el 2 no quiebra, hace mínimo nuevo y toca 3ª vez → 3 → 3B | `2, 3, 3B` | ✅ |
| C | la quiebra llega tarde (>6 velas) | solo `2` (la B caduca) | ✅ |
| D | tras el toque 2 el precio supera la EMA50 y luego quiebra | `2` y luego `1` (la cancelación se reconvierte en engaño) | ✅ |
| E | la misma serie A invertida (espejo) | mismos patrones en las mismas velas, dirección BUY, precios negados exactos | ✅ |
| F | serie plana, serie corta, `scan_last` | sin crash; `scan_last` devuelve solo las señales de la última vela cerrada | ✅ |

**Hallazgos del sondeo vela a vela (cosas que el docstring no cuenta):**

1. **Prioridad quiebra > engaño**: si en la misma vela proceden el 2B/3B pendiente y el
   engaño, gana el pendiente (el `if not fired` protege el engaño). Decisión razonable;
   conviene documentarla.
2. **Re-disparo del engaño**: la propia vela del engaño es a su vez un evento «sale sobre
   la EMA50». Si después el precio sigue cayendo y rompe mínimos con cuerpo, el código
   emite **OTRO `1R` sin nueva salida sobre la EMA50** (verificado en sondeo: secuencia
   `1R, 1R`). Por la definición de Yoel («se sale… regresa… quiebra») un segundo engaño
   debería exigir una nueva salida; decidir si este re-disparo es deseable.
3. **4º toque**: `touches` sigue contando pero por encima de 3 no emite nada y no fija
   `pend`. El `pend` del 3er toque sobrevive, así que una quiebra tras un 4º toque sale
   etiquetada `3B`. Yoel no define el 4º toque — decidir política (¿capar?, ¿etiquetar?).
4. **La quiebra nunca ocurre en la vela del toque** (`i > pend["idx"]`): un martillo que
   toca la EMA30 y cierra rompiendo el mínimo en la MISMA vela no genera 2B; la quiebra
   se busca desde la vela siguiente. Si Yoel acepta la quiebra intravela, aquí se pierde.
5. El primer toque tras cada reset es **silencioso por diseño** (solo emiten el 2º y 3er
   toque): es coherente con la cascada 1R→2R→3R del vídeo 03 siempre que el `1R` de esa
   cascada sea un engaño; si Yoel lo emite como toque, divergiría.
6. El `suffix()` lee el contador de ciclo en el momento de emitir — correcto (no hay
   problema de closures).

---

## 4. Qué corregiría (priorizado)

1. **🔴 Temporalidades (lo más serio):** añadir M1 y hacer el gating por TF — p. ej.
   `{"M1": ["1","1R","2B","2RB","3B","3RB"], "M5": [...], "M15+": todas}` — documentando
   la tensión v2 («la 2 y la 3, M15 para arriba») vs v3 (catálogo completo demostrado en
   M1). Hoy el archivo emite 2/3 en M5 y no puede operar el escenario M1 de Yoel.
2. **⚠️ `1RB`:** decidir el mapeo. Opciones: (a) emitir `1RB` en lugar de `1R` para el
   engaño reseteado (más fiel a las etiquetas vistas), o (b) mantener `1R` y documentar
   la equivalencia. Falta evidencia para cerrarlo — quedar como pregunta abierta.
3. **Filtro de distancia:** parámetro nuevo `max_dist_atr` — rechazar el toque si la
   distancia del cierre a la EMA30 supera k·ATR («muy alejada, no lo tomo»).
4. **Reset del engaño incompleto:** hoy, una salida sobre la EMA50 sin quiebra posterior
   NO incrementa el ciclo (la secuencia siguiente sale sin R). Por la definición de Yoel
   («se salió, volvió, lo hizo de nuevo») debería contar como reset.
5. **Política del 4º toque** (silencio actual vs etiquetar).
6. **Parametrizar el cuerpo de las B** (`require_body_on_break`): solo la 1 tiene el
   «con cuerpo» confirmado; para 2B/3B es una extensión propia.
7. **Re-etiquetar el docstring:** mover la pendiente de la EMA100, el cierre bajo EMA30 y
   el cuerpo de las B a una sección «decisiones de implementación (no dichas en vídeo)».
8. **Futuro:** integrar la confirmación multi-TF del scanner y «el límite» como filtros
   de otra capa (el propio Yoel los usa antes de mirar el gráfico).

---

## 5. Conclusión honesta

**¿Está bien hecha? Como base, sí — y es de las partes más fieles al material que tenemos.**
La gramática completa que Yoel reveló en el vídeo 03 (todo sale de 1, 2, 3 por toques de
EMA30 sin superar la EMA50; B = quiebra del extremo; R = repetición en la misma dirección;
toques = avisos y B/1 = entradas) está replicada 1:1, el código funciona exactamente según
sus reglas declaradas (13/13 pruebas), la simetría alcista/bajista es exacta y el docstring
declara con honestidad qué valores son propios.

**Pero no es todavía el Raptor de Yoel**: le faltan piezas que los vídeos confirman
(`1RB`, el TF M1, la regla M15+ para 2/3, «muy alejada no lo tomo», «el límite», la
confirmación multi-TF), contradice una regla explícita (2/3 en temporalidades menores) y
toma 3 decisiones estructurales que los vídeos no respaldan (pendiente de la EMA100,
cierre obligatorio del otro lado en el toque, cuerpo exigido en todas las quiebras).
Ninguna de esas decisiones es absurda — son un filtro más estricto que el de Yoel — pero
el efecto neto es que **el código verá menos señales que Yoel** y, en M5, unas que según
el vídeo 02 no deberían existir ahí.

Recomendación: aplicar las correcciones 1-4 de §4 y re-validar con el siguiente vídeo.

---

## 6. Fuentes

- Transcripciones: `videos/yoel/datos/video_01_transcripcion.txt`,
  `video_02_transcripcion.txt`, `video_03_transcripcion.txt` (18 trozos ASR, crudos en
  `*_transcripcion_trozos.json`).
- Análisis de pantalla: `docs/estrategia/video_01_analisis.md`, `video_02_analisis.md`,
  `video_03_analisis.md` (metadatos, catálogo manuscrito, colores de EMA, frames citados).
- Re-análisis de marcadores: `videos/yoel/datos/video_02_analisis_puntos.json`,
  `scripts/videos/dots_v1_resumen.txt`, `dots_v2_resumen.txt`.
- Etiquetas del vídeo 03: `videos/yoel/datos/video_03_analisis_frames.json`
  (verificación de menciones: 2B×191, 2R×320, 1R×260, 3RB×72, 3B×79, 2RB×89, 1RB×11…).
- Prueba funcional: `motor-senales/estrategias/test_raptor_strategy.py` (copia ejecutable
  junto al código auditado `motor-senales/estrategias/raptor_strategy.py`; original sin
  modificar en `upload/`).
