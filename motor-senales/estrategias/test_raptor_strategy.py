# -*- coding: utf-8 -*-
"""
Pruebas funcionales de raptor_strategy.py (v2) con escenarios sintéticos
controlados. Verifican el comportamiento REAL del código contra las reglas
de los vídeos de Yoel y contra las correcciones de la auditoría
(docs/estrategia/auditoria_raptor_strategy.md §4).

Escenarios:
  A  secuencia completa 2 -> 2B -> 1R -> 2R -> 2RB          (original)
  B  tercer toque 2 -> 3 -> 3B                              (original)
  C  caducidad de la quiebra (>6 velas)                     (original)
  D  superación de EMA50 -> engaño                          (original)
  E  simetría espejo alcista/bajista                        (original)
  F  robustez (plana, corta, scan_last)                     (original)
  G  gating por TF (M1/M5/M15 + emit_touches_from)          (corrección 1)
  H  filtro de distancia «muy alejada, no lo tomo»          (corrección 3)
  I  reset por salida huérfana («se salió, volvió»)         (corrección 4)
  J  cuerpo de la quiebra solo exigible a la 1              (corrección 6)
  K  etiqueta 1RB del engaño reseteado                      (corrección 2)
  L  el engaño no se re-dispara sin nueva salida            (hallazgo 2)
  M  capa multi-TF «tendencia comprobada»                   (corrección 8)
  N  gramática del catálogo + TIMEFRAMES + scan_all         (corrección 1)
"""
import sys
import numpy as np
import pandas as pd

sys.path.insert(0, __file__.rsplit("/", 1)[0])  # importa la copia del repo
import raptor_strategy as rs  # noqa: E402

FALLOS = []


def check(nombre, cond, detalle=""):
    estado = "OK " if cond else "FALLA"
    print(f"  [{estado}] {nombre}" + (f" -> {detalle}" if detalle else ""))
    if not cond:
        FALLOS.append(f"{nombre}: {detalle}")


