@echo off
REM ============================================================
REM  KIT DE CAPTURA MT5 — para ingenieria inversa del .ex5
REM  (ruta A del dossier: volcado de memoria del terminal)
REM
REM  USO (en tu PC con Windows):
REM    1. Abre MT5, carga el bot adversario (ej. GoldRush.ex5)
REM       en un grafico demo y dejalo corriendo.
REM    2. Clic derecho en este archivo -> "Ejecutar como administrador"
REM    3. Espera. Se crea una carpeta CAPTURA_MT5 con todo lo necesario.
REM    4. Comprime CAPTURA_MT5 en un ZIP y enviame el ZIP.
REM
REM  Que produce:
REM    - terminal64.exe y metaeditor64.exe (para analisis estatico con Ghidra)
REM    - dump de memoria COMPLETO del terminal con el bot cargado
REM      (contiene el bytecode del bot DES-CIFRADO: el terminal tiene
REM       que descifrarlo para ejecutarlo)
REM    - lista de procesos e info del sistema
REM ============================================================
setlocal enabledelayedexpansion

set CARPETA=%~dp0CAPTURA_MT5
mkdir "%CARPETA%" 2>nul

echo ============================================================
echo  KIT DE CAPTURA MT5
echo ============================================================
echo.

REM ---- 1. localizar terminal64.exe ----
set TERMINAL=
for %%P in (
  "%ProgramFiles%\MetaTrader 5\terminal64.exe"
  "%ProgramFiles(x86)%\MetaTrader 5\terminal64.exe"
  "%ProgramFiles%\MetaTrader 5 EXNESS\terminal64.exe"
  "%ProgramFiles%\MetaTrader 5 IC Markets\terminal64.exe"
  "%ProgramFiles%\MetaTrader 5 Weltrade\terminal64.exe"
) do (
  if exist %%P set TERMINAL=%%~P
)

if "!TERMINAL!"=="" (
  echo No encontre terminal64.exe en las rutas tipicas.
  set /p TERMINAL="Escribe la ruta completa de tu terminal64.exe: "
)
echo Terminal: !TERMINAL!
echo.

REM ---- 2. copiar los binarios (analisis estatico) ----
copy /Y "!TERMINAL!" "%CARPETA%\terminal64.exe" >nul
if exist "!TERMINAL!\..\metaeditor64.exe" copy /Y "!TERMINAL!\..\metaeditor64.exe" "%CARPETA%\metaeditor64.exe" >nul
echo [OK] Binarios copiados.
echo.

REM ---- 3. lista de procesos ----
tasklist /FI "IMAGENAME eq terminal64.exe" /V > "%CARPETA%\procesos.txt" 2>&1
echo [OK] Lista de procesos en procesos.txt.
echo.

REM ---- 4. DUMP DE MEMORIA COMPLETO ----
echo Ahora voy a volcar la memoria de terminal64.exe.
echo IMPORTANTE: el bot adversario debe estar corriendo en MT5 AHORA.
echo.
pause

for /f "tokens=2" %%I in ('tasklist /FI "IMAGENAME eq terminal64.exe" /NH ^| findstr /I "terminal64"') do set PID=%%I

if "!PID!"=="" (
  echo ERROR: terminal64.exe no esta corriendo. Abre MT5 con el bot y repite.
  pause
  exit /b 1
)

echo Volcando PID !PID! (puede tardar 1-5 min, el archivo pesa 1-3 GB)...
rundll32.exe C:\Windows\System32\comsvcs.dll, MiniDump !PID! "%CARPETA%\terminal64_memoria.dmp" full
if exist "%CARPETA%\terminal64_memoria.dmp" (
  echo [OK] Volcado creado: terminal64_memoria.dmp
) else (
  echo ERROR: no se creo el volcado. Ejecuta este .bat como ADMINISTRADOR.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo  CAPTURA COMPLETA en: %CARPETA%
echo  Comprime esa carpeta en un ZIP y enviame el ZIP.
echo  (si el .dmp pesa demasiado para subir, enviame primero
echo   solo terminal64.exe + metaeditor64.exe, y el .dmp por partes)
echo ============================================================
pause
