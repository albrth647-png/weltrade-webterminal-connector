---
id: escaner.tendencia
version: 1
estado: borrador
fuente: [escaner]
parametros:
  atrPeriodo: 14
  ventanaFuerza: 20
  ventanaEstado: 60
  maxVelas: 240
  erEntrada: 0.35
  erSalida: 0.22
  r2Min: 0.55
  adxEntrada: 22
  adxSalida: 16
  confirmacionVelas: 2
  confirmacionDebil: 3
  cooldownVelas: 5
  pesoH1: 0.40
  pesoM15: 0.30
  pesoM5: 0.20
  pesoM1: 0.10
  gateAlineacion: 3
  gateScore: 0.55
  distEmaAtr: 2.5
  toleranciaClusterAtr: 0.35
  margenRotoAtr: 0.5
  cierresParaRoto: 2
  vidaMediaVelas: 200
  maxNiveles: 5
checks: [T01, T02, T03]
casos: []
---

# Escáner de tendencia

## Para qué sirve

Solo para que el sistema **sepa la tendencia mientras el propietario marca**.
No avisa, no envía a Telegram y no filtra las señales del catálogo. Es contexto,
no un generador de entradas.

## Estados

`RANGO` → `TENDENCIA` → `DEBIL` → `RANGO`, con `AGOTAMIENTO` como aviso de
desgaste. `AGOTAMIENTO` no invierte la tendencia: baja la confianza y bloquea
marcaciones a favor hasta que la estructura se rehaga.

## Entrada y salida (histéresis)

| Paso | Condición |
|---|---|
| `RANGO → TENDENCIA` | ER ≥ 0.35 **y** R² ≥ 0.55 **y** ADX ≥ 22 **y** pila EMA alineada, durante 2 velas |
| `TENDENCIA → DEBIL` | ER < 0.22 **o** ADX < 16 **o** rotura de la pila, durante 3 velas |
| `DEBIL → TENDENCIA` | recupera los umbrales de entrada |
| `DEBIL → RANGO` | sigue flojo |
| `TENDENCIA → AGOTAMIENTO` | distancia a EMA50 > 2.5·ATR **y** divergencia de pivotes |

Cooldown de 5 velas tras un cambio. Los umbrales son `[EST]`: estimados, no
calibrados con datos. Se ajustan cuando haya marcas suficientes.

## Alineación multitemporal

`scoreMTF = 0.40·H1 + 0.30·M15 + 0.20·M5 + 0.10·M1`, cada término con signo y
fuerza. `alineacion` = número de temporalidades que coinciden.

- **Gate de marcación** (el único que se usa): no exige alineación. Marca también
  el contra-tendencia, etiquetándolo como tal.
- **Gate de señal**: `alineacion ≥ 3` o `|scoreMTF| ≥ 0.55`. Queda **sin uso** en
  esta fase: el escáner no avisa.

## Checks

- **T01** — Determinismo: las mismas velas producen el mismo estado, sin depender
  de la hora ni del orden de llamadas.
- **T02** — Histéresis: los umbrales de entrada son distintos de los de salida y
  hay confirmación y cooldown.
- **T03** — Solo vela cerrada: nunca se evalúa una vela a medio formar.
