# Auditoría completa del proyecto — `weltrade-webterminal-connector`

- Fecha: 2026-11-06
- Alcance: 56 ficheros del repositorio (`conector/`, `motor-senales/`, `backtest_raptor/`, `pwa/`, `scripts_re/`, `docs/`, `evidencia/`)
- Tipo: revisión de código + verificación ejecutada + auditoría metodológica del backtest
- **Alcance funcional: SOLO generación de señales.** El backtest queda **congelado como referencia de solo lectura**: no se modifica, no se re-ejecuta y no se re-optimiza. Las observaciones sobre `backtest_raptor/` son documentales (para saber qué se puede creer de sus cifras), nunca instrucciones de cambio.
- Resultado global: **0 hallazgos de severidad alta · 6 medios · 10 bajos · 6 informativos**

---

## 1. Resumen ejecutivo

El proyecto está **sano en lo estructural** y mejor de lo habitual en proyectos de este tipo: no hay secretos duros en el repositorio, `.gitignore` protege `.env`, el motor tiene tests que pasan (16/16), el backtest usó criterio pre-registrado y walk-forward para rechazar filtros (en vez de optimizar hasta que luzca), y el portaje PWA se comprobó **evento a evento** contra la implementación Node (91/91 eventos idénticos y `resumen()` idéntico).

Los riesgos que quedan no son de "código roto", sino de **operación y mantenimiento**:

1. Las credenciales del bróker y el token de Telegram viven en `localStorage` sin cifrar (riesgo aceptado y documentado, pero es el punto más sensible para el usuario final).
2. La caché del service worker está versionada a mano (`wt-pwa-v1`): una actualización del protocolo o del motor sin incrementar la versión deja al cliente instalado sirviendo código viejo.
3. No existe test permanente del parser de protocolo; la paridad se verificó en esta auditoría con un script temporal.
4. Reintento infinito con credenciales inválidas: martillea el servidor cada 3–30 s sin distinguir credenciales de red.
5. `/estado` del servidor Node no tiene autenticación (relevante si se despliega en una URL pública tipo Render).
6. Un fallo silencioso si la clave de sesión del handshake llega con longitud distinta de 32 B.

En el backtest, la auditoría **confirma la aritmética** (3.341 señales, netR 481,30, expectativa 0,144 R, t = 6,55, IC95 % 0,101–0,187) y encuentra una **imprecisión de ficha**: el "R fijo ≈ 2" es nominal; el R realizado medio por ganadora es **1,50** (rr entre 0,82 y 3,78), porque el SL se ancla al nivel de zona ∓1×ATR, no al precio de entrada. El punto de equilibrio real es un WR del **39,9 %**, y el 45,7 % observado deja margen — pero menor del que sugiere la ficha.

Veredicto: **apto para uso personal con las correcciones P0/P1 de la sección 6**, no listo para exponer públicamente sin autenticación en `/estado` ni para distribución masiva sin resolver el almacenamiento de credenciales.

---

## 2. Metodología

La auditoría se guió por marcos publicados, no por impresiones:

- **OWASP Secure Code Review Cheat Sheet** y **OWASP Code Review Guide v2**: arquitectura → puntos de entrada/validación → autenticación → trazado de flujo de datos → lógica de negocio → dependencias.
- **NCSC — produce clean & maintainable code**: revisión por checklists, código autodocumentado, dependencias externas.
- **Checklist de sesgos de backtesting** (QuantStart, CFA Institute, LuxAlgo, guías de walk-forward): look-ahead, survivorship, optimisation/data-snooping, costes, tamaño de muestra, validación fuera de muestra, robustez por régimen.
- Herramientas: revisión manual línea a línea, `node --check` de todos los módulos, ejecución de tests, inyección de frames cifrados sintéticos al parser real, barrido comparativo Node vs PWA, y estadística independiente sobre `senales.csv` con Node.

No se ejecutó SAST comercial (Semgrep/CodeQL): el proyecto no lo tiene configurado y su instalación excede el alcance. Se suple con búsqueda dirigida de patrones (`eval`, secretos, `innerHTML`, manejo de errores vacío) que se documenta en los hallazgos.

---

## 3. Verificaciones ejecutadas (evidencia real, no supuesta)

