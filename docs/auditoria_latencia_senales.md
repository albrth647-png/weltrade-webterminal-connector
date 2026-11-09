# Auditoría profunda — por qué la señal se dispara cuando el movimiento ya pasó

Fecha: 2026-11-09 (segunda pasada) · Alcance: `motor-senales` completo
(cliente MT5 → estrategia híbrida → app → cola de Telegram).
Medición reproducible: `motor-senales/validacion/auditar_profundidad.js`
y `auditar_latencia.js`, sobre las 16 series reales de
`backtest_hibrida/datos/` (4 símbolos × 4 TF, 54.432 velas).

## Veredicto

El retraso **no está en Telegram**. Está en la regla que decide cuándo hay
señal y en tres fugas que rodearon esa regla. Medido: el transporte completo
(cierre de vela → margen 3 s → timer 1 s → cola 1,1 s) suma ~4 s, y el precio
al que se puede entrar al leer el mensaje está a 0,001 ATR del enviado.

Lo que sí explica lo que ves:

1. **Lo único que dispara en el momento del toque —los avisos 2/2R/3/3R— no
   salía del motor** (768 generados en 30 días, 0 emitidos). No es que llegara
   tarde: no existía.
2. **La señal que sí existe (2B/3B) nace después del movimiento**, porque su
   condición es que el quiebre ya haya cerrado la vela. Medido: 15 min (p50)
   en M5, 30 en M15, 90 en M30, 120 en H1 (máx 6 h), y el mensaje llega con
   un precio **1,56 ATR peor** que el cierre de la vela del aviso en el 98 %
   de los casos (máx 4,69 ATR).
3. **La vela real del bróker nunca reemplazaba a la sintética del tick**
   (100 % de las velas en 24 h quedaban clavadas) y no se re-evaluaban: las
   señales que solo existen con el cierre real se perdían para siempre.
4. **Una clave de deduplicación sin temporalidad ni caducidad** borraba en
   silencio 26 de 882 entradas (2,9 %).
5. **Sin guard de frescura** al sembrar/reconectar: una vela vieja se emitía
   como nueva.

## La cadena, eslabón por eslabón

| # | Eslabón | Medido | ¿Causa? |
|---|---|---|---|
| 1 | Tick del bróker → acumulador | instantáneo | no |
| 2 | Cierre de vela local | cierre + 3 s (margen) + 1 s (timer) | no |
| 3 | Decisión (regla de patrón) | 0 s si el patrón nace en esa vela | **sí** (ver C1) |
| 4 | Escaneo de la serie | 51 ms (M5, 8.588 velas) y crece con la historia | **sí, a escala** (ver C5) |
| 5 | Emisión → cola → Bot API | 1,1 s por mensaje, 10 s de timeout | no (pero amplifica) |
| 6 | Precio al leer el mensaje | 0,001 ATR (p50) / 0,035 ATR (p90) | no |

## Las cinco causas

### C1 · Crítica — en el instante del toque no se emite nada

`raptor_core.js:158` crea los toques con `entry: NaN`. En
`estrategia_hibrida.js` el guard de precio se aplicaba **antes** de mirar
`s.kind`, así que `continue` los borraba sin log ni contador.

- 768 avisos 2/2R/3/3R generados en 30 días → **0 emitidos** (hoy: **4/4**
  en el repro por temporalidad).
- Es literalmente «el precio llega a la zona y no me avisan».

**Corregido**: los toques se ramifican por `kind` antes del guard y salen por
un evento propio, `alerta`, con su propio formato (nivel a romper, precio de
referencia) y su propio interruptor (`MS_TELEGRAM_TOQUES=0`, antes
`MS_TELEGRAM_AVISOS=0`; por defecto sí se envían). Ya no comparten
canal con los errores de escaneo.

### C2 · Alta — la entrada B nace después del movimiento

`2B/3B` exigen el quiebre del mínimo de referencia dentro de las 6 velas
siguientes al toque (`maxBarsToBreak: 6`). 198 pares medidos:

| TF | n | p50 | p90 | máx |
|---|---|---|---|---|
| M5 | 137 | 15 min | 25 min | 30 min |
| M15 | 35 | 30 min | 75 min | 90 min |
| M30 | 14 | 90 min | 120 min | 180 min |
| H1 | 12 | 120 min | 300 min | 360 min |

