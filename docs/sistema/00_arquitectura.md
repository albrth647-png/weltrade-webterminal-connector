# Arquitectura — Escáner de Tendencia + Memoria de Marcaciones

**Fecha:** 2026-11-12 · **Estado:** F0 ejecutada (playbooks + linter verde), sin cambios de comportamiento
**Ámbito:** `motor-senales/` (Node ≥ 22, sin dependencias npm) y `docs/sistema/`
**Decisión que resuelve:** cómo hacer que el sistema detecte la tendencia rápido y
que aprenda a marcar como marca el propietario, usando documentos `.md` como
referencia y memoria de casos, sin convertir el motor en una caja negra.

---

## 0. Resumen en cinco frases

1. La tendencia se detecta con un **embudo determinista de 5 etapas** (régimen →
   estructura → niveles → evento → alineación multitemporal), con **histéresis**
   para no parpadear y cálculo **incremental por vela cerrada**.
2. Cada marca manual del usuario se guarda como un **caso** con su *huella*
   (geometría + contexto de mercado normalizado), no como una línea suelta.
3. Las reglas viven en **playbooks `.md`** con frontmatter legible por máquina;
   el código las referencia por `id`, y un linter impide que documento y motor
   se separen.
4. El "aprendizaje" es **CBR + inducción de umbrales offline**: se recuperan los
   casos parecidos, se propone un cambio de regla, se valida contra casos no
   vistos y **solo el propietario lo aprueba**.
5. **Sin LLM**: la explicación se genera con plantillas deterministas a partir
   de reglas y vecinos. El propietario lo descartó el 2026-11-12.

---

## 1. Diagnóstico: qué hay y qué falta

| Pieza | Estado | Consecuencia |
|---|---|---|
| `rayas.js` | Fan de 3 patas, origen único, cambio/engaño/toque, cierre + margen ATR | Detecta, pero **no aprende** de las correcciones |
| `nucleo.js` | Catálogo Yoel (1/2/3 y R) + Estructura M5, escaneo puro | Sólido y determinista, pero **sin estado de tendencia explícito** |
| `servidor.js` | `/salud`, `/estado`, `/velas`, `/grafica` | La herramienta manual existe y funciona |
| Marcas manuales | `localStorage["manualLines:<símbolo>:<TF>"]` | **Se pierden** al limpiar el navegador y **no alimentan al detector** |
| Documentación | `docs/estrategia/*.md` en prosa | Rica, pero **no verificable por código** ni enlazada a parámetros |
| Escáner | No existe como tal | El motor evalúa 4 TF, pero no publica un estado de tendencia |

El hueco real no es "más indicadores": es que **el conocimiento del propietario
está en su cabeza y en líneas que el motor ignora**. La arquitectura va de eso.

---

## 2. Principio rector: cuatro capas con una sola fuente de verdad

```
   ┌────────────────────────────────────────────────────────────┐
   │ 4. EXPLICACIÓN (plantillas deterministas)                  │
   │    cita reglas y casos · nunca decide                      │
   ├────────────────────────────────────────────────────────────┤
   │ 3. POLÍTICA — docs/sistema/*.md (playbooks versionados)    │
   │    umbrales, excepciones, ejemplos, checks                 │
   ├────────────────────────────────────────────────────────────┤
   │ 2. MEMORIA — casos.jsonl + recuperación k-NN (CBR)         │
   │    huella normalizada · etiqueta · resultado               │
   ├────────────────────────────────────────────────────────────┤
   │ 1. HECHOS — escáner + niveles + fan (determinista, puro)   │
   │    mismas velas → mismos números, siempre                  │
   └────────────────────────────────────────────────────────────┘
```

Regla de oro: **ninguna capa automática escribe la política sin aprobación
humana**. La capa 1 no depende de red, modelo ni estado oculto.

---

## 3. Capa 1 — Escáner de Tendencia (`escaner.js`)

