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
  main { max-width: 720px; margin: 40px auto; padding: 0 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p.sub { color: #777; font-size: 13px; margin: 0 0 28px; }
  ul { list-style: none; padding: 0; columns: 3; column-gap: 24px; }
  li { padding: 4px 0; break-inside: avoid; }
</style></head><body>
<main>
  <h1>node-gym tester</h1>
  <p class="sub">Pick a bundled game to play in your browser. ${games.length} games available.</p>
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
  #topbar { align-self: stretch; max-width: 720px; margin: 0 auto 16px;
            display: flex; justify-content: space-between; font-size: 12px; color: #888; }
  #topbar a { color: #888; }
  #topbar strong { color: #ddd; font-weight: normal; }
  #state { font-size: 12px; color: #888; margin-bottom: 6px; min-height: 18px; }
  canvas { background: #000; image-rendering: pixelated; box-shadow: 0 0 0 1px #222; }
  #reset-row { margin-top: 12px; }
  #help { margin-top: 6px; color: #555; font-size: 11px; text-align: center; }
</style></head><body>
<div id="topbar">
  <a href="/">&larr; all games</a>
  <strong>${name}</strong>
</div>

<div id="state"></div>

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
</script>

<div id="reset-row"><button onclick="resetGame(Date.now()>>>0); this.blur();">Reset</button></div>
<div id="help">click canvas to focus &middot; controls vary per game${needsMatter ? ' &middot; Matter.js' : ''}</div>
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
