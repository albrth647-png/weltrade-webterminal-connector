# -*- coding: utf-8 -*-
"""
DIAGNÓSTICO DEL BACKTEST — ¿por qué el WR no coincide con el del baseline v1?

El baseline v1 (`backtest_raptor/reporte.md`) dio WR 45,7 % / PF 1,27 con
3.341 señales en 1 año × FX Vol 20/60/99. Este backtest da WR ~33 %. No es el
mismo experimento, y este script separa los cuatro factores que lo explican:

  A  recorrido del SL/TP en la TF de la señal (como quedó tras la regla de
     independencia): una vela de M15/M30/H1 que toca TP y SL a la vez se
     contaba como pérdida. Es un sesgo del SIMULADOR, no de la estrategia.
  B  recorrido en M5 (misma resolución que el baseline v1).
  C  + dedup 45 min por dirección (el baseline v1 deduplicaba por zona).
  D  + solo patrones ORIGINALES: fuera 1R/2R/2RB/3RB… (la cascada de resets
     repite el mismo movimiento y es la mayoría de las entradas).
  E  + score ≥ 60 (el baseline v1 filtraba por score; la híbrida no).

Uso:  python diagnostico_backtest.py
Salida: backtest_hibrida/diagnostico.md + tabla por consola
"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
import backtest_hibrida as B          # noqa: E402
import raptor_hibrida as H            # noqa: E402

ACTIVOS = ["FX Vol 20", "FX Vol 40", "SFX Vol 20", "SFX Vol 40"]

VARIANTES = [
    ("A · actual: recorrido TF propia, sin dedup", dict(resolucion="propia", dedup=0, originales=False, score=0)),
    ("B · recorrido en M5", dict(resolucion="m5", dedup=0, originales=False, score=0)),
    ("C · M5 + dedup 45 min", dict(resolucion="m5", dedup=45, originales=False, score=0)),
    ("D · C + solo originales (sin R)", dict(resolucion="m5", dedup=45, originales=True, score=0)),
    ("E · D + score ≥ 60 (trato v1)", dict(resolucion="m5", dedup=45, originales=True, score=60)),
]


def preparar(activo: str):
    """Señales híbridas enriquecidas del activo (una sola pasada)."""
    dfs = B.cargar_dfs("weltrade", activo, 30)
    p = H.HibridaParams()
    enr, _ = H.enriquecer(H._scan_todos(dfs, p.v2), dfs, p)
    return dfs, enr


def correr(dfs, enr, resolucion, dedup, originales, score):
    s = enr
    if originales:
        s = s[~s["pattern"].astype(str).str.contains("R", regex=False)]
    s = B.aplicar_dedup(s, dedup)
    if score:
        s = s[s["score"] >= score]
    return B.resolver_senales(s, dfs, independiente=True, resolucion=resolucion)


def main():
    lineas = []
    add = lineas.append
    add("# Diagnóstico del backtest — diferencias con el baseline v1")
    add("")
    add(f"- Activos: {', '.join(ACTIVOS)} · ventana descargada (1 mes)")
    add("- La estrategia NO cambia entre variantes: solo cambian la resolución del simulador")
    add("  y el tratamiento de la muestra (dedup / originales / score).")
    add("")
    add("| Variante | ops | WR % | netR | PF | ambiguas |")
    add("|---|---|---|---|---|---|")

    preparados = {a: preparar(a) for a in ACTIVOS}   # una sola pasada por activo
    totales = {}
    for nombre, v in VARIANTES:
        partes = []
        for activo, (dfs, enr) in preparados.items():
            r = correr(dfs, enr, **v)
            r["activo"] = activo
            partes.append(r)
        todo = pd.concat(partes, ignore_index=True)
        st = B.stats(todo)
        totales[nombre] = (todo, st)
        add(f"| {nombre} | {st['resueltas']} | {st['wr']} | {st['netR']} | {st['pf']} | {st['ambiguas']} |")

    add("")
    add("## Ambigüedad por temporalidad (variante A vs B)")
    add("")
    add("Operaciones en las que la MISMA vela toca TP y SL y se cuentan como pérdida.")
    add("")
    add("| TF | A ops | A WR % | A ambiguas | B ops | B WR % | B ambiguas |")
    add("|---|---|---|---|---|---|---|")
    a, _ = totales[VARIANTES[0][0]]
    b, _ = totales[VARIANTES[1][0]]
    for tf in ("M5", "M15", "M30", "H1"):
        sa = B.stats(a[a["timeframe"] == tf]) if len(a) else {}
        sb = B.stats(b[b["timeframe"] == tf]) if len(b) else {}
        add(f"| {tf} | {sa.get('resueltas', 0)} | {sa.get('wr')} | {sa.get('ambiguas', 0)} | "
            f"{sb.get('resueltas', 0)} | {sb.get('wr')} | {sb.get('ambiguas', 0)} |")

    add("")
    add("## Composición de la muestra (variante B)")
    add("")
    add("| patrón | ops | WR % | netR | PF |")
    add("|---|---|---|---|---|")
    bi = b[b["resultado"].isin(("ganada", "perdida"))]
    for pat, g in bi.groupby("pattern"):
        st = B.stats(g)
        add(f"| {pat} | {st['resueltas']} | {st['wr']} | {st['netR']} | {st['pf']} |")

    add("")

    # ---- la vara de medir: el WR no es comparable si el rr es distinto ----
    def rr_exp(st):
        w = st["wr"] / 100.0
        e = st["netR"] / max(st["resueltas"], 1)
        return (e + 1.0 - w) / w, e

    v1 = {"wr": 45.7, "netR": 481.3, "resueltas": 3341}
    rr_v1, e_v1 = rr_exp(v1)
    clave = "C · M5 + dedup 45 min" if "C · M5 + dedup 45 min" in totales else list(totales)[0]
    st_mio = totales[clave][1]
    rr_mio, e_mio = rr_exp(st_mio)

    add("## La vara de medir (el WR no es comparable con otro rr)")
    add("")
    add("v1 fija el SL desde el NIVEL de la zona y el TP desde el CIERRE: el rr que")
    add("acaba pagando no es 2 sino ~1,5. Con rr distinto, el mismo acierto vale distinto.")
    add("")
    add("| | baseline v1 (1 año) | híbrida " + str(clave) + " |")
    add("|---|---|---|")
    add(f"| rr implícito (de WR/netR, sin suponerlo) | {rr_v1:.2f} | {rr_mio:.2f} |")
    add(f"| WR de equilibrio = 1/(1+rr) | {100/(1+rr_v1):.1f} % | {100/(1+rr_mio):.1f} % |")
    add(f"| WR real | {v1['wr']:.1f} % | {st_mio['wr']:.1f} % |")
    add(f"| edge sobre su equilibrio | +{v1['wr']-100/(1+rr_v1):.1f} pp | +{st_mio['wr']-100/(1+rr_mio):.1f} pp |")
    add(f"| exp/op | +{e_v1:.3f} R | {e_mio:+.3f} R |")
    add(f"| WR equivalente si el rr fuera 2,00 | {(e_v1+1)/3*100:.1f} % | {st_mio['wr']:.1f} % |")
    add("")
    gap = v1["wr"] - st_mio["wr"]
    vara = 100 / (1 + rr_v1) - 100 / (1 + rr_mio)   # lo que sube el equilibrio al bajar el rr
    add(f"De los {gap:.1f} pp de diferencia, {vara:.1f} pp son vara de medir (rr 1,5 vs 2,0) "
        f"y solo {gap - vara:.1f} pp son ventaja real.")
    add(f"Con el spread medido en C1 (λ ≈ 0,0177 R/op) la híbrida queda en "
        f"{e_mio-0.0177:+.3f} R/op y el v1 en {e_v1-0.0177:+.3f} R/op.")
    add("")
    add("## Referencia: baseline v1 (NO es esta estrategia)")
    add("- 3.341 señales · WR 45,7 % · PF 1,27 · 1 año × FX Vol 20/60/99.")
    add("- Señal v1 = toque de ZONA M15 con fases EARLY/MAIN/LATE, score ≥ 60,")
    add("  dedup 45 min por zona, SL 1·ATR / TP 2·ATR, recorrido en M5.")
    add("- La híbrida actual emite el catálogo de Yoel (EMA30/50/100), sin score mínimo")
    add("  y sin dedup: son poblaciones de señales distintas.")

    informe = "\n".join(lineas) + "\n"
    (Path(__file__).resolve().parent.parent.parent / "backtest_hibrida" / "diagnostico.md").write_text(
        informe, encoding="utf-8")
    print(informe)


if __name__ == "__main__":
    main()
