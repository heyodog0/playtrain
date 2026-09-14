#!/usr/bin/env node
// Play one game yourself and get a session JSON. One command, no study protocol.
//
//   node study/quickplay.mjs vvvvvv.v2                 # 20s, one take
//   node study/quickplay.mjs seaquest --seconds 100    # the study's block length
//
// Opens the game in your browser, you play, and the recorded session lands in
// dist/playtests/ and is replay-verified on the spot.
//
// The block defaults to 20 seconds rather than the study's 100, because the usual
// reason to run this is footage for a figure: 20s is one take, and enough to fill a
// 15-second clip with slack. Ask for --seconds 100 when you want the matched
// condition, or several rounds to pick a best from.
//
// This is NOT the human baseline. It is you, who wrote the game, playing once --
// no consent flow, no participant id, no randomised order, n=1. It exists to
// answer "is this environment human-playable" and to render a clip, not to sit in
// a table beside the 20-participant study. For that, use build-study.mjs with the
// real protocol in study-config.json.
//
// Everything underneath is the study harness, unmodified: the same block page, the
// same quantizer, the same seed pool, the same 2000-step cap. So the episode
// replays through the training environment and reproduces its score, and a clip
// rendered from it is the same episode rather than a reconstruction.
//
// "The same quantizer" means default8's for a catalog game. A game that ships a
// <name>.json sidecar declares its own action table and its own human tick rate,
// and the harness uses those instead (study-templates.mjs). Catalog games are
// unaffected.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'fs';
import { dirname, resolve, join } from 'path';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const GAME = process.argv[2];
if (!GAME || (GAME.startsWith('-') && GAME !== '--list')) {
  console.error('usage: node study/quickplay.mjs <game> [--seconds N=20] [--port N] [--games DIR]');
  console.error('       node study/quickplay.mjs --list');
  process.exit(2);
}

// Same default as build-study.mjs / verify-replay.mjs: what the trainers resolve.
const CATALOG_DIR = resolve(arg('--games',
  process.env.PLAYTRAIN_GAMES_DIR || join(REPO_ROOT, 'examples', 'games', 'js')));

// Multi-file games are bundled into examples/games/multifile/*/*/dist/, which is
// a second games root the Python runtime already searches (_paths.py). Search it
// here too so `quickplay.mjs craftax_classic` just works instead of needing an
// explicit --games. The catalog is searched first, so nothing there is shadowed.
function multifileDistDirs() {
  const root = join(REPO_ROOT, 'examples', 'games', 'multifile');
  if (!existsSync(root)) return [];
  const out = [];
  for (const kind of readdirSync(root)) {
    const kindDir = join(root, kind);
    let names;
    try { names = readdirSync(kindDir); } catch { continue; }
    for (const name of names) {
      const d = join(kindDir, name, 'dist');
      if (existsSync(d)) out.push(d);
    }
  }
  return out.sort();
}

const SEARCH_DIRS = [CATALOG_DIR, ...multifileDistDirs()];

function dirForGame(name) {
  return SEARCH_DIRS.find(d => existsSync(join(d, `${name}.js`)));
}

if (GAME === '--list') {
  const seen = new Set();
  for (const d of SEARCH_DIRS) {
    for (const f of readdirSync(d)) {
      if (f.endsWith('.js')) seen.add(f.slice(0, -3));
    }
  }
  const names = [...seen].sort();
  console.log(`${names.length} games in ${SEARCH_DIRS.join(', ')}\n`);
  console.log(names.join('\n'));
  process.exit(0);
}

const CONFIG = resolve(arg('--config', join(__dirname, 'study-config.json')));
const PORT = parseInt(arg('--port', '8097'), 10);
const SECONDS = parseFloat(arg('--seconds', '20'));
const OUT = resolve(arg('--out', join(REPO_ROOT, 'dist', 'playtests')));
const SITE = join(REPO_ROOT, 'dist', 'quickplay-site');

const GAMES_DIR = dirForGame(GAME);
if (!GAMES_DIR) {
  console.error(`no such game: ${GAME}.js`);
  console.error(`  looked in: ${SEARCH_DIRS.join('\n             ')}`);
  console.error(`  run with --list to see what is there`);
  process.exit(1);
}

const cfg = JSON.parse(readFileSync(CONFIG, 'utf8'));

// Controls are the one thing a config knows that a game file does not. Take the
// study's own wording when it covers this game, fall back to the base game of a
// variant (vvvvvv.v2 -> vvvvvv), and only then guess -- a wrong controls line
// reads as a broken game, so say when it is a guess.
const known = new Map((cfg.games || []).map(g => [g.name, g.controls]));
const base = GAME.split('.')[0];
let controls = known.get(GAME) ?? known.get(base);
const guessed = !controls;
if (guessed) controls = arg('--controls',
  'ARROW KEYS to move, SPACE to act. Not every game reads every key.');

