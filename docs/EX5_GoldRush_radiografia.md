# Radiografía forense EX5 — HobbieCode GoldRush (fase 2, nivel 1)

**Fecha**: 2026-11-06 · **Método**: análisis estático sin descifrar (herramienta propia `scripts_re/radiografia_ex5.js`, disponible en el repo del proyecto de señales).
**Veredicto en una línea**: el nivel 1 está CERRADO — inventario completo extraído; todo lo demás (reglas de compra/venta) vive en un cuerpo cifrado real cuya clave solo tiene el terminal MT5. Para el nivel 2 hay que capturar el programa DES-CIFRADO desde la memoria del terminal en un PC Windows (ruta A) o observar su conducta (ruta B).

---

## 1. Ficha técnica

| Campo | Valor |
|---|---|
| Archivo | `HobbieCode_GoldRush.ex5` |
| SHA-256 | `a542743bc01dd717b56739385cf5fdf0a2ed357b8255d7f7eeeeced8768371bb` |
| Tamaño | 163.442 bytes (159,6 KB) |
| Formato | MetaQuotes EX5, versión de formato **2** |
| Zona legible | 0x000 – 0x2E8 (744 bytes = 0,5 % del archivo) |
| Cuerpo cifrado | 0x2E8 – final (162.698 bytes = 99,5 %) |
| Compilador | build moderno de MT5 (cabecera con blobs de hash de 16 y 32 bytes) |

## 2. Mapa de la cabecera (0x000 – 0x2E8, todo en claro)

| Offset | Contenido | Valor | Interpretación |
|---|---|---|---|
| 0x00 | magia | `EX5` + byte 0x02 | firma + versión de formato |
| 0x04 | u16 / u16 | 113 / 6.140 | candidatos: versión de cabecera / flags |
| 0x08 | u32 | 1.088 (0x440) | candidato: tamaño u offset de una tabla interna |
| 0x0E | u16 | 256 (0x100) | candidato: versión mínima de terminal (build) |
| 0x10 | u32 | 1.252 (0x4E4) | candidato: tamaño total de cabecera+tablas |
| 0x20 | 16 bytes | `8f 54 27 b2 0c a7 f9 13 d1 ef b7 a0 98 8c 98 46` | hash del programa (candidato MD5) |
| 0x40 | u32 | 78 (0x4E) | candidato: nº de elementos en una tabla |
| 0x58 | u32 | 1.024 (0x400) | candidato: tamaño reservado |
| 0x60 / 0x64 | u32 / u32 | 3.937 / 3.937 | tamaño duplicado (candidato: bytes de código/origen) |
| 0x68 | u32+u32 | 0x081FF640 / 128 | candidato: tamaño descomprimido + tamaño de bloque |
| 0x6C | u32 | 128 (0x80) | ídem (candidato: tamaño de clave/bloque) |
| 0x80 | 32 bytes | `4f ca 71 60 92 0f 91 9d 40 01 0e ee 74 9a cc 38 9b 5e e6 fd 33 20 8a f2 1c d1 fe 95 18 ee 11 c9` | hash del cuerpo cifrado (candidato SHA-256) |
| 0xA0 | u32 | `b8 be 9a 6a` + 4 ceros | candidato: CRC/checksum del programa |
| 0xA8 | UTF-16LE (256 B) | **"HobbieCode - Ramon Ruiz"** | propiedad *copyright/autor* |
| 0x1A8 | UTF-16LE (256 B) | **"https://hobbiecode.com"** | propiedad *link* |
| 0x2A8 | UTF-16LE (64 B) | **"1.00"** | propiedad *version* |
| 0x2E0 | u64 | 0 | separador/placeholder — justo antes del cuerpo |

Los tres slots de texto son los únicos datos legibles de todo el archivo. **No hay ningún input, nombre de variable, mensaje ni símbolo en claro** — en builds antiguos de MT4/MT5 los inputs viajaban en claro; desde builds 600+ van dentro del bloque cifrado.

## 3. Criptoanálisis del cuerpo (0x2E8 – final)

