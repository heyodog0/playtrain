#!/usr/bin/env node
// study-browser-check.mjs — does the participant's BROWSER change the environment?
//
// study/study-parity.sh establishes that the pure-JS rasterizer, the Rust rasterizer and the
// native QuickJS backend agree bit-for-bit. All of that runs on V8. It says nothing about the
// engines participants actually arrive with: Safari is JavaScriptCore, Firefox is SpiderMonkey,
// and a single last-bit difference in Math.sin/cos/pow/atan2 moves a sprite, which moves a
// collision, which moves a score. Not hypothetical here -- native/build_qjs.sh:11-18 records
// asteroids diverging on Math.sin until fdlibm was vendored, and asteroids is in the study set.
//
// The method: ONE trace program, as a single source string, run unchanged in node (with
// PLAYTRAIN_RASTERIZER=js, so the rasterizer matches the browser and the only variable left is
// the engine) and in Chromium, Firefox and WebKit. It drives the env with a fixed action
// formula instead of keystrokes, so nothing depends on timing, and hashes the full rasterized
// frame plus score/lives/state every step. Any disagreement is an engine disagreement.
//
//   node study/study-browser-check.mjs
//   node study/study-browser-check.mjs --steps 900 --seed 90000 --games asteroids,caveflyer
//   node study/study-browser-check.mjs --engines chromium,webkit
//
// Exits non-zero if any engine diverges. Needs playwright with the browsers installed:
//   npm i -D playwright && npx playwright install chromium firefox webkit

import { createServer } from 'http';
import { spawnSync } from 'child_process';
import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { browserShimBundle } from '../tools/play-templates.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const GAMES_DIR = resolve(arg('--games-dir',
  process.env.PLAYTRAIN_GAMES_DIR || join(REPO_ROOT, 'examples', 'games', 'js')));
const STEPS = parseInt(arg('--steps', '600'), 10);
const SEED = parseInt(arg('--seed', '90000'), 10) >>> 0;
const GAMES = arg('--games', 'pong,breakout,plunder,seaquest,caveflyer,asteroids,coinrun,flappy_bird,vvvvvv').split(',');
const ENGINES = arg('--engines', 'chromium,firefox,webkit').split(',');
const OBS_RES = parseInt(arg('--obs-res', '64'), 10);   // rasterize at the agent's resolution
const TMP = join(REPO_ROOT, 'dist', 'browser-check');

// --perturb <eps> adds eps to every Math.sin result in the browser. A green run proves
// nothing unless the comparator can catch a known-bad engine, and sweeping eps measures how
// small a divergence this test can actually see within --steps.
const PERTURB = process.argv.includes('--perturb') ? Number(arg('--perturb', '1e-6')) : 0;

// ---------------------------------------------------------------------------
// The trace program. Written ONCE and shipped to every engine verbatim, so a
// difference in results cannot be a difference in the harness. Mirrors
// runtime/p5/game-env.mjs's reset and step order, and the study block page's, including
// setRasterRes before setup, mulberry32 seeding of Math.random before resetGame, the free
// tick after reset, and the Discrete(8) action table from game-env.mjs:42.
// Assumes the shim's exports are already in scope as globals (see how it is wrapped below).
// ---------------------------------------------------------------------------
const TRACE_PROGRAM = `
function __trace(gameSource, seed, nsteps, obsRes) {
  var ACTIONS = [
    { held: [],   press: null },
    { held: [37], press: null },
    { held: [39], press: null },
    { held: [38], press: null },
    { held: [40], press: null },
    { held: [],   press: 32 },
    { held: [37], press: 32 },
    { held: [39], press: 32 },
  ];
  function mulberry32(s) {
    var t = s >>> 0;
    return function () {
      t += 0x6d2b79f5;
      var n = Math.imul(t ^ (t >>> 15), t | 1);
      n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
      return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
    };
  }
  // FNV-1a over the frame bytes, in 32-bit chunks so every engine does the same integer
  // arithmetic (BigInt would be equally fine but is slower over ~16k pixels x nsteps).
  function fnv1a32(bytes) {
    var h = 0x811c9dc5;
    for (var i = 0; i < bytes.length; i++) {
      h ^= bytes[i];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }
  var actionAt = function (i) { return (i * 3 + 1) % 8; };

  setRasterRes(obsRes);
  installGlobals();
  (0, eval)(gameSource);
  if (typeof setup !== 'function' || typeof resetGame !== 'function' || typeof getGameState !== 'function') {
    throw new Error('game is missing setup/resetGame/getGameState');
  }
  setup();

  Math.random = mulberry32(seed);
  setKeysDown([]);
  resetFrameCount();
  resetGame(seed);
  tick();                                  // game-env.mjs reset()'s free tick

  var rows = [];
  function row(i, a) {
    var st = getGameState();
    var px = getPixelData();
    return i + ' a=' + a + ' score=' + st.score + ' lives=' + st.lives +
           ' state=' + st.gameState + ' frame=' + fnv1a32(px.data);
  }
  rows.push(row(-1, -1));                  // post-reset state
  for (var i = 0; i < nsteps; i++) {
    var a = actionAt(i);
    var act = ACTIONS[a];
    setKeysDown(act.held);
    if (act.press !== null) simulateKeyPress(act.press);
    tick();
    rows.push(row(i, a));
    var s = getGameState();
    if (s.gameState === 'WIN' || s.gameState === 'EXIT' || s.gameState === 'GAMEOVER') {
      // Re-seed and restart exactly as reference_trace.mjs does, so a short-lived game
      // still produces a long trajectory to compare.
      Math.random = mulberry32((seed + i + 1) >>> 0);
      setKeysDown([]);
      resetFrameCount();
      resetGame((seed + i + 1) >>> 0);
      tick();
    }
  }
  return rows;
}
`;

