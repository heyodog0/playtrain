// Headless browser smoke test for CHIP-8 play pages: the page loads without console errors, the
// game steps at the sidecar pace, the game's first keypad key (from the sidecar) is taken, the
// canvas shows both display colours, and the controls overlay carries the sidecar's text.
//   node tests/browser_smoke.mjs <built page index.html>...
// Needs playwright-core: resolvable from the cwd, or from PLAYWRIGHT_CORE_DIR (a directory holding
// node_modules/playwright-core, e.g. a scratch `npm i playwright-core`), and a Chromium:
// PLAYWRIGHT_CHROMIUM=<chrome-headless-shell executable> or playwright's own browser install.
import { createRequire } from 'node:module';
let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch {
  try { ({ chromium } = createRequire(process.env.PLAYWRIGHT_CORE_DIR.replace(/\/?$/, '/'))('playwright-core')); }
  catch { console.error('playwright-core not installed; skipping'); process.exit(3); }
}
const pages = process.argv.slice(2);
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
let fails = 0;
for (const file of pages) {
  const name = file.split('/').slice(-2, -1)[0];
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e.message))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + file);
  await page.waitForTimeout(600);
  const t0 = await page.evaluate(() => ({ time: __chip8.env().time, state: window.getGameState(), key: __chip8.keyNames()[__chip8.def().action_set[0]] }));
  await page.click('body');
  await page.keyboard.down(t0.key.length === 1 ? t0.key.toLowerCase() : t0.key); await page.waitForTimeout(700); await page.keyboard.up(t0.key.length === 1 ? t0.key.toLowerCase() : t0.key);
  await page.waitForTimeout(300);
  const t1 = await page.evaluate(() => {
    const cv = document.getElementById('view'); const ctx = cv.getContext('2d'); const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const colors = new Set(); for (let k = 0; k < d.length; k += 4) colors.add((d[k] << 16) | (d[k + 1] << 8) | d[k + 2]);
    const ov = document.getElementById('controls-overlay');
    return { time: __chip8.env().time, state: window.getGameState(), canvas: [cv.width, cv.height], colors: [...colors].map(c => c.toString(16).padStart(6, '0')).sort(),
      overlay: ov ? ov.textContent.trim() : null, keypadSeen: __chip8.env().cpu.keypad.some(k => k) };
  });
  if (process.env.PW_SHOTS) await page.screenshot({ path: `${process.env.PW_SHOTS}/${name}.png` });
  const green = t1.colors.includes('00ff00'), black = t1.colors.includes('000000');
  const ok = errors.length === 0 && t1.time > t0.time && green && black && t1.colors.length === 2 && !!t1.overlay && t1.overlay.includes('key');
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: steps ${t0.time}->${t1.time} (key ${t0.key}), colors ${t1.colors.join(',')}, canvas ${t1.canvas}, state ${JSON.stringify(t1.state)}, overlay "${(t1.overlay || '').slice(0, 60)}"${errors.length ? '\n   errors: ' + errors.slice(0, 3).join(' | ') : ''}`);
  await page.close();
}
await browser.close();
process.exit(fails ? 1 : 0);
