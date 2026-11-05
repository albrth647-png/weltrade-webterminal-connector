# Guía REA + Ghidra — Ingeniería inversa con agentes de IA

Instalación verificada el 2026-11-05 en Debian 13 (x86_64).

## Qué hay instalado

| Componente | Versión | Ubicación |
|---|---|---|
| REA (`rea-agents`) | 6.8.0 (CLI + servidor MCP, 229 herramientas MCP) | `/home/z/my-project/tools/npm-global` |
| Ghidra | 12.1.4 (línea 12.1.x, la única que REA acepta) | `/home/z/my-project/tools/ghidra` |
| Temurin JDK | 25.0.5 (64-bit, con `javac`) | `/home/z/my-project/tools/jdk-25` |
| Skill de REA para agentes | v49 | `/home/z/.agents/skills/reverse-engineer-anything` (copia persistente: `/home/z/my-project/skills/reverse-engineer-anything`) |
| Script Ghidra de ejemplo | — | `/home/z/my-project/scripts/ghidra_scripts/DecompilarMuestra.java` |

Nota: REA **rechaza** Ghidra 12.2 (solo acepta 12.1.x, verificado con 12.1.4) y exige JDK completo ≥ 21 (aquí se usa 25). El Java 21 del sistema es solo runtime y no sirve para REA.

## 1. Activar el entorno (siempre antes de usar REA o Ghidra)

```bash
source /home/z/my-project/scripts/env.sh
# define: JAVA_HOME, GHIDRA_INSTALL_DIR y PATH (rea, java, analyzeHeadless)
```

## 2. Verificar la instalación

```bash
rea doctor --provider ghidra   # → healthy: true
```

Estado actual verificado: proveedor Ghidra `available: true`, versión 12.1.4, descompilador nativo ELF x86_64 operativo.

## 3. Usar REA desde la CLI

```bash
rea analyze /ruta/binario                      # resumen del objetivo
rea decompile /ruta/binario --procedure main   # pseudocódigo C de una función
rea decompile /ruta/binario 0x401000           # por dirección
rea decompile-all /ruta/binario --out dir      # todas las funciones
rea capabilities                               # capacidades del proveedor activo
rea --help                                     # 175 comandos CLI
```

Cada resultado incluye `evidence_id`, SHA-256 del objetivo y `limitations` (qué se probó y qué no).

### Prueba end-to-end ya ejecutada

`rea decompile /home/z/my-project/scripts/test_binario --procedure suma` devolvió:

```c
int suma(int param_1,int param_2)
{
  return param_2 + param_1;
}
```

## 4. Servidor MCP de REA (para conectar un cliente de IA)

El servidor MCP arranca con stdio: `rea mcp`.

Bloque `mcpServers` para Claude Desktop / Claude Code / Cursor / VS Code / Cline, etc.:

```json
{
  "mcpServers": {
    "rea": {
      "command": "/home/z/my-project/tools/npm-global/bin/rea",
      "args": ["mcp"],
      "env": {
        "GHIDRA_INSTALL_DIR": "/home/z/my-project/tools/ghidra",
        "JAVA_HOME": "/home/z/my-project/tools/jdk-25"
      }
    }
  }
}
```

En esta sandbox no hay cliente MCP instalado, por eso el registro quedó sin crear; cuando instales un cliente aquí, ejecuta:

```bash
rea setup --client vscode        # o claude-code, cursor, codex, gemini-cli...
```

En **tu propia máquina** la forma recomendada es un solo comando (elige tu agente de forma interactiva):

```bash
npx rea-agents setup
```

## 5. Ghidra manual (headless; la GUI necesita pantalla)

En la sandbox no hay entorno gráfico; usa el analizador headless:

```bash
source /home/z/my-project/scripts/env.sh
$GHIDRA_INSTALL_DIR/support/analyzeHeadless \
  /home/z/my-project/tools/ghidra_projects ProyectoMuestra \
  -import /ruta/binario -overwrite \
  -scriptPath /home/z/my-project/scripts/ghidra_scripts \
  -postScript DecompilarMuestra.java
```

El proyecto de prueba `ProyectoMuestra` ya contiene `test_binario` analizado.

## 6. Notas de mantenimiento

- Todo lo instalado vive bajo `/home/z/my-project/tools/` (persistente entre sesiones).
- `~/.agents` y los ajustes de usuario de Ghidra (`~/.ghidra`) se regeneran solos si la sandbox se recicla; `rea setup --skill --yes` reinstala el skill.
- Para actualizar REA: `rea update`. Para actualizar a otra línea de Ghidra, revisa antes `rea doctor` (REA valida la versión).
- REA no instala motores comerciales (IDA, Hopper, Kuna) ni jadx: son opcionales vía `REA_IDA_MCP_CONFIG`, `REA_JADX_MCP_JAR`, etc.
- Uso previsto: investigación de seguridad, interoperabilidad y análisis de software propio o autorizado.
