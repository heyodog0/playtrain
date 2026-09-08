#!/usr/bin/env node
// Build the human-baseline study site: a fully self-contained static bundle.
// Every page inlines PlayTrain's own rasterizer + p5 shim, so there are zero
// external requests at play time and the whole thing serves from any static host.
//
//   <out>/index.html                 - session shell (consent, order, upload)
//   <out>/block/<name>/index.html    - one timed block per game
//   <out>/block/<name>-obs/index.html- same game at the agent's 64x64 resolution
//
// Usage:
//   node study/build-study.mjs
//   node study/build-study.mjs --config study/study-config.json --out dist/study \
//                              --upload https://example.com/api/session

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { createHash } from 'crypto';
import { dirname, resolve, join } from 'path';
import { fileURLToPath } from 'url';
import { blockPage, sessionPage } from './study-templates.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const CONFIG_PATH = resolve(arg('--config', join(__dirname, 'study-config.json')));
// MUST match what the trainers resolve, or the human plays a different game than the
// agent trained on. src/playtrain/runtime/env.py:22 sets DEFAULT_GAMES_DIR to the bundled
// _asset("examples/games/js"), and the sbatch overrides point there too -- NOT to
// games/js, whose breakout/seaquest/pong are pre-ALE-alignment revisions with different
// lives, scoring and death penalties. Override with --games only to match a run that used
// PLAYTRAIN_GAMES_DIR.
const GAMES_DIR = resolve(arg('--games',
  process.env.PLAYTRAIN_GAMES_DIR || join(REPO_ROOT, 'examples', 'games', 'js')));
const OUT_DIR = resolve(arg('--out', join(REPO_ROOT, 'dist', 'study')));
const UPLOAD_URL = arg('--upload', process.env.STUDY_UPLOAD_URL || '');
const COMPLETION_URL = arg('--completion', process.env.STUDY_COMPLETION_URL || '');
// The platform's completion code, for the manual-submit path when an upload fails. Ours (PT-...)
// is not a code Prolific accepts, so showing it there would strand the participant. Default it
// out of the completion URL's cc= parameter, which is where it always lives.
const COMPLETION_CODE = arg('--completion-code',
  process.env.STUDY_COMPLETION_CODE || (COMPLETION_URL.match(/[?&]cc=([^&]+)/) || [])[1] || '');

const cfg = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));

// The consent form in study-screens.mjs is a template. Its institution-specific fields are
// blank in the shipped config and render as visible [placeholders], which is harmless when
// you are playing the study yourself and unacceptable the moment a real participant reads
// it. --upload is the flag that distinguishes the two: it is what makes sessions land on a
// server, so it is where collection actually begins. Refuse there, warn otherwise.
const CONSENT_FIELDS = ['compensationRate', 'contactName', 'contactEmail', 'piName', 'piEmail',
                        'irbName', 'irbPhone', 'irbEmail'];
const missing = CONSENT_FIELDS.filter(k => !(cfg.study || {})[k]);
if (missing.length && UPLOAD_URL) {
  console.error(`refusing to build a collecting study with an incomplete consent form.`);
  console.error(`  unset in ${CONFIG_PATH}: ${missing.join(', ')}`);
  console.error(`  fill these in from your own ethics approval, and read the header of`);
  console.error(`  study/study-screens.mjs before using its consent text as your own.`);
  process.exit(1);
}

function writeFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function sourceFor(name) {
  const p = join(GAMES_DIR, `${name}.js`);
  if (!existsSync(p)) {
    console.error(`game not found: ${p}`);
    process.exit(1);
  }
  const src = readFileSync(p, 'utf8');
  // The study games are all pure p5. A Matter.js game would need the vendored
  // engine inlined the way tools/play-templates.mjs does it -- fail loudly rather
  // than ship a page that throws on the participant's machine.
  if (/\bMatter\./.test(src)) {
    console.error(`${name} needs Matter.js, which the study builder does not inline yet.`);
    process.exit(1);
  }
  return src;
}

if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const obsSet = new Set(cfg.obsResBlocks || []);
const blocks = [];

