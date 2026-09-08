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
//   * the default8 ACTIONS table, inlined from the shared spec (runtime/action_spaces.json)
//   * frameSkip action-repeat and maxSteps truncation     (GameEnv.step)
//   * TERMINAL_STATES handling with auto-advance to the next seed
//   * frame-indexed action logging, so a session can be REPLAYED through the headless
//     env at the same seed and the score checked to match (study/verify-replay.mjs)
//
// Each block runs in its own iframe so every game gets a fresh global scope, the same
// isolation the headless runtime gets from one-game-per-process (game-env.mjs `gameLoaded`).

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

import { browserShimBundle } from '../tools/play-templates.mjs';
import {
  consentHtml, instructionPages, quizQuestions, durationPhrase,
  demographicQuestions, feedbackQuestions,
} from './study-screens.mjs';

// The harness plays with the SAME action table the runtime steps with — read
// from the shared spec at build time and inlined, so the two cannot drift (if
// they did, foldedRate would silently measure the wrong thing). NOTE: the
// key-folding heuristic below (keysToAction/isFolded) is written against
// default8's semantics; running the study on another space means rederiving it.
const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ACTIONS = JSON.parse(readFileSync(
  join(__dirname, '..', 'runtime', 'action_spaces.json'), 'utf8')).default8;
const actionsLiteral = JSON.stringify(DEFAULT_ACTIONS, null, 2)
  .split('\n').map((l, i) => (i === 0 ? l : '  ' + l)).join('\n');

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
  /* The HUD is taken OUT OF FLOW and hung above the stage, so the thing centred in the
     viewport is the canvas itself. In flow it was a ~35px block above the canvas, which
     pushed the game half that far below centre -- small, but it is the one element on
     screen the participant stares at for 15 minutes. fitCanvas caps the canvas at
     innerHeight-96, so there is always >=48px of clearance for the HUD to hang in. */
  #hud { position: absolute; left: 0; right: 0; bottom: 100%; margin-bottom: 10px;
         display: flex; justify-content: center; gap: 32px; line-height: 1.4;
         font-size: 15px; color: #777; font-variant-numeric: tabular-nums; }
  #hud b { color: #111; font-weight: 600; }
  /* Pips, not a number: lives are read peripherally while the eyes stay on the game, and a
     dot that goes hollow shows what was lost as well as what is left. */
  #hud .pips { letter-spacing: 2px; font-size: 13px; }
  #hud .pips .gone { color: #ccc; }
  #rtimer { color: #777; font-variant-numeric: tabular-nums; }
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
     player never sees what they earned.
     DARK, translucent, and cross-faded -- not the opaque white card this used to be.
     Every game in the study draws a near-black background (background(0)..background(30)),
     so a full-canvas white card made each round boundary a black->white->black flash. With
     the freeze budget shrinking cards to 250ms once a player has accumulated 20s of them,
     and 22 rounds in 12s measured on flappy_bird, that is a strobe: unpleasant, and it
     destroys dark adaptation immediately before the next round starts, which plausibly
     costs performance on exactly the fast games where it happens most often.
     The earlier objection to a scrim was unpredictable text contrast. That is handled by
     putting the text on its own panel instead of straight onto the frame: the scrim only
     ever darkens, the panel's colours are fixed, so contrast is known regardless of what
     the game had drawn. Keeping the final frame faintly visible is a bonus -- the player
     can see the state they died in. */
  #stage { position: relative; display: inline-block; line-height: 0; }
  /* inset 1px, not 0: at inset 0 the overlay covers the canvas's own hairline border too, so
     the play area loses its edge for the length of the freeze. */
  /* Only the DIMMING fades; the score panel appears at full strength immediately.
     Cross-fading the whole overlay meant its midpoint was, by definition, half-strength
     text over an undimmed frame -- a grey number floating on live-looking gameplay, which
     is the ghost this used to show. The flash risk was never the panel (it is dark, and
     ~12% of the canvas area); it is the large-area luminance ramp, which is exactly what
     still fades. Fade duration comes from JS as --fade, scaled to the card's lifetime. */
  #roundend { position: absolute; inset: 1px;
              display: flex; align-items: center; justify-content: center;
              text-align: center; line-height: 1.4;
              visibility: hidden; transition: visibility var(--fade, 90ms); }
  #roundend.show { visibility: visible; }
  #roundend::before { content: ''; position: absolute; inset: 0; background: rgba(6, 8, 11, .88);
                      opacity: 0; transition: opacity var(--fade, 90ms) ease; }
  #roundend.show::before { opacity: 1; }
  @media (prefers-reduced-motion: reduce) {
    #roundend, #roundend::before { transition-duration: 1ms !important; }
  }
  #roundend .r-card { position: relative;   /* above the scrim pseudo-element */
                      background: #14181d; border: 1px solid rgba(255, 255, 255, .18);
                      border-radius: 8px; padding: 22px 44px 20px;
                      display: flex; flex-direction: column; align-items: center; gap: 6px;
                      box-shadow: 0 8px 30px rgba(0, 0, 0, .45); }
  #roundend .r-title { color: rgba(255, 255, 255, .72); font-size: 15px; }
  #roundend .r-score { color: #fff; font-size: 60px; font-weight: 300; line-height: 1.05;
                       font-variant-numeric: tabular-nums; }
  #roundend .r-best { color: #fff; font-size: 13px; font-weight: 600;
                      letter-spacing: .04em; text-transform: uppercase; }
  #roundend .r-best.hidden { display: none; }
  #roundend .r-next { color: rgba(255, 255, 255, .4); font-size: 12.5px; margin-top: 12px; }
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
    // Games whose lives the HARNESS must show, because the game itself never draws them.
    // Only seaquest and caveflyer qualify; see study-config.json for why the other seven
    // are excluded. Kept as an explicit list rather than "show lives whenever
    // getGameState().lives exists" -- every game exposes the field, but pong's `lives` is
    // the ALE points-to-21 counter and plunder/flappy_bird are single-life, so a blanket
    // readout would be wrong in one case and noise in two others.
    hudLives = [],
    // false | true | 'practice'. Off by default; see the note in the HUD markup below.
    showRoundTimer = false,
    // NOT `practice`: study-config.json has a `practice` OBJECT (game/seconds/controls),
    // and blockPage is called with {...cfg}, so a flag by that name silently became
    // truthy for every scored block -- marking the whole study as practice data.
    isPractice = false,
  } = cfg || {};
  const practice = isPractice;
  const showLives = (hudLives || []).indexOf(name) >= 0;
  // The round timer is deliberately NOT on by default. maxSteps truncation is a harness
  // artifact, not a rule of the game, and nothing in the agent's 64x64 observation encodes
  // how many steps are left -- so a visible countdown would let the human spend the last
  // second of every round on risk the policy cannot know to take, inflating exactly the
  // score being compared. The instructions already state that rounds end after ~33s, which
  // prevents confusion without making the artifact exploitable. 'practice' shows it only in
  // the unscored warm-up, where teaching the round structure is the point.
  const showRoundClock = showRoundTimer === true || (showRoundTimer === 'practice' && practice);

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${name}</title>
<meta name="robots" content="noindex, nofollow, noarchive, nosnippet">
<style>${studyStyle}</style></head><body>

