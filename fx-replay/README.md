# FX Replay

Replay manual de **FX Vol 20** para el móvil, 100 % local y sin conexión.
Nada se calcula ni se opera de forma automática: las entradas, el stop loss y el
take profit los pones tú.

## Qué hay dentro

| Pieza | Detalle |
| --- | --- |
| Motor de gráfico | [TradeCanvas](https://tradecanvas.dev) 2.17 (MIT, sin dependencias): 18 tipos de gráfico, 134 indicadores, 76 herramientas de dibujo, replay de barras, órdenes arrastrables y 30 idiomas. |
| Interfaz | Vite + TypeScript estricto, tema oscuro, español. |
| Datos | Se importan una vez y quedan en **IndexedDB** (columnas `Float64Array`, sin duplicar memoria). |
| Parseo | Web Worker: un CSV de 72 MB no bloquea la pantalla. |
| Operaciones | `PaperExecutionAdapter`: fills virtuales, SL/TP manuales y cierre por SL, TP o a mano. |
| Diario | Aciertos, profit factor, R medio, racha, neto y lista de operaciones; exportable a JSON. |
| PWA | Service worker y manifiesto: instalable y offline si se sirve por HTTPS. |
| APK | Capacitor + Gradle, compilado en GitHub Actions. |

## Temporalidades

La **temporalidad base** es la del archivo importado y se detecta midiendo la
separación típica entre velas (no hace falta que el nombre lo diga). A partir de
eella el motor genera las superiores por remuestreo (`resampleTimeframes`),
conservando la cámara y el zoom al cambiar. Un M1 da M1 → H4; un H4 da solo H4.

Medido con los datos reales de FX Vol 20 (1.049.532 velas M1, dos años):

- Importación y primer pintado: **8 s** (escritorio).
- Zoom con rueda + paneo táctil: **55 fps**.
- Cambio de temporalidad: **~0,15 s**.

## Cargar datos

Sirven los archivos de `albrth647-png/syntx-historico` tal cual (`charts/1/FX-Vol-20.csv.gz`)
y los CSV de MT5.

1. Descarga los `.csv.gz` que quieras (puedes elegir varios a la vez, incluso los 41).
2. Abre la app → **Elegir archivos**.
3. Cada activo queda guardado en el dispositivo; para cambiar de uno a otro toca
   el **nombre del activo** en la cabecera.

Formatos aceptados: `.csv.gz` (gzip) y `.csv`, cabeceras en español o inglés,
separador `;`, `,` o tabulador, coma decimal y fechas `2024.11.24 10:00`, ISO o
epoch en segundos/milisegundos. Las columnas `time,open,high,low,close` del repo
SyntX entran directamente. El volumen es opcional.

Ojo con el espacio: cada activo M1 ocupa unos 40 MB en el móvil. La hoja de
activos muestra cuánto llevas usado y permite borrar los que no uses.

## Compilar

```bash
npm install
npm run dev      # desarrollo
npm run build    # dist/
```

APK: workflow **APK Android** (`.github/workflows/apk.yml`). Genera el proyecto
Android con `cap add android` en el runner, compila `assembleDebug` y publica
`fx-replay-apk` como artifact. Se instala con "Instalar desde archivos" en el
móvil.

## Reglas del proyecto

- Nada automático dentro del gráfico: sin indicadores precargados, sin fibs
  automáticos, sin SL/TP sugeridos.
- Todo el estado (datos, dibujos, operaciones) vive en el dispositivo.
- `tsc --noEmit` debe pasar antes de compilar: Vite no comprueba tipos.
