#!/usr/bin/env node
// Lockstep gate: bundled engine vs py-vgdl reference, trajectory-exact.
//   VGDL_ORACLE_PY=<python with pygame> VGDL_LAE=<infer-vgdl checkout> node tests/gate_oracle.mjs [corpus[/game]] [--levels a,b] [--steps N] [--seeds s1,s2]
// Same game + level + seed + action sequence -> identical (t, score, ended, won, sprites) at every step.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PY = process.env.VGDL_ORACLE_PY, LAE = process.env.VGDL_LAE;
if (!PY || !LAE) { console.error('set VGDL_ORACLE_PY and VGDL_LAE (see tests/README.md)'); process.exit(2); }
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const target = args.find(a => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--')) || 'infer';
const STEPS = parseInt(opt('steps', '300'), 10);
const SEEDS = opt('seeds', '42,7').split(',').map(Number);
const LEVELS = opt('levels', null);

// oracle actions: UP DOWN LEFT RIGHT NOOP SPACE (get_possible_actions order)
const KEYS = [[273], [274], [276], [275], [], [32]];
function lcg(seed) { let x = seed >>> 0; return () => { x = (x * 1103515245 + 12345) >>> 0; return x >>> 8; }; }

function loadBundle(corpus, game, block) {
  const bundle = execFileSync('node', [join(ROOT, 'tools/bundle_vgdl.mjs'), corpus, game, '--block', String(block), '--render', 'exact', '--out', `/tmp/vgdl_gate_${corpus}_${game}.js`], { encoding: 'utf8' }).trim();
  const held = new Set();
  const ctx = { createCanvas() {}, background() {}, noStroke() {}, fill() {}, rect() {}, keyIsDown: c => held.has(c), console };
  ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(readFileSync(bundle, 'utf8'), ctx, { filename: bundle });
  return ctx;
}
function jsTraj(ctx, level, seed, acts) {
  const g = ctx.__vgdl; g.resetLevel(level, seed);
  const rec = () => ({ ...g.state(), sprites: g.snapshot() });
  const traj = [rec()];
  for (const a of acts) { if (g.state().ended) break; g.tickKeys(KEYS[a]); traj.push(rec()); }
  return traj;
}
function pyTraj(gpath, lpath, seed, acts, block) {
  const out = execFileSync(PY, [join(HERE, 'oracle.py'), gpath, lpath, '--seed', String(seed), '--actions', acts.join(','), '--block', String(block), '--json'],
    { encoding: 'utf8', env: { ...process.env, SDL_VIDEODRIVER: 'dummy', SDL_AUDIODRIVER: 'dummy', VGDL_LAE: LAE }, maxBuffer: 1 << 28 });
  return JSON.parse(out.split('\n').filter(Boolean).pop()).traj;
}
const canon = s => JSON.stringify({ t: s.t, score: s.score, ended: s.ended, won: s.won, sprites: s.sprites });

const [corpus, only] = target.split('/');
const gdir = join(ROOT, 'games', corpus);
const block = corpus === 'infer' ? 50 : 1;
const games = readdirSync(gdir).filter(f => f.endsWith('.txt') && !f.includes('_lvl')).map(f => f.slice(0, -4)).filter(g => !only || g === only);
let pass = 0, total = 0;
for (const game of games) {
  const lvls = readdirSync(gdir).filter(f => f.startsWith(game + '_lvl')).map(f => parseInt(f.match(/_lvl(\d+)/)[1], 10)).sort((a, b) => a - b);
  const useLvls = LEVELS ? LEVELS.split(',').map(Number) : lvls;
  let ctx; try { ctx = loadBundle(corpus, game, block); } catch (e) { console.log(`⚠️  ${game}: bundle failed: ${String(e.message).split('\n')[0]}`); continue; }
  for (const lvl of useLvls) for (const seed of SEEDS) {
    total++;
    const rnd = lcg(seed * 7919 + lvl); const acts = Array.from({ length: STEPS }, () => rnd() % 6);
    let js, py;
    try { js = jsTraj(ctx, lvl, seed, acts); } catch (e) { console.log(`❌ ${game} lvl${lvl} seed${seed}: JS threw ${String(e.stack).split('\n').slice(0, 2).join(' | ')}`); continue; }
    try { py = pyTraj(join(gdir, game + '.txt'), join(gdir, `${game}_lvl${lvl}.txt`), seed, acts, block); } catch (e) { console.log(`⚠️  ${game} lvl${lvl}: oracle failed: ${String(e.stderr || e.message).split('\n').filter(Boolean).pop()}`); continue; }
    const n = Math.min(js.length, py.length); let bad = -1;
    for (let i = 0; i < n; i++) if (canon(js[i]) !== canon(py[i])) { bad = i; break; }
    if (bad < 0 && js.length !== py.length) bad = n;
    if (bad < 0) { pass++; console.log(`✅ ${game} lvl${lvl} seed${seed}: ${js.length} steps exact`); }
    else {
      console.log(`❌ ${game} lvl${lvl} seed${seed}: diverge at step ${bad} (action ${bad > 0 ? acts[bad - 1] : '-'})`);
      const a = js[bad], b = py[bad];
      if (a && b) {
        console.log(`   js: t=${a.t} score=${a.score} ended=${a.ended} won=${a.won} n=${a.sprites.length}`);
        console.log(`   py: t=${b.t} score=${b.score} ended=${b.ended} won=${b.won} n=${b.sprites.length}`);
        const sa = new Set(a.sprites.map(r => JSON.stringify(r))), sb = new Set(b.sprites.map(r => JSON.stringify(r)));
        const onlyJs = [...sa].filter(x => !sb.has(x)).slice(0, 6), onlyPy = [...sb].filter(x => !sa.has(x)).slice(0, 6);
        if (onlyJs.length) console.log('   only js:', onlyJs.join(' '));
        if (onlyPy.length) console.log('   only py:', onlyPy.join(' '));
      } else console.log(`   lengths js=${js.length} py=${py.length}`);
    }
  }
}
console.log(`\n=== ${pass}/${total} game-level-seeds trajectory-exact ===`);
process.exit(pass === total ? 0 : 1);
