# Laboratorio MT5 nativo en GitHub Actions (windows-latest) — fallback sin Wine.
# Instala MT5 con el instalador oficial en modo /auto, corre el bot en el Probador de
# Estrategias y volca la memoria con comsvcs.dll MiniDump mientras el .ex5 esta descifrado.
param(
  [string]$Symbol   = "XAUUSD",
  [string]$Period   = "H1",
  [string]$FromDate = "2025.01.01",
  [string]$ToDate   = "2025.12.31"
)
$ErrorActionPreference = "Continue"
$Root = Join-Path $env:GITHUB_WORKSPACE "lab_out"
New-Item -ItemType Directory -Force -Path $Root | Out-Null

function Paso($n, $msg) { Write-Host "[$n/7] $msg" }

Paso 1 "Descarga e instalacion de MT5 (/auto)"
$setup = "$env:TEMP\mt5setup.exe"
Invoke-WebRequest -Uri "https://download.mql5.com/cdn/web/metaquotes.software.corp/mt5/mt5setup.exe" -OutFile $setup
Start-Process -FilePath $setup -ArgumentList "/auto" -Wait
$Mt5 = "C:\Program Files\MetaTrader 5"
if (-not (Test-Path "$Mt5\terminal64.exe")) {
  $hit = Get-ChildItem "C:\Program Files","C:\Program Files (x86)","$env:LOCALAPPDATA\Programs" -Recurse -Filter terminal64.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($hit) { $Mt5 = $hit.DirectoryName }
}
if (-not (Test-Path "$Mt5\terminal64.exe")) { throw "terminal64.exe no encontrado tras la instalacion" }
Write-Host "   terminal: $Mt5\terminal64.exe"

Paso 2 "Primer arranque: login DEMO + historial (4 min)"
if (-not $env:MT5_LOGIN -or -not $env:MT5_PASSWORD -or -not $env:MT5_SERVER) {
  throw "Faltan credenciales DEMO (inputs login/password/server o secrets MT5_LOGIN/MT5_PASSWORD/MT5_SERVER)"
}
$ini = "$env:TEMP\login.ini"
@("[Common]","Login=$env:MT5_LOGIN","Password=$env:MT5_PASSWORD","Server=$env:MT5_SERVER","News=0") | Set-Content -Path $ini -Encoding Ascii
Start-Process -FilePath "$Mt5\terminal64.exe" -ArgumentList "/portable","/config:$ini" -WorkingDirectory $Mt5
Start-Sleep -Seconds 240
Get-Process terminal64 -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 5

Paso 3 "Copiando el EA a MQL5\Experts"
New-Item -ItemType Directory -Force -Path "$Mt5\MQL5\Experts" | Out-Null
$ea = Get-ChildItem (Join-Path $env:GITHUB_WORKSPACE "bot_dir") -Filter *.ex5 | Select-Object -First 1
if (-not $ea) { throw "No hay .ex5 en bot_dir (falta el release bot-assets)" }
Copy-Item $ea.FullName "$Mt5\MQL5\Experts\" -Force
Write-Host "   EA: $($ea.Name)"

Paso 4 "Probador de estrategias + dumper en paralelo (15-90 min)"
$tini = "$env:TEMP\tester.ini"
@("[Tester]","Expert=$($ea.Name)","Symbol=$Symbol","Period=$Period","FromDate=$FromDate","ToDate=$ToDate","Model=1","Deposit=10000","Currency=USD","Leverage=100","Report=goldrush_report","Shutdown=1") | Set-Content -Path $tini -Encoding Ascii
New-Item -ItemType Directory -Force -Path "C:\dumps" | Out-Null
$job = Start-Job -ScriptBlock {
  $n = 0
  while ($n -lt 10) {
    $p = Get-Process terminal64 -ErrorAction SilentlyContinue
    if ($p) {
      $n++
      $dmp = "C:\dumps\dmp_$n.dmp"
      cmd /c "rundll32.exe C:\Windows\System32\comsvcs.dll, MiniDump $($p.Id) $dmp full"
      Get-ChildItem "C:\dumps" -Filter *.dmp -ErrorAction SilentlyContinue |
        Sort-Object CreationTime -Descending | Select-Object -Skip 3 | Remove-Item -Force
    }
    Start-Sleep -Seconds 120
  }
}
$proc = Start-Process -FilePath "$Mt5\terminal64.exe" -ArgumentList "/portable","/config:$tini" -WorkingDirectory $Mt5 -PassThru
$proc.WaitForExit(5400000) | Out-Null
Stop-Job $job -ErrorAction SilentlyContinue
Remove-Job $job -Force -ErrorAction SilentlyContinue
Get-Process terminal64 -ErrorAction SilentlyContinue | Stop-Process -Force
Get-ChildItem "C:\dumps" -ErrorAction SilentlyContinue | ForEach-Object { Write-Host ("   dump: " + $_.Name + " " + [math]::Round($_.Length/1MB) + " MB") }

Paso 5 "Recogiendo logs e informe"
Copy-Item "$Mt5\logs\*.log" $Root -ErrorAction SilentlyContinue
Get-ChildItem "$Mt5\Tester" -Recurse -Include *.log,*.htm*,*.xml -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item $_.FullName $Root -Force }
Get-ChildItem "$Mt5" -Filter "goldrush_report*" -Recurse -ErrorAction SilentlyContinue | ForEach-Object { Copy-Item $_.FullName (Join-Path $Root ("report_" + $_.Name)) -Force }

Paso 6 "Escaneando strings del bot descifrado en RAM"
$dumps = Get-ChildItem "C:\dumps" -Filter *.dmp -ErrorAction SilentlyContinue | Sort-Object Length -Descending | Select-Object -First 3
if ($dumps) {
  python (Join-Path $env:GITHUB_WORKSPACE "scripts_re\lab\scan_strings.py") @($dumps | ForEach-Object { $_.FullName }) --outdir $Root
} else {
  Write-Host "   sin dumps (el tester termino demasiado rapido?)"
}

Paso 7 "Resumen"
Get-ChildItem $Root | ForEach-Object { Write-Host ("   · " + $_.Name + " " + [math]::Round($_.Length/1KB) + " KB") }
Write-Host "LISTO"
