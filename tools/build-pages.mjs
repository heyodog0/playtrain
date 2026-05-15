#!/usr/bin/env node
// Build a static playtest site mirroring `just play`, for deployment to
// Vercel (or any static host). Writes:
//
//   dist/pages/index.html              - game picker
//   dist/pages/game/<name>/index.html  - one page per bundled p5 game
//
// Uses the same HTML templates as tools/play.mjs (see play-templates.mjs),
// so local `just play` and the deployed site stay in lockstep.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, existsSync } from 'fs';
import { dirname, resolve, join } from 'path';
import { fileURLToPath } from 'url';
import { pickerPage, playPage } from './play-templates.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const GAMES_DIR = join(REPO_ROOT, 'examples', 'games', 'js');
const OUT_DIR = join(REPO_ROOT, 'dist', 'pages');

function listGames() {
  return readdirSync(GAMES_DIR)
    .filter(f => f.endsWith('.js'))
    .map(f => f.replace(/\.js$/, ''))
    .sort();
}

function writeFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const games = listGames();
// Static hosts vary on extensionless routing. Writing each game to its own
// `game/<name>/index.html` works everywhere without rewrites.
const gameHref = g => `/game/${g}/`;

writeFile(join(OUT_DIR, 'index.html'), pickerPage(games, null, { gameHref }));
writeFile(join(OUT_DIR, 'robots.txt'), 'User-agent: *\nDisallow: /\n');

for (const name of games) {
  const source = readFileSync(join(GAMES_DIR, `${name}.js`), 'utf8');
  writeFile(join(OUT_DIR, 'game', name, 'index.html'), playPage(name, source, { homeHref: '/' }));
}

console.log(`built ${games.length} games → ${OUT_DIR}`);
