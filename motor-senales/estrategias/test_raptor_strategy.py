# -*- coding: utf-8 -*-
"""
Prueba funcional de raptor_strategy.py (subido por el usuario) con escenarios
sintéticos controlados, para auditar su comportamiento real contra los vídeos
de Yoel. No modifica el archivo original (se importa desde upload/).
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
    print("PRUEBA FUNCIONAL DE raptor_strategy.py — escenarios sintéticos controlados")
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

    print("\n" + "=" * 78)
    if FALLOS:
        print(f"RESULTADO: {len(FALLOS)} comprobaciones FALLARON:")
        for f in FALLOS:
            print("  -", f)
        sys.exit(1)
    print("RESULTADO: todas las comprobaciones pasaron.")


if __name__ == "__main__":
    main()
