// Phase 0.5 follow-up: Skia configuration tuning.
//
// The baseline Skia probe (job 12893502) found Skia is 1.7× slower per-iter
// than Cairo at single-thread (136 μs vs 81 μs). Skia's BETTER scaling
// efficiency at N=16 (46% vs 29%) doesn't make up for the slower baseline,
// so Worker Threads + Skia ended up worse than Worker Threads + Cairo.
//
// This probe tests whether the Skia baseline can be improved via
// configuration changes. Six variants, each running the same overall
// workload shape (50 fillRects + downsample + readback) but with one
// Skia-specific knob altered:
//
//   default           — same as the earlier probe (96d22e0 baseline)
//   no_aa             — imageSmoothingEnabled=false on the main canvas too;
//                       also explicit "low" smoothing quality
//   read_freq         — { willReadFrequently: true } on getContext
//   path2d_batch      — build a Path2D with 50 rects, fill once instead
//                       of 50 separate fillRect calls
//   same_color        — all 50 rects same color (eliminates fillStyle
//                       string parsing in the hot loop)
//   getimg_readback   — use ctx.getImageData() instead of canvas.data()
//                       for readback
//
// Runs each variant at N=1, N=8, N=16 so we can see (a) which knob
// helps the baseline most, and (b) whether the knob preserves Skia's
// scaling-efficiency advantage at higher N.
//
// If any variant brings Skia baseline close to Cairo's 81 μs AND keeps
// the 46%-or-better efficiency, Worker Threads might revive.
//
// Usage:
//   node tools/probe_skia_tune.mjs --variant no_aa --threads 1,8,16
//   node tools/probe_skia_tune.mjs --variant default --iters 2000
//
// (probe_skia_tune.sbatch runs all 6 variants back-to-back.)

import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { createCanvas, Path2D as SkiaPath2D } from '@napi-rs/canvas';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);

const PALETTE = [
  'rgba(20,20,20,1)', 'rgba(200,200,200,1)', 'rgba(180,60,60,1)',
  'rgba(60,180,60,1)', 'rgba(60,60,200,1)', 'rgba(220,200,60,1)',
  'rgba(180,80,200,1)', 'rgba(80,200,200,1)', 'rgba(255,160,80,1)',
];

function readback(canvas, mode) {
  if (mode === 'getimg') {
    return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  }
  // default: canvas.data() if available (fastest Skia path), else getImageData
  if (typeof canvas.data === 'function') return canvas.data();
  return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
}

// Each variant returns the {ctx, obs, obsCtx, draw} bundle the hot loop uses.
// Keeping the shape uniform makes the comparison apples-to-apples.
function build(variant) {
  const canvas = createCanvas(480, 352);
  const obs = createCanvas(64, 64);

  // willReadFrequently=true hints to Skia to use a CPU-readable surface,
  // which can dramatically speed up toBuffer/getImageData paths at the
  // cost of slightly slower draws.
  const ctxOpts = variant === 'read_freq' ? { willReadFrequently: true } : {};
  const ctx = canvas.getContext('2d', ctxOpts);
  const obsCtx = obs.getContext('2d', ctxOpts);
  obsCtx.imageSmoothingEnabled = false;

  if (variant === 'no_aa') {
    ctx.imageSmoothingEnabled = false;
    if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'low';
    if ('imageSmoothingQuality' in obsCtx) obsCtx.imageSmoothingQuality = 'low';
  }

  const readbackMode = variant === 'getimg_readback' ? 'getimg' : 'default';

  // path2d_batch: build the 50-rect path once outside the hot loop. We can't
  // reuse it across iters since rect positions change with k, so we rebuild
  // each iter — but using a single Path2D + one fill is still cheaper than
  // 50 fillRect calls in some implementations.
  const drawRects = (k) => {
    if (variant === 'path2d_batch') {
      // Path2D isn't a Node global; pull it from the canvas lib. Some
      // canvas libs export it, some require global injection — fall back
      // gracefully if it's not present.
      const P2D = SkiaPath2D || globalThis.Path2D;
      if (!P2D) throw new Error('Path2D not available; skip this variant');
      const path = new P2D();
      for (let i = 0; i < 50; i++) {
        path.rect((i * 31 + k) % 440, (i * 17 + k * 3) % 320, 24, 24);
      }
      // Path2D + single fill loses per-rect color variation. For this variant
      // we accept the simplification (all rects same color, fillStyle set
      // once outside the loop).
      ctx.fillStyle = PALETTE[k % PALETTE.length];
      ctx.fill(path);
      return;
    }
    if (variant === 'same_color') {
      ctx.fillStyle = PALETTE[k % PALETTE.length];   // set once, not per-rect
      for (let i = 0; i < 50; i++) {
        ctx.fillRect((i * 31 + k) % 440, (i * 17 + k * 3) % 320, 24, 24);
      }
      return;
    }
    // default / no_aa / read_freq / getimg_readback: original churn
    for (let i = 0; i < 50; i++) {
      ctx.fillStyle = PALETTE[(i + k) % PALETTE.length];
      ctx.fillRect((i * 31 + k) % 440, (i * 17 + k * 3) % 320, 24, 24);
    }
  };

  return { canvas, ctx, obs, obsCtx, drawRects, readbackMode };
}

function runWorkload(iters, variant) {
  const { canvas, ctx, obs, obsCtx, drawRects, readbackMode } = build(variant);
  let cks = 0;
  const t0 = process.hrtime.bigint();
  for (let k = 0; k < iters; k++) {
    ctx.fillStyle = PALETTE[0];
    ctx.fillRect(0, 0, 480, 352);
    drawRects(k);
    obsCtx.drawImage(canvas, 0, 0, 64, 64);
    const buf = readback(obs, readbackMode);
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

const VARIANTS = ['default', 'no_aa', 'read_freq', 'path2d_batch', 'same_color', 'getimg_readback'];

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

  console.log(`Phase 0.5 follow-up: Skia configuration tuning`);
  console.log(`  variant:      ${VARIANT}`);
  console.log(`  iters/thread: ${ITERS}`);
  console.log(`  thread list:  ${THREAD_LIST.join(', ')}`);
  console.log(`  node:         ${process.version}  ${process.platform} ${process.arch}`);
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
