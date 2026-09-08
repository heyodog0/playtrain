#!/usr/bin/env node
// Replay a human session through the HEADLESS env and check it reproduces.
//
// This is the acceptance test behind the paper's claim that participants and agents
// play identical, seed-controlled tasks. The browser harness logs, per episode, a seed
// and a frame-indexed list of Discrete(8) actions. Feeding that same seed and that same
// action list to runtime/p5/game-env.mjs must yield the same score, the same frame count
// and the same termination -- if it does, the two runtimes are the same environment, and
// that is a verified fact rather than an assertion about shared source code.
//
// A mismatch means the browser and headless paths have diverged (rasterizer, RNG phase,
// frame-count reset, action semantics) and the human numbers are NOT comparable.
//
// Usage:
//   node tools/verify-replay.mjs session.json
//   node tools/verify-replay.mjs sessions/*.json --games games/js
//
// GameEnv loads one game per process (game-env.mjs `gameLoaded`), so the parent groups
// episodes by game and spawns one child per game.

import { readFileSync } from 'fs';
import { dirname, resolve, join } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const SELF = fileURLToPath(import.meta.url);

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
// Same default as tools/build-study.mjs. If these two disagree the replay check is
// self-consistent but measures a game the agent never trained on.
const GAMES_DIR = resolve(arg('--games',
  process.env.PLAYTRAIN_GAMES_DIR || join(REPO_ROOT, 'examples', 'games', 'js')));

// ---------------------------------------------------------------------------
// Child: verify every episode of a single game in a fresh process.
// ---------------------------------------------------------------------------
if (process.argv.includes('--child')) {
  const game = arg('--child');
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const episodes = JSON.parse(Buffer.concat(chunks).toString('utf8'));

  const { GameEnv } = await import('../runtime/p5/game-env.mjs');
  const results = [];

  for (const ep of episodes) {
    const env = new GameEnv({
      gamePath: join(GAMES_DIR, `${game}.js`),
      frameSkip: ep.frameSkip ?? 1,
      maxSteps: ep.maxSteps ?? 2000,
    });
    env.reset({ seed: ep.seed });

    let terminated = false, truncated = false, steps = 0;
    for (const a of ep.actions) {
      const r = env.step(a);
      steps = env.steps;
      if (r.terminated || r.truncated) { terminated = r.terminated; truncated = r.truncated; break; }
    }

    results.push({
      seed: ep.seed,
      expected: { score: ep.score, frames: ep.frames, terminated: ep.terminated, truncated: ep.truncated },
      actual: { score: env.lastScore, frames: steps, terminated, truncated },
      // The browser stops feeding actions when its block timer fires, so a discarded
      // episode is legitimately shorter than a natural end. Score must still match.
      discarded: !!ep.discarded,
    });
  }

  process.stdout.write(JSON.stringify(results));
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Parent
// ---------------------------------------------------------------------------
const files = process.argv.slice(2).filter(a => a.endsWith('.json'));
if (!files.length) {
  console.error('usage: node tools/verify-replay.mjs <session.json> [...]');
  process.exit(1);
}

function runChild(game, episodes) {
  return new Promise((res, rej) => {
    const p = spawn(process.execPath, [SELF, '--child', game, '--games', GAMES_DIR],
      { stdio: ['pipe', 'pipe', 'inherit'] });
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.on('close', code => code === 0 ? res(JSON.parse(out)) : rej(new Error(`${game}: exit ${code}`)));
    p.stdin.end(JSON.stringify(episodes));
  });
}

let totalEp = 0, totalBad = 0;

for (const file of files) {
  const session = JSON.parse(readFileSync(file, 'utf8'));
  const byGame = new Map();

  for (const block of session.blocks || []) {
    // Blocks rendered at the agent's 64x64 resolution rasterize different geometry
    // by design, so they are not replayable against the default headless config.
    if (block.obsRes) continue;
    for (const ep of block.episodes || []) {
      if (!ep.actions || !ep.actions.length) continue;
      if (ep.actionMode && ep.actionMode !== 'quantized') continue;  // unconstrained: not Discrete(8)
      if (!byGame.has(ep.game)) byGame.set(ep.game, []);
      byGame.get(ep.game).push({ ...ep, frameSkip: session.frameSkip, maxSteps: session.maxSteps });
    }
  }

  console.log(`\n${file}  (participant ${session.participantId})`);
  for (const [game, eps] of byGame) {
    const results = await runChild(game, eps);
    const bad = results.filter(r =>
      r.actual.score !== r.expected.score ||
      r.actual.frames !== r.expected.frames ||
      (!r.discarded && r.actual.terminated !== r.expected.terminated));
    totalEp += results.length;
    totalBad += bad.length;

    const mark = bad.length ? '✗' : '✓';
    console.log(`  ${mark} ${game.padEnd(13)} ${results.length - bad.length}/${results.length} episodes reproduce`);
    for (const b of bad) {
      console.log(`      seed ${b.seed}: browser score=${b.expected.score} frames=${b.expected.frames}` +
                  ` | headless score=${b.actual.score} frames=${b.actual.frames}`);
    }
  }
}

console.log(`\n${totalEp - totalBad}/${totalEp} episodes reproduce headlessly.`);
if (totalBad) {
  console.log('MISMATCH: the browser and headless runtimes have diverged. Human scores are not');
  console.log('comparable to agent scores until this is resolved.');
  process.exit(1);
}
