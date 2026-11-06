# Motor de Señales Weltrade — estrategia como documento

Motor de señales **original y autónomo** para índices sintéticos de Weltrade,
construido sobre el protocolo MT5 revertido en este repo (`conector/`). No es
el Raptor de SIFO ni pretende serlo: reproduce con lógica propia la **taxonomía
observable** de su sistema de señales (zonas → toques en 3 fases → cancelación,
sesgo multi-timeframe), documentada en `docs/RAPTOR_dossier_intel.md`.

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
ESTRATEGIA (estrategia.js — vocabulario genérico, SIN estrategia)
   ├── ZONAS   pivotes fractales confirmados, agrupados por proximidad
   ├── TOQUES  EARLY (1er contacto) · MAIN (retest tras excursión) · LATE
   ├── TN      cancelación por cierre más allá de la zona
   ├── SESGO   filtro multi-TF por media móvil
   └── SEÑAL   toque + sesgo alineado + gatillo direccional + score ≥ mínimo
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
npm test                   # 35 checks (motor + importador) — deben pasar todos
node app.js                # en marcha: panel http://localhost:3000/ + /estado
```

Salida típica:

```
[INFO] listo: 15 símbolos suscritos
[INFO] sembrando historial H1 de 15 símbolos (cmd 11)...
[INFO] H1 FX Vol 20: 2158 velas (0 descartadas)
[SEÑAL] COMPRA FX Vol 20 fase=MAIN score=80 nivel=114520.10 ...
```

## 5. Telegram (recomendado)

1. Habla con **@BotFather** → `/newbot` → copia el token.
2. Envíale un mensaje cualquiera a tu bot.
3. Abre `https://api.telegram.org/bot<TOKEN>/getUpdates` y saca tu `chat.id`.
4. Pon ambos en `.env` (`TELEGRAM_TOKEN`, `TELEGRAM_CHAT`).

Cada señal llega así:

> 🟢 **COMPRA · FX Vol 20**  (score 80)
> Fase: **MAIN** · Sesgo H1: alza
> Nivel (M15): 114520.10 · Precio: 114524.30
> SL: 114390.10 · TP: 114784.30

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
