// Captura COMPLETA de frames WS del WebTerminal (login demo)
const pw = require('/home/z/my-project/tools/npm-global/lib/node_modules/rea-agents/node_modules/playwright-core');
const fs = require('fs');
const EXE = '/home/z/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome';
const URL = 'https://mt5.demo.weltrade.org/terminal?theme-mode=1&lang=en';
const RE = '/home/z/my-project/re';

(async () => {
  const browser = await pw.chromium.launch({
    executablePath: EXE, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--window-size=1400,900'],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const frames = [];
  page.on('websocket', (ws) => {
    console.log('WS ABIERTO:', ws.url());
    let n = 0;
    const handler = (dir) => (f) => {
      n++;
      if (n <= 400) {
        const buf = typeof f.payload === 'string' ? Buffer.from(f.payload, 'utf8') : Buffer.from(f.payload);
        frames.push(`${dir}#${n} ${buf.length}B hex=${buf.toString('hex')}`);
      }
    };
    ws.on('framesent', handler('TX'));
    ws.on('framereceived', handler('RX'));
  });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(10000);
  const login = process.env.WT_LOGIN || '', pass = process.env.WT_PASS || '';
  for (const fr of page.frames()) {
    try {
      await fr.evaluate((lg) => {
        const els = Array.from(document.querySelectorAll('input'));
        const t = els.find((e) => /login|cuenta|account/i.test(e.placeholder || '')) || els.find((e) => e.type !== 'password' && !e.readOnly);
        if (t) { t.value = lg; t.dispatchEvent(new Event('input', { bubbles: true })); }
      }, login);
      await fr.evaluate((ps) => {
        const t = document.querySelector('input[type="password"]');
        if (t) { t.value = ps; t.dispatchEvent(new Event('input', { bubbles: true })); }
      }, pass);
      await fr.evaluate(() => {
        const c = Array.from(document.querySelectorAll('button,[class*="button"],[class*="Button"]')).find((e) => /connect|conectar|login|entrar|ingresar|ok/i.test((e.textContent || '').trim()));
        if (c) c.click();
      });
    } catch (e) {}
  }
  await page.waitForTimeout(20000); // recoger frames de login + quotes
  fs.writeFileSync(`${RE}/ws_frames_full.log`, frames.join('\n'));
  console.log('frames capturados:', frames.length);
  await browser.close();
})().catch((e) => { console.error('FALLO:', e.message); process.exit(1); });
