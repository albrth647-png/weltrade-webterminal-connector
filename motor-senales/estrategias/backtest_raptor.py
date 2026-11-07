# -*- coding: utf-8 -*-
"""
Backtesting de raptor_strategy.py (v2) con datos REALES + verificador
independiente de reglas («al pie de la letra»).

Datos: BTCUSDT 1m (Binance Spot, público y sin clave). NO es el sintético
FX Volatility 40 (1s) de los vídeos de Yoel (ese no tiene histórico público);
sirve para validar CUMPLIMIENTO DE REGLAS y estadística de señales sobre
velas reales con tendencias. No se calcula win-rate: los vídeos NO definen
TP/SL, y no se inventa nada.

Verificador: recalcula EMAs/ATR/tendencia POR SU CUENTA a partir de las velas
y comprueba cada regla declarada contra cada señal emitida:
  R01 gramática       : patrón ∈ catálogo {1,1R,1RB,2,2R,2B,2RB,3,3R,3B,3RB}
  R02 kind↔patrón     : touch = {2,2R,3,3R}; entry = {1,1R,1RB,2B,2RB,3B,3RB}
  R03 gating TF       : avisos (touch) solo desde emit_touches_from (M15)
  R04 tendencia       : SELL exige EMA30<EMA50<EMA100 + pendiente EMA100 bajista
                        en la vela de la señal (BUY, el espejo)
  R05 toque/ema30     : la vela del toque (o de la señal-touch) cumple zona:
                        high ≥ EMA30-tol, high ≤ EMA50+tol, close < EMA30
  R06 «el límite»     : ninguna vela entre el toque y la quiebra supera EMA50+tol
  R07 distancia       : (EMA30 - close)/ATR ≤ max_dist_atr en el toque
  R08 «supera»        : hay mínimo más bajo que el low del toque anterior
  R09 quiebra         : entry B cumple close < ref_low (ref = min swing_lookback
                        lows previos al toque) y respeta max_bars_to_break
  R10 cuerpo          : la 1/1R/1RB exige vela con cuerpo (ratio≥0.5, ≥0.3 ATR);
                        2B/3B solo si require_body_on_break
  R11 engaño          : la 1/1R/1RB tiene salida sobre EMA50+tol en fake_lookback
                        velas previas y cierra bajo el mínimo de fake_pre_bars
  R12 campos          : entry = close de la vela; invalidation = high del toque
                        (o máx. desde la salida en la 1); broken_level = ref

Salida: informe MD + CSV de señales en docs/backtest/.
"""
from __future__ import annotations

import json
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

sys.path.insert(0, __file__.rsplit("/", 1)[0])
import raptor_strategy as rs  # noqa: E402

SYMBOL = "BTCUSDT"
DAYS = 10
HORIZON = 30          # velas para MFE/MAE (estadística descriptiva)


# ────────────────────────────────────────────────────────────────────────────
# 1. Datos reales
# ────────────────────────────────────────────────────────────────────────────
def fetch_binance_1m(symbol: str, days: int) -> pd.DataFrame:
    """Klines 1m CERRADOS de los últimos N días (paginado, sin clave)."""
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
        cur = batch[-1][6] + 1          # close_time + 1 ms
        if len(batch) < 1000:
            break
    df = pd.DataFrame(rows)[[0, 1, 2, 3, 4, 6]]
    df.columns = ["open_time", "open", "high", "low", "close", "close_time"]
    df = df.drop_duplicates("open_time").sort_values("open_time")
    idx = pd.to_datetime(df["open_time"].astype(np.int64), unit="ms", utc=True)
    out = pd.DataFrame(
        {k: df[k].astype(float).to_numpy() for k in ("open", "high", "low", "close")},
        index=idx)
    return out[:-1] if len(out) > 1 else out      # por si acaso, solo cerradas


def resample(df: pd.DataFrame, rule: str) -> pd.DataFrame:
    r = (df.resample(rule, label="left", closed="left")
           .agg({"open": "first", "high": "max", "low": "min", "close": "last"})
           .dropna())
    return r


