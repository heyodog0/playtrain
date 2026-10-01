#!/usr/bin/env node
// Lockstep gate for the 'rcrl' profile: bundled engine vs tomov/RC_RL's Python 2 py-vgdl,
// run inside the `rcrl-oracle` container (see tests/oracle_rcrl.py for the image recipe).
//   VGDL_RCRL=<RC_RL checkout> node tests/gate_oracle_rcrl.mjs [game] [--levels a,b] [--steps N] [--seeds s1,s2]
// Actions index RC_RL's VGDLEnv list: 0 NOOP, RIGHT, LEFT, UP, DOWN, SPACE.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..');
const RCRL = process.env.VGDL_RCRL;
if (!RCRL) { console.error('set VGDL_RCRL to a tomov/RC_RL (branch fmri) checkout; docker image rcrl-oracle must exist'); process.exit(2); }
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const only = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const STEPS = parseInt(opt('steps', '200'), 10);
const SEEDS = opt('seeds', '42,7').split(',').map(Number);
const LEVELS = opt('levels', null);
const KEYS = [[], [275], [276], [273], [274], [32]];
function lcg(seed) { let x = seed >>> 0; return () => { x = (x * 1103515245 + 12345) >>> 0; return x >>> 8; }; }
const gdir = join(ROOT, 'games', 'vgfmri_rcrl');

function loadBundle(game) {
  const bundle = execFileSync('node', [join(ROOT, 'tools/bundle_vgdl.mjs'), 'vgfmri_rcrl', game, '--render', 'exact', '--out', `/tmp/vgdl_gate_rcrl_${game}.js`], { encoding: 'utf8' }).trim();
  const held = new Set();
  const ctx = { createCanvas() {}, background() {}, noStroke() {}, fill() {}, rect() {}, drawTiles() {}, keyIsDown: c => held.has(c), console };
  ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(readFileSync(bundle, 'utf8'), ctx, { filename: bundle });
  return ctx;
}
function pyRun(game, lvl, seed, acts) {
  const out = execFileSync('docker', ['run', '--rm', '--platform', 'linux/amd64', '-v', `${RCRL}:/work`, '-v', `${gdir}:/games:ro`, '-v', `${HERE}:/tests:ro`, 'rcrl-oracle',
    'python', '/tests/oracle_rcrl.py', `/games/${game}.txt`, `/games/${game}_lvl${lvl}.txt`, '--seed', String(seed), '--actions', acts.join(','), '--json'],
    { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out.split('\n').filter(l => l.startsWith('{')).pop());
}
function jsTraj(ctx, groups, lvl, seed, acts) {
  const g = ctx.__vgdl; g.setGroupOrder(groups); g.resetLevel(lvl, seed);
  const rec = () => ({ ...g.state(), sprites: g.snapshot() });
  const traj = [rec()];
  for (const a of acts) { g.tickKeys(KEYS[a]); traj.push(rec()); if (g.state().ended) break; }
  return traj;
}
const canon = s => JSON.stringify({ t: s.t, score: Math.round(s.score * 1e6) / 1e6, ended: s.ended, won: s.won, sprites: s.sprites });

const games = readdirSync(gdir).filter(f => f.endsWith('.txt') && !f.includes('_lvl')).map(f => f.slice(0, -4)).filter(g => !only || g === only);
let pass = 0, total = 0;
for (const game of games) {
  const lvls = readdirSync(gdir).filter(f => f.startsWith(game + '_lvl')).map(f => parseInt(f.match(/_lvl(\d+)/)[1], 10)).sort((a, b) => a - b);
  const useLvls = LEVELS ? LEVELS.split(',').map(Number) : lvls;
  let ctx; try { ctx = loadBundle(game); } catch (e) { console.log(`⚠️  ${game}: bundle failed: ${String(e.message).split('\n')[0]}`); continue; }
  for (const lvl of useLvls) for (const seed of SEEDS) {
    total++;
    const rnd = lcg(seed * 7919 + lvl); const acts = Array.from({ length: STEPS }, () => rnd() % 6);
    let py; try { py = pyRun(game, lvl, seed, acts); } catch (e) { console.log(`⚠️  ${game} lvl${lvl}: oracle failed: ${String(e.stderr || e.message).split('\n').filter(Boolean).slice(-2).join(' | ')}`); continue; }
    const gfile = join(gdir, game + '.groups.json');
    if (existsSync(gfile) && JSON.stringify(JSON.parse(readFileSync(gfile, 'utf8'))) !== JSON.stringify(py.groups)) console.log(`⚠️  ${game} lvl${lvl}: oracle group order differs from ${game}.groups.json`);
    let js; try { js = jsTraj(ctx, py.groups, lvl, seed, acts); } catch (e) { console.log(`❌ ${game} lvl${lvl} seed${seed}: JS threw ${String(e.stack).split('\n').slice(0, 2).join(' | ')}`); continue; }
    const pt = py.traj, n = Math.min(js.length, pt.length); let bad = -1;
    for (let i = 0; i < n; i++) if (canon(js[i]) !== canon(pt[i])) { bad = i; break; }
    if (bad < 0 && js.length !== pt.length) bad = n;
    if (bad < 0) { pass++; console.log(`✅ ${game} lvl${lvl} seed${seed}: ${js.length} steps exact`); }
    else {
      console.log(`❌ ${game} lvl${lvl} seed${seed}: diverge at step ${bad} (action ${bad > 0 ? acts[bad - 1] : '-'})`);
      const a = js[bad], b = pt[bad];
      if (a && b) {
        console.log(`   js: t=${a.t} score=${a.score} ended=${a.ended} won=${a.won} n=${a.sprites.length}`);
        console.log(`   py: t=${b.t} score=${b.score} ended=${b.ended} won=${b.won} n=${b.sprites.length}`);
        const sa = new Set(a.sprites.map(r => JSON.stringify(r))), sb = new Set(b.sprites.map(r => JSON.stringify(r)));
        const oj = [...sa].filter(x => !sb.has(x)).slice(0, 6), op = [...sb].filter(x => !sa.has(x)).slice(0, 6);
        if (oj.length) console.log('   only js:', oj.join(' '));
        if (op.length) console.log('   only py:', op.join(' '));
      } else console.log(`   lengths js=${js.length} py=${pt.length}`);
    }
  }
}
console.log(`\n=== ${pass}/${total} game-level-seeds trajectory-exact (rcrl) ===`);
process.exit(pass === total ? 0 : 1);
