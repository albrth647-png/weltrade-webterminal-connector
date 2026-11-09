# Motor de Señales Weltrade — estrategia como documento

Motor de señales para índices sintéticos de Weltrade, construido sobre el
protocolo MT5 revertido en este repo (`conector/`). El motor en vivo es la
**RAPTOR HÍBRIDA**: el catálogo del propietario (toques 1 · 2 · 3, rompimientos
1R · 2R · 3R · 1RB · 2RB · 3RB, seductora 1S) traído de `estrategias/raptor_hibrida.py` a Node, con las zonas
fractales, las fases **EARLY / MAIN / LATE**, el sesgo EMA30 y el score.
Cada temporalidad aplica la estrategia completa con sus propias velas.

Al port no se le cree nada: se verifica contra el Python (**1.650 señales, 0
diferencias**) y cada etiqueta se re-audita con sus reglas (0 violaciones).

- **Sin dependencias npm** — solo Node.js ≥ 22 (WebSocket global).
- Corre en Termux, PC, o en la nube (Render free / Oracle Always Free).
- Señales por consola y por **Telegram**.
- Endpoint HTTP `/salud` + `/estado` (para Render y el pinger externo).
- **La estrategia vive en documentos, no en el código**: se importa desde el
  panel web con un botón (`/`), incluidos documentos de bots de MT5.

---

## 1. Cómo funciona

```
wss://mt5.demo.weltrade.org/terminal        (WSS binario + AES-256-CBC)
   │  cmd 0 handshake → cmd 28 login → cmd 6 catálogo → cmd 7 suscripción
   │
   ├── cmd 8  → ticks en vivo (~1/s por símbolo)
   │             └─ agregación local: M5 (gatillo) · M15 (zonas) · H1 (sesgo)
   ├── cmd 11 → velas de arranque (TFs y días según el documento activo)
   │
   ▼
GESTOR DE ESTRATEGIA (gestor_estrategia.js)
   └── DOCUMENTO activo: estrategias/activa.json
       (si no existe: estrategias/raptor_default.json)
   ▼
MOTOR HÍBRIDO (estrategia_hibrida.js + raptor_hibrida.js + raptor_core.js)
   ├── CATÁLOGO 1 · 2 · 3 (toque) · 1R · 2R · 3R (rompimiento) ·
   │            1RB · 2RB · 3RB (rompimiento con reset) · 1S (la seductora; MS_SEDUCTORA=0 la apaga)
   ├── ZONAS   pivotes fractales confirmados, refuerzo y TN
   ├── FASES   EARLY (1er contacto) · MAIN (retest tras excursión) · LATE
   ├── SESGO   EMA30 con pendiente + gatillo direccional (por TF)
   └── SEÑAL   patrón + fase + zona + score   (MS_MOTOR=v1 deja el motor viejo)
   ▼
CONSOLA + TELEGRAM + PANEL WEB (botón importar) + HTTP /estado
```

**Todos los números (pesos, TFs, SL/TP, score mínimo, dedup, periodos) salen
del documento de estrategia.** El código solo conoce el vocabulario: si falta
un campo del documento, la validación lo rechaza y lista exactamente qué falta.

## 2. Archivos

| Archivo | Qué es |
|---|---|
| `cliente_mt5.js` | Cliente del protocolo (login, ticks, velas). Eventos: `listo`, `tick`, `velas`, `cerrar` |
| `estrategia.js` | Motor puro SIN estrategia: zonas, fases de toque, TN, sesgo, scoring — todo configurable |
| `doc_estrategia.js` | Esquema del documento de estrategia + validación ESTRICTA (cero valores de estrategia) |
| `importador.js` | Importa documentos externos a documento de estrategia (ver tabla abajo) |
| `gestor_estrategia.js` | Carga/activa/persiste el documento activo (`estrategias/activa.json`) |
| `ui.html` | Panel web con el botón de importación (servido en `/`) |
| `servidor.js` | HTTP: `/`, `/salud`, `/estado`, `/estrategia`, `/importar`, `/estrategia/activar`… |
| `telegram.js` | Notificaciones (Bot API, sin deps) |
| `app.js` | Punto de entrada: cablea todo + reconexión + hot-swap de estrategia |
| `estrategias/` | Documentos de estrategia (`raptor_default.json`, `activa.json`, `importados/`) |
| `test_estrategia.js` | Tests offline del escenario completo (EARLY→MAIN→LATE→TN) |
| `test_importador.js` | Tests del importador con documentos sintéticos y un .ex5 real |
| `.env.ejemplo` | Plantilla de configuración (solo credenciales y switches — nada de estrategia) |

## 3. Estrategia como documento + botón de importación

El panel web (`http://localhost:3000/`) tiene:

- **Estrategia activa** — nombre, fuente y parámetros clave del documento vigente.
- **Importar documento** — botón que acepta:

