# rayas-v2 · trendline rodante

Carpeta nueva e independiente. **No importa nada de `motor-senales/` y no lo toca.**
Su único trabajo: que la gráfica marque 2–3 rayas **bien puestas**, que la maestra
nazca al inicio de la tendencia y **se vaya corriendo** con los impulsos y retrocesos.

```
rayas-v2/
├── motor.mjs    motor de cálculo (ESM, sin dependencias)
├── series.mjs   series sintéticas con línea plantada (para probar y ver)
├── probar.mjs   pruebas: 27 comprobaciones, exit 1 si algo se rompe
├── ver.mjs      visor: lee /velas o un JSON y escribe vista.html
└── README.md
```

## Uso

```bash
node rayas-v2/probar.mjs                        # pruebas (debe imprimir TODO OK)
node rayas-v2/ver.mjs --demo                    # serie sintética con línea plantada
node rayas-v2/ver.mjs --file velas.json         # velas propias
node rayas-v2/ver.mjs --url "http://127.0.0.1:3000/velas?simbodo=FX%20Vol%2020&tf=M30"
node rayas-v2/ver.mjs --url "..." --tol 0.4     # tolerancia de toque (ATR)
```

`ver.mjs` imprime las marcas en JSON por stdout y deja `rayas-v2/vista.html`
para abrir en el navegador o capturar con Chromium.

## Cómo se elige la raya maestra

1. **Pivotes de cuerpo**, nunca mechas (`max(o,c)` / `min(o,c)`), `pivL = pivR = 3`.
2. **Candidatos**: todos los pivotes del mismo tipo (mínimos en alcista, máximos en
   bajista) dentro de `lookback` barras.
3. Para cada anclaje reciente se busca el **origen más antiguo** que deje la línea
   limpia: ahí nace la raya, no en un pivote de en medio.
4. Se elige por puntuación `span − 2·atraso`, donde `atraso` es lo que el ancla se
   ha quedado atrás del último pivote (con 12 % de gracia). Consecuencia directa:
   cuando aparece un retroceso nuevo que **respeta** la línea, el ancla se corre a
   ese pivote; si lo **rompe**, se conserva la anterior.
5. Una raya rota no se proyecta: se dibuja hasta la barra de rotura y la etiqueta
   lo dice (`· ROTA`).

## Garantías (lo que el motor NO se permite)

| Regla | Cómo se comprueba |
|---|---|
| Anclas en pivotes de cuerpo reales | `pa`/`pb` salen del pivote, no de un ajuste |
| La línea no se inventa | `validarTramo` recorre **todas** las velas del tramo |
| Cero violaciones en el tramo | `viol === 0` o la línea se descarta |
| Toques reales | se cuentan con tolerancia `tolATR`; el mínimo para maestra es 3 |
| Sin repintar | función pura de las velas de entrada; determinista (test 4) |
| Sin verticales | `|slopeATR| ≤ maxSlopeATR` |
| Techo de cómputo | `maxEvaluaciones` acota los tramos probados |

**Grados**: `A` = ≥3 toques y ≥1 rechazo · `B` = ≥3 toques · `C` = solo anclas
(2 toques, se dibuja discontinuo) · `X` = viola (nunca se devuelve).

## Las 3 marcas

| Rol | Qué es | Color |
|---|---|---|
| `M` | maestra rodante: origen de la tendencia + ancla en el retroceso más reciente que la respeta | verde/rojo según dirección |
| `C` | canal: paralela por el extremo opuesto, mismo tramo que la maestra | ámbar |
| `I` | interna: último impulso (dos pivotes consecutivos), discontinua si solo tiene 2 toques | gris |

Máximo 3. Si `I` o `C` no se pueden verificar, se devuelven menos marcas.

## API

```js
import { analizar, listaDeDibujo } from "./rayas-v2/motor.mjs";

const res = analizar(velas, { tolATR: 0.25 });
// res = { dir, origen, marcas: [...], audit: {...} }
const segmentos = listaDeDibujo(res, { leftBar: 0, rightBar: velas.length - 1 });
// { rol, x1Bar, p1, x2Bar, p2, style, width, colorRole, label, rota, breakBar }
```

`analizar` devuelve marcas con `a/pa` (origen), `b/pb` (ancla), `touches`,
`rejects`, `viol`, `slopeATR`, `grade`, `valid`, `rota`, `breakBar`.
`audit` incluye `dir`, `origen`, `pivotes`, `pasos`, `descartadas`, `motivo`.

### Enchufarlo a la gráfica actual (cuando se decida)

`servidor.js` ya dibuja con una lista plana de segmentos. `listaDeDibujo()` entrega
exactamente eso a partir de `{leftBar, rightBar}`: basta sustituir la fuente de
segmentos por esta llamada; el render no cambia.

## Ajustes

| Clave | Defecto | Para qué |
|---|---|---|
| `tolATR` | `0.25` | tolerancia de toque en ATR; medida sobre 4 símbolos × 4 timeframes |
| `pivL` / `pivR` | `3` / `3` | ventana de pivote |
| `minSpan` | `8` | barras mínimas entre origen y ancla |
| `minMasterSpan` | `60` | barras mínimas para llamar "maestra" a una raya |
| `lookback` | `900` | hasta dónde se busca el origen |
| `maxEvaluaciones` | `12000` | techo determinista de cómputo |
| `closedOnly` | `true` | ignora la vela en formación |

## Estado medido

Sobre los 4 símbolos y 4 timeframes del servidor (`M5/M15/M30/H1`, 719–8594 velas):

- maestra grado A en **16/16** series con `tolATR = 0.25`;
- 2–3 marcas por gráfico;
- 0 violaciones en todas las rayas devueltas;
- análisis entre 1 y ~260 ms por serie.

## Qué NO hace

- No predice ni da señales de entrada: dibuja geometría verificable.
- No usa mechas para anclar (a propósito).
- No repinta hacia atrás ni mueve una raya ya dibujada dentro del mismo juego de velas.
- No escribe en `motor-senales/`, ni cambia `app.js`, `btb-live.js` ni `servidor.js`.
- No usa librerías externas ni servicios.

## Referencias que se tomaron (y qué se copió)

- **LuxAlgo · Trendlines with Breaks**: re-ancla en cada pivote confirmado → el
  ancla rodante de `M`.
- **LuxAlgo · Rolling Trendline (2026)**: la línea solo se mueve cuando el precio
  la respeta; se conserva la anterior al romperse → el criterio de puntuación y
  la rotura sin repintado.
- **jinhae8971/trendline-detector** y **aramic0/TL-Method-Indicator**: mínimo de
  contactos y fuerza por toques → `touches`/`rejects` y los grados A/B/C.
- **coding-kitties/PyIndicators**: cuerpo contra mecha → pivotes de cuerpo.
