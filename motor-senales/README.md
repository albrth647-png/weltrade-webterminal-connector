# Motor de Señales Weltrade — catálogo del vídeo 03

Motor de señales para índices sintéticos de Weltrade, construido sobre el
protocolo MT5 de este repo (`conector/`) y con **una sola estrategia: la del
vídeo 03 de Yoel**, paso a paso. No hay zonas fractales, ni fases
EARLY/MAIN/LATE, ni score: eso era el motor anterior y se borró.

- **Sin dependencias npm** — solo Node.js ≥ 22 (WebSocket global).
- Señales por consola y por **Telegram** (+ carril urgente ntfy, opcional).
- Endpoints `/salud` y `/estado`.

La especificación de cada regla, con las citas del vídeo y los parámetros
estimados, está en [`docs/estrategia/video_03_reglas_implementables.md`](../docs/estrategia/video_03_reglas_implementables.md).

---

## 1. El catálogo

| Código | Qué es | ¿Entrada? |
|---|---|---|
| `1` | la seductora: se sale sobre la EMA50, regresa y quiebra **con cuerpo** el mínimo del engaño | **sí** |
| `2` | segundo toque a la EMA30, **superando** el mínimo del primero | aviso |
| `3` | tercer toque, tras superar el mínimo de la 2 | aviso |
| `2B` | segundo toque + cierre que rompe el mínimo anterior («las mejores»); no pide cuerpo | **sí** |
| `3B` | tercer toque que rompe el mínimo anterior; no pide cuerpo | **sí** |
| `R` | la misma jugada repetida en la misma dirección: `1R`, `2R`, `3R`, `2RB`, `3RB` | según la base |
| `1B` | **no existe**: el quiebre ya va dentro de la 1 | — |

Todas se miden igual: toque a la **EMA30** que no supera la **EMA50**, con
tendencia comprobada (precio y EMAs 30/50/100 alineadas).

**Regla de envío:** el bot solo manda una señal si su lado coincide con la
tendencia EMA30/50/100 de su TF — `ALCISTA` → `COMPRA`, `BAJISTA` → `VENTA`;
`LATERAL` no se envía. Además, no puede ir contra el TF mayor (`H1` por
defecto): si H1 es bajista, ninguna COMPRA de M1/M5/M15 sale; si H1 es
lateral, se permite la señal del TF menor. Cada mensaje (entrada y aviso)
indica **Estrategia** y **Tendencia**.

**Una vela, un lado:** si el bróker revisa el cierre o la vela construida con
ticks no coincide con la oficial, el bot no envía el lado contrario al que ya
envió para esa vela. Se descarta y queda en el log como revisión contradictoria;
la vela del servidor siempre manda sobre la de ticks. El bloqueo se aplica
después de los filtros de tendencia, así que una señal descartada por H1 no
impide que una revisión válida mande el lado contrario.

**Una señal por vela M5:** RAPTOR y Estructura pueden disparar en la misma
vela y lado (16 casos en 30 días). El motor emite solo la de mayor prioridad
—entrada antes que aviso y, entre entradas, tier A > B > C— y marca la otra
como ya vista para que no salga en una revisión posterior del bróker. La
gráfica sí dibuja las dos, porque son señales reales del escaneo.

**Vela cerrada:** las entradas se calculan con la vela ya cerrada. No se
dispara una entrada con la vela viva: una señal intrabar puede desaparecer y
Telegram no permite corregirla. Si se añade el «al toque», será como aviso
provisional, nunca como entrada.

Y las cinco condiciones que el vídeo dice y que el motor ya aplica:

1. **Extensión**: el 2.º toque tiene que superar el mínimo (máximo en compra)
   del 1.º; el 3.º, el del 2.º. Sin extensión no hay `2`, `3` ni `B`.
2. **Cuerpo**: lo exigen **todas** las `B` (`1`, `2B`, `3B` y sus reseteadas):
   «quiebra **con cuerpo** el mínimo anterior». Antes solo lo pedía la `1`.
3. **El engaño caduca**: si el precio vuelve y el quiebre llega 12 velas
   después de la última salida sobre el techo, ya no es una `1`.
4. **El techo manda**: un cierre más allá de la EMA50 cancela el toque
   pendiente, aunque llegue antes de la caducidad del quiebre.
5. **Reset**: la jugada que se fue sobre la EMA50 y volvió lleva `R` en la
   siguiente, no solo la que se operó.
6. **El nivel de la `1`**: rompe el mínimo del **tramo del engaño**, no el de
   las 12 velas previas al toque (`nivelUnoPorEngano`).

La `2B` tiene tres lecturas y el modo se elige por parámetro:
`modo2B: 'retesteo'` (**por defecto**, diccionario del propietario: «quiebre +
retesteo»: el quiebre arma la jugada y la entrada espera la vuelta al nivel,
dentro de `caducidadRetesteo` velas y con `tolRetesteoAtr` de tolerancia),
`modo2B: 'continuacion'` (se opera el quiebre al cierre) o
`modo2B: 'reversion'` (Sperandeo: se opera el **fracaso** del quiebre, al otro
lado, con stop en el extremo marginal). Con retesteo y cuerpo en las `B` el
grupo de roturas pasa de +0,046R (n=558) a **+0,070R (n=470)**; las tres
variantes se miden en `v03-lab/reporte.md`.

