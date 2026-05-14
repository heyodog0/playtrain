// Phase 0.5 / Option 1: Skia multi-env scaling probe.
//
// Mirrors tools/probe_worker_threads.mjs, but uses @napi-rs/canvas
// (Skia / Rust binding) instead of `canvas` (Cairo / C++ binding) for
// the canvas-side calls. Same Worker-Threads scaffold, same workloads,
// same iter counts — so the per-N efficiency table is directly
// comparable between the two libraries.
//
// What this answers: does the ~85% non-syscall per-thread slowdown
// (job 12891926, see docs/MULTI_ENV_RUNTIME.md §10.5) persist with a
// different rasterizer? If yes, the contention is library-independent
// (probably hardware-level — L3 / TLB / memory controller). If no,
// it's specifically a Cairo/pixman issue and Skia is the path
// forward for Worker Threads.
//
// Usage:
//   node tools/probe_worker_threads_skia.mjs --threads 1,2,4,8,16 --iters 3000
//
// Compare against the Cairo numbers from job 12891926 / commit
// 7c1f7ce. Same workload names, same scaffold.

import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { createCanvas } from '@napi-rs/canvas';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);

const PALETTE = [
  'rgba(20,20,20,1)', 'rgba(200,200,200,1)', 'rgba(180,60,60,1)',
  'rgba(60,180,60,1)', 'rgba(60,60,200,1)', 'rgba(220,200,60,1)',
  'rgba(180,80,200,1)', 'rgba(80,200,200,1)', 'rgba(255,160,80,1)',
];

// @napi-rs/canvas's raw readback. Per its docs the equivalent of
// node-canvas's `toBuffer('raw')` is `canvas.data()` — returns a
// Buffer of RGBA bytes for the whole surface. We fall back to
// getImageData if that ever differs across versions.
function readbackRGBA(canvas) {
  if (typeof canvas.data === 'function') return canvas.data();
  return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
}

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
      const buf = readbackRGBA(obs);
      cks = (cks + buf[0] + buf[buf.length - 1]) | 0;
    }
    return cks;
  },

  pure_js(iters) {
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
      const buf = readbackRGBA(obs);
      cks = (cks + buf[0] + buf[buf.length - 1]) | 0;
    }
    return cks;
  },

  small(iters) {
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
      const buf = readbackRGBA(obs);
      cks = (cks + buf[0] + buf[buf.length - 1]) | 0;
    }
    return cks;
  },
};

function runWorkload(iters, kind = 'full') {
  const fn = WORKLOADS[kind];
  if (!fn) throw new Error(`unknown workload: ${kind}`);
  const t0 = process.hrtime.bigint();
  const checksum = fn(iters);
  const elapsedNs = process.hrtime.bigint() - t0;
  return {
    iters, kind,
    elapsedMs: Number(elapsedNs) / 1e6,
    perIterUs: Number(elapsedNs) / iters / 1e3,
    checksum,
  };
}

if (!isMainThread) {
  const { iters, workload } = workerData;
  parentPort.postMessage(runWorkload(iters, workload));
} else {
  const args = process.argv.slice(2);
  let ITERS = 1500;
  let THREAD_LIST = [1, 2, 4, 8, 16];
  let WORKLOAD = 'full';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--iters' && args[i + 1]) ITERS = parseInt(args[++i], 10);
    else if (args[i] === '--threads' && args[i + 1]) {
      THREAD_LIST = args[++i].split(',').map(s => parseInt(s.trim(), 10)).filter(n => n > 0);
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
            firstErr ? reject(firstErr) : resolve({ wallMs, results });
          }
        });
        w.once('error', (e) => {
          firstErr = firstErr || e;
          if (--remaining === 0) reject(firstErr);
        });
      }
    });
  }

  console.log(`Phase 0.5 / Option 1: Skia (@napi-rs/canvas) multi-env scaling probe`);
  console.log(`  workload:     ${WORKLOAD}`);
  console.log(`  iters/thread: ${ITERS}`);
  console.log(`  thread list:  ${THREAD_LIST.join(', ')}`);
  console.log(`  node:         ${process.version}  ${process.platform} ${process.arch}`);
  console.log('');

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
    const efficiency = (baseline.perIterUs / slowestUs) * 100;
    const label = `${N} thread${N === 1 ? '' : 's'} (Worker)`;
    console.log(`  ${label.padEnd(20)} ${wallMs.toFixed(0).padStart(8)} ${slowestUs.toFixed(1).padStart(16)} ${aggIps.toFixed(0).padStart(12)} ${(efficiency.toFixed(0) + '%').padStart(11)}`);
  }

  console.log('');
  console.log('Compare against Cairo numbers from job 12891926 (commit 7c1f7ce):');
  console.log('  cairo @ N=16, workload=full:  slowest 277 μs/iter,  29% efficiency,  53k iters/s');
  console.log('  if Skia is significantly better at N=16, the per-thread slowdown is');
  console.log('  library-specific (pixman/cairo locks) and Worker Threads + Skia is viable.');
  console.log('  if Skia matches Cairo, the slowdown is hardware-level and unfixable.');
}