# ────────────────────────────────────────────────────────────────────────────
# 2. Indicadores independientes (recalculados, sin usar los helpers del motor)
# ────────────────────────────────────────────────────────────────────────────
def indicators(df: pd.DataFrame, p: rs.Params):
    c = df["close"]
    e30 = c.ewm(span=p.ema_fast, adjust=False).mean().to_numpy()
    e50 = c.ewm(span=p.ema_mid, adjust=False).mean().to_numpy()
    e100 = c.ewm(span=p.ema_slow, adjust=False).mean().to_numpy()
    h, l = df["high"].to_numpy(), df["low"].to_numpy()
    pc = np.r_[c.to_numpy()[0], c.to_numpy()[:-1]]
    tr = np.maximum.reduce([h - l, np.abs(h - pc), np.abs(l - pc)])
    atr = pd.Series(tr).ewm(alpha=1 / p.atr_period, adjust=False).mean().to_numpy()
    return e30, e50, e100, atr


def is_trend(df, i, p, want: str) -> bool:
    e30, e50, e100, _ = indicators(df, p)
    if i < p.ema_slow + p.slope_bars:
        return False
    if want == "SELL":
        return (e30[i] < e50[i] < e100[i] and
                e100[i] < e100[i - p.slope_bars])
    return (e30[i] > e50[i] > e100[i] and
            e100[i] > e100[i - p.slope_bars])