| # | Verificación | Resultado |
|---|---|---|
| 1 | `node motor-senales/test_estrategia.js` | **16/16 checks OK**, exit 0 |
| 2 | Sintaxis de `pwa/proto.js`, `motor.js`, `app.js`, `sw.js` | OK (sin errores de parseo) |
| 3 | Parser PWA alimentado con frames AES-CBC reales (ticks cmd 8, velas cmd 11) | 2/2 ticks con valores exactos; velas: 1 válida + 1 corrupta descartada; `t`/OHLC correctos |
| 4 | Paridad motor Node (`motor-senales/estrategia.js`) vs PWA (`pwa/motor.js`), serie sintética de 60 días con semilla fija | **91/91 eventos idénticos** (zona/toque/señal/tn, campo a campo) y `resumen()` idéntico (sesgo, ATR, 26 zonas activas, 300/400/600 velas) |
| 5 | IDs de la UI: 21 `id` de `index.html` vs referencias en `app.js` | 0 desacuerdos |
| 6 | Shell del service worker vs ficheros reales en `pwa/` | Completo (los 9 recursos de runtime existen) |
| 7 | `.gitignore` | `.env` y `.env.*` excluidos, `.env.ejemplo` permitido |
| 8 | Búsqueda de secretos duros en `.js/.md/.json/.sh` | 0 reales; solo placeholders en documentación |
| 9 | Estadística independiente de `backtest_raptor/senales.csv` (3.341 filas) | WR 45,7 %; netR 481,30; expectativa 0,1441; sd 1,272; **t = 6,55**; IC95 % 0,1009–0,1872; WR equilibrio 39,9 %; **0 inconsistencias** netR↔rr en ganadas y netR = −1 en todas las perdidas |

> El script usado en (3) y (4) fue temporal y se eliminó al terminar, para no añadir artefactos no pedidos. Su contenido está descrito en la sección 5 (M5) y puede convertirse en test permanente si se desea.

---

## 4. Arquitectura y flujo de datos (mapa de la revisión)

```
Weltrade WSS  ──►  conector/conector.js        (Node, CLI, ticks → stdout JSON)
              ├──►  motor-senales/cliente_mt5.js (Node, motor de señales + HTTP /salud,/estado)
              └──►  pwa/proto.js                (navegador, WebCrypto AES-CBC)
                        │
                        ├──► pwa/motor.js        (estrategia portada)
                        └──► pwa/app.js          (UI, localStorage, Wake Lock, Telegram, notificaciones)
                                  └──► pwa/sw.js (shell offline + notificationclick)
```

Capas auditadas y su valoración:

| Capa | Estado | Comentario |
|---|---|---|
| Protocolo/cripto | 🟢 Sólido | Offsets verificados por inyección de frames; AES-CBC con IV cero y clave de sesión de 32 B; padding PKCS#7 equivalente entre Node y WebCrypto |
| Motor de estrategia | 🟢 Equivalente | Paridad total Node↔PWA; lógica determinista sobre velas cerradas, sin look-ahead por construcción |
| Backtest | 🟢 Metodológicamente honesto | Walk-forward pre-registrado, ambigüedad contada como pérdida, spread real medido; imprecisión de ficha en el RR |
| PWA | 🟡 Correcta con deudas | Seguridad de estado en localStorage, versionado manual de caché |
| Servidor auxiliar | 🟡 Correcto | `/estado` sin autenticación |
| Credenciales/secretos | 🟡 Aceptable | Nada en git; el problema es el almacenamiento en el dispositivo |
| Documentación | 🟢 Buena | LEEME operativos, dossier REA y guía Ghidra coherentes con el código |

---

## 5. Hallazgos por severidad

### 5.1 MEDIA (6)

**M1 — Credenciales del bróker y token de Telegram en `localStorage` sin cifrar**
`pwa/app.js` (`leerConfig`/`guardarConfig`, clave `wt_config`).
Cualquier acceso al teléfono desbloqueado, o un XSS futuro en el origen, lee cuenta y contraseña MT5 en claro. Está advertido en `LEEME-pwa.md` y es un compromiso consciente del diseño "sin backend".
*Mitigación barata:* usar `sessionStorage` por defecto, casilla "recordar en este dispositivo" para persistir, y recomendar un bot de Telegram dedicado exclusivamente a esto (nunca el bot personal).

**M2 — Caché del service worker versionada a mano**
`pwa/sw.js:10` → `const CACHE = 'wt-pwa-v1'`.
El shell se sirve cache-first. Si en el futuro se cambia `proto.js`, `motor.js` o el HTML y no se incrementa la versión, los usuarios con la PWA instalada siguen con el código viejo **indefinidamente** (la comprobación de actualización del SW no invalida la caché estática). Es el fallo clásico de las PWA y aquí el riesgo es funcional: offsets de protocolo desincronizados.
*Mitigación:* generar la versión en build (hash del contenido o `Date.now()` inyectado) o, como mínimo, un paso documentado en `LEEME-pwa.md` que obligue a cambiar `v1` en cada release.

**M3 — Clave de sesión sin validación de longitud**
`pwa/proto.js:134` → `this.clave = p.body.slice(66, 98);` (idéntico en `conector/conector.js` y `motor-senales/cliente_mt5.js`).
Si el frame de handshake (cmd 0) no trae 32 B desde el offset 66, `slice` devuelve menos bytes. En Node, `createCipheriv` lanza (clave de longitud inválida); en la PWA, `importKey` rechaza. Ambos errores se producen dentro de un `try` que los **traga en silencio**, así que el síntoma es "conectado pero no llega nada", sin log ni cierre.
*Mitigación:* `if (this.clave.length !== 32) { log('handshake inválido'); this.cerrar(); return; }` en los tres clientes.

