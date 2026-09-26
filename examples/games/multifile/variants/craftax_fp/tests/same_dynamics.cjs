#!/usr/bin/env node
// same_dynamics.cjs — step craftax_fp and craftax_classic side by side and
// compare the canonical state, byte for byte, every step (T4).
//
// The whole "same task, different observation" claim rests on this. The
// variant reuses classic's dynamics files by manifest path, so in principle
// the two cannot disagree — but "in principle" is what a gate is for: a
// stray global in the fp renderer that shadowed a dynamics name, or a source
// accidentally dropped from the manifest, would show up here and nowhere else.
//
// Both bundles are evaluated in their OWN function scope, so their top-level
// consts cannot collide, and compared in-process — piping two 6880-byte dumps
// per step for 49,061 steps would be a third of a gigabyte.
//
//   node tests/same_dynamics.cjs <fp.js> <classic.js> <traces-dir> <corpus.json>
//
// Prints a JSON summary. Exit 1 on any difference, with the exact episode,
// step, byte offset and the two values.
const fs = require('fs');
const path = require('path');

const [fpPath, clPath, tracesDir, corpusPath] = process.argv.slice(2);
if (!fpPath || !clPath || !tracesDir || !corpusPath) {
  console.error('usage: same_dynamics.cjs <fp.js> <classic.js> <traces-dir> <corpus.json>');
  process.exit(2);
}

// The dynamics surface. computeSymbolicObs comes from 85_obs_symbolic.js,
// which both bundles carry; fnv1a64 from common/parity.js, for the chains.
const SURFACE = 'createState,newEpisode,stepGame,getParityState,computeSymbolicObs,fnv1a64';
function load(file) {
  const src = fs.readFileSync(file, 'utf8');
  return new Function(`${src}\nreturn {${SURFACE}};`)();
}

const fp = load(fpPath);
const cl = load(clPath);

const corpus = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
const STATE_BYTES = corpus.state_bytes;

function fail(msg) {
  console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
  process.exit(1);
}

let episodes = 0;
let steps = 0;
let symbolicSteps = 0;
let chainSteps = 0;

for (const ep of corpus.episodes) {
  const actions = fs.readFileSync(path.join(tracesDir, ep.file));
  const chainFile = path.join(tracesDir, 'golden', path.basename(ep.file, '.bin') + '.fnv');
  const chain = fs.existsSync(chainFile) ? fs.readFileSync(chainFile) : null;

  const a = fp.createState();
  const b = cl.createState();
  fp.newEpisode(a, ep.seed);
  cl.newEpisode(b, ep.seed);

  for (let t = 0; t < actions.length; t++) {
    const ra = fp.stepGame(a, actions[t]);
    const rb = cl.stepGame(b, actions[t]);

    const da = fp.getParityState(a, ra.reward);
    const db = cl.getParityState(b, rb.reward);
    if (da.length !== STATE_BYTES || db.length !== STATE_BYTES) {
      fail(`${ep.file} step ${t + 1}: dump is ${da.length}/${db.length} bytes, expected ${STATE_BYTES}`);
    }
    for (let i = 0; i < STATE_BYTES; i++) {
      if (da[i] !== db[i]) {
        fail(`${ep.file} seed ${ep.seed} step ${t + 1}: canonical state byte ${i} `
           + `fp ${da[i]} vs classic ${db[i]}`);
      }
    }
    if (!!ra.done !== !!rb.done) {
      fail(`${ep.file} seed ${ep.seed} step ${t + 1}: done fp ${!!ra.done} vs classic ${!!rb.done}`);
    }

    // Symbolic observation: 85_obs_symbolic.js is reused verbatim, and this
    // says so in bytes rather than by assertion.
    const oa = fp.computeSymbolicObs(a);
    const ob = cl.computeSymbolicObs(b);
    if (oa.length !== ob.length) {
      fail(`${ep.file} step ${t + 1}: symbolic obs ${oa.length} vs ${ob.length} floats`);
    }
    const ba = Buffer.from(oa.buffer, oa.byteOffset, oa.length * 4);
    const bb = Buffer.from(ob.buffer, ob.byteOffset, ob.length * 4);
    for (let i = 0; i < ba.length; i++) {
      if (ba[i] !== bb[i]) {
        fail(`${ep.file} seed ${ep.seed} step ${t + 1}: symbolic obs float ${(i / 4) | 0} `
           + `byte ${i % 4}: fp ${ba[i]} vs classic ${bb[i]} (values ${oa[(i / 4) | 0]} / ${ob[(i / 4) | 0]})`);
      }
    }
    symbolicSteps++;

    // And against the chains committed for craftax_classic (traces/golden/),
    // which are the C driver's own record of every episode.
    //
    // Only the reward bits and the done flag are compared, NOT the chain's
    // state hash. That is not a gap being papered over — the chain's hash
    // column cannot be reproduced from the canonical state by anyone. The C
    // driver writes `fnv1a64(buf, nb)` and then `fwrite(buf, 1, nb)` from the
    // same buffer, yet in its own output the stored hash is not FNV-1a of the
    // bytes that follow it (checked directly: cc_ref run seed 0
    // uniform_000.bin --dump-every 1 stores 8400bbda888c0c14 for step 1 and
    // dumps a state whose FNV-1a is 0e925c8efd402f7a, for all 201 steps).
    // Whatever that column is, it is a property of the reference driver and
    // has nothing to do with this variant. What IS checked, and is much
    // stronger, is that the fp state equals the classic state above, and that
    // classic equals the C's dumped state — which is G2, in
    // craftax_classic/tests/test_lockstep.py.
    if (chain && t * 13 + 13 <= chain.length) {
      const rewardBits = Buffer.from(da.buffer, da.byteOffset, da.length)
        .readUInt32LE(STATE_BYTES - 4);
      const wantReward = chain.readUInt32LE(t * 13 + 8);
      const wantDone = chain[t * 13 + 12];
      if (rewardBits !== wantReward) {
        fail(`${ep.file} seed ${ep.seed} step ${t + 1}: reward bits `
           + `fp ${rewardBits.toString(16)} vs committed chain ${wantReward.toString(16)}`);
      }
      if ((ra.done ? 1 : 0) !== wantDone) {
        fail(`${ep.file} seed ${ep.seed} step ${t + 1}: done `
           + `fp ${ra.done ? 1 : 0} vs committed chain ${wantDone}`);
      }
      chainSteps++;
    }

    steps++;
    if (ra.done) break;
  }
  episodes++;
}

console.log(JSON.stringify({
  ok: true, episodes, steps, symbolic_steps: symbolicSteps, chain_steps: chainSteps,
  state_bytes: STATE_BYTES,
}, null, 2));
