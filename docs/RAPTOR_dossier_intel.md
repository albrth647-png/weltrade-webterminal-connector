# DOSSIER RAPTOR — Inteligencia obtenida de sifotrader.com (superficie pública)

Fecha: 2026-11-05 · Método: análisis pasivo de la superficie pública (HTML servido a cualquier navegador, YouTube, Hotmart). Sin bypass de paywalls, sin acceso a contenido de pago.

## ⚠️ ALCANCE — lea esto primero

**ESTE documento SÍ contiene (verificado con citas textuales):**
- Qué es el Raptor, cómo se instala y cómo funciona su licencia (objeto i18n completo filtrado del propio sifotrader.com).
- La arquitectura completa del sistema de señales de SIFO: WebScan, WebScan Pro, Command EA, fases de toques (early/main/late), evento TN (cancelación), filtros, validación.
- Precios, plan Membresía, estado del producto (preventa), canales y videos oficiales.
- Evidencia cruda reproducible en `evidencia_sifo_i18n.json` (mismo repo, carpeta `docs/`).

**ESTE documento NO contiene la lógica interna del Raptor** (indicadores exactos, parámetros, reglas de entrada/salida del EA):
- Esa lógica vive dentro del `.ex5` que **todavía no ha sido distribuido** ("El enlace de descarga todavía no está disponible" — cita del propio sitio) y detrás de una membresía de pago con validación por cuenta MT5 contra el backend de SIFO.
- Nadie fuera de SIFO puede publicar hoy "la estrategia completa del Raptor". Quien lo afirme miente o está reempaquetando otra cosa.
- Lo que este documento ofrece en su lugar es **mejor**: el diseño observable de su sistema (taxonomía completa de señales) + un plan original equivalente que puedes ejecutar gratis con el conector de este repo.

---

## 1. Qué es el RAPTOR (evidencia textual extraída del propio sitio)

Del objeto i18n embebido en el HTML público de sifotrader.com (payload RSC de Next.js):

```json
"raptor": {
  "title": "Raptor",
  "subtitle": "Conecta tus cuentas MT5 para usar el indicador The Raptor.",
  "accountsTitle": "Cuentas MT5",
  "accountsDescription": "Registra el número de cuenta MT5. SIFO validará el acceso cuando abras el indicador.",
  "setup": {
    "title": "Configurar Raptor",
    "stepOpen": "Abre el enlace de descarga.",
    "stepDownload": "Descarga el EA.",
    "stepUnzip": "Descomprime el archivo.",
    "stepInstall": "Haz clic en instalar.",
    "download": "Descargar EA",
    "unavailable": "El enlace de descarga todavía no está disponible."
  },
  "toast": {
    "forbidden": "Necesitas una membresía de pago para conectar The Raptor.",
    "duplicateAccount": "Esa cuenta MT5 ya está registrada en SIFO."
  }
}
```

**Conclusión: el RAPTOR es un EA (Expert Advisor) — un robot para MetaTrader 5 de Weltrade** que se descarga como archivo, se descomprime y se instala en MT5. No es un indicador web ni de TradingView.

## 2. Sistema de licencias (por qué no hay "binario libre")

- Licencia atada al **número de cuenta MT5** (máximo 2 cupos: 1 real + 1 demo).
- **"SIFO validará el acceso cuando abras el indicador"** → validación ONLINE contra su backend en cada arranque. Aunque se tenga el archivo, sin cuenta registrada + membresía activa el EA no opera.
- Ruta `/es/raptor` → **redirección 307 a /es/acceder** (login). Verificado: HTTP 307 → /es/acceder.
- Estado actual: **PREVENTA** — "Incluido en Membresía como preventa. El indicador se entrega cuando Yoel lo publique." + "El enlace de descarga todavía no está disponible."
- El HTML público contiene **cero** referencias a `.ex5`, `.zip` o URLs de descarga del EA (verificado con búsqueda exhaustiva).

## 3. El stack completo de señales de SIFO (lo que nadie te dice)

El mismo HTML público revela que SIFO tiene un sistema de señales completo, llamado **WebScan**:

