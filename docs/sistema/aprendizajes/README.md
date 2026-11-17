# Aprendizajes — un documento por tema

Cada tema tiene su propio archivo. No se mezclan: así se puede añadir
`divergencias.md` mañana sin tocar `rayas.md`.

| Documento | Tema | Estado |
|---|---|---|
| `tendencia.md` | Escáner: estados, fuerza, alineación MTF | vacio |
| `rayas.md` | Abanico: origen, patas, anclaje, re-anclaje | vacio |
| `toques.md` | Toque, cuerpo, margen ATR, ventana, engaño | vacio |
| `niveles.md` | Clústeres, confluencias, reacción a niveles | vacio |
| `marcacion.md` | Cómo marca el propietario y por qué | vacio |

## Reglas de anotación

1. **Solo marcas reales.** Nada de ejemplos inventados para «probar».
2. **Append-only.** Corregir una nota añade una línea con fecha; no se reescribe
   la historia.
3. **Cada nota cita** el `caso:<id>` que la origina y, si aplica, el `id` de la
   regla del playbook.
4. **Estado explícito**: `borrador` mientras no lo revise el propietario;
   `aprobado` cuando lo confirme.
5. **Una idea por nota.** Si una nota mezcla rayas y niveles, va partida en dos.

## Cuándo se abre un tema nuevo

- Cuando hay al menos 3 marcas que no encajan en los temas existentes.
- Cuando el propietario pide seguirlo por separado.
- Nunca «por si acaso»: un documento vacío de más es ruido.

## Cómo se rellena

El sistema no escribe aprendizajes solo. Al guardar una marca, crea la ficha del
caso y deja una nota en `borrador` en el tema correspondiente con los hechos
medidos (geometría, huella, vecinos). El propietario la aprueba, la corrige o la
rechaza.