## 2. Archivos

| Archivo | Qué es |
|---|---|
| `cliente_mt5.js` | Cliente del protocolo MT5 (login, ticks, velas) |
| `nucleo.js` | **Las reglas**: EMAs, ATR, toques, engaño, quiebre y reset. Escaneo puro y determinista |
| `telegram.js` | Formato y entrega de los mensajes (cola, reintentos, escape) |
| `urgente.js` | Push ntfy + alarma local (la señal llega antes que por Telegram) |
| `outbox.js` | Ni una señal se pierde ni se duplica al reiniciar |
| `servidor.js` | `/salud` y `/estado` |
| `app.js` | Arranque: cliente → núcleo → canales, con reconexión |
| `test_nucleo.mjs` | Serie sintética que genera cada código y comprueba los invariantes |
| `calibrar.mjs` | Calibra los parámetros con datos reales: 2.025 combinaciones, elige con el 70 % y valida con el 30 % |
| `test_protocolo.mjs`, `test_urgente.mjs` | Protocolo MT5 y carril urgente |

## 3. Puesta en marcha

```bash
cd motor-senales
cp .env.ejemplo .env
nano .env                  # credenciales + Telegram (opcional)
npm test
node app.js                # en marcha: /salud y /estado
```

En producción, arranca bajo el supervisor: relanza el motor si el proceso
muere por un fallo no capturado (el motor sale con código 1 y deja el stack
en `motor.log`).

```bash
setsid nohup ./supervisor.sh >> motor.log 2>&1 < /dev/null & disown
# parada ordenada (no se relanza):
touch .supervisor-stop && pkill -f "[s]upervisor.sh"
```

Variables que afectan al motor:

| Variable | Por defecto | Qué hace |
|---|---|---|
| `MS_SIMBOLOS` | todos | lista separada por comas |
| `MS_TF` | `M1,M5,M15,H1` | temporalidades escaneadas (RAPTOR: solo M1/M5/M15/H1) |
| `MS_TF_VIVO` | todas las de `MS_TF` | las que se envían al móvil |
| `MS_TF_TENDENCIA` | `H1` | TF mayor que manda el lado: si H1 es bajista no se envía ninguna COMPRA; si es lateral, se permite el TF menor |
| `MS_MAX_LATENCIA_MS` | 1 periodo + 15 s | antigüedad máxima de una señal; más vieja se descarta |
| `MS_GUARDAR_MS` | `600000` | freno de persistencia del estado (ms); por defecto una escritura cada 10 min |
| `MS_OUTBOX_MAX_EDAD_MIN` | `15` | al arrancar, descarta pendientes de Telegram más viejos que N minutos |
| `MS_CACHE_VELAS_MS` | `5000` | cuánto se reutilizan zonas y señales de `/velas` para la misma última vela |
| `MS_HOSTS_PERMITIDOS` | — | hosts extra aceptados en `Host:` (coma); Render usa `RENDER_EXTERNAL_HOSTNAME` |
| `MS_RATE_LIMITE` | `120` | peticiones HTTP por IP y ventana antes de responder 429 |
| `MS_RATE_VENTANA_MS` | `60000` | tamaño de la ventana del rate limit (ms) |
| `MS_TELEGRAM_TOQUES` | encendido | `0` deja el móvil solo con las entradas (2/3 y sus R llegan como aviso, no como señal) |
| `MS_SOLO_RAYAS` | `0` | `1` apaga RAPTOR y deja solo el modo de prueba de rayas |
| `MS_RAYAS` | `0` | `1` vuelve a calcular y enviar las rayas de tendencia |
| `TELEGRAM_TOKEN`, `TELEGRAM_CHAT` | — | Bot API |
| `NTFY_TOPIC` | — | push instantáneo |
| `ESTADO_TOKEN` | — | protege `/estado` y abre el servidor a `0.0.0.0` |

El servidor solo acepta `Host` de loopback, IPs privadas y los declarados en
`MS_HOSTS_PERMITIDOS`/`RENDER_EXTERNAL_HOSTNAME` (corta DNS rebinding con un
403). Un cuerpo mayor de 64 KB devuelve 413 y la conexión se cierra limpia.
`/velas` entrega solo `velas`, `zonas` y `senales`: es lo único que dibuja la
gráfica.

Los números de las reglas (tolerancia del toque, ventana del mínimo anterior,
cuerpo mínimo, caducidad del quiebre y del engaño) están en `PARAMS` de
`nucleo.js`. El vídeo no los da: se **calibraron** con 4 símbolos × 4
temporalidades × 30 días (`npm run calibrar`) y con las reglas completas dan
0,032R de esperanza en train y 0,084R en validación (antes de añadirlas:
0,092R / 0,044R). La validación sube; el train baja porque la `1` del vídeo
genera más señales. El detalle está en
[`docs/estrategia/video_03_reglas_implementables.md`](../docs/estrategia/video_03_reglas_implementables.md#11-calibración-con-datos-reales-2026-11-10).

## 4. Honesto y claro

- Esto **no es** el indicador Raptor ni contiene su lógica interna.
- Ninguna estrategia de señales garantiza ganancias. Valida en **demo**.
- Los índices sintéticos los genera el broker: él es tu contraparte.
