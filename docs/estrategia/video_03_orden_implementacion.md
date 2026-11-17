# Vídeo 03 — Orden de implementación

**Fecha:** 2026-11-16
**Estado:** **Fases 0, 1, 2 y 3 completadas.** Fases 4–5 pendientes.
**Alcance:** solo la estrategia del vídeo 03. No se toca Rayas, ni el escáner, ni
BodyTrend.
**Regla de oro:** toda señal que se emita debe mirar EMA30, EMA50 y EMA100 en la
vela del gatillo. El bot avisa; el operador decide la entrada.

---

## 0. Herramientas cargadas

### Skills

| Skill | Para qué se usó |
|---|---|
| `verification-loop` | Gates de build/tests/diff después de cada fase. |
| `terminal-ops` | Ejecución con evidencia: comando, salida y estado exacto. |
| `backtesting-trading-strategies` | Marco de métricas R/PF del laboratorio; no se instala nada. |
| `safety-guard` | Backups, parada/arranque de producción y rollback. |

### MCP y herramientas del repo

- **Longhand MCP** (`.mcp.json`): consultado por su CLI antes de actuar con
  `longhand recall "video 03 regla de oro EMAs..."` y
  `longhand search "Estructura puerta EMA 2/3 PATRONES_AVISO"`.
  Contexto recuperado: la estrategia es **solo el vídeo 03**; no mezclar con el
  02; `2/3` son entradas al toque; el motor ya tiene EMAs en Raptor.
- **Herramientas del repo:** `npm test`, `node test_estructura.mjs`,
  `node v03-lab/evaluar.mjs`, `node auditoria_destructiva.mjs`, `git status`,
  `ps`, `npm`/`node` del proyecto.
- **MCP no aplicables:** no hay MCP de trading ni de MT5; los datos salen del
  motor vivo y de los CSV de `backtest_hibrida/datos/`.

---

## 1. Principios de ejecución

1. **Una fase por vez.** Si el gate de una fase falla, no se pasa a la siguiente.
2. **No inventar reglas.** La única puerta nueva es la EMA en la vela del
   gatillo. No se añaden umbrales, distancias, anti-rango ni bloqueos.
3. **No cambiar el toque de Raptor.** El toque actual ya permite apoyarse entre
   EMA30 y EMA50 y no perder EMA50; es lo que dice la guía.
4. **No cambiar el cuerpo ni el retesteo.** `cuerpoSoloUno:false` y
   `modo2B:'retesteo'` se quedan.
5. **Backups antes de editar.** `nucleo.js` no está en git; el `.bak` es
   obligatorio.
6. **La producción no se reinicia** hasta que tests y laboratorio estén verdes.

### 1.1 Verificación contra el orden del propietario

El documento coincide con el orden pegado en: fases 0–5, helper EMA, puerta en
el quiebre y en el toque `2E/3E`, reset de la jugada no alineada, no tocar
`tolToqueAtr`/`cuerpoSoloUno`/`modo2B`/toque de Raptor, `2/3/2R/3R` a
`ENTRADAS`, `PATRONES_AVISO` solo con `2E/3E`, auditoría P10, comparación de
laboratorio, H1 existente y rollback.

Añadidos justificados, sin cambiar la estrategia:

- `test_estructura.mjs` se ejecuta aparte porque `npm test` no lo incluye.
- `v03-lab/estructura.mjs` mide Estructura porque `evaluar.mjs` solo mide Raptor.
- El helper incluye el guard `e30/e50/e100 > 0`. Sin él, `null` se convierte en
  `0` y la puerta dejaba pasar eventos `LATERAL` al inicio de la serie. Es una
  corrección técnica, no una regla nueva.

---

## 2. Fase 0 — Base congelada (COMPLETADA)

### 2.1 Backups

```bash
cd motor-senales
cp -p nucleo.js nucleo.js.bak
cp -p app.js app.js.bak
```

| Archivo | Tamaño | Estado |
|---|---:|---|
| `nucleo.js.bak` | 57.566 bytes | creado |
| `app.js.bak` | 34.972 bytes | creado |

### 2.2 Tests base

```bash
cd motor-senales
npm test
node test_estructura.mjs
```