function pageFor(gameSource) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>trace</title></head><body>
<script type="text/plain" id="src">${gameSource.replace(/<\/script>/gi, '<\\/script>')}</script>
<script type="module">
${browserShimBundle()}
${TRACE_PROGRAM}
window.__run = function (seed, nsteps, obsRes) {
  return __trace(document.getElementById('src').textContent, seed, nsteps, obsRes);
};
window.__ready = true;
</script></body></html>`;
}

// ---------------------------------------------------------------------------
// Node side: same program, same rasterizer as the browser (js), different engine (V8 via
// node rather than V8 via Chromium -- and Chromium is included below so that difference is
// itself measured).
//
// ONE CHILD PROCESS PER GAME, and this is not optional. p5-shim keeps the game's state in a
// single global scope, which is why the real runtime is one-game-per-process (game-env.mjs's
// `gameLoaded`) and why the study gives every block its own iframe. Tracing several games in
// one process leaks globals from each game into the next, and the resulting mismatches look
// exactly like browser divergence -- an earlier version of this file did precisely that and
// reported three games as diverging in every browser. The browser side was already isolated
// (a fresh page per game), so the artefact was entirely on this side.
// ---------------------------------------------------------------------------
const WORKER = join(TMP_EARLY(), 'node-trace-worker.mjs');
function TMP_EARLY() { return join(REPO_ROOT, 'dist', 'browser-check'); }

function writeWorker() {
  writeFileSync(WORKER, `
