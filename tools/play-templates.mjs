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
//
// p5 WEBGL games (P5_WEBGL_PLAN.md): the 3D pipeline lives only in the Rust rasterizer, so
// with `wasm: true` the bundle also inlines rasterizer.wasm (base64) plus raster-wasm.mjs's
// backend factory, instantiates the module (top-level await; a <script type="module"> allows
// it) and hands the exports to the shim as globalThis.__PT_WASM_EXPORTS. The shim uses them
// ONLY for createCanvas(w, h, WEBGL); 2D games keep the pure-JS backend, pixel for pixel as
// before. Per-game play pages pass wasm only when the source mentions WEBGL (~120 KB);
// the shared player.js / study bundles always carry it.
const _p5dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'runtime', 'p5');
const _bundles = new Map();
export function browserShimBundle({ wasm = true } = {}) {
  const key = wasm ? 'wasm' : 'js';
  if (_bundles.has(key)) return _bundles.get(key);
  const raster = readFileSync(join(_p5dir, 'raster.mjs'), 'utf8')
    .replace('export function createCanvas(', 'function createRasterCanvas(');
  const shim = readFileSync(join(_p5dir, 'p5-shim.mjs'), 'utf8')
    .replace("import { createCanvas as createJsCanvas } from './raster.mjs'; // pure JS, browser-safe",
      'const createJsCanvas = createRasterCanvas;');
  let pre = '';
  if (wasm) {
    const glue = readFileSync(join(_p5dir, 'raster-wasm.mjs'), 'utf8')
      .replace(/\/\/ @node-only-begin[\s\S]*?\/\/ @node-only-end\n?/, '')
      .replace('export function makeWasmBackend(', 'function makeWasmBackend(');
    const b64 = readFileSync(join(_p5dir, 'rasterizer.wasm')).toString('base64');
    pre = `${glue}
// rasterizer.wasm, inlined (crates/rasterizer; the same module Node loads from disk)
{
  const __b = atob(${JSON.stringify(b64)});
  const __bytes = new Uint8Array(__b.length);
  for (let i = 0; i < __b.length; i++) __bytes[i] = __b.charCodeAt(i);
  globalThis.__PT_WASM_EXPORTS = (await WebAssembly.instantiate(__bytes, {})).instance.exports;
}
`;
  }
  const bundle = pre + raster + '\n' + shim;
  _bundles.set(key, bundle);
  return bundle;
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

export function pickerPage(games, autoOpen, { gameHref, title = 'PlayTrain tester' } = {}) {
  const hrefFor = gameHref || (g => `/game/${g}`);
  const items = games.map(g => `<li><a href="${hrefFor(g)}">${g}</a></li>`).join('\n      ');
  const autoOpenScript = autoOpen
    ? `<script>window.location.href = ${JSON.stringify(hrefFor(autoOpen))};</script>`
    : '';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
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
  <h1>${title}</h1>
  <p class="sub">${games.length} games. Pick one to play.</p>
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
  <div class="col"><div class="label" id="view-label">PlayTrain rasterizer (what the agent renders)</div><canvas id="view"></canvas></div>
  <div class="col"><div class="label" id="obs-label">agent obs (64×64, downsampled preview)</div>
    <canvas id="obs-preview" width="64" height="64" style="width: 256px; height: 256px;"></canvas></div>
</div>
<div id="reset-row"><button id="reset">Reset</button>
  <label id="agentres-row"><input type="checkbox" id="agentres"> render at agent resolution (64&times;64)</label>
</div>
<div id="help">click the page, then play &middot; rendered by PlayTrain's rasterizer (60fps)</div>

<!-- game source kept inert; the module boot evals it AFTER installing the shim globals -->
<script type="text/plain" id="game-src">${source}</script>

${matterScript}<script type="module">
${browserShimBundle({ wasm: /\bWEBGL\b/.test(source) })}

// ---- boot (IIFE so its locals can't collide with shim top-level names, e.g. loop()) ----
// install OUR p5 globals (backed by raster.mjs), run the game, blit pixels.
(function () {
  // Agent-resolution mode. game-env.mjs calls setRasterRes(obsWidth) BEFORE loading
  // the game, so the base transform bakes the logical->device scale and geometry is
  // rasterized directly at 64. Do the same here and the view IS the observation,
  // pixel for pixel. Default (rasterRes null) renders at logical size, in which case
  // the obs panel is only a drawImage downsample and is labelled as such.
  var OBS_RES = 64;
  var AGENT_RES = new URLSearchParams(location.search).has('obs');
  if (AGENT_RES) setRasterRes(OBS_RES);

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

  // Pointer capture, quantized AT THE SOURCE to the same uint16 wire format
  // the envs step with (runtime/action_spaces.json) — a human here plays
  // through exactly the input channel the agent uses, replayable bit-exact.
  var mq = { x: 0, y: 0, down: false };
  var Q = function (v) { return Math.floor(Math.min(1, Math.max(0, v)) * 65535 + 0.5); };
  view.addEventListener('mousemove', function (e) {
    var r = view.getBoundingClientRect();
    mq.x = Q((e.clientX - r.left) / r.width);
    mq.y = Q((e.clientY - r.top) / r.height);
  });
  view.addEventListener('mousedown', function (e) { e.preventDefault(); mq.down = true; });
  addEventListener('mouseup', function () { mq.down = false; });
  document.getElementById('reset').onclick = function () {
    if (typeof window.resetGame === 'function') window.resetGame((Date.now() >>> 0)); this.blur();
  };

  // The raster resolution is baked in at load, so toggling reloads the page.
  var box = document.getElementById('agentres');
  box.checked = AGENT_RES;
  box.onchange = function () {
    var u = new URL(location.href);
    if (this.checked) u.searchParams.set('obs', '1'); else u.searchParams.delete('obs');
    location.href = u.toString();
  };
  if (AGENT_RES) {
    view.style.width = '256px'; view.style.height = '256px';
    document.getElementById('view-label').textContent =
      'PlayTrain rasterizer at agent resolution (64×64)';
    document.getElementById('obs-label').textContent =
      'agent obs (64×64, exactly what the policy sees)';
  }

  var FRAME_MS = 1000 / 60, last = 0;          // fixed-timestep games: pin to 60fps
  function renderLoop(now) {
    requestAnimationFrame(renderLoop);
    if (now - last < FRAME_MS - 0.5) return;
    last = now;
    setKeysDown(Array.from(held));
    pressed.forEach(function (c) { simulateKeyPress(c); });   // one-shot keyPressed() events
    pressed.clear();
    setPointerPos(mq.x, mq.y);
    setButtons(mq.down ? 1 : 0);
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
