# Kit de captura MT5 (ruta A — volcado de memoria)

**Qué es**: un `.bat` que se ejecuta en TU PC con Windows (donde ya corres
los bots) y produce los archivos que necesito para extraer la estrategia de
los bots adversarios compilados (`GoldRush.ex5` etc.).

**Por qué funciona**: el terminal MT5 tiene que descifrar el bytecode del
`.ex5` para ejecutarlo. Ese descifrado ocurre en la RAM del proceso
`terminal64.exe`. Con un volcado de memoria del proceso con el bot cargado,
el bytecode des-cifrado queda atrapado dentro del `.dmp` — y yo desde el
sandbox lo localizo (no está cifrado ahí), lo parseo y le escribo el
des-ensamblador de la VM MQL5.

## Pasos (2 minutos de tu parte)

1. Abre MT5, pon el bot adversario en un gráfico **demo** y déjalo correr
   (mejor si lleva ya minutos operando o si lo pones en el Probador de
   Estrategias, que también lo carga en memoria).
2. Clic derecho en `capturar_mt5.bat` → **Ejecutar como administrador**.
3. Sigue las instrucciones de la ventana (te pide confirmar con una tecla
   justo antes del volcado).
4. Al final tendrás la carpeta `CAPTURA_MT5\` con:
   | Archivo | Peso típico | Para qué |
   |---|---|---|
   | `terminal64.exe` | ~10-30 MB | Análisis estático completo (Ghidra): localizar la rutina de descifrado EX5 |
   | `metaeditor64.exe` | ~10 MB | Ídem (el compilador conoce el formato por dentro) |
   | `terminal64_memoria.dmp` | 1-3 GB | **El bot des-cifrado** + todos los strings/inputs del bot |
   | `procesos.txt` | 1 KB | Contexto |
5. Comprime la carpeta en ZIP y súbeme el ZIP. Si el `.dmp` es demasiado
   grande para una sola subida, sube primero los `.exe` (me dejan preparar
   todo el análisis) y luego el `.dmp` por partes (WinRAR/7zip: "dividir en
   volúmenes de 500 MB").

## Qué NO contiene el kit

- No toca tu cuenta, no envía nada a internet, no instala nada: solo copia
  archivos locales y crea el volcado en tu disco.
- El volcado SÍ contiene tus datos de sesión del terminal (usa demo para
  esta captura, o ciérrala después).

## Qué haré yo al recibirlo

1. `terminal64.exe` → Ghidra: localizar el parser de EX5 (cabecera 0xA8,
   magia "EX5", tabla de secciones), la rutina de descifrado y el formato
   real de la VM MQL5 → documentación del formato con evidencia.
2. `.dmp` → escaneo por las estructuras des-cifradas (firma del bytecode
   MQL5 + tabla de strings UTF-16 de inputs) → extracción del programa del
   bot adversario.
3. Des-ensamblador MQL5 propio (Node) → inventario de inputs, indicadores,
   y flujo de condiciones de compra/venta (nivel 2 del plan).