import { readFileSync } from 'fs';
import * as shim from ${JSON.stringify(join(REPO_ROOT, 'runtime', 'p5', 'p5-shim.mjs'))};
${TRACE_PROGRAM}
const [gamePath, seed, nsteps, res] = process.argv.slice(2);
globalThis.installGlobals = shim.installGlobals;
globalThis.setRasterRes = shim.setRasterRes;
globalThis.setKeysDown = shim.setKeysDown;
globalThis.simulateKeyPress = shim.simulateKeyPress;
globalThis.tick = shim.tick;
globalThis.resetFrameCount = shim.resetFrameCount;
globalThis.getPixelData = shim.getPixelData;
const rows = __trace(readFileSync(gamePath, 'utf8'), Number(seed) >>> 0, Number(nsteps), Number(res));
process.stdout.write(JSON.stringify(rows));
`);
}

function nodeTrace(game) {
  const r = spawnSync(process.execPath, [WORKER, join(GAMES_DIR, `${game}.js`), String(SEED), String(STEPS), String(OBS_RES)],
    // js so the rasterizer matches the browser's; WEBGL games have no pure-JS path and use
    // the same wasm the browser bundle inlines (bit-identical to js by gate_qjs.sh).
    { env: { ...process.env, PLAYTRAIN_RASTERIZER: /\bWEBGL\b/.test(readFileSync(join(GAMES_DIR, `${game}.js`), 'utf8')) ? 'wasm' : 'js' },
      maxBuffer: 1 << 28, encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(`node reference trace failed for ${game}:\n${(r.stderr || '').split('\n').slice(0, 6).join('\n')}`);
    process.exit(1);
  }
  return JSON.parse(r.stdout);
}

// ---------------------------------------------------------------------------
let playwright;
try { playwright = await import('playwright'); }
catch {
  console.error('playwright not installed. run: npm i -D playwright && npx playwright install chromium firefox webkit');
  process.exit(1);
}

if (existsSync(TMP)) rmSync(TMP, { recursive: true });
mkdirSync(TMP, { recursive: true });

const sources = {};
for (const g of GAMES) {
  const p = join(GAMES_DIR, `${g}.js`);
  if (!existsSync(p)) { console.error(`game not found: ${p}`); process.exit(1); }
  sources[g] = readFileSync(p, 'utf8');
  writeFileSync(join(TMP, `${g}.html`), pageFor(sources[g]));
}

const server = createServer((req, res) => {
  const p = join(TMP, decodeURIComponent(req.url.split('?')[0]).replace(/^\//, ''));
  if (!existsSync(p)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(readFileSync(p));
});
await new Promise(r => server.listen(0, r));
const PORT = server.address().port;

console.log(`cross-engine determinism: ${GAMES.length} games x ${STEPS} steps, seed ${SEED}, ` +
            `rasterized at ${OBS_RES}x${OBS_RES}`);
console.log(`reference: node + pure-JS rasterizer (bit-equal to the Rust rasterizer and the ` +
            `QuickJS training backend per study/study-parity.sh)\n`);

// Reference traces first, one per game, in this process.
writeWorker();
const ref = {};
for (const g of GAMES) ref[g] = nodeTrace(g);

const results = [];         // {engine, game, ok, firstBad, detail}
for (const engine of ENGINES) {
  let browser;
  try { browser = await playwright[engine].launch(); }
  catch (e) {
    console.log(`${engine}: LAUNCH FAILED (${String(e).split('\n')[0]})`);
    results.push({ engine, game: '-', ok: false, detail: 'launch failed' });
    continue;
  }
  const version = browser.version();
  for (const g of GAMES) {
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    // --perturb proves the check can fail. A green run means nothing unless a known-bad
    // engine is actually caught, and one ULP on Math.sin is the smallest realistic version
    // of the failure this tool exists to detect (build_qjs.sh:11-18: asteroids diverged on
    // exactly that). Expect DIVERGES on every trig-using game when this is on.
    if (PERTURB) {
      await page.addInitScript((EPS) => {
        const s = Math.sin;
        // 1e-12 absolute, not x*(1+2^-52): the relative version rounds back to x over much
        // of the mantissa range, so it silently perturbs nothing. This is ~1e-10 of a pixel
        // per call -- invisible, and still enough to move a collision within a few hundred
        // steps if the trajectory depends on trig at all.
        Math.sin = (x) => s(x) + EPS;
        window.__perturbed = true;
      }, PERTURB);
    }
    await page.goto(`http://localhost:${PORT}/${g}.html`);
    await page.waitForFunction('window.__ready === true', null, { timeout: 20000 });
    let rows;
    try {
      rows = await page.evaluate(([s, n, o]) => window.__run(s, n, o), [SEED, STEPS, OBS_RES]);
    } catch (e) {
      rows = null;
      errs.push(String(e).split('\n')[0]);
    }
    await page.close();

    if (!rows) {
      results.push({ engine, game: g, ok: false, detail: `threw: ${errs[0] || 'unknown'}` });
      continue;
    }
    const r = ref[g];
    let firstBad = -1;
    for (let i = 0; i < Math.min(r.length, rows.length); i++) {
      if (r[i] !== rows[i]) { firstBad = i; break; }
    }
    if (firstBad < 0 && r.length !== rows.length) firstBad = Math.min(r.length, rows.length);
    results.push({
      engine, game: g, ok: firstBad < 0, firstBad,
      detail: firstBad < 0 ? '' : `step ${r[firstBad] ? r[firstBad].split(' ')[0] : '?'}\n` +
        `        node: ${r[firstBad] || '(no row)'}\n` +
        `        ${engine}: ${rows[firstBad] || '(no row)'}`,
    });
  }
  await browser.close();
  const mine = results.filter(x => x.engine === engine);
  const bad = mine.filter(x => !x.ok);
  console.log(`${engine} ${version}`);
  for (const m of mine) {
    console.log(`  ${m.ok ? 'match ' : 'DIVERGES'} ${m.game}${m.ok ? '' : '  ' + m.detail}`);
  }
  console.log(`  -> ${mine.length - bad.length}/${mine.length} games identical to the reference\n`);
}

server.close();

const bad = results.filter(r => !r.ok);
if (!bad.length) {
  console.log(`ALL CLEAR: ${ENGINES.join(', ')} produce byte-identical trajectories and frames.`);
  console.log('A participant on any of these browsers plays the environment the agent trained on.');
} else {
  console.log(`DIVERGENCE in ${bad.length} engine/game combination(s):`);
  for (const b of bad) console.log(`  ${b.engine} / ${b.game}`);
  console.log('\nThese participants are NOT playing the agent\'s environment. Options: gate the');
  console.log('browser in the pre-flight, or exclude affected sessions -- verify-replay will');
  console.log('flag them, since replay runs on V8 and the score will not reproduce.');
  process.exit(1);
}
