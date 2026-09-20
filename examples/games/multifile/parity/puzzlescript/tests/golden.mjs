#!/usr/bin/env node
// Golden trajectory hashes for every bundle: (game, seed) -> sha256 over the full per-step state (the lockstep
// gate's field list). Checked without the checkout; tests/gate_oracle.mjs is what proves the bundles against it.
// Six seeds, 300 steps, stopping at winning like the gate.
//   node tests/golden.mjs --write | --check     [--steps N]
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..');
const args = process.argv.slice(2);
const STEPS = args.includes('--steps') ? parseInt(args[args.indexOf('--steps') + 1], 10) : 300;
const SEEDS = [42, 7, 3, 11, 19, 23];
function lcg(seed) { let x = seed >>> 0; return () => { x = (x * 1103515245 + 12345) >>> 0; return x >>> 8; }; }
const sha1 = (b) => createHash('sha1').update(b).digest('hex');
function load(file) {
  const ctx = { console, createCanvas() {}, background() {}, noStroke() {}, fill() {}, rect() {}, drawTiles() {}, keyIsDown: () => false };
  ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(readFileSync(file, 'utf8'), ctx, { filename: file }); ctx.setup(); return ctx;
}
function snap(ctx, agains) {
  const s = ctx.__ps.snap();
  return JSON.stringify({ level: s.level, objects: sha1(Buffer.from(Int32Array.from(s.objects).buffer)), curlevel: s.curlevel, winning: s.winning, againing: s.againing,
    textMode: s.textMode, messagetext: s.messagetext, backups: s.backups, movements_zero: s.movements_zero, rng_i: s.rng.i, rng_j: s.rng.j,
    rng_s: sha1(Buffer.from(Uint8Array.from(s.rng.s))), width: s.width, height: s.height, agains });
}
const games = readdirSync(join(ROOT, 'games')).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort();
const out = {}, prev = args.includes('--check') ? JSON.parse(readFileSync(join(HERE, 'golden.json'), 'utf8')) : null;
let bad = 0, n = 0;
for (const game of games) {
  const ctx = load(join(ROOT, 'dist', `ps_${game}.js`)); const g = ctx.__ps;
  for (const seed of SEEDS) {
    const rnd = lcg(seed * 7919 + 17); const h = createHash('sha256');
    g.reset(seed); h.update(snap(ctx, 0));
    let steps = 1, won = -1;
    for (let k = 0; k < STEPS; k++) { if (g.snap().winning) { won = steps - 1; break; } const a = g.step(rnd() % 6); h.update(snap(ctx, a)); steps++; }
    if (won < 0 && g.snap().winning) won = steps - 1;
    const key = `${game}/lvl${g.levelIndex()}/seed${seed}`; const val = `${steps}:${won}:${h.digest('hex').slice(0, 16)}`;
    out[key] = val; n++;
    if (prev && prev[key] !== val) { bad++; console.log(`MISMATCH ${key}: ${prev[key]} -> ${val}`); }
  }
}
if (prev) { for (const k of Object.keys(prev)) if (!(k in out)) { bad++; console.log(`MISSING ${k}`); } console.log(bad ? `${bad} mismatches of ${n}` : `golden ok (${n} trajectories)`); process.exit(bad ? 1 : 0); }
writeFileSync(join(HERE, 'golden.json'), JSON.stringify(out, null, 1) + '\n'); console.log(`wrote ${n} golden hashes`);
