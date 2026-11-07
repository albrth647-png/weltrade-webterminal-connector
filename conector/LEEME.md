# Conector Weltrade — Índices Sintéticos en Tiempo Real (Termux)

Conector **nativo y ligero** que se conecta directamente al servidor del
WebTerminal MT5 de Weltrade y transmite los precios de los índices sintéticos
(FX Vol, SFX Vol, FlipX...) en tiempo real, **sin navegador, sin proot, sin
Chromium** — solo Node.js. Pesa ~15 KB y funciona en un teléfono Android con
Termux.

> Logrado mediante ingeniería inversa del cliente web oficial con REA +
> análisis del protocolo (WebSocket binario con AES-256-CBC).

> **Nota:** el zip `weltrade-conector-termux.zip` se eliminó del repo:
> se desactualizaba frente al código vivo. Instala siempre desde esta
> carpeta (`bash instalar.sh`) — es la única fuente de verdad.

---

## 1. Instalación en Termux

```bash
# da permiso al instalador y ejecútalo
bash instalar.sh
```

Eso instala Node.js, **verifica el sha256 de `conector.js`** contra
`conector.js.sha256` (cadena de confianza: si el checksum no coincide, el
instalador aborta; escapa con `bash instalar.sh --sin-verificar`) y copia todo
a `~/weltrade-conector`.

## 2. Configura tus credenciales

```bash
nano ~/weltrade-conector/.env
```

```ini
WT_LOGIN=tu_numero_de_cuenta
WT_PASS=tu_contraseña
WT_HOST=mt5.demo.weltrade.org     # demo (recomendado para empezar)
# WT_HOST=mt5.real.weltrade.org   # cuenta real
WT_FORMAT=json                    # json (para programas) o texto
# WT_SYMBOLS=FX Vol 20,SFX Vol 40 # filtra símbolos (vacío = todos)
```

## 3. Arranca

```bash
termux-wake-lock                  # evita que Android mate el proceso
cd ~/weltrade-conector
node conector.js
```

Salida (JSON Lines, una por línea):

```json
{"tipo":"info","msg":"login aceptado, pidiendo catalogo..."}
{"tipo":"info","msg":"catalogo: 41 simbolos"}
{"tipo":"tick","simbolo":"FX Vol 20","bid":114520.14,"ask":114524.22,"t":1730816741520}
{"tipo":"tick","simbolo":"SFX Vol 40","bid":110326.61,"ask":110351.81,"t":1730816741520}
```

Cada tick llega ~1 vez por segundo por símbolo. Con `WT_FORMAT=texto` la
salida es legible para humanos.

## 4. Consumir los datos desde otro script

```bash
node conector.js | while read linea; do
  # ejemplo: extraer el precio de FX Vol 20 con jq
  echo "$linea" | jq -r 'select(.simbolo=="FX Vol 20") | "\(.bid) \(.ask)"'
done
```

---

## Cómo funciona (protocolo revertido)

| Paso | Detalle |
|---|---|
| Transporte | `wss://<host>/terminal`, frames binarios `[len:u32][flags:u32][datos]` |
| Cifrado | AES-256-CBC, IV de ceros, PKCS#7 |
| Clave inicial | Estática, ofuscada dentro del JS del cliente (char −1) |
| Handshake (cmd 0) | `[r8][r8][u16 cmd][64 bytes]` cifrado con clave estática → el servidor responde `[u16 build][64B id][32B clave de sesión]` |
| Login (cmd 28) | 912 B: contraseña UTF-16LE@4, huella 16B@196 (no validada), servidor `[u32 len]`@476+texto@480, cuenta u32@736 |
| Catálogo (cmd 6) | `[u32 count][registros ×526B]: nombre UTF-16, id u32 @+196` |
| Suscripción (cmd 7) | `[u32 count][u32 id × count]` — construida dinámicamente desde el catálogo |
| Ticks (cmd 8) | registros de 50 B: `[u32 id][u32 hora][f64 bid×100 @12][f64 ask×100 @20][u32 seq @44]` |
| Keep-alive | cmd 51 cada 8 s |
| Cuenta (cmd 17) | balance/equity periódico (estructura pendiente de afinar) |
| Velas (cmd 11) | petición: símbolo UTF-16LE en packet[4], u16 `PERIOD_*` de MT5 en LE @68 (H1=0x4001, M15=15, M5=5...), `[u32 desde][u32 hasta]` @70; respuesta: registros de 48 B `[u32 t][f64 o][f64 h][f64 l][f64 c][u32 vol][u32 ?]`. Verificado en vivo (motor-senales) |

Comandos conocidos: 0=handshake, 3/9=config, 4=market watch, 5=posiciones,
6=catálogo, 7=suscripción ticks, 8=stream ticks, 11=velas, 17=cuenta,
18=especificaciones, 20=gráfico, 28=login, 51=ping.

## Solución de problemas

- **`login rechazado`** → revisa `WT_LOGIN`/`WT_PASS` y que `WT_HOST`
  corresponda al tipo de cuenta (demo ≠ real). Desde la auditoría, un login
  rechazado es **terminal**: el conector NO reintenta en bucle (evita
  bloqueos de cuenta) — corrige el `.env` y relanza.
- **No llega el catálogo** → los servidores de Weltrade a veces reinician la
  sesión; el conector reconecta solo a los 3 s.
- **El teléfono se duerme y se corta** → usa `termux-wake-lock` y desactiva la
  optimización de batería para Termux.
- **Cambio de protocolo** → si Weltrade actualiza el webterminal, la clave
  estática puede cambiar; se re-extrae del JS del cliente (`/terminal/*.js`).

## Avisos importantes

- Herramienta de **uso personal y educativo** para tu propia cuenta. El acceso
  automatizado puede estar restringido por los términos de servicio de
  Weltrade/MetaQuotes — úsala bajo tu responsabilidad, en cuenta demo.
- Los índices sintéticos son mercados generados por el propio broker (él es tu
  contraparte). Ningún conector cambia eso: **informa y gestiona el riesgo**.