**M4 — Reintento infinito con credenciales inválidas**
`pwa/app.js` (backoff en `programarReconexion`) y `conector/conector.js` (reintento a 3 s tras `dd ≠ 0`).
El login rechazado se trata igual que una caída de red: reintenta para siempre. No hay contador, no hay estado terminal y no hay aviso distinto al usuario. Además, contra un servidor que limita intentos, esto puede agravar el bloqueo.
*Mitigación:* máximo 3–5 intentos consecutivos de login rechazado, chip "credenciales rechazadas" y parada hasta acción manual; el backoff se reserva a fallos de transporte.

**M5 — Sin test automatizado del parser de protocolo**
El repositorio solo tiene `motor-senales/test_estrategia.js` (lógica de estrategia). Login (912 B), catálogo (526 B/registro), ticks (50 B) y velas (48 B) no tienen prueba propia; cualquier refactor de offsets puede romper en silencio y solo se detecta en vivo.
*Mitigación:* hacer permanente la verificación de esta auditoría — construir frames AES-CBC sintéticos, inyectarlos a `_onMensaje` y comparar valores — como `test_protocolo.mjs` en CI. Es exactamente el patrón que usó el script temporal (sección 3, pruebas 3 y 4).

**M6 — `/estado` sin autenticación**
`motor-senales/servidor.js` (rutas `/salud` y `/estado`).
En local no importa; desplegado en Render (URL pública), cualquiera puede leer símbolos, sesgo, zonas activas y últimas señales — y usar `/salud` para mantener el servicio despierto. No expone credenciales, pero sí propiedad intelectual y estado operativo.
*Mitigación:* token opcional por query/header (`ESTADO_TOKEN`), o bind a `127.0.0.1` cuando no haya proxy delante.

### 5.2 BAJA (10)

**B1 — Huella del login en UTF-16LE en la PWA, UTF-8 en Node**
`pwa/proto.js:61`: `crypto.subtle.digest('SHA-1', utf16le(\`termux;${login};${Date.now()}\`))`, frente a `sha1.update(...)` (UTF-8) en los clientes Node. El campo **no se valida en el servidor** (documentado en `wt_bisect`/`wt_verify`), así que el impacto es nulo; se anota por fidelidad del portaje y porque es la primera divergencia real entre raíles (ver B2).

**B2 — Duplicación de ~70 % del protocolo en tres ficheros**
`conector/conector.js`, `motor-senales/cliente_mt5.js` y `pwa/proto.js` repiten cripto, login, parseo de catálogo/ticks/velas y construcción de frames. Ya produjo una divergencia (B1). Tres copias mantenidas a mano es el patrón que garantiza que la próxima también aparezca.
*Mitigación:* un módulo fuente único del que se derive la variante navegador (la diferencia real es solo Node `crypto`/`ws` vs WebCrypto/`WebSocket`), o al menos un test cruzado que compare constantes y offsets.

**B3 — "R fijo ≈ 2" es nominal; el realizado es 1,50**
`backtest_raptor/reporte.md` afirma "SL=1×ATR, TP=2×ATR (R fijo ≈ 2)". En el CSV, `rr` varía 0,82–3,78 y la ganadora media rinde **1,50 R**, porque el SL se sitúa en `nivel ∓ 1×ATR` mientras la entrada es el cierre M5 (a distancia variable del nivel). La aritmética es **coherente** (netR = rr en ganadas, −1 en perdidas, 0 inconsistencias), pero la ficha induce a sobreestimar el RR.
*Nota (sin acción — backtest congelado):* al leer el informe debe entenderse "RR nominal 2, realizado medio 1,50 (0,82–3,78); WR de equilibrio 39,9 %". Con el WR observado (45,7 %) el margen sobre equilibrio es de ~5,8 puntos, no de ~12. No se edita el backtest: se usa como referencia y esta precisión evita sobreestimar el margen.

**B4 — Backtest sin comisión ni deslizamiento**
Solo se modela spread (medido en vivo y estresado a 3× con break-even a 6,9–9,9×). En índices sintéticos el deslizamiento es bajo y el argumento del informe es defendible, pero la comisión de Weltrade no está en el modelo: se asume coste 0 además del spread. Queda como supuesto declarado; **no se modifica el backtest** (congelado).

**B5 — Un solo año de historia**
Ventana 2025-11-22 → 2026-11-05, un régimen macro. La estabilidad mensual (0 meses negativos con coste 1×) es buena señal, pero 13 meses no cubren un ciclo de volatilidad completo. **No se amplía**: el backtest queda congelado; esta limitación solo acota cuánto peso darle a sus cifras.

