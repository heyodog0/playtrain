// study-templates.mjs — HTML for the human-baseline study harness.
//
// Reuses the SAME browser shim bundle as the public tester (tools/play-templates.mjs):
// runtime/p5/raster.mjs + runtime/p5/p5-shim.mjs, inlined. No real p5, no CDN, no build
// step, no network at play time. The human therefore plays through the exact drawing,
// keying and RNG code the agent trains on — identity by construction, not assertion.
//
// What this adds over the tester, all of it required for the run to be comparable to
// an agent episode (see runtime/p5/game-env.mjs, which this mirrors):
//
//   * mulberry32 seeding of Math.random BEFORE resetGame  (GameEnv._setSeed)
//   * resetFrameCount() before resetGame                  (GameEnv.reset, shim:480)
//   * the Discrete(8) ACTIONS table, verbatim             (game-env.mjs:42)
//   * frameSkip action-repeat and maxSteps truncation     (GameEnv.step)
//   * TERMINAL_STATES handling with auto-advance to the next seed
//   * frame-indexed action logging, so a session can be REPLAYED through the headless
//     env at the same seed and the score checked to match (tools/verify-replay.mjs)
//
// Each block runs in its own iframe so every game gets a fresh global scope, the same
// isolation the headless runtime gets from one-game-per-process (game-env.mjs `gameLoaded`).

import { browserShimBundle } from './play-templates.mjs';
import { consentHtml, instructionPages, quizQuestions, durationPhrase } from './study-screens.mjs';

// Participant-facing styling. Deliberately plain: a system sans-serif, near-black text
// on white, no accent colours. The tester's dark monospace look (play-templates.mjs
// baseStyle) is for us, not for a novice being asked to concentrate on a game they have
// never seen; light also matches the lab's other online studies. Everything here should
// recede so the canvas is the only thing to look at.
export const studyBase = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { background: #fff; color: #111; margin: 0;
         font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         -webkit-font-smoothing: antialiased; }
  button { background: #111; color: #fff; border: 0; border-radius: 4px;
           padding: 10px 20px; cursor: pointer; font: inherit; font-size: 15px; }
  button:hover { background: #333; }
  button:disabled { background: #d8d8d8; color: #999; cursor: default; }
  a { color: #111; }
`;

const studyStyle = `${studyBase}
  body { display: flex; flex-direction: column; align-items: center;
         justify-content: center; min-height: 100vh; padding: 12px; overflow: hidden; }
  /* The games draw their own (mostly dark) backgrounds, so give the canvas a hairline
     border -- without it a dark game floats on white with no edge. */
  canvas { image-rendering: pixelated; display: block; border: 1px solid #ddd; }
  #hud { display: flex; gap: 32px; font-size: 15px; color: #777; margin-bottom: 10px;
         font-variant-numeric: tabular-nums; }
  #hud b { color: #111; font-weight: 600; }
  #timer { color: #111; }
  #timer.low { color: #111; opacity: .5; }
  #veil { position: fixed; inset: 0; background: #fff; display: flex;
          flex-direction: column; align-items: center; justify-content: center;
          text-align: center; padding: 32px; gap: 18px; }
  #veil.hidden { display: none; }
  #veil h2 { font-size: 22px; font-weight: 600; margin: 0; color: #111; }
  #veil p { color: #666; font-size: 15px; max-width: 520px; line-height: 1.65; margin: 0; }
  #veil .keys { color: #111; font-size: 16px; max-width: 520px; line-height: 1.7; }
  /* Between-rounds summary. Games can score and terminate on the SAME frame
     (caveflyer.js:322 gives +10 and sets WIN together), so without this the
     player never sees what they earned. Opaque rather than translucent: it sits over
     whatever the game was drawing, so a scrim would give unpredictable contrast. */
  #stage { position: relative; display: inline-block; line-height: 0; }
  #roundend { position: absolute; inset: 0; background: #fff;
              display: flex; flex-direction: column; align-items: center;
              justify-content: center; gap: 8px; text-align: center; line-height: 1.4; }
  #roundend.hidden { display: none; }
  #roundend .r-title { color: #666; font-size: 16px; }
  #roundend .r-score { color: #111; font-size: 64px; font-weight: 300;
                       font-variant-numeric: tabular-nums; }
  #roundend .r-best { color: #111; font-size: 14px; font-weight: 600; }
  #roundend .r-best.hidden { display: none; }
  #roundend .r-next { color: #999; font-size: 13px; margin-top: 14px; }
