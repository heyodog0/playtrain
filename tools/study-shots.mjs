#!/usr/bin/env node
// Screenshot the study at several display sizes, so layout can be checked without
// owning the monitors. Writes PNGs plus a contact sheet to dist/study-shots/.
//
//   node tools/study-shots.mjs                    # all sizes, caveflyer
//   node tools/study-shots.mjs --game breakout
//   node tools/study-shots.mjs --screens          # consent/instructions/quiz too
//
// Needs playwright (npx playwright install chromium). Dev-only; not shipped to
// participants and not required to build or run the study.

import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, extname, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const SITE = resolve(arg('--site', join(REPO_ROOT, 'dist', 'study')));
const OUT = resolve(arg('--out', join(REPO_ROOT, 'dist', 'study-shots')));
const GAME = arg('--game', 'caveflyer');
const WITH_SCREENS = process.argv.includes('--screens');

// Viewport = the browser's usable area, which is smaller than the panel. These are
// windowed-browser heights on the corresponding displays, which is what participants
// actually have.
const SIZES = [
  { name: '1280x720-small-laptop',  w: 1280, h: 620 },
  { name: '1440x900-macbook-air',   w: 1440, h: 790 },
  { name: '1512x982-macbook-14',    w: 1512, h: 870 },
  { name: '1920x1080-desktop',      w: 1920, h: 960 },
  { name: '2560x1440-qhd',          w: 2560, h: 1320 },
];

if (!existsSync(SITE)) {
  console.error(`site not built: ${SITE}\nrun: node tools/build-study.mjs`);
  process.exit(1);
}

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { console.error('playwright not installed. run: npm i -D playwright && npx playwright install chromium'); process.exit(1); }

const server = createServer((req, res) => {
  let p = join(SITE, decodeURIComponent(req.url.split('?')[0]));
  if (!extname(p)) p = join(p, 'index.html');
  if (!existsSync(p)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': extname(p) === '.html' ? 'text/html' : 'text/plain' });
  res.end(readFileSync(p));
});
await new Promise(r => server.listen(0, r));
const PORT = server.address().port;

if (existsSync(OUT)) rmSync(OUT, { recursive: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const shots = [];

async function shoot(page, label, size) {
  const file = `${label}--${size.name}.png`;
  await page.screenshot({ path: join(OUT, file) });
  shots.push({ file, label, size: size.name, w: size.w, h: size.h });
}

for (const size of SIZES) {
  const page = await browser.newPage({ viewport: { width: size.w, height: size.h } });

  // Game, mid-play: click through the veil and hold a key so it is not a title screen.
  await page.goto(`http://localhost:${PORT}/block/${GAME}/`);
  await page.click('#go');
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(700);
  await page.keyboard.up('ArrowRight');
  const scale = await page.evaluate(() => {
    const v = document.getElementById('view');
    return { css: v.style.width, native: v.width };
  });
  await shoot(page, `game-${GAME}`, size);
  console.log(`${size.name.padEnd(26)} canvas ${scale.native}px -> ${scale.css}`);

  if (WITH_SCREENS) {
    await page.goto(`http://localhost:${PORT}/?pid=shots`);
    await page.waitForTimeout(2200);
    await shoot(page, 'consent', size);
    await page.evaluate(() => { const s = document.getElementById('consent-scroll'); s.scrollTop = s.scrollHeight; });
    await page.check('#agree'); await page.click('#consent-next'); await page.waitForTimeout(200);
    await shoot(page, 'instructions', size);
    for (let i = 0; i < 8; i++) {
      await page.click('#instr-next'); await page.waitForTimeout(120);
      if (await page.isVisible('#s-quiz')) break;
    }
    await shoot(page, 'quiz', size);
  }
  await page.close();
}

await browser.close();
server.close();

// Contact sheet: every shot at a readable width, grouped by screen.
const groups = [...new Set(shots.map(s => s.label))];
writeFileSync(join(OUT, 'index.html'), `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>study — layout at display sizes</title>
<style>
  body { background:#111; color:#eee; margin:0; padding:32px;
         font-family: system-ui, -apple-system, sans-serif; }
  h1 { font-size:18px; font-weight:500; }
  h2 { font-size:15px; font-weight:500; margin:34px 0 12px; color:#fff; }
  .row { display:flex; gap:18px; flex-wrap:wrap; align-items:flex-start; }
  figure { margin:0; width:440px; }
  figcaption { color:#888; font-size:12px; margin-top:6px; }
  img { width:100%; border:1px solid #333; display:block; background:#000; }
</style></head><body>
<h1>PlayTrain study — layout across display sizes</h1>
${groups.map(g => `<h2>${g}</h2><div class="row">${
  shots.filter(s => s.label === g).map(s =>
    `<figure><img src="${s.file}"><figcaption>${s.size} &middot; viewport ${s.w}&times;${s.h}</figcaption></figure>`
  ).join('')}</div>`).join('\n')}
</body></html>`);

console.log(`\n${shots.length} shots → ${OUT}/index.html`);