// Warm-up, so the participant learns the harness (timer, rounds, auto-restart, round
// summary) before anything is scored. Must NOT be one of the eight scored games --
// practising one of them would hand it an advantage the other seven never get. Not
// scored, and not included in the session record.
const practice = cfg.practice || { game: 'pong', seconds: 25, controls: '' };
if (cfg.games.some(g => g.name === practice.game)) {
  console.error(`practice game "${practice.game}" is also a scored game; pick one outside cfg.games`);
  process.exit(1);
}
blocks.push({ game: practice.game, practice: true, obsRes: false, href: `block/practice/` });
writeFile(join(OUT_DIR, 'block', 'practice', 'index.html'),
  blockPage(practice.game, sourceFor(practice.game), {
    ...cfg, blockSeconds: practice.seconds ?? 25,
    controls: practice.controls, isPractice: true, uploadUrl: UPLOAD_URL,
  }));

for (const g of cfg.games) {
  writeFile(join(OUT_DIR, 'block', g.name, 'index.html'),
    blockPage(g.name, sourceFor(g.name),
      { ...cfg, controls: g.controls, uploadUrl: UPLOAD_URL }));
  blocks.push({ game: g.name, practice: false, obsRes: false, href: `block/${g.name}/` });

  if (obsSet.has(g.name)) {
    writeFile(join(OUT_DIR, 'block', `${g.name}-obs`, 'index.html'),
      blockPage(g.name, sourceFor(g.name), {
        ...cfg, obsRes: true, uploadUrl: UPLOAD_URL,
        controls: `${g.controls}<br><br>This round is shown at the low resolution the AI sees.`,
      }));
    blocks.push({ game: g.name, practice: false, obsRes: true, href: `block/${g.name}-obs/` });
  }
}

writeFile(join(OUT_DIR, 'index.html'),
  sessionPage(blocks, {
    uploadUrl: UPLOAD_URL, completionUrl: COMPLETION_URL, completionCode: COMPLETION_CODE,
    blockSeconds: cfg.blockSeconds, maxSteps: cfg.maxSteps, study: cfg.study,
    canvasSize: cfg.canvasSize,
    nScoredBlocks: blocks.filter(b => !b.practice).length,
  }));
writeFile(join(OUT_DIR, 'robots.txt'), 'User-agent: *\nDisallow: /\n');

// Record which game sources went into this build, hashed. The whole comparability
// argument rests on the participant playing the same file the agent trained on, and
// there is more than one copy of some games in this repo (games/js vs examples/games/js
// differ for breakout, seaquest and pong). A manifest makes the choice auditable after
// the fact instead of implicit in whatever --games happened to be passed.
const manifest = {
  builtAt: new Date().toISOString(),
  gamesDir: GAMES_DIR,
  config: { blockSeconds: cfg.blockSeconds, frameSkip: cfg.frameSkip, maxSteps: cfg.maxSteps,
            seedBase: cfg.seedBase, seedCount: cfg.seedCount, actionMode: cfg.actionMode,
            canvasSize: cfg.canvasSize },
  games: {},
};
for (const name of [practice.game, ...cfg.games.map(g => g.name)]) {
  manifest.games[name] = createHash('sha256')
    .update(readFileSync(join(GAMES_DIR, `${name}.js`))).digest('hex').slice(0, 16);
}
writeFile(join(OUT_DIR, 'build-manifest.json'), JSON.stringify(manifest, null, 2));

const scored = blocks.filter(b => !b.practice).length;
const mins = ((scored * cfg.blockSeconds) + (practice.seconds ?? 25)) / 60;
console.log(`built ${blocks.length} blocks (${scored} scored) → ${OUT_DIR}`);
console.log(`  ~${mins.toFixed(1)} min of play per participant, actionMode=${cfg.actionMode}`);
console.log(`  practice: ${practice.game} (${practice.seconds}s), not scored`);
console.log(`  seeds ${cfg.seedBase}..${cfg.seedBase + (cfg.seedCount ?? 100) - 1}, identical for every participant`);
console.log(`  games from ${GAMES_DIR}`);
console.log(`    (must match what the trainers used -- env.py defaults to examples/games/js)`);
if (!UPLOAD_URL) console.log('  no --upload set: participants will download a JSON file instead');
if (missing.length) {
  console.log(`  consent form INCOMPLETE, for local play only: ${missing.join(', ')} unset`);
}
console.log(COMPLETION_CODE
  ? `  manual-submit code (upload-failure path): ${COMPLETION_CODE}`
  : '  no completion code: an upload failure shows only the PT- reference, which recruitment platforms reject');
