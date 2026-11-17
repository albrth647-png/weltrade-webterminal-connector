---
id: catalogo.yoel
version: 1
estado: activo
fuente: [nucleo]
parametros:
  emaContacto: 30
  emaTecho: 50
  emaFondo: 100
  retencionDias: 30
  atrPeriodo: 14
  tolToqueAtr: 0.30
  ventanaMin: 12
  cuerpoMin: 0.50
  cuerpoMinAtr: 0.10
  caducidad: 3
  separacionToques: 2
  exigirExtension: true
  cuerpoSoloUno: false
  caducidadEngano: 12
  cancelarSobreTecho: true
  resetPorSalida: true
  resetTrasEntrada: true
  separacionMinAtr: 0
  pendienteMinAtr: 0
  nivelUnoPorEngano: true
  modo2B: retesteo
  caducidadRetesteo: 3
  tolRetesteoAtr: 0.30
  margen2BAtr: 0.50
  caducidadFallo2B: 2
checks: [R01, R02, R03, R04, R05, R06, R07, R08, R09]
casos: []
---

# Catálogo Yoel (1 · 2 · 3 · R · B)

## La etiqueta es la señal

Los números son toques de la EMA30; los sufijos dicen qué pasó después.

| Código | Qué es | Tipo |
|---|---|---|
| `1` | engaño sobre la EMA50, regreso y quiebre **con cuerpo** del mínimo del engaño | entrada |
| `1R` | la misma jugada cuando la secuencia venía reseteada | entrada |
| `2` | segundo toque a la EMA30/50 | entrada al toque |
| `2R` | segundo toque tras un reset | entrada al toque |
| `3` | tercer toque, tras superar el segundo | entrada al toque |
| `3R` | tercer toque tras un reset | entrada al toque |
| `2B` `3B` | toque + quiebre **con cuerpo** del mínimo/máximo anterior | entrada |
| `nRB` | el mismo quiebre cuando la secuencia venía de un reset | entrada |

`R` es el **reset** de la secuencia 1/2/3: cuando una jugada se consume, la cuenta
vuelve a empezar. `B` es el **quiebre con cuerpo**. No existe `1B`: el quiebre va
dentro de la `1`. Todas las señales del catálogo se operan; la `2` y la `3` al
toque, las `B` y la `1` en el quiebre.

## Condiciones

- Tendencia comprobada: precio y EMAs alineadas (`c < EMA30 ≤ EMA50 ≤ EMA100` en
  venta, espejo en compra).
- Toque: el extremo llega a la EMA30 dentro de `tolToqueAtr` y **no supera** la
  EMA50.
- El segundo y el tercer toque deben **superar** al anterior (extensión).
- **Todas las `B`** exigen cuerpo ≥ 50 % del rango y ≥ 0.10 ATR; la `1` exige
  además una salida previa sobre la EMA50.
- Repetición: tras consumir una jugada, la siguiente del mismo lado lleva `R`.

## Modo 2B

`retesteo` (**por defecto**, diccionario del propietario) arma la jugada con el
quiebre y entra cuando el precio vuelve a probar el nivel roto, dentro de 3 velas
y con 0.30 ATR de tolerancia. `continuacion` opera el quiebre al cierre.
`reversion` espera el **fracaso** del quiebre y entra al contrario, con stop en el
extremo marginal.

## Checks

`R01`–`R09` describen las condiciones del catálogo: patrón, alineación de EMAs,
precio de entrada, hora, toque previo, invalidación, cuerpo de la `1`, fase y
score.

**Deuda declarada:** el auditor histórico `validar_reglas.js` se retiró con el
módulo de estrategias. Hoy no hay fixture automático para estas nueve reglas; se
reconstruye en F2. El linter documental no lo tapa: solo comprueba que el check
exista en la tabla y esté citado por un playbook.