class B:
    """Constructor de velas vela-a-vela con lectura de EMAs/ATR en vivo."""

    def __init__(self):
        self.o, self.h, self.l, self.c = [], [], [], []

    def e30(self):
        return rs._ema(np.array(self.c), 30)[-1]

    def e50(self):
        return rs._ema(np.array(self.c), 50)[-1]

    def e100(self):
        return rs._ema(np.array(self.c), 100)[-1]

    def atr(self):
        return rs._atr(np.array(self.h), np.array(self.l), np.array(self.c), 14)[-1]

    def add(self, op, hi, lo, cl):
        assert hi >= max(op, cl) - 1e-9, f"high<max(oc) hi={hi} op={op} cl={cl}"
        assert lo <= min(op, cl) + 1e-9, f"low>min(oc) lo={lo} op={op} cl={cl}"
        self.o.append(op); self.h.append(hi); self.l.append(lo); self.c.append(cl)

    def fase_bajista(self, n=170, step=0.45):
        """Tendencia bajista limpia y sostenida: EMA30<EMA50<EMA100 y pendiente bajista."""
        price = 100.0
        for _ in range(n):
            op = price
            cl = op - step
            self.add(op, op + 0.10, cl - 0.10, cl)
            price = cl
        e30, e50, e100 = self.e30(), self.e50(), self.e100()
        assert e30 < e50 < e100, f"fase bajista mal alineada: {e30}, {e50}, {e100}"

    # ---- velas compuestas (recetas en múltiplos de ATR vivo) ----
    def vela_toque(self):
        """Roja/verde de rechazo: high roza EMA30 (+0.05 ATR), cierra 0.20 ATR bajo EMA30."""
        e30, atr = self.e30(), self.atr()
        op = min(self.c[-1], e30 - 0.30 * atr)
        cl = e30 - 0.20 * atr
        hi = e30 + 0.05 * atr
        lo = min(op, cl) - 0.10 * atr
        self.add(op, hi, lo, cl)

    def vela_toque_alejada(self):
        """Rechazo ENORME: roza la EMA30 con el high pero cierra a 3.5 ATR
        («muy alejada, no lo tomo», v2) — debe ser rechazada con max_dist_atr=2."""
        e30, atr = self.e30(), self.atr()
        op = min(self.c[-1], e30 - 0.30 * atr)
        cl = e30 - 3.5 * atr
        hi = e30 + 0.05 * atr
        lo = cl - 0.10 * atr
        self.add(op, hi, lo, cl)

    def vela_bajista_suave(self, step_mult=0.4):
        """Roja suave: el cierre baja step_mult ATR pero la mecha inferior (0.6 ATR)
        deja el cierre POR ENCIMA del mínimo previo (no dispara engaño)."""
        atr = self.atr()
        op = self.c[-1]
        cl = op - step_mult * atr
        self.add(op, op + 0.05 * atr, cl - 0.6 * atr, cl)

    def vela_rally(self, objetivo="subir", step_mult=1.1):
        """Vela verde de impulso; su high queda a >0.10 ATR de la EMA30 si aún no la toca."""
        e30, atr = self.e30(), self.atr()
        op = self.c[-1]
        cl = op + step_mult * atr
        if cl < e30:                       # aún por debajo de la EMA30
            cl = min(cl, e30 - 0.20 * atr)
        hi = cl + 0.05 * atr
        lo = op - 0.05 * atr
        self.add(op, hi, lo, cl)

    def vela_caida(self, step_mult=1.2):
        """Vela roja de extensión (hace el mínimo nuevo)."""
        atr = self.atr()
        op = self.c[-1]
        cl = op - step_mult * atr
        self.add(op, op + 0.05 * atr, cl - 0.15 * atr, cl)

    def vela_quiebre(self, ref_low):
        """Gran vela roja con cuerpo que cierra por debajo de ref_low."""
        atr = self.atr()
        op = self.c[-1]
        cl = ref_low - 0.40 * atr
        hi = op + 0.05 * atr
        lo = cl - 0.10 * atr
        self.add(op, hi, lo, cl)

    def vela_engano(self, ref):
        """Gran vela ROJA del engaño: abre arriba (sobre EMA50) y cierra bajo ref."""
        atr = self.atr()
        op = self.c[-1]
        cl = ref - 0.60 * atr
        self.add(op, op + 0.05 * atr, cl - 0.10 * atr, cl)

    def acercar(self):
        """Sube el precio con velas verdes hasta quedar a <=0.6 ATR de la EMA30
        sin tocarla (highs siempre >0.10 ATR por debajo)."""
        for _ in range(12):
            if self.c[-1] >= self.e30() - 0.6 * self.atr():
                return
            self.vela_rally(step_mult=1.0)
        raise RuntimeError("acercar: no convergió")

    def vela_doji_cae(self, step_mult=0.8):
        """Vela de mínimo nuevo SIN cuerpo válido (cuerpo 0.15 ATR < 0.3 ATR)."""
        atr = self.atr()
        op = self.c[-1]
        cl = op - 0.15 * atr
        lo = cl - 1.0 * atr
        self.add(op, op + 0.05 * atr, lo, cl)   # cuerpo pequeño, mecha inferior larga

    def vela_plana(self):
        """Vela tranquila lejos de la EMA30 y por encima del mínimo de referencia."""
        e30, atr = self.e30(), self.atr()
        op = self.c[-1]
        cl = op - 0.05 * atr
        hi = min(op, cl) + 0.05 * atr
        self.add(op, max(hi, e30 - 0.60 * atr), min(op, cl) - 0.05 * atr, cl)

    def df(self):
        idx = pd.date_range("2026-01-01", periods=len(self.c), freq="1min")
        return pd.DataFrame(
            {"open": self.o, "high": self.h, "low": self.l, "close": self.c}, index=idx)

    def ref_low_8(self):
        """Réplica del ref_low del código: mínimo de las 8 velas previas a la actual."""
        return float(np.min(self.l[-8:]))


def subir_hasta_exceder_e50(b):
    """Rally verde hasta que una vela supere EMA50+tol (define el 'engaño')."""
    for _ in range(12):
        b.vela_rally()
        e50, atr = b.e50(), b.atr()
        if b.h[-1] > e50 + 0.10 * atr:
            return True
    return False


def secuencia_2_touches(b, caida_mult=1.2):
    """acercar -> toque1 (silencioso) -> extensión -> toque2 (emite '2')."""
    b.acercar()
    b.vela_toque()                       # toque 1
    b.vela_caida(caida_mult); b.vela_caida(caida_mult)  # 'supera': mínimo nuevo
    for _ in range(3):
        b.vela_rally(step_mult=1.0)      # vuelve a la EMA30
    b.vela_toque()                       # toque 2 -> evento "2"
    return b.ref_low_8()