| Suite | Resultado | Exit |
|---|---|---|
| `npm test` | **42 / 92 / 16 / 28 / 24 / 22, cero fallos** | 0 |
| `test_estructura.mjs` | **16 OK / 0 fallos** | 0 |

> `npm test` **no incluye** `test_estructura.mjs`. Es la suite del motor que se
> va a tocar en la Fase 1; por eso se ejecuta aparte y es obligatoria.

### 2.3 Laboratorio base (Raptor)

```bash
cd /root/weltrade-webterminal-connector
node v03-lab/evaluar.mjs
cp v03-lab/reporte.md v03-lab/reporte_base.md
cp v03-lab/reporte.json v03-lab/reporte_base.json
```

- **16 series · 54.432 velas · 1.529 señales · 1.510 simulables.**
- Catálogo completo: **−0,107 R**, acierto 37,7 %, PF 0,82.
- Solo roturas: **+0,070 R**, PF 1,15.
- Solo toque (`2/2R/3/3R`): **−0,186 R**, PF 0,72.
- Señales sin riesgo válido (stop = entrada): 14.

Artefactos: `v03-lab/reporte_base.md`, `v03-lab/reporte_base.json`.

### 2.4 Foto base de Estructura

`v03-lab/evaluar.mjs` solo mide Raptor. Para la puerta de Estructura se midió
aparte con las mismas 16 series, con el script reutilizable
`v03-lab/estructura.mjs`:

```bash
node v03-lab/estructura.mjs > v03-lab/estructura_base.json
```

| Métrica | Base |
|---|---:|
| Series | 16 |
| Eventos Estructura | **1.822** |
| `1E` | 406 |
| `1ER` | 360 |
| `2E` | 298 |
| `2ER` | 262 |
| `2EB` | 129 |
| `2EBR` | 115 |
| `3E` | 94 |
| `3ER` | 81 |
| `3EB` | 37 |
| `3EBR` | 40 |

Filtros base: `sinImpulso` 80.531 · `sobreTecho` 1.066 ·
`retrocesoInvalido` 6.362 · `sinReversion` 6.312 · `caducidad` 40 ·
`noRompe` 11.041.

Artefactos: `v03-lab/estructura.mjs` (script) y
`v03-lab/estructura_base.json` (foto base).

### 2.5 Flags y proceso

| Flag | Valor observado |
|---|---|
| `MS_SIMBOLOS` | definido en `.env` |
| `MS_TELEGRAM_AVISOS` | definido en `.env` |
| `MS_TELEGRAM_TOQUES` | **no definido** → los avisos sí se envían |
| `MS_SOLO_RAYAS` | **no definido** → modo completo |
| `MS_RAYAS` | **no definido** → Rayas apagadas |

Proceso vivo al iniciar: supervisor PID **10673**, motor PID **13042**.

---

## 3. Fase 1 — Puerta EMA en Estructura

**Archivo:** `motor-senales/nucleo.js`
**Función:** `escanearEstructura`
**Estado:** **completada.**

### 3.1 Helper

Añadir una sola función, para no repetir la condición:

```js
const alineadaEMA = (cierre, e30, e50, e100, lado) => {
  // null se coercionaría a 0: sin las tres EMAs válidas no hay pila.
  if (!(e30 > 0) || !(e50 > 0) || !(e100 > 0)) return false;
  return lado === 'VENTA'
    ? (cierre < e30 && e30 <= e50 && e50 <= e100)
    : (cierre > e30 && e30 >= e50 && e50 >= e100);
};
```

### 3.2 Filtro de diagnóstico

En el objeto `filtros` de `escanearEstructura` (~línea 495), añadir:

```js
sinAlineacion: 0
```

### 3.3 Emisión del quiebre

En el bloque que calcula `const base = s.toques.length...` (~línea 569):

- Calcular `alineada` con `cierre`, `e30[i]`, `e50[i]`, `e100[i]`.
- Solo hacer `eventos.push(...)` si `alineada`.
- Si no, `filtros.sinAlineacion++`.
- **Consumir la jugada igual**: resetear toques, ciclo, impulso y punta. Un
  quiebre no alineado no debe emitirse más tarde en otra vela.

