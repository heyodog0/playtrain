#!/usr/bin/env node
// Golden trajectory hashes for every bundled game: (game, seed) -> sha256 over the full per-step
// state (pc, I, V, sp, stack, timers, keypad, display, rng, score, reward, terminated, truncated).
// Checked without Python; tests/gate_oracle.mjs is what proves the engine against Octax.
// Six seeds, 500 steps, stepping past terminated like the lockstep gate does.
//   node tests/golden.mjs --write | --check     [--steps N]
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..');
const args = process.argv.slice(2);
const STEPS = args.includes('--steps') ? parseInt(args[args.indexOf('--steps') + 1], 10) : 500;
const SEEDS = [42, 7, 3, 11, 19, 23];
function lcg(seed) { let x = seed >>> 0; return () => { x = (x * 1103515245 + 12345) >>> 0; return x >>> 8; }; }
function load(file) {
  const ctx = { createCanvas() {}, background() {}, noStroke() {}, fill() {}, rect() {}, drawTiles() {}, keyIsDown: () => false, console };
  ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(readFileSync(file, 'utf8'), ctx, { filename: file }); return ctx;
}
const games = readdirSync(join(ROOT, 'games')).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort();
const out = {}, prev = args.includes('--check') ? JSON.parse(readFileSync(join(HERE, 'golden.json'), 'utf8')) : null;
let bad = 0, n = 0;
for (const game of games) {
  const g = load(join(ROOT, 'dist', `chip8_${game}.js`)).__chip8;
  const nA = g.def().action_set.length + 1;
  for (const seed of SEEDS) {
    const rnd = lcg(seed * 7919 + 17); const h = createHash('sha256');
    g.reset(seed); h.update(JSON.stringify(g.snap()));
    let term = -1;
    for (let k = 0; k < STEPS; k++) { g.step(rnd() % nA); const s = g.snap(); if (term < 0 && s.terminated) term = s.t; h.update(JSON.stringify(s)); }
    const key = `${game}/seed${seed}`; const val = `${STEPS + 1}:${term}:${h.digest('hex').slice(0, 16)}`;
    out[key] = val; n++;
    if (prev && prev[key] !== val) { bad++; console.log(`MISMATCH ${key}: ${prev[key]} -> ${val}`); }
  }
}
if (prev) { for (const k of Object.keys(prev)) if (!(k in out)) { bad++; console.log(`MISSING ${k}`); } console.log(bad ? `${bad} mismatches of ${n}` : `golden ok (${n} trajectories)`); process.exit(bad ? 1 : 0); }
writeFileSync(join(HERE, 'golden.json'), JSON.stringify(out, null, 1) + '\n'); console.log(`wrote ${n} golden hashes`);