**Para qué sirve:** solo para que el sistema **sepa la tendencia mientras el
propietario marca**. No genera avisos, no envía a Telegram, no filtra las señales
que ya existen. Es contexto de marcación, no un generador de entradas.

### 3.1 Embudo de 5 etapas (de más barata a más cara)

| Etapa | Qué calcula | Coste | Salida |
|---|---|---|---|
| E0 Régimen | ATR%, percentil de volatilidad, sesión | O(1) | `volatilidad: baja/normal/alta` |
| E1 Fuerza | ER de Kaufman, R², pendiente en ATR, ADX(14) | O(N) ventana | `fuerza: 0..1` |
| E2 Estructura | Pivotes confirmados k=3 → HH/HL o LH/LL; fan | O(N) | `estructura: alcista/bajista/rango` |
| E3 Niveles | clústeres de pivotes, confluencias, estado | O(pivotes) | `niveles[]` |
| E4 Alineación | matriz MTF + jerarquía H1→M30→M15→M5 | O(4) | `scoreMTF ∈ [-1,1]` |

Solo se evalúa **vela cerrada**. Nada de ticks a medio formar: eso es lo que
produce señales que aparecen y desaparecen.

### 3.2 Fórmulas (todas en unidades ATR, sin números mágicos en el código)

```
ER(n)   = |C_t − C_{t−n}| / Σ|C_i − C_{i−1}|            ∈ [0,1]
R²      = 1 − SS_res / SS_tot   (regresión lineal de C sobre i)
pendAtr = b / ATR_t              (b = pendiente de la regresión)
recorrAtr = b · n / ATR_t
ADX     = Wilder(14) sobre +DM/−DM
posDon  = (C_t − minLow(n)) / (maxHigh(n) − minLow(n))
```

Interpretación: `ER` mide cuánto del recorrido fue dirección y cuánto fue ruido;
`R²` mide si una recta explica la ventana; `pendAtr` permite comparar M5 con H1
sin mezclar escalas. Los tres juntos son más difíciles de engañar que uno solo
(ver §9: la evidencia 2026 muestra que ADX/ER/Hurst aislados tienen límites
medibles en detectar *whipsaw*).

### 3.3 Máquina de estados con histéresis

```
RANGO ──(ER≥0.35 ∧ R²≥0.55 ∧ ADX≥22 ∧ pila EMA alineada, 2 velas)──▶ TENDENCIA
TENDENCIA ──(ER<0.22 ∨ ADX<16 ∨ rotura de pila, 3 velas)──▶ DEBIL
DEBIL ──(recupera)──▶ TENDENCIA      DEBIL ──(sigue flojo)──▶ RANGO
TENDENCIA ──(dist. a EMA50 > 2.5·ATR ∧ divergencia de pivotes)──▶ AGOTAMIENTO
```

- Umbrales de **entrada ≠ salida** (histéresis): evita 20 cambios de estado por hora.
- **Confirmación de 2 velas** y **cooldown de 5 velas** tras un cambio.
- `AGOTAMIENTO` no invierte la tendencia: solo baja la confianza y bloquea entradas
  a favor hasta que la estructura se rehaga.
- Todo umbral va en el frontmatter del playbook (`10_escaner_tendencia.md`), con
  marca `[EST]` mientras no esté calibrado con datos.

### 3.4 Matriz multitemporal (no "confluencia" decorativa)

| TF | Peso | Qué aporta | Uso |
|---|---|---|---|
| H1 | 0.40 | sesgo de fondo | veto de contra-tendencia |
| M30 | 0.30 | contexto | dirección preferida |
| M15 | 0.20 | setup | dónde buscar |
| M5 | 0.10 | gatillo | cuándo |

`scoreMTF = Σ peso_i · signo_i · fuerza_i`, y además `alineacion = nº de TF que
coinciden`. Dos gates distintos:

