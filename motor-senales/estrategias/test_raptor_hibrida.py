"""
TESTS DE LA RAPTOR HÍBRIDA (T0-T7) — el núcleo v2 queda congelado.

T0  IGUALDAD (contrato de no-choque): capas OFF ⇒ híbrida ≡ v2 exacta.
T1  Zonas: pivote confirmado, refuerzo ponderado, TN mata zona.
T2  Fases EARLY/MAIN/LATE sobre la zona (lógica v1).
T3  Sesgo H1: alza/baja/lateral; lateral deja pasar.
T4  Gatillo direccional de la vela de la señal.
T5  Score: composición, cap 100, min=0 pasa todo, pesos v1 (LATE+fuerza1).
T6  Filtros ON: solo QUITAN señales, nunca crean ni cambian patrones.
T7  Degradación: sin M15/H1/M5 las señales v2 salen intactas.

Ejecución:  python3 test_raptor_hibrida.py   (desde esta carpeta)
"""
import numpy as np
import pandas as pd

import raptor_hibrida as H
import test_raptor_strategy as v2t  # reutiliza los constructores de escenarios v2 (solo lectura)
from raptor_strategy import Params, scan as scan_v2

OK = 0
FAIL = 0


def check(nombre, cond, detalle=""):
    global OK, FAIL
    if cond:
        OK += 1
        print(f"  ✅ {nombre}")
    else:
        FAIL += 1
        print(f"  ❌ {nombre} {detalle}")


def espejo(df):
    """Espejo v2 para BUY: (o,l,h,c) -> (-o,-l,-h,-c)."""
    out = df.copy()
    out["open"] = -df["open"]
    out["low"] = -df["high"]
    out["high"] = -df["low"]
    out["close"] = -df["close"]
    return out


def dfs_de(serie_m1, incluir_m1=True):
    """Escenario v2 (M1) -> dict de TFs por remuestreo (sin look-ahead: cada TF
    se agrega sobre velas ya cerradas)."""
    def resampleo(df, regla):
        r = df.resample(regla).agg({"open": "first", "high": "max", "low": "min", "close": "last"}).dropna()
        return r
    dfs = {"M5": resampleo(serie_m1, "5min"), "M15": resampleo(serie_m1, "15min"),
           "M30": resampleo(serie_m1, "30min"), "H1": resampleo(serie_m1, "1h")}
    if incluir_m1:
        dfs["M1"] = serie_m1
    return dfs


def escenarios_reales():
    """Series M1 de los escenarios A, B y D del test v2 (generan señales reales)."""
    return {"A": v2t.escenario_A(), "B": v2t.escenario_B(), "D": v2t.escenario_D()}


def idx_horas(t0, n, seg):
    return pd.date_range(t0, periods=n, freq=f"{seg}s")


# ════════════════════════════════════════════════════════════════════
def T0_igualdad():
    print("T0 — IGUALDAD con el núcleo v2 (capas OFF) [contrato de no-choque]")
    casos = []
    for nombre, serie in escenarios_reales().items():
        casos.append((f"escenario {nombre}", dfs_de(serie)))
        casos.append((f"escenario {nombre} espejo", {tf: espejo(d) for tf, d in dfs_de(serie).items()}))
    clave = ["time", "timeframe", "direction", "pattern", "entry"]
    cols_v2 = ["time", "timeframe", "direction", "kind", "pattern", "entry", "invalidation", "broken_level"]
    for nombre, dfs in casos:
        p = H.HibridaParams()                     # params con los que corre la híbrida
        partes = [scan_v2(dfs[tf], tf, p.v2) for tf in dfs]
        partes = [s for s in partes if len(s)]
        v2_todas = pd.concat(partes, ignore_index=True).sort_values(clave).reset_index(drop=True)
        check(f"{nombre}: el escenario genera señales v2 ({len(v2_todas)})", len(v2_todas) > 0)
        fin, enr, capas = H.scan_hibrida(dfs, p)
        fin_ord = fin[clave].sort_values(clave).reset_index(drop=True)
        check(f"{nombre}: {len(v2_todas)} señales v2 == {len(fin)} híbrida",
              len(fin) == len(v2_todas) and fin_ord.equals(v2_todas[clave]))
        iguales = enr[cols_v2].sort_values(clave).reset_index(drop=True).equals(v2_todas[cols_v2])
        check(f"{nombre}: columnas v2 intactas tras enriquecer", iguales)


