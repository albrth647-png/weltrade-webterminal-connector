"""Volcado de referencia: corre la HÍBRIDA real (Python) sobre los CSV y escribe JSON.
Uso: python validacion/dump_py.py > validacion/py.json
"""
import json
import math
import sys
import os

import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "estrategias"))
import raptor_hibrida as H  # noqa: E402

BASE = os.path.join(os.path.dirname(__file__), "..", "..", "backtest_hibrida", "datos")
TFS = ["M5", "M15", "M30", "H1"]
SIMS = ["FX_Vol_20", "FX_Vol_40", "SFX_Vol_20", "SFX_Vol_40"]


def limpio(v):
    if v is None:
        return None
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    if isinstance(v, (pd.Timestamp,)):
        return int(v.value // 1_000_000)
    if hasattr(v, "item"):
        v = v.item()
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    return v


def main():
    out = {}
    for sim in SIMS:
        dfs = {}
        for tf in TFS:
            ruta = os.path.join(BASE, f"{sim}_{tf}.csv")
            dfs[tf] = pd.read_csv(ruta, parse_dates=["time"]).set_index("time")
        final, enr, capas = H.scan_hibrida(dfs, H.HibridaParams())
        filas = []
        for r in enr.itertuples(index=False):
            filas.append({
                "t": int(getattr(r, "time").value // 1_000_000),
                "barIndex": int(r.bar_index),
                "tf": r.timeframe,
                "direction": r.direction,
                "kind": r.kind,
                "pattern": r.pattern,
                "entry": limpio(r.entry),
                "invalidation": limpio(r.invalidation),
                "brokenLevel": limpio(r.broken_level),
                "zonaId": limpio(r.zona_id),
                "zonaTipo": limpio(r.zona_tipo),
                "zonaFuerza": limpio(r.zona_fuerza),
                "distZonaAtr": limpio(r.dist_zona_atr),
                "confluencia": bool(r.confluencia),
                "confluenciaFavor": bool(r.confluencia_favor),
                "faseZona": limpio(r.fase_zona),
                "sesgo": limpio(r.sesgo_h1),
                "sesgoOk": bool(r.sesgo_ok),
                "gatilloOk": limpio(r.gatillo_ok),
                "score": limpio(r.score),
            })
        out[sim] = {"filas": filas, "capas": {
            "independiente": capas["independiente"], "zonasPorTf": capas["zonas_por_tf"],
            "sesgoPorTf": capas["sesgo_por_tf"], "fases": capas["fases"],
        }}
    json.dump(out, sys.stdout)


if __name__ == "__main__":
    main()
