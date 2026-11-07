"""
RAPTOR - lógica de señales (1, 2, 3, R, B) — v2 (correcciones de la auditoría).

Entrada: DataFrame de velas CERRADAS con columnas open, high, low, close
(índice = hora de la vela). Salida: DataFrame con una fila por señal.

═══════════════════════════════════════════════════════════════════════════
PARTE A — Definiciones SEGÚN LOS VÍDEOS de Yoel (Sifotrader), con cita
═══════════════════════════════════════════════════════════════════════════
  EMAs 30 / 50 / 100  : «el precio tiene que tocar la EMA de TREINTA… NO
                        SUPERAR la de CINCUENTA» (v3 5:19-6:17); EMAs
                        confirmadas por el propietario del repo.
  Estrategia 1        : «venía con tendencia, se sale —le decimos ENGAÑO—,
  (la seductora)        regresa a su tendencia, QUIEBRA CON CUERPO: aquí te
                        da la entrada» (v3 0:29-0:58). El «con cuerpo» está
                        verbalizado SOLO para la 1.
  Estrategia 2        : «primer toque QUE SUPERA y segundo toque» (v3 0:29-0:58).
  Estrategia 3        : «supera el número dos y toca nuevamente la EMA de
                        treinta y cincuenta» = tercer toque (v3 0:58-1:27).
  2B / 3B             : «hizo el SEGUNDO TOQUE pero también QUEBRÓ, en este
                        caso, el MÍNIMO anterior» (v3 4:50-5:19). Dice solo
                        «quebró»: no exige cuerpo.
  R (reset)           : «el precio hizo la estrategia, se salió, volvió y la
                        hizo DE NUEVO en la misma dirección» (v3 1:27-2:25).
  Toques vs entradas  : «UNO DOS TRES ES TOQUE… no es quiebre, es toque…
                        ES PARA QUE TÚ VAYAS A BUSCAR LA ENTRADA» (v3 2:25-2:54):
                        2/3/2R/3R son AVISOS; 1, 1R(1RB) y las variantes B son
                        ENTRADAS.
  Temporalidades      : «la DOS y la TRES NO APLICAN para temporalidades
                        menores… fue creada para temporalidades mayores, DE M15
                        POR ARRIBA» (v2 0:00-0:29) y, para operar, «NOS VAMOS A
                        TEMPORALES MENORES Y BUSCAMOS UNA ENTRADA» con el
                        uno-dos-tres (v2 29-58 s). En el vídeo 03 el catálogo
                        COMPLETO se demuestra en M1. Conciliación implementada:
                        los AVISOS (2, 3, 2R, 3R) solo se emiten desde
                        `emit_touches_from` (M15 por defecto); las ENTRADAS se
                        emiten en todas las TF (v3 las muestra en M1).
  Filtro de distancia : «me gusta, no me gusta, ESTÁ MUY ALEJADA, NO LO TOMO»
                        (v2 58-87 s) → parámetro `max_dist_atr`.
  «El límite»         : «estás en tu límite, ya no puedes pasar de aquí» (v2
                        58-87 s) → el techo del retroceso es la EMA50; el código
                        lo aplica como LÍMITE DURO: toda vela que la supera
                        (`exceeds50`) cancela la secuencia en curso.
  Tendencia comprobada: «EL QUIEBRE SIGNIFICA DOMINIO VENDEDOR CON TENDENCIA
                        COMPROBADA» (v3 5:19-5:48) → capa aparte
                        `multi_tf_trend()` + `filter_trend_confirmed()`.
  Catálogo            : 1, 1R, 1RB, 2, 2R, 2B, 2RB, 3, 3R, 3B, 3RB
                        (etiquetas vistas en el gráfico del v3).

═══════════════════════════════════════════════════════════════════════════
PARTE B — Decisiones de implementación (NO dichas en los vídeos)
═══════════════════════════════════════════════════════════════════════════
  * Tendencia         : EMA30<EMA50<EMA100 (alineación observada en pantalla,
                        f_059) + PENDIENTE bajista de la EMA100 en `slope_bars`
                        velas. La pendiente es añado propio.
  * Toque             : exige CIERRE bajo la EMA30 (más estricto que «tocó»).
  * Tolerancia        : `tol_atr` (0.10 ATR) permite que la mecha roce sin
                        invalidar; es un colchón propio.
  * «Supera»          : entre toques, un mínimo más bajo que el LOW de la vela
                        del toque anterior (Yoel no define la métrica).
  * Referencias       : «mínimo anterior» = mínimo de `swing_lookback` velas
                        previas al toque; mínimo del engaño = mínimo de
                        `fake_pre_bars` velas antes de la salida, dentro de
                        `fake_lookback` (Yoel no define ventanas).
  * Caducidad         : la quiebra caduca a las `max_bars_to_break` velas
                        (los vídeos no ponen límite temporal).
  * Entrada           : al CIERRE de la vela de quiebra (Yoel no precisa).
  * 4.º toque         : no emite nada y no reemplaza el pendiente del 3.er
                        toque (si hay quiebra después, sale etiquetado 3B).
                        Política propia, documentada.
  * Prioridad         : si en la misma vela proceden quiebra pendiente y
                        engaño, gana la quiebra pendiente.
  * Re-disparo        : un segundo engaño EXIGE una nueva salida sobre la
                        EMA50 posterior al engaño anterior (corrección de la
                        auditoría, hallazgo 2).
  * Reset huérfano    : una salida sobre la EMA50 que NO produce engaño y
                        acaba con el precio de vuelta en la EMA30 cuenta como
                        ciclo cumplido («se salió, volvió») y la secuencia
                        siguiente sale con R (`reset_on_abandoned_exit`).
  * 1R vs 1RB         : el audio no resuelve la diferencia (v3 3:52-4:21,
                        ambiguo); el gráfico muestra ambas etiquetas (1R ×260,
                        1RB ×11 en el análisis de frames). Por defecto el
                        engaño reseteado sale `1R` (etiqueta dominante, y el
                        audio «cae, hace un uno nuevamente R» describe la vela
                        del quiebre). Con `fake_reset_label="1RB"` se etiqueta
                        1RB. PREGUNTA ABIERTA pendiente de un nuevo vídeo.

Los valores numéricos son parámetros AJUSTABLES, no valores del vídeo.

Tipos de señal:
  kind = "touch"  -> 2, 2R, 3, 3R (aviso: «ve a buscar la entrada»)
  kind = "entry"  -> 1, 1R (o 1RB), 2B, 2RB, 3B, 3RB (la entrada)
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

TIMEFRAMES = ["M1", "M5", "M15", "M30", "H1", "H4"]
_TF_RANK = {"M1": 0, "M5": 1, "M15": 2, "M30": 3, "H1": 4, "H4": 5}

TOUCH_PATTERNS = {"2", "2R", "3", "3R"}
ENTRY_PATTERNS = {"1", "1R", "1RB", "2B", "2RB", "3B", "3RB"}


@dataclass
class Params:
    # ---- según los vídeos ----
    ema_fast: int = 30            # EMA30 (blanca en pantalla)
    ema_mid: int = 50             # EMA50, techo del retroceso («el límite»)
    ema_slow: int = 100           # EMA100, tendencia de fondo
    # ---- decisiones de implementación (ajustables) ----
    slope_bars: int = 10          # pendiente de la EMA100 en N velas (propio)
    atr_period: int = 14
    tol_atr: float = 0.10         # tolerancia de toque, en ATR (propio)
    swing_lookback: int = 8       # velas para el "mínimo anterior" del B (propio)
    max_bars_to_break: int = 6    # caducidad de la quiebra (propio)
    min_body_ratio: float = 0.50  # cuerpo/rango mínimo de la vela de quiebra
    min_body_atr: float = 0.30    # cuerpo mínimo, en ATR
    require_body_on_break: bool = False  # cuerpo en 2B/3B: solo confirmado p/ la 1
    require_extension: bool = True      # «supera»: mínimo nuevo entre toques
    fake_lookback: int = 12       # ventana del engaño (propio)
    fake_pre_bars: int = 5        # velas previas a la salida para el mínimo
    reset_after_signal: bool = True     # tras una entrada, lo siguiente es "R"
    reset_on_abandoned_exit: bool = True  # salida sin engaño + retorno = reset
    emit_touches: bool = True     # emitir también avisos 2, 3, 2R, 3R
    emit_touches_from: str = "M15"  # «la 2 y la 3… de M15 por arriba» (v2)
    max_dist_atr: float | None = 2.0  # «muy alejada, no lo tomo» (v2); None = off
    fake_reset_label: str = "1R"  # etiqueta del engaño reseteado: "1R" | "1RB"
    new_trend_gap: int = 60       # tendencia ausente >= N velas = tendencia nueva


def _ema(x: np.ndarray, span: int) -> np.ndarray:
    return pd.Series(x).ewm(span=span, adjust=False).mean().to_numpy()


def _atr(h, l, c, period: int) -> np.ndarray:
    pc = np.r_[c[0], c[:-1]]
    tr = np.maximum.reduce([h - l, np.abs(h - pc), np.abs(l - pc)])
    return pd.Series(tr).ewm(alpha=1 / period, adjust=False).mean().to_numpy()


def _tf_rank(tf: str) -> int:
    if tf not in _TF_RANK:
        raise ValueError(f"timeframe desconocido: {tf} (válidos: {TIMEFRAMES})")
    return _TF_RANK[tf]


def _scan_bearish(o, h, l, c, p: Params, tf: str) -> list[dict]:
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
    # vela de quiebra CON CUERPO (requisito confirmado en vídeo solo para la 1)
    body_break = (c < o) & (body / rng >= p.min_body_ratio) & (body >= p.min_body_atr * atr)
    # para 2B/3B el vídeo dice solo «quebró»: la condición real es close < ref_low;
    # exigir cuerpo ahí es una extensión propia activable con require_body_on_break

    # «muy alejada, no lo tomo» (v2): cierre demasiado lejos de la EMA30
    if p.max_dist_atr is not None:
        dist_ok = (e30 - c) <= p.max_dist_atr * atr
    else:
        dist_ok = np.ones(n, dtype=bool)

    slope_dn = np.zeros(n, dtype=bool)
    slope_dn[p.slope_bars:] = e100[p.slope_bars:] < e100[:-p.slope_bars]
    trend = (e30 < e50) & (e50 < e100) & slope_dn

    touch_zone = (h >= e30 - tol) & (h <= e50 + tol) & (c < e30) & dist_ok
    exceeds50 = h > e50 + tol          # «el límite»: no se puede pasar de aquí

    emit_touch_here = p.emit_touches and _tf_rank(tf) >= _tf_rank(p.emit_touches_from)

    events: list[dict] = []
    cycle = 0
    touches = 0
    lost = False
    lost_since = 0
    had_trend = False
    last_touch_i = None
    last_touch_low = np.inf
    pend = None
    min_exit_bar = -1        # suelo: un engaño exige salida NUEVA posterior
    exit_open = False        # hay una salida sobre la EMA50 aún "sin dueño"
    exit_k = -1              # última vela de esa salida

    def suffix() -> str:
        return "R" if cycle >= 1 else ""

    for i in range(warm, n):
        if not trend[i]:
            if had_trend and not lost:
                lost, lost_since = True, i
            touches, pend, last_touch_i = 0, None, None
            exit_open = False            # el retorno nunca llegó
            continue
        if lost:                       # la tendencia volvió
            # corta ausencia = reset (R); ausencia larga = tendencia nueva (original)
            cycle = 0 if i - lost_since >= p.new_trend_gap else cycle + 1
            lost = False
        had_trend = True

        fired = False

        # ---- salida sobre la EMA50 («se sale» / «el límite») ----------------
        if exceeds50[i]:
            pend = None
            if touches >= 1 or cycle >= 1:
                # el retroceso dejó de respetar la EMA50: la secuencia muere
                touches, last_touch_i = 0, None
                if p.reset_on_abandoned_exit:
                    exit_open = True
                    exit_k = i   # última vela de la salida en curso

        # ---- quiebra pendiente tras un 2.º o 3.er toque ----------------------
        if pend is not None and i > pend["idx"]:
            if exceeds50[i] or i - pend["idx"] > p.max_bars_to_break:
                pend = None
            elif (body_break[i] or not p.require_body_on_break) and c[i] < pend["ref_low"]:
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
                # salida huérfana consumida: el precio «se salió y volvió» = reset
                if exit_open:
                    exit_open = False
                    min_exit_bar = exit_k   # esa salida ya no puede dar engaño
                    cycle += 1
                if touches in (2, 3):
                    ref_low = l[max(0, i - p.swing_lookback):i].min()
                    pend = dict(idx=i, ref_low=ref_low, inval=h[i], n=touches)
                    if emit_touch_here:
                        events.append(dict(
                            idx=i, kind="touch", pattern=f"{touches}{suffix()}",
                            entry=np.nan, invalidation=h[i], broken=ref_low))

        # ---- estrategia 1: engaño --------------------------------------------
        if not fired and body_break[i] and c[i] < e30[i]:
            lo = max(0, i - p.fake_lookback)
            ks = np.flatnonzero(exceeds50[lo:i]) + lo
            ks = ks[ks > min_exit_bar]          # exige salida NUEVA (no reusar)
            if ks.size:
                k = int(ks[-1])
                ref = l[max(0, k - p.fake_pre_bars):i].min()
                if c[i] < ref:
                    min_exit_bar = i            # el próximo engaño exige salida posterior
                    events.append(dict(
                        idx=i, kind="entry",
                        pattern="1" if cycle == 0 else p.fake_reset_label,
                        entry=c[i], invalidation=h[k:i].max(), broken=ref))
                    touches, pend, last_touch_i = 0, None, None
                    exit_open = False
                    if p.reset_after_signal:
                        cycle += 1
    return events


def scan(df: pd.DataFrame, timeframe: str, params: Params | None = None) -> pd.DataFrame:
    """Todas las señales (histórico) de un DataFrame de velas cerradas."""
    p = params or Params()
    _tf_rank(timeframe)  # valida el TF
    o, h, l, c = (df[k].to_numpy(dtype=float) for k in ("open", "high", "low", "close"))
    idx = df.index
    rows = []

    for direction, sign in (("SELL", 1), ("BUY", -1)):
        arrs = (o, h, l, c) if sign == 1 else (-o, -l, -h, -c)   # espejo para BUY
        for ev in _scan_bearish(*arrs, p, timeframe):
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
    """dfs = {'M1': df, 'M5': df, 'M15': df, 'M30': df, 'H1': df, 'H4': df}"""
    fn = scan_last if only_last else scan
    parts = [fn(dfs[tf], tf, params) for tf in TIMEFRAMES if tf in dfs]
    return pd.concat(parts, ignore_index=True) if parts else pd.DataFrame()


# ══════════════════════════════════════════════════════════════════════════
# Capa «tendencia comprobada» (v3 5:19-5:48) — multi-TF, separada del scan
# ══════════════════════════════════════════════════════════════════════════
# El scanner real de Yoel (RaptorScanEngine, Flip 1-5, Step 200/500/800) NO es
# público; esto implementa solo la parte observable: bloques rojos/azules
# multi-TF = alineación precio/EMA30/EMA50/EMA100 coincidente en varias TF
# («precio < EMA30 < EMA50 < EMA100 = tendencia bajista alineada», f_059).

def multi_tf_trend(dfs: dict[str, pd.DataFrame], params: Params | None = None) -> dict[str, str | None]:
    """Tendencia alineada por TF en la ÚLTIMA vela cerrada:
    'SELL' si close<EMA30<EMA50<EMA100, 'BUY' si el espejo, None si no está alineada."""
    p = params or Params()
    out: dict[str, str | None] = {}
    for tf, df in dfs.items():
        c = df["close"].to_numpy(dtype=float)
        if len(c) < p.ema_slow + 2:
            out[tf] = None
            continue
        e30, e50, e100 = _ema(c, p.ema_fast), _ema(c, p.ema_mid), _ema(c, p.ema_slow)
        cl = c[-1]
        if cl < e30[-1] < e50[-1] < e100[-1]:
            out[tf] = "SELL"
        elif cl > e30[-1] > e50[-1] > e100[-1]:
            out[tf] = "BUY"
        else:
            out[tf] = None
    return out


def filter_trend_confirmed(signals: pd.DataFrame, dfs: dict[str, pd.DataFrame],
                           higher: tuple[str, ...] = ("H1", "H4"),
                           params: Params | None = None) -> pd.DataFrame:
    """Capa «tendencia comprobada» (v3 5:19-5:48): conserva solo las señales cuya
    dirección coincide con la tendencia alineada de las TF superiores.

    Semántica de consenso estricto:
      * si las TF superiores definidas discrepan entre sí -> sin confirmación
        (devuelve 0 señales);
      * si coinciden todas -> solo pasan las señales de esa dirección;
      * si ninguna TF superior está alineada -> filtro inerte (pasa todo)."""
    if signals.empty:
        return signals.reset_index(drop=True)
    trends = multi_tf_trend({tf: dfs[tf] for tf in higher if tf in dfs}, params)
    dirs = {d for d in trends.values() if d}
    if not dirs:
        return signals.reset_index(drop=True)      # sin referencia multi-TF: inerte
    if len(dirs) > 1:
        return signals.iloc[0:0].copy()            # TFs en desacuerdo: sin confirmación
    d = dirs.pop()
    return signals[signals["direction"] == d].reset_index(drop=True)