| Prueba | Resultado | Lectura |
|---|---|---|
| Entropía media | **7,999 bits/byte** (8 = aleatorio perfecto) | cifrado fuerte, no ofuscación ligera |
| Entropía por segmentos (inicio/¼/½/¾) | 7,96 · 7,96 · 7,96 · 7,96 | homogéneo: un solo cifrado, sin secciones mezcladas |
| Chi-cuadrado (64 KB) | **269** (uniforme ideal ≈ 255) | distribución de bytes indistinguible del azar |
| Bloques de 16 B repetidos | **0 de 10.168** | descarta ECB con tabla estática → CBC/CTR o cifrado propio |
| Compresión zlib/gzip cruda en offsets candidatos | ❌ ningún stream válido | NO es solo compresión: hay cifrado real |
| Alineación 16 B | 162.698 = 16k + 10 | no alineado a AES puro → cabecera interna del bloque cifrado o cifrado en flujo |

**Conclusión**: MetaQuotes cifra el bytecode compilado con clave por archivo (probablemente derivada de datos de la cabecera y/o del propio terminal). No es descifrable por fuerza bruta ni con claves estáticas: el descifrado ocurre DENTRO de `terminal64.exe`/`metatester64.exe` justo antes de que la VM de MQL5 ejecute el programa.

## 4. Inventario completo de strings (nivel 1)

- UTF-16LE legibles: 3 (autor, link, versión — sección 2)
- ASCII legibles: solo ruido criptográfico (103 fragmentos aleatorios de 6–12 bytes) — cero vocabulario del bot
- Consecuencia: **ni siquiera el nombre de los inputs es extraíble estáticamente**. El nivel 1 queda cerrado con este inventario: es todo lo que el archivo da sin el terminal.

## 5. Recon del instalador MT5 (contexto de la fase 2)

Se descargó el instalador oficial desde el CDN de MetaQuotes (`https://download.mql5.com/cdn/web/metaquotes.software.corp/mt5/mt5setup.exe`, 23,7 MB, PE32+ x64 firmado por MetaQuotes via DigiCert):

- **También está protegido**: secciones `.text/.rdata/.data/.pdata` con tamaño raw = 0 (virtualizadas) y una sección `.cod2` de 5,3 MB con 256 bytes únicos por ventana de 64 K (entropía máxima). Protector comercial tipo VMProtect/Themida o el empaquetador propio de MetaQuotes.
- Strings inaccesibles: no hay URLs del CDN en claro, no hay nombres de funciones del cargador.
- El `terminal64.exe` completo **no se sirve suelto** en el CDN (probadas 4 rutas candidatas: 404 en GET y HEAD).

Consecuencia: la ruta C (ingeniería inversa del cargador del terminal) exige **primero desempaquetar el instalador** — proyecto caro. La ruta A evita todo eso.

## 6. Rutas para el nivel 2 (pseudo-lógica del bot)

### Ruta A — Volcado de memoria en tu PC (RECOMENDADA: horas, no semanas)
El terminal TIENE que descifrar el programa para ejecutarlo. Ese instante se captura:
1. Instala MT5 en tu PC Windows (ya lo tienes si corres bots) y copia `GoldRush.ex5` a `MQL5/Experts/`.
2. Ejecuta el bot en gráfico demo (o en el Probador de Estrategias — mejor: el agente de pruebas `metatester64.exe` carga el bot igual).
3. Con el bot cargado, vuelca la memoria del proceso: con Process Hacker / x64dbg / `MiniDumpWriteDump` (o el propio Administrador de tareas → "Crear archivo de volcado").
4. Me pasas el `.dmp` y yo localizo el bytecode des-cifrado (lo reconozco por sus estructuras: tabla de strings de inputs, nombres de funciones MQL5) y escribo el des-ensamblador de la VM MQL5 → inventario de inputs, indicadores y flujo de condiciones.

### Ruta B — Observación de conducta (complementaria, sin RE)
Correr el bot en demo y registrar cada operación (hora, lado, volumen, SL/TP, símbolo); cruzar con velas M1/M5/M15 guardadas. Con suficientes operaciones se infiere la lógica de entrada de forma estadística. Ya hay precedente metodológico en `docs/RAPTOR_dossier_intel.md`.