<div id="stage">
  <div id="hud">
    <span>round <b id="ep">1</b></span>
    <span>score <b id="score">0</b></span>
    <span>best <b id="best">0</b></span>
    ${showLives ? '<span>lives <b id="lives" class="pips"></b></span>' : ''}
    ${showRoundClock ? '<span id="rtimer">round --s</span>' : ''}
    <span id="timer">--:--</span>
  </div>
  <canvas id="view"></canvas>
  <div id="roundend">
    <div class="r-card">
      <div class="r-title">Round <span id="r-n"></span> complete</div>
      <div class="r-score"><span id="r-pts"></span></div>
      <div class="r-best hidden" id="r-newbest">new best</div>
      <div class="r-next">next round starting…</div>
    </div>
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

  // ---- shared with runtime/p5/game-env.mjs --------------------------------
  // default8, inlined at build time from runtime/action_spaces.json — the same
  // spec the headless runtimes step with, so harness and env cannot drift.
  var ACTIONS = ${actionsLiteral};
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
  var SHOW_LIVES  = ${showLives ? 'true' : 'false'};
  var SHOW_RCLOCK = ${showRoundClock ? 'true' : 'false'};

  // ---- debug ---------------------------------------------------------------
  // The session shell's debug menu appends "#dbg=<seconds>" (0 = leave the length
  // alone) when it launches a block, which is the ONLY way a shortened or skippable
  // block can happen: a participant never gets the hash, so they cannot cut a block
  // short. "auto" clicks Start for you when walking the whole session.
  var HASH     = new URLSearchParams(location.hash.slice(1));
  var DEBUG    = HASH.has('dbg');
  var DBG_SEC  = parseFloat(HASH.get('dbg'));
  var AUTOSTART = DEBUG && HASH.has('auto');
  if (DEBUG && DBG_SEC > 0) BLOCK_MS = DBG_SEC * 1000;

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

  // Debug combos. Keyboard focus is inside this iframe while a block runs, so the shell
  // cannot see either of these -- D is forwarded up to it, S ends the block here.
  // e.code, not e.key: on macOS Alt+D produces a dead-key character, not "D".
  addEventListener('keydown', function (e) {
    if (!(e.ctrlKey && e.shiftKey && e.altKey)) return;
    if (e.code === 'KeyD' && parent !== window) {
      e.preventDefault();
      parent.postMessage({ type: 'debug-toggle' }, '*');
    } else if (e.code === 'KeyS' && DEBUG && running) {
      e.preventDefault();
      endBlock();
    }
  });

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
    var st0 = window.getGameState();
    lastScore = st0.score;
    epStart = performance.now();
    document.getElementById('ep').textContent = String(epIndex + 1);
    // Full complement is read from the game at reset rather than hard-coded, so the pips
    // follow the game if its life count ever changes.
    if (SHOW_LIVES) { livesMax = +st0.lives || 0; drawLives(livesMax); }
    if (SHOW_RCLOCK) drawRoundClock();
  }

  // ---- lives / round clock ------------------------------------------------
  var livesMax = 0, livesShown = -1;
  var livesEl = document.getElementById('lives');
  var rclockEl = document.getElementById('rtimer');
  var PIP_LIMIT = 8;                    // beyond this a row of dots stops being countable

  function drawLives(n) {
    if (!livesEl || n === livesShown) return;   // only touch the DOM when it changes
    livesShown = n;
    if (livesMax > PIP_LIMIT) { livesEl.textContent = String(n); return; }
    var s = '';
    for (var i = 0; i < livesMax; i++) {
      s += i < n ? '<span>&#9679;</span>' : '<span class="gone">&#9675;</span>';
    }
    livesEl.innerHTML = s;
  }

  function drawRoundClock() {
    if (!rclockEl) return;
    var left = Math.max(0, (MAX_STEPS - steps) / 60);
    rclockEl.textContent = 'round ' + Math.ceil(left) + 's';
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
  // Cross-fade, scaled to the card's own lifetime and finishing INSIDE the freeze window.
  // Two bugs the first version had, both of which showed up as a translucent card over
  // full-brightness gameplay:
  //   * a fixed 140ms fade is most of a 250ms card, so budget-shrunk cards never reached
  //     full opacity at all -- permanently ghosted on exactly the fast games that produce
  //     the most of them;
  //   * fading out on unfreeze ran the fade over the resumed, undimmed next round.
  // So: ramp the dimming over min(FADE_MAX, ms/6), hold, and start the ramp back down one
  // fade before the freeze ends so the overlay is gone by the time play resumes. The score
  // panel itself does not fade at all -- see the #roundend::before note in the stylesheet.
  var FADE_MAX_MS = 90;
  var frozen = false, freezeUntil = 0, fadeOutAt = 0, fadingOut = false, pausedMs = 0;
  var roundEl = document.getElementById('roundend');

  function startFreeze() {
    frozen = true;
    var ms = lastScore > 0 ? FREEZE_SCORED_MS : FREEZE_ZERO_MS;
    if (pausedMs > FREEZE_BUDGET_MS) ms = FREEZE_MIN_MS;
    var fade = Math.min(FADE_MAX_MS, ms / 6);
    roundEl.style.setProperty('--fade', fade + 'ms');
    freezeUntil = performance.now() + ms;
    fadeOutAt = freezeUntil - fade;
    fadingOut = false;
    var isBest = lastScore > bestScore;
    if (isBest) bestScore = lastScore;
    document.getElementById('r-n').textContent = String(epIndex);   // already incremented
    document.getElementById('r-pts').textContent = String(lastScore);
    document.getElementById('r-newbest').className = (isBest && lastScore > 0) ? 'r-best' : 'r-best hidden';
    document.getElementById('best').textContent = String(bestScore);
    roundEl.className = 'show';
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
      // Fade out while still frozen, so the next round never starts under a ghost card.
      if (!fadingOut && now >= fadeOutAt) { fadingOut = true; roundEl.className = ''; }
      if (now >= freezeUntil) {
        frozen = false;
        roundEl.className = '';
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
    // Lives come from the SAME getGameState() the environment steps on, so the readout
    // cannot drift from the state the agent is scored against.
    if (SHOW_LIVES) drawLives(Math.max(0, +window.getGameState().lives || 0));
    if (SHOW_RCLOCK) drawRoundClock();
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
      // What the participant could see that the agent's observation does not contain.
      // Recorded per block so the information asymmetry is auditable rather than implicit
      // in whichever config the site happened to be built from.
      livesShown: SHOW_LIVES,
      roundTimerShown: SHOW_RCLOCK,
      canvasPx: canvasPx,          // on-screen size; should equal canvasSize for everyone
      deliveredFrames: delivered,
      playMs: Math.round(play),          // gameplay only -- what the block budgets
      pausedMs: Math.round(pausedMs),    // between-round summaries
      wallMs: Math.round(wall),
      fps: Math.round(delivered / (play / 1000) * 10) / 10,
    };
    parent.postMessage(payload, '*');
    if (DEBUG) console.log('[debug] block done', payload);

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

  if (DEBUG) {
    var badge = document.createElement('span');
    badge.textContent = 'debug ' + Math.round(BLOCK_MS / 1000) + 's · ^⇧⌥S skips';
    badge.style.color = '#b00020';
    document.getElementById('hud').appendChild(badge);
    if (AUTOSTART) setTimeout(function () { document.getElementById('go').click(); }, 120);
  }

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
    uploadUrl = '', blockSeconds = 150, completionUrl = '', completionCode = '',
    maxSteps = 2000, study = {}, canvasSize = 600,
    nScoredBlocks = blocks.filter(b => !b.practice).length,
  } = cfg || {};

  // Institution-specific consent fields. No defaults on purpose: a blank renders as a
  // visible placeholder in the consent form rather than as somebody else's contact
  // details, and build-study.mjs refuses to build with --upload while any is empty.
  const s = {
    estimatedMinutes: study.estimatedMinutes ?? 25,
    compensationRate: study.compensationRate || '[compensation rate]',
    contactName: study.contactName || '[contact name]',
    contactEmail: study.contactEmail || '[contact email]',
    piName: study.piName || '[principal investigator]',
    piEmail: study.piEmail || '[principal investigator email]',
    irbName: study.irbName || '[review board name]',
    irbPhone: study.irbPhone || '[review board phone]',
    irbEmail: study.irbEmail || '[review board email]',
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
        padding: 10px 12px; font: inherit; font-size: 15px; border-radius: 4px; width: 340px;
        font-family: ui-monospace, Menlo, monospace; }
  input[type=text]:focus { outline: 2px solid #111; outline-offset: 1px; }
  /* position:fixed, NOT a 100vw/100vh in-flow block: body carries 40px 24px of padding for
     the text screens, which offset a 100vh iframe downward by 40px, pushed the document to
     870px tall on a 790px viewport (so the page scrolled and the last 40px of the game hung
     off the bottom), and left the game 54px below centre once the HUD's own offset was added.
     Taking the frame out of flow makes it exactly the viewport, whatever the body does. */
  #frame { position: fixed; inset: 0; border: 0; width: 100%; height: 100%; display: block; }
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
  .q-bad { border-left: 3px solid #b00020; padding-left: 13px; margin-left: -16px; }
  .q-hint { color: #b00020; font-size: 14px; margin: 8px 0 0; }
  button.linkish { background: none; border: 0; color: #b00020; text-decoration: underline;
                   padding: 0; font: inherit; font-size: 14px; cursor: pointer; }
  button.linkish:hover { color: #111; }

  /* end-of-study questions */
  button.ghost { background: #fff; color: #444; border: 1px solid #bbb; }
  button.ghost:hover { background: #f4f4f4; color: #111; }
  .fq { margin-bottom: 24px; }
  .fq > label.qlabel { display: block; color: #111; font-size: 16px; font-weight: 500;
                       margin-bottom: 4px; }
  .fq .hint { color: #777; font-size: 14px; margin: 0 0 8px; }
  .fq textarea { width: 100%; min-height: 76px; resize: vertical; background: #fff;
                 border: 1px solid #bbb; border-radius: 4px; padding: 10px 12px;
                 font: inherit; font-size: 15px; color: #111; }
  .fq textarea:focus, .fq input[type=number]:focus { outline: 2px solid #111; outline-offset: 1px; }
  .fq input[type=number] { width: 110px; font-family: inherit; }
  .fq .opts { display: flex; flex-wrap: wrap; gap: 6px; }
  .fq .opts .opt { margin: 0; }
  .fq input[type=text].selfdesc { width: 260px; margin-top: 6px; font-family: inherit; }

  /* debug menu -- hidden unless the key combo is pressed; see the DBG block below */
  #dbg { position: fixed; left: 0; right: 0; bottom: 0; z-index: 100;
         background: #101010; color: #e8e8e8; padding: 10px 14px 14px;
         font-family: ui-monospace, Menlo, monospace; font-size: 12px; line-height: 1.5;
         max-height: 62vh; overflow-y: auto; box-shadow: 0 -8px 24px rgba(0,0,0,.35); }
  #dbg .row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-top: 6px; }
  #dbg .lbl { color: #777; width: 88px; flex: none; }
  #dbg button { background: #262626; color: #e8e8e8; border: 1px solid #3a3a3a;
                border-radius: 3px; padding: 3px 8px; font: inherit; }
  #dbg button:hover { background: #3a3a3a; }
  #dbg label { display: flex; gap: 5px; align-items: center; color: #bbb; }
  #dbg input[type=text] { width: 44px; padding: 1px 4px; font: inherit; font-size: 12px;
                          background: #262626; color: #e8e8e8; border: 1px solid #3a3a3a; }
  #dbg pre { margin: 6px 0 0; max-height: 26vh; overflow: auto; color: #9ecbff;
             white-space: pre-wrap; word-break: break-all; }
  #dbg .warn { color: #ff9a9a; }
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

<!-- 4. Prolific ID -------------------------------------------------------- -->
<main id="s-pid" class="hidden">
  <h1>Your Prolific ID</h1>
  <p>We could not read your Prolific ID from the study link, so please paste it below. You can
     copy it from your Prolific account page — it is a 24-character code of letters and
     numbers, for example <code>5f8a1c2b3d4e5f60718293a4</code>.</p>
  <p><input type="text" id="pid" placeholder="paste your Prolific ID here" autocomplete="off"
            spellcheck="false" autocapitalize="off" autocorrect="off"></p>
  <p class="note">This is the only thing that links your play to your Prolific account, so
     please check it before continuing — we cannot pay a session with the wrong ID.</p>
  <div class="nav">
    <button id="pid-next">Start the games</button>
    <span class="err" id="pid-err"></span>
  </div>
</main>

<!-- 5. end-of-study questions --------------------------------------------- -->
<!-- Shown AFTER the session has already been uploaded, so nothing here can cost the
     participant their data or their payment. Every field is optional and Skip is a
     first-class button, not a link hidden in the corner. -->
<main id="s-feedback" class="hidden">
  <h1>Last few questions</h1>
  <p>Your play is already recorded and saved, and you will be paid either way. The feedback
     boxes are optional; the few questions about you need an answer, and
     <b>“Prefer not to say” is always one of the answers</b>.</p>
  <div id="fb-body" style="margin-top:26px"></div>
  <div class="nav">
    <button id="fb-submit">Submit and finish</button>
    <span class="err" id="fb-err"></span>
  </div>
</main>

<!-- 6. outro -------------------------------------------------------------- -->
<main id="s-outro" class="hidden">
  <h1>Done — thank you</h1>
  <p id="outro-msg">Uploading your session…</p>
  <!-- Two different codes, and confusing them strands a participant. PROLIFIC_CODE is the one
       the recruitment platform accepts; the PT- reference is ours, useful only to us when
       reconciling a session by hand. Only the platform's code is presented as "the code". -->
  <p id="outro-code" class="hidden">Completion code: <code id="code"></code></p>
  <p id="outro-ref" class="note hidden">Reference for the research team:
     <code id="refcode" style="font-size:15px"></code></p>
  <p id="outro-dl" class="hidden">
    Your results could not be uploaded automatically. Please
    <button id="dl">download your results</button> and message them to the research team through
    the recruitment platform — <b>you will still be paid</b>. Enter the completion code above to
    submit.</p>
</main>

<iframe id="frame" class="hidden" allow="autoplay"></iframe>
<div id="dbg" class="hidden"></div>

<script type="module">
const BLOCKS = ${JSON.stringify(blocks)};
const UPLOAD_URL = ${JSON.stringify(uploadUrl)};
// Prolific's completion URL. Only followed after a SUCCESSFUL upload -- redirecting on a
// failed upload would mark the participant complete while their data is gone.
const COMPLETION_URL = ${JSON.stringify(completionUrl)};
// The recruitment platform's own completion code, shown when the upload fails and the
// participant has to submit by hand. Derived from the completion URL's cc= when not given.
const PROLIFIC_CODE = ${JSON.stringify(completionCode)};
const PAGES = ${JSON.stringify(pages)};
// The block page caps the canvas at min(canvasSize, innerHeight - 96), so this is the window
// height at which every participant gets the SAME canvas rather than a smaller one.
const CANVAS_PX = ${canvasSize};
const MIN_INNER_H = CANVAS_PX + 96;
const QUIZ = ${JSON.stringify(quiz)};
const FEEDBACK_Q = ${JSON.stringify(feedbackQuestions())};
const DEMO_Q = ${JSON.stringify(demographicQuestions())};

const $ = id => document.getElementById(id);
const SCREENS = ['s-device', 's-blocked', 's-consent', 's-instr', 's-quiz', 's-pid', 's-feedback', 's-outro'];
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

  // The game is drawn at a fixed size so every participant sees the same visual angle, and a
  // short window silently shrinks it. The pilot proved this is not hypothetical: one
  // participant played at 561px and the other at 600px, which is precisely the between-subject
  // difference the fixed size exists to prevent. So the requirement is now hard -- below
  // MIN_INNER_H the study does not start -- and the escape hatch only appears once the window
  // can actually deliver the full canvas.
  if (innerHeight < MIN_INNER_H) return askResize();

  show('s-consent');
}

function wantInnerH() {
  // A little above the hard floor, so the nudge lands before the cap bites.
  return Math.min(MIN_INNER_H + 60, Math.max(MIN_INNER_H, screen.height - 100));
}

function askResize() {
  $('device-note').innerHTML =
    'Please <b>maximise your browser window</b> (or press F11) so the games display at their ' +
    'full size. Everyone has to see them at the same size, so the study cannot start until ' +
    'there is room. This page will continue on its own.<br><br>' +
    '<button id="anyway" style="display:none">Continue</button>';
  show('s-device');
  const go = (viaButton) => {
    session.preflight.innerH = innerHeight;
    session.preflight.resized = true;
    if (viaButton) session.preflight.continuedManually = true;
    show('s-consent');
  };
  const t = setInterval(() => {
    if (innerHeight >= wantInnerH()) { clearInterval(t); go(false); }
    // The manual button appears ONLY once the window is big enough for the full canvas. It
    // exists for the case where wantInnerH() is unreachable but MIN_INNER_H is met -- never as
    // a way to play at a smaller size, which is what it used to allow.
    const b = $('anyway');
    if (b && innerHeight >= MIN_INNER_H) b.style.display = 'inline-block';
  }, 400);
  setTimeout(() => {
    const b = $('anyway');
    if (b) b.onclick = () => { clearInterval(t); go(true); };
  }, 4000);
  // Still too short after a fair chance: stop rather than collect a session at the wrong size.
  setTimeout(() => {
    if (innerHeight >= MIN_INNER_H) return;
    clearInterval(t);
    block('window-too-small',
      'Your browser window is only ' + innerHeight + ' pixels tall, and these games need ' +
      MIN_INNER_H + '. Maximising the window or pressing F11 usually fixes it — reload to try ' +
      'again. If your screen cannot show a window that tall, please return the study.');
  }, 45000);
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
  $('instr-next').textContent = instrFrom === 'quiz' ? 'Back to the questions'
    : (i === PAGES.length - 1 ? 'Continue to comprehension check' : 'Next');
}
$('instr-back').onclick = () => renderInstr(Math.max(0, page - 1));
$('instr-next').onclick = () => {
  // Sent here by a marked question: one click returns to the answers, keeping them.
  if (instrFrom === 'quiz') { instrFrom = null; renderQuiz(lastWrong); return show('s-quiz'); }
  if (page < PAGES.length - 1) return renderInstr(page + 1);
  renderQuiz(lastWrong);
  show('s-quiz');
};

// ---------------------------------------------------------------------------
// 3. Comprehension check.
//
// A wrong answer used to replay ALL FIVE instruction pages before a retry, and the error
// reported only HOW MANY were wrong, never which. The two pilot participants needed 5 and 21
// attempts, spending 5.4 and 13.7 minutes in that loop -- one of them wrote "first one about
// rounds was confusing" -- which is most of why their sessions ran over the estimate.
//
// Now: answers persist between attempts, wrong ones are marked, and each marked question links
// to the instruction page that explains it. The gate is unchanged -- all four still have to be
// right -- and every attempt is logged, so which item people fail becomes a fact in the data
// instead of an inference from a feedback box.
// ---------------------------------------------------------------------------
let answers = [], attempts = 0, quizLog = [], lastWrong = [], instrFrom = null;

function renderQuiz(markWrong) {
  if (answers.length !== QUIZ.length) answers = QUIZ.map(() => -1);
  lastWrong = markWrong || [];
  $('quiz-err').textContent = '';
  $('quiz-body').innerHTML = QUIZ.map((q, qi) => {
    const bad = lastWrong.indexOf(qi) >= 0;
    const opts = q.options.map((o, oi) => \`
      <label class="opt"><input type="radio" name="q\${qi}" value="\${oi}"\${answers[qi] === oi ? ' checked' : ''}><span>\${o}</span></label>\`).join('');
    const hint = bad ? \`<p class="q-hint">Not quite. This one is explained on the
        <b>\${PAGES[q.page] ? PAGES[q.page].title : 'instructions'}</b> page —
        <button class="linkish" data-page="\${q.page}">read it again</button>.</p>\` : '';
    return \`<div class="q\${bad ? ' q-bad' : ''}" id="q-\${qi}"><p>\${qi + 1}. \${q.q}</p>\${opts}\${hint}</div>\`;
  }).join('');
  $('quiz-body').querySelectorAll('input[type=radio]').forEach(r => {
    r.addEventListener('change', e => {
      const qi = +e.target.name.slice(1);
      answers[qi] = +e.target.value;
      $('quiz-err').textContent = '';
      const box = $('q-' + qi);
      if (box) box.className = 'q';            // clear the mark as soon as they change it
    });
  });
  $('quiz-body').querySelectorAll('button.linkish').forEach(b => {
    b.addEventListener('click', () => {
      instrFrom = 'quiz';
      renderInstr(+b.dataset.page);
      show('s-instr');
    });
  });
}

$('quiz-submit').onclick = () => {
  if (answers.some(a => a === -1)) { $('quiz-err').textContent = 'Please answer every question.'; return; }
  attempts++;
  const wrong = QUIZ.map((q, i) => i).filter(i => answers[i] !== QUIZ[i].answer);
  quizLog.push({ attempt: attempts, answers: answers.slice(), wrong: wrong.slice() });
  if (wrong.length) {
    renderQuiz(wrong);
    $('quiz-err').textContent = wrong.length === 1
      ? 'One answer is not right — it is marked below.'
      : wrong.length + ' answers are not right — they are marked below.';
    const first = $('q-' + wrong[0]);
    if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }
  session.quiz = { attempts, passed: true, log: quizLog };
  if (session.participantId) return begin();   // came in on the URL; nothing to ask
  show('s-pid');
  $('pid').focus();
};

// ---------------------------------------------------------------------------
// 4. Prolific ID. Two ways in, and both are needed:
//
//   * Prolific substitutes the real ID into the study link, so when PROLIFIC_PID is
//     present we take it and skip this screen entirely. The ID is the one field in the
//     session that can be wrong in a way nothing downstream detects or repairs -- a
//     typo is an unmatchable session and a participant you owe money to anyway -- so
//     not asking is strictly safer than asking.
//   * When it is absent the participant pastes it. Params do get lost: a link copied
//     into another browser, or a direct link sent to a pilot participant. Without the
//     fallback that is a dead end mid-study.
//
// The param is SHAPE-CHECKED before it is trusted, which is not paranoia: if the
// Prolific study URL is saved with the placeholder unsubstituted, every participant
// arrives with a literal "{{%PROLIFIC_PID%}}" and every session would be filed under
// that one id. A param that fails the check is recorded as urlPidRejected and the
// participant is asked to paste instead, so the misconfiguration is visible and
// recoverable rather than silent and total.
//
// Validation is loose on purpose. Prolific IDs are 24 alphanumeric characters today,
// but hard-rejecting anything else would strand a participant whose ID does not fit
// that shape; anything unusual only has to be confirmed once, and the exact string
// is stored either way so a mismatch can be reconciled by hand.
// ---------------------------------------------------------------------------
const PID_RE = /^[A-Za-z0-9_-]{5,64}$/;
const qp = new URLSearchParams(location.search);

// Take the first VALID value across every occurrence of every accepted name, not the first
// occurrence. Prolific can deliver the id two ways -- by substituting {{%PROLIFIC_PID%}} in the
// study URL, or by appending PROLIFIC_PID itself when "record IDs via URL parameters" is on --
// and if both are configured the parameter appears twice:
//   ?PROLIFIC_PID={{%PROLIFIC_PID%}}&PROLIFIC_PID=5f8a1c2b3d4e5f60718293a4
// Reading position 0 there yields the unsubstituted literal, which fails the shape check and
// sends EVERY participant to the paste screen. Scanning for the first value that looks like an
// id makes all three configurations work, in any order.
const pidCandidates = ['PROLIFIC_PID', 'pid', 'participant']
  .flatMap(name => qp.getAll(name))
  .map(v => v.trim())
  .filter(Boolean);
const URL_PID = pidCandidates.find(v => PID_RE.test(v)) || null;
// Kept for the record: what arrived and was refused (an unsubstituted placeholder, junk).
const rawUrlPid = URL_PID || pidCandidates[0] || '';

session.source = {
  study: qp.get('STUDY_ID') || null,
  session: qp.get('SESSION_ID') || null,
  fromUrl: !!URL_PID,
  // Present only when a param arrived that we refused (unsubstituted placeholder,
  // truncated paste, junk). Truncated so a hostile query string cannot bloat the record.
  urlPidRejected: rawUrlPid && !URL_PID ? rawUrlPid.slice(0, 80) : null,
};
if (URL_PID) session.participantId = URL_PID;

let pidConfirmed = false;
$('pid').addEventListener('input', () => { $('pid-err').textContent = ''; pidConfirmed = false; });
$('pid').addEventListener('keydown', e => { if (e.key === 'Enter') $('pid-next').click(); });

$('pid-next').onclick = () => {
  const pid = $('pid').value.replace(/\\s+/g, '');
  if (!/^[A-Za-z0-9_-]{5,64}$/.test(pid)) {
    $('pid-err').textContent = pid
      ? 'That does not look like a Prolific ID — please paste it again.'
      : 'Please paste your Prolific ID.';
    return;
  }
  if (pid.length !== 24 && !pidConfirmed) {
    pidConfirmed = true;
    $('pid-err').textContent = 'Prolific IDs are usually 24 characters. Click again to use this one.';
    return;
  }
  // Record BOTH if a typed id ever coexists with one from the URL (only reachable via the
  // debug menu today, but it is the reconciliation trail if a study link gets shared).
  session.pidTyped = pid;
  if (URL_PID && URL_PID !== pid) session.pidMismatch = { url: URL_PID, typed: pid };
  session.participantId = pid;
  session.pidEnteredAt = new Date().toISOString();
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

let blockLoads = 0;
function runNext() {
  if (qi >= queue.length) return finish();
  $('progress').style.width = (qi / queue.length * 100) + '%';
  for (const s of SCREENS) $(s).classList.add('hidden');
  $('frame').classList.remove('hidden');
  // In debug the block gets "?r=N#dbg=..." appended: the query is a cache-buster so
  // re-launching the SAME block from the menu really reloads the iframe (a hash-only
  // change would not), and static hosts ignore it. A participant's URL never has either.
  $('frame').src = queue[qi].href + (DBG.active ? dbgBlockSuffix(blockLoads++) : '');
}

addEventListener('message', (e) => {
  const m = e.data;
  if (m && m.type === 'debug-toggle') return dbgToggle();
  if (!m || m.type !== 'block-done') return;
  if (!queue[qi] || !queue[qi].practice) session.blocks.push(m);
  qi++;
  // NOT after the last block. Checkpoints are fire-and-forget, so one sent here can land
  // AFTER finish()'s authoritative upload and, on a last-write-wins endpoint, downgrade a
  // finished session back to partial:true with no completionCode -- observed live, and
  // that is the field you would query to decide whom to pay. finish() is about to POST the
  // same blocks anyway, so the checkpoint buys nothing here.
  if (qi >= queue.length) return runNext();
  // Checkpoint after every block. Without this a participant who closes the tab at
  // block 7 of 9 contributes nothing at all -- and you may still owe them payment.
  // The server keys on participantId + startedAt and overwrites, so this is just the
  // same record getting progressively more complete. Fire-and-forget: a failed
  // checkpoint must never interrupt play, and the final upload is still authoritative.
  checkpoint();
  runNext();
});

function checkpoint() {
  if (!UPLOAD_URL || !session.blocks.length || !dbgCanUpload()) return;
  try {
    const body = JSON.stringify({ ...session, partial: true });
    // keepalive lets the request survive the page being closed mid-flight.
    fetch(UPLOAD_URL, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body, keepalive: body.length < 60000,
    }).catch(() => {});
  } catch { /* never let a checkpoint break the session */ }
}

// The tail of the session, in this order and for these reasons:
//
//   blocks done -> UPLOAD the complete session -> end-of-study questions -> upload again
//   with the answers attached -> outro -> Prolific redirect
//
// The play data is banked BEFORE anyone is asked an optional question. A participant who
// closes the tab on the questions has already contributed a complete, payable session; the
// only thing lost is the feedback. The reverse order would put the whole session behind a
// screen nobody is obliged to fill in.
let uploadOk = false;

async function uploadFinal() {
  if (!UPLOAD_URL || !dbgCanUpload()) return false;
  try {
    const res = await fetch(UPLOAD_URL, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...session, partial: false }),
    });
    return res.ok;
  } catch {
    return false;   // never lose a paid session to a bad network
  }
}

async function finish() {
  $('progress').style.width = '100%';
  session.finishedAt = new Date().toISOString();
  session.completionCode = 'PT-' + hash32(session.participantId + session.startedAt).toString(36).toUpperCase();
  uploadOk = await uploadFinal();
  renderFeedback();
  show('s-feedback');
}

// ---------------------------------------------------------------------------
// End-of-study questions. Optional, never blocking, and asked only once play is over.
// ---------------------------------------------------------------------------
function renderFeedback() {
  const field = (q) => {
    if (q.type === 'number') {
      return '<div class="fq" id="fqw-' + q.id + '">' +
        '<label class="qlabel" for="fq-' + q.id + '">' + q.label +
        (q.required ? '' : ' <span class="hint" style="font-weight:400">(optional)</span>') + '</label>' +
        (q.hint ? '<p class="hint">' + q.hint + '</p>' : '') +
        '<input type="number" id="fq-' + q.id + '" min="' + q.min + '" max="' + q.max +
        '" placeholder="' + q.placeholder + '" inputmode="numeric">' +
        (q.decline ? '<label class="opt" style="margin-top:8px"><input type="checkbox" id="fq-' +
          q.id + '-decline"><span>' + q.decline + '</span></label>' : '') +
        '</div>';
    }
    if (q.type === 'text') {
      return '<div class="fq"><label class="qlabel" for="fq-' + q.id + '">' + q.label + '</label>' +
        (q.hint ? '<p class="hint">' + q.hint + '</p>' : '') +
        '<textarea id="fq-' + q.id + '" spellcheck="true"></textarea></div>';
    }
    const opts = q.options.map((o, i) =>
      '<label class="opt"><input type="radio" name="fq-' + q.id + '" value="' + o.replace(/"/g, '&quot;') +
      '"><span>' + o + '</span></label>').join('');
    return '<div class="fq" id="fqw-' + q.id + '"><span class="qlabel">' + q.label +
      (q.required ? '' : ' <span class="hint" style="font-weight:400">(optional)</span>') + '</span>' +
      (q.hint ? '<p class="hint">' + q.hint + '</p>' : '') +
      '<div class="opts">' + opts + '</div>' +
      (q.selfDescribe ? '<input type="text" class="selfdesc hidden" id="fq-' + q.id +
        '-self" placeholder="how you describe it" autocomplete="off">' : '') +
      '</div>';
  };

  $('fb-body').innerHTML =
    '<div id="fb-tech">' + FEEDBACK_Q.map(field).join('') + '</div>' +
    '<p class="note" style="margin:30px 0 14px">The last few are about you, and are used only ' +
    'to describe the group of people who took part. “Prefer not to say” is fine for any of ' +
    'them.</p>' +
    DEMO_Q.map(field).join('');

  $('fb-body').addEventListener('input', () => {
    $('fb-err').textContent = '';
    for (const q of DEMO_Q) {
      const w = $('fqw-' + q.id);
      if (w) { w.style.borderLeft = ''; w.style.paddingLeft = ''; }
    }
  });
  // ticking "prefer not to say" on age clears and disables the number box, so the two
  // cannot disagree in the record
  for (const q of DEMO_Q) {
    if (q.type !== 'number' || !q.decline) continue;
    const box = $('fq-' + q.id + '-decline'), num = $('fq-' + q.id);
    box.addEventListener('change', () => {
      num.disabled = box.checked;
      if (box.checked) num.value = '';
    });
  }

  // The self-describe box appears only when that option is chosen, so it is not a field
  // everyone feels obliged to fill in.
  for (const q of DEMO_Q.concat(FEEDBACK_Q)) {
    if (!q.selfDescribe) continue;
    const box = $('fq-' + q.id + '-self');
    document.querySelectorAll('input[name="fq-' + q.id + '"]').forEach(r => {
      r.addEventListener('change', (e) => {
        box.classList.toggle('hidden', e.target.value !== q.selfDescribe);
        if (e.target.value === q.selfDescribe) box.focus();
      });
    });
  }
}

function readAnswers(defs) {
  const out = {};
  for (const q of defs) {
    if (q.type === 'choice') {
      const picked = document.querySelector('input[name="fq-' + q.id + '"]:checked');
      let v = picked ? picked.value : null;
      if (v && q.selfDescribe && v === q.selfDescribe) {
        const self = $('fq-' + q.id + '-self').value.trim();
        v = self ? 'self-described: ' + self.slice(0, 120) : q.selfDescribe;
      }
      out[q.id] = v;
    } else if (q.type === 'number') {
      if (q.decline && $('fq-' + q.id + '-decline').checked) { out[q.id] = q.decline; continue; }
      const raw = $('fq-' + q.id).value.trim();
      const n = raw === '' ? null : Number(raw);
      // Out of range is stored as the raw string rather than dropped, so an implausible entry
      // is visible in the data instead of indistinguishable from a refusal.
      out[q.id] = (n !== null && Number.isFinite(n) && n >= q.min && n <= q.max)
        ? n : (raw === '' ? null : 'out-of-range: ' + raw.slice(0, 20));
    } else {
      const t = $('fq-' + q.id).value.trim();
      out[q.id] = t ? t.slice(0, 4000) : null;   // bound what a paste can put in the record
    }
  }
  return out;
}

// Every required question needs a response, and "Prefer not to say" counts as one. This
// exists to stop ACCIDENTAL missingness -- at n=20 a few silent skips wreck the only
// covariates the analysis has -- not to extract an answer from someone who does not want to
// give one. Hence no disabled Submit button and no dead end: one click on the decline option
// satisfies it.
function missingRequired() {
  const answers = readAnswers(DEMO_Q);
  return DEMO_Q.filter(q => q.required && (answers[q.id] === null || answers[q.id] === undefined));
}

async function submitFeedback(skipped) {
  if (!skipped) {
    const missing = missingRequired();
    if (missing.length) {
      $('fb-err').textContent = missing.length === 1
        ? 'One question still needs an answer — “Prefer not to say” is fine.'
        : missing.length + ' questions still need an answer — “Prefer not to say” is fine.';
      for (const q of missing) $('fqw-' + q.id).style.borderLeft = '3px solid #b00020';
      for (const q of missing) $('fqw-' + q.id).style.paddingLeft = '12px';
      missing[0].id && $('fqw-' + missing[0].id).scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
  }
  $('fb-submit').disabled = true;
  const fb = skipped ? {} : readAnswers(FEEDBACK_Q);
  const demo = skipped ? {} : readAnswers(DEMO_Q);
  session.feedback = { ...fb, skipped: !!skipped, at: new Date().toISOString() };
  session.demographics = { ...demo, skipped: !!skipped };
  // Re-upload with the answers attached. partial stays false, so the endpoint's
  // never-downgrade-a-complete-record guard lets this through as a merge.
  const ok = await uploadFinal();
  uploadOk = uploadOk || ok;
  showOutro();
}

$('fb-submit').onclick = () => submitFeedback(false);

function showOutro() {
  show('s-outro');
  // Show the PLATFORM's code when one is configured -- ours means nothing to Prolific, and a
  // participant whose upload failed would paste it, be rejected, and be stuck.
  $('code').textContent = PROLIFIC_CODE || session.completionCode;
  $('outro-code').classList.remove('hidden');
  if (PROLIFIC_CODE) {
    $('refcode').textContent = session.completionCode;
    $('outro-ref').classList.remove('hidden');
  }
  if (uploadOk) {
    $('outro-msg').textContent = 'Your session was recorded.';
    if (COMPLETION_URL && !DBG.active) {
      $('outro-msg').textContent = 'Your session was recorded. Returning you to Prolific…';
      setTimeout(() => { location.href = COMPLETION_URL; }, 2500);
    }
    return;
  }
  $('outro-msg').textContent = DBG.active && !DBG.upload
    ? 'Debug run — upload suppressed, so nothing was sent to the server.' : '';
  $('outro-dl').classList.remove('hidden');
  $('dl').onclick = () => {
    const blob = new Blob([JSON.stringify(session)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'playtrain-session-' + session.participantId + '.json';
    a.click();
  };
}

// ---------------------------------------------------------------------------
// 6. Debug menu. Dev-only, but it ships in every build: gating it on a build flag
// means the thing you test is not the thing you deploy. It is opened by a key combo
// rather than a URL parameter -- ctrl+shift+alt+D -- so there is no guessable ?debug=1
// that would let a participant skip the comprehension check. The block iframes forward
// the same combo up here, so it also opens mid-block.
//
// Everything reached through the menu stamps debug:true on the session and, unless you
// tick "allow upload", suppresses every POST -- a walkthrough must not be able to land
// in the collected data, and the practice+9-block queue at 10s a block is a run you will
// do dozens of times while editing copy.
// ---------------------------------------------------------------------------
const DBG = { open: false, active: false, short: true, sec: 10, auto: false, upload: false };

function dbgCanUpload() { return !DBG.active || DBG.upload; }

function dbgBlockSuffix(n) {
  return '?r=' + n + '#dbg=' + (DBG.short ? DBG.sec : 0) + (DBG.auto ? '&auto=1' : '');
}

// Merely OPENING the menu marks the session debug and stops it uploading. Deciding that
// per-button would be a trap: walk the real flow after peeking at the menu and you would
// silently be writing a fake participant into the collected data. Tick "allow upload" to
// exercise the endpoint on purpose.
function dbgPoison() {
  DBG.active = true;
  session.debug = true;
}

// Fill in whatever the skipped screens would have produced, so a session assembled by
// jumping around still has the shape the endpoint and verify-replay expect. Real screens
// overwrite these if you visit them afterwards.
function dbgArm() {
  const now = new Date().toISOString();
  dbgPoison();
  session.participantId = session.participantId || 'debug';
  session.startedAt = session.startedAt || now;
  session.preflight = session.preflight || { ok: true, debug: true };
  session.consent = session.consent || { agreed: true, at: now, doNotRecontact: false, debug: true };
  session.quiz = session.quiz || { attempts: 0, passed: true, debug: true };
}

function dbgTrim(k, v) {
  // actions/keys are tens of thousands of ints; show the length, not the contents.
  if (Array.isArray(v) && v.length > 12 && typeof v[0] === 'number') return '[' + v.length + ' ints]';
  return v;
}

function dbgOut(text) { $('dbg-out').textContent = text; }

function dbgRender() {
  const btn = (attr, val, label) => '<button data-' + attr + '="' + val + '">' + label + '</button>';
  const instr = PAGES.map((p, i) => btn('instr', i, (i + 1) + '. ' + p.title)).join('');
  const blks = BLOCKS.map((b, i) => btn('block', i,
    b.game + (b.obsRes ? '@64' : '') + (b.practice ? ' (practice)' : ''))).join('');

  $('dbg').innerHTML =
    '<div class="row"><span class="lbl">debug</span><span>' +
      'ctrl+shift+alt+D toggles this &middot; esc closes &middot; ' +
      'ctrl+shift+alt+S ends the block you are in' +
    '</span></div>' +
    '<div class="row"><span class="lbl">screens</span>' +
      btn('screen', 's-device', 'device check') +
      btn('screen', 's-blocked', 'rejected') +
      btn('screen', 's-consent', 'consent') +
      btn('screen', 's-quiz', 'quiz') +
      btn('screen', 's-pid', 'prolific id') +
      btn('feedback', '1', 'end questions') +
      btn('outro', '1', 'outro') +
    '</div>' +
    '<div class="row"><span class="lbl">instructions</span>' + instr + '</div>' +
    '<div class="row"><span class="lbl">blocks</span>' + blks + '</div>' +
    '<div class="row"><span class="lbl">run</span>' +
      btn('run', 'all', 'whole session') +
      btn('run', 'scored', 'scored blocks only') +
      '<label><input type="checkbox" id="dbg-short"> short blocks' +
        ' <input type="text" id="dbg-sec" value="' + DBG.sec + '">s</label>' +
      '<label><input type="checkbox" id="dbg-auto"> auto-start</label>' +
    '</div>' +
    '<div class="row"><span class="lbl">session</span>' +
      btn('dump', '1', 'dump json') +
      btn('dl', '1', 'download json') +
      btn('reset', '1', 'reload page') +
      '<label class="warn"><input type="checkbox" id="dbg-upload"> allow upload</label>' +
    '</div>' +
    '<div class="row"><span class="lbl">state</span><span id="dbg-state"></span></div>' +
    '<pre id="dbg-out"></pre>';

  $('dbg-short').checked = DBG.short;
  $('dbg-auto').checked = DBG.auto;
  $('dbg-upload').checked = DBG.upload;
  $('dbg-short').onchange = e => { DBG.short = e.target.checked; dbgState(); };
  $('dbg-auto').onchange = e => { DBG.auto = e.target.checked; dbgState(); };
  $('dbg-upload').onchange = e => { DBG.upload = e.target.checked; dbgState(); };
  $('dbg-sec').oninput = e => {
    const n = parseFloat(e.target.value);
    if (n > 0) DBG.sec = n;
    dbgState();
  };
  $('dbg').onclick = dbgClick;
  dbgState();
}

function dbgState() {
  const up = UPLOAD_URL ? (dbgCanUpload() ? 'ON — will write real data' : 'suppressed') : 'no endpoint';
  $('dbg-state').textContent =
    'pid=' + (session.participantId || '(none)') +
    '  queue=' + (queue.length ? (qi + '/' + queue.length) : '-') +
    '  collected=' + session.blocks.length + ' blocks' +
    '  blockLen=' + (DBG.short ? DBG.sec + 's' : 'full') +
    '  upload=' + up;
}

function dbgClick(e) {
  const t = e.target.closest('button');
  if (!t) return;
  const d = t.dataset;

  if (d.screen) {
    if (d.screen === 's-device') $('device-note').textContent = 'One moment.';
    if (d.screen === 's-blocked') $('blocked-why').textContent =
      '(debug) example rejection message — the real one names the reason.';
    if (d.screen === 's-quiz') renderQuiz();
    if (d.screen === 's-pid') $('pid').value = '';
    show(d.screen);
    if (d.screen === 's-pid') $('pid').focus();
  } else if (d.instr !== undefined) {
    renderInstr(+d.instr);
    show('s-instr');
  } else if (d.feedback) {
    dbgArm();
    session.completionCode = session.completionCode ||
      'PT-' + hash32(session.participantId + session.startedAt).toString(36).toUpperCase();
    renderFeedback();
    show('s-feedback');
  } else if (d.outro) {
    dbgArm();
    finish();
  } else if (d.block !== undefined) {
    dbgArm();
    queue = [BLOCKS[+d.block]];
    qi = 0;
    session.order = queue.map(b => b.game + (b.obsRes ? '@64' : '') + (b.practice ? '(practice)' : ''));
    dbgToggle(false);
    runNext();
    return;
  } else if (d.run) {
    dbgArm();
    if (d.run === 'all') { dbgToggle(false); return begin(); }
    queue = BLOCKS.filter(b => !b.practice);
    qi = 0;
    session.order = queue.map(b => b.game + (b.obsRes ? '@64' : ''));
    dbgToggle(false);
    runNext();
    return;
  } else if (d.dump) {
    console.log('[debug] session', session);
    dbgOut(JSON.stringify(session, dbgTrim, 1));
  } else if (d.dl) {
    const blob = new Blob([JSON.stringify(session)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'playtrain-debug-' + (session.participantId || 'session') + '.json';
    a.click();
  } else if (d.reset) {
    location.reload();
    return;
  }
  dbgState();
}

function dbgToggle(force) {
  DBG.open = force === undefined ? !DBG.open : !!force;
  if (DBG.open) { dbgPoison(); dbgRender(); }
  $('dbg').classList.toggle('hidden', !DBG.open);
}

addEventListener('keydown', e => {
  // e.code, not e.key: on macOS Alt+D yields a dead-key character rather than "D".
  if (e.ctrlKey && e.shiftKey && e.altKey && e.code === 'KeyD') { e.preventDefault(); dbgToggle(); }
  else if (e.key === 'Escape' && DBG.open) dbgToggle(false);
});

preflight();
</script>
</body></html>`;
}
