import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import vm from 'vm';
import os from 'os';
import { createCanvas, loadImage } from 'canvas';
import { chromium } from 'playwright-core';

import {
  installGlobals,
  setKeysDown,
  simulateKeyPress,
  tick,
  isLooping,
  getPixelData,
} from '../poc/p5/p5-shim.mjs';
import { preprocessObservationFromRGBA } from '../poc/p5/obs.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const outputsDir = join(repoRoot, 'outputs');

const FRAMES_HEADLESS = 1000;
const FRAMES_BROWSER = 200;
const WARMUP_FRAMES = 60;
const OBS_WIDTH = 84;
const OBS_HEIGHT = 84;

function actionForFrame(i) {
  return i % 60 < 30 ? [39] : [37];
}

function formatResult(label, steps, elapsedMs, checksum) {
  const fps = steps / (elapsedMs / 1000);
  return { label, steps, elapsedMs, fps, checksum };
}

function printResult(prefix, result) {
  console.log(
    `${prefix}${result.label}: ${result.steps} frames in ${result.elapsedMs.toFixed(1)}ms = ${result.fps.toFixed(0)} FPS (checksum ${result.checksum})`,
  );
}

function timestampForFilename(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function checksumObservation(obs, state) {
  const mid = obs.length >> 1;
  return obs[0] + obs[mid] + obs[obs.length - 1] + state.score + state.lives + state.player.x;
}

async function preprocessPngObservation(buffer, obsWidth = OBS_WIDTH, obsHeight = OBS_HEIGHT) {
  const image = await loadImage(buffer);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  const imageData = ctx.getImageData(0, 0, image.width, image.height);
  return preprocessObservationFromRGBA(imageData.data, image.width, image.height, obsWidth, obsHeight);
}

function runLoopBenchmark(frames, stepFn) {
  const start = performance.now();
  let checksum = 0;
  let steps = 0;

  for (let i = 0; i < frames; i++) {
    checksum += stepFn(i) || 0;
    steps++;
    if (!isLooping()) break;
  }

  return formatResult('', steps, performance.now() - start, checksum);
}

function runHeadlessBenchmark() {
  installGlobals();

  let gameCode = readFileSync(join(repoRoot, 'poc/p5/kazuki_game.js'), 'utf8');
  gameCode += `
globalThis.getGameState = () => ({ gameState, score, lives, player, inventory, currentRoom });
`;
  vm.runInThisContext(gameCode);

  globalThis.setup();
  tick();
  simulateKeyPress(13);
  tick();

  for (let i = 0; i < WARMUP_FRAMES; i++) {
    setKeysDown(actionForFrame(i));
    tick();
  }

  const renderOnly = runLoopBenchmark(FRAMES_HEADLESS, (i) => {
    setKeysDown(actionForFrame(i));
    tick();
    return globalThis.frameCount & 255;
  });
  renderOnly.label = 'Render-only (action + tick)';

  const rlStep = runLoopBenchmark(FRAMES_HEADLESS, (i) => {
    setKeysDown(actionForFrame(i));
    tick();
    const frame = getPixelData();
    const state = globalThis.getGameState();
    const obs = preprocessObservationFromRGBA(frame.data, frame.width, frame.height);
    return checksumObservation(obs, state);
  });
  rlStep.label = `RL step (action + tick + ${OBS_WIDTH}x${OBS_HEIGHT} grayscale + state)`;

  return { renderOnly, rlStep };
}

async function setupBrowserPage(page) {
  await page.waitForFunction(() => typeof window.draw === 'function' && typeof window.noLoop === 'function' && !!document.querySelector('canvas'));

  await page.evaluate(({ preprocessSource, obsWidth, obsHeight }) => {
    window.__codexPreprocessObservation = eval(`(${preprocessSource})`);
    window.__codexObsWidth = obsWidth;
    window.__codexObsHeight = obsHeight;
    window.__codexKeys = new Set();
    window.keyIsDown = (code) => window.__codexKeys.has(code);
    window.__codexSetKeys = (codes) => {
      window.__codexKeys = new Set(codes);
    };
    window.__codexPress = (code) => {
      window.keyCode = code;
      if (typeof window.keyPressed === 'function') window.keyPressed();
    };
    window.__codexGetState = () => ({
      gameState,
      score,
      lives,
      player: { x: player.x, y: player.y },
      currentRoom: { x: currentRoom.x, y: currentRoom.y },
    });
    window.__codexGetObservation = () => {
      const canvasEl = document.querySelector('canvas');
      const ctx = canvasEl.getContext('2d');
      const imageData = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
      const obs = window.__codexPreprocessObservation(
        imageData.data,
        canvasEl.width,
        canvasEl.height,
        window.__codexObsWidth,
        window.__codexObsHeight,
      );
      return Array.from(obs);
    };
  }, {
    preprocessSource: preprocessObservationFromRGBA.toString(),
    obsWidth: OBS_WIDTH,
    obsHeight: OBS_HEIGHT,
  });

  await page.evaluate(() => {
    noLoop();
    window.__codexPress(13);
    draw();
  });

  for (let i = 0; i < WARMUP_FRAMES; i++) {
    await page.evaluate((keys) => {
      window.__codexSetKeys(keys);
      draw();
      return window.__codexGetState().score;
    }, actionForFrame(i));
  }
}

async function runBrowserBenchmark() {
  if (!existsSync(chromePath)) {
    throw new Error(`Chrome not found at ${chromePath}`);
  }

  const browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--allow-file-access-from-files',
    ],
  });

  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    const consoleLogs = [];
    page.on('console', (msg) => consoleLogs.push(`${msg.type()}: ${msg.text()}`));

    await page.addInitScript(() => {
      const originalGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function patchedGetContext(type, options) {
        if (type === '2d') {
          const nextOptions = { ...(options || {}), willReadFrequently: true };
          return originalGetContext.call(this, type, nextOptions);
        }
        return originalGetContext.call(this, type, options);
      };
    });

    const gameUrl = pathToFileURL(join(repoRoot, 'games/kazuki_game.html')).href;
    await page.goto(gameUrl, { waitUntil: 'networkidle' });
    await setupBrowserPage(page);

    const canvas = page.locator('canvas');

    const renderStart = performance.now();
    let renderChecksum = 0;
    for (let i = 0; i < FRAMES_BROWSER; i++) {
      const state = await page.evaluate((keys) => {
        window.__codexSetKeys(keys);
        draw();
        return window.__codexGetState();
      }, actionForFrame(i));
      renderChecksum += state.score + state.lives + state.player.x;
    }
    const renderOnly = formatResult(
      'Render-only (action + draw + state over Playwright)',
      FRAMES_BROWSER,
      performance.now() - renderStart,
      renderChecksum,
    );

    const canvasReadbackStart = performance.now();
    let canvasReadbackChecksum = 0;
    for (let i = 0; i < FRAMES_BROWSER; i++) {
      const payload = await page.evaluate((keys) => {
        window.__codexSetKeys(keys);
        draw();
        return {
          state: window.__codexGetState(),
          observation: window.__codexGetObservation(),
        };
      }, actionForFrame(i));
      canvasReadbackChecksum += checksumObservation(payload.observation, payload.state);
    }
    const canvasReadback = formatResult(
      `RL step (action + draw + ${OBS_WIDTH}x${OBS_HEIGHT} grayscale via getImageData + state over Playwright)`,
      FRAMES_BROWSER,
      performance.now() - canvasReadbackStart,
      canvasReadbackChecksum,
    );

    const screenshotStart = performance.now();
    let screenshotChecksum = 0;
    for (let i = 0; i < FRAMES_BROWSER; i++) {
      const state = await page.evaluate((keys) => {
        window.__codexSetKeys(keys);
        draw();
        return window.__codexGetState();
      }, actionForFrame(i));
      const png = await canvas.screenshot({ type: 'png' });
      const obs = await preprocessPngObservation(png);
      screenshotChecksum += checksumObservation(obs, state);
    }
    const screenshotReadback = formatResult(
      `RL step (action + draw + ${OBS_WIDTH}x${OBS_HEIGHT} grayscale via screenshot + state over Playwright)`,
      FRAMES_BROWSER,
      performance.now() - screenshotStart,
      screenshotChecksum,
    );

    const finalState = await page.evaluate(() => window.__codexGetState());
    return { renderOnly, canvasReadback, screenshotReadback, finalState, consoleLogs };
  } finally {
    await browser.close();
  }
}

