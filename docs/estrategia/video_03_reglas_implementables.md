# Vídeo 03 — Reglas implementables (audio verificado + pase a 1 fps)

**Fuente:** `video_03_extraccion_verificada.md` (transcripción nueva, 77 segmentos) + fotogramas
a 1 fps del mp4 en los tramos 25–70 s, 195–245 s, 280–405 s y 450–500 s.
**Convención:** lo que dice el vídeo va con cita de tiempo. Lo que el vídeo **no numera** va
marcado `[EST]` (estimado nuestro, a calibrar con backtest). Nada de esto es invención: `[EST]`
solo rellena huecos que él deja abiertos.

---

## 0. Andamiaje común (todas las estrategias)

| Pieza | Regla | Fuente |
|---|---|---|
| EMA30 (blanca) | es la EMA de **contacto**: el toque se mide aquí | 342–348 s |
| EMA50 (amarilla) | es el **techo/suelo**: el retroceso **no debe superarla** | 342–358 s |
| EMA100 (oscura) | visible en pantalla por encima de todo: tendencia de fondo | frames (7:42–8:20) |
| Dirección | siempre **a favor de la tendencia comprobada** (venta: precio < EMA30 < EMA50) | 325–342 s |
| Toque válido | mecha toca EMA30 y el cierre **no** supera EMA50 | 342–358 s |
| Etiqueta | color = dirección (rojo venta / azul compra), texto = código | pizarra + frames |
| Anclaje | la etiqueta va sobre la **vela del toque** (1R, 2R, 3R) o del **quiebre** (2B, 3B) | frames 301–361 |

---

## 1. `1` — la seductora (engaño)

Secuencia exacta (30–46 s, repetida en 282–290 s):

1. **Tendencia comprobada** (precio bajo EMA30/50).
2. **Engaño**: el precio **se sale** de la tendencia — excursión contra el sesgo que atraviesa
   la EMA50. `[EST]` 1–5 velas por encima, mecha o cierre.
3. **Regreso**: vuelve a su tendencia y cierra otra vez del lado correcto de la EMA30.
4. **Quiebre con cuerpo**: vela de cuerpo lleno que rompe el mínimo del tramo del engaño.
   `[EST]` cuerpo ≥ 50 % del rango y ≥ 0,30·ATR.
5. **Entrada**: cierre de la vela del quiebre.
6. **Invalidación**: máximo de la excursión del engaño.

> Es la **única** a la que el vídeo le exige cuerpo («quiebra con cuerpo», 39–45 s).
> No existe `1B`: el quiebre ya está dentro de la `1` (por eso la pizarra de 4:38 solo
> escribe `2B/2RB` y `3B/3RB`).

## 2. `2` — segundo toque (AVISO)

- **Primer toque** a la EMA30 → el precio se extiende (hace un mínimo nuevo).
- **Segundo toque** a la EMA30 → se emite `2`.
- «Es al toque» (59–67 s): la señal nace en el toque, sin esperar quiebre.
- Uso: **aviso**, «para que tú vayas a buscar la entrada» (161–166 s). No es operación.

## 3. `3` — tercer toque (AVISO)

- El precio **supera el número 2** (rompe el mínimo que dejó el 2.º toque).
- Vuelve a tocar la EMA30/50 → **tercer toque** → `3` (67–83 s).
- `[EST]` «supera» = cierre más allá del mínimo del 2.º toque, no solo mecha.
- Aviso, igual que la `2`.

## 4. `R` — reset

- «R de reset» (84–94 s): el precio hizo la jugada, **se salió, volvió y la hizo otra vez en la
  misma dirección** → la misma jugada pasa a `1R`, `2R`, `3R`.
- Es una **repetición**, no una estrategia nueva: mismo patrón, misma dirección.
- `[EST]` El contador vuelve a cero cuando (a) se consuma una entrada con su quiebre, o (b)
  cambia la tendencia de fondo (giro de EMA100). El vídeo solo dice «se salió, volvió y la
  hizo de nuevo».

## 5. `1R` / `2R` / `3R` — la jugada n reseteada

- Pizarra 3:26: tabla `1─1R`, `2─2R`, `3─3R`.
- En el gráfico aparecen **en cascada sobre los toques** (206–217 s: «hace el 1R, el 2R, toque y
  el 3R»), que es lo que se ve en los fotogramas 301–361 y 463–475.
- `[EST]` Se conserva la naturaleza de la base: `2R`/`3R` son **avisos**; `1R` es la seductora
  reseteada y **sí** es entrada (lleva quiebre con cuerpo dentro).