- **Gate de marcación** (el único que se usa): no exige alineación; marca también
  el contra-tendencia, pero lo etiqueta como tal.
- **Gate de señal**: queda **sin uso** en esta fase. El escáner no avisa ni envía:
  solo da contexto cuando el propietario está marcando.

Esto separa "saber la tendencia" de "avisar", que hoy están mezclados.

### 3.5 Rendimiento

- Arranque: un barrido de las 16 series (4 activos × 4 TF) una sola vez.
- En vivo: **O(1) amortizado** por vela cerrada y serie; se cachean ER/ADX/ATR y
  solo se recalcula la ventana móvil.
- Objetivo medible: **p95 ≤ 5 ms** por cierre de vela y serie, `/escaner` ≤ 50 ms
  para las 16 series. Si no se cumple, se recorta la ventana, no la calidad.
- Sin dependencias: todo con `Array` y aritmética; nada de librerías de indicadores.

---

## 4. Capa 1b — Libro de Niveles (`niveles.js`)

El usuario dijo "marcaciones según sus niveles". Un nivel no es una línea: es un
**clúster con historia**.

```
nivel = {
  id, precio, tipo: pivote|redondo|maxDia|minDia|ema|pataFan,
  toques, primerToque, ultimoToque,
  estado: virgen|probado|roto,
  confluencias: [ids], score
}
```

- Agrupar pivotes con tolerancia **±0.35 ATR**; fusionar por cercanía.
- `score = Σ exp(−edad / vidaMedia) · (1 + 0.25·(toques−1)) + 0.5·confluencias`
  con `vidaMedia = 200` velas `[EST]`.
- `roto` cuando dos cierres superan el nivel por **0.5 ATR** (no una mecha).
- Cada marca manual y cada pata del fan **referencian `nivelId`**: así el caso
  sabe *por qué* se marcó ahí y no dos velas antes.

---

## 5. Capa 2 — Memoria de Marcaciones (`casos.js`)

### 5.1 Un caso, no una línea

```json
{
  "id": "c-2026-11-12-0001",
  "v": 1,
  "origen": { "tipo": "manual", "autor": "yoel", "creado": "2026-11-12T01:40:00Z" },
  "mercado": { "simbolo": "FX Vol 20", "tf": "M30", "t": 1762905600000 },
  "geometria": {
    "tipo": "trend", "i1": 834, "i2": 1203,
    "p1": 116068.47, "p2": 114736.13,
    "pendAtr": -0.041, "largo": 369, "toques": 3,
    "anclaje": "cierre", "cuerpo": true, "extension": "derecha"
  },
  "huella": {
    "er20": 0.31, "r2": 0.72, "adx14": 24.1,
    "atrPct": 0.58, "pilaEma": "bajista", "estructura": "LH-LL",
    "scoreMTF": -0.62, "posDon": 0.18,
    "niveles": [ { "id": "lv-17", "distAtr": 0.12, "toques": 4 } ],
    "sesion": "EU", "dow": 2
  },
  "etiqueta": {
    "estado": "aprobado",
    "resultado": "mantiene",
    "mfeAtr": 2.1, "maeAtr": 0.4, "velasHastaRuptura": 37
  },
  "checks": ["R01", "R05", "R11"],
  "playbook": "rayas.abanico@2"
}
```

- **La huella se calcula al guardar**, no al leer: la retención de `.estado.json`
  es de 30 días y un caso antiguo perdería su contexto.
- `resultado` se rellena después (etiqueta débil): a las N velas se mide MFE/MAE
  en ATR y si la raya aguantó. Sin resultado, el caso sirve para **estilo**, no
  para **eficacia**.
- `estado`: `borrador | aprobado | rechazado`. Solo `aprobado` entra en la
  recuperación. Esto evita envenenar la memoria con marcas de prueba.

### 5.2 Recuperación por similitud (CBR, no embeddings)

