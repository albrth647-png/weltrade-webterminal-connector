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
    for nombre, dfs in casos:
        partes = [scan_v2(dfs[tf], tf, Params()) for tf in dfs]
        v2_todas = pd.concat(partes, ignore_index=True)
        check(f"{nombre}: el escenario genera señales v2 ({len(v2_todas)})", len(v2_todas) > 0)
        fin, enr, capas = H.scan_hibrida(dfs, H.HibridaParams())
        mismo = (len(fin) == len(v2_todas)
                 and (fin[["time", "timeframe", "direction", "pattern", "entry"]].reset_index(drop=True)
                      .equals(v2_todas[["time", "timeframe", "direction", "pattern", "entry"]].reset_index(drop=True))))
        check(f"{nombre}: {len(v2_todas)} señales v2 == {len(fin)} híbrida", mismo)
        iguales = enr[["time", "timeframe", "direction", "kind", "pattern", "entry", "invalidation", "broken_level"]].reset_index(drop=True).equals(
            v2_todas[["time", "timeframe", "direction", "kind", "pattern", "entry", "invalidation", "broken_level"]].reset_index(drop=True))
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
    fin, enr, _ = H.scan_hibrida(dfs, H.HibridaParams())
    v2 = pd.concat([scan_v2(dfs[tf], tf, Params()) for tf in dfs], ignore_index=True)
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
    print("T7 — Degradación: faltan TFs de contexto, las señales v2 siguen intactas")
    serie = escenarios_reales()["A"]
    v2 = scan_v2(serie, "M1", Params())
    m5 = dfs_de(serie, incluir_m1=False)
    for nombre, dfs in [("solo M1 (sin M15/H1/M5)", {"M1": serie}),
                        ("M1+M5 sin M15/H1", {"M1": serie, "M5": m5["M5"]})]:
        fin, enr, capas = H.scan_hibrida(dfs, H.HibridaParams())
        mismo = fin[["time", "direction", "pattern", "entry"]].reset_index(drop=True).equals(
            v2[["time", "direction", "pattern", "entry"]].reset_index(drop=True))
        check(f"{nombre}: señales v2 intactas ({len(v2)})", mismo)
        if "M15" not in dfs:
            check(f"{nombre}: capa zonas marcada ausente", capas["zonas"] is False)


if __name__ == "__main__":
    print("=" * 70)
    print("TESTS RAPTOR HÍBRIDA (núcleo v2 congelado)")
    print("=" * 70)
    T0_igualdad(); T1_zonas(); T2_fases(); T3_sesgo(); T4_gatillo(); T5_score(); T6_filtros(); T7_degradacion()
    print("-" * 70)
    print(f"RESULTADO: {OK} ✅ / {FAIL} ❌")
    raise SystemExit(1 if FAIL else 0)
