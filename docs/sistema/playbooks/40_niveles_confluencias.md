---
id: niveles.confluencias
version: 1
estado: borrador
fuente: []
parametros:
  toleranciaClusterAtr: 0.35
  margenRotoAtr: 0.5
  cierresParaRoto: 2
  vidaMediaVelas: 200
checks: [N01, N02]
casos: []
---

# Niveles y confluencias

Un nivel no es una línea: es un **clúster con historia**. Agrupa pivotes, números
redondos, máximo y mínimo del día, EMAs y patas del fan que caen en la misma zona.

## Modelo

```
nivel = { id, precio, tipo, toques, primerToque, ultimoToque,
          estado: virgen|probado|roto, confluencias[], score }
```

- Agrupación con tolerancia **±0.35 ATR** `[EST]`; los clústeres cercanos se
  fusionan.
- `score = Σ exp(−edad / 200) · (1 + 0.25·(toques−1)) + 0.5·confluencias` `[EST]`.
- `roto` cuando **dos cierres** superan el nivel por **0.5 ATR**. Una mecha no
  rompe nada.

## Uso al marcar

Cada marca y cada pata del fan referencian `nivelId`. Así el caso sabe **por qué**
se marcó ahí y no dos velas antes.

## Reglas

- **N01** — Un clúster se forma con tolerancia ±0.35 ATR y se fusiona por cercanía.
- **N02** — Un nivel solo se marca `roto` con dos cierres más allá de 0.5 ATR.

Los umbrales son `[EST]`: se calibran con las marcas del propietario, no antes.
