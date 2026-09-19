#!/usr/bin/env node
// Golden trajectory hashes for every bundled game: (game, level, seed) -> sha256 over the full
// per-step state (time, score, ended, won, every live sprite). CI checks these without Python;
// tests/gate_oracle.mjs is what proves them against py-vgdl in the first place.
//   node tests/golden.mjs --write | --check     [--steps N]
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..');
const args = process.argv.slice(2);
const STEPS = parseInt((args[args.indexOf('--steps') + 1] || '300'), 10);
const SEEDS = [42, 7, 3];
const KEYS = [[273], [274], [276], [275], [], [32]];
function lcg(seed) { let x = seed >>> 0; return () => { x = (x * 1103515245 + 12345) >>> 0; return x >>> 8; }; }
function load(file) {
  const held = new Set();
  const ctx = { createCanvas() {}, background() {}, noStroke() {}, fill() {}, rect() {}, keyIsDown: c => held.has(c), console };
  ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(readFileSync(file, 'utf8'), ctx, { filename: file }); return ctx;
}
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const out = {}, prev = args.includes('--check') ? JSON.parse(readFileSync(join(HERE, 'golden.json'), 'utf8')) : null;
let bad = 0, n = 0;
for (const [corpus, c] of Object.entries(manifest.corpora)) for (const game of c.games) {
  const ctx = load(join(ROOT, 'dist', `vgdl_${game}.js`)); const g = ctx.__vgdl;
  for (let lvl = 0; lvl < g.levels(); lvl++) for (const seed of SEEDS) {
    const rnd = lcg(seed * 7919 + lvl); const h = createHash('sha256');
    g.resetLevel(lvl, seed); h.update(JSON.stringify({ ...g.state(), sprites: g.snapshot() }));
    let steps = 1;
    for (let k = 0; k < STEPS && !g.state().ended; k++) { g.tickKeys(KEYS[rnd() % 6]); h.update(JSON.stringify({ ...g.state(), sprites: g.snapshot() })); steps++; }
    const key = `${corpus}/${game}/lvl${lvl}/seed${seed}`; const val = `${steps}:${h.digest('hex').slice(0, 16)}`;
    out[key] = val; n++;
    if (prev && prev[key] !== val) { bad++; console.log(`MISMATCH ${key}: ${prev[key]} -> ${val}`); }
  }
}
if (prev) { for (const k of Object.keys(prev)) if (!(k in out)) { bad++; console.log(`MISSING ${k}`); } console.log(bad ? `${bad} mismatches of ${n}` : `golden ok (${n} trajectories)`); process.exit(bad ? 1 : 0); }
writeFileSync(join(HERE, 'golden.json'), JSON.stringify(out, null, 1) + '\n'); console.log(`wrote ${n} golden hashes`);
