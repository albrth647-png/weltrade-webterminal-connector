# Auditoría — señales del motor → Telegram (2026-11-08)

Alcance: cómo se construye cada mensaje de señal, qué lo dispara y qué puede
romper la entrega. Evidencia: código, `npm test` (75 checks: protocolo,
estrategia, importador), arranque real del servidor y Bot API (`getMe`,
`getWebhookInfo`, `getUpdates`).

Veredicto: **código y formato cerrados y en verde; queda un bloqueo de
configuración** (`TELEGRAM_CHAT`, no existe todavía) y una decisión de
estrategia (v1 en vivo vs híbrida v2 del backtest).

## 1. Formato del mensaje

```
🟢 COMPRA
1. Activo: SFX Vol 40
2. Temporalidad: M15 · entrada M5
3. Estrategia: Raptor-propio v1
4. Precio: 2458.12
5. Hora: 2026-11-08 14:35 UTC
```

Pedido del propietario (2026-11-08): **sin SL/TP en el mensaje** y con el código de la
estrategia de Yoel en el campo 3 (`1, 2, 3, 2B, 2RB…`). El formateador ya acepta `patron` y
lo antepone al nombre; producir ese código exige portar el catálogo v2 al motor Node
(ver `docs/estrategia/por_que_etiquetar_la_estrategia.md`).

| Campo | Origen (`estrategia.js`, evento `senal`) | Comprobado |
|---|---|---|
| COMPRA / VENTA | `lado` (icono 🟢 / 🔴) | ✔ test |
| 1. Activo | `simbolo` (escapado HTML) | ✔ test |
| 2. Temporalidad | `tfZona` + `tfGatillo` | ✔ test |
| 3. Estrategia | `doc.meta.nombre + ' v' + version`, inyectado en `docACfg` | ✔ test |
| 4. Precio | `precio` = cierre de la vela de gatillo | ✔ |
| 5. Hora | `t` = cierre de esa vela (epoch ms, UTC) | ✔ test |

El «score», la fase y el motivo siguen calculándose y saliendo por consola,
pero ya no van en el mensaje. Tampoco SL/TP: se quitaron el 2026-11-09 (el
cálculo usaba `distZonaAtr`, una distancia en ATR, como si fueran puntos de
precio, así que los niveles salían ~100 veces más juntos de lo debido). La PWA
también los dejó de mostrar en la tarjeta, el log y la notificación.

### Avisos 2/2R/3/3R (canal separado)

```
⚠️ AVISO 2R — no es entrada
🔴 VENTA
1. Activo: FX Vol 20
2. Temporalidad: M15
3. Zona: resistencia (fuerza 3)
4. Precio de referencia: 118687.24 (cierre de la vela)
5. Nivel a romper: 118640.10
6. Hora: 2026-11-09 14:35 UTC
```

Salen por el evento `alerta` (no por `aviso`, que es el canal de logs y
errores) y a Telegram por defecto (`MS_TELEGRAM_TOQUES=0` —o el nombre viejo
`MS_TELEGRAM_AVISOS=0`— los silencia y deja al móvil solo las entradas
1R/2R/3R). Antes se descartaban
antes de emitirse, porque el guard de precio se aplicaba a unos eventos que el
núcleo crea con `entry = NaN`.

## 2. Cuándo se dispara

Dos caminos, y conviene no confundirlos:

- **Entradas (1, 1R, 1RB, 2B, 2RB, 3B, 3RB)**: solo con **vela cerrada**. El
  timer cierra la vela 3 s después del cierre teórico y evalúa con ese cierre
  confirmado; no hay señales que repinten. Si el bróker entrega después la
  misma vela con otro OHLC, se **re-evalúa** (firma OHLC) para no perder la
  señal que la vela sintética del tick no vio.
- **Avisos (2, 2R, 3, 3R)**: al cerrar la vela (`origen: 'cierre'`) y también
  **intrabar**: en cuanto el precio entra en la banda de una zona activa de M5
  sale el mensaje, sin esperar al cierre (`origen: 'intrabar'`, 1 por
  zona/dirección cada 30 min). Es el único camino que avisa *en* el toque.

Otras reglas:

- Un mensaje por vela, clase y dirección; y una entrada por zona/dirección
  cada 30 min, aunque la vean M5, M15, M30 y H1 (antes se mandaba hasta 4 veces).
