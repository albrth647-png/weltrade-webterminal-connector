---
id: rayas.abanico
version: 1
estado: activo
fuente: [rayas]
parametros:
  k: 3
  atrPeriodo: 14
  margenAtr: 0.10
  toqueAtr: 0.15
  ventana: 6
  minToques: 1
  minVelasAncla: 8
  minVelasTrasAncla: 4
  maxVelasRaya: 400
  minVelasSerie: 60
checks: [C01, C02, C03, C04, C05]
casos: []
---

# Rayas y abanico

## Qué es una raya

Recta que une dos pivotes del mismo tipo y se prolonga. Se valida con **cierres**,
no con mechas: un cierre que supera la recta por 0.10 ATR la rompe; una mecha que
la atraviesa no.

## Origen único (abanico)

- Se toman los **4 pivotes más recientes** del mismo tipo.
- El **más antiguo** es el origen; los otros tres generan las patas.
- El origen se fija al pivote más antiguo que **aún produce una pata viva**
  (`brk < 0`). Se desliza solo si ese pivote ya no sostiene ninguna pata.
- Al romperse el tramo, el abanico se reinicia con un origen nuevo.

Con menos de 4 pivotes se cae al barrido por pares, para series cortas.

## Reglas

- **C01** — El anclaje es el **cierre** del pivote, no su mecha.
- **C02** — Un solo origen por tramo: todas las patas comparten `iA`; el origen
  es el pivote más antiguo con al menos una pata viva.
- **C03** — Cambio de tendencia solo por **cierre** que supera la recta por
  0.10 ATR, y solo si aguanta 4 velas tras el segundo ancla.
- **C04** — Los toques **no invalidan** la raya: solo la invalidan las rupturas
  por cierre con margen.
- **C05** — Re-anclaje: al romperse el tramo, el origen se reinicia; no se arrastra
  el abanico viejo.

## Eventos

| Clase | Cuándo | Prioridad |
|---|---|---|
| `cambio` | cierre que supera la recta por el margen | normal para aviso, baja para marcar |
| `engano` | el precio vuelve a la recta dentro de la ventana de 6 velas | baja |
| `toque` | el cuerpo atraviesa la recta y la siguiente vela cierra a favor | normal |
