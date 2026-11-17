---
id: validacion
version: 1
estado: activo
fuente: []
parametros: {}
checks: [M01, M02]
casos: []
---

# Validación y criterios de aceptación

## Tabla de checks

Todo check citado por un playbook se define aquí, y todo check definido se usa en
al menos un playbook. El linter falla si no se cumple.

| id | Qué comprueba |
|---|---|
| P01 | Toda marca cita el playbook del que sale |
| P02 | Sin casos parecidos no hay sugerencia |
| T01 | El escáner es determinista |
| T02 | Hay histéresis entre entrada y salida |
| T03 | Solo se evalúa vela cerrada |
| C01 | La raya se ancla en el cierre del pivote |
| C02 | Un solo origen por tramo, el más antiguo con pata viva |
| C03 | Cambio solo por cierre con margen 0.10 ATR |
| C04 | Los toques no invalidan la raya |
| C05 | Re-anclaje al romperse el tramo |
| C06 | El toque se mide por cuerpo |
| C07 | El toque exige confirmación de la vela siguiente |
| C08 | El engaño caduca fuera de la ventana |
| C09 | El toque se avisa aunque no sea entrada |
| N01 | Clúster con tolerancia ±0.35 ATR |
| N02 | Nivel roto solo con dos cierres > 0.5 ATR |
| R01 | Patrón dentro del catálogo; avisos y entradas bien separados |
| R02 | Señal con EMAs alineadas y pendiente a favor |
| R03 | Entrada = cierre exacto de su vela |
| R04 | Hora = apertura de la vela de la señal |
| R05 | En las R hay toque previo y el cierre rompe su nivel |
| R06 | La invalidación es el extremo del tramo del toque |
| R07 | La 1 exige cuerpo y salida previa sobre la EMA50 |
| R08 | La fase es EARLY/MAIN/LATE o no hay fase |
| R09 | Score en 0..100 |
| E01 | El impulso cumple recorrido, cuerpo y extremo nuevo |
| E02 | El retroceso está entre 1.0 y 3.0 ATR |
| E03 | Cada toque supera al anterior |
| E04 | Quiebre por cierre dentro de la caducidad |
| M01 | Acuerdo con las marcas del propietario ≥ 70 % en holdout |
| M02 | Cobertura ≥ 60 % de sus marcas |
| S01 | Stop Loss detrás del último swing previo al quiebre + margen |
| S02 | Take Profit mínimo 1.5 R |
| S03 | Toma parcial a 1.5 R o 2.0 R y breakeven |
| S04 | Trailing con EMA30/EMA50 en beneficio |
| S05 | Notificar cada señal a Telegram |

## Cómo se mide

| Métrica | Cómo | Objetivo |
|---|---|---|
| Acuerdo | extremos a ≤ 0.25 ATR y pendiente a ≤ 15° | ≥ 70 % en holdout |
| Cobertura | % de marcas del propietario que el sistema habría sugerido | ≥ 60 % |
| Estabilidad | cambios de estado de tendencia por día y TF | ≤ 6 |
| Ruido | avisos por día antes/después | no aumentar |

## Reglas del aprendizaje

- Mínimo **30 casos por regla** para proponer un cambio.

Los umbrales de esta política son 70 % de acuerdo, 60 % de cobertura, 30 casos
por regla y 2 puntos de regresión máxima. No viven en `parametros` porque no son
parámetros del código: son criterios de aprobación humana.
- Split **temporal**, nunca aleatorio: lo viejo entrena, lo nuevo valida.
- Si el holdout baja más de **2 puntos**, la propuesta se rechaza aunque mejore
  el entrenamiento.
- Toda propuesta se aprueba a mano. El sistema no se auto-modifica.

Ninguna de estas métricas autoriza a decir que una estrategia gana dinero. La
etiqueta dice **qué jugada es**, no que sea rentable.