def T1_zonas():
    print("T1 — Zonas fractales: pivote, refuerzo, TN")
    n = 40
    t = idx_horas("2026-01-01", n, 900)
    # zigzag sin tramos planos: solo son pivotes los extremos marcados
    hi = 100 + 0.4 * np.arange(n) % 3 + np.sin(np.arange(n)) * 0.2
    lo = hi - 2.0
    c = hi - 1.0
    hi[10] = 110; lo[10] = 109.2        # pivote de resistencia en la vela 10 (confirma en 12)
    hi[20] = 110.4; lo[20] = 109.4      # refuerzo cerca (misma zona)
    c[30] = 118; hi[30] = 118.5         # TN: cierre muy por encima de la resistencia
    df = pd.DataFrame({"open": c - 0.5, "high": hi, "low": lo, "close": c}, index=t)
    zonas, atr = H.detectar_zonas(df, H.ZonaParams())
    resis = [z for z in zonas if z["tipo"] == "resistencia"]
    check("pivote de resistencia confirmado", len(resis) >= 1, f"resis={len(resis)}")
    z0 = next(z for z in resis if z["nivel"] > 105)   # la zona del pivote de 110
    check("confirmación sin look-ahead (nacida == t[centro+alas])", z0["nacida"] == t[12], f"nacida={z0['nacida']} vs t[12]={t[12]}")
    check("refuerzo sube la fuerza", any(z["fuerza"] >= 2 for z in resis), f"fuerzas={[z['fuerza'] for z in resis]}")
    check("TN mata la zona (cierre ±0.5·ATR)", any(z["estado"] == "muerta" for z in resis))


def T2_fases():
    print("T2 — Fases EARLY/MAIN/LATE sobre la zona (M5)")
    n = 120
    t = idx_horas("2026-01-01", n, 300)
    nivel = 98.0
    # zigzag base sin pivotes espurios
    hi = 100.5 + np.sin(np.arange(n) * 0.35) * 0.3
    lo = hi - 1.2
    o = hi - 0.4
    c = hi - 0.2
    # pivote soporte en vela 5 (low 98), confirmado vela 7
    lo[5] = 98.0; hi[5] = 99.0; o[5] = 98.6; c[5] = 98.4
    # excursión grande tras el pivote (velas 8-18 suben a 104)
    hi[8:19] = 104.0; lo[8:19] = 98.6; o[8:19] = 99.0; c[8:19] = 103.5
    # 1.er toque POSTERIOR al nacimiento: vela 20 toca la banda del soporte
    lo[20] = 97.9; hi[20] = 98.6; o[20] = 98.4; c[20] = 98.1
    # otra excursión (velas 22-45)
    hi[22:46] = 104.0; lo[22:46] = 98.6; o[22:46] = 99.0; c[22:46] = 103.5
    # 2.º toque: vela 50
    lo[50] = 97.9; hi[50] = 98.6; o[50] = 98.4; c[50] = 98.1
    df = pd.DataFrame({"open": o, "high": hi, "low": lo, "close": c}, index=t)
    zonas, atr = H.detectar_zonas(df, H.ZonaParams())
    sop = [z for z in zonas if z["tipo"] == "soporte"]
    check("pivote de soporte existe", len(sop) >= 1, f"soportes={len(sop)}")
    fases = H.fases_de_zona(df, sop[0], atr[-1], H.ZonaParams())
    fases_solo = [f for (_, f, _) in fases]
    check("1.er toque = EARLY", fases_solo[:1] == ["EARLY"], f"fases={fases_solo[:3]}")
    check("toque tras excursión = MAIN", "MAIN" in fases_solo, f"fases={fases_solo}")


def T3_sesgo():
    print("T3 — Sesgo H1 EMA30 tolerante")
    n = 80
    t = idx_horas("2026-01-01", n, 3600)
    c = np.concatenate([np.linspace(100, 140, 40), np.linspace(140, 100, 40)])
    df = pd.DataFrame({"open": c, "high": c + 1, "low": c - 1, "close": c}, index=t)
    t_h1, est = H.sesgo_h1_serie(df)
    check("tramo alcista → alza", est[39] == "alza", f"est[39]={est[39]}")
    check("tramo bajista pronunciado → baja", est[75] == "baja", f"est[75]={est[75]}")
    params = H.HibridaParams()
    df_s = pd.DataFrame([dict(time=t[39], timeframe="H1", direction="SELL", pattern="2",
                              entry=1.0, invalidation=2.0, broken_level=0.5, kind="touch", bar_index=39)])
    df_s.index = [0]
    sen = H.enriquecer(df_s, {"H1": df}, params)[0]
    check("sesgo alza → SELL no ok (sesgo_ok False)", sen.iloc[0]["sesgo_ok"] is False or sen.iloc[0]["sesgo_ok"] == False)
    df_s2 = df_s.copy(); df_s2["direction"] = "BUY"
    sen2 = H.enriquecer(df_s2, {"H1": df}, params)[0]
    check("sesgo alza → BUY ok", bool(sen2.iloc[0]["sesgo_ok"]))


