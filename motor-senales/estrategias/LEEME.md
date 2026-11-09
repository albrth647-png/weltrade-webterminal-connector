# Estrategias — documentos, no código

La estrategia del motor vive aquí, en **documentos JSON**. El código no
contiene ninguna estrategia: solo el vocabulario (pivotes, fases de toque,
TN, sesgo, scoring) y el esquema que valida estos documentos.

| Archivo | Qué es |
|---|---|
| `raptor_default.json` | Estrategia de referencia (baseline del backtest de 1 año). Sirve de plantilla y de red de seguridad. |
| `activa.json` | La estrategia activa (escrita por la app al pulsar "Activar"). Si no existe, se usa `raptor_default.json`. |
| `importados/` | Copia de todo documento importado desde la web, para auditoría. |

## Formato del documento

```json
{
  "meta":   { "nombre": "...", "version": 1, "descripcion": "..." },
  "simbolos": [],                       // vacío = todos
  "zonas":  { "activo": true, "tf": "M15", "indicador": "fractales",
              "alas": 2, "tolPivoteAtr": 0.30, "tolPivoteRel": 0.0008,
              "vigenciaHoras": 48 },
  "toques": { "tf": "M5", "bandaAtr": 0.15, "excursionAtr": 1.20,
              "fases": { "EARLY": 25, "MAIN": 40, "LATE": 15 } },
  "tn":     { "activo": true, "atr": 0.50 },
  "sesgo":  { "activo": true, "tf": "H1", "indicador": "ema",
              "periodo": 30, "velasPendiente": 3 },
  "gatillo": { "direccional": true },
  "score":  { "min": 60, "pesoFuerzaMax": 25, "pesoFuerzaPorPivote": 5,
              "pesoSesgo": 25, "pesoGatillo": 10 },
  "dedup":  { "minutos": 45 },
  "riesgo": { "slAtr": 1.0, "tpAtr": 2.0 },
  "atr":    { "periodo": 14 },
  "maxVelas": { "M1": 43200, "M5": 8640, "M15": 2880, "M30": 1440,
                "H1": 720, "H4": 180, "D1": 50 }
}
```

Reglas:

- **Validación estricta**: si falta un campo o está fuera de rango, el
  documento se rechaza y la app lista exactamente qué corregir.
- TFs válidos: `M1 M5 M15 M30 H1 H4 D1`.
- Un documento también puede ir **dentro de un .md/.txt** en un bloque
  ` ```json ... ``` ` — el importador lo encuentra.
- Todos los documentos importados (`.set`, `.tpl`, `.mq5`, `.ex5`…) se
  convierten a este formato antes de activarse; nada entra al motor sin
  pasar por aquí.
