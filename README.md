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
| [`conector/`](conector/) | **El producto final**: `conector.js` (protocolo nativo), `instalar.sh` (Termux, con verificación sha256), `.env.ejemplo`, `LEEME.md` (guía completa + protocolo revertido), muestra de frames reales |
| [`docs/`](docs/) | Guía de instalación y uso de REA + Ghidra (el stack de ingeniería inversa usado) · [`auditoria_proyecto.md`](docs/auditoria_proyecto.md) — auditoría completa del proyecto y correcciones aplicadas |
| [`docs/RAPTOR_dossier_intel.md`](docs/RAPTOR_dossier_intel.md) | Dossier de inteligencia: qué es el RAPTOR (EA MT5 de SIFO), su sistema de señales WebScan y el plan de un equivalente propio |
| [`docs/evidencia_sifo_i18n.json`](docs/evidencia_sifo_i18n.json) | Evidencia cruda: objetos i18n literales extraídos del HTML público de sifotrader.com (raptor, signals/WebScan, planes) |
| [`motor-senales/`](motor-senales/) | ⭐ Motor de señales alineado al **vídeo 03 de Yoel**: catálogo `1 · 2 · 3 · 2B · 2RB · 3B · 3RB` con reset `R` sobre EMA30/50/100, tests (núcleo + protocolo + carril urgente), Telegram y despliegue Render |
| [`backtest_raptor/`](backtest_raptor/) | Backtest con datos reales (1 año × FX Vol 20/60/99): 3.341 señales, WR 45,7%, PF 1,27 — `reporte.md` + `senales.csv` señal a señal |
| [`scripts_re/`](scripts_re/) | Los 15 scripts con los que se hizo la ingeniería inversa: captura del bundle con REA, decodificación del protocolo, bisect de la clave, verificación del conector, script de Ghidra |
| [`evidencia/`](evidencia/) | Capturas de la sesión real (login demo OK), logs binarios del protocolo, bundle capturado, sesiones decodificadas, JS del cliente oficial (zip) |
| [`pwa/`](pwa/) | PWA de señales (motor en el navegador + IndexedDB + Telegram) con **botón de radiografía de bots MT5**: analiza `.mt5/.ex5/.ex4/.set/.tpl/.mq5/.mq4/.mqh` EN el teléfono, sin enviar el archivo a ningún servidor (`radio.js`) |

## 🧠 La estrategia: el catálogo del vídeo 03

El motor ya **no** lleva documento externo ni panel de importación: corre una
sola estrategia, la del vídeo 03 de Yoel, implementada en
[`motor-senales/nucleo.js`](motor-senales/nucleo.js).

| Código | Qué es | ¿Entrada? |
|---|---|---|
| `1` | la seductora: se sale sobre la EMA50, regresa y quiebra **con cuerpo** | sí |
| `2` / `3` | 2.º y 3.er toque a la EMA30 | aviso |
| `2B` / `3B` | toque + cierre que rompe el mínimo anterior | sí |
| `R` | la jugada repetida: `1R`, `2R`, `3R`, `2RB`, `3RB` | según la base |

Todas se miden igual: toque a la **EMA30** que no supera la **EMA50**, con
tendencia comprobada (precio y EMAs 30/50/100 alineadas). No existe `1B`: el
quiebre ya va dentro de la 1. La especificación con las citas del vídeo y los
parámetros estimados está en
[`docs/estrategia/video_03_reglas_implementables.md`](docs/estrategia/video_03_reglas_implementables.md).

Los `.ex5/.ex4` siguen teniendo su sitio: la **radiografía** del bot adversario
en la PWA ([`pwa/radio.js`](pwa/radio.js)) y el plan de ingeniería inversa en
[`docs/REA_Ghidra_Guia.md`](docs/REA_Ghidra_Guia.md).

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

## 🔒 Seguridad aplicada (auditoría 2026-11-08)

La auditoría completa (0 hallazgos altos · 6 medios · 10 bajos, en
[`docs/auditoria_proyecto.md`](docs/auditoria_proyecto.md)) está **corregida**:

- **P0**: paro del reintento infinito con credenciales rechazadas (los 3
  clientes) y guard de 32 B en la clave de sesión con log y cierre (antes:
  fallo mudo). La PWA avisa con el chip «credenciales rechazadas (n/3)».
- **P1**: credenciales de la PWA en `sessionStorage` por defecto (casilla
  «Recordar» opcional), caché del service worker auto-versionada por hash
  SHA-256 del contenido (adiós al bump manual `wt-pwa-vN`) y test permanente
  del protocolo con paridad Node↔PWA (`motor-senales/test_protocolo.mjs`,
  50 checks, incluido en `npm test`).
- **P2**: token opcional `ESTADO_TOKEN` en `/estado`,
  huella del login en UTF-8 también en la PWA, contador de reconexiones solo
  automáticas, metadatos iOS, zip redundante eliminado y verificación sha256
  en `instalar.sh`.

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