def T4_gatillo():
    print("T4 — Gatillo direccional (vela de la señal)")
    n = 30
    t = idx_horas("2026-01-01", n, 300)
    c = np.linspace(100, 90, n)
    df = pd.DataFrame({"open": c + 0.2, "high": c + 0.5, "low": c - 0.5, "close": c}, index=t)
    df_s = pd.DataFrame([dict(time=t[20], timeframe="M5", direction="SELL", pattern="1",
                              entry=90.0, invalidation=91.0, broken_level=91.5, kind="entry", bar_index=20)])
    sen = H.enriquecer(df_s, {"M5": df}, H.HibridaParams())[0]
    check("vela bajista + SELL → gatillo_ok True", bool(sen.iloc[0]["gatillo_ok"]))
    df_s2 = df_s.copy(); df_s2["direction"] = "BUY"
    sen2 = H.enriquecer(df_s2, {"M5": df}, H.HibridaParams())[0]
    check("vela bajista + BUY → gatillo_ok False", sen2.iloc[0]["gatillo_ok"] == False)


def T5_score():
    print("T5 — Score: composición, cap, min=0, pesos v1")
    sp = H.ScoreParams()
    check("jerarquía Yoel: 2B/2RB pesan más que el resto",
          sp.peso_patron["2B"] == 40 and sp.peso_patron["2RB"] == 40 and sp.peso_patron["1"] == 30 and sp.peso_patron["2"] == 10)
    # pesos v1 reproduciendo la aritmética documentada: LATE(15)+fuerza1(5)+sesgo(25)+gatillo(10) = 55
    s = sp.peso_fase["LATE"] + min(sp.peso_fuerza_max, 1 * sp.peso_fuerza_por_pivote) + sp.peso_sesgo + sp.peso_gatillo
    check("LATE + fuerza1 + sesgo + gatillo = 55 (como la v1)", s == 55, f"s={s}")
    s2 = min(100.0, sp.peso_patron["2B"] + sp.peso_fase["MAIN"] + 25 + sp.peso_sesgo + sp.peso_gatillo)
    check("cap 100 aplicado", s2 == 100.0, f"s2={s2}")
    check("score_min por defecto 0 (pasa todo)", H.HibridaParams().score_min == 0.0)


def T6_filtros():
    print("T6 — Filtros ON: solo quitan, nunca crean ni cambian")
    dfs = dfs_de(escenarios_reales()["A"])
    p0 = H.HibridaParams()
    fin, enr, _ = H.scan_hibrida(dfs, p0)
    v2 = pd.concat([s for s in (scan_v2(dfs[tf], tf, p0.v2) for tf in dfs) if len(s)], ignore_index=True)
    check("hay señales para el test", len(v2) > 0, "escenario sin señales")
    # con todo OFF: sin filtrar
    check("todo OFF → sin filtrar", len(fin) == len(v2))
    # gatillo duro: quita solo filas sin gatillo
    p = H.HibridaParams(filtrar_gatillo=True)
    fin2, _, _ = H.scan_hibrida(dfs, p)
    esperadas = int(enr["gatillo_ok"].fillna(False).astype(bool).sum())
    check("gatillo ON → count == gatillo_ok True", len(fin2) == esperadas, f"{len(fin2)} vs {esperadas}")
    clave = ["time", "timeframe", "direction", "pattern"]
    sub = v2.set_index(clave)
    check("gatillo ON → subconjunto exacto de v2",
          fin2.set_index(clave).index.isin(sub.index).all() if len(fin2) else True)
    # sesgo duro
    p2 = H.HibridaParams(filtrar_sesgo=True)
    fin3, _, _ = H.scan_hibrida(dfs, p2)
    check("sesgo ON → subconjunto de v2", len(fin3) <= len(v2) and set(fin3["pattern"]) <= set(v2["pattern"]))
    # score_min alto puede dejar vacío, pero jamás añade
    p3 = H.HibridaParams(score_min=99)
    fin4, _, _ = H.scan_hibrida(dfs, p3)
    check("score_min=99 → subconjunto (posiblemente vacío)", len(fin4) <= len(v2))