### 3.4 Emisión del toque `2E/3E`

En el bloque `if (s.toques.length >= 2)` (~línea 634):

- Calcular `alineada` con `c[i]`, `e30[i]`, `e50[i]`, `e100[i]`.
- Solo `eventos.push(...)` si `alineada`.
- Si no, `filtros.sinAlineacion++`.
- **No borrar el toque** de `s.toques`: puede servir para un quiebre posterior
  que sí esté alineado.

### 3.5 Lo que no se toca

- `tolToqueAtr` (0,30).
- `cuerpoSoloUno` (`false`).
- `modo2B` (`retesteo`).
- El toque de Raptor.
- `app.js`.

### 3.6 Gate de la Fase 1

```bash
cd motor-senales
npm test
node test_estructura.mjs
```

- `npm test`: **42 / 92 / 16 / 28 / 24 / 22**, exit 0.
- `test_estructura`: **18 OK / 0 fallos**, exit 0 (16 base + 2 checks nuevos
  de la puerta EMA).
- Medir Estructura otra vez y guardar `v03-lab/estructura_post.json`:
  ```bash
  node v03-lab/estructura.mjs > v03-lab/estructura_post.json
  ```
- Comparar: los eventos deben bajar; `sinAlineacion` debe ser > 0; ningún
  evento debe tener `tendencia: LATERAL`.
- **Corte:** si `test_estructura` falla, restaurar `nucleo.js.bak` y parar.

### 3.7 Evidencia de la Fase 1

| Medición | Base | Después |
|---|---:|---:|
| `npm test` | 42 / 92 / 16 / 28 / 24 / 22 | **42 / 92 / 16 / 28 / 24 / 22** |
| `test_estructura` | 16 OK | **18 OK** |
| Eventos Estructura (16 series) | 1.822 | **891** |
| `sinAlineacion` | — | **931** |
| Eventos `LATERAL` | — | **0** |

La puerta bloquea **931** eventos. En la primera pasada aparecieron **18
`LATERAL`** porque `e50`/`e100` eran `null` y JavaScript los comparaba como `0`;
se añadió el guard de EMAs válidas y quedaron en cero.

Desglose posterior: `1E` 154 · `1ER` 232 · `2E` 101 · `2ER` 159 · `2EB` 53 ·
`2EBR` 82 · `3E` 30 · `3ER` 38 · `3EB` 16 · `3EBR` 26.

Artefacto: `v03-lab/estructura_post.json`.

---

## 4. Fase 2 — `2/3/2R/3R` como entradas

**Archivos:** `motor-senales/nucleo.js`, `motor-senales/app.js`,
`motor-senales/telegram.js`
**Estado:** **completada.**

### 4.1 Núcleo

En `ENTRADAS` (~línea 110), añadir:

```js
'2', '2R', '3', '3R'
```

En `PESO_AVISO` (~línea 115), quitarlos. Ya no se usan: al estar en `ENTRADAS`,
`prioridadEvento` toma la jerarquía de `JERARQUIA`.

### 4.2 App

En `PATRONES_AVISO` (~línea 109):

```js
const PATRONES_AVISO = new Set(['2E', '2ER', '3E', '3ER']);
```

`2E/3E` siguen siendo avisos de Estructura; no se tocan.

Actualizar los comentarios que digan que `2/3` son avisos:

- `app.js` ~106 y ~220.
- `nucleo.js` ~108, ~188 y ~425.
- `telegram.js` ~141.

### 4.3 Efecto esperado

- `2/3/2R/3R` salen por `formatearSenal` como **SEÑAL**, no por
  `formatearAviso`.
- `MS_TELEGRAM_TOQUES=0` ya no las esconde.
- Al ser entradas, también pasan por `enviarEntradaUrgente` (ntfy). Si no se
  quiere ese carril para `2/3`, se excluye ahí; es una decisión de producto, no
  del motor.

### 4.4 Gate de la Fase 2

```bash
npm test
node test_estructura.mjs
node auditoria_destructiva.mjs
```

