# Vídeo 03 — estado de fidelidad del motor (`motor-senales/nucleo.js`)

Auditoría del **2026-11-14**, regla por regla, contra
`video_03_reglas_implementables.md` y la transcripción verificada.
Cada fila dice **qué dice el vídeo**, **qué hace el código** y **veredicto**.

Veredicto: **cumple** · **más estricto** (no rompe la regla, filtra de más) ·
**desvía** (hace algo distinto) · **pendiente** (decisión del propietario).

## 1. Andamiaje

| # | Regla del vídeo | Código | Veredicto |
|---|---|---|---|
| A1 | EMA30 = contacto, EMA50 = techo, EMA100 = sesgo | `PARAMS.emaContacto/emaTecho/emaFondo` + `ema()` (l.87) | **cumple** |
| A2 | Dirección a favor de la tendencia comprobada | `alineada`: `c < E30 ≤ E50 ≤ E100` en venta (l.212) | **más estricto** — el vídeo solo nombra 30 y 50; la 100 viene de los vídeos 01–02 |
| A3 | Toque: la mecha toca EMA30 y **no supera** EMA50 | `toca`: mecha dentro de `E30 ± 0,30·ATR`, `extremo ≤ E50` (l.226) | **más estricto** — además exige cierre al otro lado de la EMA30 (`c < E30`), cosa que el vídeo no pide |
| A4 | Etiqueta anclada a la vela del toque o del quiebre | `evento.barIndex` (l.541), `precio` = cierre de esa vela | **cumple** |
| A5 | Nunca contra el sesgo | el escaneo solo recorre secuencias alineadas | **cumple** |

## 2. Catálogo

| # | Regla del vídeo | Código | Veredicto |
|---|---|---|---|
| C1 | `2` = 2.º toque a EMA30; `3` = 3.er toque | `toques.length` → código (l.249-254) | **cumple** |
| C2 | «el 2 **supera** al 1» (extensión) | `supera`: nuevo mínimo/máximo más allá del anterior (l.233) | **pendiente** — usa **mecha**; `video_03_reglas_implementables.md` §3 dice *cierre*. El vídeo solo dice «supera» |
| C3 | `2B`/`3B` = toque + quiebre **del mínimo/máximo anterior** | `rompe` sobre `t.nivel` (extremo de 12 velas), con caducidad de 3 velas | **cumple** |
| C4 | El quiebre va **con cuerpo** en todas las `B` | `cuerpoSoloUno: false` (l.281): `1`, `2B`, `3B` y sus reseteadas exigen cuerpo ≥ 0,50 del rango y ≥ 0,10 ATR | **cumple** (diccionario del propietario, rectificado el 2026-11-14) |
| C4b | `2B`/`2RB` se ejecutan en el **retesteo** del nivel | `modo2B: 'retesteo'`: el quiebre arma la jugada y la entrada espera la vuelta al nivel, dentro de 3 velas y con tolerancia de 0,30 ATR | **cumple** (misma rectificación) |
| C5 | `1` = engaño sobre EMA50 + regreso + quiebre **con cuerpo** del tramo del engaño | `enganoNivel` (l.176), `base='1'` (l.267), `cuerpoMin 0,50 / 0,10 ATR` (l.282) | **cumple** |
| C6 | No existe `1B` | primer toque sin engaño → sin evento (l.268) | **cumple** (+ test invariante) |
| C7 | `R` = reset de la secuencia 1/2/3 | `resetPorSalida` (l.186) **y** `resetTrasEntrada` (l.300) | **cumple** — decisión del propietario: `R` es el reseteo de la 1, 2 y 3. Ver §4.1 |
| C8 | `2B`/`3B` caducan a las N velas del toque | `caducidad: 3` (l.262) | **cumple** (N es `[EST]`) |

## 3. Señal y entrada

| # | Regla del vídeo | Código | Veredicto |
|---|---|---|---|
| S1 | `2` y `3` son entradas, igual que las `B` | se emiten con `tipo: 'entry'` (l.249) y el motor los manda como señal de entrada | **cumple** — decisión del propietario: la 2 y la 3 también se operan |
| S2 | Entrada al cierre de la vela del quiebre | `precio = c[i]` | **cumple** |
| S3 | Invalidación = extremo del toque (máximo de la excursión en la `1`) | `invalida = t.extremo`; en la `1` el toque es posterior al engaño | **cumple** para `2B/3B`; **más estricto** en la `1` (usa el extremo del toque, no el del engaño) |
| S4 | Etiqueta con color de dirección y texto de código | `lado` + `patron` | **cumple** |

## 4. Los tres hallazgos que importan

### 4.1 El `R` es el reset de la secuencia (`cumple`)

El propietario lo cerró el 2026-11-14: **`R` es el reseteo de la 1, 2 y 3**, no un
patrón ni un rompimiento. Cuando una jugada se consume, la cuenta vuelve a
empezar. El código lo hace por **dos** caminos, y los dos encajan:

- `resetTrasEntrada` (l.300): después de consumir una entrada, la secuencia
  vuelve a empezar (la siguiente puede volver a ser una `1`).
- `resetPorSalida` (l.186): además, salir de la tendencia y volver también
  reinicia la cuenta («sale de la tendencia y lo vuelve a hacer», 366–376 s).

**Medido** (`v03-lab/reporte.md`, 16 series, 1.615 señales): apagar esa segunda
vía **no añade ni quita operaciones**, pero **cambia 153 etiquetas (9,5 %)**:
119 de solo toque (`2R→2`, `3R→3`) y **34 con rotura** (`1R→1`, `2RB→2B`, `3RB→3B`). La
esperanza global es idéntica (mismas entradas, mismos stops); lo que se mueve es
el reparto por código, y bastante: `3B` pasa de −0,063R a +0,088R con sólo 16
etiquetas de diferencia. Eso demuestra que **las esperanzas por código con
n≈50 son frágiles**, no que una lectura sea mejor.

