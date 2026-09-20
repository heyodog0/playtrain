#!/usr/bin/env node
// U07 gate for the precompiled-cache bundles (tools/precompile_caches.mjs --assemble <dir>):
//   (a) lockstep: precompiled bundle vs dist bundle in node, every corpus game x seeds x 300 steps, every snapshot
//       field text-equal (the family's __ps.snap shape), and ZERO `new Function` calls in the precompiled bundle after
//       load (the two load-time constants, the shims' scope probe and the engine's FALSE_FUNCTION, are static engine
//       text, not generated matchers, and are excluded by construction);
//   (b) goldens: the family's golden.mjs recipe (6 seeds, 300 steps, stop at winning) over the precompiled bundles
//       against tests/golden.json.
//   node ps_precompiled_gate.mjs <precompiled_dir> [--seeds 1,2,3] [--steps 300] [--fresh-seeds 101,202]
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const HERE = dirname(fileURLToPath(import.meta.url)), REPO = join(HERE, '..', '..', '..');
const FAM = join(REPO, 'examples', 'games', 'multifile', 'parity', 'puzzlescript');
const args = process.argv.slice(2); const DIR = args[0];
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const SEEDS = opt('seeds', '1,2,3').split(',').map(Number), STEPS = parseInt(opt('steps', '300'), 10);
const FRESH = opt('fresh-seeds', '101,202').split(',').map(Number);   // seeds the precompile warm-up never played
const games = readdirSync(join(FAM, 'games')).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort();
function lcg(seed) { let x = seed >>> 0; return () => { x = (x * 1103515245 + 12345) >>> 0; return x >>> 8; }; }
const sha1 = (b) => createHash('sha1').update(b).digest('hex');
function load(file, counter) {
  const ctx = { console, createCanvas() {}, background() {}, noStroke() {}, fill() {}, rect() {}, drawTiles() {}, keyIsDown: () => false };
  ctx.globalThis = ctx; vm.createContext(ctx);
  if (counter) { const F = vm.runInContext('Function', ctx); const W = function (...a) { counter.n++; return F(...a); }; W.prototype = F.prototype; ctx.Function = W; }
  vm.runInContext(readFileSync(file, 'utf8'), ctx, { filename: file }); if (counter) counter.n = 0; ctx.setup(); return ctx;
}
const snapText = (g) => JSON.stringify(g.snap());
function goldenSnap(ctx, agains) {
  const s = ctx.__ps.snap();
  return JSON.stringify({ level: s.level, objects: sha1(Buffer.from(Int32Array.from(s.objects).buffer)), curlevel: s.curlevel, winning: s.winning, againing: s.againing,
    textMode: s.textMode, messagetext: s.messagetext, backups: s.backups, movements_zero: s.movements_zero, rng_i: s.rng.i, rng_j: s.rng.j,
    rng_s: sha1(Buffer.from(Uint8Array.from(s.rng.s))), width: s.width, height: s.height, agains });
}
let pass = 0, total = 0, newFn = 0;
for (const game of games) {
  const counter = { n: 0 };
  const pre = load(join(DIR, `ps_${game}.js`), counter), ref = load(join(FAM, 'dist', `ps_${game}.js`), null);
  const gp = pre.__ps, gr = ref.__ps;
  for (const seed of [...SEEDS, ...FRESH]) {
    total++; const rnd = lcg(seed * 7919 + 17);
    gp.reset(seed); gr.reset(seed); let bad = snapText(gp) !== snapText(gr) ? 0 : -1, n = 1;
    for (let k = 0; k < STEPS && bad < 0; k++) { if (gr.snap().winning) break; const a = rnd() % 6; gp.step(a); gr.step(a); n++; if (snapText(gp) !== snapText(gr)) bad = n; }
    if (bad < 0) pass++; else console.log(`❌ ${game} seed${seed}: diverge at snapshot ${bad}`);
  }
  if (counter.n) console.log(`⚠️  ${game}: ${counter.n} new Function call(s) in the precompiled bundle`);
  newFn += counter.n;
}
console.log(`${pass}/${total} trajectories identical (precompiled vs dist), ${newFn} new Function calls`);
// goldens
const golden = JSON.parse(readFileSync(join(FAM, 'tests', 'golden.json'), 'utf8')); let gbad = 0, gn = 0;
for (const game of games) {
  const ctx = load(join(DIR, `ps_${game}.js`), null); const g = ctx.__ps;
  for (const seed of [42, 7, 3, 11, 19, 23]) {
    const rnd = lcg(seed * 7919 + 17); const h = createHash('sha256');
    g.reset(seed); h.update(goldenSnap(ctx, 0)); let steps = 1, won = -1;
    for (let k = 0; k < 300; k++) { if (g.snap().winning) { won = steps - 1; break; } const a = g.step(rnd() % 6); h.update(goldenSnap(ctx, a)); steps++; }
    if (won < 0 && g.snap().winning) won = steps - 1;
    const key = `${game}/lvl${g.levelIndex()}/seed${seed}`, val = `${steps}:${won}:${h.digest('hex').slice(0, 16)}`;
    gn++; if (golden[key] !== val) { gbad++; console.log(`MISMATCH ${key}: golden ${golden[key]} precompiled ${val}`); }
  }
}
console.log(gbad ? `${gbad} golden mismatches of ${gn}` : `golden ok (${gn} trajectories)`);
process.exit(pass === total && newFn === 0 && gbad === 0 ? 0 : 1);
