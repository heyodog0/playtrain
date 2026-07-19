/**
 * IPC worker for the batched vec renderer (VecGameEnv). Hosts N envs in one
 * process on one shared WebGPU device. Same 8-byte-header framing as
 * game-worker.mjs; batched payloads.
 *
 *   reset: meta {cmd:'reset', seeds:[...]}            -> binary: N*tile*tile*3 obs
 *   step:  meta {cmd:'step', actions:[...N*A...], num_steps:K}
 *            -> binary: [N f32 rewards][N u8 term][N u8 trunc][N*tile*tile*3 obs]
 */

import { openSync, writeSync } from 'fs';
import { VecGameEnv } from './vec-game-env.mjs';

// Optional shared-memory fast path for the batched step payload.
const MMAP_PATH = process.env.PLAYTRAIN_VEC_MMAP_PATH || null;
let MMAP_FD = null;
if (MMAP_PATH) {
  try { MMAP_FD = openSync(MMAP_PATH, 'r+'); }
  catch (e) { process.stderr.write(`vec mmap open failed: ${e.message}\n`); }
}

function parseArgs() {
  const a = process.argv.slice(2);
  const o = { gamePath: null, numEnvs: 1, tile: 84, maxSteps: 3600, actionSize: 7 };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--game') o.gamePath = a[++i];
    else if (a[i] === '--num-envs') o.numEnvs = parseInt(a[++i], 10);
    else if (a[i] === '--tile') o.tile = parseInt(a[++i], 10);
    else if (a[i] === '--max-steps') o.maxSteps = parseInt(a[++i], 10);
    else if (a[i] === '--action-size') o.actionSize = parseInt(a[++i], 10);
  }
  if (!o.gamePath) { process.stderr.write('Error: --game required\n'); process.exit(1); }
  return o;
}

const opts = parseArgs();
const env = new VecGameEnv(opts);
const N = opts.numEnvs;
const A = opts.actionSize;

let pending = Buffer.alloc(0);

function sendFrame(meta, binary = Buffer.alloc(0)) {
  const metaBuf = Buffer.from(JSON.stringify(meta), 'utf8');
  const header = Buffer.alloc(8);
  header.writeUInt32BE(metaBuf.length, 0);
  header.writeUInt32BE(binary.length, 4);
  process.stdout.write(Buffer.concat([header, metaBuf, binary]));
}

function packStep(result) {
  // [N f32 rewards][N u8 term][N u8 trunc][obs bytes]
  const rew = Buffer.from(result.rewards.buffer, result.rewards.byteOffset, result.rewards.byteLength);
  const term = Buffer.from(result.term);
  const trunc = Buffer.from(result.trunc);
  const obs = Buffer.from(result.obs);
  return Buffer.concat([rew, term, trunc, obs]);
}

async function handle(req) {
  if (req.cmd === 'ping') return sendFrame({ ok: true, num_envs: N, action_size: A, tile: opts.tile });
  if (req.cmd === 'reset') {
    const seeds = Uint32Array.from(req.seeds);
    const obs = await env.reset(seeds);
    return sendFrame({ ok: true }, Buffer.from(obs));
  }
  if (req.cmd === 'step') {
    const actions = Float32Array.from(req.actions);
    const result = await env.step(actions, req.num_steps || 1);
    const payload = packStep(result);
    if (MMAP_FD !== null) {
      // Write the batched payload to shared memory; pipe carries only a sync flag.
      writeSync(MMAP_FD, payload, 0, payload.length, 0);
      return sendFrame({ ok: true, mmap: true });
    }
    return sendFrame({ ok: true }, payload);
  }
  if (req.cmd === 'close') {
    env.close();
    return sendFrame({ ok: true, closed: true }, Buffer.alloc(0));
  }
  throw new Error('unknown cmd ' + req.cmd);
}

async function pump() {
  while (pending.length >= 8) {
    const mlen = pending.readUInt32BE(0), blen = pending.readUInt32BE(4);
    if (pending.length < 8 + mlen + blen) return;
    const meta = JSON.parse(pending.subarray(8, 8 + mlen).toString('utf8'));
    pending = pending.subarray(8 + mlen + blen);
    try { await handle(meta); } catch (e) { sendFrame({ ok: false, error: String(e && e.message || e) }); }
    if (meta.cmd === 'close') { process.stdin.pause(); process.exit(0); }
  }
}

process.stdin.on('data', (c) => { pending = Buffer.concat([pending, c]); pump(); });
process.stdin.on('end', () => env.close());
