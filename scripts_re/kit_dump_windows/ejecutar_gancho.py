#!/usr/bin/env python3
# ============================================================
#  GANCHO EX5 — runner (lado Windows)
#  ------------------------------------------------------------
#  Caza el .ex5 DESCIFRADO dentro de la RAM de terminal64.exe
#  en el momento en que el lector de MT5 lo carga.
#
#  USO (Windows, con el bot corriendo en MT5 demo):
#    pip install frida frida-tools
#    python ejecutar_gancho.py
#  Repite el escaneo con --veces N --segundos M (útil porque el
#  terminal puede cargar/descargar el bytecode por fases).
# ============================================================
import argparse, hashlib, math, os, sys, time
from collections import Counter

try:
    import frida
except ImportError:
    sys.exit("Falta frida:  pip install frida frida-tools")

CARPETA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "CAPTURA_GANCHO")
PRE = 0x1000
NOM = "terminal64.exe"

def entropia(b):
    if not b:
        return 0.0
    c = Counter(b)
    return -sum((v / len(b)) * math.log2(v / len(b)) for v in c.values())

def frontera_claro_cifrado(d):
    """Primera ventana de 256 B con entropía > 7 en los primeros 4 KB (como la radiografía)."""
    for o in range(0, min(4096, len(d) - 256), 16):
        if entropia(d[o:o + 256]) > 7.0:
            while o < len(d) and d[o] == 0:
                o += 1
            return o
    return -1

def etiqueta(d):
    """Distingue el hallazgo clave: copia cifrada del archivo original vs bytecode en claro."""
    f = frontera_claro_cifrado(d)
    if f < 0:
        return "cabecera EX5 sin frontera cifrada visible", 0.0, f
    cuerpo = d[f:min(len(d), f + 256 * 1024)]
    paso = max(1, len(cuerpo) // 8)
    e = sum(entropia(cuerpo[k * paso:(k + 1) * paso]) for k in range(8)) / 8
    if e < 7.5:
        return "probable DESCIFRADO: bytecode estructurado (¡el objetivo!)", round(e, 2), f
    return "copia CIFRADA del archivo original (no útil)", round(e, 2), f

def strings_mql5(d, tope=60):
    """Strings UTF-16 con prefijo de longitud de 4 bytes (formato interno MQL5,
    técnica del writeup Meepwn CTF 2018) + UTF-16 genérico de respaldo."""
    mql, gen, i, n = [], [], 0, len(d) - 2
    while i < n:
        if d[i + 1] == 0 and 32 <= d[i] <= 126:
            ini = i
            while i + 1 < n and d[i + 1] == 0 and 32 <= d[i] <= 126:
                i += 2
            chars = (i - ini) // 2
            if chars >= 6:
                s = d[ini:i].decode("utf-16-le", "ignore")
                if ini >= 4:
                    pref = int.from_bytes(d[ini - 4:ini], "little")
                    if abs(pref - chars) <= 2 and s not in mql:
                        mql.append(s)
                        continue
                if s not in gen:
                    gen.append(s)
        else:
            i += 2
    return mql[:tope], gen[:tope]

vistos = {}
hits_guardados = []

def on_message(mensaje, datos):
    if mensaje["type"] == "error":
        print("[!]", mensaje.get("description", mensaje)); return
    p = mensaje["payload"]
    t = p.get("tipo")
    if t == "info" or t == "progreso":
        print("[gancho]", p.get("msg") or f"region {p.get('region')} magia {p.get('magia')}: {p.get('hits')} hits")
    elif t == "hit" and datos:
        h = hashlib.sha256(datos).hexdigest()
        if h in vistos:
            print(f"[dup] hallazgo en {p['direccion']} idéntico al ya guardado"); return
        vistos[h] = p["direccion"]
        etiq, ent, fron = etiqueta(datos)
        idx = len(hits_guardados)
        ruta = os.path.join(CARPETA, f"hit_{idx:02d}_{os.path.basename(p['direccion'])}_{len(datos)}b.bin")
        open(ruta, "wb").write(datos)
        mql, gen = strings_mql5(datos)
        with open(os.path.join(CARPETA, f"hit_{idx:02d}_informe.txt"), "w", encoding="utf-8") as fh:
            fh.write(f"hallazgo #{idx}\ndireccion: {p['direccion']}\nbase captura: {p['base']}\n"
                     f"tamano: {len(datos)} bytes\nsha256: {h}\nmagia: {p['magia']}\n"
                     f"frontera claro/cifrado: {hex(fron) if fron >= 0 else 'no detectada'}\n"
                     f"entropia cuerpo: {ent}\netiqueta: {etiq}\n"
                     f"\nstrings MQL5 (prefijo 4B + UTF-16):\n" + "\n".join(mql) +
                     "\n\nstrings UTF-16 genericas:\n" + "\n".join(gen) + "\n")
        hits_guardados.append(ruta)
        estrella = " <-- ¡¡OBJETIVO!!" if "DESCIFRADO" in etiq else ""
        print(f"[hit #{idx}] {len(datos):,} bytes @ {p['direccion']} -> {etiq}{estrella}")
        print(f"           informe: {ruta.replace('.bin', '_informe.txt')}")
    elif t == "fin":
        print("[gancho] escaneo terminado:", p.get("resumen"))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pid", type=int, default=0, help="PID de terminal64.exe (opcional)")
    ap.add_argument("--veces", type=int, default=3, help="número de escaneos")
    ap.add_argument("--segundos", type=int, default=20, help="espera entre escaneos")
    a = ap.parse_args()

    os.makedirs(CARPETA, exist_ok=True)
    disp = frida.get_local_device()
    sesion = disp.attach(a.pid if a.pid else NOM)
    script = sesion.create_script(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "gancho_ex5.js"), encoding="utf-8").read())
    script.on("message", on_message)
    script.load()
    print("=== GANCHO EX5 cargado en", (a.pid or NOM), "===")
    print("El bot debe estar cargado/corriendo en MT5. Escaneando", a.veces, "veces cada", a.segundos, "s...\n")
    for k in range(a.veces):
        try:
            script.exports_sync.escanear()
        except Exception as e:
            print("[!] error del agente:", e)
        if k < a.veces - 1:
            time.sleep(a.segundos)
    print("\n=== FIN ===")
    print("Carpeta de captura:", CARPETA)
    if any("DESCIFRADO" in h for h in [p for p in hits_guardados]):
        print("Hay hits marcados como DESCIFRADO: comprime la carpeta y súbela.")
    else:
        print("Sin bytecode en claro todavía: deja el bot operando y repite con --veces 5.")

if __name__ == "__main__":
    main()