**B6 — "Ambigua 0" en 3.341 señales: verificar que la ruta existe**
La regla conservadora (TP y SL en la misma vela M5 = pérdida) está implementada y el contador da 0. Es plausible (TP a 2×ATR y SL a 1×ATR rara vez caben en una vela M5), pero un contador que nunca se incrementa podría ser código muerto. **No se investiga ni se toca**: el backtest está congelado y esto no afecta al camino de señales en vivo. Se deja constancia de que, si fuera código muerto, el sesgo del backtest sería *optimista*, no pesimista.

**B7 — `stats.reconexiones` cuenta también cierres manuales**
`pwa/app.js:166`. El panel puede sugerir inestabilidad de red cuando el usuario pulsó "Desconectar". Cosmético, pero engaña en la lectura de salud.

**B8 — Sin metadatos de instalación iOS**
Falta `apple-mobile-web-app-capable` y `apple-touch-icon` en `index.html`. El objetivo declarado es Android, así que es aceptable; se anota para que no se interprete como soporte iOS.

**B9 — `weltrade-conector-termux.zip` duplica `conector/`**
ZIP en la raíz con 5 ficheros que ya existen como código vivo. Un ZIP versionado a mano es deuda: se desactualiza y alguien lo instalará pensando que es lo último. Regenerarlo en release (o eliminarlo y dejar que se genere desde `conector/`).

**B10 — `instalar.sh` copia sin verificar integridad**
Copia `conector.js` a `$HOME/weltrade-conector` y `.env.ejemplo` → `.env` con `set -e`. Correcto para instalación manual, pero publicar un `sha256` de `conector.js` cerraría la cadena de confianza en un proyecto que maneja credenciales de bróker.

### 5.3 INFORMATIVO (6)

**I1 — IV cero, AES-CBC y clave estática ofuscada son el protocolo del servidor, no una elección local.**
La confidencialidad real depende de WSS/TLS. La clave estática sirve para el handshake y se sustituye por la de sesión. No es una vulnerabilidad introducida por el proyecto, pero tampoco debe presentarse como cifrado fuerte.

**I2 — El servidor no autentica al cliente más allá del login.**
Handshake con 64 ceros y huella SHA-1 no validada (comprobado en `wt_bisect`/`wt_verify`). Implica que cualquiera con el protocolo puede abrir sesión con credenciales válidas; no hay nada que proteger en el canal más allá del TLS.

**I3 — El score duplica requisitos.**
`sesgo +25` y `vela direccional +10` son condiciones ya exigidas para emitir; el mínimo efectivo es 55 (LATE con fuerza 1) y el umbral 60 solo recorta esa esquina. Está documentado en el comentario del código y no requiere acción: es una fórmula de presentación, no un filtro adicional.

**I4 — El riesgo operativo real es psicológico.**
Racha perdedora máxima 15–17 y duración mediana 80 min con expectativa 0,144 R: el sistema es matemáticamente positivo y conductualmente incómodo. Cualquier plan de uso debe incluir límite de pérdida diaria y tamaño de posición, no solo la señal.

**I5 — El portaje PWA se verificó, no se asumió.**
91/91 eventos idénticos y `resumen()` idéntico es la evidencia de que `motor.js` no es una reimplementación aproximada. Mantener esa disciplina en futuros cambios evita el fallo típico de "el motor del navegador da otras señales".

**I6 — El mejor hallazgo del backtest es una decisión de no hacer.**
`reporte_gatillo.md` y `reporte_empine.md` documentan hipótesis plausibles, criterios escritos antes de mirar resultados y su rechazo al no sostenerse en OUT. Eso es exactamente lo contrario del data-snooping, y es lo que hace creíble el 45,7 % de WR restante.

---

## 6. Recomendaciones priorizadas

**P0 — antes de usar con dinero real**
1. M4: cortar el bucle de reintento con credenciales rechazadas y mostrar estado terminal. (Evita bloqueos de cuenta y confusión.)
2. M3: guard de 32 B en la clave de sesión con log y cierre. (Convierte un fallo mudo en diagnosticable.)
3. Verificar en vivo, una sola vez y con cuenta demo, que el WSS de la PWA es aceptado con el header `Origin` del navegador. Es la única incógnita funcional que la auditoría no pudo cerrar (no hay cuenta ni dominio HTTPS en este entorno).

**P1 — antes de dejar la PWA instalada como herramienta diaria**
4. M2: versionado de caché automático o ritual documentado de bump.
5. M1: `sessionStorage` por defecto + casilla de recordar; bot de Telegram dedicado.
6. M5: test permanente del parser de protocolo (login/ticks/catálogo/velas) + paridad Node↔PWA en CI.

**P2 — higiene**
7. M6: token en `/estado`.
8. B1/B2: módulo de protocolo único o test cruzado de constantes.
9. B3/B4/B5/B6: **no se toca el backtest** (congelado por decisión del usuario; su único cometido es generar señales). Se leen sus cifras con las precisiones de la sección 5.2, nada más.
10. B7–B10: contador de reconexiones, metadatos iOS, ZIP, checksum del instalador.

