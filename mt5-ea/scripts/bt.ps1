# Corre UN backtest en el Strategy Tester de MT5 y saca los CSV.
# Uso:  .\bt.ps1 -Simbolo 'SFX Vol 20' -Periodo M3 -Desde 2026.08.01 -Hasta 2026.11.19
#
# Que hace:
#  1. escribe bt.ini ([Common] login demo + [Tester] con Model=1 OHLC M1)
#  2. lanza terminal64.exe /portable /config:bt.ini y espera a que cierre solo
#     (ShutdownTerminal=1)
#  3. recoge bt\senales.csv y bt\barras_*.csv de la carpeta comun (o del
#     sandbox del agente, que es donde caen si FILE_COMMON no aplica)
#  4. imprime la cobertura REAL de historia: el tester no avisa si le pides
#     mas velas de las que el broker tiene.
#
# Credenciales por entorno: MT5_LOGIN, MT5_PASSWORD, MT5_SERVER
param(
  [Parameter(Mandatory=$true)][string]$Simbolo,
  [string]$Periodo = 'M3',
  [string]$Desde   = '',
  [string]$Hasta   = '',
  [string]$Salida  = 'bt_out',
  [string]$Mt5Dir  = 'C:\Program Files\MetaTrader 5',
  [int]$LimiteMin  = 120
)

$ErrorActionPreference = 'Stop'

$login  = $env:MT5_LOGIN
$pass   = $env:MT5_PASSWORD
$server = $env:MT5_SERVER
$falta  = @()
foreach ($par in @(@('MT5_LOGIN',$login), @('MT5_PASSWORD',$pass), @('MT5_SERVER',$server))) {
  if (-not $par[1]) { $falta += $par[0] }
}
if ($falta.Count -gt 0) { throw "Faltan credenciales: $($falta -join ', ')" }

$term = Join-Path $Mt5Dir 'terminal64.exe'
if (-not (Test-Path -LiteralPath $term)) { throw "no existe $term (falta instalar_mt5.ps1)" }
$ex5 = Join-Path $Mt5Dir 'MQL5\Experts\EstrategiaAdversaria.ex5'
if (-not (Test-Path -LiteralPath $ex5)) { throw "falta $ex5 (falta compilar)" }

Get-Process terminal64 -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# ------------------------------------------------------------------ bt.ini
$lineas = @('[Common]', "Login=$login", "Password=$pass", "Server=$server", '')
$lineas += @('[Tester]')
$lineas += 'Expert=EstrategiaAdversaria'
$lineas += "Symbol=$Simbolo"
$lineas += "Period=$Periodo"
if ($Desde) { $lineas += "FromDate=$Desde" }
if ($Hasta) { $lineas += "ToDate=$Hasta" }
$lineas += @(
  'Model=1',              # OHLC de M1: los sinteticos no tienen ticks reales
  'ExecutionMode=0',
  'Optimization=0',
  'Visual=0',
  'Deposit=1000',
  'Currency=USD',
  'Leverage=1:100',
  'Report=bt_report',
  'ReplaceReport=1',
  'ShutdownTerminal=1'
)
$ini = Join-Path $Mt5Dir 'bt.ini'
Set-Content -Path $ini -Value ($lineas -join "`r`n") -Encoding ASCII

Write-Host "== backtest $Simbolo $Periodo  ($(if($Desde){$Desde}else{'inicio'}) -> $(if($Hasta){$Hasta}else{'fin'}))"
Get-Content $ini | Where-Object { $_ -notmatch 'Password' } | ForEach-Object { Write-Host "   $_" }

# ------------------------------------------------------------------ correr
$p = Start-Process -FilePath $term -ArgumentList '/portable', "/config:$ini" `
                   -WorkingDirectory $Mt5Dir -PassThru
$limite = (Get-Date).AddMinutes($LimiteMin)
while (-not $p.HasExited -and (Get-Date) -lt $limite) { Start-Sleep -Seconds 5 }
if (-not $p.HasExited) {
  Write-Host "AVISO: el terminal no cerro en $LimiteMin min, se mata"
  try { Stop-Process -Id $p.Id -Force } catch {}
}
Write-Host "terminal cerrado (exit $(try { $p.ExitCode } catch { '?' }))"

# ------------------------------------------------------- recoger los CSV
New-Item -ItemType Directory -Force -Path $Salida | Out-Null

$raices = @(
  (Join-Path $Mt5Dir 'Common\Files'),
  (Join-Path $Mt5Dir 'MQL5\Files'),
  (Join-Path $env:APPDATA 'MetaQuotes\Terminal\Common\Files')
)
$encontrados = @()
foreach ($r in $raices) {
  if (-not (Test-Path -LiteralPath $r)) { continue }
  $encontrados += @(Get-ChildItem -LiteralPath $r -Recurse -Filter '*.csv' -ErrorAction SilentlyContinue |
                    Where-Object { $_.FullName -match '\\bt\\' })
}
# sandbox del agente del tester
$encontrados += @(Get-ChildItem -LiteralPath $Mt5Dir -Recurse -Filter '*.csv' -ErrorAction SilentlyContinue |
                  Where-Object { $_.FullName -match 'Tester\\Agent.*\\MQL5\\Files\\bt\\' })
$encontrados += @(Get-ChildItem -LiteralPath (Join-Path $env:APPDATA 'MetaQuotes\Terminal') -Recurse -Filter '*.csv' -ErrorAction SilentlyContinue |
                  Where-Object { $_.FullName -match 'Tester\\Agent.*\\MQL5\\Files\\bt\\' })

$vistos = @{}
foreach ($f in $encontrados) {
  if ($vistos.ContainsKey($f.Name)) { continue }
  $vistos[$f.Name] = $true
  Copy-Item -LiteralPath $f.FullName -Destination (Join-Path $Salida $f.Name) -Force
  Write-Host "recogido: $($f.Name) ($((Get-Item $f.FullName).Length) bytes)"
}

$sen = Join-Path $Salida 'senales.csv'
if (-not (Test-Path -LiteralPath $sen)) {
  throw 'NO se genero senales.csv: revisa los logs del tester (config\Tester\logs)'
}

# --------------------------------------------------- cobertura real + resumen
$filas = @(Get-Content -LiteralPath $sen | Select-Object -Skip 1)
Write-Host "== senales: $($filas.Count)"
foreach ($tf in @('M3','M5','M15','M30')) {
  $b = Join-Path $Salida "barras_$tf.csv"
  if (-not (Test-Path -LiteralPath $b)) { continue }
  $lineasB = @(Get-Content -LiteralPath $b)
  if ($lineasB.Count -le 1) { continue }
  $primera = ($lineasB[1]  -split ';')[0]
  $ultima  = ($lineasB[-1] -split ';')[0]
  Write-Host "   barras $tf : $($lineasB.Count - 1) velas | $primera -> $ultima"
}

if ($filas.Count -gt 0) {
  $porTf = $filas | ForEach-Object { ($_ -split ';')[3] } | Group-Object | ForEach-Object {
    "$($_.Name)=$($_.Count)"
  }
  Write-Host "   por TF: $($porTf -join ', ')"
  $porCod = $filas | ForEach-Object { ($_ -split ';')[4] } | Group-Object | Sort-Object Count -Descending |
            ForEach-Object { "$($_.Name)=$($_.Count)" }
  Write-Host "   por codigo: $($porCod -join ', ')"
}
