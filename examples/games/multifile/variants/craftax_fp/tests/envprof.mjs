#!/usr/bin/env node
// envprof.mjs — V8 throughput for craftax_fp against craftax_classic, through
// the node GameEnv, which is the training path (FIRST_PERSON_PLAN.md §8).
//
// In-process on purpose: PlayTrainEnv's Python wrapper adds an IPC round trip
// per step, which is a real cost for a trainer but not a property of the game,
// and it would swamp the difference this is measuring.
//
// Two numbers the plan warns against, and why they are not used here:
//   * `qjs_host bench` always renders and ignores the obs mode, so it cannot
//     measure symbolic or no-draw. It is the right tool for QuickJS PIXEL
//     throughput and is reported separately.
//   * `reference_trace.mjs` spends most of its time in fnv1a, so its timings
//     are not environment throughput at all.
//
//   node envprof.mjs <steps>
import { GameEnv } from '../../../../../../runtime/p5/game-env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../../../..');
const STEPS = Number(process.argv[2] || 20000);

const GAMES = [
  ['craftax_fp', path.join(HERE, '..', 'dist', 'craftax_fp.js')],
  ['craftax_classic', path.join(REPO, 'examples/games/multifile/parity/craftax_classic/dist/craftax_classic.js')],
];

function sidecar(gamePath) {
  return JSON.parse(fs.readFileSync(gamePath.replace(/\.js$/, '.json'), 'utf8'));
}

function measure(gamePath, obsMode, steps) {
  const sc = sidecar(gamePath);
  const env = new GameEnv({
    gamePath, obsWidth: 64, obsHeight: 64, obsMode,
    maxSteps: 1_000_000, actions: sc.actions,
  });
  env.reset({ seed: 1 });
  // Warm V8 up: the first few hundred steps are interpreted, then optimised.
  for (let i = 0; i < 2000; i++) env.step((i * 3 + 1) % sc.actions.length);
  env.reset({ seed: 1 });
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < steps; i++) env.step((i * 3 + 1) % sc.actions.length);
  const t1 = process.hrtime.bigint();
  const secs = Number(t1 - t0) / 1e9;
  return { steps, secs, sps: steps / secs, us_per_step: (secs * 1e6) / steps };
}

// Dynamics only: step the bundle's own stepGame with no host, no observation
// and no renderer. This is the "no draw" column of the plan's §8 table, and it
// is what makes the render cost attributable — `symbolic` is NOT no-draw,
// because computing the 1345-float observation is itself a sizeable loop.
function measureDynamics(gamePath, steps) {
  const src = fs.readFileSync(gamePath, 'utf8');
  const g = new Function(`${src}\nreturn { createState, newEpisode, stepGame };`)();
  const sc = sidecar(gamePath);
  const st = g.createState();
  g.newEpisode(st, 1);
  for (let i = 0; i < 2000; i++) g.stepGame(st, (i * 3 + 1) % sc.actions.length);
  g.newEpisode(st, 1);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < steps; i++) g.stepGame(st, (i * 3 + 1) % sc.actions.length);
  const t1 = process.hrtime.bigint();
  const secs = Number(t1 - t0) / 1e9;
  return { steps, secs, sps: steps / secs, us_per_step: (secs * 1e6) / steps };
}

const out = { node: process.version, steps: STEPS, results: {} };
for (const [name, gamePath] of GAMES) {
  for (const mode of ['rgb', 'symbolic']) {
    const r = measure(gamePath, mode, STEPS);
    out.results[`${name}/${mode}`] = r;
    console.log(`${name.padEnd(16)} ${mode.padEnd(9)} ${r.sps.toFixed(0).padStart(8)} SPS  ${r.us_per_step.toFixed(1).padStart(7)} us/step`);
  }
  const d = measureDynamics(gamePath, STEPS);
  out.results[`${name}/dynamics`] = d;
  console.log(`${name.padEnd(16)} ${'dynamics'.padEnd(9)} ${d.sps.toFixed(0).padStart(8)} SPS  ${d.us_per_step.toFixed(1).padStart(7)} us/step`);
}
if (process.env.ENVPROF_JSON) {
  fs.writeFileSync(process.env.ENVPROF_JSON, JSON.stringify(out, null, 2) + '\n');
}
