// Phase 0.5 follow-up #2: Cairo configuration tuning, mirroring
// the Skia tuning probe (job 12895792 / 12897259, commit c5d0a01).
//
// The Skia probe revealed that `path2d_per_color` (50 rects grouped
// into ~9 Path2Ds + 9 native fills per iter, preserving multi-color)
// scales at 93% efficiency at N=16. That's the principle for
// Architecture C₁: batch native calls via Path2D, group by color.
//
// Skia's intrinsically slower per-iter baseline (~159 μs for
// path2d_per_color) means Worker Threads + Skia at N=16 ends up at
// ~182 μs/step — slightly worse than current SubprocVecEnv (~173).
//
// THIS PROBE TESTS WHETHER THE SAME BATCHING STRATEGY WORKS WITH
// CAIRO (node-canvas). Cairo's baseline at single-thread is ~80 μs
// (job 12886605); if the same 93% scaling efficiency applies, Worker
// Threads + Cairo + path2d_per_color lands at ~107 μs/step, which
// would beat current SubprocVecEnv substantially and be competitive
// with DirectVecEnv (~90–110 μs/step).
//
// Node-canvas (Cairo binding) supports Path2D from v2.x; the API
// surface used by this probe (createCanvas, getContext, Path2D,
// fillStyle, fill, drawImage, toBuffer) is identical to Skia's.
//
// Usage:
//   node tools/probe_cairo_tune.mjs --variant path2d_per_color --threads 1,8,16
//
// (probe_cairo_tune.sbatch runs every variant back-to-back.)

import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { createCanvas } from 'canvas';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);

const PALETTE = [
  'rgba(20,20,20,1)', 'rgba(200,200,200,1)', 'rgba(180,60,60,1)',
  'rgba(60,180,60,1)', 'rgba(60,60,200,1)', 'rgba(220,200,60,1)',
  'rgba(180,80,200,1)', 'rgba(80,200,200,1)', 'rgba(255,160,80,1)',
];

// node-canvas does NOT export a Path2D class (verified empirically —
// see commit 0dee9bb's discussion). But the same batching effect is
// achievable via the path-builder API directly on the context:
//   ctx.beginPath();
//   for (i...) ctx.rect(x, y, w, h);
//   ctx.fill();
// This builds one path with N sub-rectangles and fills them in a
// single fill() call. Equivalent to Skia's `new Path2D(); path.rect()
// × N; ctx.fill(path)` for our purposes.

function readback(canvas) {
  return canvas.toBuffer('raw');  // same as production node-gym fast path
}

function build(variant) {
  const canvas = createCanvas(480, 352);
  const obs = createCanvas(64, 64);
  const ctxOpts = variant === 'read_freq' ? { willReadFrequently: true } : {};
  const ctx = canvas.getContext('2d', ctxOpts);
  const obsCtx = obs.getContext('2d', ctxOpts);
  obsCtx.imageSmoothingEnabled = false;

  if (variant === 'no_aa') {
    ctx.imageSmoothingEnabled = false;
    if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'low';
    if ('imageSmoothingQuality' in obsCtx) obsCtx.imageSmoothingQuality = 'low';
  }

  const drawRects = (k) => {
    if (variant === 'path2d_batch') {
      // Skia's Path2D-batch equivalent using ctx-based path builder.
      // One beginPath + 50 sub-rects + one fill = same shape as Skia's
      // (new Path2D + path.rect × 50 + ctx.fill(path)).
      ctx.fillStyle = PALETTE[k % PALETTE.length];
      ctx.beginPath();
      for (let i = 0; i < 50; i++) {
        ctx.rect((i * 31 + k) % 440, (i * 17 + k * 3) % 320, 24, 24);
      }
      ctx.fill();
      return;
    }
    if (variant === 'path2d_per_color') {
      // ⭐ The critical variant: 50 multi-color rects → ~9 paths +
      // ~9 fill() calls per iter. Tests whether Cairo gets the same
      // 93% scaling at N=16 that Skia did with this approach.
      // Groups by palette index, builds a path per color, fills.
      const buckets = Array.from({ length: PALETTE.length }, () => []);
      for (let i = 0; i < 50; i++) {
        const c = (i + k) % PALETTE.length;
        buckets[c].push([(i * 31 + k) % 440, (i * 17 + k * 3) % 320]);
      }
      for (let c = 0; c < PALETTE.length; c++) {
        if (buckets[c].length === 0) continue;
        ctx.fillStyle = PALETTE[c];
        ctx.beginPath();
        for (const [x, y] of buckets[c]) ctx.rect(x, y, 24, 24);
        ctx.fill();
      }
      return;
    }
    if (variant === 'path2d_50_per_iter') {
      // Per-rect beginPath + fill. 50 separate fills per iter,
      // each on a single-rect path. Sanity check.
      for (let i = 0; i < 50; i++) {
        ctx.fillStyle = PALETTE[(i + k) % PALETTE.length];
        ctx.beginPath();
        ctx.rect((i * 31 + k) % 440, (i * 17 + k * 3) % 320, 24, 24);
        ctx.fill();
      }
      return;
    }
    if (variant === 'same_color') {
      ctx.fillStyle = PALETTE[k % PALETTE.length];
      for (let i = 0; i < 50; i++) {
        ctx.fillRect((i * 31 + k) % 440, (i * 17 + k * 3) % 320, 24, 24);
      }
      return;
    }
    // default / no_aa / read_freq: original churn
    for (let i = 0; i < 50; i++) {
      ctx.fillStyle = PALETTE[(i + k) % PALETTE.length];
      ctx.fillRect((i * 31 + k) % 440, (i * 17 + k * 3) % 320, 24, 24);
    }
  };

  return { canvas, ctx, obs, obsCtx, drawRects };
}

