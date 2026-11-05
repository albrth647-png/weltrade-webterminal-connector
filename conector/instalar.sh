#!/data/data/com.termux/files/usr/bin/bash
# ============================================================
#  Instalador del Conector Weltrade para Termux (Android)
#  Solo necesita Node.js — nada de navegadores ni proot
# ============================================================
set -e
echo "==> Instalando Node.js en Termux..."
pkg update -y && pkg install -y nodejs-lts

DIR="$HOME/weltrade-conector"
echo "==> Instalando conector en $DIR..."
mkdir -p "$DIR"
cp "$(dirname "$0")/conector.js" "$DIR/"
[ -f "$DIR/.env" ] || cp "$(dirname "$0")/.env.ejemplo" "$DIR/.env"

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
