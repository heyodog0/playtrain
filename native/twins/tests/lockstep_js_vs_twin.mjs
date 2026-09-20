#!/usr/bin/env node
// T2: the JS bundle (node vm, the family's gate hook) vs the twin (`twin_host snap`), same seeds and actions, every
// field of every snapshot compared as text. T3: the twin's snapshots hashed exactly as the family's golden.mjs does,
// checked against the committed golden.json.
//   node lockstep_js_vs_twin.mjs <family> [game[,game..]] [--steps N] [--seeds s1,s2,s3] [--golden]
// Families: chip8 (hook __chip8; goldens: 6 seeds [42,7,3,11,19,23], 500 steps, key `game/seed<s>`, value
// `steps:won:hash16`), puzzlescript (hook __ps; stops at winning), vgdl (hook __vgdl, levels).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url)), TWINS = join(HERE, '..'), REPO = join(TWINS, '..', '..');
const HOST = join(TWINS, 'build', 'twin_host');
const args = process.argv.slice(2);
const family = args[0];
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const positional = args.slice(1).filter((a, i, arr) => !a.startsWith('--') && !(i > 0 && arr[i - 1].startsWith('--')));
const STEPS = parseInt(opt('steps', '500'), 10);
const SEEDS = opt('seeds', '1,2,3').split(',').map(Number);
const GOLDEN = args.includes('--golden');
const FAM = join(REPO, 'examples', 'games', 'multifile', 'parity', family);
const PREFIX = { chip8: 'chip8_', puzzlescript: 'ps_', vgdl: 'vgdl_' }[family];
const HOOK = { chip8: '__chip8', puzzlescript: '__ps', vgdl: '__vgdl' }[family];
const games = positional.length ? positional.join(',').split(',') : readdirSync(join(FAM, 'games')).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort();

function lcg(seed) { let x = seed >>> 0; return () => { x = (x * 1103515245 + 12345) >>> 0; return x >>> 8; }; }
function loadBundle(file) {
  const ctx = { console, createCanvas() {}, background() {}, noStroke() {}, fill() {}, rect() {}, drawTiles() {}, keyIsDown: () => false };
  ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(readFileSync(file, 'utf8'), ctx, { filename: file }); ctx.setup(); return ctx;
}
const VG_KEYS = [[273], [274], [276], [275], [], [32]];   // sidecar vgdl6 order UP DOWN LEFT RIGHT NOOP SPACE
function jsTraj(ctx, seed, acts, level) {
  const g = ctx[HOOK];
  if (family === 'vgdl') {
    g.resetLevel(level, seed); const snap = () => JSON.stringify({ ...g.state(), sprites: g.snapshot() }); const out = [snap()];
    for (const a of acts) { if (g.state().ended) break; g.tickKeys(VG_KEYS[a]); out.push(snap()); }
    return out;
  }
  g.reset(seed); const out = [JSON.stringify(g.snap())];
  for (const a of acts) { if (family === 'puzzlescript' && g.snap().winning) break; g.step(a); out.push(JSON.stringify(g.snap())); }
  return out;
}
function twinTraj(bundle, seed, acts, level) {
  const extra = level == null ? [] : [String(level)];
  return execFileSync(HOST, [bundle, 'snap', String(seed), acts.join(','), ...extra], { encoding: 'utf8', maxBuffer: 1 << 28 }).trim().split('\n');
}

let pass = 0, total = 0;
if (!GOLDEN) {
  for (const game of games) {
    const bundle = join(FAM, 'dist', PREFIX + game + '.js');
    const nA = JSON.parse(readFileSync(join(FAM, 'dist', PREFIX + game + '.json'), 'utf8')).actions.length;
    const ctx = loadBundle(bundle);
    const levels = family === 'vgdl' ? Array.from({ length: ctx[HOOK].levels() }, (_, i) => i) : [null];
    for (const level of levels) for (const seed of SEEDS) {
      total++; const tag = level == null ? `${game} seed${seed}` : `${game} lvl${level} seed${seed}`;
      const rnd = lcg(seed * 7919 + 17); const acts = Array.from({ length: STEPS }, () => rnd() % nA);
      const js = jsTraj(ctx, seed, acts, level);
      let tw; try { tw = twinTraj(bundle, seed, acts.slice(0, js.length - 1), level); } catch (e) { console.log(`❌ ${tag}: twin_host failed: ${String(e.stderr || e.message).split('\n').filter(Boolean).pop()}`); continue; }
      let bad = -1; const n = Math.min(js.length, tw.length);
      for (let i = 0; i < n; i++) if (js[i] !== tw[i]) { bad = i; break; }
      if (bad < 0 && js.length !== tw.length) bad = n;
      if (bad < 0) { pass++; console.log(`✅ ${tag}: ${js.length} snapshots identical`); }
      else {
        console.log(`❌ ${tag}: diverge at step ${bad} (action ${bad > 0 ? acts[bad - 1] : '-'})`);
        const a = js[bad] || '', b = tw[bad] || ''; let k = 0; while (k < a.length && a[k] === b[k]) k++;
        console.log(`   js:   ...${a.slice(Math.max(0, k - 60), k + 100)}\n   twin: ...${b.slice(Math.max(0, k - 60), k + 100)}`);
      }
    }
  }
  console.log(`${pass}/${total} trajectories identical`); process.exit(pass === total ? 0 : 1);
}

