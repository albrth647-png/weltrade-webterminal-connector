# WT Motor · PWA (señales Weltrade desde tu navegador)

El mismo protocolo revertido y el mismo motor Raptor-like, pero
**sin Termux, sin Node y sin servidor**: todo corre dentro del
navegador de tu teléfono. Tu teléfono es el "servidor"; las señales te
llegan por Telegram y por notificación local.

## Por qué esto funciona

El protocolo revertido nació EN un navegador (el WebTerminal oficial
habla `wss://…/terminal` desde la web de Weltrade). Esta PWA hace lo
mismo:

| Node (conector)       | Navegador (PWA)                          |
|-----------------------|------------------------------------------|
| `crypto` (AES-CBC)    | `crypto.subtle` (AES-CBC nativo del SO)  |
| WebSocket global      | WebSocket nativo                          |
| `Buffer`              | `DataView` / `Uint8Array`                 |
| `.env`                | formulario en pantalla + `sessionStorage` (o `localStorage` solo si marcas «Recordar») |
| HTTP `/estado`        | panel visual en la propia app             |
| consola               | log en pantalla + notificaciones          |

## Instalación en 3 pasos (teléfono Android + Chrome)

### Paso 1 — Publica la carpeta por HTTPS (una sola vez)

Una PWA exige HTTPS (o localhost) para instalarse y abrir WebSocket.
Opciones gratis, en orden de sencillez:

1. **GitHub Pages**: sube la carpeta `pwa/` a un repo y actívalo en
   Settings → Pages. Queda en `https://TUUSUARIO.github.io/REPO/`.
2. **Cualquier hosting estático gratis** (Netlify / Cloudflare Pages /
   Vercel): arrastra la carpeta `pwa/` y listo.

> Publica la carpeta completa tal cual (los 11 archivos) y en una ruta
> estable: esa URL se convierte en tu app para siempre.

### Paso 2 — Instálala como app

Abre esa URL en Chrome de tu teléfono. Pulsa **«Instalar app»**
(los iconos pegados en el panel de Control) o "Añadir a pantalla de
inicio" en el menú de Chrome. Queda con icono propio, pantalla
completa y sin barra de URL: una app más de tu teléfono.

### Paso 3 — Configura y enciende

Dentro de la app, en **Configuración**:

- **Cuenta** y **Contraseña**: de tu cuenta demo/real de Weltrade.
- **Servidor**: `mt5.demo.weltrade.org` (demo) o `mt5.real.weltrade.org`.
- **Símbolos**: vacío = todos los sintéticos (FX/SFX Vol, Boom, Crash…),
  o lista (`FX Vol 20, FX Vol 60, FX Vol 99`).
- **Score mínimo**: 60 por defecto (el mismo del backtest de 3.341 señales).
- **Telegram**: token de tu bot + tu chat ID (crea el bot con @BotFather
  y consigue tu ID con @userinfobot). Valídalo con «Probar Telegram».

Y pulsa **Conectar**. El chip verde dirá "listo" cuando el catálogo y la
suscripción estén montados; entonces el motor siembra el historial
(H1/M15/M5 vía cmd 11) y entra en marcha.

## Qué hace cada pieza

```
pwa/
├── index.html    → interfaz: estado, señales, control, config, log
├── app.js        → cables: conexión, siembra, reconexión, Wake Lock,
│                   Telegram, notificaciones, instalación
├── proto.js      → protocolo revertido sobre WebCrypto (cmd 0/28/6/7/8/11/51)
├── motor.js      → estrategia Raptor-like idéntica a motor-senales/
│                   estrategia.js + señales a Telegram (Bot API)
├── velas_db.js   → histórico de velas en IndexedDB (persistente)
├── sw.js         → cache de la app-shell auto-versionada por hash SHA-256
│                   (cambia cualquier fichero → caché nueva sola) y manejo
│                   de pulsos de notificación
├── manifest.json → manifiesto PWA (iconos, standalone, portrait)
└── icono-192/512/mascara .png, icono.svg
```

## Histórico de velas: persistente e incremental

La primera conexión descarga por símbolo **H1 45 días, M15 22 días y M5 11
días** (≈ 300 KB) y lo guarda en **IndexedDB**, no en `localStorage` (su
límite de ~5 MB no da ni para un tercio del histórico). El motor retiene
1000 velas H1, 2000 M15 y 3000 M5. En cada reconexión solo se piden las
velas **posteriores a la última guardada**; el rango completo se vuelve a
pedir únicamente si la caché es más corta que ese búfer (primera vez o si
acabas de ampliar el rango). Las velas que cierra el motor también se
guardan, un símbolo cada 3 s, para no reescribir todo el histórico.

## Los 3 límites honestos

1. **Android puede matar el navegador en segundo plano.** La app lo
   contrarresta con un **Wake Lock**: con la app abierta en pantalla,
   el teléfono no se duerme mientras el motor corre (chip "pantalla:
   encendida"). El truco es usarla *en modo aplicación* (instalada,
   standalone): así ocupa la pantalla que tú ya tienes encendida.
   Si la conexión cae al volver, se **reconecta sola** con backoff de
   3 s a 30 s.
2. **No es un servidor compartido**: nadie más puede leer tu estado
   desde fuera. Tus canales externos son Telegram y las notificaciones
   locales del teléfono.
3. **Credenciales en el teléfono**: cuenta, contraseña y token de
   Telegram viven en `sessionStorage` de TU navegador (mueren al cerrar
   la app) y solo pasan a `localStorage` si marcas explícitamente
   **«Recordar credenciales en este dispositivo»** (no hay backend).
   Aun así: usa un bot dedicado y, si prefieres máxima seguridad, deja
   Telegram vacío y lee las señales en pantalla.

## Probar antes de instalar (opcional, en PC)

```bash
# desde la raíz del proyecto:
python3 -m http.server 8091 --directory pwa
# abre http://localhost:8091 en Chrome de escritorio
```

Sirve para verificar la lógica, pero el modo correcto de uso es el
teléfono con «Instalar app».

## Siguientes pasos posibles

- Comprobar en vivo que el servidor de Weltrade acepta el header `Origin`
  de tu dominio de Pages (la terminal oficial manda uno desde su web).
  Si lo rechazara, hay rutas alternativas: proxy WS propio o WebView con
  el WebTerminal embebido.
- Panel de velas M15 en `<canvas>` para ver las zonas dibujadas en vivo.
- Cmd 17 (cuenta): balance/equity en la cabecera cuando se revierta
  por completo la estructura del registro.
