# Vídeo 03 — La estrategia es de EMAs

**Fecha:** 2026-11-16
**Estado:** documento corregido. Implementación en
`video_03_orden_implementacion.md`: **Fases 1 y 2 completadas**; Fases 3–5
pendientes. La producción sigue con el código anterior hasta la Fase 5.

## Para qué es el bot

Tú ya sabes la estrategia de memoria y sabes cuándo entrar y cuándo salir.
El bot no decide tu entrada: **te avisa de las oportunidades que cumplen la
regla EMA** para que no pases el día entero mirando la gráfica.

Este documento no añade filtros que no estén en tu guía: la única puerta nueva
es la regla EMA. Lo que ya existe (el bloqueo por H1) se deja como está y se
dice aquí para que no haya sorpresas.

## Regla de oro (la única puerta)

> **Toda señal que se emita tiene que mirar EMA30, EMA50 y EMA100 en la vela
> del gatillo.**

- COMPRA: `cierre > EMA30 >= EMA50 >= EMA100`
- VENTA: `cierre < EMA30 <= EMA50 <= EMA100`

Si el gatillo no mira las EMAs, no se emite. No hay otra restricción: ni
umbrales, ni distancias, ni anti-rango, ni bloqueos inventados.

## Qué ves cuando llega la alerta

La alerta ya trae el código de la jugada, el precio y la hora, y además:

- **Tendencia:** `ALCISTA (EMA30 > EMA50 > EMA100)` o
  `BAJISTA (EMA30 < EMA50 < EMA100)`.
- **Temporalidad mayor:** M15/H1 y su tendencia.

Así, cuando abres la gráfica, lo primero que confirmas es la pila de EMAs y
luego la jugada. Si la pila no coincide con la alerta, no operas: el bot te
avisó de una oportunidad, pero la última palabra es tuya.

## Qué avisa cada código

| Código | Qué te avisa el bot | Qué haces tú |
|---|---|---|
| `2B` | Toque a EMA30, respeta EMA50 y quiebre con cuerpo de la zona horizontal. El aviso llega en el retesteo al nivel roto. | Esperas el rechazo en el nivel y entras. Si el precio cierra con cuerpo al otro lado de EMA50, el 2B queda anulado y no operas. |
| `2RB` | Igual que `2B`, después de un reset. | Igual, mirando además que las 3 EMAs se estén abriendo y no sigan enredadas. |
| `2` | Segundo toque a EMA30/50, antes del quiebre. | Entras al toque si ves mecha de rechazo y no se perfora EMA50 con cuerpo. Si llegaste tarde y el precio ya corrió, no persigues: esperas el quiebre y el retesteo como `2B`. |
| `2R` | Igual que `2`, con reset. | Igual, pero no entras si la vela atraviesa EMA30 sin frenar. |
| `1` | Engaño previo, regreso y quiebre con cuerpo del nivel del engaño. | Entras tras el cierre si el precio sigue cerca del nivel. Si la vela cerró muy estirada y lejos, esperas 1–2 velas de retroceso hacia la zona o EMA30. |
| `1R` | Igual que `1`, con reset. | Igual. Si ves varios `1R` en el mismo nivel y el gráfico no hace extremos nuevos, es rango: no operas. |
| `3` | Tercer toque a EMA30/50, antes del quiebre. | Entras al toque solo con rechazo limpio, EMAs 30/50/100 inclinadas y separadas, y sin pared M15/H1 pegada enfrente. |
| `3R` | Igual que `3`, con reset. | Igual. Si la estructura se ve sucia tras tantos resets, puedes dejarla pasar. |
| `3B` | Tercer toque + quiebre con cuerpo de la zona, al cierre. | Entras al cierre si cerró limpio y cerca del nivel. Si cerró estirado, esperas un respiro hacia la línea rota. |
| `3RB` | Igual que `3B`, con reset y EMA100 inclinada a favor. | Igual. Si es el último suspiro de la tendencia, no operas. |

## Los 4 casos de oro (tú decides no operar)

Estos casos son tu criterio para no operar; no son filtros nuevos del motor.
Dos ya no llegan: las EMAs enredadas no pasan la regla de oro, y el 2B/2RB
queda anulado si el precio cierra con cuerpo al otro lado de EMA50. Si H1 va
en contra, `app.js` ya bloquea el envío. El caso de la vela escapada sí puede
llegar: el bot te avisa y tú no persigues.

1. **Se escapó el precio**: la vela ya recorrió un tramo enorme lejos de EMA30
   y de la zona horizontal. No persigues la vela.
2. **EMAs enredadas**: EMA30/50/100 planas, cruzándose como una trenza. Casi
   todas las señales fallan; esperas a que se abran.
3. **EMA50 perforada en un 2B/2RB**: el precio cierra con cuerpo al otro lado
   de EMA50 en contra. La regla de respeto se rompió: el 2B/2RB queda anulado.
4. **Temporalidad alta en contra**: si operas M1/M2 y en M15/H1 el precio va
   fuerte debajo de todas las EMAs, comprar es ir contra la corriente. Priorizas
   las alertas alineadas con M15/H1; si H1 va en contra, hoy la señal no se envía.

## Cambios mínimos en el código

1. **Estructura**: hoy el impulso y el quiebre no miran las EMAs; las EMAs solo
   etiquetan después. Se añade la comprobación EMA30/50/100 **dentro de
   `escanearEstructura`**, en la vela del gatillo (quiebre o toque), antes de
   emitir. Si no está alineada, no emite. No se filtra en `app.js`.

2. **`2/3/2R/3R`**: la guía dice que son entradas al toque, no avisos. Se
   quitan de `PATRONES_AVISO` y se añaden a `ENTRADAS`, para que Telegram las
   mande como oportunidad y no queden escondidas con `MS_TELEGRAM_TOQUES=0`.

3. **Toque de Raptor**: **no se cambia**. El toque actual ya respeta la guía:
   - VENTA: `mecha >= EMA30 - tol` y `mecha <= EMA50`
   - COMPRA: `mecha <= EMA30 + tol` y `mecha >= EMA50`

   Eso permite apoyarse entre EMA30 y EMA50, pero no perder EMA50. Exigir
   ±tol a ambos lados era una restricción inventada y dejaba fuera apoyos
   válidos de la guía.

4. **M15/H1**: no se añade ningún umbral nuevo. Se mantiene el bloqueo que ya
   existe en `app.js`: si H1 va en contra, la señal no se envía, porque la guía
   lo trata como caso de oro para no operar. Si algún día quieres recibir también
   esas contrarias para decidir tú, se quita ese bloqueo; el aviso ya lleva
   `tendenciaMayor`.

5. **Cuerpo**: se mantiene el cuerpo en todas las `B` (`2B/2RB/3B/3RB`) y en
   `1/1R`, como dice la guía. Las `2/3` son al toque, sin esperar quiebre.

## Verificación

- `npm test` debe seguir en verde.
- Medir en `v03-lab` cuántas señales quedan y su R antes de reiniciar producción.
- Comprobar en el log que toda señal emitida tiene la pila EMA alineada en la
  vela del gatillo.

## Lo que NO se añade

- No hay umbrales de anti-rango.
- No hay filtros de distancia.
- No hay pared M15/H1 con parámetros nuevos.
- No hay bloqueo por “misma jugada”.
- No hay toque simétrico inventado.
- No se toca nada más que la puerta EMA de Estructura y el catálogo `2/3`.

**La estrategia es de EMAs. Si una señal no mira las EMAs, no sale.**