Distancia **Gower ponderada** sobre la huella (numéricos normalizados por rango
intercuartílico; categóricos = 0/1), con pesos en el frontmatter del playbook:

```
d(a,b) = Σ w_f · δ_f(a,b) / Σ w_f
```

- Top `k = 8`, con **decaimiento temporal** (`exp(−Δdías/90)`) y preferencia por
  el mismo símbolo y TF (penalización si no coinciden).
- Se exige **solo pasado**: un caso con `t` posterior al de la consulta nunca se
  recupera. Es la fuga de información más fácil de cometer y la más cara.
- La sugerencia se explica sola: *"3 de los 5 casos más parecidos anclaron en el
  cierre del pivote, no en la mecha"*. Eso es auditable; un embedding no.

Base de evidencia: CBR geométrico y similitud de series temporales financieras
muestran que la forma importa más que la distancia euclídea cruda
(§9). Aquí la "forma" es la huella normalizada, no un vector de 768 dimensiones.

### 5.3 Almacenamiento

- `motor-senales/datos/casos.jsonl` — **append-only**, una línea por caso.
- Índice en memoria al arrancar (miles de casos: trivial).
- Sin base de datos, sin servidor extra. Si algún día pasa de ~100k casos, se
  particiona por símbolo/TF; no antes.
- Export/import JSON ya existe en `/grafica`; se conserva como respaldo manual.
- `casos.jsonl` **no caduca** con los 30 días: la retención es de velas y
  `.estado.json`. El caso guarda su huella al crearse y sigue siendo válido sin
  las velas antiguas.

---

## 6. Capa 3 — Playbooks `.md` (el contrato)

### 6.1 Árbol propuesto

```
docs/sistema/
  README.md                     índice + cómo se aprueba un cambio
  playbooks/                    REGLAS (política; no crecen solas)
    00_principios.md            qué es una marca válida y qué no
    10_escaner_tendencia.md     estados, umbrales, histéresis, pesos MTF
    20_rayas_abanico.md         origen, patas, anclaje en cierre, re-anclaje
    30_toques_rupturas.md       cuerpo, margen ATR, ventana, engaño
    40_niveles_confluencias.md  clústeres, puntuación, veto por nivel
    50_validacion.md            métricas, checks, criterios de aceptación
    60_yoel_catalogo.md         catálogo 1/2/3/R/B y condiciones
    70_estructura_m5.md         impulso, retroceso, quiebre en M5
  aprendizajes/                 LO APRENDIDO (crece con cada marca)
    README.md                   cómo se anota y cuándo se abre un tema nuevo
    _plantilla.md               esqueleto para un tema nuevo
    tendencia.md                escáner, estados, MTF
    rayas.md                    abanico, origen, patas, re-anclaje
    toques.md                   toque, cuerpo, margen, ventana, engaño
    niveles.md                  clústeres, confluencias, reacciones
    marcacion.md                cómo marca el propietario y por qué
  casos/                        FICHA individual de cada marca
    2026-11-12_fxvol20_m30.md   captura, contexto, veredicto, caso.jsonl
  changelog.md
```

Los tres niveles no se mezclan: **playbook = la regla**, **aprendizaje = lo que
se ha entendido de tus marcas**, **caso = la marca concreta**. Así se puede
añadir un tema nuevo (por ejemplo `divergencias.md`) sin tocar los demás.

### 6.2 Frontmatter legible por máquina

```yaml
---
id: rayas.abanico
version: 2
estado: activo
aplica: { tf: [M5, M15, M30, H1], simbolos: ["*"] }
parametros:
  k: 3
  margenAtr: 0.10
  ventana: 6
  minToquesFan: 0
pesosHuella:
  er20: 1.0
  pendAtr: 1.5
  estructura: 1.2
  scoreMTF: 0.8
checks: [R01, R05, R11]
casos: [c-2026-11-12-0001]
---
```