- Tests verdes.
- P10 de la auditoría: toda entrada tiene prioridad.
- Forzar un evento `2` y comprobar en el log que sale `SEÑAL`, no `AVISO`.
- **Corte:** si P10 o los tests fallan, restaurar `app.js.bak` y
  `nucleo.js.bak` y parar.

### 4.5 Evidencia de la Fase 2

| Verificación | Resultado |
|---|---|
| `npm test` | **42 / 92 / 16 / 28 / 24 / 22**, exit 0 |
| `test_estructura` | **18 OK / 0 fallos**, exit 0 |
| P10 | **0 entradas sin prioridad · 12 niveles distintos** |
| `ENTRADAS.has('2')` | **true** · prioridad **108,37** |
| `PATRONES_AVISO` | `2E/2ER/3E/3ER`; **`2` y `3` no son aviso** |
| `formatearSenal({patron:'2'})` | `<b>3. Estrategia:</b> 2 · Raptor-v03` · **sin AVISO** |
| `auditoria_destructiva` | exit 0 · P10 OK |

La auditoría completa reporta 3 fallos de rendimiento/formato que no tocan los
caminos de esta fase:
- mensaje grande mide 5.205 (límite Telegram 4.096)
- `escanear` M1 tarda 214,2 ms (umbral 50 ms)
- `guardar` tarda 981 ms (umbral 500 ms)

No se tocaron esos caminos; P10, que es el gate de la Fase 2, pasa.

**Efecto esperado:** `2/3/2R/3R` ahora pasan por `formatearSenal` y también por
`enviarEntradaUrgente` (ntfy). Si no se quiere el carril urgente para ellas, se
excluyen ahí; es una decisión de producto, no del motor.

---

## 5. Fase 3 — Verificar lo que no se toca

**Estado:** completada. No se modificó código.

1. **Raptor ya filtra por EMAs.** `escanear` comprueba `alineada` antes de
   emitir `2/3/1/B`. Probar una serie lateral: no debe emitir.
2. **Alerta con las 3 EMAs.** `formatearSenal` imprime
   `Tendencia: ALCISTA (EMA30 > EMA50 > EMA100)` o `BAJISTA (...)` y el TF
   mayor. Capturar un mensaje de muestra.
3. **EMA50 perforada en 2B/2RB.** El guard `s.retesteo = null` (~línea 275)
   anula el 2B si el retesteo no está alineado. Verificar con S8.
4. **H1 en contra.** `mayorContraria` (~línea 204 de `app.js`) bloquea el envío.
   Se deja como está, tal como dice el documento.
5. **Vela escapada.** No se añade filtro; el bot puede avisar y el operador no
   persigue.

### Evidencia de la Fase 3

- Serie lateral de 60 velas planas: `escanear` devuelve **0 eventos** y
  `filtros.alineada = 0`.
- Mensaje de muestra (`formatearSenal`):
  ```
  🟢 COMPRA
  1. Activo: FX Vol 40
  2. Temporalidad: M15 · entrada M5
  3. Estrategia: 2 · Raptor-v03
  4. Tendencia: ALCISTA (EMA30 > EMA50 > EMA100) · H1 ALCISTA
  ```
- `test_protocolo.mjs`: **92 OK / 0 FALLOS** (incluye guard de EMA50 perforada).
- `mayorContraria` sigue bloqueando envíos con H1 en contra (`app.js` ~203).
- `npm test`: **42 / 92 / 16 / 28 / 24 / 22**, exit 0.
- `test_estructura.mjs`: **18 OK / 0 fallos**.
- `auditoria_destructiva.mjs`: **0 FALLO**.

---

## 6. Fase 4 — Laboratorio antes/después

**Estado:** completada.

```bash
cd /root/weltrade-webterminal-connector
node v03-lab/evaluar.mjs
cp v03-lab/reporte.md v03-lab/reporte_post.md
cp v03-lab/reporte.json v03-lab/reporte_post.json
```

Comparar `reporte_base` vs `reporte_post`:

| Métrica | Base | Post | Criterio |
|---|---:|---:|---|
| Señales totales | 1.529 | — | No debe desaparecer el catálogo. |
| Simulables | 1.510 | — | — |
| Catálogo R | −0,107 | — | No debe empeorar de forma clara. |
| Roturas R | +0,070 | — | Se mantiene. |
| Toques R | −0,186 | — | Se mantiene; ahora son entradas. |
| Estructura eventos | 1.822 | — | Baja por la puerta EMA. |
| `sinAlineacion` | — | > 0 | La puerta está actuando. |

