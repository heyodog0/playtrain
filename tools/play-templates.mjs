// HTML templates shared by the local tester (tools/play.mjs) and the
// static-site builder (tools/build-pages.mjs). Keeping both in one file
// guarantees `just play` and the deployed Vercel site render identically.
//
// Non-Matter p5 games render through node-gym's OWN rasterizer (runtime/p5/raster.mjs),
// the exact code the agent trains on — inlined into the page (self-contained, no module
// serving needed). Matter.js games keep the legacy p5-from-CDN path, untouched.

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

export function pickerPage(games, autoOpen, { gameHref } = {}) {
  const hrefFor = gameHref || (g => `/game/${g}`);
  const items = games.map(g => `<li><a href="${hrefFor(g)}">${g}</a></li>`).join('\n      ');
  const autoOpenScript = autoOpen
    ? `<script>window.location.href = ${JSON.stringify(hrefFor(autoOpen))};</script>`
    : '';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>node-gym tester</title>
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
  <h1>node-gym tester</h1>
  <p class="sub">${games.length} bundled games. Pick one to play.</p>
  <ul>
      ${items}
  </ul>
</main>
${autoOpenScript}
</body></html>`;
}

// Non-Matter games: rendered live by node-gym's own rasterizer (the agent's renderer).
function rasterizerPage(name, source, { homeHref = '/' } = {}) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${name} — node-gym tester</title>
<meta name="robots" content="noindex, nofollow, noarchive, nosnippet">
<style>${playStyle}</style></head><body>
<div id="topbar"><a href="${homeHref}">&larr; all games</a><strong>${name}</strong></div>
<div id="state"></div>
<div id="stage">
  <div class="col"><div class="label">node-gym rasterizer (what the agent renders)</div><canvas id="view"></canvas></div>
  <div class="col"><div class="label">agent obs (64×64, what the policy sees)</div>
    <canvas id="obs-preview" width="64" height="64" style="width: 256px; height: 256px;"></canvas></div>
</div>
<div id="reset-row"><button id="reset">Reset</button></div>
<div id="help">click the page, then play &middot; rendered by node-gym's rasterizer (60fps)</div>

<!-- game source kept inert; the module boot evals it AFTER installing the shim globals -->
<script type="text/plain" id="game-src">${source}</script>

<script type="module">
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

// Matter.js games: legacy path (real p5 + matter.js from CDN), intentionally untouched.
function legacyP5Page(name, source, { homeHref = '/' } = {}) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${name} — node-gym tester</title>
<meta name="robots" content="noindex, nofollow, noarchive, nosnippet">
<script src="https://cdn.jsdelivr.net/npm/p5@1.9.4/lib/p5.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/matter-js@0.20.0/build/matter.min.js"></script>
<style>${playStyle}</style></head><body>
<div id="topbar"><a href="${homeHref}">&larr; all games</a><strong>${name}</strong></div>
<div id="state"></div>
<div id="stage">
  <div class="col"><div class="label">native</div><div id="native-slot"></div></div>
  <div class="col"><div class="label">agent obs (64×64, what the policy sees)</div>
    <canvas id="obs-preview" width="64" height="64" style="width: 256px; height: 256px;"></canvas></div>
</div>
<script>
window.addEventListener('keydown', (e) => {
  if ([32, 37, 38, 39, 40, 68, 87, 65, 83].includes(e.keyCode)) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    e.preventDefault();
  }
}, { passive: false });
</script>
<script>
${source}
</script>
<script>
const _origSetup = typeof setup === 'function' ? setup : function(){};
setup = function() {
  _origSetup();
  if (typeof resetGame === 'function') resetGame(Date.now() >>> 0);
  const slot = document.getElementById('native-slot');
  const game = document.querySelector('canvas.p5Canvas') || document.querySelector('canvas');
  if (slot && game && game.id !== 'obs-preview') slot.appendChild(game);
};
setInterval(() => {
  if (typeof getGameState === 'function') {
    try {
      const s = getGameState(); const parts = [];
      if ('score' in s) parts.push('score: ' + s.score);
      if ('lives' in s) parts.push('lives: ' + s.lives);
      if ('gameState' in s) parts.push(s.gameState);
      document.getElementById('state').textContent = parts.join('  |  ');
    } catch (e) {}
  }
}, 200);
(function mirrorObs() {
  const obs = document.getElementById('obs-preview');
  if (!obs) return;
  const octx = obs.getContext('2d', { willReadFrequently: false });
  octx.imageSmoothingEnabled = false;
  function tick() {
    const game = document.querySelector('canvas.p5Canvas') || document.querySelector('canvas');
    if (game && game.id !== 'obs-preview' && game.width > 0) {
      try { octx.drawImage(game, 0, 0, obs.width, obs.height); } catch (e) {}
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
</script>
<div id="reset-row"><button onclick="resetGame(Date.now()>>>0); this.blur();">Reset</button></div>
<div id="help">click canvas to focus &middot; Matter.js</div>
</body></html>`;
}

export function playPage(name, source, opts = {}) {
  // Matter.js games need the physics engine + real p5; keep them on the legacy path.
  const needsMatter = /\bMatter\./.test(source);
  return needsMatter ? legacyP5Page(name, source, opts) : rasterizerPage(name, source, opts);
}
