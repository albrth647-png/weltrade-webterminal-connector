# Instala MetaTrader 5 en el runner y compila el EA.
# Uso:  .\instalar_mt5.ps1 -Fuente 'mt5-ea\EstrategiaAdversaria.mq5'
#
# Receta verificada en Actions (run 44336236307): 0 errores, 0 warnings.
#  - el instalador de MT5 es asincrono: /auto sin -Wait y luego sondear rutas
#  - MetaEditor necesita /portable para resolver el arbol MQL5 del install
#  - el codigo de salida de MetaEditor no es fiable: manda el log
param(
  [string]$Fuente = 'mt5-ea\EstrategiaAdversaria.mq5',
  [string]$Mt5Dir = 'C:\Program Files\MetaTrader 5'
)

$ErrorActionPreference = 'Stop'

function Wait-ForPath($p, $minutos) {
  $limite = (Get-Date).AddMinutes($minutos)
  while (-not (Test-Path -LiteralPath $p) -and (Get-Date) -lt $limite) { Start-Sleep -Seconds 5 }
  return (Test-Path -LiteralPath $p)
}

$me  = Join-Path $Mt5Dir 'MetaEditor64.exe'
$inc = Join-Path $Mt5Dir 'MQL5\Include\Trade\Trade.mqh'

if (-not (Test-Path $me)) {
  $exe = Join-Path $env:RUNNER_TEMP 'mt5setup.exe'
  if (-not (Test-Path $exe)) {
    Invoke-WebRequest -Uri 'https://download.mql5.com/cdn/web/metaquotes.software.corp/mt5/mt5setup.exe' -OutFile $exe -UseBasicParsing
  }
  Write-Host "instalador: $((Get-Item $exe).Length) bytes"
  Start-Process -FilePath $exe -ArgumentList '/auto' | Out-Null
  if (-not (Wait-ForPath $me 8)) { throw 'MetaEditor no aparecio: la instalacion no termino' }
}

Write-Host "MetaEditor: $me ($((Get-Item $me).Length) bytes)"

# El instalador escribe el arbol MQL5 por etapas. Si falta la biblioteca
# estandar, se abre el terminal una vez para que la despliegue.
if (-not (Wait-ForPath $inc 4)) {
  $term = Join-Path $Mt5Dir 'terminal64.exe'
  if (Wait-ForPath $term 4) {
    $p = Start-Process -FilePath $term -ArgumentList '/portable' -WorkingDirectory $Mt5Dir -PassThru
    Wait-ForPath $inc 3 | Out-Null
    try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch {}
  }
}
if (-not (Test-Path -LiteralPath $inc)) { throw "biblioteca estandar ausente: $inc" }

# Ningun terminal abierto puede estar sujetando los archivos.
Get-Process terminal64 -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

# ---------------------------------------------------------------- compilar
$experts = Join-Path $Mt5Dir 'MQL5\Experts'
$nombre  = [IO.Path]::GetFileNameWithoutExtension($Fuente)
$src     = Join-Path $experts "$nombre.mq5"
$ex5     = Join-Path $experts "$nombre.ex5"
$log     = Join-Path $env:RUNNER_TEMP 'compile.log'

New-Item -ItemType Directory -Force -Path $experts | Out-Null
Copy-Item -LiteralPath $Fuente -Destination $src -Force
if (Test-Path $ex5) { Remove-Item $ex5 -Force }
Write-Host "fuente: $((Get-Item $src).Length) bytes -> $src"

Start-Process -FilePath (Join-Path $Mt5Dir 'MetaEditor64.exe') `
  -ArgumentList '/portable', "/compile:`"$src`"", "/log:`"$log`"" -Wait

if (-not (Test-Path $log)) { throw 'MetaEditor no dejo log' }
$texto = Get-Content -Path $log -Encoding Unicode -Raw
Write-Host '----------------- log de MetaEditor -----------------'
Write-Host $texto
Write-Host '-----------------------------------------------------'

$m = [regex]::Match($texto, 'Result:\s*(\d+)\s*error')
$errores = if ($m.Success) { [int]$m.Groups[1].Value } else { 1 }
if (-not (Test-Path $ex5)) { throw "SIN EX5 ($errores errores)" }
if ($errores -gt 0) { throw "COMPILACION CON $errores ERROR(ES)" }

Write-Host "EA compilado: $((Get-Item $ex5).Length) bytes -> $ex5"
