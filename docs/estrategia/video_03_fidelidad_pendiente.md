# Vídeo 03 — qué falta para que el motor sea fiel al 100 %

**Alcance:** solo el **vídeo 03**. El 01 y el 02 quedan fuera por decisión del
propietario (2026-11-10). Cada punto lleva la cita del vídeo que lo respalda y
el cambio concreto en `motor-senales/nucleo.js`.

Estado de partida: catálogo completo, EMAs 30/50/100, toque, engaño, quiebre y
reset implementados y calibrados (0,092R train / 0,044R validación). Lo que
sigue son **desviaciones que quedan**, ordenadas por impacto.

**Actualización 2026-11-10:** los puntos **1 a 6 están implementados** en
`nucleo.js`, cada uno con su interruptor en `PARAMS` (`exigirExtension`,
`cuerpoSoloUno`, `caducidadEngano`, `cancelarSobreTecho`, `resetPorSalida`) y
con un escenario propio en `test_nucleo.mjs` que compara la misma serie con la
guarda encendida y apagada. El punto 2 se descartó por decisión del propietario:
**el catálogo es de entradas, no de avisos**. Suite: 125 OK, 0 fallos.

---

## 1. ✅ La 2 y la 3 exigen que el precio **supere** el toque anterior

**Lo que dice el vídeo:** «la dos… primer toque que **supera** y segundo toque»
y «la tres… **supera el número dos** y toca nuevamente la EMA de 30 y 50»
(trozos 11–14, 58–83 s). Sin extensión no hay 2 ni 3: es lo que distingue un
toque de una simple acumulación sobre la EMA.

**Lo que hace el motor:** cuenta toques seguidos sin comprobar que cada uno
haya ido más lejos que el anterior. Tres rebotes a la misma altura emiten `2`,
`3` y hasta `3B`.

**Cambio:** al registrar un toque, comparar su extremo con el del toque previo
(`low` menor en VENTA, `high` mayor en COMPRA). Si no supera, **no** se cuenta
ni emite aviso. Es la desviación más grande que queda.

## 2. ❌ La `1` como aviso en el primer toque — **descartado**

Se implementó y el propietario lo rechazó: «todas las estrategias son como
entradas». El catálogo se queda como está, con los avisos solo para `2` y `3`
(el nivel a romper) y la `1` únicamente como entrada.

(Texto original, para el registro:)

**Lo que dice el vídeo:** «**uno, dos, tres es toque**, no es quiebre» (151–161 s)
y la pizarra `1─1R / 2─2R / 3─3R` (3:26). En el gráfico las etiquetas van en
cascada sobre los toques: 1R, 2R, 3R.

**Lo que hace el motor:** emite avisos de `2` y `3`, pero el primer toque solo
aparece si además hay engaño y quiebre con cuerpo (entrada). Sin eso, el primer
toque es invisible.

**Cambio:** emitir aviso `1` / `1R` en el primer toque de la secuencia, con su
nivel a romper. La entrada sigue siendo la `1` con cuerpo.

## 3. ✅ El cuerpo solo lo exige la `1`

**Lo que dice el vídeo:** «**la uno… quiebra con cuerpo**» (39–45 s). Para la
2B solo dice «**quebró el mínimo anterior**» (312–320 s) — no habla de cuerpo.

**Lo que hace el motor:** exige cuerpo ≥ 50 % del rango y ≥ 0,10 ATR en **todas**
las entradas.

**Cambio:** `cuerpoMin` solo para `1`/`1R`; `2B/2RB/3B/3RB` se conforman con el
cierre más allá del mínimo anterior. Es de esperar que suba el número de 2B —
justo la que hoy sale negativa.

## 4. ✅ El engaño no caducaba

**Lo que dice el vídeo:** la `1` es una secuencia continua: se sale, vuelve y
quiebra (30–46 s). No es un engaño de hace cuarenta velas.

**Lo que hace el motor:** marca `engaño = true` y **no lo apaga nunca** hasta que
se consume una entrada; ni siquiera la inversión de la estructura lo limpia
(`nucleo.js` solo resetea `toques`, `ciclo` y los avisos). Un quiebre muy
posterior puede salir etiquetado `1`.

**Cambio:** ventana del engaño (por ejemplo 12 velas): pasado ese plazo, el
engaño deja de contar y el quiebre del primer toque no se etiqueta.

## 5. ✅ «No superar la EMA50» aplica a toda la secuencia

**Lo que dice el vídeo:** para que haya 2B, el precio tiene que «tocar la EMA de
30, **no superar** la de 50 y **respetar** la de 30 y 50» (342–358 s).