---

## 7. Riesgos aceptados y límites de esta auditoría

- **No se probó la conexión real PWA↔Weltrade** (sin cuenta activa ni origen HTTPS). Riesgo concreto: rechazo del header `Origin` o de un origen no registrado. Ya advertido en `LEEME-pwa.md`.
- **No se auditó el servidor de Weltrade** ni la legalidad/ToS del acceso por protocolo reverso: fuera del alcance técnico y con implicaciones que corresponden al usuario.
- **No se ejecutó SAST/DAST comercial**; la revisión fue manual dirigida más las pruebas descritas en la sección 3.
- **Los informes de backtest se auditaron como documentos y contra el CSV**, en modo solo lectura: no se re-ejecutó el motor de backtest ni se modificó ningún fichero de `backtest_raptor/`. El backtest queda congelado y su única función es servir de referencia a la generación de señales.
- **`.env` reales no se leyeron** (política del entorno): se verificó que están ignorados por git y que no hay secretos en el código.

---

## 8. Anexo — tabla de protocolo verificada

| Elemento | Layout comprobado | Dónde |
|---|---|---|
| Frame | `[len:u32 LE][flags:u32 LE=1][AES-CBC(payload)]` | los 3 clientes |
| Handshake | cmd 0, 64 ceros → clave de sesión en `body[66..98]` | `proto.js:134` |
| Login | 912 B: pass UTF-16LE @4, huella @196, host len u32 @476, host UTF-16LE @480, cuenta u32 @736 | Node (verificado con frames) |
| Catálogo | cmd 6, registro 526 B: nombre UTF-16 @0..64, id u32 @196 | los 3 clientes |
| Ticks | cmd 8, registro 50 B: id u32 @0, bid f64 @12, ask f64 @20, ÷100 | `proto.js` inyectado ✅ |
| Velas | cmd 11, packet 78 B: símbolo @4..64, periodo u16 @68, desde u32 @70, hasta u32 @74; respuesta registro 48 B: t u32 + o/h/l/c f64 + vol + flags | `proto.js` inyectado ✅ |
| Ping | cmd 51 cada 8 s | los 3 clientes |

---

*Auditoría realizada con revisión manual + pruebas ejecutadas sobre el repositorio en `main`, 8 commits, sin cambios en el código de producción salvo este informe.*

---

## 9. Correcciones aplicadas (2026-11-08)

Todas las correcciones P0/P1/P2 están implementadas y verificadas (suite completa en verde: `test_estrategia` 16/16 + `test_importador` + `test_protocolo` 50/50; verificación funcional de `/estado` con token 8/8).

| Hallazgo | Corrección aplicada | Ficheros |
|---|---|---|
| **M3** clave de sesión sin validar | Guard `length !== 32` con aviso y cierre limpio en los 3 clientes (antes: fallo mudo dentro de un try) | `pwa/proto.js`, `conector/conector.js`, `motor-senales/cliente_mt5.js` |
| **M4** reintento infinito con credenciales inválidas | El login rechazado es terminal: el conector sale con error; el motor de señales para sin reconexión; la PWA cuenta rechazos (máx. 3) y exige acción manual. El backoff queda reservado a fallos de transporte. Nuevo evento `login_rechazado` | `conector.js`, `cliente_mt5.js`, `motor-senales/app.js`, `pwa/proto.js`, `pwa/app.js` |
| **M1** credenciales en `localStorage` sin cifrar | Por defecto viven en `sessionStorage` (mueren al cerrar la app); casilla «Recordar en este dispositivo» para persistir (opcional, explícita). Migración automática de configs antiguas a sesión | `pwa/app.js`, `pwa/index.html` |
| **M2** caché del SW versionada a mano | El nombre de caché se deriva del hash SHA-256 del contenido real de la shell: cualquier cambio produce caché nueva y borra la anterior en `activate`. Ya no hay que bumpar `wt-pwa-vN` | `pwa/sw.js` |
| **M5** sin test del parser de protocolo | `motor-senales/test_protocolo.mjs`: frames AES-CBC sintéticos inyectados al parser real de ambos clientes — handshake válido/inválido, login rechazado, catálogo, ticks, velas, paridad Node↔PWA campo a campo. Incluido en `npm test` | `motor-senales/test_protocolo.mjs` (nuevo), `package.json` |
| **M6** `/estado` sin autenticación | Token opcional `ESTADO_TOKEN`: sin él todo queda abierto (localhost); con él, `/estado`, `/estrategia` y todos los POST exigen token por header `x-estado-token` o query. `/salud` sigue abierta para pingers. El panel arrastra `?token=` automáticamente. Verificado con pruebas 8/8 | `motor-senales/servidor.js`, `motor-senales/ui.html` |
| **B1** huella UTF-16LE en PWA vs UTF-8 en Node | La PWA calcula la huella SHA-1 con `TextEncoder` (UTF-8), idéntica a Node. Queda tripwire en el test | `pwa/proto.js` |
| **B2** protocolo duplicado en 3 ficheros | Mitigación elegida (sin refactor de riesgo): test cruzado que compara las constantes clave (OBF, 912, 526, offsets 66..98, 50, 48, 0x4001) en los 3 clientes, más la paridad de eventos del M5 | `test_protocolo.mjs` |
| **B3–B6** (backtest) | Sin cambios: el backtest sigue congelado como referencia de solo lectura, tal como dicta la auditoría | — |
| **B7** `reconexiones` cuenta cierres manuales | El contador solo suma reconexiones automáticas de transporte | `pwa/app.js` |
| **B8** metadatos iOS | Añadidos `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style` y `apple-mobile-web-app-title` (el `apple-touch-icon` ya existía) | `pwa/index.html` |
| **B9** ZIP duplicado en la raíz | `weltrade-conector-termux.zip` eliminado del repo; `conector/` es la única fuente de verdad (documentado en LEEME) | `conector/LEEME.md`, `README.md` |
| **B10** instalador sin verificación | `instalar.sh` comprueba el sha256 de `conector.js` contra `conector.js.sha256` publicado junto a él; aborta si no coincide (escape `--sin-verificar`) | `conector/instalar.sh`, `conector.js.sha256` (nuevo) |

