#!/usr/bin/env node
// Barebones game tester: serves a bundled (or arbitrary) game as a p5.js
// page in your browser so you can play it with the keyboard.
//
// Usage:  node tools/play.mjs <game>           # bundled example
//         node tools/play.mjs path/to/game.js  # custom game file
//
// Tests the game itself — to test the headless runtime, run `just smoke`.

import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { dirname, resolve, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const GAMES_DIR = join(REPO_ROOT, 'examples', 'games', 'js');

function resolveGamePath(arg) {
  if (!arg) {
    process.stderr.write('Usage: node tools/play.mjs <game-name|path-to-game.js>\n');
    process.exit(1);
  }
  const direct = resolve(arg);
  if (existsSync(direct) && direct.endsWith('.js')) return direct;
  const bundled = join(GAMES_DIR, `${arg}.js`);
  if (existsSync(bundled)) return bundled;
  process.stderr.write(`Game not found: ${arg}\n`);
  process.stderr.write(`Tried: ${direct}\n       ${bundled}\n`);
  process.exit(1);
}

const gamePath = resolveGamePath(process.argv[2]);
const gameName = gamePath.split('/').pop().replace(/\.js$/, '');
const gameSource = readFileSync(gamePath, 'utf8');
const needsMatter = /\bMatter\./.test(gameSource);

const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>node-gym tester — ${gameName}</title>
  <style>
    body { background: #111; color: #eee; font-family: monospace; margin: 0; padding: 16px; }
    main { display: flex; gap: 24px; align-items: flex-start; }
    canvas { background: #000; image-rendering: pixelated; }
    aside { font-size: 13px; line-height: 1.6; }
    h1 { font-size: 16px; margin: 0 0 12px; }
    code { background: #222; padding: 1px 5px; border-radius: 3px; }
  </style>
</head>
<body>
  <main>
    <div id="game"></div>
    <aside>
      <h1>${gameName}</h1>
      <div>Click the canvas, then play with the keyboard.</div>
      <div style="margin-top:12px;color:#888">
        Action map (matches the headless env):<br>
        <code>↑</code> jump · <code>↓</code> down<br>
        <code>←</code><code>→</code> move · <code>space/d</code> action
      </div>
      <div style="margin-top:12px;color:#888">${needsMatter ? 'Matter.js loaded' : 'p5.js only'}</div>
    </aside>
  </main>
  <script src="https://cdn.jsdelivr.net/npm/p5@1.9.4/lib/p5.min.js"></script>
  ${needsMatter ? '<script src="https://cdn.jsdelivr.net/npm/matter-js@0.20.0/build/matter.min.js"></script>' : ''}
  <script>
${gameSource}
  </script>
</body>
</html>
`;

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});

const port = Number(process.env.PORT) || 5050;
server.listen(port, () => {
  console.log(`\n  Playing ${gameName} at http://localhost:${port}`);
  console.log(`  Source: ${gamePath}`);
  console.log(`  Ctrl-C to stop.\n`);
});
