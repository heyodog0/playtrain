// Phase 0 of the Worker-Threads multi-env design: confirm node-canvas
// (and Cairo underneath it) actually parallelizes across Worker Threads.
//
// If it does — the whole runtime design works.
// If it doesn't — node-canvas holds a process-global lock somewhere and
// the design collapses; we'd have to fall back to skia-canvas or a
// different architecture.
//
// What we measure: the wall-clock time for K iterations of a representative
// per-step workload (many fillRects + one downsample drawImage + one
// toBuffer('raw')), run in 1, 2, 4, and 8 parallel threads. If threads
// scale linearly, the slowest thread in the 8-thread run completes in
// ~the same time as the single thread.
//
// Usage:
//   node tools/probe_worker_threads.mjs
//   node tools/probe_worker_threads.mjs --iters 2000

import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { createCanvas } from 'canvas';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);

// Pre-built palette to roughly match a draw-heavy game's color churn.
const PALETTE = [
  'rgba(20,20,20,1)', 'rgba(200,200,200,1)', 'rgba(180,60,60,1)',
  'rgba(60,180,60,1)', 'rgba(60,60,200,1)', 'rgba(220,200,60,1)',
  'rgba(180,80,200,1)', 'rgba(80,200,200,1)', 'rgba(255,160,80,1)',
];

// Workload registry. Each variant isolates a different layer of the stack so
// the contention seen at N=16 can be localized:
//   full           — baseline (draw + downsample + readback)
//   pure_js        — no canvas at all (tests Worker Threads + V8 GC + allocator alone)
//   draw_only      — 50 fillRects, no downsample, no readback (tests Cairo fill path)
//   readback_only  — pre-rendered canvas, just drawImage + toBuffer (tests pixman/readback)
//   small          — same as full but 128×96 canvas (tests memory bandwidth / cache)
const WORKLOADS = {
  full(iters) {
    const canvas = createCanvas(480, 352);
    const ctx = canvas.getContext('2d');
    const obs = createCanvas(64, 64);
    const obsCtx = obs.getContext('2d');
    obsCtx.imageSmoothingEnabled = false;
    let cks = 0;
    for (let k = 0; k < iters; k++) {
      ctx.fillStyle = PALETTE[0];
      ctx.fillRect(0, 0, 480, 352);
      for (let i = 0; i < 50; i++) {
        ctx.fillStyle = PALETTE[(i + k) % PALETTE.length];
        ctx.fillRect((i * 31 + k) % 440, (i * 17 + k * 3) % 320, 24, 24);
      }
      obsCtx.drawImage(canvas, 0, 0, 64, 64);
      const buf = obs.toBuffer('raw');
      cks = (cks + buf[0] + buf[buf.length - 1]) | 0;
    }
    return cks;
  },

  pure_js(iters) {
    // No canvas, no native binding. Allocates a fresh Float64Array per iter
    // (~similar GC pressure to Cairo's many small buffers). If THIS scales
    // linearly across threads but `full` doesn't, the contention is in
    // node-canvas/Cairo, not V8/OS.
    let cks = 0;
    for (let k = 0; k < iters; k++) {
      const arr = new Float64Array(1000);
      for (let i = 0; i < 1000; i++) arr[i] = Math.sin(i + k) * 0.1 + Math.cos(i * 0.5);
      let s = 0;
      for (let i = 0; i < 1000; i++) s += arr[i];
      cks = (cks + Math.floor(s * 1000)) | 0;
    }
    return cks;
  },

  draw_only(iters) {
    // Just the fillRects, no downsample/readback. Tests whether Cairo's
    // fill path itself contends, independent of pixman/toBuffer.
    const canvas = createCanvas(480, 352);
    const ctx = canvas.getContext('2d');
    let cks = 0;
    for (let k = 0; k < iters; k++) {
      ctx.fillStyle = PALETTE[0];
      ctx.fillRect(0, 0, 480, 352);
      for (let i = 0; i < 50; i++) {
        ctx.fillStyle = PALETTE[(i + k) % PALETTE.length];
        ctx.fillRect((i * 31 + k) % 440, (i * 17 + k * 3) % 320, 24, 24);
      }
      cks = (cks + k) | 0;
    }
    return cks;
  },

  readback_only(iters) {
    // Pre-render once, then loop on just drawImage + toBuffer. Tests
    // whether pixman's downsample scaler or the raw-buffer readback path
    // contends, independent of fillRect.
    const canvas = createCanvas(480, 352);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = PALETTE[2];
    ctx.fillRect(0, 0, 480, 352);
    for (let i = 0; i < 50; i++) {
      ctx.fillStyle = PALETTE[i % PALETTE.length];
      ctx.fillRect(i * 9, i * 7, 24, 24);
    }
    const obs = createCanvas(64, 64);
    const obsCtx = obs.getContext('2d');
    obsCtx.imageSmoothingEnabled = false;
    let cks = 0;
    for (let k = 0; k < iters; k++) {
      obsCtx.drawImage(canvas, 0, 0, 64, 64);
      const buf = obs.toBuffer('raw');
      cks = (cks + buf[0] + buf[buf.length - 1]) | 0;
    }
    return cks;
  },

  small(iters) {
    // Same shape as `full` but 1/14 the pixels (128×96 vs 480×352). If
    // contention scales with the byte volume per iter, this should scale
    // dramatically better — pointing at memory bandwidth or L3 thrashing.
    const canvas = createCanvas(128, 96);
    const ctx = canvas.getContext('2d');
    const obs = createCanvas(32, 32);
    const obsCtx = obs.getContext('2d');
    obsCtx.imageSmoothingEnabled = false;
    let cks = 0;
    for (let k = 0; k < iters; k++) {
      ctx.fillStyle = PALETTE[0];
      ctx.fillRect(0, 0, 128, 96);
      for (let i = 0; i < 50; i++) {
        ctx.fillStyle = PALETTE[(i + k) % PALETTE.length];
        ctx.fillRect((i * 7 + k) % 116, (i * 5 + k * 3) % 84, 8, 8);
      }
      obsCtx.drawImage(canvas, 0, 0, 32, 32);
      const buf = obs.toBuffer('raw');
      cks = (cks + buf[0] + buf[buf.length - 1]) | 0;
    }
    return cks;
  },
};

