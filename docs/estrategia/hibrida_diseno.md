# DISEÑO — Raptor HÍBRIDA: núcleo Yoel (v2) intocable + las 7 piezas de la v1 como capas de contexto

**Fecha:** 2026-11-08
**Petición del propietario:** integrar las piezas conceptuales de la v1 original —(1) zonas S/R
fractales M15, (2) fuerza de zona, (3) TN, (4) fases EARLY/MAIN/LATE, (5) sesgo H1 EMA30 tolerante,
(6) gatillo direccional, (7) score con pesos— **sin que choque con nada de la nueva estrategia**
(catálogo de Yoel en `raptor_strategy.py`), porque «la nueva estrategia es la más importante».
**Regla de oro del diseño:** el núcleo v2 NO se edita ni una línea. La v1 entra como CAPAS que
rodean al núcleo: enriquecen cada señal con contexto y un score de calidad, y solo FILTRAN si el
propietario enciende ese interruptor (por defecto todos apagados).

---

## 1. Contrato de no-choque (la promesa que el código cumple y los tests verifican)

**Qué define la existencia de una señal: SOLO el núcleo v2.** Las capas v1 nunca crean, borran,
retocan ni re-etiquetan una señal v2 por defecto.

Invariantes v2 que la híbrida no toca (cada uno con su test):

| # | Invariante v2 |
|---|---|
| I1 | Catálogo completo: 1, 1R, 1RB, 2, 2R, 2B, 2RB, 3, 3R, 3B, 3RB con las definiciones del vídeo 03 |
| I2 | Semántica touch/entry («2/3 es toque… para que vayas a buscar la entrada») |
| I3 | EMAs 30/50/100: toque de EMA30, techo EMA50 (`exceeds50`), tendencia alineada + pendiente |
| I4 | Avisos 2/3/2R/3R solo desde M15 (`emit_touches_from`); entradas en todas las TF |
| I5 | Filtro de distancia (`max_dist_atr`) y «el límite» |
| I6 | Resets: cascada R, `min_exit_bar`, `exit_open`, `fake_reset_label` |
| I7 | Espejo BUY/SELL exacto |
| I8 | Todos los defaults de `Params` v2 |

**Test de igualdad permanente (T0):** con las capas OFF, `scan_hibrida(dfs)` debe devolver
EXACTAMENTE el mismo DataFrame que `scan(dfs)` de la v2 — mismas filas, mismos patrones, mismos
precios — en todas las series de test y en datos reales. Si algún día falla, la híbrida se rompió.

---

## 2. Cómo entra cada pieza v1 (y por qué no choca)

### Capa A — Zonas S/R fractales M15 (contexto estructural)
- Puerto literal de la lógica v1 a Python: pivotes fractales en M15 con `alas=2` (un high que
  supera a las 2 velas a cada lado → resistencia; un low menor → soporte), agrupación con
  tolerancia `max(tol_rel·nivel, tol_atr·ATR_M15)` (v1: 0,0008 / 0,30), refuerzo ponderado por
  fuerza y vigencia de 48 h con purga.
- **No reemplaza a las EMAs: convive.** Cuando el núcleo v2 emite una señal, la capa busca una
  zona activa cuyo nivel quede a `confluencia_atr·ATR` del precio de entrada (p. ej. 0,5).
- Salida en la señal: `zona_id`, `zona_tipo` (soporte/resistencia), `zona_fuerza`,
  `confluencia` (sí/no), `confluencia_favor` (a favor / contra-nivel: una SELL en resistencia = a
  favor; una SELL sobre un soporte = contra-nivel — se registra, NO se filtra por defecto).
- **Por qué no choca:** las zonas v1 son un NIVEL ESTÁTICO paralelo; el núcleo sigue midiendo todo
  contra las EMAs. La zona solo añade información de confluencia (y celdas de score).

### Capa B — Fuerza de zona
- `zona_fuerza` = pivotes reforzados acumulados en la zona (v1: el nivel se re-promedia ponderado).
- Uso: peso en el score (5/pivote, cap 25, igual que v1) y atributo de calidad. Sin zona cerca →
  fuerza 0 → aporta 0 (no penaliza el resto de componentes).

