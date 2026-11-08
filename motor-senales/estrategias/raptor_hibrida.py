"""
RAPTOR HÍBRIDA — núcleo Yoel (v2) INTOCABLE + capas de contexto de la v1 original.

Diseño: `docs/estrategia/hibrida_diseno.md` (contrato de no-choque §1).
Núcleo: `raptor_strategy.py` (se llama, no se edita).

Principio rector
────────────────
Las señales las GENERA el núcleo v2 (catálogo 1/2/3/R/B de los vídeos).
Las 7 piezas de la estrategia original v1 (zonas fractales M15, fuerza de zona,
TN, fases EARLY/MAIN/LATE, sesgo H1 EMA30 tolerante, gatillo direccional y
score ponderado) entran como CAPAS que enriquecen cada señal:

  zona_id, zona_tipo, zona_fuerza, confluencia, confluencia_favor,
  fase_zona, sesgo_h1, sesgo_ok, gatillo_ok, score

y solo FILTRAN si el propietario enciende los interruptores
(filtrar_sesgo / filtrar_confluencia / filtrar_gatillo / score_min) —
TODOS apagados por defecto: con defaults, scan_hibrida ≡ scan (test T0).

Sin look-ahead: los pivotes solo existen `alas` velas después de formarse;
sesgo/fases/zonas se calculan con velas CERRADAS al momento de la señal.

Degradación honesta: si falta M15 no hay zonas/fases/confluencia; si falta H1
no hay sesgo; si falta M5 no hay fase de zona. Las señales v2 salen SIEMPRE
igual; `capas_activas` registra qué capas pudieron aplicarse.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from raptor_strategy import Params, scan  # núcleo v2 — NUNCA se modifica aquí

TF_SEGUNDOS = {"M1": 60, "M5": 300, "M15": 900, "M30": 1800, "H1": 3600, "H4": 14400, "D1": 86400}


def _atr_v2(h, l, c, period: int) -> np.ndarray:
    """ATR del núcleo v2 (EWM α=1/period) — solo para compatibilidad interna."""
    pc = np.r_[c[0], c[:-1]]
    tr = np.maximum.reduce([h - l, np.abs(h - pc), np.abs(l - pc)])
    return pd.Series(tr).ewm(alpha=1 / period, adjust=False).mean().to_numpy()

# jerarquía declarada por Yoel: «la DOS B y la DOS RB van a ser, por encima de
# cualquier cosa, LAS MEJORES» (v3 4:21-4:50); valores propios y ajustables
PESO_PATRON_DEFAULT = {
    "2B": 40, "2RB": 40,                    # las mejores (v3)
    "1": 30, "1R": 30, "1RB": 30, "3B": 30, "3RB": 30,   # entradas
    "2": 10, "3": 10, "2R": 10, "3R": 10,   # avisos («ve a buscar la entrada»)
}


@dataclass
class ZonaParams:
    """Puerto de la v1: `raptor_default.json` zonas/tn/toques (valores idénticos)."""
    alas: int = 2                    # velas a cada lado del pivote (v1: alas 2)
    tol_pivote_atr: float = 0.30     # agrupación de pivotes (v1: tolPivoteAtr)
    tol_pivote_rel: float = 0.0008   # v1: tolPivoteRel
    vigencia_horas: float = 48.0     # v1: vigenciaHoras (purga de zonas muertas)
    tn_atr: float = 0.50             # v1: TN = cierre M15 ± 0.5·ATR mata la zona
    excursion_atr: float = 1.20      # v1: excursión para fase MAIN
    banda_toque_atr: float = 0.15    # v1: banda de toque alrededor del nivel
    confluencia_atr: float = 0.50    # NUEVO (propio): radio de confluencia señal↔zona
    atr_periodo: int = 14            # v1: ATR SMA(14) sobre M15


@dataclass
class ScoreParams:
    """Pesos v1 (fases 25/40/15, fuerza 5/pivote cap 25, sesgo 25, gatillo 10)
    + base por patrón según la jerarquía verbalizada por Yoel."""
    peso_patron: dict = field(default_factory=lambda: dict(PESO_PATRON_DEFAULT))
    peso_fase: dict = field(default_factory=lambda: {"EARLY": 25, "MAIN": 40, "LATE": 15})
    peso_fuerza_por_pivote: float = 5.0
    peso_fuerza_max: float = 25.0
    peso_sesgo: float = 25.0
    peso_gatillo: float = 10.0
    peso_confluencia: float = 0.0    # extra opcional por confluencia a favor
    min: float = 0.0                 # v1 usaba 60; aquí 0 = el score ORDENA, no decide


@dataclass
class HibridaParams:
    v2: Params = field(default_factory=Params)
    zonas: ZonaParams = field(default_factory=ZonaParams)
    score: ScoreParams = field(default_factory=ScoreParams)
    # interruptores de filtro — TODOS OFF por defecto (contrato de no-choque)
    filtrar_sesgo: bool = False        # exige sesgo_h1 a favor (lateral deja pasar)
    filtrar_confluencia: bool = False  # exige confluencia a favor con una zona
    filtrar_gatillo: bool = False      # exige vela de la señal direccional
    score_min: float = 0.0             # 0 = pasa todo


# ══════════════════════════════════════════════════════════════════════════
# CAPA A/B/C — zonas S/R fractales M15 + fuerza + TN (puerto de estrategia.js)
# ══════════════════════════════════════════════════════════════════════════

def _atr_sma(h, l, c, periodo: int) -> np.ndarray:
    """ATR de la v1: media simple de TR sobre `periodo` velas (estrategia.js _recalcAtr)."""
    n = len(c)
    tr = np.empty(n)
    tr[0] = h[0] - l[0]
    pc = np.r_[c[0], c[:-1]]
    tr[1:] = np.maximum.reduce([h[1:] - l[1:], np.abs(h[1:] - pc[1:]), np.abs(l[1:] - pc[1:])])
    out = np.empty(n)
    for i in range(n):
        lo = max(0, i - periodo + 1)
        out[i] = tr[lo:i + 1].mean() if i + 1 >= periodo else tr[lo:i + 1].mean()
    return out


def detectar_zonas(df_m15: pd.DataFrame, zp: ZonaParams):
    """Pivotes fractales M15 confirmados, refuerzo ponderado y TN — en orden temporal.

    Devuelve (zonas, atr_m15):
      zonas: lista de dicts {id, tipo, nivel, fuerza, estado, nacida, muerta_en,
                             historia: [(t, evento)]} — evento ∈ {nueva, refuerzo, tn}
      atr_m15: np.ndarray con el ATR SMA(14) por vela (igual que la v1).

    Sin look-ahead: un pivote de la vela i se confirma en la vela i+alas
    (el código de la v1 lo detecta exactamente así: `_detectarPivotes` corre
    sobre la última vela CERRADA y mira `len-1-w`).
    """
    h = df_m15["high"].to_numpy(dtype=float)
    l = df_m15["low"].to_numpy(dtype=float)
    c = df_m15["close"].to_numpy(dtype=float)
    t = df_m15.index
    n = len(c)
    atr = _atr_sma(h, l, c, zp.atr_periodo) if n else np.zeros(0)
    w = zp.alas

    # 1) pivotes confirmados: (índice confirmación, tipo, nivel)
    #    centro válido en [w, n-1-w]; se confirma cuando cierra la vela centro+w.
    #    COMPARACIÓN ESTRICTA (como la v1: v.h > m[i±k].h) — velas planas no son pivote.
    eventos: list[tuple[int, str, float]] = []
    for centro in range(w, n - w):
        sin_centro = np.r_[h[centro - w:centro], h[centro + 1:centro + w + 1]]
        if h[centro] > sin_centro.max():
            eventos.append((centro + w, "resistencia", h[centro]))
        sin_centro_l = np.r_[l[centro - w:centro], l[centro + 1:centro + w + 1]]
        if l[centro] < sin_centro_l.min():
            eventos.append((centro + w, "soporte", l[centro]))
    eventos.sort(key=lambda e: e[0])

    # 2) simular la v1: por cada vela M15 -> confirmar pivotes, luego TN
    zonas: list[dict] = []
    ev_por_vela: dict[int, list] = {}
    for e in eventos:
        ev_por_vela.setdefault(e[0], []).append(e)
    tn_eventos = []

    def zona_viva(z, ahora):
        if z["estado"] != "activa":
            return False
        if z["nacida"] > ahora:
            return False
        return True

    for j in range(n):
        ahora = t[j]
        for (_, tipo, nivel) in ev_por_vela.get(j, []):
            tolerancia = max(zp.tol_pivote_rel * nivel, zp.tol_pivote_atr * (atr[j] or 0.0))
            candidata = None
            for z in zonas:
                if z["tipo"] == tipo and z["estado"] == "activa" and abs(z["nivel"] - nivel) <= tolerancia:
                    candidata = z
                    break
            if candidata is not None:
                candidata["nivel"] = (candidata["nivel"] * candidata["fuerza"] + nivel) / (candidata["fuerza"] + 1)
                candidata["fuerza"] += 1
                candidata["historia"].append((ahora, "refuerzo"))
            else:
                zonas.append(dict(id=len(zonas) + 1, tipo=tipo, nivel=float(nivel), fuerza=1,
                                  estado="activa", nacida=ahora, muerta_en=None,
                                  historia=[(ahora, "nueva")]))
        # TN de la v1: cierre M15 más allá de nivel ± tn_atr·ATR mata la zona
        a = atr[j] if j < n else 0.0
        if a:
            for z in zonas:
                if z["estado"] != "activa" or z["nacida"] > ahora:
                    continue
                fuera = (c[j] < z["nivel"] - zp.tn_atr * a) if z["tipo"] == "soporte" \
                    else (c[j] > z["nivel"] + zp.tn_atr * a)
                if fuera:
                    z["estado"] = "muerta"
                    z["muerta_en"] = ahora
                    z["historia"].append((ahora, "tn"))
                    tn_eventos.append((ahora, z["id"]))
    return zonas, atr


def _zonas_activas_en(zonas, t_limite):
    """Zonas activas cuyo nacimiento ya ocurrió en/before t_limite (vigencia purga
    solo afecta a zonas ya muertas, como en la v1)."""
    activas = []
    for z in zonas:
        if z["estado"] != "activa" or z["nacida"] > t_limite:
            continue
        if z.get("muerta_en") is not None and z["muerta_en"] > t_limite:
            continue
        activas.append(z)
    return activas


# ══════════════════════════════════════════════════════════════════════════
# CAPA D — fases EARLY/MAIN/LATE sobre la ZONA (v1 _chequearToque, TF toque M5)
# ══════════════════════════════════════════════════════════════════════════

def fases_de_zona(df_m5: pd.DataFrame, zona: dict, atr_m15_en: float, zp: ZonaParams):
    """Cronología de toques de UNA zona en M5 con la lógica v1:
    1.er toque = EARLY; toque tras excursión ≥ excursion_atr·ATR = MAIN; resto = LATE.
    Devuelve lista [(t_m5, fase, nº_toque)]. Llamada perezosa (solo zonas con señales)."""
    if df_m5 is None or len(df_m5) == 0 or not np.isfinite(atr_m15_en) or atr_m15_en <= 0:
        return []
    h = df_m5["high"].to_numpy(dtype=float)
    l = df_m5["low"].to_numpy(dtype=float)
    t = df_m5.index
    banda = zp.banda_toque_atr * atr_m15_en
    toca = (l <= zona["nivel"] + banda) & (h >= zona["nivel"] - banda)
    toques = 0
    excur = 0.0
    out = []
    for i in range(len(t)):
        if t[i] < zona["nacida"]:
            continue
        if toca[i]:
            toques += 1
            if toques == 1:
                fase = "EARLY"
            elif excur >= zp.excursion_atr * atr_m15_en:
                fase = "MAIN"
            else:
                fase = "LATE"
            out.append((t[i], fase, toques))
            excur = 0.0
        else:
            if toques > 0:
                ex = (h[i] - zona["nivel"]) if zona["tipo"] == "soporte" else (zona["nivel"] - l[i])
                if ex > 0:
                    excur = max(excur, ex)
    return out


# ══════════════════════════════════════════════════════════════════════════
# CAPA E — sesgo H1 EMA(30) tolerante (v1 _recalcSesgo, por vela H1 cerrada)
# ══════════════════════════════════════════════════════════════════════════

def sesgo_h1_serie(df_h1: pd.DataFrame, periodo: int = 30, velas_pendiente: int = 3):
    """Estado de sesgo por vela H1 (v1 exacto): alza si cierre>EMA y EMA sube
    `velas_pendiente`; baja si el espejo; lateral si no. Devuelve (t_h1, estados)."""
    if df_h1 is None or len(df_h1) < periodo + velas_pendiente + 1:
        return None, None
    c = df_h1["close"].to_numpy(dtype=float)
    ema = pd.Series(c).ewm(span=periodo, adjust=False).mean().to_numpy()
    k = 2 / (periodo + 1)
    _ = k  # (la v1 siembra con SMA; la diferencia es menor que 1 vela de calentamiento)
    estados = np.empty(len(c), dtype=object)
    for i in range(len(c)):
        if i < periodo + velas_pendiente:
            estados[i] = "lateral"
            continue
        ema_ult = ema[i]
        ema_antes = ema[i - velas_pendiente]
        if c[i] > ema_ult and ema_ult > ema_antes:
            estados[i] = "alza"
        elif c[i] < ema_ult and ema_ult < ema_antes:
            estados[i] = "baja"
        else:
            estados[i] = "lateral"
    return df_h1.index, estados


def sesgo_en(t_h1, estados, t_senal, tf_senal: str):
    """Sesgo vigente para una señal: la ÚLTIMA vela H1 cerrada antes del cierre
    de la vela de la señal (t_senal es la APERTURA de esa vela)."""
    if t_h1 is None:
        return "desconocido"
    cierre_senal = pd.Timestamp(t_senal) + pd.Timedelta(seconds=TF_SEGUNDOS.get(tf_senal, 300))
    idx = t_h1.searchsorted(cierre_senal, side="right") - 1
    if idx < 0:
        return "desconocido"
    return estados[idx]


# ══════════════════════════════════════════════════════════════════════════
# Enriquecido + score + filtros
# ══════════════════════════════════════════════════════════════════════════

COLS_EXTRA = ["zona_id", "zona_tipo", "zona_fuerza", "dist_zona_atr", "confluencia", "confluencia_favor",
              "fase_zona", "sesgo_h1", "sesgo_ok", "gatillo_ok", "score"]


def enriquecer(senales: pd.DataFrame, dfs: dict[str, pd.DataFrame],
               params: HibridaParams | None = None) -> tuple[pd.DataFrame, dict]:
    """Añade las columnas de contexto y el score a las señales del núcleo v2.
    NO altera ninguna columna v2. Devuelve (df, capas_activas)."""
    p = params or HibridaParams()
    df = senales.copy()
    capas = {"zonas": False, "fases": False, "sesgo": False}

    for col in COLS_EXTRA:
        df[col] = None
    df["confluencia"] = False
    df["confluencia_favor"] = False
    df["sesgo_ok"] = True
    df["gatillo_ok"] = None
    df["score"] = np.nan

    if df.empty:
        return df, capas

    df_m15 = dfs.get("M15")
    df_m5 = dfs.get("M5")
    df_h1 = dfs.get("H1")
    zonas, atr_m15 = (None,), (None,)
    if df_m15 is not None and len(df_m15):
        zonas, atr_m15 = detectar_zonas(df_m15, p.zonas)
        capas["zonas"] = True
    t_h1, est_h1 = (None, None)
    if df_h1 is not None and len(df_h1):
        t_h1, est_h1 = sesgo_h1_serie(df_h1, p.v2.ema_fast, 3)
        capas["sesgo"] = True

    cache_fases: dict[int, list] = {}
    m15_t = df_m15.index if df_m15 is not None else None

    for i, row in df.iterrows():
        t_sig = pd.Timestamp(row["time"])
        tf_sig = row["timeframe"]
        cierre_sig = t_sig + pd.Timedelta(seconds=TF_SEGUNDOS.get(tf_sig, 300))
        dir_sig = row["direction"]

        # precio de referencia para el contexto: la entrada de la señal; en los
        # AVISOS (2/3, entry=NaN por diseño del núcleo) el cierre de su vela
        tfdf_sig = dfs.get(tf_sig)
        precio_ref = float(row["entry"]) if np.isfinite(row["entry"]) else None
        if precio_ref is None and tfdf_sig is not None and 0 <= int(row["bar_index"]) < len(tfdf_sig):
            precio_ref = float(tfdf_sig.iloc[int(row["bar_index"])]["close"])

        # ---- CAPA E: sesgo H1 tolerante ---------------------------------
        sesgo = sesgo_en(t_h1, est_h1, t_sig, tf_sig)
        df.at[i, "sesgo_h1"] = sesgo
        if sesgo in ("alza", "baja"):
            df.at[i, "sesgo_ok"] = (sesgo == "alza") == (dir_sig == "BUY")
        else:  # lateral o desconocido: la v1 deja pasar
            df.at[i, "sesgo_ok"] = True

        # ---- CAPA F: gatillo direccional (vela de la señal) --------------
        tfdf = dfs.get(tf_sig)
        if tfdf is not None and 0 <= int(row["bar_index"]) < len(tfdf):
            v = tfdf.iloc[int(row["bar_index"])]
            df.at[i, "gatillo_ok"] = bool((v["close"] > v["open"]) if dir_sig == "BUY" else (v["close"] < v["open"]))

        # ---- CAPAS A/B/C/D: zonas, fuerza, confluencia, fase -------------
        if zonas is not None and m15_t is not None and len(m15_t):
            j = min(int(m15_t.searchsorted(cierre_sig, side="right")) - 1, len(m15_t) - 1)
            a15 = atr_m15[j] if 0 <= j < len(atr_m15) else np.nan
            activas = _zonas_activas_en(zonas, cierre_sig)
            if activas and np.isfinite(a15) and a15 > 0 and precio_ref is not None:
                mejor = min(activas, key=lambda z: abs(precio_ref - z["nivel"]))
                dist = abs(precio_ref - mejor["nivel"])
                df.at[i, "dist_zona_atr"] = dist / a15
                df.at[i, "zona_id"] = mejor["id"]
                df.at[i, "zona_tipo"] = mejor["tipo"]
                df.at[i, "zona_fuerza"] = mejor["fuerza"]
                if dist <= p.zonas.confluencia_atr * a15:
                    df.at[i, "confluencia"] = True
                    favor = ((mejor["tipo"] == "resistencia") == (dir_sig == "SELL"))
                    df.at[i, "confluencia_favor"] = bool(favor)
                    # CAPA D: fase de zona (solo si la vela de la señal toca la zona en M5)
                    if df_m5 is not None and len(df_m5) and mejor["id"] not in cache_fases:
                        cache_fases[mejor["id"]] = fases_de_zona(df_m5, mejor, a15, p.zonas)
                    cron = cache_fases.get(mejor["id"], [])
                    # última fase de toque dentro del intervalo de la vela de la señal
                    t0, t1 = t_sig, cierre_sig
                    candidatos = [f for (tt, f, _) in cron if t0 <= tt < t1]
                    if candidatos:
                        df.at[i, "fase_zona"] = candidatos[-1]
                        capas["fases"] = True

        # ---- CAPA G: score (ponderador, no portón) -----------------------
        s = float(p.score.peso_patron.get(row["pattern"], 10))
        fase = df.at[i, "fase_zona"]
        if fase:
            s += float(p.score.peso_fase.get(fase, 0))
        fuerza = df.at[i, "zona_fuerza"]
        if fuerza is not None:
            s += min(p.score.peso_fuerza_max, float(fuerza) * p.score.peso_fuerza_por_pivote)
        if df.at[i, "sesgo_ok"] and df.at[i, "sesgo_h1"] in ("alza", "baja"):
            s += p.score.peso_sesgo
        if df.at[i, "gatillo_ok"]:
            s += p.score.peso_gatillo
        if df.at[i, "confluencia_favor"]:
            s += p.score.peso_confluencia
        df.at[i, "score"] = min(100.0, s)

    return df, capas


def filtrar(df: pd.DataFrame, params: HibridaParams | None = None) -> pd.DataFrame:
    """Aplica SOLO los interruptores encendidos (default: ninguno → df intacto).
    Nunca crea ni modifica señales: solo quita filas."""
    p = params or HibridaParams()
    if df.empty:
        return df.reset_index(drop=True)
    mask = pd.Series(True, index=df.index)
    if p.filtrar_sesgo:
        mask &= df["sesgo_ok"].astype(bool)
    if p.filtrar_confluencia:
        mask &= df["confluencia_favor"].astype(bool)
    if p.filtrar_gatillo:
        mask &= df["gatillo_ok"].fillna(False).astype(bool)
    if p.score_min > 0:
        mask &= df["score"] >= p.score_min
    return df[mask].reset_index(drop=True)


def scan_hibrida(dfs: dict[str, pd.DataFrame], params: HibridaParams | None = None):
    """Pipeline completo: núcleo v2 (intacto) → enriquecer → (filtrar).
    Devuelve (df_final, df_enriquecido, capas_activas)."""
    p = params or HibridaParams()
    senales = _scan_todos(dfs, p.v2)
    enr, capas = enriquecer(senales, dfs, p)
    final = filtrar(enr, p)
    return final, enr, capas


def _scan_todos(dfs: dict[str, pd.DataFrame], p2: Params) -> pd.DataFrame:
    """Escanear todas las TF presentes con el núcleo v2 (sin tocarlo)."""
    partes = [scan(dfs[tf], tf, p2) for tf in ["M1", "M5", "M15", "M30", "H1", "H4"] if tf in dfs]
    if not partes:
        return pd.DataFrame()
    return pd.concat(partes, ignore_index=True)
