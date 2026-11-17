# v03-lab — banco de pruebas del vídeo 03

Mide y audita la estrategia del **vídeo 03 de Yoel** tal como la calcula
`motor-senales/nucleo.js`. **No reimplementa el motor**: importa `escanear()` y
trabaja sobre sus eventos.

| Archivo | Qué hace |
|---|---|
| `datos.mjs` | carga las 16 series (4 símbolos × M5/M15/M30/H1): CSV de `backtest_hibrida/datos/` o servidor vivo, con caché en `v03-lab/datos/` |
| `evaluar.mjs` | simula cada señal y escribe `reporte.md` + `reporte.json` |
| `probar.mjs` | 23 comprobaciones de datos, motor y método de medición |
| `reporte.md` | resultado de la última ejecución (generado, no editar a mano) |
| `vista.mjs` + `vista.html` | gráfica propia del vídeo 03 servida aparte (proxy local al motor) |

## Comandos

```bash
node v03-lab/evaluar.mjs                      # con los CSV locales
node v03-lab/evaluar.mjs --url http://127.0.0.1:3000
node v03-lab/evaluar.mjs --tf M5,M15
node v03-lab/evaluar.mjs --simbolo "FX Vol 20"
node v03-lab/probar.mjs                       # verificación
node v03-lab/vista.mjs                        # gráfica en http://127.0.0.1:3100
```

## Método

- Entrada al **cierre** de la vela de la señal; stop en `invalida`.
- Objetivo **1,5R**, horizonte **12 velas**; si no toca nada, salida al cierre.
- Stop y objetivo en la misma vela → **stop** (conservador).
- **70 %** inicial de cada serie para train, **30 %** final para validación.
- Operaciones sin 12 velas por delante se descartan; no se rellenan.
- Sin comisiones: los índices sintéticos del bróker ya llevan su spread en el precio.

## Qué separa el reporte

1. **Toques vs toques con rotura.** `1`, `2` y `3` son entradas; se separan las
   que esperan la rotura (`1`, `1R`, `2B`, `2RB`, `3B`, `3RB`) de las que entran
   solo al toque (`2`, `2R`, `3`, `3R`).
2. **El quiebre lleva cuerpo y la `2B` espera retesteo.** El diccionario del
   propietario pide «quiebra **con cuerpo** el mínimo anterior» en todas las `B`
   y `2B`/`2RB` como «quiebre + retesteo». Ambas reglas están activas
   (`cuerpoSoloUno: false`, `modo2B: 'retesteo'`) y el reporte mide también las
   variantes sin ellas, para ver cuánto cuesta cada una.
3. **El reset es `R`.** No es un patrón: cuando una jugada se consume, la
   secuencia 1/2/3 vuelve a empezar. El motor ya lo hace así
   (`resetTrasEntrada: true`); el reporte incluye además un control con la
   lectura alternativa (resetar solo al salir de la tendencia).
4. Totales por código, temporalidad y símbolo, con train y validación separados.

## Resultado de referencia (2026-11-14)

16 series · 54.432 velas · 1.529 señales · 1.510 simulables.

| Grupo | n | Esperanza R | Acierto | PF | Train | Validación |
|---|---|---|---|---|---|---|
| Todo el catálogo | 1.510 | −0,107 | 37,7 % | 0,82 | −0,117 | −0,085 |
| **Solo roturas** | 470 | **+0,070** | 47,2 % | 1,15 | **+0,056** | **+0,096** |
| Solo toque (`2`/`3`) | 1.040 | −0,186 | 33,4 % | 0,72 | −0,193 | −0,172 |

Mejores roturas: `3RB` +0,295 (n=63) · `2RB` +0,149 (n=49) · `1` +0,067 (n=32).
Peor: `2B` −0,060 (n=26) y `3B` +0,014 (n=32).

Cada regla del diccionario mejora el grupo de roturas pero elimina señales:
`+0,070` con cuerpo y retesteo, `+0,046` con la versión anterior (1.596 señales,
558 roturas). La tabla completa de variantes está en `reporte.md`.

## Límites

- Muestra por código pequeña (n≈20–270): cualquier esperanza con n<30 es ruido.
- 14 de 1.057 toques tienen el stop pegado a la entrada (no operables); en las
  roturas la invalidación siempre queda al otro lado del precio.
- El reparto por código cambia con la nomenclatura: sirve para separar entradas
  al toque de entradas con rotura, no para coronar un código.
- 30 días de índices sintéticos no son una garantía.

Estado de fidelidad regla por regla: `docs/estrategia/video_03_estado.md`.

## La vista (`vista.mjs` + `vista.html`)

Gráfica separada del `/grafica` del motor y sin tocar `servidor.js`: el proceso
lee del motor vivo y sirve su propio HTML.

```bash
node v03-lab/vista.mjs                 # http://127.0.0.1:3100
MS_URL=http://127.0.0.1:3000 VISTA_PORT=3100 node v03-lab/vista.mjs
```

| Ruta | Devuelve |
|---|---|
| `/` | `vista.html` |
| `/api/velas?simbolo&tf&barras&ultima` | velas + eventos + EMAs del símbolo, recortados al final (`ultima=1` devuelve solo el último cierre y `sd`) |
| `/api/estado` | estado del motor y lista de símbolos |

La vista **no calcula señales por su cuenta**: llama a `escanear()` de
`motor-senales/nucleo.js` y a su `ema()`, y dibuja esos eventos tal cual.

- `offset`/`barras` recortan la serie; el escaneo se hace sobre la serie completa
  para que los eventos y las EMAs no cambien al mover la vista.
- `ahora` es el último tick que reporta el motor y `sd` la desviación típica de
  los retornos de las últimas 500 velas (en puntos base): sirve para comprobar
  que cada nombre lleva su propia serie (Vol 40 ≈ 2× Vol 20).
- Si el último tick queda más de dos velas por detrás del reloj real, la cabecera
  avisa «motor parado», el punto se pone rojo y la última vela se marca con un
  recuadro discontinuo: es una vela sin terminar, no un movimiento del precio.
- Refresco cada 5 s; los cuatro precios, cada 60 s.