**Lo que hace el motor:** lo comprueba solo en la vela del toque. Si una vela
intermedia cierra por encima de la EMA50 no se cancela nada: el pendiente muere
solo por la caducidad de 3 velas, así que si vuelve a cerrar bien dentro de esa
ventana, el `2B` sale igual. El hueco es estrecho, pero la regla del vídeo es
una condición, no un plazo.

**Cambio:** cualquier cierre más allá de la EMA50 entre el toque y el quiebre
**cancela** el pendiente (y, si vuelve, arranca de nuevo: eso ya es el engaño
de la `1`).

## 6. ✅ El reset no es solo «después de una entrada»

**Lo que dice el vídeo:** «R de **reset**»: el precio **se salió, volvió y lo
hizo otra vez** (84–144 s). No dice «después de que yo entre».

**Lo que hace el motor:** sube el contador de ciclo solo cuando se consume una
entrada; y cuando la estructura se invierte (EMA30 cruza al otro lado de la
EMA50) lo devuelve a cero. Así que lo de «se salió, volvió y lo hizo otra vez»
**sin** invertir la estructura se emite sin `R`.

**Cambio:** contar también el reset por salida y regreso sobre la EMA50, que es
literalmente lo que él describe.

## 7. ❌ Temporalidad M1 — descartada (no forma parte de la estrategia)

Se descargaron 30 días de M1 de los cuatro índices (`conector/abrir_demo.js
velas --periodos M1`, ~42.950 velas por símbolo) y se calibró aparte. Resultado:
**ninguna** combinación de TP (1–3R) y horizonte (6–24 velas) aguanta la
validación — todas son positivas en train (+0,011 a +0,139) y negativas en
validación (−0,034 a −0,074). La ganadora de la rejilla gana +0,127 en train y
pierde −0,007 en validación, con cinco de seis parámetros en el borde.

Decisión del propietario (2026-11-10): **M1 no es parte de la estrategia**. Los
datos se borraron y `MS_TF` sigue en M5–H1. El vídeo opere en M1 no obliga a
operarlo en M1: la regla es la misma y es la que se calibra.

(Texto original, para el registro:)

**Lo que dice el vídeo:** opera en **M1** sobre FX Volatility (1s) — se lee en la
barra de temporalidades del gráfico en todo el vídeo.

**Lo que hace el motor:** por defecto escanea M5–H1, y los datos de backtest
empiezan en M5. `nucleo.js` soporta M1 (`TFS`), pero nunca se ha probado ahí.

**Cambio:** añadir M1 a `MS_TF` en la cuenta demo y descargar M1 en el conector
para poder calibrar. Sin datos M1 no se puede afirmar nada de la TF del vídeo.

---

## 8. ✅ Duda resuelta con datos: el sentido de la 2B

El `2B` es un patrón con nombre y reglas publicadas (**Sperandeo**): el segundo
intento *apenas* supera el extremo anterior y el precio gira. La lectura del
vídeo («quiebra el mínimo anterior» = continuación) y la clásica (el quiebre
marginal es el patrón, la entrada llega al volver) son opuestas.

Medido con los **mismos gatillos** del núcleo (2B y 2RB, 16 series, TP 1,5R,
H=12):

| Salida | Esperanza train | n | Esperanza validación | n |
|---|---|---|---|---|
| Continuación (lo implementado) | +0,013R | 57 | **−0,130R** | 25 |
| Reversión clásica (2B de Sperandeo) | **+0,123R** | 32 | +0,035R | 16 |

34 de los 91 gatillos no volvieron al nivel en 12 velas, así que la variante de
reversión pierde bastantes señales; aun así, con las que quedan gana en los dos
tramos. **No es prueba de que el vídeo esté mal leído** — su frase es explícita
a favor de la continuación —, pero sí es motivo para que el modo sea
configurable y se elija con datos, no por mi interpretación.

### 8.1 Con el gatillo propio de Sperandeo (implementado)

El experimento anterior invertía el lado sobre los mismos gatillos. El gatillo
clásico es otro: el 2.º toque **apenas** supera el nivel (≤ `margen2BAtr`),
**fracasa** (el cierre vuelve al otro lado en ≤ 2 velas) y se entra al revés,
con el stop en el extremo marginal. Implementado como `modo2B: 'reversion'`:

