/**
 * Three.js IPC worker.
 *
 * Same binary protocol as runtime/game-worker.mjs (the p5 worker):
 *   header: 8 bytes — uint32 BE meta_length + uint32 BE binary_length
 *   meta:   meta_length bytes of UTF-8 JSON
 *   binary: binary_length bytes (the obs frame, or empty)
 *
 * Driven by Python's NodeGymThreeEnv via stdin/stdout.
 */

import { openSync, writeSync, closeSync } from 'fs';
import { ThreeGameEnv } from './game-env.mjs';

// If Python passed NODE_GYM_THREE_MMAP_PATH, open the shared file for fast
// obs transfer. Worker writes step header + obs to this file; Python reads
// from its mmap. Pipe carries only the 8-byte sync header.
const MMAP_PATH = process.env.NODE_GYM_THREE_MMAP_PATH || null;
let MMAP_FD = null;
if (MMAP_PATH) {
  try {
    MMAP_FD = openSync(MMAP_PATH, 'r+');
  } catch (e) {
    process.stderr.write(`Warning: failed to open mmap file ${MMAP_PATH}: ${e.message}\n`);
    MMAP_FD = null;
  }
}
const MMAP_SENTINEL = 0xFFFFFFFF;

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { gamePath: null, obsSize: 84 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--game' && args[i + 1]) opts.gamePath = args[++i];
    else if (args[i] === '--obs-size' && args[i + 1]) opts.obsSize = parseInt(args[++i], 10);
  }
  if (!opts.gamePath) {
    process.stderr.write('Error: --game <path> is required\n');
    process.exit(1);
  }
  return opts;
}

const opts = parseArgs();

// The shim reads NODE_GYM_THREE_OBS_SIZE at import time. By the time
// THREE / shims is dynamically imported inside ThreeGameEnv, the env var
// must already be set — which it will be because the parent (Python env)
// passes it in its env, and we read opts.obsSize purely for sanity check.

const env = new ThreeGameEnv({
  gamePath: opts.gamePath,
  obsWidth: opts.obsSize,
  obsHeight: opts.obsSize,
});

let pending = Buffer.alloc(0);
let shuttingDown = false;

function buildFrame(meta, binary = Buffer.alloc(0)) {
  const metaBuf = Buffer.from(JSON.stringify(meta), 'utf8');
  const header = Buffer.alloc(8);
  header.writeUInt32BE(metaBuf.length, 0);
  header.writeUInt32BE(binary.length, 4);
  return Buffer.concat([header, metaBuf, binary]);
}

function send(meta, binary = Buffer.alloc(0), cb) {
  process.stdout.write(buildFrame(meta, binary), cb);
}

function ok(meta = {}, binary = Buffer.alloc(0), cb) {
  send({ ok: true, ...meta }, binary, cb);
}

// Binary step response — meta_length=0 in outer header signals to the Python
// side to use the fast path (no JSON parse). Layout of the 16-byte step
// header + obs follows. See protocol notes in python/node_gym/three.py.
const STEP_HEADER_SIZE = 16;
const GS_INDEX = { PLAYING: 0, WIN: 1, GAMEOVER: 2, EXIT: 3 };

function packStepHeader({ reward, terminated, truncated, info }) {
  const h = Buffer.alloc(STEP_HEADER_SIZE);
  h.writeFloatBE(reward, 0);
  h.writeUInt8(terminated ? 1 : 0, 4);
  h.writeUInt8(truncated ? 1 : 0, 5);
  h.writeUInt8(GS_INDEX[info.gameState] ?? 0, 6);
  h.writeUInt8(Math.max(0, Math.min(255, info.lives | 0)), 7);
  h.writeInt32BE(info.score | 0, 8);
  h.writeInt32BE(info.episodeLength | 0, 12);
  return h;
}

function sendBinaryStep(result) {
  const stepHeader = packStepHeader(result);

  if (MMAP_FD !== null) {
    // Fastest path: write step header + obs into the shared mmap file,
    // pipe carries only an 8-byte sync header (meta_length=SENTINEL,
    // binary_length=obs_byte_length so Python knows how much to slice).
    const obsBuf = Buffer.from(result.observation);
    writeSync(MMAP_FD, stepHeader, 0, STEP_HEADER_SIZE, 0);
    writeSync(MMAP_FD, obsBuf, 0, obsBuf.length, STEP_HEADER_SIZE);

    const outerHeader = Buffer.alloc(8);
    outerHeader.writeUInt32BE(MMAP_SENTINEL, 0);
    outerHeader.writeUInt32BE(obsBuf.length, 4);
    process.stdout.write(outerHeader);
    return;
  }

  // Fallback (no mmap): obs goes through the pipe.
  const obs = Buffer.from(result.observation);
  const binary = Buffer.concat([stepHeader, obs]);
  const outerHeader = Buffer.alloc(8);
  outerHeader.writeUInt32BE(0, 0);
  outerHeader.writeUInt32BE(binary.length, 4);
  process.stdout.write(Buffer.concat([outerHeader, binary]));
}

function fail(error) {
  send({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
}

async function handleRequest(request, binaryLength) {
  if (binaryLength !== 0) {
    throw new Error(`Unexpected binary payload for command ${request.cmd}`);
  }

  if (request.cmd === 'ping') {
    return ok({ pong: true, action_meanings: ThreeGameEnv.getActionMeanings() });
  }

  if (request.cmd === 'reset') {
    const result = await env.reset({
      seed: request.seed,
      maxSteps: request.max_steps,
    });
    return ok({ info: result.info }, Buffer.from(result.observation));
  }

  if (request.cmd === 'step') {
    const result = await env.step(request.action);
    if (process.env.NODE_GYM_THREE_FORCE_JSON === '1') {
      // Bench-only fallback: send the original JSON-meta + obs response.
      return ok({
        reward: result.reward,
        terminated: result.terminated,
        truncated: result.truncated,
        info: result.info,
      }, Buffer.from(result.observation));
    }
    return sendBinaryStep(result);
  }

  if (request.cmd === 'close') {
    shuttingDown = true;
    env.close();
    return ok({ closed: true }, Buffer.alloc(0), () => {
      process.stdin.pause();
      process.exit(0);
    });
  }

  throw new Error(`Unknown command: ${request.cmd}`);
}

async function processPending() {
  while (pending.length >= 8 && !shuttingDown) {
    const metaLength = pending.readUInt32BE(0);
    const binaryLength = pending.readUInt32BE(4);
    const frameLength = 8 + metaLength + binaryLength;
    if (pending.length < frameLength) return;

    const metaStart = 8;
    const metaEnd = metaStart + metaLength;
    const metaBuf = pending.subarray(metaStart, metaEnd);
    const request = JSON.parse(metaBuf.toString('utf8'));
    pending = pending.subarray(frameLength);

    try {
      await handleRequest(request, binaryLength);
    } catch (error) {
      fail(error);
    }
  }
}

process.stdin.on('data', (chunk) => {
  pending = Buffer.concat([pending, chunk]);
  processPending();
});

process.stdin.on('end', () => {
  env.close();
});