**Pendiente fuera del código** (requiere entorno en vivo, igual que en la auditoría): la verificación única con cuenta demo de que el WSS acepta el `Origin` del navegador de la PWA (P0.3 de la sección 6).

---

## 10. Auditoría profunda v2 (2026-11-08) — PWA: Telegram, almacenamiento, estabilidad, reconexión, credenciales, datos

Segunda pasada, a demanda del propietario, centrada en la PWA y su operación real en el teléfono. Metodología: lectura línea a línea de los 9 ficheros de `pwa/` y sus espejos Node, trazado de flujo de cada evento (`listo`/`tick`/`cerrar`/`login_rechazado`), simulación de ciclo de vida (congelado de Android, socket medio-abierto, siembra interrumpida) y navegador headless para verificar el panel nuevo. Suite final: **`test_protocolo` 68/68 + `test_estrategia` 16/16 + `test_importador` OK**, más verificación visual del gráfico.

### 10.1 Respuestas directas a las preguntas de la auditoría

**¿Qué activos se descargan al ejecutarse la PWA?** Tres capas:
1. **Catálogo completo (cmd 6)**: una sola vez por sesión, la lista de TODOS los símbolos del servidor (registros de 526 B, ~50 KB). No se guarda en disco: se re-pide en cada conexión.
2. **Suscripción de ticks (cmd 7)**: si escribiste símbolos en Configuración, solo esos (coincidencia exacta, insensible a mayúsculas). Si el campo está vacío, el filtro genérico `^(FX Vol|SFX Vol|Step|Boom|Crash|Range|FlipX|Drift)` — **con tope nuevo de 40 símbolos** (antes: cientos de sintéticos podían agotar la memoria del teléfono; ahora se avisa en el log y se suscriben los primeros 40).
3. **Histórico de velas (cmd 11)** por símbolo suscrito: **H1 45 días (~1.080 velas), M15 22 días (~2.112), M5 11 días (~3.168)** ≈ 300–400 KB por símbolo la primera vez. En reconexiones solo se piden las velas posteriores a la última guardada (incremental, con un reintento único si vuelve vacía).

**¿Cuántas velas se mantienen guardadas?** Dos niveles con el mismo tope (`MAX_VELAS_TF`): en memoria (búfer del motor) y en IndexedDB: **1.000 H1 + 2.000 M15 + 3.000 M5 = 6.000 velas por símbolo** (~240–350 KB compactadas como arrays `[t,o,h,l,c]`). Con 40 símbolos: ~10–14 MB — dentro de la cuota típica de IndexedDB en Android, y se pide `navigator.storage.persist()` para que el SO no la borre. Las señales: últimas 30 en `localStorage`. El registro de log: 300 líneas en memoria (nada en disco).

**¿Dónde vive cada dato local?** (tabla de almacenamiento)

| Dato | Almacén | Clave | Ciclo de vida |
|---|---|---|---|
| Credenciales + Telegram + score | `sessionStorage` (defecto) o `localStorage` (si marcas «Recordar») | `wt_pwa_config_v1` | sesión / persistente |
| Señales recibidas | `localStorage` | `wt_pwa_senales_v1` | últimas 30, para siempre |
| Histórico de velas | IndexedDB `wt_pwa_velas` → almacén `velas` | `SIMBOLO\|TF` | recortado a 6.000/símbolo |
| Shell de la app (offline) | Cache Storage `wt-pwa-<hash>` | auto-versionada por SHA-256 | se renueva sola al cambiar cualquier fichero |
| Zonas/sesgo/ATR | solo memoria | — | se reconstruyen de las velas al arrancar |

