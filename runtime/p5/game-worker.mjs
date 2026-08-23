import { openSync, writeSync } from 'fs';
import { GameEnv, _profileTimings } from './game-env.mjs';

const PROFILE = process.env.PLAYTRAIN_P5_PROFILE === '1';
const _framingNs = { ns: 0n, n: 0 };
const _hrtime = process.hrtime.bigint;

// mmap-shared obs file (optional; set by Python via env var)
const MMAP_PATH = process.env.PLAYTRAIN_P5_MMAP_PATH || null;
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
    const obsBuf = Buffer.from(result.observation);
    writeSync(MMAP_FD, stepHeader, 0, STEP_HEADER_SIZE, 0);
    writeSync(MMAP_FD, obsBuf, 0, obsBuf.length, STEP_HEADER_SIZE);
    const outerHeader = Buffer.alloc(8);
    outerHeader.writeUInt32BE(MMAP_SENTINEL, 0);
    outerHeader.writeUInt32BE(obsBuf.length, 4);
    process.stdout.write(outerHeader);
    return;
  }
  // Fallback: binary step + obs in pipe (mmap unavailable).
  const obs = Buffer.from(result.observation);
  const binary = Buffer.concat([stepHeader, obs]);
  const outerHeader = Buffer.alloc(8);
  outerHeader.writeUInt32BE(0, 0);
  outerHeader.writeUInt32BE(binary.length, 4);
  process.stdout.write(Buffer.concat([outerHeader, binary]));
}

function printProfileSummary() {
  const n = _profileTimings.n;
  if (n === 0) return;
  const nBig = BigInt(n);
  const us = (x) => (Number(x / nBig) / 1000).toFixed(2);
  const totalNs = _profileTimings.draw + _profileTimings.downsample
                + _profileTimings.swap + _profileTimings.info + _framingNs.ns;
  const pct = (x) => ((Number(x) / Number(totalNs)) * 100).toFixed(1);
  const lines = [
    `\n=== p5 profile (${n} steps) ===`,
    `  draw         ${us(_profileTimings.draw).padStart(7)} μs/step  (${pct(_profileTimings.draw).padStart(4)}%)`,
    `  downsample   ${us(_profileTimings.downsample).padStart(7)} μs/step  (${pct(_profileTimings.downsample).padStart(4)}%)`,
    `  swap         ${us(_profileTimings.swap).padStart(7)} μs/step  (${pct(_profileTimings.swap).padStart(4)}%)`,
    `  info         ${us(_profileTimings.info).padStart(7)} μs/step  (${pct(_profileTimings.info).padStart(4)}%)`,
    `  framing      ${us(_framingNs.ns).padStart(7)} μs/step  (${pct(_framingNs.ns).padStart(4)}%)`,
    `  ─────────────────────────────────`,
    `  sum          ${us(totalNs).padStart(7)} μs/step  (${(1e9 / (Number(totalNs) / Number(nBig))).toFixed(0)} steps/s in-worker)`,
    '',
  ];
  process.stderr.write(lines.join('\n'));
}

// Parse CLI args: --game <path> [--obs-mode rgb|gray] [--obs-size 64] [--matter]
//                 [--action-space <name-or-json-path>]
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { gamePath: null, obsMode: 'rgb', obsSize: 64, needsMatter: false, frameSkip: 1, actionSpace: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--game' && args[i + 1]) opts.gamePath = args[++i];
    else if (args[i] === '--obs-mode' && args[i + 1]) opts.obsMode = args[++i];
    else if (args[i] === '--obs-size' && args[i + 1]) opts.obsSize = parseInt(args[++i], 10);
    else if (args[i] === '--frame-skip' && args[i + 1]) opts.frameSkip = parseInt(args[++i], 10);
    else if (args[i] === '--action-space' && args[i + 1]) opts.actionSpace = args[++i];
    else if (args[i] === '--input-map' && args[i + 1]) opts.inputMap = args[++i];
    else if (args[i] === '--matter') opts.needsMatter = true;
  }
  if (!opts.gamePath) {
    process.stderr.write('Error: --game <path> is required\n');
    process.exit(1);
  }
  return opts;
}

const opts = parseArgs();
const env = new GameEnv({
  gamePath: opts.gamePath,
  obsWidth: opts.obsSize,
  obsHeight: opts.obsSize,
  obsMode: opts.obsMode,
  needsMatter: opts.needsMatter,
  frameSkip: opts.frameSkip,
  actions: opts.actionSpace,
  inputMap: opts.inputMap,
});

let pending = Buffer.alloc(0);
let shuttingDown = false;

function buildFrame(meta, binary = Buffer.alloc(0)) {
  const metaBuffer = Buffer.from(JSON.stringify(meta), 'utf8');
  const header = Buffer.alloc(8);
  header.writeUInt32BE(metaBuffer.length, 0);
  header.writeUInt32BE(binary.length, 4);
  return Buffer.concat([header, metaBuffer, binary]);
}

function send(meta, binary = Buffer.alloc(0), callback = undefined) {
  process.stdout.write(buildFrame(meta, binary), callback);
}

function ok(meta = {}, binary = Buffer.alloc(0), callback = undefined) {
  send({ ok: true, ...meta }, binary, callback);
}

function fail(error) {
  send({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
}

function handleRequest(request, binaryLength) {
  if (binaryLength !== 0) {
    throw new Error(`Unexpected binary payload for command ${request.cmd}`);
  }

  if (request.cmd === 'reset') {
    const result = env.reset({
      seed: request.seed,
      maxSteps: request.max_steps,
    });
    ok({ info: result.info }, Buffer.from(result.observation));
    return;
  }

  if (request.cmd === 'stepq') {
    // Box path: request.q is the uint16 wire-value array (one per channel).
    const result = env.stepQ(request.q);
    sendBinaryStep(result);
    return;
  }

  if (request.cmd === 'step') {
    const result = env.step(request.action);
    if (process.env.PLAYTRAIN_P5_FORCE_JSON === '1') {
      // Bench-only fallback: original JSON-meta + obs response.
      ok({
        reward: result.reward,
        terminated: result.terminated,
        truncated: result.truncated,
        info: result.info,
      }, Buffer.from(result.observation));
      return;
    }
    if (PROFILE) {
      const tA = _hrtime();
      sendBinaryStep(result);
      _framingNs.ns += _hrtime() - tA;
      _framingNs.n += 1;
      return;
    }
    sendBinaryStep(result);
    return;
  }

  if (request.cmd === 'close') {
    shuttingDown = true;
    env.close();
    if (PROFILE) printProfileSummary();
    ok({ closed: true }, Buffer.alloc(0), () => {
      process.stdin.pause();
      process.exit(0);
    });
    return;
  }

  if (request.cmd === 'ping') {
    ok({ pong: true, action_meanings: env.actionMeanings() });
    return;
  }

  throw new Error(`Unknown command: ${request.cmd}`);
}

function processPending() {
  while (pending.length >= 8 && !shuttingDown) {
    const metaLength = pending.readUInt32BE(0);
    const binaryLength = pending.readUInt32BE(4);
    const frameLength = 8 + metaLength + binaryLength;
    if (pending.length < frameLength) return;

    const metaStart = 8;
    const metaEnd = metaStart + metaLength;
    const metaBuffer = pending.subarray(metaStart, metaEnd);
    const request = JSON.parse(metaBuffer.toString('utf8'));
    pending = pending.subarray(frameLength);

    try {
      handleRequest(request, binaryLength);
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
