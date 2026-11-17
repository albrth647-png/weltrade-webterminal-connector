# Vídeo 03 — banco de pruebas

Generado por `node v03-lab/evaluar.mjs`
el 2026-11-16.

Motor: `motor-senales/nucleo.js` con sus parámetros actuales
(EMA30/50/100, tolerancia 0.3 ATR,
ventana 12, caducidad 3, cuerpo 0.5/0.1 ATR,
reset tras entrada: **sí**).

## Método

- Entrada al **cierre** de la vela de la señal, stop en `invalida` (extremo del toque).
- Objetivo **1.5R**, horizonte **12 velas**; si no toca nada, salida al cierre.
- Stop y objetivo en la misma vela → **stop** (conservador).
- **70 % inicial** de cada serie para train, **30 % final** para validación.
- Sin comisiones ni spread (los índices sintéticos del bróker ya los llevan implícitos en el precio).
- Operaciones que no tienen 12 velas por delante se descartan: 5.
- Velas donde stop y objetivo coinciden: 160 (se cuentan como stop) —
  156 solo toque y 4 toque + rotura.
- Señales sin riesgo válido (stop = entrada): 14 — 14 solo toque y 0 toque + rotura.

## Series

16 series · 54432 velas · 1529 señales.
Del 2026-10-09 al
2026-11-08.

## Totales por variante

| Variante | n | Esperanza R | Acierto | PF | Suma R | Máx. DD | Train | Validación |
|---|---|---|---|---|---|---|---|---|
| diccionario: cuerpo en las B + retesteo (por defecto) | 1510 | -0.107 | 37.7 % | 0.82 | -161.046 | 168.404 | -0.117 (n=1010) | -0.085 (n=500) |
| sin retesteo (entrar al quiebre) | 1549 | -0.094 | 38.4 % | 0.84 | -145.190 | 150.057 | -0.096 (n=1038) | -0.089 (n=511) |
| sin cuerpo en las B | 1548 | -0.102 | 37.9 % | 0.83 | -157.975 | 165.426 | -0.111 (n=1035) | -0.084 (n=513) |
| como antes: sin cuerpo y sin retesteo | 1596 | -0.097 | 38.3 % | 0.84 | -154.203 | 158.165 | -0.101 (n=1074) | -0.087 (n=522) |
| con filtro anti-rango estricto (0.5/0.3 ATR) | 388 | -0.127 | 37.9 % | 0.79 | -49.447 | 57.947 | -0.137 (n=256) | -0.108 (n=132) |
| con filtro anti-rango suave (0.3/0.15 ATR) | 960 | -0.125 | 36.8 % | 0.79 | -119.571 | 121.952 | -0.156 (n=633) | -0.063 (n=327) |
| con filtro anti-rango medio (0.4/0.2 ATR) | 740 | -0.095 | 38.2 % | 0.84 | -70.363 | 73.744 | -0.096 (n=480) | -0.093 (n=260) |
| roturas + filtro estricto | 66 | 0.230 | 60.6 % | 1.62 | 15.192 | 6.931 | 0.239 (n=40) | 0.217 (n=26) |
| roturas + filtro suave | 248 | 0.073 | 47.2 % | 1.17 | 18.200 | 10.738 | 0.113 (n=154) | 0.008 (n=94) |
| roturas + filtro medio | 165 | 0.113 | 50.9 % | 1.27 | 18.587 | 8.596 | 0.206 (n=104) | -0.046 (n=61) |
| sin reset tras entrada | 1510 | -0.107 | 37.7 % | 0.82 | -161.046 | 168.404 | -0.117 (n=1010) | -0.085 (n=500) |
| solo roturas (1/1R/2B/2RB/3B/3RB) | 470 | 0.070 | 47.2 % | 1.15 | 32.795 | 19.811 | 0.056 (n=308) | 0.096 (n=162) |
| solo toque (2/2R/3/3R) | 1040 | -0.186 | 33.4 % | 0.72 | -193.841 | 196.841 | -0.193 (n=702) | -0.172 (n=338) |
| sin reset + solo roturas | 470 | 0.070 | 47.2 % | 1.15 | 32.795 | 19.811 | 0.056 (n=308) | 0.096 (n=162) |

«Base» y «sin reset tras entrada» dan las mismas operaciones a propósito: el
reset sólo cambia la **etiqueta** de 110 de 1529 señales. Lo que se mide con R
no depende del código, así que esa fila sirve para ver cuánto se mueve el reparto
por código, no la rentabilidad.

## Por código (variante base)

| Código | Tipo | n | Esperanza R | Acierto | PF | Train | Validación |
|---|---|---|---|---|---|---|---|
| `1` | toque + rotura | 32 | 0.067 | 50.0 % | 1.13 | 0.120 (n=17) | 0.008 (n=15) |
| `1R` | toque + rotura | 268 | 0.022 | 42.9 % | 1.04 | -0.038 (n=184) | 0.153 (n=84) |
| `2` | solo toque | 306 | -0.163 | 34.6 % | 0.74 | -0.150 (n=217) | -0.193 (n=89) |
| `2B` | toque + rotura | 26 | -0.060 | 50.0 % | 0.82 | 0.017 (n=18) | -0.234 (n=8) |
| `2R` | solo toque | 408 | -0.196 | 32.8 % | 0.71 | -0.218 (n=271) | -0.151 (n=137) |
| `2RB` | toque + rotura | 49 | 0.149 | 57.1 % | 1.42 | 0.286 (n=31) | -0.087 (n=18) |
| `3` | solo toque | 149 | -0.239 | 31.5 % | 0.65 | -0.262 (n=100) | -0.192 (n=49) |
| `3B` | toque + rotura | 32 | 0.014 | 43.8 % | 1.03 | 0.136 (n=17) | -0.125 (n=15) |
| `3R` | solo toque | 177 | -0.161 | 33.9 % | 0.75 | -0.155 (n=114) | -0.173 (n=63) |
| `3RB` | toque + rotura | 63 | 0.295 | 57.1 % | 1.78 | 0.260 (n=41) | 0.359 (n=22) |