## 6. `2B` — segundo toque + quiebre («las mejores»)

Condiciones literales (342–365 s):

1. El precio **toca la EMA de 30**.
2. **No supera la de 50**.
3. **Respeta** la EMA de 30 y 50 (el retroceso rebota, no las atraviesa).
4. El cierre **rompe el mínimo anterior** — «hizo el segundo toque pero también quebró, en este
   caso el mínimo anterior» (312–320 s).
5. El quiebre es «dominio vendedor **con tendencia comprobada**» (325–342 s): no vale un quiebre
   contra el sesgo.
6. **Entrada** al cierre del quiebre. **Invalidación**: máximo del toque.

`[EST]` mínimo anterior = mínimo de las 5–8 velas previas al toque; el quiebre caduca a las
6 velas del toque; el cuerpo del quiebre ≥ 50 % del rango.

## 7. `2RB` — lo mismo sobre secuencia reseteada

- «La 2RB es lo mismo, solamente que él se fue: sale de la tendencia y lo vuelve a hacer.
  Es exactamente lo mismo» (366–376 s).
- Es decir: `2B` cuya secuencia venía de un reset.

## 8. `3B` / `3RB`

- `3B`: «viene con el primer toque uno, segundo toque dos, tercer toque… ¡y rompe! 3B» (384–396 s);
  «el 3B es el primer impulso: uno, dos y el tercero que quebró, aquí tomas la entrada. Ese es 3B
  por el quiebre» (460–469 s).
- `3RB`: ese mismo 3B cuando la secuencia venía reseteada.
- Entrada al cierre del quiebre del 3.er toque; invalidación el máximo de ese toque.

---

## 9. Tabla de parámetros: qué es del vídeo y qué es estimado

| Parámetro | Vídeo | Nuestro `[EST]` |
|---|---|---|
| Emas | 30 y 50 (100 visible) | 30 / 50 / 100 |
| Toque | mecha en EMA30, sin superar EMA50 | tol = 0,10·ATR |
| Salida del engaño | «se sale» de la tendencia (sobre EMA50) | 1–5 velas, mecha o cierre |
| Cuerpo del quiebre de la 1 | «con cuerpo» | ≥ 50 % rango y ≥ 0,30·ATR |
| Mínimo que se quiebra | «el mínimo anterior» | mínimo de 5–8 velas previas |
| Caducidad del quiebre | no lo dice | 6 velas |
| Reset | «se salió, volvió y la hizo otra vez» | contador por tendencia / tras entrada |
| Ventana de tendencia | «tendencia comprobada» | alineación EMA30<50<100 + pendiente |
| Distancia máxima al toque | no lo dice (viene del vídeo 02) | 2,0·ATR |

## 10. Lo que sigue sin identificar (y por qué)

1. **Los números exactos**: él no da ni uno; todo `[EST]` es nuestra calibración.
2. **«Cuándo está mal»** (425–435 s): señala un setup malo en vivo y dice «hay que tener vista,
   no son muchos». No hay regla verbal; solo el ejemplo visual.
3. **El nombre de la 1**: «seductora» → «matadora» → «la que más da» (248–267 s). Sin cerrar.
4. **EMA100 y multi-TF**: en este vídeo solo nombra 30 y 50; la 100 y el sesgo multi-TF vienen
   de los vídeos 01–02.
5. **Simetría compra/venta**: todos los ejemplos son bajistas; la versión alcista es espejo.
6. **El scanner** (Flip 1-5, Step 200/500/800, celdas numéricas): no explica qué son.
7. **`3RB` vs `3B`**: la diferencia se enuncia en una frase (366–396 s) y no se dibuja aparte.

---

## 11. Calibración con datos reales (2026-11-10)

Los `[EST]` ya no son una suposición: se midieron con **4 símbolos × 4
temporalidades × 30 días** (16 series de `backtest_hibrida/datos/`) y **2.025
combinaciones**. Método (`motor-senales/calibrar.mjs`):

- Métrica: **esperanza en R**. Entrada al cierre de la señal, SL en el extremo
del toque, TP a 1,5R, timeout de 12 velas.
- **70 % inicial de cada serie para elegir, 30 % final para validar**: si solo
gana en el tramo que se miró, no se adopta.

