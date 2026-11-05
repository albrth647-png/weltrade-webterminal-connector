#!/bin/bash
# Captura del WebTerminal MT5 de Weltrade con REA (navegador + analisis en un mismo comando)
source /home/z/my-project/scripts/env.sh
CHROME=/home/z/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36"

pkill -f 'chrome-linux64/chrome' 2>/dev/null; sleep 1
rm -rf /tmp/chrome-rea4
"$CHROME" --headless=new --no-sandbox --disable-dev-shm-usage --enable-unsafe-swiftshader \
  --disable-blink-features=AutomationControlled --user-agent="$UA" \
  --window-size=1400,900 --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-rea4 \
  "https://mt5.demo.weltrade.org/terminal?theme-mode=1&lang=en" >/tmp/chrome-rea4.log 2>&1 &
CHROME_PID=$!

# Esperar a que la SPA cargue sus chunks
sleep 18
TID=$(curl -s -m 5 http://127.0.0.1:9222/json | python3 -c "
import json,sys
try:
    ts=[t for t in json.load(sys.stdin) if t.get('type')=='page' and 'unsupported' not in t.get('url','')]
    print(ts[0]['id'] if ts else '')
except Exception:
    print('')")
echo "TARGET_ID: $TID"
if [ -z "$TID" ]; then echo "ERROR: sin target del navegador"; tail -5 /tmp/chrome-rea4.log; kill $CHROME_PID 2>/dev/null; exit 1; fi

rea analyze-web-bundle http://127.0.0.1:9222 "$TID" \
  --observation-ms 15000 \
  --analysis-timeout-ms 60000 \
  --total-analysis-timeout-ms 240000 \
  --format json > /home/z/my-project/re/webterminal_bundle.json 2>/tmp/rea-web.err
RC=$?
echo "REA exit=$RC size=$(stat -c %s /home/z/my-project/re/webterminal_bundle.json 2>/dev/null)"
[ -s /tmp/rea-web.err ] && tail -3 /tmp/rea-web.err
kill $CHROME_PID 2>/dev/null
