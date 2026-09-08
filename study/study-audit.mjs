#!/usr/bin/env node
// study-audit.mjs — did the participants play the same game files the agents trained on?
//
// This is the one error replay verification structurally cannot catch. verify-replay proves the
// browser and the headless runtime agree, but if BOTH read a game the agent never saw they agree
// with each other perfectly while measuring the wrong thing. The only defence is comparing the
// bytes, which is what dist/study/build-manifest.json exists for.
//
// It is not a hypothetical. vvvvvv's scoring was redesigned (progress + a 1000 win bonus ->
// +50 per collectible, -50 on death) at 15:08 on 2026-07-25, and the vvvvvv training runs
// started at 15:43 the same day. Thirty-five minutes the other way and the agent and human
// numbers would have been on different reward scales, with nothing in either pipeline to say so.
//
//   node study/study-audit.mjs <games-dir>            # a checkout on this machine
//   node study/study-audit.mjs --ref 8e38a6e          # a commit in this repo
//   node study/study-audit.mjs --hashes cluster.txt   # "name<space>hash" lines from anywhere
//   node study/study-audit.mjs --remote-cmd <dir>     # print the one-liner to run on a cluster
//
// Exits non-zero on any mismatch or missing game, so it can gate a launch.

import { readFileSync, existsSync, statSync, readdirSync } from 'fs';
import { createHash } from 'crypto';
import { spawnSync } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const positional = process.argv.slice(2).filter((a, i, all) =>
  !a.startsWith('--') && !(i > 0 && all[i - 1].startsWith('--')));

const sha16 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);
const GAMES_SUBDIR = arg('--ref-dir', 'examples/games/js');

// --- the reference: what the deployed study actually shipped ----------------
const MANIFEST = resolve(arg('--manifest', join(REPO_ROOT, 'dist', 'study', 'build-manifest.json')));
let manifest, refLabel;
if (existsSync(MANIFEST)) {
  manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  refLabel = `build manifest (built ${manifest.builtAt}, from ${manifest.gamesDir})`;
} else if (existsSync(join(__dirname, 'study-manifest.json'))) {
  // No local build, so fall back to the committed record of what the PAPER's study ran. This is
  // the reference that matters for anyone checking published numbers, and it is what makes a
  // later edit to a study game show up here instead of silently changing what the numbers mean.
  manifest = JSON.parse(readFileSync(join(__dirname, 'study-manifest.json'), 'utf8'));
  refLabel = `study/study-manifest.json (the sources the paper's sessions were played on)`;
} else {
  // Fall back to the working tree so the tool still answers, and say so loudly -- the working
  // tree is what the NEXT build would ship, not what the last one did.
  const cfg = JSON.parse(readFileSync(join(__dirname, 'study-config.json'), 'utf8'));
  const dir = join(REPO_ROOT, GAMES_SUBDIR);
  const names = [cfg.practice.game, ...cfg.games.map(g => g.name)];
  manifest = { builtAt: null, gamesDir: dir, games: {} };
  for (const n of names) manifest.games[n] = sha16(readFileSync(join(dir, `${n}.js`)));
  refLabel = `working tree at ${GAMES_SUBDIR} (no build manifest found — run just study-build)`;
}
const GAMES = Object.keys(manifest.games);

// --- the candidate: whatever we are auditing against -----------------------
function fromDir(dir) {
  const out = {};
  for (const g of GAMES) {
    const p = join(dir, `${g}.js`);
    out[g] = existsSync(p)
      ? { hash: sha16(readFileSync(p)), mtime: statSync(p).mtime.toISOString().slice(0, 10) }
      : null;
  }
  return out;
}

function fromRef(ref) {
  const out = {};
  for (const g of GAMES) {
    const r = spawnSync('git', ['show', `${ref}:${GAMES_SUBDIR}/${g}.js`],
      { cwd: REPO_ROOT, maxBuffer: 1 << 26 });
    out[g] = r.status === 0 ? { hash: sha16(r.stdout), mtime: null } : null;
  }
  return out;
}

// "name hash" or "name<TAB>hash" per line, extra columns ignored. This is the path for a
// machine you cannot reach from here: run --remote-cmd there, paste the output into a file.
function fromHashFile(path) {
  const out = {};
  const seen = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.trim().match(/^([A-Za-z0-9_.-]+?)(?:\.js)?[\s|]+([0-9a-f]{16,64})/);
    if (m) seen[m[1]] = m[2].slice(0, 16);
  }
  for (const g of GAMES) out[g] = seen[g] ? { hash: seen[g], mtime: null } : null;
  return out;
}

