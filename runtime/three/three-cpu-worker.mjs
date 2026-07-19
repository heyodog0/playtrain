/**
 * three-cpu IPC worker. Renders a STANDARD three.js scene on the CPU (Projector
 * + rasterizer, no GPU). Same binary protocol as game-worker.mjs, so the
 * PlayTrainThreeEnv client drives it unchanged.
 *
 * Lives here (PlayTrain runtime) because it imports `three`; it dynamically
 * imports the dmlab level (which exports config + createCpuInstance) by path.
 */

import { openSync, writeSync } from 'fs';
import { pathToFileURL } from 'url';
import * as THREE from 'three';
import { ThreeCPURenderer } from './three-cpu.mjs';

const DMLAB_ACTION_MEANINGS = [
  'LOOK_LEFT_RIGHT_PIXELS_PER_FRAME', 'LOOK_DOWN_UP_PIXELS_PER_FRAME',
  'STRAFE_LEFT_RIGHT', 'MOVE_BACK_FORWARD', 'FIRE', 'JUMP', 'CROUCH',
];

function parseArgs() {
  const a = process.argv.slice(2);
  const o = { gamePath: null, obsSize: Number(process.env.PLAYTRAIN_THREE_OBS_SIZE) || 84, maxSteps: 3600 };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--game') o.gamePath = a[++i];
    else if (a[i] === '--obs-size') o.obsSize = parseInt(a[++i], 10);
    else if (a[i] === '--max-steps') o.maxSteps = parseInt(a[++i], 10);
  }
  if (!o.gamePath) { process.stderr.write('Error: --game required\n'); process.exit(1); }
  return o;
}
const opts = parseArgs();
const level = await import(pathToFileURL(opts.gamePath).href);
if (typeof level.createCpuInstance !== 'function') { process.stderr.write('level missing createCpuInstance()\n'); process.exit(1); }
const renderer = new ThreeCPURenderer(opts.obsSize, opts.obsSize);
const env = level.createCpuInstance({ THREE, renderer, width: opts.obsSize, height: opts.obsSize, maxSteps: opts.maxSteps });

const MMAP_PATH = process.env.PLAYTRAIN_THREE_MMAP_PATH || null;
let MMAP_FD = null;
if (MMAP_PATH) { try { MMAP_FD = openSync(MMAP_PATH, 'r+'); } catch (e) {} }
const MMAP_SENTINEL = 0xFFFFFFFF, STEP_HEADER_SIZE = 16;
const GS = { PLAYING: 0, WIN: 1, GAMEOVER: 2, EXIT: 3 };
let pending = Buffer.alloc(0);

function send(meta, binary = Buffer.alloc(0)) {
  const m = Buffer.from(JSON.stringify(meta), 'utf8');
  const h = Buffer.alloc(8); h.writeUInt32BE(m.length, 0); h.writeUInt32BE(binary.length, 4);
  process.stdout.write(Buffer.concat([h, m, binary]));
}
function packHeader(r) {
  const h = Buffer.alloc(STEP_HEADER_SIZE);
  h.writeFloatBE(r.reward, 0); h.writeUInt8(r.terminated ? 1 : 0, 4); h.writeUInt8(r.truncated ? 1 : 0, 5);
  h.writeUInt8(GS[r.gameState] ?? 0, 6); h.writeUInt8(1, 7); h.writeInt32BE(r.score | 0, 8); h.writeInt32BE(r.steps | 0, 12);
  return h;
}
function sendStep(r) {
  const header = packHeader(r), obs = Buffer.from(r.obs);
  if (MMAP_FD !== null) {
    writeSync(MMAP_FD, header, 0, STEP_HEADER_SIZE, 0); writeSync(MMAP_FD, obs, 0, obs.length, STEP_HEADER_SIZE);
    const outer = Buffer.alloc(8); outer.writeUInt32BE(MMAP_SENTINEL, 0); outer.writeUInt32BE(obs.length, 4); process.stdout.write(outer); return;
  }
  const binary = Buffer.concat([header, obs]); const outer = Buffer.alloc(8); outer.writeUInt32BE(0, 0); outer.writeUInt32BE(binary.length, 4);
  process.stdout.write(Buffer.concat([outer, binary]));
}
function handle(req) {
  if (req.cmd === 'ping') return send({ ok: true, pong: true, action_meanings: DMLAB_ACTION_MEANINGS });
  if (req.cmd === 'reset') { const obs = env.reset(req.seed, req.max_steps); return send({ ok: true, info: { score: 0, lives: 1, gameState: 'PLAYING', episodeLength: 0, seed: req.seed } }, Buffer.from(obs)); }
  if (req.cmd === 'step') return sendStep(env.step(req.action, req.num_steps || 1));
  if (req.cmd === 'close') { send({ ok: true, closed: true }); process.stdin.pause(); process.exit(0); }
  throw new Error('unknown cmd ' + req.cmd);
}
function pump() {
  while (pending.length >= 8) {
    const mlen = pending.readUInt32BE(0), blen = pending.readUInt32BE(4);
    if (pending.length < 8 + mlen + blen) return;
    const req = JSON.parse(pending.subarray(8, 8 + mlen).toString('utf8'));
    pending = pending.subarray(8 + mlen + blen);
    try { handle(req); } catch (e) { send({ ok: false, error: (e && e.stack) || String(e) }); }
  }
}
process.stdin.on('data', (c) => { pending = Buffer.concat([pending, c]); pump(); });
