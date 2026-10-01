#!/usr/bin/env node
// Interpreter vs compiled tick, JS against JS, over long random runs on every game in the manifest.
// Wider coverage than the goldens (more seeds, more steps); the two must agree on every step.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const STEPS = parseInt(process.argv[2] || '600', 10), SEEDS = [1, 2, 3, 4, 5, 6];
const KEYS = [[], [275], [276], [273], [274], [32]];
function load(file) { const held = new Set(); const ctx = { createCanvas() {}, background() {}, noStroke() {}, fill() {}, rect() {}, drawTiles() {}, keyIsDown: c => held.has(c), console }; ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(readFileSync(file, 'utf8'), ctx); return ctx; }
let bad = 0, n = 0;
for (const [corpus, c] of Object.entries(manifest.corpora)) for (const game of c.games) {
  const a = execFileSync('node', [join(ROOT, 'tools/bundle_vgdl.mjs'), corpus, game, '--render', 'exact', '--no-compile', '--out', `/tmp/cmp_i_${game}.js`], { encoding: 'utf8' }).trim();
  const b = execFileSync('node', [join(ROOT, 'tools/bundle_vgdl.mjs'), corpus, game, '--render', 'exact', '--out', `/tmp/cmp_c_${game}.js`], { encoding: 'utf8' }).trim();
  const A = load(a), B = load(b); A.setup(); B.setup();
  for (let lvl = 0; lvl < A.__vgdl.levels(); lvl++) for (const seed of SEEDS) {
    n++; A.__vgdl.resetLevel(lvl, seed); B.__vgdl.resetLevel(lvl, seed);
    let x = (seed * 2654435761 + lvl * 97) >>> 0; let ok = true;
    for (let s = 0; s < STEPS; s++) {
      x = (x * 1103515245 + 12345) >>> 0; const k = KEYS[(x >>> 16) % 6];
      A.__vgdl.tickKeys(k); B.__vgdl.tickKeys(k);
      const sa = JSON.stringify(A.__vgdl.state()) + JSON.stringify(A.__vgdl.snapshot()), sb = JSON.stringify(B.__vgdl.state()) + JSON.stringify(B.__vgdl.snapshot());
      if (sa !== sb) { console.log(`DIFF ${game} lvl${lvl} seed${seed} step ${s + 1}`); ok = false; break; }
      if (A.__vgdl.state().ended) break;
    }
    if (!ok) bad++;
  }
}
console.log(bad ? `${bad}/${n} runs differ` : `interpreter == compiled on ${n} runs x ${STEPS} steps`);
process.exit(bad ? 1 : 0);
