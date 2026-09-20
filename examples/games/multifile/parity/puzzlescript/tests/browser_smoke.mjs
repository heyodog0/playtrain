// Headless browser smoke test for PuzzleScript play pages: the page loads without console errors, the game steps
// at the sidecar pace, an arrow key changes the level state, the canvas shows more than the background, and the
// controls overlay carries the sidecar's text.
//   node tests/browser_smoke.mjs <built page index.html>...
// Needs playwright-core: resolvable from the cwd, or from PLAYWRIGHT_CORE_DIR (a directory holding
// node_modules/playwright-core), and a Chromium: PLAYWRIGHT_CHROMIUM=<chrome-headless-shell executable> or
// playwright's own browser install.
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
  await page.waitForTimeout(700);
  const t0 = await page.evaluate(() => ({ backups: __ps.snap().backups, level: __ps.snap().level, state: window.getGameState(), lvl: __ps.levelIndex() }));
  await page.click('body');
  // hold each arrow briefly: one of them moves the player unless it is boxed in
  for (const k of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp']) { await page.keyboard.down(k); await page.waitForTimeout(260); await page.keyboard.up(k); await page.waitForTimeout(60); }
  const t1 = await page.evaluate(() => {
    const cv = document.getElementById('view'); const ctx = cv.getContext('2d'); const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const colors = new Set(); for (let k = 0; k < d.length; k += 4) colors.add((d[k] << 16) | (d[k + 1] << 8) | d[k + 2]);
    const ov = document.getElementById('controls-overlay');
    const s = __ps.snap();
    return { backups: s.backups, level: s.level, state: window.getGameState(), canvas: [cv.width, cv.height], colors: colors.size,
      overlay: ov ? ov.textContent.trim() : null, errors: null };
  });
  if (process.env.PW_SHOTS) await page.screenshot({ path: `${process.env.PW_SHOTS}/${name}.png` });
  const moved = t1.backups > t0.backups || t1.level !== t0.level;
  const ok = errors.length === 0 && moved && t1.colors >= 3 && !!t1.overlay && /Arrows/.test(t1.overlay);
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: level ${t0.lvl}, turns ${t0.backups}->${t1.backups}, moved ${moved}, colors ${t1.colors}, canvas ${t1.canvas}, state ${JSON.stringify(t1.state)}, overlay "${(t1.overlay || '').slice(0, 50)}"${errors.length ? '\n   errors: ' + errors.slice(0, 3).join(' | ') : ''}`);
  await page.close();
}
await browser.close();
process.exit(fails ? 1 : 0);
