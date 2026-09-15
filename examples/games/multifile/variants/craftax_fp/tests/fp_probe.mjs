#!/usr/bin/env node
// fp_probe.mjs — render the first-person frame with the game's own code and
// the REAL voxel primitive, while reaching into the game state.
//
// Why this exists: the only way to test that yaw is wired up is to change the
// facing and nothing else. Through PlayTrainEnv you can only send actions, and
// in Craftax a move action changes the player's POSITION as well as its
// facing — so "the four move actions give four different frames" passes even
// when the yaw mapping is replaced by a constant. (Checked: it does.)
//
// So: run the bundle as one script, give it the six rasterizer calls it uses
// backed by the wasm rasterizer (the same Rust the hosts run, not a stub — a
// stubbed voxelView would test nothing), then set gameState.playerDir by hand.
//
//   node tests/fp_probe.mjs <bundle.js> <seed> <dir> [dir...]
//
// prints one "dir <d> <fnv1a-hex>" line per facing, over the view region only.
import fs from 'node:fs';
import { createCanvas } from '../../../../../../runtime/p5/raster-wasm.mjs';

// `--mob <dRow> <dCol>` puts a zombie at that offset from the player and
// reports how many pixels it changed, instead of hashing facings. Mobs are
// rare and never where you want them, so injecting one is the only way to
// test the billboard pass end to end through the game's own renderer.
const argv = process.argv.slice(2);
// `--night [driverSeed]` steps until light_level < 0.5 and reports how the
// night frame differs from the same state rendered at full daylight, and
// (with a driver seed) how the static changes it again.
const nightAt = argv.indexOf('--night');
let nightSeed = null;
let night = false;
if (nightAt >= 0) {
  night = true;
  const next = argv[nightAt + 1];
  if (next !== undefined && /^\d+$/.test(next)) {
    nightSeed = Number(next);
    argv.splice(nightAt, 2);
  } else {
    argv.splice(nightAt, 1);
  }
}
const mobAt = argv.indexOf('--mob');
let mob = null;
if (mobAt >= 0) {
  mob = [Number(argv[mobAt + 1]), Number(argv[mobAt + 2])];
  argv.splice(mobAt, 3);
}
const [bundlePath, seedArg, ...dirArgs] = argv;
if (!bundlePath || !seedArg || dirArgs.length === 0) {
  console.error('usage: fp_probe.mjs [--mob <dRow> <dCol>] <bundle.js> <seed> <dir> [dir...]');
  process.exit(2);
}

const CANVAS = 64;
const VIEW_H = 49;
const canvas = createCanvas(CANVAS, CANVAS, CANVAS, CANVAS);
const ctx = canvas.getContext('2d');
const bitmaps = [];

const surface = {
  createCanvas(w, h) {
    if (w !== CANVAS || h !== CANVAS) throw new Error(`createCanvas ${w}x${h}`);
  },
  background(r, g, b) {
    ctx.fillStyle = `rgba(${r},${g},${b},1)`;
    ctx.fillRect(0, 0, CANVAS, CANVAS);
  },
  createBitmap(w, h) {
    const c = createCanvas(w, h, w, h);
    bitmaps.push(c);
    return bitmaps.length - 1;
  },
  loadBitmap(id, bytes) { return bitmaps[id].getContext('2d').loadRGBA(bytes); },
  image(id, x, y, w, h) { ctx.drawImage(bitmaps[id], x, y, w, h); },
  voxelView(...args) { ctx.voxelView(...args); },
  voxelSprite(...args) { ctx.voxelSprite(...args); },
  voxelDusk(...args) { ctx.voxelDusk(...args); },
  keyIsDown() { return false; },
  print(...a) { console.error(...a); },
};

const src = fs.readFileSync(bundlePath, 'utf8');
// The bundle is a plain concatenation, so evaluating it in a function scope
// with the surface in scope is exactly how a host presents those globals.
const names = Object.keys(surface);
const run = new Function(...names, `${src}\nreturn { setup, draw, resetGame, stepGame, nightTick, renderGameFp, setDriverSeed, get state() { return gameState; } };`);
const game = run(...names.map((n) => surface[n]));