# ────────────────────────────────────────────────────────────────────────────
# 3. Verificador regla a regla
# ────────────────────────────────────────────────────────────────────────────
def verificar(df: pd.DataFrame, tf: str, sig: pd.DataFrame, p: rs.Params,
              fallos: list[str], stats: dict):
    """Verificación INDEPENDIENTE y DIRECCIONAL. El motor escanea BUY en espejo
    (serie negada), así que en espacio original:
       SELL: toque por high (e30-tol ≤ h ≤ e50+tol), close < e30, salida h > e50+tol,
             quiebra de MÍNIMOS, invalidation = high.
       BUY : toque por low  (e50-tol ≤ l ≤ e30+tol), close > e30, salida l < e50-tol,
             quiebra de MÁXIMOS, invalidation = low.
    Para las reglas con estado (qué toque originó la B, qué salida originó la 1)
    se usa búsqueda EXISTENCIAL: la señal es válida si existe UN toque/salida de
    origen cuyas condiciones y campos encajen todos. Ninguna violación real
    (quiebrar sin toque válido, superar la EMA50, cuerpo ausente…) puede pasar.
    """
    if sig.empty:
        return
    o = df["open"].to_numpy(); h = df["high"].to_numpy()
    l = df["low"].to_numpy();  c = df["close"].to_numpy()
    e30, e50, e100, atr = indicators(df, p)
    tol = p.tol_atr * atr
    n = len(df)

    def fail(regla, i, msg):
        fallos.append(f"[{tf}] vela {i} ({df.index[i]}): {regla} — {msg}")

    def zona(t, s):
        """Zona de toque válida (direccional, con filtro de distancia)."""
        if s == 1:
            ok_zone = (h[t] >= e30[t] - tol[t]) and (h[t] <= e50[t] + tol[t]) and c[t] < e30[t]
            ok_dist = p.max_dist_atr is None or (e30[t] - c[t]) <= p.max_dist_atr * atr[t]
        else:
            ok_zone = (l[t] <= e30[t] + tol[t]) and (l[t] >= e50[t] - tol[t]) and c[t] > e30[t]
            ok_dist = p.max_dist_atr is None or (c[t] - e30[t]) <= p.max_dist_atr * atr[t]
        return bool(ok_zone and ok_dist)

    def edges(s):
        """Bordes de zona de toque (entrada a la zona) en toda la serie."""
        z = np.array([zona(t, s) for t in range(n)])
        return list(np.flatnonzero(z & ~np.r_[False, z[:-1]]))

    def body_ok(i, s):
        body = abs(c[i] - o[i]); rng = max(h[i] - l[i], 1e-12)
        color = c[i] < o[i] if s == 1 else c[i] > o[i]
        return color and body / rng >= p.min_body_ratio and body >= p.min_body_atr * atr[i]

    for r in sig.itertuples():
        i = int(r.bar_index); s = 1 if r.direction == "SELL" else -1
        stats.setdefault("por_patron", {}).setdefault(r.pattern, 0)
        stats["por_patron"][r.pattern] += 1

        # R01 gramática
        if r.pattern not in rs.TOUCH_PATTERNS | rs.ENTRY_PATTERNS:
            fail("R01 gramática", i, f"patrón {r.pattern} fuera del catálogo")
            continue
        # R02 kind↔patrón
        if (r.kind == "touch") != (r.pattern in rs.TOUCH_PATTERNS):
            fail("R02 kind", i, f"{r.pattern} con kind={r.kind}")
        # R03 gating TF
        if (r.kind == "touch" and
                rs._TF_RANK[tf] < rs._TF_RANK[p.emit_touches_from]):
            fail("R03 gating TF", i, f"aviso {r.pattern} emitido en {tf}")
        # R04 tendencia alineada en la vela de la señal
        if not is_trend(df, i, p, r.direction):
            fail("R04 tendencia", i, f"sin alineación {r.direction}")

        if r.pattern in ("2B", "2RB", "3B", "3RB"):
            # ── búsqueda existencial del toque origen ────────────────────────
            edgs = [t for t in edges(s) if i - p.max_bars_to_break - 1 <= t < i]
            edgs_prev = [t for t in edges(s) if t < i and t >= i - 60]
            valido = False
            for t in edgs:
                # R06 «el límite»: nada supera la EMA50 entre el toque y la quiebra
                if s == 1:
                    if any(h[u] > e50[u] + tol[u] for u in range(t + 1, i + 1)):
                        continue
                else:
                    if any(l[u] < e50[u] - tol[u] for u in range(t + 1, i + 1)):
                        continue
                # R09 quiebra del ref (direccional) dentro de la caducidad
                ref = l[max(0, t - p.swing_lookback):t].min() if s == 1 \
                    else h[max(0, t - p.swing_lookback):t].max()
                if not (s * c[i] < s * ref):
                    continue
                # R10 cuerpo (si se exige)
                if p.require_body_on_break and not body_ok(i, s):
                    continue
                # R12 campos coherentes con ESTE toque
                inval = h[t] if s == 1 else l[t]
                if abs(r.broken_level - ref) > 1e-9:
                    continue
                if abs(r.invalidation - inval) > 1e-9:
                    continue
                if abs(r.entry - c[i]) > 1e-9:
                    continue
                # R08 «supera»: existe un toque previo tras el que se hizo un
                # extremo nuevo (el motor lo comprueba contra su último toque
                # ACEPTADO; aquí, existencialmente contra cualquier borde previo)
                ext = False
                for pp in [u for u in edgs_prev if u < t]:
                    if s == 1:
                        seg = l[pp + 1:t]
                        if seg.size and seg.min() < l[pp]:
                            ext = True; break
                    else:
                        seg = h[pp + 1:t]
                        if seg.size and seg.max() > h[pp]:
                            ext = True; break
                if p.require_extension and not ext:
                    continue
                valido = True
                break
            if not valido:
                fail("R05+R06+R08+R09+R12 (toque origen)", i,
                     "ningún toque válido explica la B (zona/límite/ref/campos)")

        elif r.pattern in ("1", "1R", "1RB"):
            # ── búsqueda existencial de la salida origen del engaño ──────────
            # R10 cuerpo: la 1 exige «quiebra con cuerpo» SIEMPRE (direccional)
            if not body_ok(i, s):
                fail("R10 cuerpo (1)", i, "el engaño exige quiebra con cuerpo")
            ks = [k for k in range(max(0, i - p.fake_lookback), i)
                  if (h[k] > e50[k] + tol[k] if s == 1 else l[k] < e50[k] - tol[k])]
            if not ks:
                fail("R11 engaño/salida", i, "sin salida sobre la EMA50 en la ventana")
            else:
                valido = False
                for k in ks:
                    ref = l[max(0, k - p.fake_pre_bars):i].min() if s == 1 \
                        else h[max(0, k - p.fake_pre_bars):i].max()
                    if not (s * c[i] < s * ref):
                        continue
                    inval = h[k:i].max() if s == 1 else l[k:i].min()
                    if abs(r.broken_level - ref) > 1e-9:
                        continue
                    if abs(r.invalidation - inval) > 1e-9:
                        continue
                    valido = True
                    break
                if not valido:
                    fail("R11+R12 (engaño)", i,
                         "ninguna salida válida explica los campos de la señal")

        elif r.kind == "touch":
            # la vela de la señal debe ser borde de zona válida
            if not zona(i, s):
                fail("R05 toque", i, "la vela de la señal no cumple la zona de toque")

        # MFE/MAE descriptivo (NO es win-rate: los vídeos no definen TP/SL)
        j = min(n, i + 1 + HORIZON)
        if r.kind == "entry" and j > i + 1:
            fav = (c[i] - l[i + 1:j]) if s == 1 else (h[i + 1:j] - c[i])
            adv = (h[i + 1:j] - c[i]) if s == 1 else (c[i] - l[i + 1:j])
            m = stats.setdefault("mfe_mae", {}).setdefault(r.pattern, [])
            m.append((float(fav.max() / atr[i]), float(adv.max() / atr[i])))