NUEVO: botón **«Borrar datos locales»** en Configuración: vacía de una vez credenciales, señales e IndexedDB de velas (útil para vender/cambiar el teléfono o tras cambiar de bot de Telegram).

**Credenciales de la cuenta demo (login Weltrade)**: el cuerpo de login de 912 B manda contraseña UTF-16LE @4, huella SHA-1 @196 (no validada), servidor @480 y cuenta @736 sobre el canal ya cifrado AES-256-CBC con clave de sesión. La contraseña **no se loguea nunca** (`scrub` acorta todo token/secret de los avisos) y **no sale del dispositivo**: solo al WSS de Weltrade; el token de Telegram solo a `api.telegram.org`. Riesgo residual aceptado y documentado: credenciales en almacenamiento del navegador si marcas «Recordar» (cualquier XSS las leería; no hay XSS conocido — todas las inserciones DOM usan `textContent` o escape). Recomendación vigente: usar cuenta **demo**, no marcar «Recordar» en teléfonos compartidos, y rotar el token del bot si se pegó en algún chat.

**Señales a Telegram — qué se manda y fiabilidad**: el mensaje HTML contiene lado, símbolo, fase, sesgo H1, nivel de zona, precio, SL/TP (±1×ATR / ±2×ATR), motivo y **ahora también la hora UTC**. Hallazgos corregidos: (a) sin timeout, un Telegram colgado dejaba la señal en el limbo → **AbortController 10 s**; (b) sin reintento → **1 reintento** que respeta `retry_after` de los 429 y espera 2 s en errores 5xx/red; (c) símbolo con `<`, `>`, `&` del catálogo rompía el `parse_mode=HTML` con 400 y la señal **nunca llegaba** → **escape HTML** de todos los campos dinámicos (test permanente).

**Estabilidad / falta de conexión / reintentos** — el hallazgo más grave de esta segunda pasada era un **bucle de reconexiones**: `cerrar()` era capaz de emitir el evento `cerrar` **dos veces** (muerte de red + `cerrar()` explícito + `onclose` tardío) y cada emit agendaba su propio temporizador de reconexión → conexiones creadas y asesinadas cada ~3 s con contador de reconexiones disparado. Corregido de raíz en los 3 clientes (`_cerrar()` idempotente) y con un único temporizador de reconexión en la UI. Además:

| Defensa | Antes | Ahora |
|---|---|---|
| Socket medio-abierto (Android congela la app, NAT cae) | nadie lo detectaba: chip «listo» muerto para siempre | ping cada 8 s comprueba recepción; **25 s sin NADA → cierre y backoff** |
| App vuelve del congelamiento sin datos | esperaba al primer fallo real | `visibilitychange`: sin datos frescos 15 s → reconexión inmediata |
| Watchdog en primer plano | no existía | 45 s sin ticks con sesión «listo» → reconexión forzada |
| TCP colgado a medio abrir | la etapa quedaba «conectando» eterna | timeout de 20 s: si no hay sesión completa, corta y reintenta |
| Reconexión doble | 2 emits × 2 handlers | 1 emit idempotente + 1 handler + 1 temporizador |
| Login rechazado | (v1) máx. 3 intentos y para | igual, se mantiene |
| Errores silenciosos | excepciones sin rastro en el teléfono | `unhandledrejection`/`error` caen al registro visible |

**Vela en formación (hallazgo de corrección de datos)**: el servidor manda la vela viva al final del histórico (cmd 11). Sin quitarla, quedaba **congelada para siempre** con su cierre parcial: bloqueaba el cierre real (mismo `t` en `onVelaCerrada`), envenenaba el barrido TN y el escaneo de pivotes, y se **persistía corrupta en IndexedDB**, sobreviviendo a reinicios. Corregido en los dos motores (`setHistoria` recorta la vela viva) y en la siembra PWA (se recorta antes de unir y guardar). Test permanente añadido.

**cmd 11 sin identificación de símbolo (hallazgo latente)**: la respuesta no trae el símbolo y el reparto va a TODOS los pendientes; dos peticiones solapadas habrían mezclado velas de símbolos distintos (corrupción silenciosa del histórico). Hoy solo hay una petición en vuelo por diseño secuencial, pero quedó **serializada por promesa-cola** con ventana de silencio tras cada timeout, para que siga siendo imposible aunque el código cambie.

**PWA general**: `manifest.json` correcto (standalone, iconos 192/512/maskable/SVG); service worker auto-versionado por hash — **añadidos a la shell** `velas_canvas.js` e `icono-512.png`;Wake Lock con re-adquisición al volver a visible; notificaciones locales vía SW controller con fallback a `new Notification`.

### 10.2 Panel de velas en `<canvas>` (funcionalidad nueva)