| Parámetro | Antes `[EST]` | **Calibrado** | Vecinos probados |
|---|---|---|---|
| Tolerancia del toque | 0,10 ATR | **0,30 ATR** | 0,15 → 0,022R · 0,45 → 0,069R (train) |
| Ventana del mínimo anterior | 6 velas | **12 velas** | 8 → 0,035R · 16 → 0,061R |
| Cuerpo mínimo | 50 % del rango | **50 %** | 40 % → 0,057R · 65 % → 0,084R |
| Cuerpo mínimo en ATR | 0,30 ATR | **0,10 ATR** | 0,20 y 0,35 dan lo mismo |
| Caducidad del quiebre | 6 velas | **3 velas** | 4 → 0,081R · 6 → 0,061R |
| Separación entre toques | 2 velas | **2 velas** | 1 → 0,083R · 3 → 0,056R |
| EMAs contacto/techo | 30 / 50 | **30 / 50** | 20/50, 34/50, 50/100, 30/100, 34/60, 25/55: todas peores |

**Resultado:** 0,092R de esperanza en train (n=330, 51 % aciertos, PF 1,22) y
0,044R en validación (n=172, 48 %, PF 1,11). Los parámetros anteriores daban
−0,040R en train con 43 % de aciertos: la calibración **arregla un motor que
perdía dinero**.

**Sensibilidad:** con TP a 1R, 2R o 3R y horizonte de 12 velas la esperanza de
validación se mantiene positiva (0,012R · 0,036R · 0,039R); con horizonte de 6
velas se cae a ~0. Es decir, el edge **necesita tiempo**, no es un rasgo de la
vela siguiente.

### Recalibración 2026-11-10, con las reglas completas

Tras añadir la extensión entre toques, el cuerpo solo en la `1`, la caducidad
del engaño, la cancelación sobre la EMA50, el reset por salida, el nivel del
tramo del engaño para la `1` y el modo Sperandeo de la 2B, se repitió la
rejilla entera (2.025 combinaciones, 16 series, mismo método):

| | train | validación |
|---|---|---|
| Antes de las reglas | +0,092R (n=330) | +0,044R (n=172) |
| Código final, parámetros actuales | +0,032R (n=370) | +0,084R (n=190) |
| Ganadora de la rejilla final | +0,075R (n=339) | +0,080R (n=184) |

La ganadora (`cuerpoMin 0,65`, `caducidad 4`) **no se adoptó**: el primero está
en el borde de la rejilla y el segundo mejora train (+0,030R) pero no validación
(+0,089R frente a +0,084R, muy por debajo del error típico de ±0,05R con
n=370). El único vecino que sube los dos tramos es `cuerpoMinAtr 0,35`
(+0,043R / +0,088R), por 0,011R: ruido. Los parámetros se quedan.

Reparto por código con los parámetros actuales (train | validación):
`1R` −0,038/184 | +0,161/85 · `2RB` +0,067/66 | −0,044/35 · `3RB` +0,277/44 |
+0,318/22 · `2B` −0,023/36 | −0,078/14 · `3B` +0,044/23 | −0,111/19 ·
`1` +0,120/17 | +0,008/15. Con las reglas del vídeo, la jugada **repetida**
(`1R`, `2RB`, `3RB`) es la que sostiene la esperanza; la `1` mejora al romper el
nivel del engaño (de 5 a 17 señales, train de −0,140R a +0,120R) y la `2B` sigue
en cero. El detalle de las dos reglas nuevas, con sus tablas comparativas, está
en `video_03_fidelidad_pendiente.md` §8.1 y §11.

**Por código (train | validación):**

| Código | Esperanza train | n | Esperanza val | n |
|---|---|---|---|---|
| `1R` | +0,325 | 8 | +0,250 | 2 |
| `2RB` | +0,204 | 25 | +0,031 | 15 |
| `3B` | +0,174 | 115 | −0,046 | 61 |
| `3RB` | +0,049 | 106 | +0,155 | 59 |
| `1` | +0,041 | 44 | +0,160 | 25 |
| `2B` | −0,137 | 32 | −0,370 | 10 |

**Aviso honesto:** el edge es **fino** (PF 1,1–1,2, no un 2,0) y **`2B`, la que
él llama «las mejores», sale negativa en estos datos** — con 10 operaciones en
validación, que es muestra insuficiente para afirmar que no sirve, pero no hay
evidencia a favor. Los códigos con mejor comportamiento son `3RB`, `3B` y `1`.

Y lo de siempre: 30 días de índices sintéticos generados por el bróker no son
una garantía. Estos valores son el mejor punto de partida medido, no una
promesa.