game.setup();
if (night && nightSeed !== null) game.setDriverSeed(nightSeed);
game.resetGame(Number(seedArg));
game.draw();                      // the reset tick, as every host does

function fnv1a(bytes) {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h = (h ^ bytes[i]) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function frameBytes() {
  return Uint8Array.from(ctx.getImageData().data.subarray(0, CANVAS * VIEW_H * 4));
}
function diff(a, b) {
  let n = 0;
  for (let i = 0; i < CANVAS * VIEW_H; i++) {
    const o = i * 4;
    if (a[o] !== b[o] || a[o + 1] !== b[o + 1] || a[o + 2] !== b[o + 2]) n++;
  }
  return n;
}

if (night) {
  // Craftax's light_level cycles with the timestep; walk forward until it
  // drops below 0.5, which is where the static branch turns on.
  let steps = 0;
  while (game.state.lightLevel[0] >= 0.5 && steps < 400) {
    game.draw();
    steps++;
  }
  const light = game.state.lightLevel[0];
  game.renderGameFp(game.state);
  const nightFrame = frameBytes();
  // The same state, forced to full daylight: the dusk pass then does nothing.
  const saved = game.state.lightLevel[0];
  game.state.lightLevel[0] = 1.0;
  game.renderGameFp(game.state);
  const dayFrame = frameBytes();
  game.state.lightLevel[0] = saved;
  console.log(`steps=${steps} light=${light.toFixed(4)} nightvsday=${diff(nightFrame, dayFrame)} nighthash=${fnv1a(nightFrame)} driverseed=${nightSeed === null ? 'none' : nightSeed}`);
  process.exit(0);
}

for (const d of dirArgs) {
  game.state.playerDir[0] = Number(d);
  if (mob) {
    // Render once with no mobs at all, to diff against.
    for (let i = 0; i < game.state.zombieMask.length; i++) game.state.zombieMask[i] = 0;
    for (let i = 0; i < game.state.cowMask.length; i++) game.state.cowMask[i] = 0;
    for (let i = 0; i < game.state.skelMask.length; i++) game.state.skelMask[i] = 0;
    for (let i = 0; i < game.state.arrowMask.length; i++) game.state.arrowMask[i] = 0;
    game.renderGameFp(game.state);
    const clean = Uint8Array.from(ctx.getImageData().data.subarray(0, CANVAS * VIEW_H * 4));
    game.state.zombieMask[0] = 1;
    game.state.zombieR[0] = game.state.playerR[0] + mob[0];
    game.state.zombieC[0] = game.state.playerC[0] + mob[1];
    game.renderGameFp(game.state);
    const withMob = ctx.getImageData().data;
    let changed = 0;
    for (let i = 0; i < CANVAS * VIEW_H; i++) {
      const o = i * 4;
      if (clean[o] !== withMob[o] || clean[o + 1] !== withMob[o + 1] || clean[o + 2] !== withMob[o + 2]) changed++;
    }
    console.log(`dir ${d} mobpixels=${changed}`);
    continue;
  }
  game.renderGameFp(game.state);
  const px = ctx.getImageData().data;
  // DISTINCT colours above the horizon (rows 0..23). Only a CUBE can put
  // anything up there: floors all sit at y=0, below eye height. So an
  // all-floor world shows exactly ONE colour — the sky — and any solid block
  // in view makes it more than one.
  //
  // Counting colours rather than "pixels that are not SKY_RGB" is deliberate.
  // The dusk pass tints the sky at ANY light_level below 1, and light_level at
  // the reset frame is about 0.81, so the sky on screen is never the raw
  // constant. The earlier version of this metric compared against SKY_RGB and
  // reported the whole region as non-sky from T6b onward, which made the
  // solid-blocks test pass for the wrong reason.
  const seen = new Set();
  for (let i = 0; i < CANVAS * 24; i++) {
    const o = i * 4;
    seen.add((px[o] << 16) | (px[o + 1] << 8) | px[o + 2]);
  }
  // view region only: the inventory strip does not depend on facing
  console.log(`dir ${d} ${fnv1a(px.subarray(0, CANVAS * VIEW_H * 4))} abovecolours=${seen.size}`);
}