### Capa C — TN (cancelación de zona)
- Idéntico a v1: si el cierre M15 queda más allá de `nivel ± tn_atr·ATR` (0,50), la zona muere y
  queda registrada (`evento_tn`). Solo limpia el CONTEXTO (evita dar confluencia con niveles ya
  inválidos). Nunca cancela una señal v2 — esa función ya la hace `exceeds50` sobre la EMA50.
- En el año del backtest v1 hubo 14.639 cancelaciones frente a 14.958 zonas nuevas: es una pieza
  activa, no decorativa.

### Capa D — Fases EARLY/MAIN/LATE (sobre la ZONA, nunca sobre la secuencia de Yoel)
- **Aquí está el único riesgo real de choque conceptual, y se resuelve así:**
  - En v1, las fases cuentan TOQUES A LA ZONA (1.º = EARLY; toque tras excursión ≥
    `excursion_atr·ATR` desde el nivel = MAIN; resto = LATE).
  - En v2, los números 1/2/3 cuentan TOQUES A LA EMA30 y son la ESTRATEGIA misma.
  - Son contadores sobre niveles distintos. La híbrida los separa por nombre y por columna:
    el patrón de Yoel queda en `pattern` (intocable) y la fase v1 vive SOLO en la columna
    `fase_zona` ∈ {EARLY, MAIN, LATE}, calculada sobre la zona con las velas M5 (como v1).
- Se calcula solo cuando hay confluencia. Pesos v1 en el score: EARLY 25, MAIN 40, LATE 15.

### Capa E — Sesgo H1 EMA30 tolerante
- Puerto exacto de `_recalcSesgo` v1: EMA(30) en H1 con pendiente de 3 velas cerradas →
  `alza` (cierre sobre la EMA y EMA subiendo), `baja` (espejo), `lateral` (resto).
- **Modo tolerante (por defecto, como v1):** `lateral` deja pasar TODO; `alza` refuerza solo BUY;
  `baja` refuerza solo SELL. Se registra en `sesgo_h1` y `sesgo_ok`.
- **Por qué no choca con la «tendencia comprobada» de Yoel:** son dos cosas distintas y
  complementarias. `filter_trend_confirmed` (v2) mira la ALINEACIÓN de 3 EMAs en H1/H4 con
  consenso DURO. El sesgo v1 mira UNA EMA con pendiente y es TOLERANTE con la lateralidad.
  Uno es régimen macro granular; el otro, confirmación estructural. Ninguno sobreescribe al otro.

### Capa F — Gatillo direccional
- V1: la vela del toque debe cerrar a favor. Híbrida: se evalúa sobre la vela de la señal v2 —
  en ENTRADAS (1, B) si la vela de quiebra cierra a favor; en AVISOS (2/3) si la vela del toque
  cierra a favor. Columna `gatillo_ok`; +10 en el score (peso v1). Filtro duro opcional (off).
- Coherencia con Yoel: «el quiebre significa dominio vendedor» (v3 5:19-5:48) — la vela
  direccional es evidencia de ese dominio; por eso entra como calidad, no como regla.

### Capa G — Score híbrido (ponderador, NO portón)
```
score = min(100,
    peso_patron[pattern]                        # jerarquía de Yoel (ver abajo)
  + peso_fase[fase_zona]                        # 25/40/15 (v1) — solo con confluencia
  + min(peso_fuerza_max, zona_fuerza·por_pivote)# 5/pivote, cap 25 (v1)
  + peso_sesgo   si sesgo_h1 no lateral y a favor   # 25 (v1)
  + peso_gatillo si gatillo_ok                      # 10 (v1)
  + peso_confluencia si confluencia_favor           # parámetro nuevo, default 0
)
```
- `peso_patron` (con evidencia de vídeo): **2B/2RB = 40** — «la DOS B y la DOS RB van a ser, por
  encima de cualquier cosa, LAS MEJORES» (v3 4:21-4:50); entradas 1/1R/1RB/3B/3RB = 30; avisos
  2/3/2R/3R = 10. Los valores son propios y ajustables; la JERARQUÍA es de Yoel.