**Corte:** si el motor queda casi sin señales o el R empeora de forma clara, no
se reinicia producción; se revisa la condición antes de seguir.

### Evidencia de la Fase 4

- Raptor sin cambios: variante por defecto sigue en **1.510 señales**, **−0,107 R**,
  PF **0,82** (igual que la base).
- Estructura: **1.822 → 891 eventos** por la puerta EMA.
- `sinAlineacion`: **931** eventos bloqueados.
- Por tendencia post: ALCISTA 455 · BAJISTA 436 (sin `LATERAL`).
- Artefactos: `v03-lab/reporte_post.md`, `v03-lab/reporte_post.json`,
  `v03-lab/estructura_post.json`.

---

## 7. Fase 5 — Producción

**Estado:** completada (2026-11-16).

### 7.1 Parada ordenada

No hubo proceso previo vivo al arrancar; no se ejecutó parada.

### 7.2 Arranque

```bash
cd motor-senales
setsid nohup ./supervisor.sh >> motor.log 2>&1 < /dev/null & disown
```

Supervisor PID 15847, motor PID 15852.

### 7.3 Verificación

- Log: `motor v03 iniciado (..., telegram: on, TF: H1/M15/M5/M1, ..., modo: completo)`.
- HTTP /salud y /estado en puerto 3000; 4 símbolos suscritos.
- Primeras 11 señales tras el arranque:
  - `tendencia`: 9 ALCISTA · 2 BAJISTA; ninguna `LATERAL`.
  - Patrones emitidos como `SEÑAL`: `1`, `1R`, `2R`, `3R`, `3RB` (ninguno como `AVISO`).
  - Estructura solo con pila alineada (puerta EMA activa).
  - 1 reconexión transitoria (socket 1006, 10 s) y sin errores persistentes.
- Duplicados entre M1 y M5 para el mismo símbolo son esperados: cada TF
  escanea por separado; no es un fallo.

---

## 8. Rollback

Si cualquier fase falla:

```bash
cd motor-senales
cp nucleo.js.bak nucleo.js
cp app.js.bak app.js
npm test
node test_estructura.mjs
# reiniciar supervisor con el procedimiento de 7.2
```

Los backups se crearon en la Fase 0 y no se sobrescriben.

---

## 9. Checklist final

- [x] Fase 0: backups, tests base, laboratorio base, Estructura base, flags.
- [x] Fase 1: puerta EMA en Estructura.
- [x] Fase 2: `2/3/2R/3R` como entradas.
- [x] Fase 3: verificación de Raptor, alerta, 2B/2RB y H1.
- [x] Fase 4: comparación laboratorio base/post.
- [x] Fase 5: producción y primeras señales.
- [x] Rollback probado si algo falla (entorno controlado, 2026-11-16).
  - Copia completa del proyecto en `/tmp/rollback-root`; restauración de
    `nucleo.js.bak` y `app.js.bak`.
  - `npm test`: 42 / 92 / 16 / 28 / 24 / 22, todos OK.
  - `test_estructura.mjs`: 16 OK / 2 fallos esperados (`sin EMA100 no emite`,
    `sin EMA100 cuenta el filtro`), porque esos 2 tests validan la puerta EMA
    que el rollback elimina; al revertir código sin revertir tests, fallan por
    diseño. En rollback real conviene restaurar también `test_estructura.mjs`
    a la versión pre-Fase 1 o aceptar esos 2 fallos.

---

## 10. Lo que NO se añade

- No hay umbrales de anti-rango.
- No hay filtros de distancia.
- No hay pared M15/H1 con parámetros nuevos.
- No hay bloqueo por “misma jugada”.
- No hay toque simétrico inventado.
- No se toca Rayas, escáner ni BodyTrend.
- No se cambia `cuerpoSoloUno`, `modo2B` ni `tolToqueAtr`.

**La estrategia es de EMAs. Si el gatillo no mira las EMAs, no sale.**