El cuerpo explica el **porqué** y los casos límite; el frontmatter es lo que el
código puede verificar. Un `id` citado por el código que no exista en un playbook
**rompe el build**: es la forma de que la documentación no envejezca.

### 6.3 Linter (`validar_playbooks.mjs`)

- Frontmatter válido (tipos, rangos, `id` único).
- Todo `id` usado en `rayas.js`/`escaner.js`/`niveles.js` existe y está `activo`.
- Todo `check` tiene al menos un fixture en `test_*.mjs`.
- Todo `caso` referenciado existe en `casos.jsonl`.
- `parametros` del `.md` = `PARAMS` efectivos del código (o diferencia declarada).
- Falla con exit ≠ 0 y dice **archivo:línea**.

Sin esto, los `.md` son decoración; con esto, son parte del motor.

---

## 7. Capa 4 — Bucle de aprendizaje (sin auto-modificación)

```
  marcar en /grafica
        │  (guardar en memoria)
        ▼
  caso + huella  ──▶  recuperación k-NN  ──▶  sugerencia (línea fantasma)
        │                                            │
        │                                   aceptar / corregir
        ▼                                            ▼
  casos.jsonl  ◀──────────────────────────  caso nuevo (aprobado)
        │
        ▼  offline, programado
  aprender.mjs: 70% pasado / 30% futuro
        │  propone umbral o excepción (árbol de decisión simple / rejilla)
        ▼
  propuestas.md  ──▶  revisión humana  ──▶  edición del playbook
        │                                            │
        └──────────  validar:marcas  ◀───────────────┘
                  (replay: acuerdo y no regresión)
```

Reglas del bucle:

1. **Nunca automático.** El sistema propone; el propietario aprueba.
2. **Mínimo 30 casos** por regla para proponer un cambio; si no, solo recuperación.
3. **Split temporal**, no aleatorio: entrenar con lo viejo, validar con lo nuevo.
4. **No regresión**: si el acuerdo con las marcas del holdout baja > 2 puntos, la
   propuesta se rechaza aunque mejore el train.
5. **Versionado**: cada caso guarda `playbook: id@version`; al cambiar reglas se
   puede reconstruir qué se habría marcado antes.
6. **Sin reescribir la historia**: `casos.jsonl` es append-only; corregir un caso
   añade una versión, no borra la anterior.

### 7.1 Qué se considera "aprender"

| Nivel | Técnica | Cuándo |
|---|---|---|
| A | Recuperar casos parecidos y mostrarlos | desde el primer día |
| B | Ajustar umbrales por rejilla con holdout | ≥ 30 casos/regla |
| C | Árbol de decisión legible (3-5 reglas) sobre la huella | ≥ 200 casos |
| D | Ranking por *gradient boosting* | solo si C se queda corto y hay datos |

Se empieza por A. C y D **no** sustituyen la política: la ordenan.

---

## 8. Explicación sin LLM (decisión del propietario)

**Descartado el 2026-11-12.** No hay modelo en ninguna capa, ni local ni remoto:
ni dependencias, ni claves, ni latencia, ni no determinismo. La fase F5 se elimina.

La explicación de una marcación se redacta con **plantillas deterministas** sobre
datos ya calculados:

```
"Anclaste en el cierre del pivote (i=412). Contexto: ER 0.41 · ADX 27 ·
 pila EMA alcista · M30 y H1 a favor. Vecinos: 3 de 5 marcaron igual,
 2 anclaron en la mecha (más conservador)."
```

Reglas de la plantilla:

- Solo inserta **números ya calculados** y **ids existentes**; no redacta libre.
- Si no hay vecinos, dice `sin casos parecidos todavía` (ver §13.1).
- Si los vecinos se contradicen, lo dice y marca `revisar`.
- Cada frase es trazable a un campo del caso o del playbook; nada se inventa.

La misma información se muestra en `/grafica` junto a la línea, sin llamada de red.

---

