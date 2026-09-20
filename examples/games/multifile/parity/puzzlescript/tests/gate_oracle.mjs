#!/usr/bin/env node
// Lockstep gate: the bundle (dist/ps_<game>.js in a node vm) vs the UNMODIFIED checkout (tests/oracle.mjs, PS_REF),
// full state every step.
//   PS_REF=<checkout> node tests/gate_oracle.mjs [game[,game..]] [--steps N] [--seeds s1,s2,s3]
// Same game text, playable level (seed % n), seed string and action sequence -> identical convertLevelToString(),
// sha1(level.objects), curlevel, winning, againing, textMode, messagetext, backups.length, movements-zero and RC4
// (i, j, sha1(s)) after reset and after every step. Stepping stops at winning on both sides.
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { makeContext, loadEngine, snapshot, finish, compileGame, stepInput, ENGINE_FILES } from './oracle.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..');
const REF = process.env.PS_REF;
if (!REF) { console.error('set PS_REF'); process.exit(2); }
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const STEPS = parseInt(opt('steps', '300'), 10);
const SEEDS = opt('seeds', '1,2,3').split(',').map(Number);
const games = positional.length ? positional.join(',').split(',') : readdirSync(join(ROOT, 'games')).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort();
const sha1 = (b) => createHash('sha1').update(b).digest('hex');
function lcg(seed) { let x = seed >>> 0; return () => { x = (x * 1103515245 + 12345) >>> 0; return x >>> 8; }; }
const FIELDS = ['level', 'objects_sha1', 'curlevel', 'winning', 'againing', 'textMode', 'messagetext', 'backups', 'movements_zero', 'rng_i', 'rng_j', 'rng_s_sha1', 'width', 'height', 'agains'];
const canon = (s) => ({ level: s.level, objects_sha1: s.objects_sha1, curlevel: s.curlevel, winning: s.winning, againing: s.againing, textMode: s.textMode, messagetext: s.messagetext,
  backups: s.backups, movements_zero: s.movements_zero, rng_i: s.rng.i, rng_j: s.rng.j, rng_s_sha1: s.rng_s_sha1, width: s.width, height: s.height, agains: s.agains });

function loadBundle(game) {
  const ctx = { console, createCanvas() {}, background() {}, noStroke() {}, fill() {}, rect() {}, drawTiles() {}, keyIsDown: () => false };
  ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(readFileSync(join(ROOT, 'dist', `ps_${game}.js`), 'utf8'), ctx, { filename: `ps_${game}.js` });
  ctx.setup();
  return ctx;
}
function bundleSnap(ctx, agains) {
  const s = ctx.__ps.snap();
  s.objects_sha1 = sha1(Buffer.from(Int32Array.from(s.objects).buffer)); s.rng_s_sha1 = sha1(Buffer.from(Uint8Array.from(s.rng.s)));
  delete s.objects; delete s.rng.s; s.agains = agains;
  return canon(s);
}
function bundleTraj(ctx, seed, acts) {
  ctx.__ps.reset(seed);
  const traj = [bundleSnap(ctx, 0)];
  for (const a of acts) { if (ctx.__ps.snap().winning) break; const n = ctx.__ps.step(a); traj.push(bundleSnap(ctx, n)); }
  return { traj, level: ctx.__ps.levelIndex() };
}
function refTraj(text, levelIndex, seed, acts) {
  const ctx = makeContext(); loadEngine(ctx, join(REF, 'src'), ENGINE_FILES);
  compileGame(ctx, text, levelIndex, String(seed));
  const traj = [canon(Object.assign(finish(snapshot(ctx)), { agains: 0 }))];
  for (const a of acts) {
    if (traj[traj.length - 1].winning) break;
    const n = stepInput(ctx, a);
    traj.push(canon(Object.assign(finish(snapshot(ctx)), { agains: n })));
  }
  return traj;
}

let pass = 0, total = 0;
for (const game of games) {
  const text = readFileSync(join(ROOT, 'games', game + '.txt'), 'utf8');
  const def = JSON.parse(readFileSync(join(ROOT, 'games', game + '.json'), 'utf8'));
  let ctx; try { ctx = loadBundle(game); } catch (e) { console.log(`❌ ${game}: bundle failed: ${String(e.stack).split('\n').slice(0, 2).join(' | ')}`); total += SEEDS.length; continue; }
  for (const seed of SEEDS) {
    total++;
    const rnd = lcg(seed * 7919 + 17); const acts = Array.from({ length: STEPS }, () => rnd() % 6);
    const expectedLevel = def.playable_levels[seed % def.playable_levels.length];
    let b, r;
    try { b = bundleTraj(ctx, seed, acts); } catch (e) { console.log(`❌ ${game} seed${seed}: bundle threw ${String(e.stack).split('\n').slice(0, 2).join(' | ')}`); continue; }
    if (b.level !== expectedLevel) { console.log(`❌ ${game} seed${seed}: bundle picked level ${b.level}, def says ${expectedLevel}`); continue; }
    try { r = refTraj(text, expectedLevel, seed, acts); } catch (e) { console.log(`⚠️  ${game} seed${seed}: reference threw ${String(e.stack).split('\n').slice(0, 2).join(' | ')}`); continue; }
    const n = Math.min(b.traj.length, r.length); let bad = -1, badField = null;
    outer: for (let i = 0; i < n; i++) for (const f of FIELDS) if (JSON.stringify(b.traj[i][f]) !== JSON.stringify(r[i][f])) { bad = i; badField = f; break outer; }
    if (bad < 0 && b.traj.length !== r.length) { bad = n; badField = 'length'; }
    if (bad < 0) { pass++; console.log(`✅ ${game} lvl${expectedLevel} seed${seed}: ${b.traj.length} states exact${r[r.length - 1].winning ? ` (won at ${r.length - 1})` : ''}`); }
    else {
      console.log(`❌ ${game} lvl${expectedLevel} seed${seed}: diverge at step ${bad} field ${badField} (action ${bad > 0 ? acts[bad - 1] : '-'})`);
      if (badField !== 'length') console.log(`   reference: ${JSON.stringify(r[bad][badField]).slice(0, 300)}\n   bundle:    ${JSON.stringify(b.traj[bad][badField]).slice(0, 300)}`);
      else console.log(`   lengths bundle=${b.traj.length} reference=${r.length}`);
    }
  }
}
console.log(`${pass}/${total} trajectories exact`);
process.exit(pass === total ? 0 : 1);