- Al sembrar no se emite una vela cuyo cierre sea más antiguo que
  `max(2 min, ½ TF)`: una señal de una vela vieja es una señal que el mercado
  ya recorrió.
- Se descarta la vela en formación al sembrar; si no, quedaría congelada y
  bloquearía el cierre real de esa misma vela.
- Retención de 1 mes por TF (`DIAS_RETENCION = 30`).

### Entrega

- Cola con dos carriles: **entradas antes que avisos**, 1,1 s entre arranques
  (límite del Bot API) y timeout de 4 s. Un POST lento ya **no** frena a los
  siguientes (antes la cola era una cadena y un timeout de 10 s paraba a todos).
- **Outbox** en `motor-senales/.outbox.json`: el texto se guarda antes de
  enviar y se borra al confirmar. Al arrancar se reenvía lo pendiente y se
  recuerdan las claves de vela ya emitidas, así un reinicio no repite ni pierde.
- Cada entrega registra el `message_id`; `/estado` expone
  `telegram.enviados/fallos/pendientes` y `outbox`.

## 3. Hallazgos

| # | Sev | Hallazgo | Estado |
|---|---|---|---|
| B1 | **Bloqueo** | Falta `TELEGRAM_CHAT`: `telegramConfigurado()` = false y no sale ninguna señal. El token solo no basta | **Cerrado** — `chat.id 5115792503` (@gundaAdmin) guardado en `.env`; dos señales de prueba **entregadas** (`ok:true`) |
| A1 | Alta | `/estado` y `POST /estrategia/activar` sin autenticación: en una IP pública cualquiera leía la última señal o cambiaba la estrategia | **Corregido** — sin `ESTADO_TOKEN` el servidor escucha solo en `127.0.0.1`; con token se abre y exige cabecera/`?token=` (verificado: 401 sin token) |
| A2 | Alta | El motor en vivo emite la **v1** (zonas M15 + fases + score), no el catálogo híbrido v2 que se backtesteó | **Pendiente de decisión** — el campo «3. Estrategia» ya identifica en el mensaje qué estrategia lo generó. Portar v2 al motor Node cambia todas las señales en vivo: es un trabajo aparte, no un arreglo de fontanería |
| M1 | Media | El reintento ante timeout podía **duplicar** un mensaje (el primer POST sí llegó) | **Corregido** — timeout/red ya no se reintentan; solo 429 y 5xx, que son rechazos del servidor |
| M2 | Media | Sin límite de envíos: varias señales seguidas podían acabar en 429 | **Corregido** — cola de envío con 1,1 s entre mensajes (límite del Bot API ≈1/s por chat) |
| M3 | Baja | El precio de entrada es el cierre de la vela ya cerrada: al leer el mensaje el precio puede haberse movido; SL/TP siguen válidos | Documentado |
| M4 | Baja | `.env` con `MS_SIMBOLOS=FX Vol 20,...` sin comillas no se puede `source` desde bash; el cargador propio de `cliente_mt5.js` sí lo lee | Documentado, sin impacto |

## 4. Verificado

- `npm test` → **75 OK / 0 fallos** (incluye el formato nuevo línea a línea,
  escape HTML, hora UTC y el caso VENTA).
- Servidor: sin `ESTADO_TOKEN` → `escucha en 127.0.0.1`; con token →
  `0.0.0.0` y `/estado` devuelve **401** sin credencial.
- Token válido: `getMe` → bot **@ZenicMbot** (`id 9001411471`).
- `getWebhookInfo`: sin webhook, `pending_update_count: 0` → el bot aún no ha
  recibido ningún mensaje, por eso `getUpdates` viene vacío.
- Aviso de arranque si falta token o chat (antes pasaba desapercibido).
- Token nunca se loguea ni aparece en `/estado`; `.env` en `chmod 600` y
  cubierto por `.gitignore`.

## 5. Siguiente paso

1. Escribir cualquier mensaje a **@ZenicMbot** → `getUpdates` da el `chat.id`
   → guardarlo como `TELEGRAM_CHAT` → enviar una señal de prueba real (B1).
2. Decidir si se porta el catálogo híbrido v2 al motor Node o se opera la v1
   etiquetada como tal (A2).
