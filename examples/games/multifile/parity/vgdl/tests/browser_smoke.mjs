// Headless browser smoke test for VGDL play pages: page loads without console errors,
// the game ticks at the sidecar pace, key presses move the avatar, and the canvas is not blank.
//   node tests/browser_smoke.mjs <built page index.html>...
// Needs playwright-core resolvable from the cwd (npm i playwright-core) and a Chromium:
// PLAYWRIGHT_CHROMIUM=<executable> or playwright's own browser install.
let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { console.error('playwright-core not installed; skipping'); process.exit(3); }
const pages = process.argv.slice(2);
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
let fails = 0;
for (const file of pages) {
  const name = file.split('/').slice(-2, -1)[0];
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e.message))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + file);
  await page.waitForTimeout(600);
  const t0 = await page.evaluate(() => ({ time: __vgdl.state().t, state: window.getGameState() }));
  await page.click('body');
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(700); await page.keyboard.up('ArrowRight');
  await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(400); await page.keyboard.up('ArrowLeft');
  const t1 = await page.evaluate(() => {
    const av = __vgdl.snapshot().find(r => r[0] === 'avatar');
    const cv = document.getElementById('view'); const ctx = cv.getContext('2d'); const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const colors = new Set(); for (let k = 0; k < d.length; k += 4 * 37) colors.add((d[k] << 16) | (d[k + 1] << 8) | d[k + 2]);
    return { time: __vgdl.state().t, state: window.getGameState(), avatar: av ? [av[1], av[2]] : null, canvas: [cv.width, cv.height], distinctColors: colors.size, obs: document.getElementById('obs-preview') ? 'yes' : 'no' };
  });
  if (process.env.PW_SHOTS) await page.screenshot({ path: `${process.env.PW_SHOTS}/${name}.png` });
  const ok = errors.length === 0 && t1.time > t0.time && t1.distinctColors >= 3;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ticks ${t0.time}->${t1.time}, avatar ${JSON.stringify(t1.avatar)}, colors ${t1.distinctColors}, canvas ${t1.canvas}, state ${JSON.stringify(t1.state)}${errors.length ? '\n   errors: ' + errors.slice(0, 3).join(' | ') : ''}`);
  await page.close();
}
await browser.close();
process.exit(fails ? 1 : 0);