`;

// ---------------------------------------------------------------------------
// Block page: one game, one timed block. Rendered into an iframe by the session
// shell, which it talks to over postMessage.
// ---------------------------------------------------------------------------
export function blockPage(name, source, cfg) {
  const {
    blockSeconds = 150, frameSkip = 1, maxSteps = 2000, seedBase = 90000,
    actionMode = 'quantized', controls = '', obsRes = false,
    canvasSize = 600, seedCount = 100, uploadUrl = '',
    // NOT `practice`: study-config.json has a `practice` OBJECT (game/seconds/controls),
    // and blockPage is called with {...cfg}, so a flag by that name silently became
    // truthy for every scored block -- marking the whole study as practice data.
    isPractice = false,
  } = cfg || {};
  const practice = isPractice;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${name}</title>
<meta name="robots" content="noindex, nofollow, noarchive, nosnippet">
<style>${studyStyle}</style></head><body>

<div id="hud">
  <span>round <b id="ep">1</b></span>
  <span>score <b id="score">0</b></span>
  <span>best <b id="best">0</b></span>
  <span id="timer">--:--</span>
</div>
<div id="stage">
  <canvas id="view"></canvas>
  <div id="roundend" class="hidden">
    <div class="r-title">Round <span id="r-n"></span> complete</div>
    <div class="r-score"><span id="r-pts"></span></div>
    <div class="r-best hidden" id="r-newbest">new best</div>
    <div class="r-next">next round starting…</div>
  </div>
</div>

<div id="veil">
  <h2>${practice ? 'Practice' : 'Next game'}: ${name}</h2>
  <p class="keys">${controls}</p>
  <p>${practice
      ? 'This is a warm-up so you can get used to the controls. It is not scored.'
      : `You have <b>${durationPhrase(blockSeconds)}</b>, split into rounds. Score as many points as you can in every round.`}</p>
  <p>Click the button, then use the keyboard. Do not use the mouse while playing.</p>
  <button id="go">Start</button>
</div>

<script type="text/plain" id="game-src">${source}</script>

<script type="module">
${browserShimBundle()}

(function () {
  'use strict';

  // ---- mirrored from runtime/p5/game-env.mjs ------------------------------
  // Discrete(8). Copied verbatim; if game-env.mjs:42 ever changes, this must too.
  var ACTIONS = [
    { name: 'NOOP',    held: [],   press: null },
    { name: 'LEFT',    held: [37], press: null },
    { name: 'RIGHT',   held: [39], press: null },
    { name: 'UP',      held: [38], press: null },
    { name: 'DOWN',    held: [40], press: null },
    { name: 'D',       held: [],   press: 32 },
    { name: 'LEFT_D',  held: [37], press: 32 },
    { name: 'RIGHT_D', held: [39], press: 32 },
  ];
  var TERMINAL = { WIN: 1, EXIT: 1, GAMEOVER: 1 };

  function mulberry32(seed) {
    var t = seed >>> 0;
    return function () {
      t += 0x6d2b79f5;
      var n = Math.imul(t ^ (t >>> 15), t | 1);
      n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
      return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
    };
  }

  var FRAME_SKIP  = ${frameSkip};
  var MAX_STEPS   = ${maxSteps};
  var SEED_BASE   = ${seedBase};
  var SEED_COUNT  = ${seedCount};
  var BLOCK_MS    = ${blockSeconds} * 1000;
  var ACTION_MODE = ${JSON.stringify(actionMode)};
  var OBS_RES     = ${obsRes ? 64 : 0};
  var GAME        = ${JSON.stringify(name)};
  var UPLOAD_URL  = ${JSON.stringify(uploadUrl)};
  var PRACTICE    = ${practice ? 'true' : 'false'};

  // ---- boot ---------------------------------------------------------------
  // setRasterRes BEFORE setup(), exactly as game-env.mjs does, so in obs mode the
  // geometry is rasterized directly at 64 and the view IS the observation.
  if (OBS_RES) setRasterRes(OBS_RES);
  installGlobals();
  (0, eval)(document.getElementById('game-src').textContent);
  if (typeof window.setup !== 'function')     throw new Error(GAME + ': missing setup()');
  if (typeof window.resetGame !== 'function') throw new Error(GAME + ': missing resetGame(seed)');
  if (typeof window.getGameState !== 'function') throw new Error(GAME + ': missing getGameState()');
  window.setup();

  var view = document.getElementById('view');
  var probe = getPixelData();
  view.width = probe.width; view.height = probe.height;
  var vctx = view.getContext('2d');

  // Scale the canvas up for DISPLAY only. This never touches the rasterizer: the game
  // still renders at its logical size (400x400 for every study game, or 64 in obs mode)
  // and we blit 1:1 into a CSS-scaled element, so the pixels the human sees are exactly
  // the pixels the rasterizer produced.
  //
  // A FIXED target size, not "as large as fits". Filling the viewport would give a
  // laptop participant a 700px game and a QHD participant a 1200px one, so visual angle
  // -- which plausibly affects performance on fast-moving games -- would differ between
  // subjects for no reason. TARGET_PX fits inside the smallest display the pre-flight
  // admits, so nearly every participant gets an identical presentation; it only shrinks
  // if a window is genuinely too small.
  //
  // Native blocks scale fractionally with smoothing: these games are rasterized vector
  // shapes, not pixel art, so bilinear looks better than the uneven pixel widths a
  // fractional nearest-neighbour upscale produces. Obs blocks are the opposite -- seeing
  // the policy's actual pixels is the entire point -- so they get integer nearest-neighbour.
  var TARGET_PX = ${canvasSize};

  function fitCanvas() {
    var avail = Math.min(innerWidth - 40, innerHeight - 96);   // HUD + padding
    var px;
    if (OBS_RES) {
      var k = Math.max(1, Math.floor(Math.min(TARGET_PX, avail) / view.width));
      px = view.width * k;
      view.style.imageRendering = 'pixelated';
    } else {
      px = Math.min(TARGET_PX, avail);
      view.style.imageRendering = 'auto';
    }
    var aspect = view.height / view.width;
    view.style.width = Math.round(px) + 'px';
    view.style.height = Math.round(px * aspect) + 'px';
    canvasPx = Math.round(px);
  }
  var canvasPx = 0;
  fitCanvas();
  addEventListener('resize', fitCanvas);

  // ---- input --------------------------------------------------------------
  // A keyboard can produce 32 states across these five keys; Discrete(8) has 8.
  // The recency stack decides which single action a given hand state maps to:
  // most recently pressed key still held wins, SPACE merges only where legal.
  // This is many-to-one -- 24 of the 32 states fold onto one of the 8 -- so the
  // raw keys are logged alongside the action and the folds are counted.
  var TRACKED = [32, 37, 38, 39, 40];
  var held = new Set();
  var stack = [];              // held keys, oldest -> newest

  addEventListener('keydown', function (e) {
    if (TRACKED.indexOf(e.keyCode) < 0) return;
    e.preventDefault();
    if (!held.has(e.keyCode)) { held.add(e.keyCode); stack.push(e.keyCode); }
  }, { passive: false });
  addEventListener('keyup', function (e) {
    if (TRACKED.indexOf(e.keyCode) < 0) return;
    e.preventDefault();
    held.delete(e.keyCode);
    var i = stack.indexOf(e.keyCode);
    if (i >= 0) stack.splice(i, 1);
  }, { passive: false });
  // A lost focus mid-block would otherwise leave keys stuck down forever.
  addEventListener('blur', function () { held.clear(); stack.length = 0; });

  function quantize() {
    var top = stack.length ? stack[stack.length - 1] : 0;
    var space = held.has(32);
    if (top === 32) return held.has(37) ? 6 : held.has(39) ? 7 : 5;
    if (top === 37) return space ? 6 : 1;
    if (top === 39) return space ? 7 : 2;
    if (top === 38) return 3;   // thrust; a held SPACE is unrepresentable here
    if (top === 40) return 4;
    return 0;
  }

  // True when the held keys carry intent the chosen action cannot express --
  // i.e. this frame is one of the 24 folded states. Counted per episode as a
  // direct measure of how badly Discrete(8) fits this game.
  function isFolded(a) {
    var act = ACTIONS[a];
    var expressed = new Set(act.held);
    if (act.press !== null) expressed.add(act.press);
    var folded = false;
    held.forEach(function (k) { if (!expressed.has(k)) folded = true; });
    return folded;
  }

  // ---- episode ------------------------------------------------------------
  var episodes = [], epIndex = 0, bestScore = 0;
  var seed, seedIndex, steps, lastScore, ret, actions, keylog, foldedFrames, epStart;

  function resetEpisode() {
    // A fixed, shared seed pool: episode i uses SEED_BASE + (i % SEED_COUNT), identical
    // for every participant, so everyone meets the same levels in the same order and the
    // agent can be evaluated on exactly this list. The modulo matters -- a player who
    // dies instantly can burn through far more episodes than the pool has (22 rounds in
    // 12s was measured on flappy_bird), and without it they would wander off into seeds
    // nobody else ever saw.
    seedIndex = epIndex % SEED_COUNT;
    seed = (SEED_BASE + seedIndex) >>> 0;
    var rng = mulberry32(seed);
    Math.random = rng;                 // GameEnv._setSeed -- before resetGame
    setKeysDown([]);
    resetFrameCount();                 // episode-relative frame phase (shim:480)
    window.resetGame(seed);
    tick();                            // GameEnv.reset's free tick; not counted
    steps = 0; ret = 0;
    actions = []; keylog = []; foldedFrames = 0;
    lastScore = window.getGameState().score;
    epStart = performance.now();
    document.getElementById('ep').textContent = String(epIndex + 1);
  }

  function finishEpisode(terminated, truncated, discarded) {
    episodes.push({
      game: GAME, practice: PRACTICE, obsRes: !!OBS_RES,
      episode: epIndex, seed: seed, seedIndex: seedIndex,
      frames: steps, score: lastScore, return: ret,
      terminated: terminated, truncated: truncated, discarded: discarded,
      foldedFrames: foldedFrames, actionMode: ACTION_MODE,
      actions: actions, keys: keylog,
      wallMs: Math.round(performance.now() - epStart),
    });
    epIndex++;
  }

  // One env step: mirrors GameEnv.step, including the action-repeat loop and the
  // summed score delta over the skip.
  function stepEnv(a) {
    var act = ACTIONS[a];
    if (ACTION_MODE === 'unconstrained') {
      setKeysDown(Array.from(held));
      if (held.has(32)) simulateKeyPress(32);
    } else {
      setKeysDown(act.held);
      if (act.press !== null) simulateKeyPress(act.press);
    }
    var state, terminated = false, truncated = false;
    for (var i = 0; i < FRAME_SKIP; i++) {
      tick();
      steps += 1;
      state = window.getGameState();
      terminated = !!TERMINAL[state.gameState];
      truncated = !terminated && steps >= MAX_STEPS;
      if (terminated || truncated) break;
    }
    var reward = state.score - lastScore;
    lastScore = state.score;
    ret += reward;
    return { terminated: terminated, truncated: truncated };
  }

  // ---- loop ---------------------------------------------------------------
  // The block is time-boxed by WALL CLOCK, not frame count, because the human is
  // plotted as a point on the paper's wall-clock axis: "2.5 minutes of play" has
  // to mean 2.5 minutes. Delivered frames are logged so a participant whose
  // browser ran below 60fps can be excluded on a pre-registered threshold.
  // ---- between-rounds summary ---------------------------------------------
  // A game can score and terminate on the same frame, so the player would otherwise
  // never see what the round earned. Freeze on the final frame, show the score, then
  // start the next round.
  //
  // The freeze PAUSES the block clock. The block is a budget of actual gameplay, and
  // the paper plots the human against agent training on a wall-clock axis -- summary
  // screens are session overhead like the instructions are, not play. Both numbers are
  // reported (playMs and wallMs) so the choice is auditable.
  // Freeze length is score-conditional, and the total is budgeted. A player who dies
  // instantly and repeatedly (24 rounds in a 12s block was observed on flappy_bird)
  // would otherwise spend more of the session reading score cards than playing, and a
  // zero-score round has nothing to show anyway.
  var FREEZE_SCORED_MS = 1600;
  var FREEZE_ZERO_MS   = 600;
  var FREEZE_MIN_MS    = 250;
  var FREEZE_BUDGET_MS = 20000;   // past this, summaries shrink to a glance
  var frozen = false, freezeUntil = 0, pausedMs = 0;
  var roundEl = document.getElementById('roundend');

  function startFreeze() {
    frozen = true;
    var ms = lastScore > 0 ? FREEZE_SCORED_MS : FREEZE_ZERO_MS;
    if (pausedMs > FREEZE_BUDGET_MS) ms = FREEZE_MIN_MS;
    freezeUntil = performance.now() + ms;
    var isBest = lastScore > bestScore;
    if (isBest) bestScore = lastScore;
    document.getElementById('r-n').textContent = String(epIndex);   // already incremented
    document.getElementById('r-pts').textContent = String(lastScore);
    document.getElementById('r-newbest').className = (isBest && lastScore > 0) ? 'r-best' : 'r-best hidden';
    document.getElementById('best').textContent = String(bestScore);
    roundEl.className = '';
  }

  var FRAME_MS = 1000 / 60;
  var MAX_CATCHUP = 3;
  var running = false, blockStart = 0, prev = 0, acc = 0, delivered = 0;
  var scoreEl = document.getElementById('score');
  var timerEl = document.getElementById('timer');

  function loopFrame(now) {
    requestAnimationFrame(loopFrame);
    if (!running) return;

    var dtRaw = prev ? now - prev : FRAME_MS;
    if (frozen) {
      pausedMs += dtRaw;              // clock stopped: this is not play time
      prev = now;
      if (now >= freezeUntil) {
        frozen = false;
        roundEl.className = 'hidden';
        resetEpisode();
        acc = 0;
      }
      return;
    }

    var elapsed = now - blockStart - pausedMs;
    if (elapsed >= BLOCK_MS) { endBlock(); return; }

    // Fixed-timestep accumulator, NOT a "has 16.67ms elapsed?" throttle. The naive
    // throttle aliases against the display: on a 143Hz screen rAF fires every 7ms, the
    // first tick past 16.67ms lands at 21ms, and the block silently runs at 47.6fps --
    // a high-refresh participant would get ~20% fewer env steps than a 60Hz one, which
    // is exactly the confound the 60fps pin exists to prevent. Draining an accumulator
    // yields 60 steps/s on average for ANY display rate.
    var dt = prev ? now - prev : FRAME_MS;
    prev = now;
    acc += dt;
    if (acc > FRAME_MS * (MAX_CATCHUP + 1)) acc = FRAME_MS;  // long stall: drop, don't spiral

    var stepped = 0;
    var r = null;
    while (acc >= FRAME_MS && stepped < MAX_CATCHUP) {
      acc -= FRAME_MS;
      var a = quantize();
      if (isFolded(a)) foldedFrames++;
      actions.push(a);
      keylog.push(
        (held.has(32) ? 1 : 0) | (held.has(37) ? 2 : 0) | (held.has(38) ? 4 : 0) |
        (held.has(39) ? 8 : 0) | (held.has(40) ? 16 : 0)
      );
      r = stepEnv(a);
      delivered++;
      stepped++;
      if (r.terminated || r.truncated) break;
    }
    if (!stepped) return;   // display faster than 60Hz: nothing to draw this tick

    var p = getPixelData();
    vctx.putImageData(new ImageData(new Uint8ClampedArray(p.data), p.width, p.height), 0, 0);
    scoreEl.textContent = String(lastScore);
    var left = Math.max(0, BLOCK_MS - elapsed) / 1000;
    timerEl.textContent = Math.floor(left / 60) + ':' + ('0' + Math.floor(left % 60)).slice(-2);
    timerEl.className = left <= 15 ? 'low' : '';

    if (r && (r.terminated || r.truncated)) {
      finishEpisode(r.terminated, r.truncated, false);
      startFreeze();
    }
  }

  function endBlock() {
    running = false;
    // The episode in progress when the timer fires is recorded but flagged
    // discarded: it was cut off by the clock, not played to a conclusion, so
    // scoring it would bias the block mean downward. If the clock fires during a
    // freeze there is no episode in progress and nothing to discard.
    if (!frozen && steps > 0) finishEpisode(false, false, true);
    var wall = performance.now() - blockStart;
    var play = wall - pausedMs;
    var payload = {
      type: 'block-done', game: GAME, practice: PRACTICE, obsRes: !!OBS_RES,
      episodes: episodes,
      bestScore: bestScore,
      canvasPx: canvasPx,          // on-screen size; should equal canvasSize for everyone
      deliveredFrames: delivered,
      playMs: Math.round(play),          // gameplay only -- what the block budgets
      pausedMs: Math.round(pausedMs),    // between-round summaries
      wallMs: Math.round(wall),
      fps: Math.round(delivered / (play / 1000) * 10) / 10,
    };
    parent.postMessage(payload, '*');

    // Opened directly rather than inside the session shell (i.e. someone playtesting a
    // single game). There is no parent to collect the block, so post it as a one-block
    // session on its own -- otherwise the play is silently thrown away.
    if (parent === window && UPLOAD_URL) {
      fetch(UPLOAD_URL, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          participantId: 'playtest-' + GAME, standalone: true, partial: false,
          startedAt: new Date().toISOString(),
          userAgent: navigator.userAgent, blocks: [payload],
        }),
      }).then(function (r) { showEnd(r.ok ? 'Saved.' : 'Save failed (HTTP ' + r.status + ').'); })
        .catch(function () { showEnd('Save failed — is the capture server running?'); });
    } else if (parent === window) {
      showEnd('Block finished. No capture server configured, so nothing was saved.');
    }
  }

  function showEnd(msg) {
    var v = document.getElementById('veil');
    v.className = '';
    v.innerHTML = '<h2>' + GAME + ' — done</h2>' +
      '<p>' + episodes.filter(function (e) { return !e.discarded; }).length +
      ' rounds, best ' + bestScore + '.</p><p>' + msg + '</p>';
  }

  document.getElementById('go').onclick = function () {
    document.getElementById('veil').className = 'hidden';
    window.focus();
    resetEpisode();
    blockStart = performance.now();
    prev = 0; acc = 0; pausedMs = 0; frozen = false; running = true;
  };

  requestAnimationFrame(loopFrame);
  parent.postMessage({ type: 'block-ready', game: GAME }, '*');
})();
</script>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Session shell: consent, participant id, randomised block order, iframe driver,
// upload. Holds no game code of its own.
// ---------------------------------------------------------------------------
export function sessionPage(blocks, cfg) {
  const {
    uploadUrl = '', blockSeconds = 150, completionUrl = '',
    maxSteps = 2000, study = {}, nScoredBlocks = blocks.filter(b => !b.practice).length,
  } = cfg || {};

  const s = {
    estimatedMinutes: study.estimatedMinutes ?? 25,
    compensationRate: study.compensationRate ?? '$12.00 per hour',
    contactName: study.contactName ?? 'Ryan Truong',
    contactEmail: study.contactEmail ?? 'truongtruong@g.harvard.edu',
    piName: study.piName ?? 'Samuel Gershman',
    piEmail: study.piEmail ?? 'gershman@fas.harvard.edu',
  };
  const pages = instructionPages({ blockSeconds, maxSteps, nScoredBlocks });
  const quiz = quizQuestions({ blockSeconds, maxSteps });

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Video game study</title>
<meta name="robots" content="noindex, nofollow, noarchive, nosnippet">
<style>${studyBase}
  body { min-height: 100vh; display: flex; flex-direction: column;
         align-items: center; justify-content: center; padding: 40px 24px; }
  main { width: 100%; max-width: 640px; }
  h1 { font-size: 24px; font-weight: 600; margin: 0 0 20px; color: #111; }
  p, li { color: #444; font-size: 16px; line-height: 1.7; }
  b { color: #111; font-weight: 600; }
  i { color: #333; font-style: italic; }
  ul { padding-left: 20px; }
  kbd { color: #111; font-weight: 600; font-style: normal; }
  input[type=text] { background: #fff; border: 1px solid #bbb; color: #111;
        padding: 10px 12px; font: inherit; font-size: 15px; border-radius: 4px; width: 280px; }
  #frame { border: 0; width: 100vw; height: 100vh; display: block; }
  #progress { position: fixed; top: 0; left: 0; height: 2px; background: #111;
              opacity: .35; transition: width .3s; z-index: 10; }
  .hidden { display: none !important; }
  code { font-family: ui-monospace, Menlo, monospace; color: #111; font-size: 17px; }

  /* consent */
  #consent-scroll { height: 440px; overflow-y: auto; border: 1px solid #ddd;
                    background: #fafafa; padding: 22px 24px; margin: 18px 0 16px; }
  #consent-scroll p { margin: 0 0 12px; font-size: 14.5px; color: #444; }
  #consent-scroll .h { color: #111; font-weight: 600; margin-top: 20px; }
  #consent-scroll .h2 { color: #111; font-weight: 600; font-size: 17px; margin-top: 28px; }
  label.check { display: flex; gap: 10px; align-items: flex-start; color: #333;
                font-size: 15px; line-height: 1.6; cursor: pointer; margin-bottom: 10px; }
  label.check input { margin-top: 4px; flex: none; }
  .note { color: #777; font-size: 14px; }
  .err { color: #b00020; font-size: 14px; }

  /* instructions */
  .steps { color: #888; font-size: 14px; margin-bottom: 8px; }
  .nav { display: flex; gap: 12px; align-items: center; margin-top: 28px; }
  .nav .spacer { flex: 1; }

  /* quiz */
  .q { margin-bottom: 26px; }
  .q > p { color: #111; font-size: 16px; margin: 0 0 10px; font-weight: 500; }
  .opt { display: flex; gap: 10px; align-items: center; padding: 10px 12px;
         border: 1px solid #ddd; border-radius: 4px; margin-bottom: 6px;
         cursor: pointer; color: #444; font-size: 15px; }
  .opt:hover { border-color: #888; color: #111; background: #fafafa; }
  .opt input { flex: none; }
</style></head><body>

<div id="progress" style="width:0"></div>

<!-- 0. device check ------------------------------------------------------- -->
<main id="s-device">
  <h1>Checking your device…</h1>
  <p class="note" id="device-note">One moment.</p>
</main>

<main id="s-blocked" class="hidden">
  <h1>This device will not work</h1>
  <p id="blocked-why"></p>
  <p>Please return the study on the recruitment platform so someone else can take it.
     You will not be penalised for returning it.</p>
</main>

<!-- 1. consent ------------------------------------------------------------ -->
<main id="s-consent" class="hidden">
  <h1>Research Study Consent Form</h1>
  <div id="consent-scroll">${consentHtml(s)}</div>
  <p class="note" id="scroll-note">Please scroll to the bottom of the consent form to continue.</p>
  <div id="consent-boxes" class="hidden">
    <label class="check"><input type="checkbox" id="agree">
      I have read the above, I am 18 or older, and I agree to participate.</label>
    <label class="check"><input type="checkbox" id="norecontact">
      Do not contact me about future studies. (optional)</label>
  </div>
  <div class="nav">
    <button id="consent-next" disabled>Continue</button>
    <span class="err" id="consent-err"></span>
  </div>
</main>

<!-- 2. instructions ------------------------------------------------------- -->
<main id="s-instr" class="hidden">
  <p class="steps" id="instr-steps"></p>
  <h1 id="instr-title"></h1>
  <div id="instr-body"></div>
  <div class="nav">
    <button id="instr-back">Back</button>
    <span class="spacer"></span>
    <button id="instr-next">Next</button>
  </div>
</main>

<!-- 3. comprehension check ------------------------------------------------ -->
<main id="s-quiz" class="hidden">
  <h1>Comprehension check</h1>
  <p>Please answer these to confirm you understood the instructions. If any answer is wrong you
     will be taken back through the instructions.</p>
  <div id="quiz-body" style="margin-top:22px"></div>
  <div class="nav">
    <button id="quiz-submit">Submit</button>
    <span class="err" id="quiz-err"></span>
  </div>
</main>

<!-- 4. participant id ----------------------------------------------------- -->
<main id="s-pid" class="hidden">
  <h1>Almost ready</h1>
  <p>Enter the participant ID from the recruitment page.</p>
  <p><input type="text" id="pid" placeholder="participant ID" autocomplete="off" spellcheck="false"></p>
  <div class="nav">
    <button id="pid-next">Start the games</button>
    <span class="err" id="pid-err"></span>
  </div>
</main>

<!-- 5. outro -------------------------------------------------------------- -->
<main id="s-outro" class="hidden">
  <h1>Done — thank you</h1>
  <p id="outro-msg">Uploading your session…</p>
  <p id="outro-code" class="hidden">Completion code: <code id="code"></code></p>
  <p id="outro-dl" class="hidden">
    Upload failed. Please <button id="dl">download your results</button> and send the file back
    as instructed on the recruitment page.</p>
</main>

<iframe id="frame" class="hidden" allow="autoplay"></iframe>

<script type="module">
const BLOCKS = ${JSON.stringify(blocks)};
const UPLOAD_URL = ${JSON.stringify(uploadUrl)};
// Prolific's completion URL. Only followed after a SUCCESSFUL upload -- redirecting on a
// failed upload would mark the participant complete while their data is gone.
const COMPLETION_URL = ${JSON.stringify(completionUrl)};
const PAGES = ${JSON.stringify(pages)};
const QUIZ = ${JSON.stringify(quiz)};

const $ = id => document.getElementById(id);
const SCREENS = ['s-device', 's-blocked', 's-consent', 's-instr', 's-quiz', 's-pid', 's-outro'];
function show(id) {
  for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id);
  $('frame').classList.add('hidden');
  scrollTo(0, 0);
}

const session = {
  participantId: null, startedAt: null,
  userAgent: navigator.userAgent,
  screen: { w: screen.width, h: screen.height, dpr: devicePixelRatio },
  preflight: null, consent: null, quiz: null, order: null, blocks: [],
};

// ---------------------------------------------------------------------------
// 0. Pre-flight. Runs BEFORE the consent form: rejecting someone after they have
// read a 2000-word consent form is a bad experience and a wasted Prolific slot.
// Two of the credibility requirements are device properties:
//   * desktop with a physical keyboard
//   * a display that can actually sustain 60fps
// The block loop drains a fixed-timestep accumulator, so a 120/144Hz display gives
// exactly 60 steps/s and is fine. The failure case is the other direction -- a machine
// that cannot deliver 60 yields fewer env steps in the same 150 seconds. That cannot be
// forced (simulating catch-up frames the human cannot react to would make difficulty
// hardware-dependent), so it is measured and gated.
// ---------------------------------------------------------------------------
const MIN_FPS = 55;

function probeFps(ms = 1500) {
  return new Promise(res => {
    let n = 0; const t0 = performance.now();
    (function spin(now) {
      if (now - t0 >= ms) return res(n / ((now - t0) / 1000));
      n++; requestAnimationFrame(spin);
    })(t0);
  });
}

function block(reason, msg) {
  session.preflight = { ok: false, reason };
  $('blocked-why').textContent = msg;
  show('s-blocked');
}

async function preflight() {
  const touchOnly = matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
  if (touchOnly) return block('touch-only',
    'These games need a physical keyboard. Phones and tablets cannot be used.');
  if (Math.min(screen.width, screen.height) < 600) return block('screen-too-small',
    'This screen is too small to play the games. Please use a desktop or laptop.');

  const fps = Math.round(await probeFps());
  session.preflight = { ok: fps >= MIN_FPS, fps, dpr: devicePixelRatio,
                        innerW: innerWidth, innerH: innerHeight };
  if (fps < MIN_FPS) return block('low-fps',
    'Your browser is running at about ' + fps + ' frames per second; these games need 60. ' +
    'Closing other tabs and applications sometimes fixes this — reload to try again.');

  // The game is drawn at a fixed size so every participant sees it identically. A short
  // window shrinks it, so prompt for more room -- but ONLY when the window is smaller
  // than the screen could actually give, otherwise a 1366x768 laptop that is already
  // maximised would be asked to do something impossible and loop forever. There is also
  // a manual escape after a few seconds, so nobody can get stuck. The rendered size is
  // logged per block either way, so any shortfall is measurable rather than silent.
  if (innerHeight < wantInnerH()) return askResize();

  show('s-consent');
}

function wantInnerH() {
  return Math.min(700, screen.height - 120);   // rough browser-chrome allowance
}

function askResize() {
  $('device-note').innerHTML =
    'Please <b>maximise your browser window</b> so the games display at full size. ' +
    'This page will continue on its own.<br><br>' +
    '<button id="anyway" style="display:none">Continue anyway</button>';
  show('s-device');
  const go = () => {
    session.preflight.innerH = innerHeight;
    session.preflight.resized = true;
    show('s-consent');
  };
  const t = setInterval(() => {
    if (innerHeight >= wantInnerH()) { clearInterval(t); go(); }
  }, 400);
  setTimeout(() => {
    const b = $('anyway');
    if (!b) return;
    b.style.display = 'inline-block';
    b.onclick = () => { clearInterval(t); session.preflight.smallWindow = true; go(); };
  }, 6000);
}

// ---------------------------------------------------------------------------
// 1. Consent -- gated on actually scrolling to the bottom, as the lab's other studies do.
// ---------------------------------------------------------------------------
const scroller = $('consent-scroll');
scroller.addEventListener('scroll', () => {
  if (scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 12) {
    $('scroll-note').classList.add('hidden');
    $('consent-boxes').classList.remove('hidden');
  }
});
$('agree').addEventListener('change', e => { $('consent-next').disabled = !e.target.checked; });
$('consent-next').onclick = () => {
  if (!$('agree').checked) return;
  session.consent = {
    agreed: true, at: new Date().toISOString(), doNotRecontact: $('norecontact').checked,
  };
  renderInstr(0);
  show('s-instr');
};

// ---------------------------------------------------------------------------
// 2. Instructions
// ---------------------------------------------------------------------------
let page = 0;
function renderInstr(i) {
  page = i;
  $('instr-steps').textContent = 'Instructions — ' + (i + 1) + ' of ' + PAGES.length;
  $('instr-title').textContent = PAGES[i].title;
  $('instr-body').innerHTML = PAGES[i].html;
  $('instr-back').disabled = i === 0;
  $('instr-next').textContent = i === PAGES.length - 1 ? 'Continue to comprehension check' : 'Next';
}
$('instr-back').onclick = () => renderInstr(Math.max(0, page - 1));
$('instr-next').onclick = () => {
  if (page < PAGES.length - 1) return renderInstr(page + 1);
  renderQuiz();
  show('s-quiz');
};

// ---------------------------------------------------------------------------
// 3. Comprehension check. A wrong answer sends them back through the instructions
// rather than letting them guess again -- the point is that they read it.
// ---------------------------------------------------------------------------
let answers = [], attempts = 0;
function renderQuiz() {
  answers = QUIZ.map(() => -1);
  $('quiz-err').textContent = '';
  $('quiz-body').innerHTML = QUIZ.map((q, qi) => \`
    <div class="q"><p>\${qi + 1}. \${q.q}</p>\${q.options.map((o, oi) => \`
      <label class="opt"><input type="radio" name="q\${qi}" value="\${oi}"><span>\${o}</span></label>\`
    ).join('')}</div>\`).join('');
  $('quiz-body').querySelectorAll('input[type=radio]').forEach(r => {
    r.addEventListener('change', e => {
      answers[+e.target.name.slice(1)] = +e.target.value;
      $('quiz-err').textContent = '';
    });
  });
}
$('quiz-submit').onclick = () => {
  if (answers.some(a => a === -1)) { $('quiz-err').textContent = 'Please answer every question.'; return; }
  attempts++;
  const wrong = QUIZ.filter((q, i) => answers[i] !== q.answer).length;
  if (wrong) {
    $('quiz-err').textContent = wrong + ' answer' + (wrong > 1 ? 's are' : ' is') +
      ' incorrect. Taking you back through the instructions.';
    setTimeout(() => { renderInstr(0); show('s-instr'); }, 1600);
    return;
  }
  session.quiz = { attempts, passed: true };
  if (session.participantId) return begin();
  show('s-pid');
};

// ---------------------------------------------------------------------------
// 4. Participant id. Recruitment platforms pass it in the URL (Prolific sends
// PROLIFIC_PID); when present we skip this screen entirely -- a typo here is an
// unmatchable session and an unpayable participant.
// ---------------------------------------------------------------------------
const qp = new URLSearchParams(location.search);
const urlPid = qp.get('PROLIFIC_PID') || qp.get('pid') || qp.get('participant');
if (urlPid) session.participantId = urlPid;
session.source = { study: qp.get('STUDY_ID') || null, session: qp.get('SESSION_ID') || null, fromUrl: !!urlPid };

$('pid-next').onclick = () => {
  const pid = $('pid').value.trim();
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(pid)) {
    $('pid-err').textContent = 'Please enter the ID exactly as shown.'; return;
  }
  session.participantId = pid;
  begin();
};

// ---------------------------------------------------------------------------
// 5. Blocks
// ---------------------------------------------------------------------------
function shuffled(a, rnd) {
  const x = a.slice();
  for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; }
  return x;
}
function hash32(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let n = Math.imul(t ^ (t >>> 15), t | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

let queue = [], qi = 0;

function begin() {
  session.startedAt = new Date().toISOString();
  // Practice first (fixed), then the scored blocks shuffled per participant so any
  // learning or fatigue effect is spread across games rather than loading onto whichever
  // game happens to go last. Seeded by participant id, so the order is reproducible from
  // the logged id alone.
  const practice = BLOCKS.filter(b => b.practice);
  const scored = BLOCKS.filter(b => !b.practice);
  queue = practice.concat(shuffled(scored, mulberry32(hash32(session.participantId))));
  session.order = queue.map(b => b.game + (b.obsRes ? '@64' : '') + (b.practice ? '(practice)' : ''));
  runNext();
}

function runNext() {
  if (qi >= queue.length) return finish();
  $('progress').style.width = (qi / queue.length * 100) + '%';
  for (const s of SCREENS) $(s).classList.add('hidden');
  $('frame').classList.remove('hidden');
  $('frame').src = queue[qi].href;
}

addEventListener('message', (e) => {
  const m = e.data;
  if (!m || m.type !== 'block-done') return;
  if (!queue[qi] || !queue[qi].practice) session.blocks.push(m);
  qi++;
  // Checkpoint after every block. Without this a participant who closes the tab at
  // block 7 of 9 contributes nothing at all -- and you may still owe them payment.
  // The server keys on participantId + startedAt and overwrites, so this is just the
  // same record getting progressively more complete. Fire-and-forget: a failed
  // checkpoint must never interrupt play, and the final upload is still authoritative.
  checkpoint();
  runNext();
});

function checkpoint() {
  if (!UPLOAD_URL || !session.blocks.length) return;
  try {
    const body = JSON.stringify({ ...session, partial: true });
    // keepalive lets the request survive the page being closed mid-flight.
    fetch(UPLOAD_URL, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body, keepalive: body.length < 60000,
    }).catch(() => {});
  } catch { /* never let a checkpoint break the session */ }
}

async function finish() {
  show('s-outro');
  $('progress').style.width = '100%';
  session.finishedAt = new Date().toISOString();
  const code = 'PT-' + hash32(session.participantId + session.startedAt).toString(36).toUpperCase();
  session.completionCode = code;

  if (UPLOAD_URL) {
    try {
      const res = await fetch(UPLOAD_URL, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...session, partial: false }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      $('outro-msg').textContent = 'Your session was recorded.';
      $('code').textContent = code;
      $('outro-code').classList.remove('hidden');
      if (COMPLETION_URL) {
        $('outro-msg').textContent = 'Your session was recorded. Returning you to Prolific…';
        setTimeout(() => { location.href = COMPLETION_URL; }, 2500);
      }
      return;
    } catch (err) {
      // fall through to the manual path -- never lose a paid session to a bad network
    }
  }
  $('outro-msg').textContent = '';
  $('outro-dl').classList.remove('hidden');
  $('code').textContent = code;
  $('outro-code').classList.remove('hidden');
  $('dl').onclick = () => {
    const blob = new Blob([JSON.stringify(session)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'playtrain-session-' + session.participantId + '.json';
    a.click();
  };
}

preflight();
</script>
</body></html>`;
}
