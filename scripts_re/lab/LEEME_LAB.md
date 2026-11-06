# Laboratorio MT5 en GitHub Actions — RE del bot sin PC

Este directorio permite radiografiar bots `.ex5` (p. ej. `HobbieCode_GoldRush.ex5`)
**ejecutándolos** en runners gratuitos de GitHub, sin PC propio:

1. **MT5 Lab (Linux/Wine)** — `.github/workflows/mt5-lab-linux.yml` (1× minutos)
   Instala Wine + Xvfb + MetaTrader 5, hace login DEMO por `/config`, corre el bot en el
   **Probador de Estrategias** (`[Tester]` + `Shutdown=1` + `Report=`) y, en paralelo,
   **vuelca la memoria de terminal64.exe** leyendo `/proc/<pid>/mem` (el `.ex5` está
   descifrado en RAM). Extrae strings en formato interno MQL5 (`scan_strings.py`,
   técnica Meepwn CTF 2018: `[len:u32][utf-16]` + XOR secuencial). Opción `run_ghidra`
   para localizar el **cargador .ex5** dentro del terminal con Ghidra headless
   (`find_constants.py`, constantes de la radiografía: 0x2E8/0xA8/0x1A8/0x2A8/0xA0).

2. **MT5 Lab (Windows nativo)** — `.github/workflows/mt5-lab-windows.yml` (2× minutos)
   Fallback sin Wine: MT5 nativo + `comsvcs.dll MiniDump`.

## Requisitos (los gestiona el asistente con el token)

- **Release `bot-assets`** en el repo con el `.ex5` del bot (subido por API; el binario
  NO entra en la historia de git).
- **Secrets** `MT5_SERVER`, `MT5_LOGIN`, `MT5_PASSWORD` de una cuenta **DEMO**
  (también se pueden pasar como inputs del dispatch; los inputs son visibles en la
  corrida, los secrets no).

## Ejecución manual (sin asistente)

`Actions → MT5 Lab (Linux/Wine) → Run workflow → rellenar inputs → Run`.
Resultado: artifact `mt5-lab-results` con `log_*.log`, `report_goldrush_report.*`
(informe de operaciones), `strings_runtime.txt`, `strings_claves.txt`,
`ghidra_loader_report.json` (si se activó Ghidra).

## Qué se hace con el resultado

El **informe de operaciones** del tester alimenta las recetas oficiales de MetaQuotes
("Reverse Engineering of Strategy": comparación bayesiana de reglas, MDL, semi-Markov,
autómata de órdenes) → documento de estrategia JSON → importador del motor Raptor de la
PWA. Los strings de RAM aportan parámetros/nombres de indicadores reales del bot.

## Advertencias

- Solo cuentas **DEMO** (nunca credenciales reales).
- Si el bot valida licencia contra servidor propio, el tester puede rechazarlo: igual
  se obtienen logs y strings del arranque.
- Job limitado a 5 h (`timeout-minutes: 300`); una pasada normal tarda 30–90 min.
- El token del asistente se usa en memoria y se revoca al terminar las tareas.