def secuencia_3er_touch(b, ref2):
    """dojis sin cuerpo -> mínimo nuevo -> 3er toque (emite '3', reemplaza el pend)."""
    b.vela_doji_cae(); b.vela_doji_cae()
    for _ in range(2):
        b.vela_rally(step_mult=1.2)
    b.vela_toque()                       # toque 3 -> evento "3"


def escenario_A():
    """2 -> 2B -> 1R -> 2R -> 2RB (la secuencia completa con reset)."""
    b = B(); b.fase_bajista()
    ref2 = secuencia_2_touches(b)
    b.vela_quiebre(ref2)                 # -> 2B
    assert subir_hasta_exceder_e50(b), "no superó EMA50 (engaño imposible)"
    e30, atr = b.e30(), b.atr()
    ref = float(np.min(b.l[-6:]))        # réplica aproximada de la ventana del fake
    b.vela_engano(ref)
    # -> 1R ; secuencia reseteada con caidas suaves (0.8 ATR) para NO romper el
    #    mínimo del propio engaño (eso dispararía un segundo '1R', ver auditoría)
    ref2b = secuencia_2_touches(b, caida_mult=0.8)   # toque1R silencioso, toque2R emite "2R"
    b.vela_quiebre(min(b.l[-12:]))       # -> 2RB
    return b.df()


def escenario_B():
    """2 -> 3 -> 3B (el 2B se reemplaza por el 3er toque)."""
    b = B(); b.fase_bajista()
    ref2 = secuencia_2_touches(b)        # emite "2", pend n=2
    secuencia_3er_touch(b, ref2)         # emite "3", pend n=3
    b.vela_quiebre(min(b.l[-12:]))       # -> 3B
    return b.df()


def escenario_C():
    """Timeout: toque 2 y la quiebra llega tarde (>6 velas) => no hay B."""
    b = B(); b.fase_bajista()
    ref2 = secuencia_2_touches(b)        # "2"
    for _ in range(7):
        b.vela_plana()                   # el pend caduca (>6 velas)
    b.vela_quiebre(ref2)                 # ya no hay pend => sin señal
    return b.df()


def escenario_D():
    """Exceeds50: tras el toque 2 el precio supera la EMA50 => pend cancelado;
    si luego quiebra, eso ES la estrategia 1 (engaño)."""
    b = B(); b.fase_bajista()
    ref2 = secuencia_2_touches(b)        # "2"
    assert subir_hasta_exceder_e50(b), "no superó EMA50"
    atr = b.atr()
    ref = float(np.min(b.l[-6:]))
    b.vela_engano(ref)                   # -> "1"
    return b.df()


def resumen(sig):
    return [(int(r.bar_index), r.direction, r.kind, r.pattern) for r in sig.itertuples()]