Es decir: la etiqueta cambia, pero **no el resultado económico** en esta muestra;
entre una jugada y la siguiente el precio casi siempre sale de la tendencia, así
que el reset por salida ya estaba ahí.

**Hecho:** el comportamiento se queda como está (`resetTrasEntrada: true`), que
es lo que pidió el propietario; ahora además es un parámetro y el laboratorio
mide la variante alternativa como control, no como lectura del vídeo.

### 4.2 `2` y `3` son entradas (`cumple`)

El vídeo las presenta como aviso, pero el propietario decidió el 2026-11-14 que
**también se operan**: la 2 y la 3 son entradas al toque, y las `B` son esas
mismas entradas cuando además rompen el nivel. El motor ya las emite así, con
precio y stop, sin cambios pendientes.

Rectificadas además las dos reglas de ejecución del diccionario: **cuerpo en
todas las `B`** (antes solo lo exigía la `1`) y **retesteo de la `2B`/`2RB`**
(antes se entraba al cierre del quiebre). Medido en `v03-lab/reporte.md`: con las
dos activas, entrar solo al toque da −0,186R (n=1.040) y esperar la rotura
**+0,070R** (n=470, PF 1,15, train +0,056 / validación +0,096). Sin ellas la
rotura daba +0,046R con 558 señales: las dos reglas quitan 88 señales y suben la
esperanza del grupo. No invalida la decisión — son dos formas de entrar y
conviene leerlas separadas — pero sí dice dónde está el filo.

### 4.3 `1E/2E/3E` no son del vídeo 03 (`fuera de alcance`)

`nucleo.js` contiene una **segunda estrategia** (`escanearEstructura`, l.326-543:
impulso + retroceso + quiebre, sin EMAs) que emite `1E`, `2E`, `3E`, `2EB`…
Esos códigos **no existen** en el vídeo 03, pero el motor los publica como
señales (`Nucleo._evaluar`, l.826+). Si el objetivo es «solo vídeo 03», hay que
apagarla por defecto; hoy va encendida en M5.

## 5. Deudas de documentación (no del código)

| Documento | Problema |
|---|---|
| `video_03_reglas_implementables.md` §9 | sigue con los `[EST]` viejos (tol 0,10 · ventana 5–8 · caducidad 6). La §11 sí tiene los calibrados |
| `docs/sistema/playbooks/60_yoel_catalogo.md` | nomenclatura invertida (`R` = rompimiento); el vídeo y el motor usan `R` = reset |
| `video03_fichas_estrategias.md` | hereda la nomenclatura nueva (`1S`, `2R`), no la del vídeo |

## 6. Lo que **no** se puede verificar

- Los ejemplos en vivo del vídeo (M1, FX Vol 40) no tienen marcas de tiempo por
  señal, así que no hay comparación señal a señal posible.
- «Cuándo está mal» (425–435 s) no tiene regla verbal.
- Los `[EST]` (tolerancia, caducidad, ventana, cuerpo en ATR) son calibración
  nuestra, no del vídeo.

## 7. Resumen

- **13 reglas cumplen**, 3 son más estrictas que el vídeo (A2, A3, S3-`1`).
- **1 queda pendiente**: si el «2 supera al 1» se mide con mecha o con cierre
  (C2). No hay desviaciones abiertas: el `R` (§4.1) y las entradas `2`/`3`
  (§4.2) quedaron cerradas por decisión del propietario.
- **1 está fuera de alcance**: la estrategia Estructura metida en el mismo
  archivo (§4.3).
- La detección de toques, quiebres, engaño, cuerpo, caducidad y reset por salida
  es fiel al vídeo con los parámetros calibrados.

## 8. Primera medición del banco (`v03-lab/`)

16 series · 54.432 velas · 1.529 señales · 1.510 simulables · entrada al cierre,
stop en la invalidación, objetivo 1,5R, horizonte 12 velas, split 70/30.

| Grupo | n | Esperanza R | Acierto | PF | Train | Validación |
|---|---|---|---|---|---|---|
| Todo el catálogo | 1.510 | −0,107 | 37,7 % | 0,82 | −0,117 | −0,085 |
| **Solo roturas** (`1/1R/2B/2RB/3B/3RB`) | 470 | **+0,070** | 47,2 % | 1,15 | **+0,056** | **+0,096** |
| Solo toque (`2/2R/3/3R`) | 1.040 | −0,186 | 33,4 % | 0,72 | −0,193 | −0,172 |

Por código, dentro de las roturas: `3RB` +0,295 (n=63) · `2RB` +0,149 (n=49) ·
`1` +0,067 (n=32) · `3B` +0,014 (n=32) · `2B` −0,060 (n=26) ·
`1R` +0,022 (n=268).

Lectura: el catálogo **solo tiene esperanza si se separan las entradas al toque de
las entradas con rotura** (§4.2). La `3RB` es la única claramente positiva en los dos tramos; `2B`, la que
el vídeo llama «las mejores», sigue negativa con muestra corta.

Dos cautelas medidas, no supuestas:

- **160 señales tuvieron stop y objetivo dentro de la misma vela** y se cuentan
  como stop (conservador): **156 son entradas solo al toque** (su stop es el
  extremo del toque, tan pegado a la entrada que el 1,5R cae dentro de la propia
  vela) y solo **4 son toque + rotura**.
- El reparto por código se mueve con cualquier cambio de etiqueta (§4.1). Sirve
  para separar entradas al toque de entradas con rotura, **no** para elegir un
  código ganador con n=20.
