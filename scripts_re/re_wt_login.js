// Prueba de conexión al WebTerminal MT5 de Weltrade (cuenta demo/prácticas)
// Credenciales SOLO por variables de entorno: WT_LOGIN, WT_PASS
const pw = require('/home/z/my-project/tools/npm-global/lib/node_modules/rea-agents/node_modules/playwright-core');
const fs = require('fs');

const EXE = '/home/z/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome';
const URL = 'https://mt5.demo.weltrade.org/terminal?theme-mode=1&lang=en';
const RE = '/home/z/my-project/re';

(async () => {
  const browser = await pw.chromium.launch({
    executablePath: EXE,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--window-size=1400,900'],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  // Registro de frames WebSocket (protocolo binario)
  const wsLog = [];
  page.on('websocket', (ws) => {
    console.log('WS ABIERTO:', ws.url());
    let n = 0;
    ws.on('framereceived', (f) => {
      n++;
      if (n <= 40) {
        const buf = typeof f.payload === 'string' ? Buffer.from(f.payload) : Buffer.from(f.payload);
        wsLog.push(`RX#${n} ${buf.length}B head=${buf.subarray(0, 32).toString('hex')}`);
      }
    });
    ws.on('framesent', (f) => {
      n++;
      if (n <= 40) {
        const buf = typeof f.payload === 'string' ? Buffer.from(f.payload) : Buffer.from(f.payload);
        wsLog.push(`TX ${buf.length}B head=${buf.subarray(0, 32).toString('hex')}`);
      }
    });
  });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(10000);
  await page.screenshot({ path: `${RE}/step1_inicial.png` });

  // Inspección de formularios en todos los frames
  const dump = [];
  for (const fr of page.frames()) {
    try {
      const items = await fr.evaluate(() =>
        Array.from(document.querySelectorAll('input,button,[class*="button"],[class*="Button"]')).map((e) => ({
          tag: e.tagName,
          type: e.type || '',
          ph: e.placeholder || '',
          val: (e.value || '').slice(0, 24),
          txt: (e.textContent || '').trim().slice(0, 32),
          cls: (e.className || '').toString().slice(0, 48),
        }))
      );
      if (items.length) dump.push({ frame: fr.url().slice(-40), items });
    } catch (e) {}
  }
  fs.writeFileSync(`${RE}/form_dump.json`, JSON.stringify(dump, null, 1));

  // Autollenado por heurística
  const login = process.env.WT_LOGIN || '';
  const pass = process.env.WT_PASS || '';
  let filled = { login: false, pass: false, clicked: false };
  for (const fr of page.frames()) {
    try {
      filled.login = await fr.evaluate((lg) => {
        const els = Array.from(document.querySelectorAll('input'));
        const t = els.find((e) => /login|cuenta|account/i.test(e.placeholder || '') ) || els.find((e) => e.type !== 'password' && !e.readOnly);
        if (t) { t.value = lg; t.dispatchEvent(new Event('input', { bubbles: true })); return true; }
        return false;
      }, login);
      filled.pass = await fr.evaluate((ps) => {
        const t = document.querySelector('input[type="password"]');
        if (t) { t.value = ps; t.dispatchEvent(new Event('input', { bubbles: true })); return true; }
        return false;
      }, pass);
      filled.clicked = await fr.evaluate(() => {
        const c = Array.from(document.querySelectorAll('button,[class*="button"],[class*="Button"]')).find((e) =>
          /connect|conectar|login|entrar|ingresar|ok/i.test((e.textContent || '').trim()));
        if (c) { c.click(); return true; }
        return false;
      });
      if (filled.login && filled.pass && filled.clicked) break;
    } catch (e) {}
  }
  console.log('FILL:', JSON.stringify(filled));

  await page.waitForTimeout(15000);
  await page.screenshot({ path: `${RE}/step2_post_login.png` });

  // Resumen textual del estado
  const text = await page.evaluate(() => document.body.innerText.slice(0, 1500));
  fs.writeFileSync(`${RE}/estado_final.txt`, text);
  fs.writeFileSync(`${RE}/ws_frames.log`, wsLog.join('\n'));
  console.log('WS frames registrados:', wsLog.length);
  console.log('TEXTO PÁGINA (primeros 600):');
  console.log(text.slice(0, 600));
  await browser.close();
})().catch((e) => { console.error('FALLO:', e.message); process.exit(1); });