cfg.games = [{ name: GAME, category: 'playtest', controls }];
// build-study.mjs always emits a practice block and refuses one that is also a
// scored game, so the practice block here is an unused file rather than something
// to switch off. Keep the study's pong unless pong is what you asked to play.
if (cfg.practice?.game === GAME) {
  cfg.practice = { ...cfg.practice, game: GAME === 'pong' ? 'breakout' : 'pong' };
}
if (SECONDS > 0) cfg.blockSeconds = SECONDS;

mkdirSync(OUT, { recursive: true });
rmSync(SITE, { recursive: true, force: true });
mkdirSync(SITE, { recursive: true });
const tmpConfig = join(SITE, 'quickplay-config.json');
writeFileSync(tmpConfig, JSON.stringify(cfg, null, 2));

const UPLOAD = `http://localhost:${PORT}/api/session`;
let r = spawnSync(process.execPath, [
  join(__dirname, 'build-study.mjs'),
  '--config', tmpConfig, '--games', GAMES_DIR, '--out', SITE, '--upload', UPLOAD,
], { stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8' });
if (r.status !== 0) process.exit(r.status ?? 1);

// The block page, opened on its own with an upload URL, posts itself as a one-block
// session (study-templates.mjs `parent === window && UPLOAD_URL`). So there is nothing
// to add here: serve it, open it, and wait for the POST.
const before = new Set(readdirSync(OUT));
const serve = spawn(process.execPath, [
  join(__dirname, 'study-serve.mjs'),
  '--port', String(PORT), '--no-build', '--site', SITE, '--sessions', OUT,
], { stdio: ['inherit', 'pipe', 'inherit'] });

const URL_ = `http://localhost:${PORT}/block/${encodeURIComponent(GAME)}/`;
let opened = false;
serve.stdout.on('data', chunk => {
  process.stdout.write(chunk);
  if (opened || !String(chunk).includes('study ')) return;
  opened = true;
  console.log(`\n  ${GAME}  ${cfg.blockSeconds}s block, seeds from ${cfg.seedBase}`);
  console.log(`  ${URL_}`);
  if (guessed) console.log(`  controls are a GUESS (no entry in ${CONFIG}): ${controls}`);
  console.log(`\n  click Start, play until the timer runs out, and it saves itself.\n`);
  const cmd = process.platform === 'darwin' ? 'open'
            : process.platform === 'win32' ? 'start' : 'xdg-open';
  spawnSync(cmd, [URL_], { stdio: 'ignore', shell: process.platform === 'win32' });
});

// The server prints "session complete: <file>" on the POST. Watch the directory
// rather than parse that, so a rename or a reworded log line cannot break this.
const poll = setInterval(() => {
  const fresh = readdirSync(OUT).filter(f => f.endsWith('.json') && !before.has(f));
  if (!fresh.length) return;
  clearInterval(poll);
  const file = join(OUT, fresh.sort().pop());
  serve.kill();

  console.log(`\n  saved ${file}`);
  const s = JSON.parse(readFileSync(file, 'utf8'));
  const eps = (s.blocks || []).flatMap(b => b.episodes || []);
  const kept = eps.filter(e => !e.discarded);
  const best = kept.length ? Math.max(...kept.map(e => e.score)) : null;
  const mean = kept.length ? kept.reduce((a, e) => a + e.score, 0) / kept.length : null;
  console.log(`  ${kept.length} rounds  best ${best}  mean ${mean === null ? '-' : mean.toFixed(1)}`
              + `${eps.length > kept.length ? `  (+${eps.length - kept.length} cut by the clock, not scored)` : ''}`);

  console.log(`\n  verifying the replay reproduces it...\n`);
  // --no-pins on purpose. games-at-study-time/ pins the revisions the paper's
  // participants played, and its vvvvvv.js already differs from the shipped one; you
  // just played the shipped file, so replaying against a pin would report a mismatch
  // that is really a version difference.
  const v = spawnSync(process.execPath, [
    join(__dirname, 'verify-replay.mjs'), file, '--games', GAMES_DIR, '--no-pins',
  ], { stdio: 'inherit' });

  if (v.status !== 0) {
    console.log(`\n  replay MISMATCH -- the browser and headless paths disagree, so this session`
                + `\n  is not comparable to an agent's. Do not render a clip from it.\n`);
    process.exit(v.status ?? 1);
  }

  // replay-video drops the round the timer cut off, so on a short block -- where the
  // clock usually fires before you die -- the default command would render nothing.
  // Print the one that matches what is actually in the file.
  const cut = eps.length - kept.length;
  const flags = kept.length ? '--best' : '--include-discarded';
  console.log(`\n  render a clip:\n    node study/replay-video.mjs ${file} `
              + `--game ${GAME} ${flags} --format mp4\n`);
  if (!kept.length && cut) {
    console.log(`  (no round ended on the game's terms, so that renders the round the clock`);
    console.log(`   cut off -- fine for a clip, but its score understates the round.`);
    console.log(`   Play a longer block with --seconds if you want a death on camera.)\n`);
  }
  process.exit(0);
}, 400);

process.on('SIGINT', () => { clearInterval(poll); serve.kill(); process.exit(130); });