function printComparison(headless, browser) {
  console.log('\nComparison:');
  console.log(
    `  Render-only speedup: ${(headless.renderOnly.fps / browser.renderOnly.fps).toFixed(1)}x (${headless.renderOnly.fps.toFixed(0)} vs ${browser.renderOnly.fps.toFixed(0)} FPS)`,
  );
  console.log(
    `  RL-step speedup vs browser getImageData: ${(headless.rlStep.fps / browser.canvasReadback.fps).toFixed(1)}x (${headless.rlStep.fps.toFixed(0)} vs ${browser.canvasReadback.fps.toFixed(0)} FPS)`,
  );
  console.log(
    `  RL-step speedup vs browser screenshot: ${(headless.rlStep.fps / browser.screenshotReadback.fps).toFixed(1)}x (${headless.rlStep.fps.toFixed(0)} vs ${browser.screenshotReadback.fps.toFixed(0)} FPS)`,
  );
}

function writeOutputs(headless, browser) {
  mkdirSync(outputsDir, { recursive: true });
  const generatedAt = new Date();
  const stamp = timestampForFilename(generatedAt);

  const comparison = {
    render_only_speedup: headless.renderOnly.fps / browser.renderOnly.fps,
    rl_step_vs_browser_getimagedata_speedup: headless.rlStep.fps / browser.canvasReadback.fps,
    rl_step_vs_browser_screenshot_speedup: headless.rlStep.fps / browser.screenshotReadback.fps,
  };

  const artifact = {
    generated_at: generatedAt.toISOString(),
    system: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      cpu_model: os.cpus()[0]?.model || null,
      cpu_count: os.cpus().length,
      chrome_path: chromePath,
    },
    config: {
      warmup_frames: WARMUP_FRAMES,
      headless_frames: FRAMES_HEADLESS,
      browser_frames: FRAMES_BROWSER,
      observation_width: OBS_WIDTH,
      observation_height: OBS_HEIGHT,
      observation_format: 'grayscale',
    },
    headless,
    browser,
    comparison,
  };

  const jsonPath = join(outputsDir, `kazuki-benchmark-${stamp}.json`);
  writeFileSync(jsonPath, `${JSON.stringify(artifact, null, 2)}\n`);

  const markdown = [
    '# Kazuki Benchmark',
    '',
    `Generated: ${artifact.generated_at}`,
    '',
    '## System',
    '',
    `- Platform: ${artifact.system.platform} ${artifact.system.arch}`,
    `- Node: ${artifact.system.node}`,
    `- CPU: ${artifact.system.cpu_model || 'unknown'} (${artifact.system.cpu_count} cores)`,
    `- Chrome: ${artifact.system.chrome_path}`,
    '',
    '## Results',
    '',
    '| Mode | FPS | Frames | Elapsed ms |',
    '|---|---:|---:|---:|',
    `| ${headless.renderOnly.label} | ${headless.renderOnly.fps.toFixed(0)} | ${headless.renderOnly.steps} | ${headless.renderOnly.elapsedMs.toFixed(1)} |`,
    `| ${headless.rlStep.label} | ${headless.rlStep.fps.toFixed(0)} | ${headless.rlStep.steps} | ${headless.rlStep.elapsedMs.toFixed(1)} |`,
    `| ${browser.renderOnly.label} | ${browser.renderOnly.fps.toFixed(0)} | ${browser.renderOnly.steps} | ${browser.renderOnly.elapsedMs.toFixed(1)} |`,
    `| ${browser.canvasReadback.label} | ${browser.canvasReadback.fps.toFixed(0)} | ${browser.canvasReadback.steps} | ${browser.canvasReadback.elapsedMs.toFixed(1)} |`,
    `| ${browser.screenshotReadback.label} | ${browser.screenshotReadback.fps.toFixed(0)} | ${browser.screenshotReadback.steps} | ${browser.screenshotReadback.elapsedMs.toFixed(1)} |`,
    '',
    '## Speedups',
    '',
    `- Render-only speedup: ${comparison.render_only_speedup.toFixed(1)}x`,
    `- RL-step speedup vs browser getImageData: ${comparison.rl_step_vs_browser_getimagedata_speedup.toFixed(1)}x`,
    `- RL-step speedup vs browser screenshot: ${comparison.rl_step_vs_browser_screenshot_speedup.toFixed(1)}x`,
    '',
    '## Final Browser State',
    '',
    `- gameState: ${browser.finalState.gameState}`,
    `- score: ${browser.finalState.score}`,
    `- lives: ${browser.finalState.lives}`,
    '',
  ].join('\n');

  const mdPath = join(outputsDir, `kazuki-benchmark-${stamp}.md`);
  writeFileSync(mdPath, `${markdown}\n`);

  const latestJsonPath = join(outputsDir, 'kazuki-benchmark-latest.json');
  const latestMdPath = join(outputsDir, 'kazuki-benchmark-latest.md');
  writeFileSync(latestJsonPath, `${JSON.stringify(artifact, null, 2)}\n`);
  writeFileSync(latestMdPath, `${markdown}\n`);

  return { jsonPath, mdPath, latestJsonPath, latestMdPath };
}

async function main() {
  console.log('Benchmarking headless p5 shim...');
  const headless = runHeadlessBenchmark();
  printResult('  ', headless.renderOnly);
  printResult('  ', headless.rlStep);

  console.log('\nBenchmarking Playwright + Chromium...');
  const browser = await runBrowserBenchmark();
  printResult('  ', browser.renderOnly);
  printResult('  ', browser.canvasReadback);
  printResult('  ', browser.screenshotReadback);
  console.log(`  Final browser state: ${browser.finalState.gameState}, score=${browser.finalState.score}, lives=${browser.finalState.lives}`);

  printComparison(headless, browser);
  const outputs = writeOutputs(headless, browser);
  console.log('\nOutputs:');
  console.log(`  ${outputs.jsonPath}`);
  console.log(`  ${outputs.mdPath}`);
  console.log(`  ${outputs.latestJsonPath}`);
  console.log(`  ${outputs.latestMdPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
