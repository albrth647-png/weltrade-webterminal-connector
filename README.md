# Weltrade WebTerminal Connector 📡

Conector **nativo y ligero** para recibir en tiempo real los precios de los
**índices sintéticos de Weltrade** (FX Vol, SFX Vol, Step, Boom, Crash,
FlipX...), construido mediante **ingeniería inversa** del cliente web oficial
del MT5 WebTerminal — **sin navegador, sin Chromium, sin proot, sin APIs de
terceros**. Solo Node.js (~15 KB de código), pensado para correr en un
**Android con Termux**.

```
{"tipo":"info","msg":"login aceptado, pidiendo catalogo..."}
{"tipo":"info","msg":"catalogo: 41 simbolos"}
{"tipo":"tick","simbolo":"FX Vol 20","bid":114584.57,"ask":114588.65,"t":1793884714532}
{"tipo":"tick","simbolo":"SFX Vol 99","bid":1194.99,"ask":1195.67,"t":1793884714532}
```

---

## ✅ Verificación final (todo probado antes de publicar)

| Prueba | Resultado |
|---|---|
| Sintaxis de los 13 scripts (`node --check`) | ✅ 13/13 OK |
| **Conector en vivo** contra `mt5.demo.weltrade.org` | ✅ login aceptado |
| Catálogo de símbolos | ✅ 41 símbolos recibidos |
| Suscripción a sintéticos | ✅ 15 símbolos (FX Vol, SFX Vol, FlipX...) |
| Flujo de ticks (60 s de captura) | ✅ **869 ticks, 0 errores** |
| Stack REA (`rea doctor`) | ✅ healthy — 175 comandos CLI, 229 tools MCP |
| Ghidra headless 12.1.4 + JDK 25 | ✅ healthy, decompilación validada |
| Escaneo de credenciales en el repo | ✅ limpio (solo `.env.ejemplo` con placeholder) |

## 📁 Estructura del repo

| Carpeta | Contenido |
|---|---|
| [`conector/`](conector/) | **El producto final**: `conector.js` (protocolo nativo), `instalar.sh` (Termux), `.env.ejemplo`, `LEEME.md` (guía completa + protocolo revertido), muestra de frames reales |
| `weltrade-conector-termux.zip` | El conector empaquetado en un zip para pasar al teléfono |
| [`docs/`](docs/) | Guía de instalación y uso de REA + Ghidra (el stack de ingeniería inversa usado) |
| [`docs/RAPTOR_dossier_intel.md`](docs/RAPTOR_dossier_intel.md) | Dossier de inteligencia: qué es el RAPTOR (EA MT5 de SIFO), su sistema de señales WebScan y el plan de un equivalente propio |
| [`docs/evidencia_sifo_i18n.json`](docs/evidencia_sifo_i18n.json) | Evidencia cruda: objetos i18n literales extraídos del HTML público de sifotrader.com (raptor, signals/WebScan, planes) |
| [`motor-senales/`](motor-senales/) | ⭐ Motor de señales (equivalente propio del estilo Raptor): zonas + toques EARLY/MAIN/LATE + TN + sesgo multi-TF, **estrategia como documento externo** con panel web de importación, tests, Telegram y despliegue Render |
| [`backtest_raptor/`](backtest_raptor/) | Backtest con datos reales (1 año × FX Vol 20/60/99): 3.341 señales, WR 45,7%, PF 1,27 — `reporte.md` + `senales.csv` señal a señal |
| [`scripts_re/`](scripts_re/) | Los 15 scripts con los que se hizo la ingeniería inversa: captura del bundle con REA, decodificación del protocolo, bisect de la clave, verificación del conector, script de Ghidra |
| [`evidencia/`](evidencia/) | Capturas de la sesión real (login demo OK), logs binarios del protocolo, bundle capturado, sesiones decodificadas, JS del cliente oficial (zip) |
| [`pwa/`](pwa/) | PWA de señales (motor en el navegador + IndexedDB + Telegram) con **botón de radiografía de bots MT5**: analiza `.mt5/.ex5/.ex4/.set/.tpl/.mq5/.mq4/.mqh` EN el teléfono, sin enviar el archivo a ningún servidor (`radio.js`) |

## 🧠 Estrategia como documento (CERO estrategia en el código)

El motor **no contiene ninguna estrategia**: solo el vocabulario genérico
(pivotes, fases, TN, sesgo, scoring). Todos los valores viven en un
**documento externo** (`motor-senales/estrategias/`):

