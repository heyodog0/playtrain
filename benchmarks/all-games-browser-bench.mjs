/**
 * Benchmark all 14 games via Playwright (browser) with JSON and base64 pixel transfer.
 *
 * For each game:
 *   1. Serves a temporary HTML page with p5.js + game code
 *   2. Opens in headless Chrome via Playwright
 *   3. Benchmarks: render-only, JSON pixel transfer, base64 pixel transfer
 *
 * Also runs the headless Node benchmark for side-by-side comparison.
 *
 * Usage:
 *   node benchmarks/all-games-browser-bench.mjs [--frames 200] [--game breakout]
 *
 * Outputs JSON to stdout and saves to outputs/all-games-browser-benchmark-latest.json
 */

import { createServer } from 'http';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import { chromium } from 'playwright-core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const gamesDir = join(repoRoot, 'games', 'js');
const outputsDir = join(repoRoot, 'outputs');
const benchScript = join(__dirname, 'bench-single-game.mjs');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const MATTER_GAMES = new Set(['angry_birds', 'suika']);
const OBS_WIDTH = 64;
const OBS_HEIGHT = 64;
const WARMUP_FRAMES = 50;

// Parse CLI args
const args = process.argv.slice(2);
let BENCH_FRAMES = 200;
let targetGame = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--frames' && args[i + 1]) BENCH_FRAMES = parseInt(args[++i], 10);
  if (args[i] === '--game' && args[i + 1]) targetGame = args[++i];
}

// Inline the preprocessing function so it can be injected into the browser
const preprocessRGBSource = readFileSync(join(repoRoot, 'poc', 'p5', 'obs.mjs'), 'utf8');
// Extract just the RGB function body
const rgbFnMatch = preprocessRGBSource.match(
  /export function preprocessObservationRGB\(([\s\S]*?)\n\}/,
);
const preprocessRGBFn = `function preprocessObservationRGB(${rgbFnMatch[1]}\n}`;

function listGames() {
  return readdirSync(gamesDir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => f.replace('.js', ''))
    .sort();
}