| Formato | Qué hace |
|---|---|
| `.json` / `.md` / `.txt` | Documento de estrategia directo o con bloque ` ```json ``` ` dentro |
| `.set` | Parámetros de un Expert de MT5: mapea los reconocibles y lista el resto |
| `.tpl` | Plantilla de gráfico de MT5: extrae indicadores (MA/EMA, ATR, Fractals…) |
| `.mq5` / `.mq4` / `.mqh` | Código fuente: extrae `inputs`, llamadas a indicadores (iMA, iATR, iFractals, iStochastic…), SL/TP → **anatomía** del bot, nunca su clon |
| `.ex5` / `.ex4` | Bot compilado: **radiografía de cabecera** (autor, link, versión, build, fecha, entropía). El cuerpo va cifrado por MetaQuotes: sin reglas legibles sin ingeniería inversa del terminal (fase 2) |
| `.mt5` | Cualquier documento de bot de MT5: se identifica por **contenido** (magia EX5/EX4 → radiografía; texto con json/.tpl/.set dentro → su importador) |

La PWA (`pwa/`) tiene su propio **botón de radiografía** (`radio.js`) que analiza
esta misma familia de archivos EN el navegador del teléfono, sin enviar el
archivo a ningún servidor.

- Tras importar: **borrador editable** → **Validar** → **Activar**. Al activar,
  el motor se reconstruye en caliente y re-siembra el historial sin reiniciar.
- **Descargar activa** y **Restaurar integrada** para volver a la referencia.

Todo documento importado queda copiado en `estrategias/importados/` (auditoría).
Honestidad ante todo: el importador **no inventa estrategia** — los borradores
parten de la plantilla neutra y solo aplican parámetros extraídos con certeza.

## 4. Puesta en marcha

```bash
cd motor-senales
cp .env.ejemplo .env
nano .env                  # credenciales + Telegram (opcional)
npm test                   # 76 checks (motor + importador + PWA)
npm run validar:port       # el port Node vs el Python: 1.650 señales, 0 diferencias
npm run validar:reglas     # re-audita cada etiqueta contra su regla: 0 violaciones
npm run demo:hibrida       # replay de velas reales con el formato de mensaje
node app.js                # en marcha: panel http://localhost:3000/ + /estado
```

`validar:port` y `validar:reglas` necesitan los CSV de `backtest_hibrida/datos/`
(están en `.gitignore`: son datos, no código).

Salida típica:

```
[INFO] listo: 15 símbolos suscritos
[INFO] sembrando historial H1 de 15 símbolos (cmd 11)...
[INFO] H1 FX Vol 20: 2158 velas (0 descartadas)
[SEÑAL] VENTA FX Vol 20 2R score=85 precio=117037.47 estrategia=Raptor-híbrida v2
```

## 5. Telegram (recomendado)

1. Habla con **@BotFather** → `/newbot` → copia el token.
2. Envíale un mensaje cualquiera a tu bot.
3. Abre `https://api.telegram.org/bot<TOKEN>/getUpdates` y saca tu `chat.id`.
4. Pon ambos en `.env` (`TELEGRAM_TOKEN`, `TELEGRAM_CHAT`).

Cada señal llega así:

> 🟢 **COMPRA**
> **1. Activo:** SFX Vol 40
> **2. Temporalidad:** H1
> **3. Estrategia:** 3R · MAIN · Raptor-híbrida v2
> **4. Precio:** 119652.19
> **5. Hora:** 2026-11-08 13:00 UTC

El código delante es el **patrón que disparó la señal** (catálogo de Yoel) y, si
la zona estaba en confluencia, la fase de la zona (`EARLY`/`MAIN`/`LATE`). Los
avisos `2`/`3` **no se envían como operación**: son «ve a buscar la entrada» y
salen por consola (ver `docs/estrategia/por_que_etiquetar_la_estrategia.md`).

## 6. Despliegue en Render (gratis, 24/7)

El motor usa **WebSocket saliente**, que Render free NO cuenta como actividad:
el servicio se duerme a los 15 min sin tráfico entrante. Solución (verificada):

1. Nuevo **Web Service** → repo → `motor-senales` → start: `node app.js`.
2. Variables: `WT_LOGIN`, `WT_PASS`, `WT_HOST`, `TELEGRAM_*` (la estrategia
   NO se configura por variables: se gestiona desde el panel `/`).
3. **Pinger externo** (cron-job.org o UptimeRobot, gratis): GET a
   `https://tu-app.onrender.com/salud` cada **10 min** → el servicio nunca duerme.
4. Presupuesto: 744 h/mes ≤ 750 h gratis de Render. RAM/CPU: < 10 % de 512 MB.

Alternativa sin límite de sueño: **Oracle Cloud Always Free** (2 OCPU/12 GB).

