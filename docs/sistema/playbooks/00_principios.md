---
id: principios
version: 1
estado: activo
fuente: []
parametros: {}
checks: [P01, P02]
casos: []
---

# Principios

## Qué es una marca válida

Una marca es una **hipótesis con nivel e invalidación**, no una opinión. Para ser
válida tiene que poder responder tres preguntas:

1. **Dónde**: el precio exacto del nivel o del anclaje.
2. **Por qué**: la regla del playbook que la autoriza, citada por `id`.
3. **Qué la invalida**: el precio que, si se cruza, demuestra que la lectura era
   mala.

Si falta cualquiera de las tres, no es una marca: es un dibujo.

## Reglas

- **P01** — Toda marca guardada cita el **playbook** del que sale
  (`playbook: id@version`). Las reglas concretas (`checks`) se añaden al aprobarla,
  no al dibujarla. Una marca sin playbook no entra en la memoria.
- **P02** — Sin casos parecidos, el sistema **no sugiere**: devuelve
  `confianza: 0` y `motivo: "memoria vacía"`. No se rellena con parecidos falsos.

## Lo que no se hace

- No se marca mirando el futuro. La huella de un caso usa solo velas con
  `t' ≤ t`.
- No se inventan ejemplos para probar el sistema. Las pruebas usan velas
  sintéticas en memoria y nunca escriben en `casos.jsonl`.
- No se cambia una regla para que encaje con una marca concreta: se anota la
  excepción y se revisa cuando haya casos suficientes (≥ 30).

## Estados

`vacio` → `borrador` → `aprobado` | `rechazado`. Solo `aprobado` alimenta la
recuperación. `rechazado` se conserva como contraejemplo.
