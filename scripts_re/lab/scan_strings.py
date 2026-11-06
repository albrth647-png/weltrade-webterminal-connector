# Escáner de strings en formato interno MQL5 sobre volcados de memoria.
# Busca en volcados (.bin de /proc bajo Wine, o .dmp de Windows):
#   - strings UTF-16LE con prefijo de longitud [len:u32][utf-16] (formato interno MQL5)
#   - strings UTF-16LE planos
#   - variante XOR secuencial (0,1,2,3...) documentada en Meepwn CTF 2018
# Uso: python3 scan_strings.py <archivos...> --outdir DIR
# Salida: strings_runtime.txt (todos, con conteo) + strings_claves.txt (filtrados por tema trading)
import argparse, os, re, struct

CLAVES = re.compile(
    r"(order|trade|lot|risk|stop|take|profit|magic|symbol|gold|xau|rsi|atr|ema|sma|macd"
    r"|bollinger|stoch|trend|signal|strategy|loss|\bsl\b|\btp\b|buy|sell|balance|equity"
    r"|margin|fractal|average|channel|breakout|reversal|grid|hedge|zone|level)", re.I)

def ratio(s):
    if not s:
        return 0.0
    ok = sum(1 for c in s if c.isprintable() or c in "\t ")
    return ok / len(s)

def xor_seq(b):
    # variante XOR secuencial (clave = indice 0,1,2,...) — truco Meepwn CTF 2018
    return bytes((c ^ i) & 0xFF for i, c in enumerate(b))

def add_seq(b):
    # variante aditiva secuencial (stored = orig - i)
    return bytes((c + i) & 0xFF for i, c in enumerate(b))

def score(s):
    # calidad del string: ASCII y cirílico/Latin-1 valen mucho, Unicode exótico no.
    # Evita que basura binaria decodificada "en claro" gane a la variante XOR correcta.
    if not s:
        return 0.0
    good = 0
    for ch in s:
        o = ord(ch)
        if 0x20 <= o <= 0x7E or o == 0x09:
            good += 3
        elif 0x00A0 <= o <= 0x04FF:
            good += 2   # Latin-1 sup., griego, cirílico (bots MT5 en ruso: muy común)
        elif 0x2000 <= o <= 0x206F or 0x3000 <= o <= 0x30FF or 0x4E00 <= o <= 0x9FFF:
            good += 1   # puntuación general y CJK
    return good / (3 * len(s))

def scan_buffer(buf, out):
    n = len(buf); i = 0
    while i < n - 8:
        ln = struct.unpack_from("<I", buf, i)[0]
        if 4 <= ln <= 2048 and i + 4 + 2 * ln <= n:
            raw = buf[i + 4: i + 4 + 2 * ln]
            best = None
            best_sc = 0.0
            for cand in (raw, xor_seq(raw), add_seq(raw)):
                try:
                    s = cand.decode("utf-16-le")
                except Exception:
                    continue
                sc = score(s)
                if sc > best_sc and any(ch.isalpha() for ch in s):
                    best = s
                    best_sc = sc
            if best is not None and best_sc >= 0.75:
                out.append(best)
            i += 4 + 2 * ln
        else:
            i += 1

def scan_utf16(buf, out):
    for m in re.finditer(rb"(?:[ -~]\x00){5,}", buf):
        out.append(m.group().decode("utf-16-le", "ignore"))

def iter_chunks(path, chunk=8 * 1024 * 1024, overlap=131072):
    with open(path, "rb") as f:
        prev_tail = b""
        while True:
            data = f.read(chunk)
            if not data:
                break
            yield prev_tail + data
            prev_tail = data[-overlap:]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("archivos", nargs="+")
    ap.add_argument("--outdir", default=".")
    args = ap.parse_args()
    os.makedirs(args.outdir, exist_ok=True)
    seen = {}
    total = 0
    for path in args.archivos:
        print("  escaneando %s (%.1f MB)..." % (path, os.path.getsize(path) / 1e6), flush=True)
        for buf in iter_chunks(path):
            found = []
            scan_buffer(buf, found)
            scan_utf16(buf, found)
            total += len(found)
            for s in found:
                seen[s] = seen.get(s, 0) + 1
    items = sorted(seen.items(), key=lambda kv: -kv[1])
    with open(os.path.join(args.outdir, "strings_runtime.txt"), "w", encoding="utf-8") as f:
        for s, c in items:
            f.write("%d\t%s\n" % (c, s))
    inter = [s for s, _ in items if CLAVES.search(s)]
    with open(os.path.join(args.outdir, "strings_claves.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(inter))
    print("  strings unicos: %d · candidatos: %d · con claves: %d" % (len(items), total, len(inter)))

if __name__ == "__main__":
    main()
