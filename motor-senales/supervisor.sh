#!/usr/bin/env bash
# Supervisor mínimo del motor de señales (sin systemd, válido para Termux/VPS).
#
# Arranque:
#   cd motor-senales
#   setsid nohup ./supervisor.sh >> motor.log 2>&1 < /dev/null & disown
#
# Parada ordenada:
#   touch .supervisor-stop
#   pkill -f "[s]upervisor.sh"
#
# Si el motor termina con código 0 se considera parada intencionada y no se
# relanza. Cualquier otro código (crash, OOM, excepción no capturada) se
# registra y se reintenta a los MS_REINICIO_S segundos (5 por defecto).
set -u
cd "$(dirname "$0")" || exit 1

PARADA=".supervisor-stop"
ESPERA="${MS_REINICIO_S:-5}"

# Arrancar el supervisor es una intención explícita de marcha: se limpia una
# parada anterior para no quedar en bucle de salida inmediata.
rm -f "$PARADA" 2>/dev/null || true

while :; do
  if [ -f "$PARADA" ]; then
    echo "[supervisor] parada solicitada — no se reinicia"
    break
  fi

  node --env-file=.env app.js
  CODIGO=$?

  if [ -f "$PARADA" ]; then
    echo "[supervisor] parada solicitada — no se reinicia"
    break
  fi
  if [ "$CODIGO" -eq 0 ]; then
    echo "[supervisor] el motor terminó con código 0 — parada intencionada"
    break
  fi

  echo "[supervisor] el motor terminó con código $CODIGO — reinicio en ${ESPERA}s"
  sleep "$ESPERA"
done
