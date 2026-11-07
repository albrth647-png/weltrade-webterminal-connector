"""
RAPTOR - lógica de señales (1, 2, 3, R, B) para entradas MANUALES.

Entrada: DataFrame de velas CERRADAS con columnas open, high, low, close
(índice = hora de la vela). Salida: DataFrame con una fila por señal.

Definiciones (según los vídeos de Yoel; los valores numéricos son
parámetros AJUSTABLES, no valores del vídeo):

  Tendencia bajista : EMA30 < EMA50 < EMA100 y EMA100 con pendiente bajista.
                      (la alcista es el espejo exacto)
  Toque             : el máximo de la vela llega a la EMA30, no supera la
                      EMA50 (con tolerancia) y la vela cierra bajo la EMA30.
  "Supera"          : entre un toque y el siguiente el precio hace un mínimo
                      más bajo que el de la vela del toque anterior.
  Estrategia 1      : "engaño". El precio sale de la tendencia (máximo sobre
  (seductora)         la EMA50), regresa bajo la EMA30 y quiebra con cuerpo
                      el mínimo previo. Entrada en esa vela.
  Estrategia 2      : segundo toque.      2B = segundo toque + quiebra.
  Estrategia 3      : tercer toque.       3B = tercer toque + quiebra.
  Quiebra (B)       : vela con cuerpo que cierra por debajo del mínimo
                      anterior al toque, dentro de max_bars_to_break velas.
  R (reset)         : el mismo patrón repetido tras salir de la tendencia
                      y volver (o tras completarse una señal anterior).
                      Ej.: 2RB, 3RB, 1R.

Tipos de señal:
  kind = "entry"  -> 1, 1R, 2B, 2RB, 3B, 3RB (la entrada)
  kind = "touch"  -> 2, 2R, 3, 3R (aviso: "ve a buscar la entrada")
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

TIMEFRAMES = ["M5", "M15", "M30", "H1", "H4"]


@dataclass
class Params:
    ema_fast: int = 30
    ema_mid: int = 50
    ema_slow: int = 100
    slope_bars: int = 10          # pendiente de la EMA100 en N velas
    atr_period: int = 14
    tol_atr: float = 0.10         # tolerancia de toque, en ATR
    swing_lookback: int = 8       # velas hacia atrás para el "mínimo anterior"
    max_bars_to_break: int = 6    # velas máximas entre el toque y la quiebra
    min_body_ratio: float = 0.50  # cuerpo / rango mínimo de la vela de quiebra
    min_body_atr: float = 0.30    # cuerpo mínimo, en ATR
    require_extension: bool = True  # "supera": mínimo nuevo entre toques
    fake_lookback: int = 12       # ventana para el engaño (estrategia 1)
    fake_pre_bars: int = 5        # velas previas al engaño para el mínimo
    reset_after_signal: bool = True  # tras una entrada, lo siguiente es "R"
    emit_touches: bool = True     # emitir también avisos 2, 3, 2R, 3R
    new_trend_gap: int = 60       # si la tendencia faltó >= N velas, vuelve a "original"


def _ema(x: np.ndarray, span: int) -> np.ndarray:
    return pd.Series(x).ewm(span=span, adjust=False).mean().to_numpy()


def _atr(h, l, c, period: int) -> np.ndarray:
    pc = np.r_[c[0], c[:-1]]
    tr = np.maximum.reduce([h - l, np.abs(h - pc), np.abs(l - pc)])
    return pd.Series(tr).ewm(alpha=1 / period, adjust=False).mean().to_numpy()


def _scan_bearish(o, h, l, c, p: Params) -> list[dict]:
    """Detecta señales BAJISTAS. La versión alcista usa series espejo."""
    n = len(c)
    warm = p.ema_slow + p.slope_bars
    if n <= warm + 2:
        return []

    e30, e50, e100 = _ema(c, p.ema_fast), _ema(c, p.ema_mid), _ema(c, p.ema_slow)
    atr = _atr(h, l, c, p.atr_period)
    tol = p.tol_atr * atr

    body = np.abs(c - o)
    rng = np.maximum(h - l, 1e-12)
    bear_candle = (
        (c < o) & (body / rng >= p.min_body_ratio) & (body >= p.min_body_atr * atr)
    )

    slope_dn = np.zeros(n, dtype=bool)
    slope_dn[p.slope_bars:] = e100[p.slope_bars:] < e100[:-p.slope_bars]
    trend = (e30 < e50) & (e50 < e100) & slope_dn

    touch_zone = (h >= e30 - tol) & (h <= e50 + tol) & (c < e30)
    exceeds50 = h > e50 + tol

    events: list[dict] = []
    cycle = 0
    touches = 0
    lost = False
    lost_since = 0
    had_trend = False
    last_touch_i = None
    last_touch_low = np.inf
    pend = None
    fake_used: set[int] = set()

    def suffix() -> str:
        return "R" if cycle >= 1 else ""

    for i in range(warm, n):
        if not trend[i]:
            if had_trend and not lost:
                lost, lost_since = True, i
            touches, pend, last_touch_i = 0, None, None
            continue
        if lost:                       # la tendencia volvió
            # corta ausencia = reset (R); ausencia larga = tendencia nueva (original)
            cycle = 0 if i - lost_since >= p.new_trend_gap else cycle + 1
            lost = False
        had_trend = True

        fired = False

        # ---- quiebra pendiente tras un 2.º o 3.er toque ----------------------
        if pend is not None and i > pend["idx"]:
            if exceeds50[i] or i - pend["idx"] > p.max_bars_to_break:
                pend = None
                if exceeds50[i]:
                    touches, last_touch_i = 0, None
            elif bear_candle[i] and c[i] < pend["ref_low"]:
                n_t = pend["n"]
                events.append(dict(
                    idx=i, kind="entry", pattern=f"{n_t}{suffix()}B",
                    entry=c[i], invalidation=pend["inval"], broken=pend["ref_low"]))
                touches, pend, last_touch_i = 0, None, None
                if p.reset_after_signal:
                    cycle += 1
                fired = True

        # ---- conteo de toques ------------------------------------------------
        if touch_zone[i] and not touch_zone[i - 1]:
            ok = True
            if touches >= 1 and p.require_extension and last_touch_i is not None:
                gap = l[last_touch_i + 1:i]
                ok = gap.size > 0 and gap.min() < last_touch_low
            if ok:
                touches += 1
                last_touch_i, last_touch_low = i, l[i]
                if touches in (2, 3):
                    ref_low = l[max(0, i - p.swing_lookback):i].min()
                    pend = dict(idx=i, ref_low=ref_low, inval=h[i], n=touches)
                    if p.emit_touches:
                        events.append(dict(
                            idx=i, kind="touch", pattern=f"{touches}{suffix()}",
                            entry=np.nan, invalidation=h[i], broken=ref_low))

        # ---- estrategia 1: engaño --------------------------------------------
        if not fired and bear_candle[i] and c[i] < e30[i]:
            lo = max(0, i - p.fake_lookback)
            ks = np.flatnonzero(exceeds50[lo:i]) + lo
            if ks.size:
                k = int(ks[-1])
                if k not in fake_used:
                    ref = l[max(0, k - p.fake_pre_bars):i].min()
                    if c[i] < ref:
                        fake_used.add(k)
                        events.append(dict(
                            idx=i, kind="entry", pattern=f"1{suffix()}",
                            entry=c[i], invalidation=h[k:i].max(), broken=ref))
                        touches, pend, last_touch_i = 0, None, None
                        if p.reset_after_signal:
                            cycle += 1
    return events


def scan(df: pd.DataFrame, timeframe: str, params: Params | None = None) -> pd.DataFrame:
    """Todas las señales (histórico) de un DataFrame de velas cerradas."""
    p = params or Params()
    o, h, l, c = (df[k].to_numpy(dtype=float) for k in ("open", "high", "low", "close"))
    idx = df.index
    rows = []

    for direction, sign in (("SELL", 1), ("BUY", -1)):
        arrs = (o, h, l, c) if sign == 1 else (-o, -l, -h, -c)   # espejo para BUY
        for ev in _scan_bearish(*arrs, p):
            rows.append(dict(
                time=idx[ev["idx"]], bar_index=ev["idx"], timeframe=timeframe,
                direction=direction, kind=ev["kind"], pattern=ev["pattern"],
                entry=sign * ev["entry"], invalidation=sign * ev["invalidation"],
                broken_level=sign * ev["broken"]))

    cols = ["time", "bar_index", "timeframe", "direction", "kind", "pattern",
            "entry", "invalidation", "broken_level"]
    out = pd.DataFrame(rows, columns=cols)
    return out.sort_values(["bar_index", "direction"]).reset_index(drop=True)


def scan_last(df: pd.DataFrame, timeframe: str, params: Params | None = None) -> pd.DataFrame:
    """Solo las señales de la ÚLTIMA vela cerrada (uso en vivo)."""
    sig = scan(df, timeframe, params)
    return sig[sig["bar_index"] == len(df) - 1].reset_index(drop=True)


def scan_all(dfs: dict[str, pd.DataFrame], params: Params | None = None,
             only_last: bool = False) -> pd.DataFrame:
    """dfs = {'M5': df, 'M15': df, 'M30': df, 'H1': df, 'H4': df}"""
    fn = scan_last if only_last else scan
    parts = [fn(dfs[tf], tf, params) for tf in TIMEFRAMES if tf in dfs]
    return pd.concat(parts, ignore_index=True) if parts else pd.DataFrame()