## Jerarquía de señales (peso operativo)

| Código | Tier | Peso | n | Esperanza R | PF | Acierto | Recomendación |
|---|---|---|---|---|---|---|---|
| `3RB` | A | 3 | 63 | 0.295 | 1.78 | 57.1 % | operar con prioridad |
| `2RB` | A | 2 | 49 | 0.149 | 1.42 | 57.1 % | operar con prioridad |
| `1` | B | 1 | 32 | 0.067 | 1.13 | 50.0 % | operar con cautela |
| `1R` | B | 1 | 268 | 0.022 | 1.04 | 42.9 % | operar con cautela |
| `3B` | B | 1 | 32 | 0.014 | 1.03 | 43.8 % | operar con cautela |
| `2B` | C | 0 | 26 | -0.060 | 0.82 | 50.0 % | evitar |
| `3R` | C | 0 | 177 | -0.161 | 0.75 | 33.9 % | evitar |
| `2` | C | 0 | 306 | -0.163 | 0.74 | 34.6 % | evitar |
| `2R` | C | 0 | 408 | -0.196 | 0.71 | 32.8 % | evitar |
| `3` | C | 0 | 149 | -0.239 | 0.65 | 31.5 % | evitar |

- **Tier A** (operar con prioridad): `3RB`, `2RB` — únicos con R positivo claro y PF ≥ 1,4.
- **Tier B** (operar con cautela): `1`, `1R`, `3B` — R marginal, PF ~1,0.
- **Tier C** (evitar): `2B`, `2`, `2R`, `3`, `3R` — R negativo; la `2B` solo vale si el
  filtro anti-rango estricto la deja pasar (ver Paso 1).
- La `2` y la `3` son entradas al toque y rinden negativo: no se operan salvo en
  contextos muy específicos.

## El reset

`R` no es un patrón: es el **reseteo de la secuencia 1/2/3**. Cuando una jugada
se consume, la cuenta vuelve a empezar y la siguiente señal puede volver a ser
una 1. El motor ya funciona así (`resetTrasEntrada: true`), que es la lectura
del propietario.

La tabla compara esa lectura con la alternativa de resetear sólo cuando el
precio se sale de la tendencia y vuelve. No cambia ninguna operación: cambia la
**etiqueta** de las señales, así que sólo sirve para ver cuánto se mueve el
reparto por código.

| Código | n (reset tras entrada) | Esperanza R | n (reset sólo al salir) | Esperanza R |
|---|---|---|---|---|
| `1` | 32 | 0.067 | 36 | -0.018 |
| `1R` | 268 | 0.022 | 264 | 0.033 |
| `2` | 306 | -0.163 | 364 | -0.122 |
| `2B` | 26 | -0.060 | 34 | 0.009 |
| `2R` | 408 | -0.196 | 350 | -0.244 |
| `2RB` | 49 | 0.149 | 41 | 0.132 |
| `3` | 149 | -0.239 | 178 | -0.239 |
| `3B` | 32 | 0.014 | 42 | 0.097 |
| `3R` | 177 | -0.161 | 148 | -0.146 |
| `3RB` | 63 | 0.295 | 53 | 0.282 |

## Por temporalidad (base)

| TF | n | Esperanza R | Acierto | PF |
|---|---|---|---|---|
| M5 | 973 | -0.118 | 37.2 % | 0.80 |
| M15 | 304 | -0.004 | 41.8 % | 0.99 |
| M30 | 147 | -0.199 | 34.7 % | 0.69 |
| H1 | 86 | -0.181 | 33.7 % | 0.73 |

## Por símbolo (base)

| Símbolo | n | Esperanza R | Acierto | PF |
|---|---|---|---|---|
| FX Vol 20 | 466 | -0.127 | 36.9 % | 0.79 |
| FX Vol 40 | 415 | -0.152 | 35.7 % | 0.75 |
| SFX Vol 20 | 314 | -0.034 | 40.8 % | 0.94 |
| SFX Vol 40 | 315 | -0.088 | 38.4 % | 0.85 |

## Por qué se descartan candidatos

Cuenta de **chequeos** (barra × lado), no de señales: sirve para ver qué filtro
muerde más, no para leerlo como número de oportunidades.

| Filtro | Chequeos |
|---|---|
| `alineada` | 75101 |
| `caducidad` | 25440 |
| `toca` | 24279 |
| `supera` | 2418 |
| `rompe` | 2203 |
| `enganoVivo` | 1788 |
| `cancelarSobreTecho` | 1353 |
| `cuerpoOk` | 431 |
| `sinCodigo` | 0 |
| `chop` | 0 |

## Lectura

- Esto mide **el motor actual**, no una versión ideal. Si un código sale mal, el
  reporte no dice «la idea del vídeo no funciona»: dice que esa codificación, con
  estos parámetros, no ganó en estos datos.
- La muestra por código es pequeña; cualquier esperanza con `n < 30` es ruido.
- El edge medido históricamente es fino (PF 1,1–1,2). Tratar el reporte como
  termómetro, no como promesa.
- La 2 y la 3 son entradas al toque, y así se miden. Su esperanza negativa no
dice que la idea falle: dice que entrar al toque sin rotura rinde peor que
esperar la rotura, y que conviene separar los dos grupos al leer los totales.
