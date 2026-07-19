// HTML templates shared by the local tester (tools/play.mjs) and the
// static-site builder (tools/build-pages.mjs). Keeping both in one file
// guarantees `just play` and the deployed Vercel site render identically.
//
// All p5 games render through PlayTrain's OWN rasterizer (runtime/p5/raster.mjs) — the exact
// code the agent trains on — inlined into the page (self-contained, zero external requests).
// Matter.js games additionally get a vendored matter.min.js inlined, mirroring how the headless
// runtime exposes the Matter global in runtime/p5/game-env.mjs. No CDN, no real p5.

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

export const baseStyle = `
  body { background: #0d0d0d; color: #ddd; font-family: ui-monospace, Menlo, monospace; margin: 0; }
  a { color: #6cf; text-decoration: none; }
  a:hover { color: #9df; }
  button { background: #222; color: #ddd; border: 1px solid #444; padding: 4px 12px;
           cursor: pointer; font: 12px ui-monospace, monospace; border-radius: 3px; }
  button:hover { border-color: #888; color: #fff; }
`;

const playStyle = `${baseStyle}
  body { display: flex; flex-direction: column; align-items: center; padding: 16px; overflow: hidden; }
  #topbar { width: 100%; max-width: 480px; margin-bottom: 16px;
            display: grid; grid-template-columns: 1fr auto 1fr;
            align-items: center; font-size: 12px; color: #888; }
  #topbar a { color: #888; justify-self: start; }
  #topbar strong { color: #ddd; font-weight: normal; justify-self: center; }
  #state { font-size: 12px; color: #888; margin-bottom: 6px; min-height: 18px; }
  canvas { background: #000; image-rendering: pixelated; box-shadow: 0 0 0 1px #222; }
  #stage { display: flex; gap: 24px; align-items: flex-start; }
  #stage .col { display: flex; flex-direction: column; align-items: center; }
  #stage .label { color: #777; font-size: 11px; margin-bottom: 4px; }
  #reset-row { margin-top: 12px; }
  #help { margin-top: 6px; color: #555; font-size: 11px; text-align: center; }
`;

// --- inline rasterizer bundle (raster.mjs + p5-shim.mjs, browser-safe) ---------------
// Concatenate the two source files into one module. The only top-level name collision is
// createCanvas (raster's backend factory vs the shim's p5 API), resolved by renaming raster's
// to createRasterCanvas. The shim's node-only dynamic imports are guarded by _IS_NODE and never
// run in-browser, so nothing else needs stripping.
const _p5dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'runtime', 'p5');
let _bundle = null;
function browserShimBundle() {
  if (_bundle) return _bundle;
  const raster = readFileSync(join(_p5dir, 'raster.mjs'), 'utf8')
    .replace('export function createCanvas(', 'function createRasterCanvas(');
  const shim = readFileSync(join(_p5dir, 'p5-shim.mjs'), 'utf8')
    .replace("import { createCanvas as createJsCanvas } from './raster.mjs'; // pure JS, browser-safe",
      'const createJsCanvas = createRasterCanvas;');
  _bundle = raster + '\n' + shim;
  return _bundle;
}

// --- vendored matter.js (inlined only into Matter.js game pages) ----------------------
// Mirrors runtime/p5/game-env.mjs, which loads matter-js into the headless context so games
// get the `Matter` global. Vendored under tools/vendor so the static build needs no
// node_modules (Vercel skips install). UMD -> sets window.Matter when run as a classic <script>.
const _matterPath = join(dirname(fileURLToPath(import.meta.url)), 'vendor', 'matter.min.js');
let _matter = null;
function matterBundle() {
  if (_matter === null) _matter = readFileSync(_matterPath, 'utf8');
  return _matter;
}

