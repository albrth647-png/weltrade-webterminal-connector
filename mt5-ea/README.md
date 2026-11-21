# MT5 adversario (demo) → Telegram

Instala MetaTrader 5 en un runner **Windows** de GitHub Actions, entra en tu
cuenta **demo**, compila y arranca el EA adversario, y **el propio EA** manda
cada señal de la escalera a tu Telegram.

No hace falta tu PC ni tu teléfono: lanzas el workflow y el EA trabaja en la PC
virtual de GitHub.

## Scripts

La lógica del runner vive aquí, un archivo por tarea; el workflow solo los llama:

| Archivo | Qué hace |
|---|---|
| `scripts/instalar_mt5.ps1` | instala el terminal y compila el EA (receta verificada: 0 errores, 0 warnings) |
| `scripts/ejecutar_ea.ps1` | escribe `adv.cfg`/`adv.ini`, arranca el terminal, vigila la sesión y entrega a Telegram lo que el EA no pudo enviar |

**Entrega en dos capas.** El EA manda con `WebRequest`. Si MetaTrader lo bloquea
(`http=-1 error=4014`: la URL no está en su lista blanca y en modo headless no
hay forma fiable de meterla), el EA deja el mensaje en
`MQL5/Files/adv_pendientes.txt` y `ejecutar_ea.ps1` lo entrega con
`Invoke-RestMethod` al mismo bot y chat. El log muestra `Telegram ok: msg <id>`.

## Qué calcula

El EA es un port a MQL5 de la escalera de `motor-senales/nucleo.js`
(`_escanearCore`), con los mismos parámetros:

| Código | Qué es | Entrada |
|---|---|---|
| `1` / `1R` | la seductora: salida sobre EMA50, vuelta y quiebre con cuerpo | al quiebre |
| `2` / `2R` | 2.º toque a la EMA30 | al toque |
| `3` / `3R` | 3.er toque (con extensión mínima) | al toque |
| `2B` / `2RB` | 2.º toque + quiebre del mínimo anterior | en el retesteo del nivel |
| `3B` / `3RB` | 3.er toque + quiebre | al cierre del quiebre |
| `1E` / `1RE` | Estructura: impulso + retroceso + quiebre | al quiebre |
| `2EB` / `2REB` | Estructura: 2.º retroceso + quiebre | al quiebre |
| `3EB` / `3REB` | Estructura: 3.er retroceso + quiebre | al quiebre |
| `2E` / `2RE`, `3E` / `3RE` | Estructura: 2.º y 3.er retroceso | aviso, no entrada |

`R` = reset, igual que tu escalera `1E,2E,3E → 1RE,2RE,3RE`.

Filtros idénticos al núcleo: pila EMA30/50/100 alineada, toque dentro de
0,30 ATR, "con cuerpo" ≥ 50 % del rango y ≥ 0,10 ATR, caducidad del quiebre
3 velas, separación 2 velas entre toques, enfriamiento 8 velas por lado.

Si las dos estrategias dan código para la misma vela y el mismo lado, sale
una sola señal: gana la de mayor prioridad (entrada > aviso; tier A > B > C),
igual que `prioridadEvento` en el núcleo.

El mensaje es el mismo de 7 campos que ya conoces (activo, temporalidad,
estrategia, tendencia, precio, invalidación, hora en Habana). El campo 4
lleva además la tendencia mayor del motor: `· H1 ALCISTA · en tendencia`,
calculada igual que `serieEstructural` (pivotes por cierre k=5, margen
0,25 ATR, fase contra la EMA30 de H1).

## Antes de lanzarlo: los datos

Secrets del repo (Settings → Secrets and variables → Actions):

| Secret | Qué es |
|---|---|
| `MT5_LOGIN` | número de la cuenta demo |
| `MT5_PASSWORD` | contraseña de la demo |
| `MT5_SERVER` | nombre exacto del servidor (abajo a la derecha en MT5) |
| `TELEGRAM_TOKEN` | token del bot |
| `TELEGRAM_CHAT` | chat o grupo destino (puede ser negativo) |

Variable opcional (Settings → Variables):

| Variable | Ejemplo |
|---|---|
| `MT5_SYMBOLS` | `FX Vol 20,FX Vol 40,SFX Vol 20,SFX Vol 40` |

Si el nombre del símbolo no coincide letra a letra con el del bróker, el EA
prueba por nombre normalizado (sin espacios, puntos ni guiones) y lo escribe en
el log. Si no lo encuentra, lo dice: `SIMBOLO NO ENCONTRADO`.

## Lanzarlo

Actions → **MT5 adversario (demo -> Telegram)** → *Run workflow*.

- `minutos`: cuánto queda abierto el terminal (por defecto 240, tope 330).
- `tf`: temporalidad a escanear (`M1`, `M5`, `M15`).

## Cómo saber que funciona

1. Al minuto llega a Telegram **EA ADVERSARIO ARRANCADO** con la cuenta, los
   activos resueltos y el horario del servidor. Si ese mensaje no llega, nada
   de lo demás va a llegar: revisa el token o el chat.
2. En el resumen del run aparece la lista de líneas `[SENAL]`.
3. Cada 15 min el log escribe un latido con el precio de cada activo; con
   `precios=1` (por defecto) ese snapshot también se manda a Telegram, para
   verificar que los activos coinciden con tu MT5.

Los logs quedan como artifact `mt5-adversario-logs`
(`adv.log`, `adv_enviados.txt` y los logs del terminal).

## Límites reales

- **6 horas por job** (aquí se usa 330 min por seguridad). Al acabar, el runner
  se destruye: lanza el workflow otra vez. No hay forma de dejarlo 24/7 sin
  saltarse el reglamento de Actions, que prohíbe el uso como servidor.
- El terminal tarda **1-3 minutos** en arrancar y descargar histórico. Las
  señales de las velas que cierren en ese hueco no existen.
- La tendencia mayor H1 se calcula dentro del EA con la serie H1 del bróker
  (1.500 velas), no con la del motor: mismo algoritmo, misma fuente, pero es
  una lectura propia.
- El EA **no opera**. La cuenta demo se usa únicamente para tener el feed del
  bróker.

## Archivos

- `EstrategiaAdversaria.mq5` — el EA (lee `MQL5/Files/adv.cfg`).
- `../.github/workflows/mt5-adversario.yml` — instalación, compilación y
  arranque en el runner.

`adv.cfg` lo genera el workflow, no se versiona:

```
token=...
chat=...
simbolos=FX Vol 20,FX Vol 40,SFX Vol 20,SFX Vol 40
tf=M5
velas=3000
latido=15
precios=1
```

`precios=0` desactiva el envío de snapshots (solo señales).
