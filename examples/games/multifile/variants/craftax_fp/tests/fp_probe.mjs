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

const [bundlePath, seedArg, ...dirArgs] = process.argv.slice(2);
if (!bundlePath || !seedArg || dirArgs.length === 0) {
  console.error('usage: fp_probe.mjs <bundle.js> <seed> <dir> [dir...]');
  process.exit(2);
}

const CANVAS = 64;
const VIEW_H = 49;
const SKY_R = 0x87, SKY_G = 0xCE, SKY_B = 0xEB;
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
  keyIsDown() { return false; },
  print(...a) { console.error(...a); },
};

const src = fs.readFileSync(bundlePath, 'utf8');
// The bundle is a plain concatenation, so evaluating it in a function scope
// with the surface in scope is exactly how a host presents those globals.
const names = Object.keys(surface);
const run = new Function(...names, `${src}\nreturn { setup, draw, resetGame, stepGame, nightTick, renderGameFp, get state() { return gameState; } };`);
const game = run(...names.map((n) => surface[n]));

game.setup();
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

for (const d of dirArgs) {
  game.state.playerDir[0] = Number(d);
  game.renderGameFp(game.state);
  const px = ctx.getImageData().data;
  // Pixels above the horizon (rows 0..23) that are not sky. Only a CUBE can
  // put anything there: floors are all at y=0, which is below eye height, so a
  // build that forgot to make solid blocks solid reports 0 here on every seed.
  let aboveHorizon = 0;
  for (let i = 0; i < CANVAS * 24; i++) {
    const o = i * 4;
    if (px[o] !== SKY_R || px[o + 1] !== SKY_G || px[o + 2] !== SKY_B) aboveHorizon++;
  }
  // view region only: the inventory strip does not depend on facing
  console.log(`dir ${d} ${fnv1a(px.subarray(0, CANVAS * VIEW_H * 4))} above=${aboveHorizon}`);
}