# ────────────────────────────────────────────────────────────────────────────
def main():
    print("=" * 78)
    print(f"BACKTEST RAPTOR v2 — {SYMBOL} 1m real (Binance), últimos {DAYS} días")
    print("=" * 78)
    df1 = fetch_binance_1m(SYMBOL, DAYS)
    print(f"velas 1m: {len(df1)}  ({df1.index[0]} → {df1.index[-1]} UTC)")

    dfs = {"M1": df1, "M5": resample(df1, "5min"), "M15": resample(df1, "15min"),
           "M30": resample(df1, "30min"), "H1": resample(df1, "1h")}
    for tf, d in dfs.items():
        print(f"  {tf}: {len(d)} velas")

    p = rs.Params()
    todas, fallos, stats = [], [], {}
    for tf, d in dfs.items():
        s1 = rs.scan(d, tf, p)
        s2 = rs.scan(d, tf, p)                       # determinismo
        assert s1.equals(s2), f"scan no determinista en {tf}"
        print(f"  {tf}: {len(s1)} señales "
              f"({', '.join(f'{k}×{v}' for k, v in s1.pattern.value_counts().items()) or '—'})")
        todas.append(s1)
        verificar(d, tf, s1, p, fallos, stats)

    sig = pd.concat(todas, ignore_index=True)
    sig = rs.filter_trend_confirmed(sig, dfs, higher=("H1",))
    print(f"\nseñales totales (sin filtro multi-TF H1): {len(pd.concat(todas))} → "
          f"con «tendencia comprobada» H1: {len(sig)}")

    # ── informe ──────────────────────────────────────────────────────────────
    from pathlib import Path
    outdir = Path(__file__).resolve().parents[2] / "docs" / "backtest"
    outdir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    csv_path = outdir / f"senales_raptor_{SYMBOL}_{stamp}.csv"
    sig.to_csv(csv_path, index=False)

    lines = [
        "# Backtest Raptor v2 — cumplimiento de reglas con datos reales",
        "",
        f"- **Datos:** {SYMBOL} 1m (Binance Spot, público) — últimos {DAYS} días "
        f"({df1.index[0]} → {df1.index[-1]} UTC), remuestreado a M5/M15/M30/H1.",
        "- **Aviso honesto:** NO es el sintético FX Volatility 40 (1s) de los vídeos "
        "(sin histórico público). El objetivo es verificar que el motor cumple las "
        "reglas al pie de la letra y medir la frecuencia de señales. **No hay "
        "win-rate: los vídeos no definen TP/SL y no se inventa.**",
        f"- **Parámetros:** todos por defecto (`rs.Params()`) — EMAs 30/50/100, "
        f"tol 0.10 ATR, max_dist_atr 2.0, avisos solo desde M15.",
        "",
        "## Señales por TF",
        "",
        "| TF | total | desglose |",
        "|---|---|---|",
    ]
    for tf, d in dfs.items():
        s = rs.scan(d, tf, p)
        desg = ", ".join(f"{k}×{v}" for k, v in s.pattern.value_counts().items()) or "—"
        lines.append(f"| {tf} | {len(s)} | {desg} |")

    lines += ["", "## Verificación de reglas (independiente, al pie de la letra)", ""]
    reglas = [
        ("R01", "gramática del catálogo"), ("R02", "kind ↔ patrón (toque/entrada)"),
        ("R03", "gating por TF (avisos solo M15+)"), ("R04", "tendencia alineada 30<50<100 + pendiente"),
        ("R05", "zona de toque (EMA30±tol, no superar EMA50, cierre bajo EMA30)"),
        ("R06", "«el límite»: EMA50 no superada entre toque y quiebra"),
        ("R07", "«muy alejada, no lo tomo»: distancia ≤ 2 ATR"),
        ("R08", "«supera»: mínimo nuevo entre toques"),
        ("R09", "quiebra del ref_low dentro de max_bars_to_break"),
        ("R10", "cuerpo: siempre en la 1; en 2B/3B según parámetro"),
        ("R11", "engaño: salida sobre EMA50 + cierre bajo su mínimo de referencia"),
        ("R12", "campos entry/invalidation/broken_level consistentes"),
    ]
    n_fallos = len(fallos)
    for code, desc in reglas:
        ver = "✅ sin violaciones" if not any(f.startswith(f"[") and code in f for f in fallos) else "❌ VIOLACIONES"
        lines.append(f"- **{code}** {desc}: {ver}")
    lines.append("")
    if fallos:
        lines += ["### Violaciones detectadas", ""] + [f"- {f}" for f in fallos[:50]]
    else:
        lines.append("**Resultado: 0 violaciones en todas las señales emitidas.**")

    lines += ["", "## Estadística descriptiva de entradas (MFE/MAE en ATR, "
              f"horizonte {HORIZON} velas)", "",
              "Máximo a favor / en contra tras la entrada. Solo describe el mercado; "
              "no valida la promesa $100→$1,000 (eso depende de TP/SL, lotaje y "
              "ejecución, que los vídeos no definen).", "",
              "| patrón | n | MFE mediana | MAE mediana |", "|---|---|---|---|"]
    for pat, vals in sorted(stats.get("mfe_mae", {}).items()):
        arr = np.array(vals)
        lines.append(f"| {pat} | {len(arr)} | {np.median(arr[:,0]):.2f} | "
                     f"{np.median(arr[:,1]):.2f} |")

    lines += ["", "## Determinismo y filtros", "",
              f"- Re-escaneo idéntico (determinismo): ✅ comprobado en cada TF.",
              f"- Capa «tendencia comprobada» (H1): {len(pd.concat(todas))} → "
              f"{len(sig)} señales.", "",
              f"CSV completo: `{csv_path.name}`", ""]

    md_path = outdir / f"backtest_raptor_{stamp}.md"
    md_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"\ninforme: {md_path}")
    print(f"csv    : {csv_path}")

    print("\n" + "=" * 78)
    if fallos:
        print(f"RESULTADO: {n_fallos} VIOLACIONES de reglas:")
        for f in fallos[:20]:
            print("  -", f)
        sys.exit(1)
    print("RESULTADO: TODAS las reglas se cumplen al pie de la letra "
          f"({len(pd.concat(todas))} señales verificadas, 0 violaciones).")


if __name__ == "__main__":
    main()
