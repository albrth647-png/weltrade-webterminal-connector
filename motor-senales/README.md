# Motor de Señales Weltrade — equivalente propio del estilo "Raptor"

Motor de señales **original y autónomo** para índices sintéticos de Weltrade,
construido sobre el protocolo MT5 revertido en este repo (`conector/`). No es
el Raptor de SIFO ni pretende serlo: reproduce con lógica propia la **taxonomía
observable** de su sistema de señales (zonas → toques en 3 fases → cancelación,
sesgo multi-timeframe), documentada en `docs/RAPTOR_dossier_intel.md`.

- **Sin dependencias npm** — solo Node.js ≥ 22 (WebSocket global).
- Corre en Termux, PC, o en la nube (Render free / Oracle Always Free).
- Señales por consola y por **Telegram**.
- Endpoint HTTP `/salud` + `/estado` (para Render y el pinger externo).

---

## 1. Cómo funciona

```
wss://mt5.demo.weltrade.org/terminal        (WSS binario + AES-256-CBC)
   │  cmd 0 handshake → cmd 28 login → cmd 6 catálogo → cmd 7 suscripción
   │
   ├── cmd 8  → ticks en vivo (~1/s por símbolo)
   │             └─ agregación local: M5 (gatillo) · M15 (zonas) · H1 (sesgo)
   ├── cmd 11 → velas de arranque H1 (90d) + M15 (15d) + M5 (3d)
   │           (descubierto: el campo de TF usa el enum PERIOD_* de MT5)
   │
   ▼
ESTRATEGIA (estrategia.js)
   ├── ZONAS   pivotes fractales M15 confirmados, agrupados por proximidad
   │           (fuerza = nº de pivotes que comparten nivel)
   ├── TOQUES  EARLY (1er contacto) · MAIN (retest tras rebote ≥ 1.2×ATR)
   │           · LATE (contactos extra, score bajo)
   ├── TN      cancelación: cierre M15 a > 0.5×ATR del nivel mata la zona
   ├── SESGO   H1: EMA(30) + pendiente → alza / baja / lateral
   └── SEÑAL   toque + sesgo alineado + vela M5 direccional
               score = fase (25/40/15) + fuerza zona (≤25) + alineación (25)
                       + direccional (10)   →  emite si score ≥ 60
               incluye SL (1×ATR) y TP (2×ATR) sugeridos
   ▼
CONSOLA + TELEGRAM + HTTP /estado
```

Todo se calcula con **velas cerradas** (sin mirar el futuro) y con **test
automático offline** que valida cada pieza (`npm test`).

## 2. Archivos

| Archivo | Qué es |
|---|---|
| `cliente_mt5.js` | Cliente del protocolo (login, ticks, velas H1). Eventos: `listo`, `tick`, `velas`, `cerrar` |
| `estrategia.js` | Motor puro: zonas, fases de toque, TN, sesgo, scoring. Sin I/O |
| `telegram.js` | Notificaciones (Bot API, sin deps) |
| `servidor.js` | HTTP `/salud` y `/estado` |
| `app.js` | Punto de entrada: cablea todo + reconexión con backoff |
| `test_estrategia.js` | Tests offline del escenario completo (EARLY→MAIN→LATE→TN) |
| `.env.ejemplo` | Plantilla de configuración |

## 3. Puesta en marcha

```bash
cd motor-senales
cp .env.ejemplo .env
nano .env                  # credenciales + Telegram (opcional)
node test_estrategia.js    # 9 checks — deben pasar todos
node app.js                # en marcha: consola + http://localhost:3000/estado
```

Salida típica:

```
[INFO] listo: 15 símbolos suscritos
[INFO] sembrando historial H1 de 15 símbolos (cmd 11)...
[INFO] H1 FX Vol 20: 2158 velas (0 descartadas)
[SEÑAL] COMPRA FX Vol 20 fase=MAIN score=80 nivel=114520.10 ...
```

## 4. Telegram (recomendado)

1. Habla con **@BotFather** → `/newbot` → copia el token.
2. Envíale un mensaje cualquiera a tu bot.
3. Abre `https://api.telegram.org/bot<TOKEN>/getUpdates` y saca tu `chat.id`.
4. Pon ambos en `.env` (`TELEGRAM_TOKEN`, `TELEGRAM_CHAT`).

Cada señal llega así:

> 🟢 **COMPRA · FX Vol 20**  (score 80)
> Fase: **MAIN** · Sesgo H1: alza
> Nivel (M15): 114520.10 · Precio: 114524.30
> SL: 114390.10 · TP: 114784.30

## 5. Despliegue en Render (gratis, 24/7)

El motor usa **WebSocket saliente**, que Render free NO cuenta como actividad:
el servicio se duerme a los 15 min sin tráfico entrante. Solución (verificada):

1. Nuevo **Web Service** → repo → `motor-senales` → start: `node app.js`.
2. Variables: `WT_LOGIN`, `WT_PASS`, `WT_HOST`, `TELEGRAM_*`, `MS_SCORE_MIN`.
3. **Pinger externo** (cron-job.org o UptimeRobot, gratis): GET a
   `https://tu-app.onrender.com/salud` cada **10 min** → el servicio nunca duerme.
4. Presupuesto: 744 h/mes ≤ 750 h gratis de Render. RAM/CPU: < 10 % de 512 MB.

Alternativa sin límite de sueño: **Oracle Cloud Always Free** (2 OCPU/12 GB).

## 6. Honesto y claro

- Esto **no es** el indicador Raptor ni contiene su lógica interna (esa es
  propietaria y de pago — ver `docs/RAPTOR_dossier_intel.md`). Es un motor
  **original** inspirado en la estructura observable de su sistema.
- Ninguna estrategia de señales garantiza ganancias. Esto es una herramienta
  de análisis para tu cuenta demo/real: **gestiona el riesgo**.
- Úsalo en cuenta **demo** para validar antes de considerar dinero real.
- Los índices sintéticos son generados por el broker (él es tu contraparte).

## 7. Ampliaciones futuras (roadmap)

- Más TFs de gatillo (M1 scalp) y zonas por densidad de volumen.
- Validación: registrar cada señal y su resultado a +N velas (como el
  "historial de alertas para validación" de SIFO).
- Ejecución automática: comandos de órdenes del protocolo (cmd pendiente de
  revertir en `CKnWTLdC.js`).