// ---- goldens: the family's golden.mjs recipe over the twin's snapshots ----
const golden = JSON.parse(readFileSync(join(FAM, 'tests', 'golden.json'), 'utf8'));
const GSEEDS = family === 'vgdl' ? [42, 7, 3] : [42, 7, 3, 11, 19, 23];
let bad = 0, n = 0;
for (const game of games) {
  const bundle = join(FAM, 'dist', PREFIX + game + '.js');
  const side = JSON.parse(readFileSync(join(FAM, 'dist', PREFIX + game + '.json'), 'utf8')); const nA = side.actions.length;
  if (family === 'vgdl') {
    // golden.mjs parses --steps as parseInt(args[-1 + 1]) = NaN under --write/--check, so its loop never runs and the
    // committed hashes cover the reset snapshot only (steps == 1). Reproduced as committed; the family bug is logged in
    // native/twins/PROGRESS.md. --steps N here hashes N steps the way golden.mjs meant to.
    const GSTEPS = opt('steps', null) == null ? 0 : STEPS;
    for (let lvl = 0; lvl < side.levels; lvl++) for (const seed of GSEEDS) {
      const rnd = lcg(seed * 7919 + lvl); const acts = Array.from({ length: GSTEPS }, () => rnd() % 6);
      const tw = twinTraj(bundle, seed, acts, lvl); const h = createHash('sha256'); let steps = 0;
      for (let k = 0; k < tw.length; k++) { h.update(tw[k]); steps++; if (JSON.parse(tw[k]).ended) break; }
      const key = `${side.corpus}/${game}/lvl${lvl}/seed${seed}`, val = `${steps}:${h.digest('hex').slice(0, 16)}`;
      n++; if (golden[key] !== val) { bad++; console.log(`MISMATCH ${key}: golden ${golden[key]} twin ${val}`); }
    }
    continue;
  }
  for (const seed of GSEEDS) {
    const rnd = lcg(seed * 7919 + 17); const acts = Array.from({ length: STEPS }, () => rnd() % nA);
    let key, val;
    if (family === 'chip8') {
      const tw = twinTraj(bundle, seed, acts); const h = createHash('sha256'); let term = -1;
      for (let i = 0; i < tw.length; i++) { h.update(tw[i]); if (i > 0 && term < 0 && JSON.parse(tw[i]).terminated) term = JSON.parse(tw[i]).t; }
      key = `${game}/seed${seed}`; val = `${STEPS + 1}:${term}:${h.digest('hex').slice(0, 16)}`;
    } else if (family === 'puzzlescript') {
      // golden.mjs: reset snap, then steps until winning (checked BEFORE stepping), hash of a reduced snapshot
      const tw = twinTraj(bundle, seed, acts); const h = createHash('sha256'); let steps = 1, won = -1;
      const reduce = (s, agains) => { const o = JSON.parse(s); return JSON.stringify({ level: o.level, objects: createHash('sha1').update(Buffer.from(Int32Array.from(o.objects).buffer)).digest('hex'), curlevel: o.curlevel, winning: o.winning, againing: o.againing, textMode: o.textMode, messagetext: o.messagetext, backups: o.backups, movements_zero: o.movements_zero, rng_i: o.rng.i, rng_j: o.rng.j, rng_s: createHash('sha1').update(Buffer.from(Uint8Array.from(o.rng.s))).digest('hex'), width: o.width, height: o.height, agains }); };
      h.update(reduce(tw[0], 0));
      for (let k = 1; k < tw.length; k++) { const prev = JSON.parse(tw[k - 1]); if (prev.winning) { won = steps - 1; break; } h.update(reduce(tw[k], JSON.parse(tw[k]).agains)); steps++; }
      if (won < 0 && JSON.parse(tw[tw.length - 1]).winning) won = steps - 1;
      const lvl = JSON.parse(tw[0]).curlevel; key = `${game}/lvl${lvl}/seed${seed}`; val = `${steps}:${won}:${h.digest('hex').slice(0, 16)}`;
    } else { console.log('goldens for ' + family + ' not implemented here'); process.exit(2); }
    n++;
    if (golden[key] !== val) { bad++; console.log(`MISMATCH ${key}: golden ${golden[key]} twin ${val}`); }
  }
}
console.log(bad ? `${bad} mismatches of ${n}` : `golden ok (${n} trajectories)`); process.exit(bad ? 1 : 0);
