---
tema: enganos
version: 1
estado: borrador
casos: [c-2026-11-11-0002, c-2026-11-12-0003]
reglas: []
ultima_revision: 2026-11-12
---

# Engaños (trampas del mercado)

Contexto que el sistema necesita para **no confundir un engaño con un cambio real de tendencia**.
No genera avisos ni entradas. El propietario es la fuente de verdad.

## Qué estoy aprendiendo

Nota en **borrador** generada a partir de 2 casos aprobados (FX Vol 20, M5).
Pendiente de aprobación/corrección/rechazo del propietario.

**Qué es un engaño:**
Cuando el sistema marca rayas de tendencia y el precio **supera el máximo anterior** (en tendencia alcista)
o **rompe el mínimo anterior** (en tendencia bajista) y luego **cae/vuelve** continuando la tendencia anterior,
eso es un **engaño** del mercado, no un cambio real de tendencia.
- La raya corta horizontal que se supera y luego el precio vuelve = engaño.
- La raya larga sigue siendo la guía; el engaño no la invalida.

**Patrón observado — engaño bajista (FX Vol 20, sesión asia, dow 3):**
- `c-2026-11-11-0002`: raya corta casi horizontal (74 barras, pendAtr -0.001), p1 112248 → p2 112241. pilaEma alcista, estructura HH-HL, sesión asia, dow 3. Acompañaba a la raya larga bajista `c-2026-11-11-0001`. El precio supera el máximo anterior y vuelve → engaño; la tendencia bajista sigue vigente.

**Patrón observado — engaño alcista (FX Vol 20, sesión europa, dow 4):**
- `c-2026-11-12-0003`: raya corta casi horizontal (59 barras, pendAtr -0.0015), p1 115231 → p2 115221. pilaEma mixta, estructura LH-LL, sesión europa, dow 4. Acompañaba a las rayas largas alcistas `c-2026-11-12-0001/0002`. El precio supera el máximo anterior y vuelve → engaño; la tendencia alcista sigue vigente.

**Hechos medidos comunes:**
- Ambos engaños son válidos (`valida: true`, `velasCruzadas: 0`).
- El anclaje es por cierre (`cuerpo: true`, `anclaje: cierre`).
- Duración corta (59–74 barras M5) vs. la raya larga (184–436 barras).
- Los dos casos documentados son engaños **bajistas** en el sentido de que el precio finge ruptura alcista y vuelve. La misma lógica aplica en sentido inverso para **alcista** (el precio finge ruptura bajista y vuelve). El motor debe tratar ambos sentidos de forma simétrica.

## Reglas que ya sé

<!-- umbrales y excepciones aprobadas; viven en playbooks/10_escaner_tendencia.md -->
- (borrador) Un engaño NO cambia la tendencia vigente.
- (borrador) La raya larga guía; el engaño solo genera ruido que el sistema debe ignorar.
- (borrador) La raya corta horizontal NO confirma el cambio; es un engaño (trampa).
- (borrador) Los engaños documentados son bajistas, pero la regla es simétrica: igual para alcista.
- (borrador) El motor debe adaptarse al mercado actual: nunca improvisar ni inventar lo que el mercado no ha hecho.

## Casos

- `c-2026-11-11-0002` — FX Vol 20 M5, engaño bajista, raya corta horizontal (74 barras), asia/dow3, HH-HL, pilaEma alcista.
- `c-2026-11-12-0003` — FX Vol 20 M5, engaño alcista, raya corta horizontal (59 barras), europa/dow4, LH-LL, pilaEma mixta.

## Dudas abiertas

- ¿Cuántas barras debe durar un engaño para considerarse confirmado como tal?
- ¿El engaño siempre va seguido de continuación de la tendencia anterior, o a veces sí cambia?
- ¿Cómo distinguir un engaño de un cambio real cuando ambos superan el máximo anterior?
- ¿Los engaños solo aparecen como rayas cortas horizontales, o también como rayas largas?