def T7_degradacion():
    print("T7 — Degradación: sin otras TFs las señales v2 siguen intactas")
    serie = escenarios_reales()["A"]
    p = H.HibridaParams()
    v2 = scan_v2(serie, "M1", p.v2)
    m5 = dfs_de(serie, incluir_m1=False)
    for nombre, dfs in [("solo M1 (sin M15/H1/M5)", {"M1": serie}),
                        ("M1+M5 sin M15/H1", {"M1": serie, "M5": m5["M5"]})]:
        fin, enr, capas = H.scan_hibrida(dfs, p)
        mismo = fin[["time", "direction", "pattern", "entry"]].reset_index(drop=True).equals(
            v2[["time", "direction", "pattern", "entry"]].reset_index(drop=True))
        check(f"{nombre}: señales v2 intactas ({len(v2)})", mismo)
        check(f"{nombre}: contexto solo desde las TF presentes",
              set(capas["zonas_por_tf"]) <= set(dfs) and set(capas["sesgo_por_tf"]) <= set(dfs),
              f"zonas={capas['zonas_por_tf']} sesgo={capas['sesgo_por_tf']}")
    # modo compartido v1: sin M15 no hay capa de zonas (degradación histórica)
    _, _, capas_v1 = H.scan_hibrida({"M1": serie}, H.HibridaParams(independiente=False))
    check("modo compartido sin M15: capa zonas ausente", capas_v1["zonas"] is False)


def T8_independencia():
    print("T8 — Independencia por TF: cada TF aplica la estrategia SOLO con sus velas")
    dfs = dfs_de(escenarios_reales()["A"])
    p = H.HibridaParams()
    check("modo independiente ON por defecto", p.independiente is True)
    check("catálogo completo por TF (avisos 2/3 desde M1)", p.v2.emit_touches_from == "M1")
    sen = H._scan_todos(dfs, p.v2)
    enr, capas = H.enriquecer(sen, dfs, p)
    tfs_sig = set(enr["timeframe"].unique())
    check("zonas calculadas con la TF de cada señal", set(capas["zonas_por_tf"]) == tfs_sig,
          f"zonas_por_tf={capas['zonas_por_tf']} señales={tfs_sig}")
    check("sesgo calculado con la TF de cada señal", set(capas["sesgo_por_tf"]) == tfs_sig,
          f"sesgo_por_tf={capas['sesgo_por_tf']} señales={tfs_sig}")
    # M5 y M1 no deben cambiar si M15/M30/H1 se vuelven irreconocibles
    dfs2 = {tf: d.copy() for tf, d in dfs.items()}
    for tf in ("M15", "M30", "H1"):
        d = dfs2[tf].copy()
        for col in ("open", "high", "low", "close"):
            d[col] = d[col] * 3.0 + 1000.0
        dfs2[tf] = d
    enr2 = H.enriquecer(H._scan_todos(dfs2, p.v2), dfs2, p)[0]
    cols = ["time", "timeframe", "direction", "pattern", "zona_id", "zona_tipo",
            "fase_zona", "sesgo_h1", "sesgo_ok", "score"]
    peque = enr[enr["timeframe"].isin(("M1", "M5"))]
    peque2 = enr2[enr2["timeframe"].isin(("M1", "M5"))]
    check("M1/M5 intactos al perturbar M15/M30/H1",
          len(peque) == len(peque2) and len(peque) > 0
          and peque[cols].reset_index(drop=True).equals(peque2[cols].reset_index(drop=True)),
          f"{len(peque)} vs {len(peque2)}")
    # señal sintética en M5: su contexto debe salir de M5, nunca de M15/H1
    d5 = dfs["M5"]
    k = len(d5) // 2
    sen_m5 = pd.DataFrame([dict(time=d5.index[k], bar_index=k, timeframe="M5",
                                direction="SELL", kind="entry", pattern="2B",
                                entry=float(d5.iloc[k]["close"]),
                                invalidation=float(d5.iloc[k]["high"]),
                                broken_level=float(d5.iloc[k]["low"]))])
    e5, capas5 = H.enriquecer(sen_m5, dfs, p)
    check("señal M5: zonas y sesgo salen de M5",
          capas5["zonas_por_tf"] == ["M5"] and capas5["sesgo_por_tf"] == ["M5"],
          f"{capas5}")
    check("señal M5: sesgo calculado (no 'desconocido')",
          str(e5.iloc[0]["sesgo_h1"]) in ("alza", "baja", "lateral"),
          f"sesgo={e5.iloc[0]['sesgo_h1']}")
    cols_m5 = ["time", "timeframe", "direction", "pattern", "zona_id", "zona_tipo",
               "fase_zona", "sesgo_h1", "sesgo_ok", "score"]
    e5b = H.enriquecer(sen_m5, dfs2, p)[0]
    check("señal M5 intacta al perturbar M15/M30/H1",
          e5[cols_m5].equals(e5b[cols_m5]))


if __name__ == "__main__":
    print("=" * 70)
    print("TESTS RAPTOR HÍBRIDA (núcleo v2 congelado)")
    print("=" * 70)
    T0_igualdad(); T1_zonas(); T2_fases(); T3_sesgo(); T4_gatillo(); T5_score()
    T6_filtros(); T7_degradacion(); T8_independencia()
    print("-" * 70)
    print(f"RESULTADO: {OK} ✅ / {FAIL} ❌")
    raise SystemExit(1 if FAIL else 0)
