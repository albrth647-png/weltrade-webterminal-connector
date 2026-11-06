#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Laboratorio MT5 sobre Wine en GitHub Actions (ubuntu-latest) — pipeline completo.

1) Instala MetaTrader 5 (mt5setup.exe /auto) bajo Wine.
2) Primer arranque con login DEMO por /config (descarga historial).
3) Copia el .ex5 (que el workflow descarga del release 'bot-assets') a MQL5\\Experts.
4) Probador de Estrategias por CLI ([Tester] + Shutdown=1 + Report=) y, en paralelo,
   volcado de la memoria de terminal64.exe leyendo /proc/<pid>/mem
   (el .ex5 viaja DESCIFRADO en RAM mientras corre).
5) Escanea los volcados con scan_strings.py (formato interno MQL5).
6) Opcional (RUN_GHIDRA=true): Ghidra headless contra terminal64.exe buscando las
   constantes del cargador .ex5 conocidas de la radiografia (0x2E8/0xA8/0x1A8/0x2A8/0xA0).

Variables de entorno: MT5_LOGIN, MT5_PASSWORD, MT5_SERVER (obligatorias),
LAB_SYMBOL, LAB_PERIOD, LAB_FROM, LAB_TO, RUN_GHIDRA (opcionales).
Todo queda en lab_out/ para el artifact de Actions.
"""
import os, subprocess, sys, time, threading, glob, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))  # raiz del repo
OUT = os.path.abspath(os.path.join(REPO, "lab_out"))

def env_req(k):
    v = os.environ.get(k, "").strip()
    if not v:
        raise SystemExit("Falta la variable de entorno %s (credenciales DEMO)" % k)
    return v

LOGIN = env_req("MT5_LOGIN")
PASSWORD = env_req("MT5_PASSWORD")
SERVER = env_req("MT5_SERVER")
SYMBOL = os.environ.get("LAB_SYMBOL", "XAUUSD")
PERIOD = os.environ.get("LAB_PERIOD", "H1")
FROMD = os.environ.get("LAB_FROM", "2025.01.01")
TOD = os.environ.get("LAB_TO", "2025.12.31")
RUN_GHIDRA = os.environ.get("RUN_GHIDRA", "false").lower() == "true"

WORK = "/tmp/mt5_re"
os.makedirs(WORK, exist_ok=True)
os.makedirs(OUT, exist_ok=True)
os.environ["DISPLAY"] = ":99"
os.environ["WINEDEBUG"] = "-all"

def sh(cmd, show=True, timeout=None):
    r = subprocess.run(["bash", "-lc", cmd], capture_output=True, text=True, timeout=timeout)
    if show:
        if r.stdout:
            print(r.stdout[-3000:])
        if r.stderr:
            print("ERR:", r.stderr[-1500:])
    return r

def paso(n, msg):
    print("[%d/8] %s" % (n, msg), flush=True)

# ---------------------------------------------------------------- 1. Xvfb
paso(1, "Pantalla virtual Xvfb")
subprocess.Popen(["Xvfb", ":99", "-screen", "0", "1280x1024x24"],
                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(2)

# ---------------------------------------------------------------- 2. MT5
paso(2, "Descarga e instalacion de MetaTrader 5 (/auto)")
term = os.path.expanduser("~/.wine/drive_c/Program Files/MetaTrader 5/terminal64.exe")
setup = os.path.join(WORK, "mt5setup.exe")
# Sin Mono/Gecko: evita los dialogos que cuelgan wineboot en prefijos nuevos
os.environ["WINEDLLOVERRIDES"] = "mscoree,mshtml="
if not os.path.exists(term):
    cached = os.path.join(REPO, "bot_dir", "mt5setup.exe")
    if os.path.exists(cached):
        shutil.copy2(cached, setup)
        print("   instalador desde release (cache)", flush=True)
    else:
        sh('wget -qO %s "https://download.mql5.com/cdn/web/metaquotes.software.corp/mt5/mt5setup.exe"' % setup, show=False)
    print("   instalador:", os.path.getsize(setup), "bytes", flush=True)
    try:
        sh('DISPLAY=:99 wineboot -u', timeout=1500)
    except Exception:
        print("   wineboot demorado; el instalador crea el prefijo igualmente", flush=True)
    print("   instalador /auto en segundo plano (vigilado hasta 40 min)", flush=True)
    p = subprocess.Popen(["wine", setup, "/auto"], cwd=WORK, env=dict(os.environ),
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    t_inst = time.time()
    n = 0
    while not os.path.exists(term) and time.time() - t_inst < 2400:
        if p.poll() is not None:
            print("   instalador /auto termino (rc=%s)" % p.returncode, flush=True)
            break
        time.sleep(20)
        n += 1
        if n % 9 == 0:
            print("   instalando... %d min" % (int(time.time() - t_inst) // 60), flush=True)
    if not os.path.exists(term):
        print("   /auto no dejo terminal64.exe; reintento con pantalla + Enter automatico...", flush=True)
        subprocess.Popen(["wine", setup], cwd=WORK, env=dict(os.environ),
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(25)
        for _ in range(40):
            sh('DISPLAY=:99 xdotool key Return 2>/dev/null', show=False)
            time.sleep(10)
            if os.path.exists(term):
                break
if not os.path.exists(term):
    r = sh('find %s -iname terminal64.exe 2>/dev/null | head -1' % os.path.expanduser("~"), show=False)
    if r.stdout.strip():
        term = r.stdout.strip()
assert os.path.exists(term), "terminal64.exe no aparecio; revisa el log"
print("   terminal:", term)
MT5DIR = os.path.dirname(term)

# ---------------------------------------------------------------- 3. bot .ex5
paso(3, "Localizando el bot .ex5")
cands = sorted(glob.glob(os.path.join(REPO, "bot_dir", "*.ex5"))) + sorted(glob.glob("/tmp/*.ex5"))
assert cands, "No hay .ex5 en bot_dir/ ni /tmp"
EA = cands[0]
print("   EA:", EA, os.path.getsize(EA), "bytes")
os.makedirs(os.path.join(MT5DIR, "MQL5", "Experts"), exist_ok=True)
shutil.copy2(EA, os.path.join(MT5DIR, "MQL5", "Experts", os.path.basename(EA)))

# ---------------------------------------------------------------- 4. primer arranque
# MT5_SERVER admite varios candidatos separados por ';' y se prueban en orden:
# el primero que autorice el login gana (auto-descubrimiento del servidor).
paso(4, "Login DEMO con auto-descubrimiento de servidor (hasta 4 min por candidato)")
SERVIDORES = [s.strip() for s in SERVER.split(";") if s.strip()]
assert SERVIDORES, "MT5_SERVER vacio"

def log_terminal():
    logs = sorted(glob.glob(os.path.join(MT5DIR, "logs", "*.log")), key=os.path.getmtime)
    if not logs:
        return ""
    try:
        return open(logs[-1], errors="replace").read().lower()
    except Exception:
        return ""

EXITO = ("authorized", "logged in")
DURO = ("login failed", "authorization failed", "invalid login", "invalid password",
        "invalid account", "account disabled", "cannot find")
conectado = None
for cand in SERVIDORES:
    print("   servidor:", cand, flush=True)
    ini_login = os.path.join(WORK, "login.ini")
    open(ini_login, "w").write("\n".join(["[Common]", "Login=" + LOGIN, "Password=" + PASSWORD,
                                          "Server=" + cand, "News=0", ""]))
    subprocess.Popen(["wine", term, "/portable", "/config:" + ini_login], cwd=MT5DIR,
                     env=dict(os.environ), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    motivo = "sin respuesta"
    for _ in range(4):
        time.sleep(60)
        t = log_terminal()
        if any(m in t for m in EXITO):
            conectado = cand
            print("   -> AUTORIZADO en", cand, flush=True)
            break
        d = [m for m in DURO if m in t]
        if d:
            motivo = "rechazado: " + d[0]
            break
    if conectado:
        break
    print("   ->", motivo, flush=True)
    sh("wineserver -k || true", show=False)
    time.sleep(5)
SERVER = conectado or SERVIDORES[0]
print("   servidor final:", SERVER, "(%s)" % ("conectado" if conectado else "sin confirmar; los logs lo diran"))
sh("wineserver -k || true", show=False)
time.sleep(5)

# ---------------------------------------------------------------- 4.5 descubrimiento de simbolos
# La cuenta puede ser SyntX (solo indices sinteticos) y NO tener el oro: si el tester
# pide un simbolo inexistente se queda esperando. Aqui leemos el arbol real del servidor
# en bases/ y elegimos un simbolo que EXISTA, en este orden de preferencia:
#   1) candidato exacto del usuario (LAB_SYMBOL admite 'a;b;c')  2) oro (XAU/GOLD)
#   3) sinteticos (Vol/Boom/Crash/PainX/GainX/...)               4) el primero disponible
paso(4, "b · descubrimiento de simbolos del servidor")
bases_dir = os.path.join(MT5DIR, "bases")
simbolos_srv = set()
GRUPOS = {"currencies", "forex", "metals", "indices", "index", "crypto", "stocks",
          "futures", "bonds", "etf", "options", "other", "synthetic", "synthetics",
          "commodities", "shares", "charts"}
if os.path.isdir(bases_dir):
    for root, dirs, files in os.walk(bases_dir):
        if any(f.lower().endswith(".hcc") for f in files):
            simbolos_srv.add(os.path.basename(root))
        nombre = os.path.basename(root)
        padre = os.path.basename(os.path.dirname(root))
        if nombre.lower() not in GRUPOS and padre.lower() in GRUPOS:
            simbolos_srv.add(nombre)
simbolos_srv = sorted(s for s in simbolos_srv if s)
try:
    open(os.path.join(OUT, "simbolos_disponibles.txt"), "w").write(
        "\n".join(simbolos_srv) if simbolos_srv else "(bases vacio tras el login: sin cache de historial)\n")
except Exception:
    pass
print("   simbolos detectados en el servidor:", len(simbolos_srv), flush=True)
for s in simbolos_srv[:40]:
    print("   ·", s, flush=True)

cands_env = [s.strip() for s in SYMBOL.split(";") if s.strip()] or ["XAUUSD"]
low = {s.lower(): s for s in simbolos_srv}
ELEGIDO = next((low[c.lower()] for c in cands_env if c.lower() in low), None)
if not ELEGIDO:
    ELEGIDO = next((s for s in simbolos_srv if "xau" in s.lower() or "gold" in s.lower()), None)
if not ELEGIDO:
    FAMS = ("vol", "boom", "crash", "painx", "gainx", "flipx", "switchx", "breakx",
            "trendx", "jump", "step", "syn", "idx")
    ELEGIDO = next((s for s in simbolos_srv if any(f in s.lower() for f in FAMS)), None)
if not ELEGIDO:
    ELEGIDO = simbolos_srv[0] if simbolos_srv else cands_env[0]
SYMBOL = ELEGIDO
print("   SIMBOLO ELEGIDO PARA EL TESTER:", SYMBOL, flush=True)

# ---------------------------------------------------------------- 5. tester + dumper
paso(5, "Probador de estrategias + volcado de memoria en paralelo (15-90 min)")
ini_test = os.path.join(WORK, "tester.ini")
open(ini_test, "w").write("\n".join([
    "[Common]", "Login=" + LOGIN, "Password=" + PASSWORD, "Server=" + SERVER,
    "[Tester]", "Expert=" + os.path.basename(EA), "Symbol=" + SYMBOL, "Period=" + PERIOD,
    "FromDate=" + FROMD, "ToDate=" + TOD, "Model=1", "Deposit=10000", "Currency=USD",
    "Leverage=100", "Report=goldrush_report", "Shutdown=1", ""]))
state = {"seen": set(), "bytes": 0, "stop": False}

def dump_proc(pid, outdir):
    total = state["bytes"]
    try:
        maps = open("/proc/%d/maps" % pid).read().strip().splitlines()
        mem = open("/proc/%d/mem" % pid, "rb", 0)
    except Exception:
        return
    for line in maps:
        p = line.split()
        if len(p) < 2 or "w" not in p[1]:
            continue
        path = p[5] if len(p) > 5 else ""
        if path and (".so" in path or path.startswith("/usr/") or path.startswith("/lib")):
            continue
        a, b = [int(x, 16) for x in p[0].split("-")]
        size = b - a
        if size <= 0 or size > 150_000_000:
            continue
        key = "%d:%s" % (pid, p[0])
        if key in state["seen"]:
            continue
        state["seen"].add(key)
        if total + size > 1_600_000_000:
            continue
        try:
            mem.seek(a)
            data = mem.read(size)
        except Exception:
            continue
        if not data:
            continue
        open(os.path.join(outdir, "pid%d_%x.bin" % (pid, a)), "wb").write(data)
        total += size
        state["bytes"] = total

def dump_loop(outdir):
    while not state["stop"]:
        r = sh("pgrep -x terminal64.exe || true", show=False)
        for pid in [int(x) for x in r.stdout.split()]:
            dump_proc(pid, outdir)
        time.sleep(20)

th = threading.Thread(target=dump_loop, args=(OUT,), daemon=True)
th.start()
subprocess.Popen(["wine", term, "/portable", "/config:" + ini_test], cwd=MT5DIR,
                 env=dict(os.environ), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
t0 = time.time()
while True:
    time.sleep(20)
    r = sh("pgrep -x terminal64.exe || true", show=False)
    if not r.stdout.strip() and time.time() - t0 > 90:
        break
    if time.time() - t0 > 5400:
        print("   timeout de 90 min; cortando")
        break
state["stop"] = True
sh("wineserver -k || true", show=False)
print("   volcado: %d regiones · %.0f MB" % (len(state["seen"]), state["bytes"] / 1e6))

# ---------------------------------------------------------------- 6. logs + informe
paso(6, "Recogiendo logs, journal e informe de operaciones")
for pat in ["logs/*.log", "logs/*.txt", "Tester/**/*.log", "Tester/**/*.htm*",
            "Tester/**/*.xml", "tester/*.log", "goldrush_report.*"]:
    for src in glob.glob(os.path.join(MT5DIR, pat), recursive=True):
        try:
            shutil.copy2(src, os.path.join(OUT, "log_" + os.path.basename(src)))
        except Exception:
            pass
r = sh('find "%s" -name "goldrush_report*" 2>/dev/null' % MT5DIR, show=False)
for src in r.stdout.splitlines():
    try:
        shutil.copy2(src, os.path.join(OUT, "report_" + os.path.basename(src)))
    except Exception:
        pass

# ---------------------------------------------------------------- 7. strings
paso(7, "Escaneando strings del bot descifrado en RAM")
dumps = sorted(glob.glob(os.path.join(OUT, "pid*.bin")))
if dumps:
    sh("python3 %s %s --outdir %s" % (os.path.join(HERE, "scan_strings.py"),
                                      " ".join('"%s"' % d for d in dumps), OUT))
else:
    print("   sin volcados (el tester quizas termino demasiado rapido)")

# ---------------------------------------------------------------- 8. ghidra opcional
if RUN_GHIDRA:
    paso(8, "Ghidra headless: caza del cargador .ex5 (puede tardar ~1h)")
    sh('test -d /tmp/jdk21 || (wget -qO /tmp/jdk21.tar.gz '
       '"https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse" '
       '&& mkdir -p /tmp/jdk21 && tar -xzf /tmp/jdk21.tar.gz -C /tmp/jdk21 --strip-components=1)', show=False)
    os.environ["JAVA_HOME"] = "/tmp/jdk21"
    os.environ["PATH"] = os.environ["JAVA_HOME"] + "/bin:" + os.environ["PATH"]
    import json as _json
    import urllib.request
    rel = _json.load(urllib.request.urlopen(
        "https://api.github.com/repos/NationalSecurityAgency/ghidra/releases/latest"))
    asset = [a for a in rel["assets"] if a["name"].endswith(".zip") and "PUBLIC" in a["name"]][0]
    print("   Ghidra:", asset["name"])
    if not os.path.isdir("/tmp/ghidra"):
        sh('wget -qO /tmp/ghidra.zip "%s"' % asset["browser_download_url"], show=False)
        sh("mkdir -p /tmp/ghidra /tmp/ghidra_tmp && unzip -q /tmp/ghidra.zip -d /tmp/ghidra_tmp "
           "&& mv /tmp/ghidra_tmp/*/ /tmp/ghidra/ && rmdir /tmp/ghidra_tmp", show=False)
    GH = "/tmp/ghidra/support/analyzeHeadless"
    gdir = os.path.join(WORK, "gscripts")
    os.makedirs(gdir, exist_ok=True)
    shutil.copy2(os.path.join(HERE, "find_constants.py"), os.path.join(gdir, "find_constants.py"))
    r = subprocess.run([GH, WORK + "/ghidra_proj", "-import", term,
                        "-scriptPath", gdir, "-postScript", "find_constants.py"],
                       capture_output=True, text=True, timeout=7200)
    open(os.path.join(OUT, "ghidra_log.txt"), "w").write(
        r.stdout[-200000:] + "\n===STDERR===\n" + r.stderr[-50000:])
    for line in r.stdout.splitlines():
        if "HITS" in line:
            print("   ", line)
else:
    paso(8, "Ghidra omitido (RUN_GHIDRA=false)")

print("LAB_OUT =", OUT)
for f in sorted(os.listdir(OUT)):
    try:
        print("   ·", f, os.path.getsize(os.path.join(OUT, f)) // 1024, "KB")
    except Exception:
        pass
print("LISTO")