- **`score.min = 0` por defecto en la híbrida** (v1 usaba 60): el score ORDENA y CLASIFICA; no
  decide. Cuando el backtest muestre qué umbral separa bien, se sube — decidido con datos, no a ojo.
- Compatibilidad v1 verificable: una señal LATE con fuerza 1 y sin sesgo/gatillo = 15+5 = 20 en la
  híbrida (sin confluencia) — y 55 en la v1 (que sumaba sesgo+gatillo de serie). La aritmética
  cambia porque la híbrida no regala puntos que la v1 daba por estructura; el test T5 documenta
  ambos números.

---

## 3. Arquitectura del código

```
motor-senales/estrategias/
├── raptor_strategy.py        # NÚCLEO v2 — CONGELADO (ni una línea)
├── raptor_hibrida.py         # NUEVO — capas + envoltorio
│   ├── ZonaParams            # alas=2, tol_pivote_atr=0.30, tol_pivote_rel=0.0008,
│   │                         # vigencia_horas=48, tn_atr=0.50, excursion_atr=1.20,
│   │                         # confluencia_atr=0.5, tf_zona="M15"
│   ├── ScoreParams           # pesos_patron, pesos_fase, por_pivote, caps, min=0
│   ├── HibridaParams         # Params(v2) + ZonaParams + ScoreParams + interruptores
│   ├── detectar_zonas(df_m15)          # pivotes confirmados + refuerzo + purga (sin look-ahead:
│   │                                   #   un pivote solo existe `alas` velas después de formarse)
│   ├── tn_cancelar(df_m15, zonas)      # cierre ±0.5·ATR mata zona
│   ├── fase_de_zona(zona, velas_m5)    # EARLY/MAIN/LATE por toques a la zona (M5)
│   ├── sesgo_h1(df_h1)                 # alza/baja/lateral (EMA30 + 3 velas)
│   ├── enriquecer(senales_v2, dfs)     # añade zona_*, fase_zona, sesgo_h1, gatillo_ok, score
│   ├── filtrar(senales, switches)      # SOLO los filtros encendidos (default: ninguno)
│   └── scan_hibrida(dfs, params)       # = scan(v2) + enriquecer + (filtrar)
└── test_raptor_hibrida.py    # NUEVO — tests T0..T7 (los 34 de la v2 quedan intactos)
```

- **Degradación honesta:** si no hay M15 → no hay zonas/fase/confluencia (esas columnas a 0/None);
  si no hay H1 → no hay sesgo; si no hay M5 → fases sin excursión (todas EARLY→sin fase). Las
  señales v2 salen SIEMPRE igual. Se registra qué capas estaban activas.
- **Sin look-ahead:** pivotes confirmados `alas` velas después (igual que v1), sesgo con H1
  cerrada, fases con M5 cerrada. El backtest respeta el orden temporal.

## 4. Tests nuevos (T0-T7, sin tocar los 34 de la v2)

| Test | Qué demuestra |
|---|---|
| **T0 IGUALDAD** | Capas OFF ⇒ híbrida ≡ v2 exacta (filas, patrones, precios) en las series A-N existentes y en datos reales. EL test de no-choque. |
| T1 Zonas | Pivote confirmado con alas 2; refuerzo pondera el nivel; tolerancia agrupa; vigencia 48 h purga; TN mata zona |
| T2 Fases | EARLY (1.º), MAIN (tras excursión ≥ 1,2·ATR), LATE (sin excursión) sobre una zona sintética |
| T3 Sesgo | alza/baja/lateral con serie sintética; `lateral` deja pasar ambos lados |
| T4 Gatillo | vela de quiebra a favor / en contra ⇒ gatillo_ok true/false |
| T5 Score | composición a mano de un caso; cap 100; `min=0` pasa todo; pesos v1 reproduciendo 55 en LATE+fuerza1 con sesgo+gatillo activos |
| T6 Filtros ON | los filtros solo QUITAN señales existentes, jamás crean ni cambian patrones |
| T7 Degradación | sin M15/H1/M5 ⇒ señales v2 intactas + capas marcadas ausentes |