Coste en precio del retardo (mismo par, cierre del aviso → precio del mensaje):

- **1,56 ATR peor** (p50), 0,55 ATR peor en el decil más favorable, 4,69 ATR en el peor caso.
- **98 %** de los mensajes llega con peor precio que en el aviso.
- **19,7 %** llega con el stop (extremo de la vela del toque) ya violado.
- 0,33 ATR de recorrido desde el nivel roto: el quiebre ya se produjo.

Es decir: no es un problema de milisegundos, es que la señal es *otra*
operación distinta de la que el mercado ofrecía en el toque. La única forma de
avisar en el toque es una alerta intrabar, no una entrada confirmada.

### C3 · Alta — la vela sintética del tick se quedaba en la serie para siempre

`onTick` construye la vela con el precio medio (`o` = primer tick) y el timer
la cierra a los 3 s. `app.js` pedía velas con `desde = última + 1 s`, así que
**la vela real del bróker con ese mismo `t` nunca se pedía**, y `unirVelas`
conservaba la vieja. `_evalPorVela` además marcaba ese `t` como evaluado, de
modo que el cierre real tampoco se re-evaluaba.

Medido en 24 h de M5 (288 velas):

| | antes | ahora |
|---|---|---|
| la vela real se pide | 0/288 | **288/288** |
| el búfer conserva la sintética | 288/288 (100 %) | 1/288 (0,3 %) |
| apertura distinta de la real | 287/288 (máx 0,212 ATR) | — |
| cuerpo con signo cambiado | 10/288 (afecta a `bodyBreak`) | — |

En la muestra de 24 h el conjunto de entradas no cambió (11 reales vs 11
sintéticas, 0 perdidas, 0 de más), pero la serie quedaba envenenada de forma
permanente y el patrón que exige cuerpo o cierre real podía desaparecer sin
dejar rastro. Un reinicio a mitad de vela además arrancaba con `o` falso y
`h`/`l` truncados.

**Corregido**: `desde = última` (inclusive) para que el bróker reemplace la
vela; `_evalPorVela` guarda una **firma OHLC** y re-evalúa si los datos
cambian; y la vela en formación del servidor alimenta el acumulador de ticks
(apertura y recorrido reales desde el primer segundo).

### C4 · Alta — deduplicación por `patrón + precio`, sin TF ni caducidad

`_ultimaSenalPorSimbolo` guardaba una sola clave por símbolo y nunca expiraba.
En 30 días: 882 entradas, 856 claves, **26 suprimidas (2,9 %)**, casi todas
porque otra temporalidad había emitido el mismo patrón al mismo precio
(p. ej. `M15 1R @ 118687.24` ya «emitida» por M5).

**Corregido**: la emisión se recuerda por `símbolo | TF | vela | clase |
dirección`. Un mensaje por vela y clase, nunca dos; y ninguna señal legítima
se pisa por coincidir en precio. Poda FIFO a 50.000 claves.

### C5 · Media — el coste de cada cierre crece con la historia y se multiplica

`_evaluar` rehace la estrategia completa sobre toda la serie en cada cierre
(EMAs, ATR, zonas fractales, fases y score). Medido por cierre:

| TF | 25 % de la serie | 50 % | 75 % | serie completa (30 d) |
|---|---|---|---|---|
| M5 | 2,3 ms | 5,6 ms | 4,3 ms | **21–28 ms** (8.588 velas, 858 zonas) |
| M15 | 3,5 ms | 2,3 ms | 1,4 ms | 7,7 ms |
| M30 | 0,2 ms | 0,4 ms | 0,7 ms | 1,4 ms |
| H1 | 0,6 ms | 0,2 ms | 0,3 ms | 1,1 ms |

Un símbolo que cierra sus cuatro TF en el mismo segundo cuesta ~31 ms. El
temporizador de cierre es de 1 s: **con 12 símbolos son 250–335 ms de trabajo**
en ese segundo (según ejecución) y a partir de ~35–47 símbolos el motor
empieza a cerrar velas tarde por su propio peso.

