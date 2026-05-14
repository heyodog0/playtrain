#!/usr/bin/env node
// Barebones game tester. Serves a game-picker landing page and individual
// play pages with a reset button and live state overlay.
//
//   node tools/play.mjs                 # picker at http://localhost:5050
//   node tools/play.mjs <game>          # picker, but auto-open the game
//   node tools/play.mjs path/to/game.js # custom file (no picker)

import { createServer } from 'http';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { dirname, resolve, join, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const GAMES_DIR = join(REPO_ROOT, 'examples', 'games', 'js');
const PORT = Number(process.env.PORT) || 5050;

function listBundledGames() {
  if (!existsSync(GAMES_DIR)) return [];
  return readdirSync(GAMES_DIR)
    .filter(f => f.endsWith('.js'))
    .map(f => f.replace(/\.js$/, ''))
    .sort();
}

function resolveBundled(name) {
  const p = join(GAMES_DIR, `${name}.js`);
  return existsSync(p) ? p : null;
}

function readGame(arg) {
  if (existsSync(arg) && statSync(arg).isFile() && arg.endsWith('.js')) {
    return { name: basename(arg, '.js'), path: resolve(arg) };
  }
  const bundled = resolveBundled(arg);
  if (bundled) return { name: arg, path: bundled };
  return null;
}

// ---------------------------------------------------------------------------
// HTML templates
// ---------------------------------------------------------------------------

const baseStyle = `
  body { background: #0d0d0d; color: #ddd; font-family: ui-monospace, Menlo, monospace; margin: 0; }
  a { color: #6cf; text-decoration: none; }
  a:hover { color: #9df; }
  button { background: #222; color: #ddd; border: 1px solid #444; padding: 4px 12px;
           cursor: pointer; font: 12px ui-monospace, monospace; border-radius: 3px; }
  button:hover { border-color: #888; color: #fff; }
`;

function pickerPage(games, autoOpen) {
  const items = games.map(g => `<li><a href="/game/${g}">${g}</a></li>`).join('\n      ');
  const autoOpenScript = autoOpen
    ? `<script>window.location.href = '/game/${autoOpen}';</script>`
    : '';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>node-gym tester</title>
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

function playPage(name, source) {
  const needsMatter = /\bMatter\./.test(source);
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${name} — node-gym tester</title>
<script src="https://cdn.jsdelivr.net/npm/p5@1.9.4/lib/p5.min.js"></script>
${needsMatter ? '<script src="https://cdn.jsdelivr.net/npm/matter-js@0.20.0/build/matter.min.js"></script>' : ''}
<style>${baseStyle}
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
</style></head><body>
<div id="topbar">
  <a href="/">&larr; all games</a>
  <strong>${name}</strong>
</div>

<div id="state"></div>

<div id="stage">
  <div class="col">
    <div class="label">native</div>
    <div id="native-slot"></div>
  </div>
  <div class="col">
    <div class="label">agent obs (64×64, what the policy sees)</div>
    <canvas id="obs-preview" width="64" height="64" style="width: 256px; height: 256px;"></canvas>
  </div>
</div>

<script>
// Stop the browser from scrolling / activating buttons on game keys.
// Without this, arrow keys scroll the page and space activates the Reset
// button, so p5's keyIsDown() reads the wrong state.
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
// Auto-call resetGame after p5 setup so the game starts on load.
const _origSetup = typeof setup === 'function' ? setup : function(){};
setup = function() {
  _origSetup();
  if (typeof resetGame === 'function') resetGame(Date.now() >>> 0);
  // Move p5's auto-appended canvas into the layout slot so it sits beside
  // the obs preview rather than wherever p5 stuck it.
  const slot = document.getElementById('native-slot');
  const game = document.querySelector('canvas.p5Canvas') || document.querySelector('canvas');
  if (slot && game && game.id !== 'obs-preview') slot.appendChild(game);
};

// Live state overlay (polls getGameState() if the game exposes one).
setInterval(() => {
  if (typeof getGameState === 'function') {
    try {
      const s = getGameState();
      const parts = [];
      if ('score' in s) parts.push('score: ' + s.score);
      if ('lives' in s) parts.push('lives: ' + s.lives);
      if ('gameState' in s) parts.push(s.gameState);
      document.getElementById('state').textContent = parts.join('  |  ');
    } catch (e) {}
  }
}, 200);

// Mirror the game canvas into the 64x64 obs preview on every animation
// frame. drawImage with imageSmoothingEnabled=false uses nearest-neighbor
// for downsampling, which closely matches node-gym's obs.mjs algorithm.
// Result: a live preview of what the trained policy would see if you
// recorded the current frame.
(function mirrorObs() {
  const obs = document.getElementById('obs-preview');
  if (!obs) return;
  const octx = obs.getContext('2d', { willReadFrequently: false });
  octx.imageSmoothingEnabled = false;
  function tick() {
    const game = document.querySelector('canvas.p5Canvas') || document.querySelector('canvas');
    if (game && game.id !== 'obs-preview' && game.width > 0) {
      try {
        octx.drawImage(game, 0, 0, obs.width, obs.height);
      } catch (e) { /* canvas may not be ready */ }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
</script>

<div id="reset-row"><button onclick="resetGame(Date.now()>>>0); this.blur();">Reset</button></div>
<div id="help">click canvas to focus${needsMatter ? ' &middot; Matter.js' : ''}</div>
</body></html>`;
}

function notFound(res, msg) {
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end(msg);
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const cliArg = process.argv[2];
const customGame = cliArg && (cliArg.endsWith('.js') || cliArg.includes('/')) ? readGame(cliArg) : null;
const autoOpen = cliArg && !customGame && resolveBundled(cliArg) ? cliArg : null;

if (cliArg && !customGame && !autoOpen) {
  process.stderr.write(`Game not found: ${cliArg}\n`);
  process.stderr.write(`Available: ${listBundledGames().join(', ')}\n`);
  process.exit(1);
}

const server = createServer((req, res) => {
  const url = req.url || '/';

  if (customGame) {
    const source = readFileSync(customGame.path, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(playPage(customGame.name, source));
    return;
  }

  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(pickerPage(listBundledGames(), autoOpen));
    return;
  }

  const m = url.match(/^\/game\/([a-zA-Z0-9_-]+)\/?$/);
  if (m) {
    const path = resolveBundled(m[1]);
    if (!path) return notFound(res, `Unknown game: ${m[1]}`);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(playPage(m[1], readFileSync(path, 'utf8')));
    return;
  }

  notFound(res, 'Not found');
});

server.listen(PORT, () => {
  if (customGame) {
    console.log(`\n  Playing ${customGame.name} at http://localhost:${PORT}`);
    console.log(`  Source: ${customGame.path}`);
  } else {
    console.log(`\n  node-gym tester at http://localhost:${PORT}`);
    if (autoOpen) console.log(`  Auto-opening: ${autoOpen}`);
  }
  console.log(`  Ctrl-C to stop.\n`);
});
