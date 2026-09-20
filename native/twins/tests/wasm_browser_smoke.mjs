#!/usr/bin/env node
// U12 browser gate: a play page built from a .wasm game loads in headless Chromium, the module compiles from its
// inlined bytes, the game steps at the sidecar pace, holding the sidecar's first action key changes the frame, and
// the canvas shows more than the background. Same skip rules as the families' browser smoke (exit 3 without
// playwright-core).
//   node wasm_browser_smoke.mjs <built page index.html>... [--games <wasm dir>]   (sidecars supply the keys to hold)
import { createRequire } from 'node:module';
let chromium;
try { ({ chromium } = await import('playwright-core')); }
catch { try { ({ chromium } = createRequire(process.env.PLAYWRIGHT_CORE_DIR.replace(/\/?$/, '/'))('playwright-core')); } catch { console.error('playwright-core not installed; skipping'); process.exit(3); } }
const args = process.argv.slice(2);
const gi = args.indexOf('--games'); const GAMES_DIR = gi >= 0 ? args[gi + 1] : null;   // the wasm dir: <name>.json sidecars give the held key codes
const pages = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--games'));
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const keyName = (c) => c === 32 ? 'Space' : c === 37 ? 'ArrowLeft' : c === 38 ? 'ArrowUp' : c === 39 ? 'ArrowRight' : c === 40 ? 'ArrowDown' : (c >= 48 && c <= 57) || (c >= 65 && c <= 90) ? String.fromCharCode(c) : null;
const exe = process.env.PLAYWRIGHT_CHROMIUM;
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
let fails = 0;
for (const file of pages) {
  const name = file.split('/').slice(-2, -1)[0];
  let keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Space'];
  if (GAMES_DIR) { try { const side = JSON.parse(readFileSync(join(GAMES_DIR, name + '.json'), 'utf8')); const ks = []; for (const a of side.actions || []) for (const c of a.held || []) { const k = keyName(c); if (k && !ks.includes(k)) ks.push(k); } if (ks.length) keys = ks; } catch {} }
  const page = await browser.newPage({ viewport: { width: 1000, height: 760 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e.message))); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + file);
  await page.waitForTimeout(400);
  const snap = () => page.evaluate(() => { const cv = document.getElementById('view'); const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let h = 2166136261, nz = 0; const colors = new Set(); for (let k = 0; k < d.length; k += 4) { const v = (d[k] << 16) | (d[k + 1] << 8) | d[k + 2]; colors.add(v); if (v) nz++; h = Math.imul(h ^ ((v + k) | 0), 16777619) >>> 0; } return { hash: h + ':' + nz, colors: colors.size, canvas: [cv.width, cv.height], state: typeof window.getGameState === 'function' ? window.getGameState() : null, frames: typeof frameCount === 'number' ? frameCount : null, wasm: typeof __ptw === 'object' }; });
  const t0 = await snap();
  await page.click('body');
  let changed = false;
  for (const k of keys.slice(0, 5)) { await page.keyboard.down(k); await page.waitForTimeout(350); const t = await snap(); if (t.hash !== t0.hash) changed = true; await page.keyboard.up(k); await page.waitForTimeout(80); }
  const t1 = await snap(); if (t1.hash !== t0.hash) changed = true;
  if (process.env.PW_SHOTS) await page.screenshot({ path: `${process.env.PW_SHOTS}/${name}.png` });
  const stepped = t1.frames === null || t0.frames === null ? true : t1.frames > t0.frames;
  const ok = errors.length === 0 && t0.wasm && stepped && changed && t1.colors >= 2 && t1.state && t1.state.gameState;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: wasm ${t0.wasm}, frames ${t0.frames}->${t1.frames}, frame changed ${changed}, colors ${t1.colors}, canvas ${t1.canvas}, keys ${keys.slice(0, 5).join('/')}, state ${JSON.stringify(t1.state)}${errors.length ? '\n   errors: ' + errors.slice(0, 3).join(' | ') : ''}`);
  await page.close();
}
await browser.close();
process.exit(fails ? 1 : 0);