## 5. Backtesting — con los activos sintéticos de tu GitHub

**Los activos:** tu repo es el conector de los índices sintéticos de Weltrade — los «activos de
índice sintético» son los símbolos del catálogo que el conector ya maneja (FX Vol 20/40/60/80/99,
SFX Vol 20/40/60/80/99, Step Index, FlipX…). El camino de datos ya está verificado en el proyecto:
**cmd 11 del protocolo** descarga velas históricas (respuesta de 48 B por vela, probado en vivo
por `motor-senales`) y con eso se construyó el baseline v1 (1 año × FX Vol 20/60/99, M5: 100.052
velas por símbolo).

**Lo que necesito para tirar de ahí:** las credenciales demo (`WT_LOGIN`/`WT_PASS`) — no están en
el repo (correcto: `.env` está en `.gitignore`) ni en esta máquina (se perdió con el reinicio del
entorno). Se ponen SOLO en `motor-senales/.env` local. Si la demo vieja caducó, se crea otra en
weltrade.org (2 min) y me pasas login/contraseña.

**Plan de comparación (misma vara para todos):**
1. **Datos:** FX Vol 20/60/99 (y si quieres, SFX Vol 40/60 y Step Index), M5 + M15 + H1, 1 año —
   el MISMO dataset del baseline v1. Mientras llegan las credenciales: BTCUSDT público (Binance),
   igual que hizo el backtest de la v2, para validar el engranaje.
2. **Riesgo uniforme:** SL = 1·ATR, TP = 2·ATR, vela ambigua = pérdida (idéntico al baseline v1)
   → resultados comparables contra PF 1,27 / WR 45,7 % / 3.341 señales.
3. **Experimentos:**
   - **E0** v2 pura (baseline Yoel sobre esos datos).
   - **E1** híbrida con capas OFF + score informativo: ¿la jerarquía de Yoel se confirma?
     (¿2B/2RB rinden por encima del resto? ¿el score separa?)
   - **E2** + sesgo H1 tolerante como filtro → Δ señales / Δ PF (frente a E1).
   - **E3** + confluencia de zona a favor como filtro → Δ PF.
   - **E4** + gatillo direccional duro → Δ PF.
   - **E5** curva PF vs `score.min` (60 de v1 y vecinos) con validación walk-forward
     IN/OUT (mitad/mitad, como los experimentos C1/C2/empine de la v1).
4. **Entregables:** `backtest_hibrida/reporte.md` + `senales.csv` + comparativa final en una tabla
   (E0 vs E1..E5 vs baseline v1), y la decisión final de qué interruptores quedan encendidos.

## 6. Orden de trabajo (por si hay que parar en cualquier punto, todo queda respaldado)

1. `raptor_hibrida.py` (capas A-G + envoltorio + degradación) — núcleo v2 sin tocar.
2. `test_raptor_hibrida.py` T0-T7 — el T0 de igualdad es la llave: si pasa, no hay choque.
3. Descarga de datos (credenciales demo → FX Vol; mientras tanto BTCUSDT).
4. Backtest E0-E5 + reporte + comparativa.
5. Cada paso: commit + push inmediato.

## 7. Fuentes

- Núcleo v2: `motor-senales/estrategias/raptor_strategy.py` (+ docstring PARTES A/B).
- Piezas v1: `motor-senales/estrategia.js` (`_chequearPivote`, `_agregarPivote`, `_chequearTN`,
  `_chequearToque`, `_recalcSesgo`), `raptor_default.json`, `doc_estrategia.js`.
- Evidencia v1: `backtest_raptor/reporte.md` (+ C1 spread, C2 gatillo, empine).
- Evidencia v2: `docs/estrategia/auditoria_raptor_strategy.md`, `correcciones_aplicadas_v2.md`,
  `docs/backtest/backtest_raptor_20261107.md`.
- Diferencias v1↔v2: `docs/estrategia/diferencias_v1_original_vs_v2_ultima.md`.
- Protocolo de datos: `conector/LEEME.md` (cmd 11 de velas, verificado en vivo).
- Vídeos: `videos/yoel/datos/` (jerarquía 2B/2RB: v3 4:21-4:50).