export function pickerPage(games, autoOpen, { gameHref } = {}) {
  const hrefFor = gameHref || (g => `/game/${g}`);
  const items = games.map(g => `<li><a href="${hrefFor(g)}">${g}</a></li>`).join('\n      ');
  const autoOpenScript = autoOpen
    ? `<script>window.location.href = ${JSON.stringify(hrefFor(autoOpen))};</script>`
    : '';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>PlayTrain tester</title>
<meta name="robots" content="noindex, nofollow, noarchive, nosnippet">
<style>${baseStyle}
  *, *::before, *::after { box-sizing: border-box; }
  body { min-height: 100vh; display: flex; justify-content: center;
         padding: 56px 24px; }
  main { width: 100%; max-width: 640px; }
  h1 { font-size: 18px; margin: 0 0 4px; text-align: center; }
  p.sub { color: #777; font-size: 13px; margin: 0 0 32px; text-align: center; }
  ul { list-style: none; padding: 0; margin: 0;
       display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px 24px; }
  li { padding: 0; }
</style></head><body>
<main>
  <h1>PlayTrain tester</h1>
  <p class="sub">${games.length} bundled games. Pick one to play.</p>
  <ul>
      ${items}
  </ul>
</main>
${autoOpenScript}
</body></html>`;
}

// All games render live by PlayTrain's own rasterizer (the agent's renderer). Matter.js games
// also get matter.min.js inlined so the `Matter` global is available before the game runs.
function rasterizerPage(name, source, { homeHref = '/', needsMatter = false } = {}) {
  // Classic <script> executes before the deferred type="module" boot, so window.Matter is
  // set by the time the game source is eval'd — the browser analogue of game-env.mjs.
  const matterScript = needsMatter ? `<script>${matterBundle()}</script>\n` : '';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${name} — PlayTrain tester</title>
<meta name="robots" content="noindex, nofollow, noarchive, nosnippet">
<style>${playStyle}</style></head><body>
<div id="topbar"><a href="${homeHref}">&larr; all games</a><strong>${name}</strong></div>
<div id="state"></div>
<div id="stage">
  <div class="col"><div class="label">PlayTrain rasterizer (what the agent renders)</div><canvas id="view"></canvas></div>
  <div class="col"><div class="label">agent obs (64×64, what the policy sees)</div>
    <canvas id="obs-preview" width="64" height="64" style="width: 256px; height: 256px;"></canvas></div>
</div>
<div id="reset-row"><button id="reset">Reset</button></div>
<div id="help">click the page, then play &middot; rendered by PlayTrain's rasterizer (60fps)</div>

<!-- game source kept inert; the module boot evals it AFTER installing the shim globals -->
<script type="text/plain" id="game-src">${source}</script>

${matterScript}<script type="module">
${browserShimBundle()}

// ---- boot (IIFE so its locals can't collide with shim top-level names, e.g. loop()) ----
// install OUR p5 globals (backed by raster.mjs), run the game, blit pixels.
(function () {
  installGlobals();
  (0, eval)(document.getElementById('game-src').textContent);   // defines setup/draw/... globally
  if (typeof window.setup === 'function') window.setup();
  if (typeof window.resetGame === 'function') window.resetGame((Date.now() >>> 0));

  var view = document.getElementById('view');
  var p0 = getPixelData(); view.width = p0.width; view.height = p0.height;
  var vctx = view.getContext('2d');
  var obsC = document.getElementById('obs-preview');
  var octx = obsC.getContext('2d'); octx.imageSmoothingEnabled = false;

  var held = new Set(), pressed = new Set();
  var KEYS = [32, 37, 38, 39, 40, 65, 66, 68, 83, 87];
  addEventListener('keydown', function (e) {
    if (KEYS.indexOf(e.keyCode) >= 0) { e.preventDefault(); if (!held.has(e.keyCode)) pressed.add(e.keyCode); held.add(e.keyCode); }
  }, { passive: false });
  addEventListener('keyup', function (e) { held.delete(e.keyCode); });
  document.getElementById('reset').onclick = function () {
    if (typeof window.resetGame === 'function') window.resetGame((Date.now() >>> 0)); this.blur();
  };

  var FRAME_MS = 1000 / 60, last = 0;          // fixed-timestep games: pin to 60fps
  function renderLoop(now) {
    requestAnimationFrame(renderLoop);
    if (now - last < FRAME_MS - 0.5) return;
    last = now;
    setKeysDown(Array.from(held));
    pressed.forEach(function (c) { simulateKeyPress(c); });   // one-shot keyPressed() events
    pressed.clear();
    tick();
    var p = getPixelData();
    vctx.putImageData(new ImageData(new Uint8ClampedArray(p.data), p.width, p.height), 0, 0);
    octx.drawImage(view, 0, 0, obsC.width, obsC.height);       // obs preview from OUR render
    if (typeof window.getGameState === 'function') {
      try {
        var s = window.getGameState(); var parts = [];
        if ('score' in s) parts.push('score: ' + s.score);
        if ('lives' in s) parts.push('lives: ' + s.lives);
        if ('gameState' in s) parts.push(s.gameState);
        document.getElementById('state').textContent = parts.join('  |  ');
      } catch (e) {}
    }
  }
  requestAnimationFrame(renderLoop);
})();
</script>
</body></html>`;
}

export function playPage(name, source, opts = {}) {
  // Matter.js games get the vendored physics engine inlined; everything else is identical.
  // p5 is always PlayTrain's own shim (rasterizer) — no real p5, no CDN.
  const needsMatter = /\bMatter\./.test(source);
  return rasterizerPage(name, source, { ...opts, needsMatter });
}
