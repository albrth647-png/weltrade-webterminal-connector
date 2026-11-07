#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
#  Instalador del Conector Weltrade para Termux (Android)
#  Solo necesita Node.js — nada de navegadores ni proot
# ============================================================
set -e
echo "==> Instalando Node.js en Termux..."
pkg update -y && pkg install -y nodejs-lts

DIR="$HOME/weltrade-conector"
SRC="$(dirname "$0")"

# --- verificación de integridad (B10) -------------------------------------
# conector.js maneja credenciales del bróker: se comprueba su sha256 contra
# el fichero conector.js.sha256 publicado junto a él. Si no coincide, la
# copia está corrupta o manipulada. Escapa con --sin-verificar.
if [ -f "$SRC/conector.js.sha256" ] && command -v sha256sum >/dev/null 2>&1; then
  echo "==> Verificando integridad de conector.js (sha256)..."
  if (cd "$SRC" && sha256sum -c conector.js.sha256 >/dev/null 2>&1); then
    echo "    OK: el checksum coincide."
  elif [ "$1" = "--sin-verificar" ]; then
    echo "!!  Checksum NO coincide, pero continúas con --sin-verificar."
  else
    echo "!!  Checksum NO coincide: conector.js está corrupto o modificado." >&2
    echo "!!  Vuelve a descargar el conector, o repite con: $0 --sin-verificar" >&2
    exit 1
  fi
fi

echo "==> Instalando conector en $DIR..."
mkdir -p "$DIR"
cp "$SRC/conector.js" "$DIR/"
[ -f "$DIR/.env" ] || cp "$SRC/.env.ejemplo" "$DIR/.env"

echo ""
echo "======================================================"
echo " Instalacion completa"
echo "======================================================"
echo " 1. Edita tus credenciales:"
echo "      nano $DIR/.env"
echo " 2. Arranca el conector:"
echo "      cd $DIR && node conector.js"
echo " 3. Para que no se apague con la pantalla:"
echo "      termux-wake-lock"
echo "======================================================"
