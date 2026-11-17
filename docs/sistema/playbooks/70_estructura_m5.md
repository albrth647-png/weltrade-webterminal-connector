---
id: estructura.m5
version: 1
estado: activo
fuente: [nucleo]
parametros:
  estructuraImpulsoMinATR: 0.8
  estructuraMinVelasImpulso: 2
  estructuraMaxVelasImpulso: 3
  estructuraCuerpoImpulso: 0.35
  estructuraVentanaEstructura: 20
  estructuraRetrocesoMinATR: 1.0
  estructuraRetrocesoMaxATR: 3.0
  estructuraCaducidad: 30
  estructuraEspera: 30
checks: [E01, E02, E03, E04]
casos: []
---

# Estructura (M5)

Estrategia paralela al catálogo de Yoel. No usa EMAs: la tendencia se verifica
por la estructura del precio (impulso y retroceso).

## Secuencia

1. **Impulso**: tramo de 2–3 velas que recorre ≥ 0.8 ATR, con cuerpo ≥ 35 % del
   movimiento y que hace un extremo nuevo de 20 velas.
2. **Origen**: extremo opuesto al impulso; el retroceso no lo supera.
3. **Retroceso**: 1.0–3.0 ATR, con vela de reversión.
4. **Toque**: pico del retroceso; cada toque debe superar al anterior.
5. **Quiebre**: cierre más allá de la punta del impulso.

## Códigos

| Código | Qué es | Tipo |
|---|---|---|
| `1E` | primer toque | aviso |
| `2E` `3E` | toques sucesivos | aviso |
| `2EB` `3EB` | quiebre del toque n | entrada |
| `nEBR` | quiebre tras reset | entrada |

Caducidad de 30 velas y enfriamiento de 30 tras una entrada del mismo lado.

## Checks

- **E01** — El impulso cumple recorrido, cuerpo y extremo nuevo de la ventana.
- **E02** — El retroceso está entre 1.0 y 3.0 ATR y no supera el origen.
- **E03** — Cada toque supera al anterior y respeta la separación mínima.
- **E04** — El quiebre es un cierre más allá de la punta del impulso, dentro de la
  caducidad.