### Ruta C — RE estático del terminal (la original; la más cara)
Desempaquetar `mt5setup.exe`/`terminal64.exe` (protector comercial), localizar la rutina de descifrado EX5 y reimplementarla. Semanas de trabajo y fragilidad ante actualizaciones de build. Solo tiene sentido si A y B se agotan.

## 7. Lo que este análisis NO afirma (honestidad técnica)

- No se descifró nada del cuerpo ni se intentó (fuerza bruta inviable; el objetivo del nivel 1 era el inventario).
- Las interpretaciones de los campos de la cabecera (tabla de la sección 2) son **candidatos** razonables, no especificación confirmada: confirmarlas requiere contrastar con un `.ex5` compilado por nosotros con inputs conocidos (posible más adelante compilando un .mq5 de prueba en tu MT5).
- El número de build exacto del compilador no es extraíble de esta cabecera con lo visto.

---

## 8. Verificación con herramientas (2026-11-06, sesión de trabajo con Ghidra)

Stack reinstalado y verificado en sandbox: **Ghidra 12.1.4 + Temurin JDK 25.0.5 + REA 6.8.0** (`rea doctor --provider ghidra` → healthy). Análisis real ejecutado:

### 8.1 Ghidra headless sobre `mt5setup.exe` (23,7 MB, PE32+ x64)

| Hallazgo | Evidencia |
|---|---|
| 6.024 funciones identificadas, imagen base `0x140000000` | script `scripts_re/ghidra/RadiografiaMT5Setup.java` |
| **Un único punto de entrada** | `0x140a138bc` |
| Secciones `.text/.rdata/.data/.pdata/.fptable/.cod0` **no inicializadas** (raw size 0) | el código real vive solo en `.cod2` (5,3 MB, entropía máxima) |
| `.cod2` contiene una tabla de nombres de API en claro | `InitCommonControlsEx`, `DeviceIoControl`, `CRYPT32.dll`, `ADVAPI32.dll`, `CreateWindowExW`, `SetNamedSecurityInfoW`… → stub que resuelve imports en runtime (patrón VMProtect) |
| **Cero constantes criptográficas en claro** | búsqueda de S-box AES (63 7c 77 7b…), IV SHA-256 (6a09e667…), strings "EX5" y ".mq5" → **no encontradas en toda la imagen** |

Lectura: incluso el instalador oculta su propia cripto; usa `CRYPT32.dll` de
Windows (verificación de firma y descifrado vía WinAPI). No hay nada más que
rascar estáticamente sin desempaquetar — y desempaquetar exige EJECUTAR.

### 8.2 Intento de ejecución en sandbox: bloqueado por el entorno

- Wine 11.21-staging (build portable Kron4ek) instalado y operativo (`wine --version` OK).
- Al inicializar el prefijo, `wineboot` muere con **"Bad system call" (SIGSYS, exit 159)**: el sandbox aplica seccomp y bloquea syscalls que Wine necesita. No es evitable desde dentro del sandbox (política del entorno).
- Consecuencia: el instalador NO puede ejecutarse aquí, y los componentes del terminal no se sirven sueltos en el CDN (4 rutas probadas + `.dmg` macOS: 404 en GET).

### 8.3 Solución: kit de captura para tu PC (ruta A hecha comando)

`scripts_re/kit_dump_windows/capturar_mt5.bat` — se ejecuta en tu Windows (como
administrador) con el bot adversario corriendo y produce:

1. `terminal64.exe` + `metaeditor64.exe` → análisis estático COMPLETO aquí (Ghidra no necesita ejecutar Windows para analizar un PE).
2. `terminal64_memoria.dmp` (volcado completo de memoria del proceso con el bot cargado) → contiene el bytecode del bot **des-cifrado**, listo para extraer.

Detalle y pasos: `scripts_re/kit_dump_windows/LEEME.md`.

---

*Herramientas: `scripts_re/radiografia_ex5.js` (Node, sin dependencias) y `scripts_re/ghidra/RadiografiaMT5Setup.java` (Ghidra headless). Informe completo: `node scripts_re/radiografia_ex5.js <archivo.ex5> salida.md`.*