## 7. Honesto y claro

- Esto **no es** el indicador Raptor ni contiene su lógica interna (esa es
  propietaria y de pago — ver `docs/RAPTOR_dossier_intel.md`). Es un motor
  **original** inspirado en la estructura observable de su sistema.
- Ninguna estrategia de señales garantiza ganancias. Esto es una herramienta
  de análisis para tu cuenta demo/real: **gestiona el riesgo**.
- Úsalo en cuenta **demo** para validar antes de considerar dinero real.
- Los índices sintéticos son generados por el broker (él es tu contraparte).

## 8. Ampliaciones futuras (roadmap)

- **Fase 2 de .ex5**: ingeniería inversa del cargador del terminal MT5 con
  Ghidra (como `scripts_re/`) para hacer un desensamblador propio del bytecode
  y pasar de "radiografía" a "pseudo-lógica" de los bots adversarios.
- Más indicadores configurables en el documento (Stochastic, RSI, Bands…) y
  zonas por densidad de volumen.
- Validación: registrar cada señal y su resultado a +N velas (como el
  "historial de alertas para validación" de SIFO).
- Ejecución automática: comandos de órdenes del protocolo (cmd pendiente de
  revertir en `CKnWTLdC.js`).

## Avisos de zona en tiempo real (opcionales, apagados)

`MS_AVISO_INTRABAR=1` enciende el aviso de que el precio ha llegado a la banda de
una zona fractal (`0,15 × ATR` de M5). **No es una señal de la estrategia** — esas
son los toques `1 · 2 · 3` y sus rompimientos `1R · 2R · 3R` — y el mensaje lo dice
(el rompimiento del toque lleva `R`, o `RB` si la secuencia venía de un reset; la seductora va
aparte, como `1S`, porque no es el rompimiento de ningún toque)
explícitamente. Sale como máximo una vez por símbolo y dirección cada 30 minutos, y
lleva la cotización real (ask al comprar, bid al vender), no el punto medio
`(bid+ask)/2` que se enviaba antes.

## Símbolo y precio: por qué no se cruzan

La respuesta de velas (`cmd 11`) **no dice de qué símbolo es**. Antes se repartía
a todos los pedidos pendientes y, si un lote llegaba partido con más de 700 ms
entre trozos, el resto se pegaba al símbolo siguiente: el búfer de un activo
quedaba con los precios de otro y la señal salía con nombre de uno y precio de
otro. Ahora:

- el lote va **solo** al pedido en curso (`_pendiente11Actual`), y lo que llegue
  sin pedido vivo se descarta;
- hay un cooldown de 800 ms al cerrar cada lote para tragar los trozos tardíos;
- `_loteValido()` descarta el lote si su último cierre se desvía más de un 20 %
  del precio vivo del símbolo (FX Vol 20 ~118.000 · SFX Vol 20 ~35.300: eso no
  es volatilidad, es un cruce).


## Entrega en dos etapas y carril urgente (2026-11-09)

El motor confirmaba la entrada al **cierre** de la vela del rompimiento: medido,
eso son 10 min (p50) en M5, 30 en M15, 60 en M30 y 120 en H1 desde el toque que
arma el nivel. El transporte nunca fue el problema (~4 s de cadena completa y
0,001 ATR de precio perdido al leer el mensaje): el problema es **cuándo nace la
señal**. Por eso ahora hay dos etapas y dos canales:

| Etapa | Cuándo | Canal | Prioridad |
|---|---|---|---|
| 1 · **NIVEL EN JUEGO** | en el tick en que el precio entra en la banda de la zona (M5) | ntfy + alarma local | `high` |
| 2 · **entrada confirmada** (1R/2R/3R, 1RB/2RB/3RB, 1S) | al cierre de la vela | Telegram + ntfy + alarma local | `urgent` |

Variables nuevas:

| Variable | Por defecto | Qué hace |
|---|---|---|
| `NTFY_TOPIC` | — (vacío) | tema de ntfy; sin él, el carril urgente queda en la alarma local |
| `NTFY_URL` | `https://ntfy.sh` | tu servidor ntfy si lo autoalojas |
| `NTFY_TOKEN` | — | token `Bearer` si el tema es privado |
| `MS_ALARMA` | encendida | `0` quita el pitido del PC |
| `MS_ALARMA_CMD` | — | comando de sonido propio (p. ej. `mpv alarma.mp3`) |
| `MS_AVISO_INTRABAR` | encendido | `0` apaga la etapa 1 |
| `MS_TF_VIVO` | `M5` | temporalidades que se envían al móvil; el resto se calcula y se registra |

La etapa 1 **no es una entrada**: avisa de que el nivel está en juego ahora y que
la confirmación llega al cierre. Así se ve el precio llegar en vez de enterarse
cuando ya se fue.