Reivindicado en «Siguientes pasos» del LEEME y pedido explícitamente. Implementación **sin librerías y sin red** (`pwa/velas_canvas.js`, clase `PanelVelas`):

- Velas M5/M15/H1 del símbolo elegido (selector poblado al conectar) + **vela en formación** semitransparente con borde punteado, reconstruida de ticks en vivo.
- **Zonas activas del motor** dibujadas: soporte verde / resistencia roja punteadas con su fuerza; marcadores ▲/▼ de las últimas señales del símbolo con su score; línea punteada del último precio con etiqueta en el eje.
- Gestos táctiles: arrastrar = desplazar al pasado, pellizco = zoom (anclado a la vela bajo los dedos), **doble toque = volver al presente**; en escritorio rueda = zoom y crosshair con OHLC de la vela apuntada.
- Nitidez por `devicePixelRatio`, render bajo `requestAnimationFrame` solo cuando cambian datos o vista (0 % CPU en reposo), `touch-action: none` solo en el canvas.
- Refresco cada 2 s con el mismo latido de la UI y tras cada siembra. Verificado en navegador headless con datos sintéticos: vista en vivo, zoom, y viaje al pasado con escala correcta.

### 10.3 Correcciones aplicadas en esta pasada v2

| # | Hallazgo | Severidad | Corrección | Ficheros |
|---|---|---|---|---|
| V2-1 | Doble emisión de `cerrar` → bucle de reconexiones cada ~3 s | **alta** | `_cerrar()` idempotente + un solo temporizador; handler único en Node | `pwa/proto.js`, `motor-senales/cliente_mt5.js`, `pwa/app.js`, `motor-senales/app.js` |
| V2-2 | Socket medio-abierto indetectable (app congelada) | **alta** | watchdog de recepción (25 s), reconexión al volver visible (15 s), watchdog de ticks (45 s), timeout de apertura (20 s) | ambos clientes, `pwa/app.js` |
| V2-3 | Vela en formación congelada y persistida corrupta | **alta** | recorte en `setHistoria` (ambos motores) y antes de unir/guardar (PWA); test permanente | `pwa/motor.js`, `motor-senales/estrategia.js`, `pwa/app.js`, `test_protocolo.mjs` |
| V2-4 | Telegram sin timeout/reintento; HTML sin escapar | media | AbortController 10 s, reintento con `retry_after`, escape HTML, hora UTC; test permanente | `pwa/motor.js`, `motor-senales/telegram.js` |
| V2-5 | cmd 11 reparte a todos los pendientes (corrupción latente) | media | peticiones serializadas + ventana de silencio tras timeout | ambos clientes |
| V2-6 | `sembrar()` con `TypeError` mudo si el motor se apaga a mitad | media | guard `sembraViva()` tras cada `await` | `pwa/app.js` |
| V2-7 | Node re-descargaba TODO el histórico en cada reconexión | media | re-sembrado incremental con `historia()` + fusión (paridad con la PWA) | `motor-senales/app.js`, `motor-senales/estrategia.js` |
| V2-8 | Sin tope de símbolos con el filtro genérico (memoria del teléfono) | media | tope 40 en la suscripción con aviso en el log | `pwa/proto.js`, `pwa/app.js` |
| V2-9 | Comparación de `ESTADO_TOKEN` con timing lateral | baja | `crypto.timingSafeEqual` | `motor-senales/servidor.js` |
| V2-10 | Errores JS sin rastro en el teléfono | baja | handlers globales → registro visible | `pwa/app.js` |
| V2-11 | Shell del SW incompleta para offline total | baja | añadidos `velas_canvas.js` e `icono-512.png` | `pwa/sw.js` |
| V2-12 | Sin forma de vaciar datos locales | baja | botón «Borrar datos locales» (credenciales + señales + IndexedDB) | `pwa/index.html`, `pwa/app.js`, `pwa/velas_db.js` |

Suite final: `node test_protocolo.mjs` → **68 OK / 0 fallos** (incluye los 18 checks nuevos de esta pasada), `test_estrategia` 16/16, `test_importador` OK; `node --check` limpio en los 13 módulos; panel verificado visualmente en navegador headless (vivo, zoom, pasado).

### 10.4 Límites que siguen abiertos (honestidad operativa)

1. **Verificación con cuenta demo real** de que el WSS acepta el `Origin` del hosting de la PWA (sigue siendo el único riesgo de protocolo no reproducible sin red).
2. Android puede matar el proceso del navegador con la app en segundo plano prolongado: el Wake Lock cubre pantalla encendida; para 24/7 real sigue recomendándose el motor Node en Render + pinger.
3. Las respuestas tardías de cmd 11 que lleguen después de la ventana de silencio (1,5 s tras un timeout) serían atribuidas a la petición siguiente — estadísticamente despreciable (el servidor responde en <1 s), documentada por transparencia.
