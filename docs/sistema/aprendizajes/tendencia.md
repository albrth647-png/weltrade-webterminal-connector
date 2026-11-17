---
tema: tendencia
version: 1
estado: borrador
casos: [c-2026-10-28-0001, c-2026-11-02-0001, c-2026-11-04-0001, c-2026-11-05-0001, c-2026-11-08-0001, c-2026-11-11-0001, c-2026-11-12-0001, c-2026-11-12-0002]
reglas: []
ultima_revision: 2026-11-12
---

# Tendencia (escáner)

Contexto que el sistema necesita **mientras el propietario marca**. No genera
avisos ni entradas.

## Qué estoy aprendiendo

Nota en **borrador** generada a partir de 8 casos aprobados (FX Vol 20 y FX Vol 40, M5).
Pendiente de aprobación/corrección/rechazo del propietario.

**Patrón observado — cambio de tendencia bajista (FX Vol 20, sesión asia):**
- `c-2026-11-11-0001`: raya larga bajista (184 barras, pendAtr -0.078), p1 113271 → p2 111908. pilaEma alcista, estructura HH-HL, sesión asia, dow 3.
- Interpretación: la raya larga guía la tendencia bajista. (La raya corta horizontal que antes acompañaba este caso resultó ser un engaño y se movió a `enganos.md`.)

**Patrón observado — cambio de tendencia alcista (FX Vol 20, sesión europa):**
- `c-2026-11-12-0001`: raya larga alcista (436 barras, pendAtr +0.058), p1 112022 → p2 114731. pilaEma bajista, estructura LH-LL, sesión europa, dow 4.
- `c-2026-11-12-0002`: raya larga alcista (221 barras, pendAtr +0.083), p1 113287 → p2 115282. Misma sesión/estructura.
- Interpretación: la raya larga guía la tendencia alcista. (La raya corta horizontal que antes acompañaba este caso resultó ser un engaño y se movió a `enganos.md`.)

**Patrón observado — tendencias de largo plazo (FX Vol 40, M5):**
- `c-2026-11-02-0001`: bajista larga (4699 barras, pendAtr -0.016), p1 122108 → p2 114150. pilaEma bajista, estructura LH-LL, sesión europa, dow 1.
- `c-2026-11-04-0001`: bajista larga (5060 barras, pendAtr -0.011), p1 121718 → p2 115133. pilaEma bajista, estructura mixta, sesión asia, dow 3.
- `c-2026-11-08-0001`: bajista larga (6189 barras, pendAtr -0.010), pilaEma bajista, estructura LH-LL, sesión europa, dow 0.
- `c-2026-10-28-0001`: alcista (624 barras, pendAtr +0.039), pilaEma bajista, estructura HH-HL, sesión europa, dow 3.
- `c-2026-11-05-0001`: mixta (1130 barras, pendAtr +0.030), pilaEma mixta, estructura LH-LL, sesión asia, dow 4.
- Interpretación: en FX Vol 40 el propietario marca tendencias de semanas (miles de barras M5). La dirección de la raya puede coincidir o no con la pila EMA; la raya es la guía, no el indicador.

**Hechos medidos comunes:**
- Todas las rayas son válidas (`valida: true`, `velasCruzadas: 0`) — coherente con la metodología del propietario (cruzar velas intermedias es válido para tendencias).
- El anclaje es por cierre (`cuerpo: true`, `anclaje: cierre`).
- ADX varía (20–49); ATR% ~0.08–0.10 en FX Vol 20, datos sin ATR% explícito en FX Vol 40 (atrPct no reportado en esos casos).
- La raya puede ser de cientos o miles de barras; no hay límite de largo.
- Solo la **raya larga** guía la tendencia. La raya corta horizontal NO confirma el cambio: es un engaño (ver `enganos.md`).

## Reglas que ya sé

<!-- umbrales y excepciones aprobadas; viven en playbooks/10_escaner_tendencia.md -->
- (borrador) Raya larga guía la tendencia; es la única guía.
- (borrador) El toque se mide por el cuerpo (open/close), no por la mecha; magnet de cuerpo solo en líneas de tendencia.
- (borrador) Una raya que cruza velas intermedias es válida en la metodología del propietario.
- (borrador) La raya corta horizontal NO es una confirmación; es un engaño (ver `enganos.md`).
- (borrador) La marca del propietario prima sobre el escáner (el propietario es la fuente de verdad).

## Casos

- `c-2026-11-11-0001` — FX Vol 20 M5, cambio tendencia bajista, raya larga (184 barras), asia/dow3, HH-HL, pilaEma alcista.
- `c-2026-11-12-0001` — FX Vol 20 M5, cambio tendencia alcista, raya larga (436 barras), europa/dow4, LH-LL, pilaEma bajista.
- `c-2026-11-12-0002` — FX Vol 20 M5, cambio tendencia alcista, raya larga (221 barras), europa/dow4, LH-LL, pilaEma bajista.
- `c-2026-11-02-0001` — FX Vol 40 M5, tendencia bajista larga (4699 barras), europa/dow1, LH-LL, pilaEma bajista.
- `c-2026-11-04-0001` — FX Vol 40 M5, tendencia bajista larga (5060 barras), asia/dow3, mixta, pilaEma bajista.
- `c-2026-11-08-0001` — FX Vol 40 M5, tendencia bajista larga (6189 barras), europa/dow0, LH-LL, pilaEma bajista.
- `c-2026-10-28-0001` — FX Vol 40 M5, tendencia alcista (624 barras), europa/dow3, HH-HL, pilaEma bajista.
- `c-2026-11-05-0001` — FX Vol 40 M5, tendencia mixta (1130 barras), asia/dow4, LH-LL, pilaEma mixta.

## Dudas abiertas

- ¿En qué situaciones el escáner dice «rango» y el propietario sigue marcando tendencia? (requiere registrar estado del escáner en el caso)
- ¿Cuántos cambios de estado por día tolera el propietario sin que le estorbe? (propuesta: 2/día)
- ¿La sesión (asia vs europa) y el dow son relevantes para el patrón, o coincidencia del conjunto? (dato insuficiente: ≥20 casos por combinación)
- ¿En FX Vol 40 la dirección de la raya coincide con la pila EMA o es independiente? (5 de 5 casos con pilaEma bajista, 4 bajistas + 1 alcista → parece independiente)