def main():
    print("=" * 78)
    print("PRUEBA FUNCIONAL DE raptor_strategy.py v2 — escenarios sintéticos controlados")
    print("=" * 78)

    print("\n[A] Secuencia completa bajista: 2 -> 2B -> 1R -> 2R -> 2RB")
    sigA = rs.scan(escenario_A(), "M15")
    a = resumen(sigA)
    print("   señales:", [(p, k, d) for _, d, k, p in a])
    pats = [p for _, _, _, p in a]
    check("emite exactamente 2, 2B, 1R, 2R, 2RB en orden",
          pats == ["2", "2B", "1R", "2R", "2RB"], str(pats))
    check("todas SELL (no hay señales BUY espurias en tendencia bajista)",
          all(d == "SELL" for _, d, _, _ in a))
    check("los '2' son kind=touch y las B/1 kind=entry",
          all((k == "touch") if p in ("2", "2R", "3", "3R") else (k == "entry")
              for _, _, k, p in a))

    print("\n[B] Tercer toque: 2 -> 3 -> 3B (el 2 pendiente se reemplaza)")
    sigB = rs.scan(escenario_B(), "M15")
    patsB = [p for _, _, _, p in resumen(sigB)]
    print("   señales:", patsB)
    check("emite exactamente 2, 3, 3B", patsB == ["2", "3", "3B"], str(patsB))

    print("\n[C] Timeout del quiebre (>6 velas): el 2B caduca")
    sigC = rs.scan(escenario_C(), "M15")
    patsC = [p for _, _, _, p in resumen(sigC)]
    print("   señales:", patsC)
    check("solo emite el aviso '2' (la quiebra tardía NO dispara)",
          patsC == ["2"], str(patsC))

    print("\n[D] Superación de EMA50 tras el toque 2: el 2B se cancela y el")
    print("    quiebre posterior se reconvierte en estrategia 1 (engaño)")
    sigD = rs.scan(escenario_D(), "M15")
    patsD = [p for _, _, _, p in resumen(sigD)]
    print("   señales:", patsD)
    check("emite '2' y luego '1'", patsD == ["2", "1"], str(patsD))

    print("\n[E] Simetría espejo: la misma serie invertida debe dar BUY idénticos")
    dfA = escenario_A()
    mir = pd.DataFrame({"open": -dfA.open, "high": -dfA.low,
                        "low": -dfA.high, "close": -dfA.close}, index=dfA.index)
    sigM = rs.scan(mir, "M15")
    m = resumen(sigM)
    print("   señales:", [(p, k, d) for _, d, k, p in m])
    check("mismos bar_index y patrones que [A], dirección BUY",
          [(i, "BUY", k, p) for (i, _, k, p) in a] ==
          [(i, d, k, p) for (i, d, k, p) in m], "espejo no idéntico")
    eA = sigA.set_index("bar_index").entry
    eM = sigM.set_index("bar_index").entry
    check("precios espejo exactos (entry_BUY = -entry_SELL)",
          np.allclose(eM.reindex(eA.index).to_numpy(), -eA.to_numpy(), equal_nan=True))

    print("\n[F] Robustez: serie plana, serie corta y scan_last")
    flat = pd.DataFrame({"open": np.full(300, 10.0), "high": np.full(300, 10.01),
                         "low": np.full(300, 9.99), "close": np.full(300, 10.0)},
                        index=pd.date_range("2026-01-01", periods=300, freq="1min"))
    check("serie plana sin señales y sin crash", len(rs.scan(flat, "M5")) == 0)
    check("serie corta (<warmup) sin señales y sin crash",
          len(rs.scan(flat.iloc[:50], "M5")) == 0)
    dfA2 = escenario_A()
    todo = rs.scan(dfA2, "M15")
    ult = rs.scan_last(dfA2, "M15")
    ult_todo = todo[todo.bar_index == len(dfA2) - 1]
    check("scan_last devuelve solo señales de la última vela cerrada",
          len(ult) == len(ult_todo) and len(ult) > 0 and
          list(ult.pattern) == list(ult_todo.pattern),
          f"scan_last={list(ult.pattern)} vs scan={list(ult_todo.pattern)}")

    # ----------------------- escenarios nuevos (v2) -----------------------

    print("\n[G] Gating por TF: «la 2 y la 3… de M15 por arriba» (v2); entradas")
    print("    en todas las TF (v3 las demuestra en M1; v2: «buscamos una entrada»)")
    sig_m1 = rs.scan(dfA, "M1")
    sig_m5 = rs.scan(dfA, "M5")
    sig_m15 = rs.scan(dfA, "M15")
    pats_m1, pats_m5, pats_m15 = (list(s.pattern) for s in (sig_m1, sig_m5, sig_m15))
    print("   M1 :", pats_m1, "| M5:", pats_m5, "| M15:", pats_m15)
    check("en M1 solo ENTRADAS (2B, 1R, 2RB), sin avisos",
          pats_m1 == ["2B", "1R", "2RB"], str(pats_m1))
    check("en M5 igual que M1 (M15 es el umbral)", pats_m5 == pats_m1, str(pats_m5))
    check("en M15 el catálogo completo (avisos + entradas)",
          pats_m15 == ["2", "2B", "1R", "2R", "2RB"], str(pats_m15))
    sig_m1b = rs.scan(dfA, "M1", rs.Params(emit_touches_from="M1"))
    check("emit_touches_from='M1' libera los avisos en M1",
          list(sig_m1b.pattern) == pats_m15, str(list(sig_m1b.pattern)))
    try:
        rs.scan(dfA, "W1")
        check("TF desconocido lanza ValueError", False, "no lanzó")
    except ValueError:
        check("TF desconocido lanza ValueError", True)

    print("\n[H] Filtro de distancia: «está muy alejada, no lo tomo» (v2)")
    bh = B(); bh.fase_bajista()
    bh.acercar()
    bh.vela_toque()                      # toque 1 normal
    bh.vela_caida(); bh.vela_caida()
    for _ in range(3):
        bh.vela_rally(step_mult=1.0)
    bh.vela_toque_alejada()              # tocaría como toque 2 pero cierra a 3.5 ATR
    rech = rs.scan(bh.df(), "M15", rs.Params())            # max_dist_atr=2.0
    check("con max_dist_atr=2.0 el toque alejado se RECHAZA (sin '2')",
          list(rech.pattern) == [], str(list(rech.pattern)))
    acept = rs.scan(bh.df(), "M15", rs.Params(max_dist_atr=None))
    check("con el filtro desactivado el mismo toque SÍ cuenta ('2')",
          list(acept.pattern) == ["2"], str(list(acept.pattern)))

    print("\n[I] Reset por salida huérfana: «se salió, volvió, lo hizo de nuevo»")
    print("    (salida sobre EMA50 SIN engaño + retorno = ciclo cumplido -> R)")
    bi = B(); bi.fase_bajista()
    bi.acercar()
    bi.vela_toque()                      # toque 1 (silencioso)
    assert subir_hasta_exceder_e50(bi), "no superó EMA50"     # salida (sin engaño)
    guard = 0
    while bi.c[-1] > bi.e30() - 0.4 * bi.atr():               # regreso suave; la vela
        bi.vela_bajista_suave()                           # que cruza la zona = toque 1'
        guard += 1
        assert guard < 60, "regreso infinito"
    bi.vela_bajista_suave(); bi.vela_bajista_suave()          # extensión bajo el toque 1'
    for _ in range(3):
        bi.vela_rally(step_mult=1.0)                          # vuelve a la EMA30
    bi.vela_toque()                       # toque 2 del nuevo ciclo -> "2R"
    con_reset = rs.scan(bi.df(), "M15", rs.Params())
    sin_reset = rs.scan(bi.df(), "M15", rs.Params(reset_on_abandoned_exit=False))
    print("   con reset:", list(con_reset.pattern),
          "| sin reset:", list(sin_reset.pattern))
    check("la secuencia tras la salida huérfana sale con R ('2R')",
          list(con_reset.pattern) == ["2R"], str(list(con_reset.pattern)))
    check("con reset_on_abandoned_exit=False sale '2' (comportamiento v1)",
          list(sin_reset.pattern) == ["2"], str(list(sin_reset.pattern)))

    print("\n[J] Cuerpo de la quiebra: «con cuerpo» confirmado SOLO para la 1;")
    print("    2B/3B = «quebró» (sin exigencia de cuerpo) — corrección 6")
    def build_j():
        bj = B(); bj.fase_bajista()
        secuencia_2_touches(bj)          # "2" con pend
        ref = bj.ref_low_8()
        atr0 = bj.atr()
        guard = 0
        while bj.c[-1] > ref - 0.10 * atr0 and guard < 25:    # caidas SIN cuerpo válido
            bj.vela_caida(step_mult=0.25)                      # cuerpo 0.25 ATR < 0.3
            guard += 1
        assert bj.c[-1] < ref, "la caida fina no cruzó el ref_low"
        return bj.df()
    sin_cuerpo = rs.scan(build_j(), "M15", rs.Params(max_bars_to_break=25))
    con_cuerpo = rs.scan(build_j(), "M15",
                         rs.Params(max_bars_to_break=25, require_body_on_break=True))
    print("   defecto:", list(sin_cuerpo.pattern),
          "| exigiendo cuerpo:", list(con_cuerpo.pattern))
    check("por defecto la quiebra sin cuerpo SÍ emite 2B («quebró»)",
          list(sin_cuerpo.pattern) == ["2", "2B"], str(list(sin_cuerpo.pattern)))
    check("con require_body_on_break=True la misma quiebra NO emite",
          list(con_cuerpo.pattern) == ["2"], str(list(con_cuerpo.pattern)))

    print("\n[K] Etiqueta del engaño reseteado: 1R (defecto) vs 1RB (gráfico v3)")
    pats_k = list(rs.scan(dfA, "M15", rs.Params(fake_reset_label="1RB")).pattern)
    print("   con fake_reset_label='1RB':", pats_k)
    check("el engaño reseteado se etiqueta 1RB y el resto no cambia",
          pats_k == ["2", "2B", "1RB", "2R", "2RB"], str(pats_k))

    print("\n[L] El engaño NO se re-dispara sin una nueva salida sobre la EMA50")
    bl = B(); bl.fase_bajista()
    secuencia_2_touches(bl)              # "2"
    assert subir_hasta_exceder_e50(bl), "no superó EMA50"
    ref = float(np.min(bl.l[-6:]))
    bl.vela_engano(ref)                  # -> "1"
    for _ in range(3):
        bl.vela_caida()                  # más quiebras con cuerpo, SIN nueva salida
    sig_l = rs.scan(bl.df(), "M15")
    pats_l = list(sig_l.pattern)
    print("   señales:", pats_l)
    check("solo '2' y '1' (el segundo quiebre no re-dispara el engaño)",
          pats_l == ["2", "1"], str(pats_l))

    print("\n[M] Capa multi-TF «tendencia comprobada» (corrección 8)")
    dfAlcista = pd.DataFrame({"open": -dfA.open, "high": -dfA.low,
                              "low": -dfA.high, "close": -dfA.close}, index=dfA.index)
    dfs = {"M15": dfA, "H1": dfA, "H4": dfA}          # todo bajista alineado
    trends = rs.multi_tf_trend(dfs)
    print("   tendencias:", trends)
    check("multi_tf_trend detecta SELL alineado en las 3 TF",
          all(v == "SELL" for v in trends.values()), str(trends))
    kept = rs.filter_trend_confirmed(rs.scan(dfA, "M15"), dfs)
    check("con H1+H4 vendedoras pasan todas las señales SELL",
          len(kept) == len(rs.scan(dfA, "M15")) and all(kept.direction == "SELL"))
    kept_buy = rs.filter_trend_confirmed(rs.scan(dfAlcista, "M15"), dfs)
    check("las señales BUY quedan fuera (tendencia comprobada = SELL)",
          len(kept_buy) == 0)
    dfs_mix = {"M15": dfA, "H1": dfA, "H4": dfAlcista}  # en desacuerdo
    check("TFs en desacuerdo -> sin confirmación (0 señales)",
          len(rs.filter_trend_confirmed(rs.scan(dfA, "M15"), dfs_mix)) == 0)
    flatdf = pd.DataFrame({"open": np.full(300, 10.0), "high": np.full(300, 10.01),
                           "low": np.full(300, 9.99), "close": np.full(300, 10.0)},
                          index=pd.date_range("2026-01-01", periods=300, freq="1min"))
    check("sin alineación multi-TF el filtro es inerte (pasa todo)",
          len(rs.filter_trend_confirmed(rs.scan(dfA, "M15"),
                                        {"H1": flatdf, "H4": flatdf})) ==
          len(rs.scan(dfA, "M15")))

    print("\n[N] Gramática del catálogo + TIMEFRAMES + scan_all con M1")
    todo = rs.scan_all({"M1": dfA, "M15": dfA})
    check("TIMEFRAMES empieza por M1 (el TF estrella de Yoel)",
          rs.TIMEFRAMES[0] == "M1", str(rs.TIMEFRAMES))
    check("scan_all acepta M1 y etiqueta el TF",
          set(todo.timeframe) == {"M1", "M15"} and len(todo) > 0)
    pats_all = set(todo.pattern)
    check("todo patrón pertenece al catálogo de los vídeos",
          pats_all <= rs.TOUCH_PATTERNS | rs.ENTRY_PATTERNS, str(pats_all))
    check("kind coherente con el patrón (touch vs entry)",
          all((r.kind == "touch") == (r.pattern in rs.TOUCH_PATTERNS)
              for r in todo.itertuples()))
    check("la dirección del patrón 1/1R/1RB y las B es siempre entry",
          all(r.kind == "entry" for r in todo.itertuples()
              if r.pattern in ("1", "1R", "1RB", "2B", "2RB", "3B", "3RB")))

    print("\n" + "=" * 78)
    if FALLOS:
        print(f"RESULTADO: {len(FALLOS)} comprobaciones FALLARON:")
        for f in FALLOS:
            print("  -", f)
        sys.exit(1)
    print("RESULTADO: todas las comprobaciones pasaron.")


if __name__ == "__main__":
    main()
