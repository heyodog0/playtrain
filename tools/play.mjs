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
import { pickerPage, playPage } from './play-templates.mjs';

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

// HTML templates live in ./play-templates.mjs so the static-site builder
// (tools/build-pages.mjs) renders pages identical to this local server.

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
    console.log(`\n  PlayTrain tester at http://localhost:${PORT}`);
    if (autoOpen) console.log(`  Auto-opening: ${autoOpen}`);
  }
  console.log(`  Ctrl-C to stop.\n`);
});