function runWorkload(iters, variant) {
  const { canvas, ctx, obs, obsCtx, drawRects } = build(variant);
  let cks = 0;
  const t0 = process.hrtime.bigint();
  for (let k = 0; k < iters; k++) {
    ctx.fillStyle = PALETTE[0];
    ctx.fillRect(0, 0, 480, 352);
    drawRects(k);
    obsCtx.drawImage(canvas, 0, 0, 64, 64);
    const buf = readback(obs);
    cks = (cks + buf[0] + buf[buf.length - 1]) | 0;
  }
  const elapsedNs = process.hrtime.bigint() - t0;
  return {
    iters, variant,
    elapsedMs: Number(elapsedNs) / 1e6,
    perIterUs: Number(elapsedNs) / iters / 1e3,
    checksum: cks,
  };
}

const VARIANTS = [
  'default', 'no_aa', 'read_freq',
  'path2d_batch', 'same_color',
  'path2d_per_color', 'path2d_50_per_iter',
];

if (!isMainThread) {
  const { iters, variant } = workerData;
  parentPort.postMessage(runWorkload(iters, variant));
} else {
  const args = process.argv.slice(2);
  let ITERS = 2000;
  let THREAD_LIST = [1, 8, 16];
  let VARIANT = 'default';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--iters' && args[i + 1]) ITERS = parseInt(args[++i], 10);
    else if (args[i] === '--threads' && args[i + 1]) {
      THREAD_LIST = args[++i].split(',').map(s => parseInt(s.trim(), 10)).filter(n => n > 0);
    }
    else if (args[i] === '--variant' && args[i + 1]) VARIANT = args[++i];
  }
  if (!VARIANTS.includes(VARIANT)) {
    console.error(`unknown variant: ${VARIANT}. valid: ${VARIANTS.join(', ')}`);
    process.exit(1);
  }

  function spawnAndRun(nThreads, iters) {
    return new Promise((resolve, reject) => {
      const results = [];
      let remaining = nThreads;
      let firstErr = null;
      const tStart = process.hrtime.bigint();
      for (let i = 0; i < nThreads; i++) {
        const w = new Worker(__filename, { workerData: { iters, variant: VARIANT, threadId: i } });
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

  console.log(`Phase 0.5 follow-up #2: Cairo (node-canvas) configuration tuning`);
  console.log(`  variant:      ${VARIANT}`);
  console.log(`  iters/thread: ${ITERS}`);
  console.log(`  thread list:  ${THREAD_LIST.join(', ')}`);
  console.log(`  node:         ${process.version}  ${process.platform} ${process.arch}`);
  console.log(`  (using ctx.beginPath()/rect()/fill() — node-canvas doesn't export Path2D)`);
  console.log('');

  console.log('  warmup (main thread)…');
  runWorkload(Math.min(200, ITERS), VARIANT);

  console.log('  baseline (main thread, single)…');
  const baseline = runWorkload(ITERS, VARIANT);
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
}