// --- --remote-cmd: emit a shell one-liner, so the remote side needs nothing installed ------
const remoteDir = arg('--remote-cmd', null);
if (remoteDir) {
  console.log(`# run this on the remote machine, then: node study/study-audit.mjs --hashes <file>`);
  console.log(`for g in ${GAMES.join(' ')}; do printf "%s %s\\n" "$g" ` +
              `"$(sha256sum ${remoteDir}/$g.js 2>/dev/null | cut -c1-16)"; done`);
  process.exit(0);
}

let candidate, candLabel;
const ref = arg('--ref', null);
const hashFile = arg('--hashes', null);
if (ref) { candidate = fromRef(ref); candLabel = `git ${ref}:${GAMES_SUBDIR}`; }
else if (hashFile) { candidate = fromHashFile(hashFile); candLabel = `hashes from ${hashFile}`; }
else if (positional[0]) {
  const dir = resolve(positional[0]);
  if (!existsSync(dir)) { console.error(`no such directory: ${dir}`); process.exit(2); }
  candidate = fromDir(dir); candLabel = dir;
} else {
  console.error(`usage: study-audit.mjs <games-dir> | --ref <commit> | --hashes <file> | --remote-cmd <dir>`);
  process.exit(2);
}

// --- compare ---------------------------------------------------------------
console.log(`reference: ${refLabel}`);
console.log(`candidate: ${candLabel}\n`);

// Games whose study-time source is pinned in study/games-at-study-time/. A difference on
// one of these is expected and handled, rather than an error.
const PINS_DIR = join(__dirname, 'games-at-study-time');
const pinned = {};
if (existsSync(PINS_DIR)) {
  for (const f of readdirSync(PINS_DIR)) {
    if (f.endsWith('.js')) pinned[f.slice(0, -3)] = sha16(readFileSync(join(PINS_DIR, f)));
  }
}

let bad = 0, missing = 0, pinnedDrift = 0;
for (const g of GAMES) {
  const want = manifest.games[g];
  const got = candidate[g];
  if (!got) {
    console.log(`  MISSING   ${g.padEnd(14)} expected ${want}`);
    missing++;
    continue;
  }
  if (got.hash === want) {
    console.log(`  ok        ${g.padEnd(14)} ${want}${got.mtime ? '  ' + got.mtime : ''}`);
  } else if (pinned[g] === want) {
    // The candidate has moved on from the study, and study/games-at-study-time/ holds the
    // revision the sessions were played on, so replay still checks the right file. Worth
    // saying out loud every time -- an unpinned drift is a silent error, and a pinned one
    // means the shipped game no longer scores the way the published numbers do.
    console.log(`  pinned    ${g.padEnd(14)} study ${want}  !=  shipped ${got.hash}` +
                `${got.mtime ? '  (' + got.mtime + ')' : ''}`);
    pinnedDrift++;
  } else {
    console.log(`  MISMATCH  ${g.padEnd(14)} study ${want}  !=  candidate ${got.hash}` +
                `${got.mtime ? '  (' + got.mtime + ')' : ''}`);
    bad++;
  }
}

// A build manifest that no longer matches the files on disk means the DEPLOYED study is stale.
if (manifest.builtAt && !ref && !hashFile) {
  const tree = fromDir(join(REPO_ROOT, GAMES_SUBDIR));
  const drifted = GAMES.filter(g => tree[g] && tree[g].hash !== manifest.games[g]);
  if (drifted.length) {
    console.log(`\n  !! the working tree has moved on from the shipped build: ${drifted.join(', ')}`);
    console.log('     rebuild and redeploy, or the study is serving games you have since edited.');
  }
}

console.log();
if (!bad && !missing) {
  console.log(`PASS: all ${GAMES.length} games match what the study shipped` +
              (pinnedDrift ? `, ${pinnedDrift} of them through study/games-at-study-time/.` : '.'));
  if (pinnedDrift) {
    console.log('A pinned game scores differently in the shipped catalog than it did for the');
    console.log('participants, so retraining it will not reproduce the published return.');
  }
} else {
  console.log(`FAIL: ${bad} mismatched, ${missing} missing.`);
  console.log('The humans and the agents did not play the same game. Nothing downstream detects');
  console.log('this on its own -- replay verification would pass on both sides independently.');
  process.exit(1);
}
