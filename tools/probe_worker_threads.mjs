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

// Representative game-step workload: simulate drawing ~50 tiles + sprites,
// then downsample to the 64×64 obs target, then read back the raw buffer.
function runWorkload(iters) {
  const canvas = createCanvas(480, 352);  // analogen-grid native size
  const ctx = canvas.getContext('2d');
  const obs = createCanvas(64, 64);
  const obsCtx = obs.getContext('2d');
  obsCtx.imageSmoothingEnabled = false;

  // Pre-built palette to roughly match a draw-heavy game's color churn.
  const palette = [
    'rgba(20,20,20,1)', 'rgba(200,200,200,1)', 'rgba(180,60,60,1)',
    'rgba(60,180,60,1)', 'rgba(60,60,200,1)', 'rgba(220,200,60,1)',
    'rgba(180,80,200,1)', 'rgba(80,200,200,1)', 'rgba(255,160,80,1)',
  ];

  const t0 = process.hrtime.bigint();
  let checksum = 0;

  for (let k = 0; k < iters; k++) {
    // Background fill
    ctx.fillStyle = palette[0];
    ctx.fillRect(0, 0, 480, 352);

    // Simulate 50 tile/sprite draws with varied colors (mimics actual game).
    for (let i = 0; i < 50; i++) {
      ctx.fillStyle = palette[(i + k) % palette.length];
      const x = (i * 31 + k) % 440;
      const y = (i * 17 + k * 3) % 320;
      ctx.fillRect(x, y, 24, 24);
    }

    // Downsample to obs size (Cairo C-level scaled blit).
    obsCtx.drawImage(canvas, 0, 0, 64, 64);

    // Readback the raw buffer (this is what the real obs path does).
    const buf = obs.toBuffer('raw');
    checksum = (checksum + buf[0] + buf[buf.length - 1]) | 0;
  }

  const elapsedNs = process.hrtime.bigint() - t0;
  return {
    iters,
    elapsedMs: Number(elapsedNs) / 1e6,
    perIterUs: Number(elapsedNs) / iters / 1e3,
    checksum,
  };
}

if (!isMainThread) {
  // We're a worker. Run the workload and report back.
  const { iters } = workerData;
  const result = runWorkload(iters);
  parentPort.postMessage(result);
} else {
  // ─── Main thread ─────────────────────────────────────────────────────
  const args = process.argv.slice(2);
  let ITERS = 1500;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--iters' && args[i + 1]) ITERS = parseInt(args[++i], 10);
  }

  function spawnAndRun(nThreads, iters) {
    return new Promise((resolve, reject) => {
      const results = [];
      let remaining = nThreads;
      let firstErr = null;
      const tStart = process.hrtime.bigint();

      for (let i = 0; i < nThreads; i++) {
        const w = new Worker(__filename, { workerData: { iters, threadId: i } });
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

  console.log(`Phase 0 probe: node-canvas thread-safety + Worker-Thread scaling`);
  console.log(`  iters/thread: ${ITERS}`);
  console.log(`  workload per iter: 50 fillRects on 480×352 canvas + drawImage to 64×64 + toBuffer('raw')`);
  console.log('');

  // Single-thread baseline first (main-thread, no Worker overhead at all).
  console.log('  warmup (main thread)…');
  runWorkload(Math.min(200, ITERS));

  console.log('  baseline (main thread, single)…');
  const baseline = runWorkload(ITERS);
  console.log(`    ${baseline.elapsedMs.toFixed(1)} ms total | ${baseline.perIterUs.toFixed(1)} μs/iter | ${(1e6 / baseline.perIterUs).toFixed(0)} iters/s`);
  console.log('');

  const header = `  ${'config'.padEnd(20)} ${'wall ms'.padStart(8)} ${'slowest μs/iter'.padStart(16)} ${'agg iters/s'.padStart(12)} ${'efficiency'.padStart(11)}`;
  console.log(header);
  console.log('  ' + '─'.repeat(header.length - 2));

  for (const N of [1, 2, 3, 4, 6, 8, 12]) {
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