function runWorkload(iters, kind = 'full') {
  const fn = WORKLOADS[kind];
  if (!fn) throw new Error(`unknown workload: ${kind} (have: ${Object.keys(WORKLOADS).join(',')})`);
  const t0 = process.hrtime.bigint();
  const checksum = fn(iters);
  const elapsedNs = process.hrtime.bigint() - t0;
  return {
    iters,
    kind,
    elapsedMs: Number(elapsedNs) / 1e6,
    perIterUs: Number(elapsedNs) / iters / 1e3,
    checksum,
  };
}

if (!isMainThread) {
  // We're a worker. Run the workload and report back.
  const { iters, workload } = workerData;
  const result = runWorkload(iters, workload);
  parentPort.postMessage(result);
} else {
  // ─── Main thread ─────────────────────────────────────────────────────
  const args = process.argv.slice(2);
  let ITERS = 1500;
  let THREAD_LIST = [1, 2, 3, 4, 6, 8, 12];
  let WORKLOAD = 'full';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--iters' && args[i + 1]) ITERS = parseInt(args[++i], 10);
    else if (args[i] === '--threads' && args[i + 1]) {
      THREAD_LIST = args[++i].split(',').map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n) && n > 0);
    }
    else if (args[i] === '--workload' && args[i + 1]) WORKLOAD = args[++i];
  }
  if (!WORKLOADS[WORKLOAD]) {
    console.error(`unknown workload: ${WORKLOAD}. valid: ${Object.keys(WORKLOADS).join(', ')}`);
    process.exit(1);
  }

  function spawnAndRun(nThreads, iters) {
    return new Promise((resolve, reject) => {
      const results = [];
      let remaining = nThreads;
      let firstErr = null;
      const tStart = process.hrtime.bigint();

      for (let i = 0; i < nThreads; i++) {
        const w = new Worker(__filename, { workerData: { iters, threadId: i, workload: WORKLOAD } });
        w.once('message', (r) => {
          results.push(r);
          if (--remaining === 0) {
            const wallMs = Number(process.hrtime.bigint() - tStart) / 1e6;
            if (firstErr) reject(firstErr);
            else resolve({ wallMs, results });
          }
        });
        w.once('error', (e) => {
          firstErr = firstErr || e;
          if (--remaining === 0) reject(firstErr);
        });
      }
    });
  }

  const WORKLOAD_DESCRIPTIONS = {
    full: "50 fillRects on 480×352 + drawImage to 64×64 + toBuffer('raw')",
    pure_js: "no canvas; Float64Array(1000) alloc + math per iter",
    draw_only: "50 fillRects on 480×352, no downsample, no readback",
    readback_only: "pre-rendered 480×352 canvas, just drawImage to 64×64 + toBuffer",
    small: "same shape as `full` but 128×96 canvas + 32×32 obs",
  };
  console.log(`Phase 0 probe: node-canvas thread-safety + Worker-Thread scaling`);
  console.log(`  workload:     ${WORKLOAD}`);
  console.log(`  per iter:     ${WORKLOAD_DESCRIPTIONS[WORKLOAD]}`);
  console.log(`  iters/thread: ${ITERS}`);
  console.log(`  thread list:  ${THREAD_LIST.join(', ')}`);
  console.log(`  node: ${process.version}  platform: ${process.platform} ${process.arch}`);
  console.log('');

  // Single-thread baseline first (main-thread, no Worker overhead at all).
  console.log('  warmup (main thread)…');
  runWorkload(Math.min(200, ITERS), WORKLOAD);

  console.log('  baseline (main thread, single)…');
  const baseline = runWorkload(ITERS, WORKLOAD);
  console.log(`    ${baseline.elapsedMs.toFixed(1)} ms total | ${baseline.perIterUs.toFixed(1)} μs/iter | ${(1e6 / baseline.perIterUs).toFixed(0)} iters/s`);
  console.log('');

  const header = `  ${'config'.padEnd(20)} ${'wall ms'.padStart(8)} ${'slowest μs/iter'.padStart(16)} ${'agg iters/s'.padStart(12)} ${'efficiency'.padStart(11)}`;
  console.log(header);
  console.log('  ' + '─'.repeat(header.length - 2));

  for (const N of THREAD_LIST) {
    const { wallMs, results } = await spawnAndRun(N, ITERS);
    const slowestUs = Math.max(...results.map(r => r.perIterUs));
    const aggIps = (ITERS * N) / (wallMs / 1000);
    // Efficiency: how close to linear scaling vs single-thread baseline.
    // 100% = N threads complete the same work in the same wall-clock as 1 thread.
    const efficiency = (baseline.perIterUs / slowestUs) * 100;
    const label = `${N} thread${N === 1 ? '' : 's'} (Worker)`;
    console.log(`  ${label.padEnd(20)} ${wallMs.toFixed(0).padStart(8)} ${slowestUs.toFixed(1).padStart(16)} ${aggIps.toFixed(0).padStart(12)} ${(efficiency.toFixed(0) + '%').padStart(11)}`);
  }

  console.log('');
  console.log('Reading the output:');
  console.log('  • "slowest μs/iter" is the per-iteration time of the slowest worker. Should be ≈ baseline if threads scale linearly.');
  console.log('  • "efficiency" = baseline_us / slowest_us × 100%. Linear scaling = 100%. <50% means node-canvas is serializing across threads.');
  console.log('  • "agg iters/s" is total throughput across all threads. Should grow ~linearly with N if efficiency stays high.');
}