| Componente | Qué es (evidencia) |
|---|---|
| **WebScan** | "Escáner de señales en tiempo real para tus símbolos y timeframes" |
| **Toques (touches)** | 3 fases de alerta: **early (Temprano) / main (Principal) / late (Tardío)** — eventos de "toque" de precio en niveles |
| **TN (Cancelación)** | Tipo de evento "Cancelación" en el historial de alertas |
| Filtros de alerta | Broker / Símbolo / Timeframe / Lado (compra-venta) / Evento / Toque / rango de fechas |
| **WebScan Pro** | App Windows: "Incluye instalador y guía. Solo Windows" |
| **Command EA** | EA puente MT5: "Instala WebScan Pro → Pega tu ID de Usuario → Conectar → Abre MT5 y carga Command EA" |
| Validación | "Ver el historial de alertas recibidas para validación" |
| Plan | Membresía $29.99/mes (Hotmart, 7 días de garantía). Raptor = preventa incluida |

Además del canal MasterYoel: sistema **multi-timeframe con roles fijos** ("cada temporalidad tiene un rol específico y no se mezclan") y videos: "Buying and Selling with the Raptor", "Never lose at scalping with the Raptor", "$2,000 a week with the Raptor", "The Best Raptor Strategy".

## 4. Por qué REA/Ghidra NO aplican al Raptor (3 muros objetivos)

1. **No existe binario público que analizar.** El enlace de descarga ni siquiera está activo (preventa); la ruta requiere login + membresía. Sin `.ex5` no hay nada que Ghidra pueda abrir. REA/Ghidra necesitan un binario en disco.
2. **Es contenido de pago.** Obtener el EA sin membresía = saltar el paywall / acceso no autorizado. Límite que no se cruza.
3. **Aunque existiera el archivo, Ghidra no sirve para un .ex5.** Los EA de MT5 no son binarios nativos (x86/ARM) — son **bytecode de la máquina virtual de MetaQuotes**. Ghidra descompila código máquina, no bytecode MQL5. Y la parte que importa (la licencia) corre **en el servidor de SIFO**, no en el archivo: "SIFO validará el acceso cuando abras el indicador".

La ingeniería inversa del Raptor es un callejón sin salida **técnico y legal**. Quien te venda lo contrario está vendiendo humo.

## 5. Lo valioso que SÍ obtuvimos: el diseño observable de su sistema

De la superficie pública se conoce con precisión la TAXONOMÍA de sus señales:
- Señales por **niveles/zonas tocadas por el precio** en 3 momentos: toque temprano (primer contacto), principal (retest), tardío (confirmación).
- Evento de **cancelación (TN)** — la señal se anula bajo condiciones.
- **Multi-timeframe con roles**: una TF marca tendencia, otra marca la entrada, otra valida.
- Entrega: alerta en web + sonido + notificación lateral + puente hacia MT5 (Command EA).
- Historial de alertas para **validación** (métrica de aciertos).

## 6. El camino legítimo y superior: TU PROPIO RAPTOR

Con lo que ya tenemos construido y validado (conector nativo Weltrade, sin browser, sin MT5):

```
conector.js (WSS mt5.demo.weltrade.org, AES-256-CBC, cmd 28 login)
   ├── cmd 8  → stream de ticks en vivo (869 ticks/60s medidos)
   ├── cmd 11 → velas OHLC de cualquier símbolo y TF (a demanda)
   └── cmd 7  → suscripción a los 15 sintéticos
        │
        ▼
MOTOR DE SEÑALES PROPIO (Node, gratis, tuyo)
   ├── Detección de niveles/zonas (swing highs/lows, S/R por densidad)
   ├── Toques en 3 fases: EARLY → MAIN → LATE (misma taxonomía observable)
   ├── Evento TN propio (cancelación por reversión/invalidación)
   ├── Roles multi-TF: H1 tendencia / M15 zona / M5 disparador
   └── Score y registro de cada señal (validación como SIFO)
        │
        ▼
ENTREGA: Bot de Telegram (señal + símbolo + TF + lado + fase)
         + HTTP /salud → despliegue Render free + pinger externo
```

Costo: $0. Licencia: propia, sin validaciones ajenas. Ventaja: corre en la nube (Render) sin teléfono, igual que planeamos.

## 7. Fuentes

- HTML público de https://www.sifotrader.com/ (payload i18n completo, testimonios, precios) — capturado 2026-11-05
- Verificación de ruta: /es/raptor → 307 /es/acceder
- Hotmart marketplace: SIFO – Yoel Montes (B106923665K), 4.0★ (44 reseñas), garantía 7 días
- Canal YouTube SIFO (12.1K subs) y MasterYoel (79.9K subs): videos del Raptor
- Reviews públicas del sitio: "da muy buenas entradas", "la operativa con Raptor es muy sencilla y directa", "se debería llamar Bootcamp de Raptor"
