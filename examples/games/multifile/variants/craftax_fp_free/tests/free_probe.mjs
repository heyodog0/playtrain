#!/usr/bin/env node
// free_probe.mjs — drive the free-movement bundle by ACTION INDEX and report
// what each one did to the player's cell and facing.
//
// Action indices, not keys, on purpose: that is what an agent sends, and the
// claim being checked is about the action space. (The keymap is checked
// separately by driving keys through a host.)
//
//   node free_probe.mjs <bundle.js> <seed> <action> [action...]
import fs from 'node:fs';
import { createCanvas } from '../../../../../../runtime/p5/raster-wasm.mjs';

const [bundlePath, seedArg, ...acts] = process.argv.slice(2);
if (!bundlePath || !seedArg) {
  console.error('usage: free_probe.mjs <bundle.js> <seed> <action> [action...]');
  process.exit(2);
}
const canvas = createCanvas(64, 64, 64, 64);
const ctx = canvas.getContext('2d');
const bmps = [];
const surface = {
  createCanvas() {},
  background(r, g, b) { ctx.fillStyle = `rgba(${r},${g},${b},1)`; ctx.fillRect(0, 0, 64, 64); },
  createBitmap(w, h) { const c = createCanvas(w, h, w, h); bmps.push(c); return bmps.length - 1; },
  loadBitmap(i, b) { return bmps[i].getContext('2d').loadRGBA(b); },
  image(i, x, y, w, h) { ctx.drawImage(bmps[i], x, y, w, h); },
  voxelView(...a) { ctx.voxelView(...a); },
  voxelSprite(...a) { ctx.voxelSprite(...a); },
  voxelDusk(...a) { ctx.voxelDusk(...a); },
  keyIsDown() { return false; },
  print() {},
};
const names = Object.keys(surface);
const src = fs.readFileSync(bundlePath, 'utf8');
const g = new Function(...names, `${src}\nreturn { setup, resetGame, stepGame, get state() { return gameState; } };`)(...names.map((n) => surface[n]));
g.setup();
g.resetGame(Number(seedArg));

const DIRN = { 1: 'west', 2: 'east', 3: 'north', 4: 'south' };
for (const a of acts) {
  const b = [g.state.playerR[0], g.state.playerC[0], g.state.playerDir[0]];
  g.stepGame(g.state, Number(a));
  const t = [g.state.playerR[0], g.state.playerC[0], g.state.playerDir[0]];
  const moved = (b[0] !== t[0] || b[1] !== t[1]);
  const turned = b[2] !== t[2];
  console.log(`action ${String(a).padStart(2)}  facing ${DIRN[b[2]].padEnd(5)} -> ${DIRN[t[2]].padEnd(5)}  cell (${b[0]},${b[1]}) -> (${t[0]},${t[1]})  moved=${moved} turned=${turned}`);
}