- `raptor_default.json` — documento de referencia (= baseline del backtest:
  3.341 señales, PF 1,27). Viaja con el paquete.
- `activa.json` — la estrategia en marcha; se crea al activar desde la web.

### Panel web con botón de importación

Al arrancar `node app.js`, abre `http://localhost:3000/` (o la URL de Render):

1. **Importar documento** — acepta los documentos de bots de MT5 de escritorio:

   | Formato | Qué extrae |
   |---|---|
   | `.json` / `.md` / `.txt` | Documento de estrategia directo (o bloque ```json embebido) |
   | `.set` | Parámetros de un Expert de MT5 → los que coinciden se mapean, el resto se lista |
   | `.tpl` | Plantilla de gráfico: indicadores (EMA→sesgo, ATR→periodo, Fractals→zonas) |
   | `.mq5` / `.mq4` / `.mqh` | Código fuente: inputs, llamadas a indicadores, órdenes C/V (anatomía) |
   | `.ex5` / `.ex4` | **Radiografía**: autor, link, versión, build, entropía — el cuerpo va cifrado por MetaQuotes |
   | `.mt5` | Cualquier documento de bot de MT5: se identifica por **contenido** (magia EX5/EX4 → radiografía; texto → .set/.tpl/.mq5/json embebido) |

2. **Validar** — el validador es ESTRICTO: un documento incompleto se rechaza
   con la lista exacta de lo que falta.
3. **Activar** — hot-swap sin reiniciar: el motor se reconstruye y re-siembra
   el historial al vuelo.

También por API: `POST /importar?nombre=x.set` (cuerpo = bytes crudos),
`POST /estrategia/validar`, `POST /estrategia/activar`,
`POST /estrategia/restaurar`, `GET /estrategia`.

Todo lo importado queda copiado en `estrategias/importados/` (auditoría). El
importador **nunca inventa estrategia**: los borradores parten de la plantilla
neutra y solo aplican parámetros extraídos con certeza. Para el cuerpo cifrado
de los `.ex5/.ex4` (reglas internas del bot adversario) está el plan de
ingeniería inversa en [`docs/REA_Ghidra_Guia.md`](docs/REA_Ghidra_Guia.md).

## 🚀 Arranque rápido (Termux)

```bash
bash instalar.sh          # instala Node.js y copia a ~/weltrade-conector
nano ~/weltrade-conector/.env   # tu cuenta + contraseña
termux-wake-lock          # evita que Android mate el proceso
cd ~/weltrade-conector && node conector.js
```

Salida en JSON Lines (o texto con `WT_FORMAT=texto`), un tick por segundo por
símbolo. Los detalles completos (protocolo, solución de problemas, consumo
desde otro script) están en [`conector/LEEME.md`](conector/LEEME.md).

## 🔐 Cómo funciona (resumen)

- Transporte: `wss://mt5.demo.weltrade.org/terminal` (o `mt5.real...`), frames
  binarios `[len:u32][flags:u32][datos]`.
- Cifrado: **AES-256-CBC** (IV cero, PKCS#7). Clave estática ofuscada dentro
  del JS oficial → el handshake (cmd 0) devuelve la clave de sesión.
- Login (cmd 28): cuerpo de 912 B revertido byte a byte (contraseña UTF-16LE,
  servidor, nº de cuenta).
- Catálogo (cmd 6) → suscripción dinámica (cmd 7) → stream de ticks (cmd 8).
- Detalle completo de la tabla de comandos: [`conector/LEEME.md`](conector/LEEME.md).

Las credenciales **nunca** van dentro del código: se leen del `.env`, que está
en `.gitignore`. El `.env.ejemplo` solo contiene placeholders.

## ⚠️ Avisos

- Herramienta de **uso personal y educativo** para tu propia cuenta. El acceso
  automatizado puede estar restringido por los términos de servicio de
  Weltrade/MetaQuotes: úsala bajo tu responsabilidad, idealmente en demo.
- Los índices sintéticos son mercados generados por el propio broker (él es tu
  contraparte). Ningún conector cambia eso: infórmate y gestiona el riesgo.
- El motor **no incluye ninguna estrategia embebida**: las estrategias son
  documentos externos que tú cargas (de tu propia autoría o revisados por ti).
  Importar la anatomía de un bot ajeno no sustituye respetar su licencia.