**Corregido**: los dos bucles calientes de `detectarZonas` recorrían todas las
zonas —incluidas las ~860 muertas de un mes de M5— en cada vela. Ahora llevan
un índice vivo (`activas`) y se desentienden de las muertas: **51 → 21–28 ms
por cierre (−45 a −59 %, dos ejecuciones)**, con el mismo resultado bit a bit (paridad Python:
1.650 señales, 0 diferencias, `zonaId` incluido). El array `zonas` se conserva
entero porque sus ids son la identidad que se compara con el backtest.

### C6 · Media — sin guard de frescura: una vela vieja se emitía como nueva

`setHistoria` evaluaba la última vela sembrada sin mirar el reloj. Con la
siembra de 30 días o tras una reconexión, esa vela puede tener horas. Un
reinicio repetía además el mensaje, porque `_evalPorVela` vive en memoria.

**Corregido**: solo se evalúa al sembrar si el cierre es reciente
(`≤ max(2 min, ½ TF)`); lo descartado se cuenta en `stats.velasViejas`.
Repro actual: sembrar 5 velas que el núcleo marca como entrada emite **0/5**
(antes emitía).

## Lo que se ha corregido

### Primera pasada (fontanería de la señal)

| # | Cambio | Criterio | Verificación |
|---|---|---|---|
| 1 | Avisos 2/2R/3/3R por evento `alerta`, ramificando por `kind` antes del guard de precio | el repro emite 1 aviso y 0 entradas | `test_flujo.mjs` 1 · audit B: **4/4** |
| 2 | Guard de frescura al sembrar | vela de hace 3 días → 0 emisiones | `test_flujo.mjs` 2 |
| 3 | Dedup por vela+clase, sin clave global por precio | mismo cierre dos veces → 1 mensaje | `test_flujo.mjs` 3 y 6 |
| 4 | Re-evaluación con firma OHLC + `desde` inclusive | la vela real corrige a la sintética | `test_flujo.mjs` 4 · audit E |
| 5 | `emitidaEn` / `latenciaMs` en el payload y `/estado` | latencia medible desde fuera | `test_flujo.mjs` 5 |
| 6 | La PWA deja de mostrar SL/TP (tarjeta, log, notificación) | coherente con el mensaje | `npm test` |

### Segunda pasada (avisar antes y no perder nada)

| # | Cambio | Criterio | Verificación |
|---|---|---|---|
| 7 | **Aviso intrabar**: al entrar el precio en la banda de una zona activa (M5) sale un mensaje en el tick, sin esperar al cierre. 1 por zona/dirección cada 30 min | el tick dentro de la banda emite 1 aviso y no lo repite | `test_flujo.mjs` 8 |
| 8 | Las zonas activas se cachean en cada cierre (`zonasVigentes`) y se refrescan al sembrar | hay zonas desde el arranque, sin recalcular por tick | `test_flujo.mjs` 8 |
| 9 | **Una entrada por zona y dirección** entre TFs (ventana 30 min) | mismo movimiento → 1 mensaje, no 4 | `test_flujo.mjs` 9 · `stats.suprimidas` |
| 10 | **Cola Telegram** con dos carriles (entrada > aviso), 1,1 s entre arranques, timeout 4 s y sin bloqueo en cabeza | 3 envíos con prioridad: la entrada primero, todos entregados | `test_flujo.mjs` 11 |
| 11 | **Outbox persistente** (`.outbox.json`, escritura atómica): pendientes de entrega + claves ya emitidas | reinicio no repite ni pierde | `test_flujo.mjs` 10 |
| 12 | `message_id` y estado de la cola en el log y en `/estado` (`telegram.enviados/fallos/pendientes`, `outbox`) | trazabilidad de cada entrega | `test_flujo.mjs` 11 |
| 13 | **Siembra TF-major**: primero el M5 de todos los símbolos, después M15/M30/H1; espaciado 350 → 200 ms | todos los símbolos con M5 antes de seguir con el resto | revisión + `arranque.log` |
| 14 | Coste por cierre 51 → 21–28 ms (índice vivo de zonas) | mismo resultado, menos trabajo | paridad 1.650/0 · audit A |