## 9. Evidencia 2026 en la que se apoya (y qué implica)

| Fuente | Hallazgo | Implicación aquí |
|---|---|---|
| [Agent Skills spec](https://agentskills.io/specification) · [skill.md](https://skill.md/) | Divulgación progresiva: índice → sección → referencia, cargado bajo demanda | Estructura de playbooks con frontmatter + índice |
| [Latentism, oct-2026](https://latentism.com/blog/agent-memory-vs-rag-vs-long-context) | < 20k tokens: caché del corpus entero cuesta menos que RAG; RAG solo compensa a escala | Sin base vectorial; playbooks cacheados |
| [Vectorless RAG, oct-2026](https://blog.dailydoseofds.com/p/rag-vs-vectorless-rag-clearly-explained) | Corpus pequeños y estructurados: navegar por árbol supera a trocear | Documentos por secciones, referenciables |
| [arXiv 2608.27734](https://arxiv.org/pdf/2608.27734v1) | Capa de auditoría determinista que **rechaza** planes; el LLM no se autoaprueba | `validar:marcas` como gate, no como consejo |
| [arXiv 2607.28840](https://arxiv.org/pdf/2607.28840) | El juez LLM no es fuente de verdad; rúbricas operativas y auditables | Evaluar con marcas reales, no con opinión del modelo |
| [SSRN 7292518](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=7292518) | ADX/ER/Hurst/Bollinger aislados tienen límites medibles para *whipsaw* | Combinar fuerza + estructura + niveles, con histéresis |
| [LuxAlgo MTF](https://www.luxalgo.com/library/concept/mtf-alignment-and-confluence-scoring) · [TradingView 2026](https://www.tradingview.com/script/vTLylY32-Multi-Confluence-Signal-Engine-MarkitTick) | Matriz TF×estado y score compuesto con gates y cooldown | `scoreMTF` + gates separados |
| [CBR geométrico](https://www.mdpi.com/2071-1050/12/17/7124) · [similitud de series](https://arxiv.org/html/2107.03926v1) | La forma y el cambio de features importan; k-NN con distancia aprendida | Huella normalizada + Gower, no embedding de texto |

Lo "último del mercado" no es un indicador nuevo: es **arquitectura** —
determinista para decidir, documentada para auditar, con retrieval/casos para
recordar y plantillas para explicar. Sin modelo generativo.

---

## 10. Fases, entregables y criterios de aceptación

| Fase | Entregable | Criterio de aceptación | Riesgo |
|---|---|---|---|
| **F0** Documento y linter | `docs/sistema/` + `validar_playbooks.mjs` | 0 cambios de comportamiento; linter verde; cada regla actual mapeada a un `id` | ninguno |
| **F1** Memoria | `POST /marcas`, `GET /casos`, `casos.jsonl`, botón "Guardar en memoria" | 100% de marcas guardadas con huella; sobrevive a recarga y reinicio; append-only | bajo |
| **F2** Escáner | `escaner.js`, `/escaner`, panel en `/grafica` | determinista (misma entrada → misma salida); p95 ≤ 5 ms/cierre; `/escaner` ≤ 50 ms; Telegram intacto | medio |
| **F3** Sugerencia | k-NN + línea fantasma + aceptar/corregir | 3 vecinos citados; acuerdo base medido; nada se dibuja sin aceptar | medio |
| **F4** Inducción | `aprender.mjs`, `propuestas.md`, replay | propuestas solo; holdout sin regresión > 2 pp; aprobación humana | alto (sobreajuste) |
| ~~**F5** LLM offline~~ | **descartado por el propietario** el 2026-11-12 | — | — |

Orden recomendado: **F0 → F1 → F2 → F3**. F4 solo si F3 demuestra que la memoria
recupera bien. F5 no se hace.

### 10.1 Qué NO se toca en F0-F2

- `escanear()` y `escanearEstructura()` no cambian.
- Los envíos de Telegram no cambian (mismo formato, mismos disparadores).
- `soloRayas` sigue por defecto.
- Sin dependencias nuevas.

---

## 11. Métricas (antes de hablar de rentabilidad)

| Métrica | Cómo se mide | Objetivo inicial |
|---|---|---|
| Latencia | p50/p95 por cierre de vela, 16 series | p95 ≤ 5 ms |
| Acuerdo con el usuario | extremos a ≤ 0.25 ATR y pendiente a ≤ 15° | ≥ 70% en holdout |
| Cobertura | % de marcas del usuario que el sistema habría sugerido | ≥ 60% |
| Estabilidad | cambios de estado de tendencia por día y TF | ≤ 6 |
| Ruido | avisos por día antes/después | no aumentar |
| Utilidad | MFE/MAE en ATR de los casos aprobados | solo descriptivo al inicio |

Ninguna de estas métricas autoriza a decir "gana dinero". La etiqueta dice *qué
jugada es*, no que sea rentable.

---

## 12. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Sobreajuste a 20 marcas | mínimo 30/regla, split temporal, holdout |
| Fuga de información (mirar el futuro) | huella solo con velas `t' ≤ t`; test que lo verifica |
| Memoria envenenada | `estado` borrador/aprobado/rechazado; procedencia |
| Documento y código divergen | linter con `id` obligatorio y comparación de parámetros |
| Pérdida de localStorage | sincronización al servidor con token; export JSON |
| Explicación que inventa | plantillas con datos calculados; sin generación libre |
| Arranque en frío (sin casos) | el sistema no sugiere nada hasta tener casos propios |
| Complejidad prematura | F0-F2 no añaden dependencias ni tocan el motor |

---

## 13. Decisiones del propietario

| # | Decisión | Estado |
|---|---|---|
| 1 | Memoria en **servidor** (`casos.jsonl` + token) | **aprobado** |
| 2 | Escáner como **panel de contexto para marcar**, sin avisos | **aprobado** |
| 3 | Aprobación de reglas **siempre manual** | **aprobado** |
| 4 | **LLM** | **rechazado** el 2026-11-12; F5 eliminada |
| 5 | Retención **30 días**, igual que el sistema actual | **aprobado** |

Decisiones cerradas. F0 puede ejecutarse sin más preguntas.

### 13.1 Arranque en frío: todo vacío hasta que el propietario marque

Decisión del propietario: **no hay ejemplos sintéticos ni casos de relleno**. La
memoria empieza en cero y solo crece con marcas reales hechas en `/grafica`.

| Elemento | Estado inicial | Qué lo llena |
|---|---|---|
| `casos.jsonl` | no existe; se crea al guardar la 1.ª marca | botón «Guardar en memoria» |
| Vecinos k-NN | 0 | cada marca guardada |
| Sección «Ejemplos» de cada playbook | vacía, con marcador `<!-- sin casos -->` | referencias `caso:<id>` |
| Propuestas de regla (F4) | bloqueadas | ≥ 30 casos de la misma familia |
| Explicación | «sin casos parecidos todavía» | plantilla con hechos, sin adornos |

Consecuencias de diseño:

- **k-NN con 0 vecinos no sugiere nada**: devuelve `confianza: 0` y
  `motivo: "memoria vacía"`. Nunca rellena con parecidos falsos.
- La **línea fantasma (F3)** no aparece hasta tener al menos 3 vecinos
  aprobados de la misma familia.
- Los **umbrales del escáner** llevan marca `[EST]` hasta que haya datos; el
  estado de tendencia se calcula igual, pero la confianza se declara estimada.
- El linter **acepta secciones vacías** (es el estado normal al principio) y solo
  falla si un `caso:<id>` citado no existe en `casos.jsonl`.
- Nada se autogenera para «probar» el sistema: las pruebas usan velas sintéticas
  en memoria y **nunca escriben** en `casos.jsonl`.
