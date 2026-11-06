# find_constants.py — script Ghidra headless (Jython)
# Localiza el CARGADOR .ex5 dentro de terminal64.exe por sus constantes conocidas de la
# radiografia (docs/EX5_GoldRush_radiografia.md):
#   0x2E8  tamano de la cabecera clara
#   0xA8   slot UTF-16 del autor
#   0x1A8  slot UTF-16 del link
#   0x2A8  slot UTF-16 de la version
#   0xA0   timestamp de compilacion
# Salida: /tmp/mt5_re/out/ghidra_loader_report.json
import json

TAGS = {
    0x2E8: "header_size",
    0xA8:  "slot_author",
    0x1A8: "slot_link",
    0x2A8: "slot_version",
    0xA0:  "ts_compile",
}

hits = []
fm = currentProgram.getFunctionManager()
it = currentProgram.getListing().getInstructions(True)
while it.hasNext():
    ins = it.next()
    for oi in range(ins.getNumOperands()):
        sc = ins.getScalar(oi)
        if sc is None:
            continue
        v = sc.getUnsignedValue()
        if v in TAGS:
            fn = fm.getFunctionContaining(ins.getAddress())
            hits.append({
                "addr": str(ins.getAddress()),
                "val": hex(v),
                "tag": TAGS[v],
                "func": fn.getName() if fn else None,
                "mnem": ins.getMnemonicString(),
            })

print("HITS:", len(hits))
with open("/tmp/mt5_re/out/ghidra_loader_report.json", "w") as fo:
    json.dump(hits, fo, indent=1)