**Verificación global**: `npm test` → **77 + 38 = 115 OK, 0 fallos**;
paridad con Python **1.650 señales, 0 diferencias**; `node --check` limpio en los
8 ficheros Node.

## Lo que queda abierto (no es latencia)

| # | Hallazgo | Estado |
|---|---|---|
| 1 | `validar_reglas.js` marca **351 de 1.650** señales (21,3 %) por R02 «cierre demasiado lejos de EMA30». No lo introducen estos cambios: la paridad con el volcado de Python es exacta campo a campo, así que el conjunto de señales es el mismo de antes. Es una discrepancia entre lo que hace el núcleo (`maxDistAtr: 2.0`) y lo que exige la lista de reglas | abierto — toca la estrategia, no la fontanería: o se relaja R02 o se filtra en el núcleo, y eso cambia las señales en vivo |
| 2 | `core.scan` recalcula toda la serie en cada cierre (EMAs, ATR y pivotes son incrementales, pero el escaneo no) | optimizado el 59 %; el siguiente paso es escanear solo la cola, y eso sí exige tocar el núcleo validado |
| 3 | La siembra no se puede paralelizar de verdad: `cmd 11` no identifica el símbolo en la respuesta y el cliente serializa a propósito | ordenado TF-major; el paralelismo exigiría cambiar el protocolo |

## Reproducir

```bash
cd motor-senales
node validacion/auditar_profundidad.js   # A–F: coste, avisos, dedup, precio, vela, frescura
node validacion/auditar_latencia.js      # retardos por TF y hueco de transporte
node validacion/comparar.js validacion/py.json   # paridad con Python: 1.650 / 0 difs
node validar_reglas.js                   # etiquetas contra las reglas del catálogo
npm test                                 # 115 OK
```

Los scripts usan `backtest_hibrida/datos/*.csv` (gitignored) y las mismas
`hibridaParams` que el motor en vivo. `test_flujo.mjs` no necesita datos
externos: genera una serie determinista, ancla la vela de prueba a «hace 30 s»
y simula el Bot API con un `fetch` falso (sin red).


## 6. Entrega en dos etapas (aplicado el 2026-11-09)

El retardo medido no era de transporte: cierre → margen 3 s → timer 1 s → cola
1,1 s ≈ **4 s**, con 0,001 ATR (p50) de precio perdido. Lo que llegaba tarde era
la **decisión**, porque la entrada se confirma al cierre de la vela del
rompimiento: 10 min (p50) en M5, 30 en M15, 60 en M30 y 120 en H1 desde el toque
(443/122/62/42 casos; máximos 30/90/180/360 min). El precio recorrido en ese
hueco: 0,04 ATR (p50), 0,41 (p75), 0,87 (p90).

Cambios:

1. **Etapa 1 intrabar encendida** (`MS_AVISO_INTRABAR`, antes opt-in): en el
   tick en que el precio entra en la banda de una zona M5 sale «NIVEL EN JUEGO»,
   con bid/ask reales y la distancia en ATR, una vez por zona y dirección cada
   30 min.
2. **Carril urgente** (`urgente.js`): push ntfy con prioridad `urgent` para las
   entradas y `high` para la etapa 1, más alarma local en el PC (BEL o
   `MS_ALARMA_CMD`). No pasa por Firebase, que es lo que retrasa las
   notificaciones en Android. Telegram queda como registro e historial.
3. **Filtro de temporalidades** (`MS_TF_VIVO`, por defecto `M5`): las señales de
   M15/M30/H1 se siguen calculando y quedan en consola y `/estado`, pero no se
   envían: llegaban con el movimiento hecho.
4. **Contadores**: `/estado` publica `entrega` (TF activas, filtradas, intrabar)
   y `urgente` (ntfy configurado, enviados, fallos).

Pendiente y fuera del alcance del bot: **ejecutar**. La única forma de no llegar
tarde del todo es dejar una orden stop en el nivel (entra sin que nadie mire) o
entrar en el retesteo; este proyecto solo avisa, no opera.

Verificación: `node test_urgente.mjs` (20 comprobaciones, incluido un POST real
contra un servidor local) dentro de `npm test`.