| Variante | Total train | Total validación | Solo 2B train | Solo 2B validación |
|---|---|---|---|---|
| Continuación (vídeo) | +0,032 (n=370) | +0,084 (n=190) | −0,023 (n=36) | −0,078 (n=14) |
| Sperandeo, margen 0,50 ATR | +0,059 (n=309) | +0,078 (n=167) | −0,079 (n=9) | −0,010 (n=10) |
| Sperandeo, margen 0,25 ATR | +0,025 (n=296) | +0,126 (n=156) | −0,452 (n=6) | +0,233 (n=5) |

**No confirma** la ventaja del experimento anterior: con el gatillo bien
definido produce 6–10 señales en vez de 36, y el 2B sigue prácticamente en cero
(mejor validación, peor train, muestra mínima). La reversión **no** es el valor
por defecto; sigue disponible como parámetro.

> **Actualización 2026-11-14.** El propietario cerró el punto con su diccionario:
> la `2B`/`2RB` es «quiebre **+ retesteo**». Implementado como
> `modo2B: 'retesteo'` y activo por defecto, junto con el **cuerpo obligatorio en
> todas las `B`**. No es la reversión de Sperandeo ni la continuación: se entra a
> favor cuando el precio vuelve a probar el nivel roto. Medido: el grupo de
> roturas sube a **+0,070R** (n=470, train +0,056 / validación +0,096) frente a
> +0,046R (n=558) de la versión anterior. Detalle en `v03-lab/reporte.md`.

---

## 9. Lo que el vídeo no permite cerrar (y no se va a inventar)

- **«Cuándo está mal»** (425–435 s): «hay que tener vista, no son muchos». No hay
  criterio medible; solo el ejemplo visual. Sin una regla verbal, programarlo
  sería inventar.
- **El nombre de la 1**: se corrige tres veces en directo («seductora» →
  «matadora» → «la que más da»). Se queda `1`.
- **El scanner** (Flip 1-5, Step 200/500/800): no lo explica en el vídeo.

---

## 10. Qué se hizo y qué queda

**Hecho (2026-11-10):** puntos 1, 3, 4, 5, 6 y 11 en `nucleo.js`; punto 2
descartado por el propietario; 7 descartado (M1 fuera de la estrategia); 8
implementado con gatillo propio y medido. `test_nucleo.mjs` pasó de 16 a **34**
comprobaciones (una serie por regla, con la guarda encendida y apagada). Suite
completa: **131 OK, 0 fallos**. Recalibración completa sobre el código final
(2.025 combinaciones, 16 series):

| | train | validación |
|---|---|---|
| Antes de las reglas del vídeo | +0,092R (n=330) | +0,044R (n=172) |
| Código final, parámetros actuales | +0,032R (n=370) | +0,084R (n=190) |
| Ganadora de la rejilla final | +0,075R (n=339) | +0,080R (n=184) |

La ganadora **no se adoptó**: `cuerpoMin 0,65` está en el borde de la rejilla y
`caducidad 4` mejora train (+0,030) pero no validación (+0,089 frente a
+0,084, dentro del ruido: el error típico de la esperanza con n≈370 es ±0,05R).
El único vecino que sube los dos tramos es `cuerpoMinAtr 0,35` (+0,043 / +0,088),
por 0,011R — ruido, y además en el borde. Los parámetros se quedan.

**Queda:** nada del vídeo. Los tres puntos abiertos están cerrados: el 7
descartado (M1 fuera de la estrategia), el 8 implementado con gatillo propio y
medido, y el 11 implementado con la regla del vídeo (ver §8 y §11).

## 11. ✅ El nivel que rompe la 1: el tramo del engaño

La `1` rompía el **mínimo de las 12 velas previas al toque**, no el mínimo del
tramo del engaño que dice el vídeo. Ya rompe el del engaño (`nivelUnoPorEngano`).
Medido sobre las 16 series:

| Nivel que rompe la 1 | `1` train | `1` validación | Total train | Total validación |
|---|---|---|---|---|
| 12 velas (antes) | −0,140 (n=5) | +0,178 (n=10) | +0,057 (n=284) | +0,060 (n=150) |
| Tramo del engaño (vídeo) | +0,120 (n=17) | +0,008 (n=15) | +0,032 (n=370) | +0,084 (n=190) |

Se queda el del vídeo: **triplica la muestra de la `1`** (5 → 17), la pone en
positivo en train y sube la validación del conjunto (0,060 → 0,084), a cambio de
algo de train. Efecto colateral: `1R` pasa a ser la jugada más frecuente (184
señales frente a 95), porque el nivel del engaño se rompe antes y la jugada se
repite más.
