#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Backtest de UNA pasada del EA adversario sobre Wine en GitHub Actions.

Reutiliza la receta que YA funciono en MT5 Lab (Linux/Wine):
  1) Xvfb + MT5 instalado con mt5setup.exe /auto (cacheado del release).
  2) Login DEMO por /config, probando los servidores de MT5_SERVER separados
     por ';' hasta que el log diga 'authorized' (auto-descubrimiento).
  3) Simbolo elegido de los que el servidor tiene DE VERDAD en bases/.
  4) Compilacion del .mq5 con metaeditor64.exe bajo Wine.
  5) Probador de estrategias con ShutdownTerminal=1 y limite de minutos.
  6) Recogida de bt/senales.csv y bt/barras_*.csv a bt_out/.

Variables: MT5_LOGIN, MT5_PASSWORD, MT5_SERVER (obligatorias),
BT_SIMBOLO, BT_PERIODO, BT_DESDE, BT_HASTA, BT_LIMITE_MIN (opcionales).
"""
import os, subprocess, sys, time, glob, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(REPO, "bt_out")

def env_req(k):
    v = os.environ.get(k, "").strip()
    if not v:
        raise SystemExit("Falta la variable de entorno %s" % k)
    return v

LOGIN = env_req("MT5_LOGIN")
PASSWORD = env_req("MT5_PASSWORD")
SERVER = env_req("MT5_SERVER")
SIMBOLO = os.environ.get("BT_SIMBOLO", "FX Vol 20")
PERIODO = os.environ.get("BT_PERIODO", "M3")
DESDE = os.environ.get("BT_DESDE", "")
HASTA = os.environ.get("BT_HASTA", "")
LIMITE_MIN = int(os.environ.get("BT_LIMITE_MIN", "30") or 30)

WORK = "/tmp/mt5_bt"
WINE = os.path.expanduser("~/.wine")
os.makedirs(WORK, exist_ok=True)
os.makedirs(OUT, exist_ok=True)
os.environ["DISPLAY"] = ":99"
os.environ["WINEDEBUG"] = "-all"
os.environ["WINEDLLOVERRIDES"] = "mscoree,mshtml="

RESUMEN = []

def log(msg):
    print(msg, flush=True)
    RESUMEN.append(msg)

def sh(cmd, show=False, timeout=None):
    r = subprocess.run(["bash", "-lc", cmd], capture_output=True, text=True, timeout=timeout)
    if show:
        if r.stdout:
            print(r.stdout[-3000:], flush=True)
        if r.stderr:
            print("ERR:", r.stderr[-1500:], flush=True)
    return r

def winpath(p):
    """Ruta Linux -> ruta que entiende Wine (Z:\\...)."""
    r = sh("winepath -w '%s'" % p, show=False)
    ruta = r.stdout.strip().splitlines()[-1] if r.stdout.strip() else ""
    if ruta:
        return ruta
    return "Z:" + p.replace("/", "\\")

def terminal_logs():
    pats = [os.path.join(MT5DIR, "logs", "*.log"),
            os.path.join(MT5DIR, "Tester", "logs", "*.log"),
            os.path.join(WINE, "drive_c", "users", "*", "AppData", "Roaming",
                         "MetaQuotes", "Terminal", "*", "logs", "*.log")]
    out = []
    for p in pats:
        out += glob.glob(p)
    return sorted(out, key=lambda f: os.path.getmtime(f))

# --------------------------------------------------------------- 1. Xvfb
log("[1/7] Pantalla virtual Xvfb")
subprocess.Popen(["Xvfb", ":99", "-screen", "0", "1280x1024x24"],
                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(2)

# --------------------------------------------------------------- 2. MT5
log("[2/7] Instalacion de MetaTrader 5 (/auto)")
term = os.path.join(WINE, "drive_c", "Program Files", "MetaTrader 5", "terminal64.exe")
setup = os.path.join(WORK, "mt5setup.exe")
if not os.path.exists(term):
    cached = os.path.join(REPO, "bot_dir", "mt5setup.exe")
    if os.path.exists(cached):
        shutil.copy2(cached, setup)
        log("   instalador desde release (cache)")
    else:
        sh('wget -qO "%s" "https://download.mql5.com/cdn/web/metaquotes.software.corp/mt5/mt5setup.exe"' % setup,
           show=False)
    if not os.path.exists(setup):
        raise SystemExit("no se pudo bajar mt5setup.exe")
    log("   instalador: %d bytes" % os.path.getsize(setup))
    try:
        sh("DISPLAY=:99 wineboot -u", timeout=1200)
    except Exception:
        log("   wineboot demorado; el instalador crea el prefijo igualmente")
    p = subprocess.Popen(["wine", setup, "/auto"], cwd=WORK, env=dict(os.environ),
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    t0, n = time.time(), 0
    while not os.path.exists(term) and time.time() - t0 < 1500:
        if p.poll() is not None:
            log("   instalador /auto termino (rc=%s)" % p.returncode)
            break
        time.sleep(15)
        n += 1
        if n % 8 == 0:
            log("   instalando... %d min" % (int(time.time() - t0) // 60))
if not os.path.exists(term):
    r = sh('find "%s" -iname terminal64.exe 2>/dev/null | head -1' % WINE, show=False)
    if r.stdout.strip():
        term = r.stdout.strip().splitlines()[0]
if not os.path.exists(term):
    raise SystemExit("terminal64.exe no aparecio bajo Wine")
MT5DIR = os.path.dirname(term)
log("   terminal: %s" % term)

# --------------------------------------------------------------- 3. compilar
log("[3/7] Compilacion del EA")
src = os.path.join(REPO, "mt5-ea", "EstrategiaAdversaria.mq5")
if not os.path.exists(src):
    raise SystemExit("no existe %s" % src)
expertos = os.path.join(MT5DIR, "MQL5", "Experts")
os.makedirs(expertos, exist_ok=True)
dst = os.path.join(expertos, "EstrategiaAdversaria.mq5")
shutil.copy2(src, dst)
ex5 = dst[:-4] + ".ex5"
if os.path.exists(ex5):
    os.remove(ex5)
clog = os.path.join(WORK, "compile.log")
rc = subprocess.run(["wine", os.path.join(MT5DIR, "metaeditor64.exe"),
                     "/compile:" + winpath(dst), "/log:" + winpath(clog)],
                    env=dict(os.environ), capture_output=True, text=True, timeout=420)
for _ in range(30):
    if os.path.exists(ex5) and os.path.getsize(ex5) > 0:
        break
    time.sleep(2)
if os.path.exists(clog):
    for ln in open(clog, errors="replace").read().splitlines()[-15:]:
        log("   " + ln.strip())
if not (os.path.exists(ex5) and os.path.getsize(ex5) > 0):
    raise SystemExit("el EA no compilo (.ex5 ausente). rc=%s" % rc.returncode)
log("   .ex5: %d bytes" % os.path.getsize(ex5))

# --------------------------------------------------------------- 4. login
log("[4/7] Login DEMO (auto-descubrimiento de servidor)")
SERVIDORES = [s.strip() for s in SERVER.split(";") if s.strip()]
EXITO = ("authorized", "logged in")
DURO = ("login failed", "authorization failed", "invalid login", "invalid password",
        "invalid account", "account disabled")

def log_terminal_texto():
    logs = terminal_logs()
    if not logs:
        return ""
    try:
        return open(logs[-1], errors="replace").read().lower()
    except Exception:
        return ""

def matar_terminal():
    sh("wineserver -k || true", show=False)
    time.sleep(5)

conectado = None
for cand in SERVIDORES:
    log("   servidor: %s" % cand)
    ini_login = os.path.join(WORK, "login.ini")
    open(ini_login, "w").write("\n".join([
        "[Common]", "Login=" + LOGIN, "Password=" + PASSWORD, "Server=" + cand,
        "News=0", ""]))
    subprocess.Popen(["wine", term, "/portable", "/config:" + winpath(ini_login)],
                     cwd=MT5DIR, env=dict(os.environ),
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    motivo = "sin respuesta en 4 min"
    for _ in range(4):
        time.sleep(60)
        t = log_terminal_texto()
        if any(m in t for m in EXITO):
            conectado = cand
            log("   -> AUTORIZADO en %s" % cand)
            break
        d = [m for m in DURO if m in t]
        if d:
            motivo = "rechazado: " + d[0]
            break
    if conectado:
        break
    log("   -> " + motivo)
    matar_terminal()
if not conectado:
    log("   AVISO: ningun servidor confirmo el login; se sigue con el primero "
        "(los logs del runner diran por que)")

SERVER_OK = conectado or (SERVIDORES[0] if SERVIDORES else SERVER)
matar_terminal()

# ------------------------------------------- 4b. simbolos que existen de verdad
log("[4/7 b] Simbolos del servidor")
bases_dir = os.path.join(MT5DIR, "bases")
GRUPOS = {"currencies", "forex", "metals", "indices", "index", "crypto", "stocks",
          "futures", "bonds", "etf", "options", "other", "synthetic", "synthetics",
          "commodities", "shares", "charts"}
simbolos = set()
if os.path.isdir(bases_dir):
    for root, dirs, files in os.walk(bases_dir):
        padre = os.path.basename(os.path.dirname(root))
        nombre = os.path.basename(root)
        if any(f.lower().endswith(".hcc") for f in files):
            simbolos.add(nombre)
        if nombre.lower() not in GRUPOS and padre.lower() in GRUPOS:
            simbolos.add(nombre)
simbolos = sorted(s for s in simbolos if s)
open(os.path.join(OUT, "simbolos_disponibles.txt"), "w").write(
    "\n".join(simbolos) if simbolos else "(bases vacio: sin cache de historial)")
log("   detectados: %d" % len(simbolos))
for s in simbolos[:40]:
    log("   · " + s)

pedidos = [s.strip() for s in SIMBOLO.split(";") if s.strip()]
low = {s.lower(): s for s in simbolos}
ELEGIDO = next((low[c.lower()] for c in pedidos if c.lower() in low), None)
if not ELEGIDO and simbolos:
    # los indices sinteticos de Weltrade se llaman 'FX Vol 20' / 'SFX Vol 40'
    ELEGIDO = next((s for s in simbolos if "vol" in s.lower()), None)
if not ELEGIDO:
    ELEGIDO = pedidos[0] if pedidos else "FX Vol 20"
log("   SIMBOLO PARA EL TESTER: %s" % ELEGIDO)

# --------------------------------------------------------------- 5. tester
log("[5/7] Probador de estrategias (limite %d min)" % LIMITE_MIN)
lineas = ["[Common]", "Login=" + LOGIN, "Password=" + PASSWORD, "Server=" + SERVER_OK, "",
          "[Tester]",
          "Expert=EstrategiaAdversaria",
          "Symbol=" + ELEGIDO,
          "Period=" + PERIODO]
if DESDE:
    lineas.append("FromDate=" + DESDE)
if HASTA:
    lineas.append("ToDate=" + HASTA)
lineas += ["Model=1",              # OHLC de M1
           "ExecutionMode=0",
           "Optimization=0",
           "Visual=0",
           "Deposit=1000",
           "Currency=USD",
           "Leverage=1:100",
           "Report=bt_report",
           "ReplaceReport=1",
           "ShutdownTerminal=1",
           ""]
ini_test = os.path.join(MT5DIR, "bt.ini")
open(ini_test, "w").write("\r\n".join(lineas))
log("   %s -> %s" % (ELEGIDO, PERIODO if not DESDE else "%s .. %s" % (DESDE, HASTA or "fin")))

proc = subprocess.Popen(["wine", term, "/portable", "/config:" + winpath(ini_test)],
                        cwd=MT5DIR, env=dict(os.environ),
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
t0 = time.time()
while time.time() - t0 < LIMITE_MIN * 60:
    if proc.poll() is not None:
        log("   terminal cerrado solo a los %d s (rc=%s)" %
            (int(time.time() - t0), proc.returncode))
        break
    time.sleep(10)
else:
    log("   AVISO: no cerro en %d min; se mata" % LIMITE_MIN)
    proc.kill()
matar_terminal()

# --------------------------------------------------------------- 6. recoger
log("[6/7] Recogida de CSV y logs")
encontrados = sh(
    'find "%s" "%s" -type f -name "*.csv" -path "*/bt/*" 2>/dev/null' % (MT5DIR, WINE),
    show=False).stdout.splitlines()
vistos = set()
for f in encontrados:
    n = os.path.basename(f)
    if n in vistos:
        continue
    vistos.add(n)
    try:
        shutil.copy2(f, os.path.join(OUT, n))
        log("   recogido: %s (%d bytes)" % (n, os.path.getsize(f)))
    except Exception as e:
        log("   no se pudo copiar %s (%s)" % (n, e))

for f in terminal_logs()[-3:]:
    try:
        shutil.copy2(f, os.path.join(OUT, "log_" + os.path.basename(f)))
    except Exception:
        pass
for pat in ("Tester/**/*.htm*", "Tester/**/*.xml", "bt_report*"):
    for f in glob.glob(os.path.join(MT5DIR, pat), recursive=True):
        try:
            shutil.copy2(f, os.path.join(OUT, "rep_" + os.path.basename(f)))
        except Exception:
            pass

# --------------------------------------------------------------- 7. resumen
log("[7/7] Resumen")
sen = os.path.join(OUT, "senales.csv")
if not os.path.exists(sen):
    log("   SIN senales.csv: el tester no llego a ejecutar el EA")
    for f in terminal_logs()[-2:]:
        log("   --- %s (ultimas lineas)" % os.path.basename(f))
        try:
            for ln in open(f, errors="replace").read().splitlines()[-20:]:
                log("   " + ln)
        except Exception:
            pass
    salida = 1
else:
    filas = [l for l in open(sen, errors="replace").read().splitlines()[1:] if l.strip()]
    log("   senales: %d" % len(filas))
    for tf in ("M3", "M5", "M15", "M30"):
        b = os.path.join(OUT, "barras_%s.csv" % tf)
        if not os.path.exists(b):
            continue
        ls = [l for l in open(b, errors="replace").read().splitlines() if l.strip()]
        if len(ls) <= 1:
            continue
        log("   barras %s: %d velas | %s -> %s" %
            (tf, len(ls) - 1, ls[1].split(";")[0], ls[-1].split(";")[0]))
    if filas:
        campos = [l.split(";") for l in filas if l.count(";") >= 5]
        por_tf, por_cod = {}, {}
        for c in campos:
            por_tf[c[3]] = por_tf.get(c[3], 0) + 1
            por_cod[c[4]] = por_cod.get(c[4], 0) + 1
        log("   por TF: " + ", ".join("%s=%d" % kv for kv in sorted(por_tf.items())))
        log("   por codigo: " + ", ".join("%s=%d" % kv for kv in
                                          sorted(por_cod.items(), key=lambda x: -x[1])[:10]))
    salida = 0

open(os.path.join(OUT, "resumen.txt"), "w").write("\n".join(RESUMEN) + "\n")
open(os.path.join(REPO, "resumen.md"), "w").write("```\n" + "\n".join(RESUMEN) + "\n```\n")
log("BT_OUT = %s" % OUT)
sys.exit(salida)
