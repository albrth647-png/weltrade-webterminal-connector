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

Se importa **solo M1** y el motor genera M3, M5, M15, M30, H1 y H4 por
remuestreo (`resampleTimeframes`), conservando la cámara y el zoom al cambiar.

Medido con los datos reales de FX Vol 20 (1.049.532 velas M1, dos años):

- Importación y primer pintado: **8 s** (escritorio).
- Zoom con rueda + paneo táctil: **55 fps**.
- Cambio de temporalidad: **~0,15 s**.

## Cargar datos

1. Descarga el artifact `datos-mt5-csv` del workflow de exportación (o el
   `FX_Vol_20_M1.csv` de `datos_out/`).
2. Abre la app → **Elegir archivo CSV**.
3. El archivo se guarda en el dispositivo; las siguientes veces abre directo.

Se aceptan cabeceras en español o inglés, separador `;`, `,` o tabulador,
coma decimal y fechas `2024.11.24 10:00`, ISO o epoch.

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
