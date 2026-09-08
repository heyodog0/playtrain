#!/usr/bin/env node
// Build a fully self-contained static playtest site from a directory of p5 games.
// Every page inlines PlayTrain's rasterizer (+ matter.js for Matter games) — zero
// external requests — so the output can be served from any static host as-is.
//
//   <out>/index.html              - game picker
//   <out>/game/<name>/index.html  - one page per game
//
// Usage:
//   node tools/build-pages.mjs                                     # examples/games/js -> dist/pages
//   node tools/build-pages.mjs --games games/js --out dist/share --title "a consumer repo games"
//
// Uses the same HTML templates as tools/play.mjs, so local `just play` and the
// deployed site render identically.

import { readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, existsSync } from 'fs';
import { dirname, resolve, join, sep } from 'path';
import { fileURLToPath } from 'url';
import { pickerPage, playPage } from './play-templates.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const GAMES_DIR = resolve(arg('--games', join(REPO_ROOT, 'examples', 'games', 'js')));
const OUT_DIR = resolve(arg('--out', join(REPO_ROOT, 'dist', 'pages')));
// Default title = the project name: walk up from the games dir past container dirs.
// …/a consumer repo/games/js -> "a consumer repo"; …/playtrain/examples/games/js -> "playtrain".
function projectName(dir) {
  const skip = new Set(['js', 'games', 'examples', 'src', 'catalogs']);
  const parts = dir.split(sep).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) if (!skip.has(parts[i])) return parts[i];
  return 'PlayTrain';
}
const TITLE = arg('--title', `${projectName(GAMES_DIR)} tester`);
// Games to omit from the tester, by name (no .js). Comma-separated.
const EXCLUDE = new Set(arg('--exclude', '').split(',').map(s => s.trim()).filter(Boolean));

if (!existsSync(GAMES_DIR)) {
  console.error(`games dir not found: ${GAMES_DIR}`);
  process.exit(1);
}

function listGames() {
  return readdirSync(GAMES_DIR)
    .filter(f => f.endsWith('.js') && !f.endsWith('_dbg.js'))
    .map(f => f.replace(/\.js$/, ''))
    .filter(name => !EXCLUDE.has(name))
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

writeFile(join(OUT_DIR, 'index.html'), pickerPage(games, null, { gameHref, title: TITLE }));
writeFile(join(OUT_DIR, 'robots.txt'), 'User-agent: *\nDisallow: /\n');

for (const name of games) {
  const source = readFileSync(join(GAMES_DIR, `${name}.js`), 'utf8');
  writeFile(join(OUT_DIR, 'game', name, 'index.html'), playPage(name, source, { homeHref: '/' }));
}

console.log(`built ${games.length} games → ${OUT_DIR}`);