function generateGameHTML(gameName) {
  const gameCode = readFileSync(join(gamesDir, `${gameName}.js`), 'utf8');
  const needsMatter = MATTER_GAMES.has(gameName);
  const matterTag = needsMatter
    ? '<script src="https://cdnjs.cloudflare.com/ajax/libs/matter-js/0.20.0/matter.min.js"></script>'
    : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${gameName}</title>
  <style>body { margin: 0; overflow: hidden; background: #000; }</style>
  ${matterTag}
  <script src="https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.0/p5.min.js"></script>
</head>
<body>
<script>
${gameCode}
</script>
</body>
</html>`;
}

// Start a local HTTP server to serve game pages
function startServer(games) {
  const htmlCache = new Map();
  for (const name of games) {
    htmlCache.set(name, generateGameHTML(name));
  }

  const server = createServer((req, res) => {
    const name = req.url.slice(1); // strip leading /
    if (htmlCache.has(name)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(htmlCache.get(name));
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port });
    });
  });
}

const ACTIONS = [
  [],      // NOOP
  [37],    // LEFT
  [39],    // RIGHT
  [38],    // UP
  [40],    // DOWN
  [32],    // D (SPACE)
  [37, 32], // LEFT+D
  [39, 32], // RIGHT+D
];

async function setupBrowserPage(page) {
  // Wait for p5.js to initialize and create a canvas
  await page.waitForFunction(
    () => typeof window.draw === 'function' && !!document.querySelector('canvas'),
    { timeout: 15000 },
  );

  // Inject helpers
  await page.evaluate(
    ({ preprocessSource, obsWidth, obsHeight }) => {
      // Observation preprocessing function
      window.__benchPreprocess = eval(`(${preprocessSource})`);
      window.__benchObsW = obsWidth;
      window.__benchObsH = obsHeight;

      // Key state management
      window.__benchKeys = new Set();
      window.keyIsDown = (code) => window.__benchKeys.has(code);
      window.__benchSetKeys = (codes) => {
        window.__benchKeys = new Set(codes);
      };

      // Game state reader
      window.__benchGetState = () => {
        if (typeof getGameState === 'function') return getGameState();
        return { gameState: 'PLAYING', score: 0, lives: 0 };
      };

      // JSON observation: preprocess in browser, return as JSON number array
      window.__benchGetObsJSON = () => {
        const canvasEl = document.querySelector('canvas');
        const ctx = canvasEl.getContext('2d');
        const imageData = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
        const obs = window.__benchPreprocess(
          imageData.data,
          canvasEl.width,
          canvasEl.height,
          window.__benchObsW,
          window.__benchObsH,
        );
        return Array.from(obs);
      };

      // base64 observation: preprocess in browser, return as base64 string
      window.__benchGetObsBase64 = () => {
        const canvasEl = document.querySelector('canvas');
        const ctx = canvasEl.getContext('2d');
        const imageData = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
        const obs = window.__benchPreprocess(
          imageData.data,
          canvasEl.width,
          canvasEl.height,
          window.__benchObsW,
          window.__benchObsH,
        );
        let binary = '';
        for (let i = 0; i < obs.length; i++) binary += String.fromCharCode(obs[i]);
        return btoa(binary);
      };
    },
    { preprocessSource: preprocessRGBFn, obsWidth: OBS_WIDTH, obsHeight: OBS_HEIGHT },
  );

  // Stop p5's animation loop, reset and warm up
  await page.evaluate(() => {
    noLoop();
    if (typeof resetGame === 'function') resetGame(42);
    draw();
  });

  // Warmup frames
  for (let i = 0; i < WARMUP_FRAMES; i++) {
    const action = ACTIONS[i % ACTIONS.length];
    await page.evaluate((keys) => {
      window.__benchSetKeys(keys);
      draw();
      const st = window.__benchGetState();
      if (st.gameState === 'GAMEOVER' || st.gameState === 'WIN') {
        if (typeof resetGame === 'function') resetGame(42 + Math.random() * 1000 | 0);
        draw();
      }
    }, action);
  }
}

async function benchmarkGameBrowser(page, gameName, port) {
  await page.goto(`http://127.0.0.1:${port}/${gameName}`, { waitUntil: 'networkidle' });
  await setupBrowserPage(page);

  // Benchmark 1: render-only (action + draw + state, no pixel transfer)
  const renderStart = performance.now();
  for (let i = 0; i < BENCH_FRAMES; i++) {
    await page.evaluate((keys) => {
      window.__benchSetKeys(keys);
      draw();
      return window.__benchGetState();
    }, ACTIONS[i % ACTIONS.length]);
  }
  const renderElapsed = performance.now() - renderStart;

  // Reset for next benchmark
  await page.evaluate(() => {
    if (typeof resetGame === 'function') resetGame(100);
    draw();
  });

  // Benchmark 2: JSON pixel transfer (the naive approach)
  const jsonStart = performance.now();
  for (let i = 0; i < BENCH_FRAMES; i++) {
    await page.evaluate((keys) => {
      window.__benchSetKeys(keys);
      draw();
      return {
        state: window.__benchGetState(),
        observation: window.__benchGetObsJSON(),
      };
    }, ACTIONS[i % ACTIONS.length]);
  }
  const jsonElapsed = performance.now() - jsonStart;

  // Reset for next benchmark
  await page.evaluate(() => {
    if (typeof resetGame === 'function') resetGame(200);
    draw();
  });

  // Benchmark 3: base64 pixel transfer (optimized approach)
  const b64Start = performance.now();
  for (let i = 0; i < BENCH_FRAMES; i++) {
    await page.evaluate((keys) => {
      window.__benchSetKeys(keys);
      draw();
      return {
        state: window.__benchGetState(),
        observation: window.__benchGetObsBase64(),
      };
    }, ACTIONS[i % ACTIONS.length]);
  }
  const b64Elapsed = performance.now() - b64Start;

  return {
    renderOnly: {
      fps: Math.round(BENCH_FRAMES / (renderElapsed / 1000)),
      steps: BENCH_FRAMES,
      elapsedMs: Math.round(renderElapsed),
    },
    jsonReadback: {
      fps: Math.round(BENCH_FRAMES / (jsonElapsed / 1000)),
      steps: BENCH_FRAMES,
      elapsedMs: Math.round(jsonElapsed),
    },
    base64Readback: {
      fps: Math.round(BENCH_FRAMES / (b64Elapsed / 1000)),
      steps: BENCH_FRAMES,
      elapsedMs: Math.round(b64Elapsed),
    },
  };
}

function runHeadlessBenchmark(gameName) {
  try {
    const stdout = execFileSync('node', [benchScript, gameName, String(BENCH_FRAMES)], {
      cwd: repoRoot,
      timeout: 60000,
      maxBuffer: 50 * 1024 * 1024,
    });
    const result = JSON.parse(stdout.toString().trim());
    return { fps: result.rlStep.fps, renderFps: result.renderOnly.fps };
  } catch {
    return { fps: null, renderFps: null };
  }
}

async function main() {
  if (!existsSync(chromePath)) {
    process.stderr.write(`Chrome not found at ${chromePath}\n`);
    process.exit(1);
  }

  const games = targetGame ? [targetGame] : listGames();
  process.stderr.write(
    `Benchmarking ${games.length} games (${BENCH_FRAMES} browser frames each)...\n\n`,
  );

  const { server, port } = await startServer(games);
  process.stderr.write(`Local server on port ${port}\n`);

  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  });

  const results = [];

  try {
    const page = await browser.newPage({ viewport: { width: 600, height: 500 } });

    // Patch canvas for faster getImageData
    await page.addInitScript(() => {
      const originalGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function patchedGetContext(type, options) {
        if (type === '2d') {
          return originalGetContext.call(this, type, {
            ...(options || {}),
            willReadFrequently: true,
          });
        }
        return originalGetContext.call(this, type, options);
      };
    });

    for (const gameName of games) {
      process.stderr.write(`  ${gameName}...\n`);

      // Run headless benchmark in child process
      process.stderr.write(`    headless: `);
      const headless = runHeadlessBenchmark(gameName);
      process.stderr.write(`${headless.fps ?? 'ERROR'} FPS\n`);

      // Run browser benchmarks
      try {
        process.stderr.write(`    browser:  `);
        const browserResult = await benchmarkGameBrowser(page, gameName, port);
        process.stderr.write(
          `render=${browserResult.renderOnly.fps} JSON=${browserResult.jsonReadback.fps} base64=${browserResult.base64Readback.fps} FPS\n`,
        );

        results.push({
          game: gameName,
          headless: {
            rlStepFps: headless.fps,
            renderFps: headless.renderFps,
          },
          browser: browserResult,
          speedup: {
            vsJson: headless.fps ? +(headless.fps / browserResult.jsonReadback.fps).toFixed(1) : null,
            vsBase64: headless.fps ? +(headless.fps / browserResult.base64Readback.fps).toFixed(1) : null,
          },
        });
      } catch (err) {
        const msg = err.message.split('\n')[0].slice(0, 120);
        process.stderr.write(`ERROR: ${msg}\n`);
        results.push({
          game: gameName,
          headless: { rlStepFps: headless.fps, renderFps: headless.renderFps },
          error: msg,
        });
      }
    }

    await page.close();
  } finally {
    await browser.close();
    server.close();
  }

  const output = {
    generated_at: new Date().toISOString(),
    system: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      cpu_model: os.cpus()[0]?.model || null,
      cpu_count: os.cpus().length,
      chrome_path: chromePath,
    },
    config: {
      bench_frames: BENCH_FRAMES,
      warmup_frames: WARMUP_FRAMES,
      obs_width: OBS_WIDTH,
      obs_height: OBS_HEIGHT,
      obs_format: 'rgb',
    },
    results,
  };

  mkdirSync(outputsDir, { recursive: true });
  const outPath = join(outputsDir, 'all-games-browser-benchmark-latest.json');
  writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  process.stderr.write(`\nSaved to ${outPath}\n`);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});
