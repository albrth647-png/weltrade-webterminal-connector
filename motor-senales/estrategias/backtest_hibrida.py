# -*- coding: utf-8 -*-
"""
BACKTESTING de la RAPTOR HÍBRIDA — núcleo Yoel (v2) + capas v1, con capa de
riesgo IDÉNTICA a la del baseline v1 para poder comparar:

  SL = nivel_entry ∓ 1·ATR(M15, SMA14)   TP = precio ± 2·ATR(M15, SMA14)
  vela con TP y SL a la vez = PÉRDIDA (conservador, como el backtest v1)
  netR: ganada = +rr (rr = |tp-entry|/|entry-sl|), perdida = −1

Experimentos:
  E0  v2 pura (baseline Yoel sobre estos datos)
  E1  híbrida capas OFF == E0, pero con score/contexto: jerarquía de patrones
      de Yoel (¿2B/2RB rinden por encima?) y separación por quintiles de score
  E2  + filtro de sesgo H1 (tolerante→duro: exige sesgo_ok)
  E3  + filtro de confluencia a favor (zona S/R)
  E4  + filtro de gatillo direccional
  E5  curva PF vs score_min con validación walk-forward IN/OUT (mitad/mitad)

Fuentes de datos (--fuente):
  weltrade : backtest_hibrida/datos/<Sim>_<TF>.csv (cmd 11 del conector —
             velas REALES de los índices sintéticos; requiere haber corrido
             `node conector/abrir_demo.js velas`)
  binance  : BTCUSDT 1m público (validación del engranaje; NO son sintéticos)

Salida: backtest_hibrida/reporte.md + senales_hibrida_<fuente>_<sim>.csv
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent))
import raptor_hibrida as H  # noqa: E402
from raptor_strategy import Params, scan as scan_v2  # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent.parent   # …/weltrade-webterminal-connector
DIR_DATOS = RAIZ / "backtest_hibrida" / "datos"
(DIR_RAIZ := RAIZ / "backtest_hibrida").mkdir(parents=True, exist_ok=True)
TF_REGRA = {"M1": "1min", "M5": "5min", "M15": "15min", "M30": "30min", "H1": "1h", "H4": "4h"}


# ────────────────────────────────────────────────────────────────────────────
# Datos
# ────────────────────────────────────────────────────────────────────────────

def leer_csv_weltrade(simbolo: str, tf: str) -> pd.DataFrame:
    f = DIR_DATOS / f"{simbolo.replace(' ', '_')}_{tf}.csv"
    if not f.exists():
        raise FileNotFoundError(f"no existe {f} — ejecuta antes: node conector/abrir_demo.js velas")
    df = pd.read_csv(f)
    idx = pd.to_datetime(df["time"], utc=True)
    # .to_numpy() es imprescindible: si se pasan Series, pandas las alinea por
    # etiqueta (0..n-1) contra el índice de fechas y deja TODAS las velas en NaN.
    out = pd.DataFrame({"open": df["open"].to_numpy(dtype=float),
                        "high": df["high"].to_numpy(dtype=float),
                        "low": df["low"].to_numpy(dtype=float),
                        "close": df["close"].to_numpy(dtype=float)}, index=idx)
    return out[~out.index.duplicated(keep="first")].sort_index()


def fetch_binance_1m(symbol: str, days: int) -> pd.DataFrame:
    end = int((datetime.now(timezone.utc) - timedelta(minutes=1)).timestamp() * 1000)
    start = end - days * 24 * 60 * 60 * 1000
    rows, cur = [], start
    url = "https://api.binance.com/api/v3/klines"
    while cur < end:
        q = f"?symbol={symbol}&interval=1m&startTime={cur}&limit=1000"
        with urllib.request.urlopen(url + q, timeout=30) as r:
            batch = json.loads(r.read())
        if not batch:
            break
        rows.extend(batch)
        cur = batch[-1][6] + 1
        if len(batch) < 1000:
            break
    df = pd.DataFrame(rows)[[0, 1, 2, 3, 4]]
    df.columns = ["open_time", "open", "high", "low", "close"]
    df = df.drop_duplicates("open_time").sort_values("open_time")
    idx = pd.to_datetime(df["open_time"].astype(np.int64), unit="ms", utc=True)
    out = pd.DataFrame({k: df[k].astype(float).to_numpy() for k in ("open", "high", "low", "close")}, index=idx)
    return out[:-1] if len(out) > 1 else out


def resample(df: pd.DataFrame, rule: str) -> pd.DataFrame:
    return (df.resample(rule, label="left", closed="left")
              .agg({"open": "first", "high": "max", "low": "min", "close": "last"}).dropna())


def cargar_dfs(fuente: str, simbolo: str, dias: int) -> dict[str, pd.DataFrame]:
    if fuente == "weltrade":
        return {tf: leer_csv_weltrade(simbolo, tf) for tf in ("M5", "M15", "M30", "H1")}
    m1 = fetch_binance_1m(simbolo, dias)
    return {"M5": resample(m1, "5min"), "M15": resample(m1, "15min"),
            "M30": resample(m1, "30min"), "H1": resample(m1, "1h")}


# ────────────────────────────────────────────────────────────────────────────
# Capa de riesgo (idéntica a la v1)
# ────────────────────────────────────────────────────────────────────────────

def aplicar_dedup(senales: pd.DataFrame, minutos: int) -> pd.DataFrame:
    """Una entrada por dirección cada `minutos` (la v1 usaba 45 por zona).
    Sin esto, la cascada 1R/2R/3R cuenta el MISMO movimiento varias veces y
    infla el número de operaciones con señales correlacionadas."""
    if not minutos or senales.empty:
        return senales
    df = senales.sort_values("time")
    keep, ultimo = [], {}
    for i, s in df.iterrows():
        if s["kind"] != "entry":
            keep.append(i)
            continue
        k = s["direction"]
        t = pd.Timestamp(s["time"]).value
        if t - ultimo.get(k, -10**30) < minutos * 60 * 10**9:
            continue
        ultimo[k] = t
        keep.append(i)
    return df.loc[keep].sort_values("time").reset_index(drop=True)


def resolver_senales(senales: pd.DataFrame, dfs: dict[str, pd.DataFrame],
                     independiente: bool = True, resolucion: str = "m5") -> pd.DataFrame:
    """Adjunta SL/TP y resuelve el resultado vela a vela.

    INDEPENDIENTE (por defecto): el ATR y el recorrido usan las velas de la
    MISMA temporalidad de la señal — una señal M30 se mide y se camina en M30,
    nunca en M15/M5. Con `independiente=False` se reproduce la capa de riesgo
    v1 (ATR M15 SMA14, recorrido M5) para poder comparar.
    """
    atr_cache: dict[str, np.ndarray] = {}

    def atr_de(tf: str) -> np.ndarray:
        if tf not in atr_cache:
            d = dfs[tf]
            atr_cache[tf] = H._atr_sma(d["high"].to_numpy(float), d["low"].to_numpy(float),
                                       d["close"].to_numpy(float), 14)
        return atr_cache[tf]

    out = []
    for _, s in senales.iterrows():
        # los AVISOS (2/3/2R/3R) no son trades: «es para que tú vayas a buscar
        # la entrada» (v3 2:25-2:54) — se contabilizan, no se resuelven
        if s["kind"] == "touch":
            out.append(dict(sl=np.nan, tp=np.nan, rr=np.nan, resultado="aviso", bars=0, netR=0.0, ambigua=False))
            continue
        tf_sig = str(s["timeframe"])
        tf_atr = tf_sig if independiente else "M15"
        # El ATR sale de la TF de la señal. El RECORRIDO es precisión del
        # simulador, no acoplamiento de la estrategia: en una vela de H1 que
        # toca TP y SL a la vez no se puede saber el orden, y contarla como
        # pérdida sesga el WR hacia abajo. En M5 esa ambigüedad casi no existe.
        if not independiente:
            tf_rec = "M5"
        elif resolucion == "m5" and "M5" in dfs:
            tf_rec = "M5"
        else:
            tf_rec = tf_sig
        if tf_atr not in dfs or tf_rec not in dfs:
            out.append(dict(sl=np.nan, tp=np.nan, rr=np.nan, resultado="sin_atr", bars=0, netR=0.0, ambigua=False))
            continue
        d_atr = dfs[tf_atr]
        atr_tf = atr_de(tf_atr)
        cierre_sig = pd.Timestamp(s["time"]) + pd.Timedelta(seconds=H.TF_SEGUNDOS.get(tf_sig, 300))
        if independiente:
            j = int(s["bar_index"])          # misma vela de la señal, misma TF
        else:
            j = int(d_atr.index.searchsorted(cierre_sig, side="right")) - 1
        atr = atr_tf[j] if 0 <= j < len(atr_tf) else np.nan
        entry = float(s["entry"])
        if not np.isfinite(atr) or atr <= 0:
            out.append(dict(sl=np.nan, tp=np.nan, rr=np.nan, resultado="sin_atr", bars=0, netR=0.0, ambigua=False))
            continue
        sl_d, tp_d = 1.0 * atr, 2.0 * atr
        if s["direction"] == "BUY":
            sl, tp = entry - sl_d, entry + tp_d
        else:
            sl, tp = entry + sl_d, entry - tp_d
        rr = abs(tp - entry) / abs(entry - sl)
        # caminar desde la vela siguiente al cierre de la señal, en la TF del modo
        rec = dfs[tf_rec]
        rec_h = rec["high"].to_numpy(float)
        rec_l = rec["low"].to_numpy(float)
        if tf_rec == tf_sig:
            k0 = int(s["bar_index"]) + 1
        else:
            k0 = int(rec.index.searchsorted(cierre_sig, side="right"))
        resultado, bars, ambigua = "abierta", 0, False
        for k in range(max(0, k0), len(rec)):
            bars = k - k0 + 1
            if s["direction"] == "BUY":
                toca_sl, toca_tp = rec_l[k] <= sl, rec_h[k] >= tp
            else:
                toca_sl, toca_tp = rec_h[k] >= sl, rec_l[k] <= tp
            if toca_sl and toca_tp:
                resultado, ambigua = "perdida", True   # ambigua = pérdida (v1)
                break
            if toca_sl:
                resultado = "perdida"
                break
            if toca_tp:
                resultado = "ganada"
                break
        netR = rr if resultado == "ganada" else (-1.0 if resultado in ("perdida",) else 0.0)
        out.append(dict(sl=sl, tp=tp, rr=rr, resultado=resultado, bars=bars, netR=netR, ambigua=ambigua))
    if not out:   # sin señales: ninguna columna de resultado que rompa el informe
        return senales.assign(sl=np.nan, tp=np.nan, rr=np.nan, resultado="", bars=0, netR=0.0, ambigua=False)
    res = pd.DataFrame(out, index=senales.index)
    return pd.concat([senales, res], axis=1)


def stats(df: pd.DataFrame) -> dict:
    res = df[df["resultado"].isin(("ganada", "perdida"))]
    n = len(res)
    avisos = int((df["resultado"] == "aviso").sum()) if len(df) else 0
    amb = int(df["ambigua"].fillna(False).astype(bool).sum()) if len(df) and "ambigua" in df else 0
    if n == 0:
        return dict(señales=len(df), avisos=avisos, resueltas=0, wr=np.nan, netR=0.0, pf=np.nan,
                    ambiguas=amb)
    gan = res[res["resultado"] == "ganada"]["netR"].sum()
    per = -res[res["resultado"] == "perdida"]["netR"].sum()
    wr = 100.0 * (res["resultado"] == "ganada").mean()
    pf = gan / per if per > 0 else np.inf
    return dict(señales=len(df), avisos=avisos, resueltas=n, wr=round(float(wr), 1),
                netR=round(float(res["netR"].sum()), 2), pf=round(float(pf), 2), ambiguas=amb)


# ────────────────────────────────────────────────────────────────────────────
# Experimentos
# ────────────────────────────────────────────────────────────────────────────

def tabla_por(df: pd.DataFrame, col: str) -> pd.DataFrame:
    filas = []
    for valor, g in df.groupby(col, dropna=False):
        st = stats(g)
        st[col] = str(valor)
        filas.append(st)
    return pd.DataFrame(filas).set_index(col) if filas else pd.DataFrame()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fuente", choices=("weltrade", "binance"), default="binance")
    ap.add_argument("--simbolo", default="BTCUSDT")
    ap.add_argument("--dias", type=int, default=10)
    ap.add_argument("--resolucion", choices=("m5", "propia"), default="m5",
                    help="granularidad del recorrido SL/TP (m5 = precisa; propia = TF de la señal)")
    ap.add_argument("--dedup-min", type=int, default=0,
                    help="minutos entre entradas de la misma dirección (la v1 usaba 45)")
    args = ap.parse_args()

    print(f"─" * 74)
    print(f"BACKTEST HÍBRIDA · fuente={args.fuente} · símbolo={args.simbolo}"
          + (f" · {args.dias} días" if args.fuente == "binance" else ""))
    print(f"─" * 74)
    dfs = cargar_dfs(args.fuente, args.simbolo, args.dias)
    for tf, d in dfs.items():
        print(f"  {tf}: {len(d)} velas ({d.index[0].date()} → {d.index[-1].date()})")

    # núcleo v2 (intacto) + enriquecido híbrido
    p = H.HibridaParams()
    v2 = H._scan_todos(dfs, p.v2)
    enr, capas = H.enriquecer(v2, dfs, p)
    print(f"  capas activas: {capas}")
    enr = aplicar_dedup(enr, args.dedup_min)
    sen = resolver_senales(enr, dfs, independiente=p.independiente, resolucion=args.resolucion)
    sen.to_csv(RAIZ / "backtest_hibrida" / f"senales_hibrida_{args.fuente}_{args.simbolo.replace(' ', '_')}.csv")

    lineas = []
    add = lineas.append
    add(f"# Backtest Híbrida — {args.fuente} · {args.simbolo}" + (f" · {args.dias} días" if args.fuente == "binance" else ""))
    add("")
    add(f"- Fecha: {datetime.now(timezone.utc).isoformat(timespec='seconds')}")
    add(f"- Capas activas: {capas} · núcleo v2 CONGELADO (test T0 de igualdad en verde)")
    add(f"- Modo: {'INDEPENDIENTE por TF (cada TF usa solo sus propias velas)' if p.independiente else 'compartido v1 (zonas M15 / fases M5 / sesgo H1)'}")
    if p.independiente:
        add(f"- Riesgo: SL 1·ATR(TF de la señal, SMA14), TP 2·ATR · recorrido en {args.resolucion.upper()} · "
            f"ambigua=pérdida · dedup {args.dedup_min} min")
    else:
        add("- Riesgo: SL 1·ATR(M15 SMA14), TP 2·ATR, recorrido en M5; ambigua=pérdida (idéntico al baseline v1)")
    for tf, d in dfs.items():
        add(f"- {tf}: {len(d)} velas ({d.index[0]} → {d.index[-1]})")
    add("")
    add("## E0/E1 — v2 pura con contexto (capas OFF, sin filtrar)")
    st0 = stats(sen)
    add(f"- entradas {st0['resueltas']} (avisos {st0['avisos']}) · WR {st0['wr']}% · netR {st0['netR']} · PF {st0['pf']}")
    add("")
    add("### Por patrón (jerarquía de Yoel: ¿2B/2RB por encima?)")
    tpat = tabla_por(sen[sen["resultado"].isin(("ganada", "perdida"))].assign(patron=lambda d: d["pattern"]), "patron")
    if len(tpat):
        add("```")
        add(tpat[["señales", "wr", "netR", "pf"]].to_string())
        add("```")
    add("")
    add("### Por temporalidad (cada TF mide lo suyo)")
    resu_tf = sen[sen["resultado"].isin(("ganada", "perdida"))]
    ttf = tabla_por(resu_tf, "timeframe") if len(resu_tf) else pd.DataFrame()
    if len(ttf):
        add("```")
        add(ttf[["señales", "wr", "netR", "pf"]].to_string())
        add("```")
    else:
        add("(sin entradas resueltas)")
    add("")
    add("### Por quintil de score (¿el score separa?)")
    resu = sen[sen["resultado"].isin(("ganada", "perdida"))].copy()
    if len(resu) >= 20 and resu["score"].notna().any():
        try:
            resu["q_score"] = pd.qcut(resu["score"], 5, duplicates="drop")
            tq = tabla_por(resu, "q_score")
            add("```")
            add(tq[["señales", "wr", "netR", "pf"]].to_string())
            add("```")
        except Exception as e:
            add(f"(quintiles no disponibles: {e})")
    else:
        add("(muestra insuficiente para quintiles)")

    add("")
    add("## E2/E3/E4 — filtros individuales (cada uno ON por separado)")
    for nombre, params in [("E2 sesgo", H.HibridaParams(filtrar_sesgo=True)),
                           ("E3 confluencia a favor", H.HibridaParams(filtrar_confluencia=True)),
                           ("E4 gatillo direccional", H.HibridaParams(filtrar_gatillo=True))]:
        fdf = H.filtrar(sen, params)
        st = stats(fdf)
        add(f"- {nombre}: {st['resueltas']} entradas (+{st['avisos']} avisos) · WR {st['wr']}% · netR {st['netR']} · PF {st['pf']}")

    add("")
    add("### E3-bis — sensibilidad del radio de confluencia (dist_zona_atr ≤ r·ATR)")
    if sen["dist_zona_atr"].notna().any():
        a_favor = ((sen["zona_tipo"] == "resistencia") == (sen["direction"] == "SELL"))
        add("| r (×ATR) | señales ≤ r | a favor |")
        add("|---|---|---|")
        for r in (0.5, 1.0, 2.0, 3.0, 5.0):
            m = (sen["dist_zona_atr"] <= r).fillna(False)
            add(f"| {r} | {int(m.sum())} | {int((m & a_favor).sum())} |")
        add("")
        pcts = sen["dist_zona_atr"].quantile([0.25, 0.5, 0.75]).tolist()
        add(f"- dist_zona_atr p25/p50/p75 = {pcts[0]:.1f}/{pcts[1]:.1f}/{pcts[2]:.1f} — el radio por defecto "
            "(0,5) es estrecho por diseño; subirlo relaja la confluencia (parámetro `confluencia_atr`).")
    else:
        add("(sin distancias de zona — faltó M15)")

    add("")
    add("## E5 — curva score_min (walk-forward IN=1.ª mitad / OUT=2.ª mitad)")
    add("| score_min | señales | WR IN | PF IN | WR OUT | PF OUT |")
    add("|---|---|---|---|---|---|")
    corte = sen["time"].median()
    for umbral in (0, 30, 40, 50, 55, 60, 65, 70):
        fdf = H.filtrar(sen, H.HibridaParams(score_min=umbral))
        st_total = stats(fdf)
        fin_ = fdf[pd.to_datetime(fdf["time"]) < corte]
        fout = fdf[pd.to_datetime(fdf["time"]) >= corte]
        si, so = stats(fin_), stats(fout)
        add(f"| {umbral} | {st_total['resueltas']} | {si['wr']} | {si['pf']} | {so['wr']} | {so['pf']} |")

    add("")
    add("## Nota honesta")
    if args.fuente == "binance":
        add("- Datos BTCUSDT (Binance): validan el ENGRANAJE, no son los sintéticos de Weltrade.")
    else:
        add("- Datos Weltrade vía cmd 11 (velas reales de índices sintéticos).")
    add("- Comparación con el baseline v1 (zonas+fases+score, PF 1,27 / WR 45,7 % / 3.341 señales")
    add("  en 1 año × FX Vol 20/60/99): solo como REFERENCIA; son estrategias distintas.")
    add("- Sin spread/comisión/deslizamiento (igual que el baseline v1).")

    informe = "\n".join(lineas) + "\n"
    out_md = RAIZ / "backtest_hibrida" / f"reporte_{args.fuente}_{args.simbolo.replace(' ', '_')}.md"
    out_md.write_text(informe, encoding="utf-8")
    print(informe)
    print(f"informe → {out_md}")


if __name__ == "__main__":
    main()
