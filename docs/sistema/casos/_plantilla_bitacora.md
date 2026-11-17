# Bitácora de 100 trades — Sistema RAPTOR vídeo 03

Plantilla. Copiar una por activo (`FX Vol 20`, `FX Vol 40`, `SFX Vol 20`,
`SFX Vol 40`) y rellenar una fila por trade. Al final, separar las métricas
de `2B`/`2RB` (Tier A) frente al resto.

## Cabecera

- Activo:
- Temporalidad de entrada:
- Operador:
- Fecha de inicio:
- Fecha de cierre del bloque:

## Registro por trade

| # | Fecha/hora (UTC) | Código | Lado | Entrada | Stop | TP (R) | Resultado R | Win/Loss | Notas |
|---|---|---|---|---|---|---|---|---|---|
| 1 |  |  |  |  |  | 1.5 |  |  |  |
| 2 |  |  |  |  |  | 1.5 |  |  |  |
| … |  |  |  |  |  |  |  |  |  |

## Cierre del bloque (100 trades)

### Por código

| Código | n | Wins | Win Rate | R acumulado | Esperanza R | PF |
|---|---|---|---|---|---|---|
| 2B |  |  |  |  |  |  |
| 2RB |  |  |  |  |  |  |
| 1 / 1R |  |  |  |  |  |  |
| 3B / 3RB |  |  |  |  |  |  |
| 2 / 2R / 3 / 3R |  |  |  |  |  |  |

### Tier A (2B + 2RB) vs resto

- Tier A: n=, WR=, R=, PF=
- Resto: n=, WR=, R=, PF=

### Conclusión

- ¿Se cumple el criterio de éxito (roturas ≥ +0,15R, n ≥ 150, PF ≥ 1,30)?
- ¿Qué códigos se retiran de la operativa?
- ¿Se recalibra el filtro anti-rango?
