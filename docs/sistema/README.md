# Sistema de conocimiento — índice

Documentación viva del motor. No es un manual de uso: es el contrato entre lo
que el código calcula, lo que el propietario marca y lo que el sistema aprende.

## Mapa

| Carpeta | Qué guarda | ¿Crece sola? |
|---|---|---|
| `playbooks/` | Las **reglas**: umbrales, excepciones, checks. Política aprobada. | No. Solo cambia con aprobación. |
| `aprendizajes/` | Lo **entendido** de las marcas reales, un documento por tema. | Sí, cada vez que se guarda una marca. |
| `casos/` | La **ficha** de una marca concreta (captura, contexto, veredicto). | Sí, una por marca guardada. |

`00_arquitectura.md` es el diseño; este README es el índice; `changelog.md`
registra qué cambió y cuándo.

## Regla de oro: vacío hasta que el propietario marque

- No hay ejemplos sintéticos ni casos de relleno.
- `casos.jsonl` no existe hasta la primera marca guardada.
- Las secciones «Ejemplos» llevan `<!-- sin casos -->` y así se quedan hasta que
  haya marcas reales.
- Con 0 casos parecidos, el sistema **no sugiere nada**: lo dice y espera.
- Las pruebas usan velas sintéticas en memoria y **nunca** escriben en `casos.jsonl`.

## Ciclo de una marca

```
marcar en /grafica
   → «Guardar en memoria»        (POST /marcas)
   → caso con huella             (datos/casos.jsonl, append-only)
   → ficha del caso              (casos/AAAA-MM-DD_simbolo_tf.md)
   → nota de aprendizaje         (aprendizajes/<tema>.md, estado: borrador)
   → propuesta de regla          (solo con ≥ 30 casos; aprobación humana)
   → playbook editado            (nueva versión, con changelog)
```

## Estados

| Estado | Significado |
|---|---|
| `vacio` | El documento existe, no hay nada aprendido todavía. |
| `borrador` | Anotado por el sistema o por el propietario, sin validar. |
| `aprobado` | Revisado por el propietario; solo esto entra en la recuperación. |
| `rechazado` | Se conserva como contraejemplo; no se usa para sugerir. |

## Cómo se añade un documento nuevo

1. Si el tema no encaja en ninguno de los existentes, se crea un archivo nuevo en
   `aprendizajes/` copiando `_plantilla.md`. No se mete todo en un documento
   gigante.
2. Se registra en `aprendizajes/README.md` (tabla de temas).
3. Se añade su línea al `changelog.md`.
4. Si el tema implica una regla nueva, esa regla vive en `playbooks/`, no aquí.

## Pendiente (F0)

`playbooks/` y `changelog.md` se crean en la fase F0 junto con el linter
`validar_playbooks.mjs`. Hasta entonces, este índice describe la estructura
acordada, no archivos que aún no existen.
