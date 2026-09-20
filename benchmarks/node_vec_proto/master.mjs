// node_vec_proto/master.mjs — a node mirror of native/qjs/qjs_vec_host.cpp: ONE node process, N envs on N
// worker_threads (game-env.mjs loads a game into the thread's own global scope, so one env per thread), a shared
// slab for actions / rewards / flags / observations, one stdin message and one stdout token per batched step,
// and the slab copied to an mmap'd file the Python side reads zero-copy. Autoreset on done, like the vec host.
//   node master.mjs --game <bundle.js> --n 8 --obs-mode symbolic|rgb --obs-size 64 --max-steps 1000 --mmap <file>
// Protocol: stdin: 4 bytes cmd (0 = step, 1 = reset, 2 = close) then N int32 actions (step) or N int32 seeds
// (reset); stdout: 8 bytes (uint32 steps done, uint32 obs bytes per env) after the slab is written.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { openSync, writeSync, readSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const GAME_ENV = join(HERE, '..', '..', 'runtime', 'p5', 'game-env.mjs');

if (!isMainThread) {
  const { gamePath, obsMode, obsSize, maxSteps, idx, ctrl, act, slab, obsBytes, seeds, N, OBS_OFF } = workerData;
  const { GameEnv } = await import(GAME_ENV);
  const SPIN = parseInt(process.env.NODEVEC_SPIN || '2000', 10);   // worker spin before sleeping (0 = sleep at once)
  const env = new GameEnv({ gamePath, obsWidth: obsSize, obsHeight: obsSize, obsMode, maxSteps, frameSkip: 1 });
  const CTRL = new Int32Array(ctrl), ACT = new Int32Array(act), SEEDS = new Int32Array(seeds);
  const REW = new Float32Array(slab, 0, N), TERM = new Uint8Array(slab, 4 * N, N), TRUNC = new Uint8Array(slab, 5 * N, N);
  const OBS = new Uint8Array(slab, OBS_OFF + idx * obsBytes, obsBytes);
  let gen = 0, episode = 0;
  const putObs = (o) => { OBS.set(o.length === obsBytes ? o : o.subarray(0, obsBytes)); };
  for (;;) {
    // spin briefly before sleeping: thread wake-up latency is the batch's critical path (qjs_vec_host spins too)
    for (let spin = 0; spin < SPIN && Atomics.load(CTRL, 0) === gen; spin++) {}
    if (Atomics.load(CTRL, 0) === gen) Atomics.wait(CTRL, 0, gen);
    gen = Atomics.load(CTRL, 0);
    const cmd = Atomics.load(CTRL, 2);
    if (cmd === 2) break;
    if (cmd === 1) { const r = env.reset({ seed: SEEDS[idx] >>> 0 }); putObs(r.observation); REW[idx] = 0; TERM[idx] = 0; TRUNC[idx] = 0; }
    else {
      const s = env.step(ACT[idx]);
      REW[idx] = s.reward; TERM[idx] = s.terminated ? 1 : 0; TRUNC[idx] = s.truncated ? 1 : 0;
      if (s.terminated || s.truncated) { episode++; const r = env.reset({ seed: (SEEDS[idx] * 7919 + episode) >>> 0 }); putObs(r.observation); }
      else putObs(s.observation);
    }
    Atomics.add(CTRL, 1, 1); Atomics.notify(CTRL, 1);
  }
  parentPort?.close();
} else {
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
  const gamePath = opt('game', null), N = parseInt(opt('n', '8'), 10), obsMode = opt('obs-mode', 'rgb'), obsSize = parseInt(opt('obs-size', '64'), 10);
  const maxSteps = parseInt(opt('max-steps', '1000'), 10), mmapPath = opt('mmap', null), symDim = parseInt(opt('sym-dim', '0'), 10);
  const obsBytes = obsMode === 'symbolic' ? symDim * 4 : obsSize * obsSize * 3;
  // one slab, laid out exactly as the mmap file: rew f32[N] | term u8[N] | trunc u8[N] | pad to 8 | obs u8[N*obsBytes]
  const OBS_OFF = Math.ceil(6 * N / 8) * 8;
  const ctrl = new SharedArrayBuffer(16), act = new SharedArrayBuffer(4 * N), seeds = new SharedArrayBuffer(4 * N), slab = new SharedArrayBuffer(OBS_OFF + obsBytes * N);
  const CTRL = new Int32Array(ctrl), ACT = new Int32Array(act), SEEDS = new Int32Array(seeds);
  const workers = [];
  for (let i = 0; i < N; i++) workers.push(new Worker(fileURLToPath(import.meta.url), { workerData: { gamePath, obsMode, obsSize, maxSteps, idx: i, ctrl, act, slab, obsBytes, seeds, N, OBS_OFF } }));
  const fd = openSync(mmapPath, 'r+');
  const slabB = Buffer.from(slab);
  const runBatch = (cmd) => {
    Atomics.store(CTRL, 1, 0); Atomics.store(CTRL, 2, cmd);
    Atomics.add(CTRL, 0, 1); Atomics.notify(CTRL, 0);
    for (let spin = 0; spin < MSPIN && Atomics.load(CTRL, 1) < N; spin++) {}
    while (Atomics.load(CTRL, 1) < N) Atomics.wait(CTRL, 1, Atomics.load(CTRL, 1), 50);
    writeSync(fd, slabB, 0, slabB.length, 0);
  };
  const MSPIN = parseInt(process.env.NODEVEC_MSPIN || '200000', 10);
  const inBuf = Buffer.alloc(4 + 4 * N), out = Buffer.alloc(8);
  const readExact = (buf) => { let got = 0; while (got < buf.length) { const n = readSync(0, buf, got, buf.length - got, null); if (n <= 0) return false; got += n; } return true; };
  let steps = 0;
  // wait for the workers to import and compile: a first reset is the handshake
  process.stderr.write(`node_vec_proto: ${N} envs, obsBytes ${obsBytes}, OBS_OFF ${OBS_OFF}\n`);
  for (;;) {
    if (!readExact(inBuf)) break;
    const cmd = inBuf.readInt32LE(0);
    if (cmd === 2) { Atomics.store(CTRL, 2, 2); Atomics.add(CTRL, 0, 1); Atomics.notify(CTRL, 0); break; }
    for (let i = 0; i < N; i++) (cmd === 1 ? SEEDS : ACT)[i] = inBuf.readInt32LE(4 + 4 * i);
    runBatch(cmd); steps++;
    out.writeUInt32LE(steps, 0); out.writeUInt32LE(obsBytes, 4); writeSync(1, out, 0, 8);
  }
  process.exit(0);
}
