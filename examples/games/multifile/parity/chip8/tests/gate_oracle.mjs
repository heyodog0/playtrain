#!/usr/bin/env node
// Lockstep gate: JS CPU + env vs Octax, full state every step.
//   CHIP8_ORACLE_PY=<venv python> CHIP8_OCTAX=<checkout> node tests/gate_oracle.mjs [game[,game..]] [--steps N] [--seeds s1,s2] [--levels ...]
// Same ROM + seed + action sequence -> identical pc, I, V[0..15], sp, stack[0..15], delay, sound,
// keypad[0..15], display sha1, rng, score, reward, terminated, truncated at every step, past
// terminated included (Octax keeps stepping; the oracle runs with --no-stop).
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PY = process.env.CHIP8_ORACLE_PY, OCTAX = process.env.CHIP8_OCTAX;
if (!PY || !OCTAX) { console.error('set CHIP8_ORACLE_PY and CHIP8_OCTAX'); process.exit(2); }
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
const STEPS = parseInt(opt('steps', '500'), 10);
const SEEDS = opt('seeds', '1,2,3').split(',').map(Number);
const games = positional.length ? positional.join(',').split(',') : readdirSync(join(ROOT, 'games')).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort();

// The bundle's recipe (conftest.SOURCES): shared threefry core, then src/*.js by name.
const SOURCES = [join(ROOT, '..', '..', 'common', 'threefry2x32.js'), ...readdirSync(join(ROOT, 'src')).filter(f => f.endsWith('.js')).sort().map(f => join(ROOT, 'src', f))];
const ctx = { console }; ctx.globalThis = ctx; vm.createContext(ctx);
for (const p of SOURCES) vm.runInContext(readFileSync(p, 'utf8'), ctx, { filename: p });

function lcg(seed) { let x = seed >>> 0; return () => { x = (x * 1103515245 + 12345) >>> 0; return x >>> 8; }; }
const sha1 = (buf) => createHash('sha1').update(buf).digest('hex');
function packDisplay(cpu) { const out = Buffer.alloc(256); for (let i = 0; i < 2048; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | cpu.display[i + j]; out[i >> 3] = b; } return out; }
function snap(env) {
  const c = env.cpu;
  return { t: env.time, pc: c.pc, I: c.I, V: Array.from(c.V), sp: c.sp, stack: Array.from(c.stack), delay: c.delay, sound: c.sound,
    keypad: Array.from(c.keypad), display_sha1: sha1(packDisplay(c)), rng: Array.from(c.rng), score: env.score, reward: env.reward,
    terminated: env.terminated, truncated: env.truncated };
}
const FIELDS = ['t', 'pc', 'I', 'V', 'sp', 'stack', 'delay', 'sound', 'keypad', 'display_sha1', 'rng', 'score', 'reward', 'terminated', 'truncated'];

function jsTraj(def, rom, seed, acts) {
  const env = ctx.c8EnvCreate(def, rom);
  ctx.c8EnvReset(env, seed);
  const traj = [snap(env)];
  for (const a of acts) { ctx.c8EnvStep(env, a); traj.push(snap(env)); }
  return traj;
}
function pyTraj(romPath, game, seed, acts) {
  const out = execFileSync(PY, [join(HERE, 'oracle.py'), romPath, '--game', game, '--seed', String(seed), '--actions', acts.join(','), '--no-stop', '--json'],
    { encoding: 'utf8', env: { ...process.env, CHIP8_OCTAX: OCTAX, PYTHONWARNINGS: 'ignore' }, maxBuffer: 1 << 28 });
  return JSON.parse(out.split('\n').filter(Boolean).pop());
}

let pass = 0, total = 0;
for (const game of games) {
  const def = JSON.parse(readFileSync(join(ROOT, 'games', game + '.json'), 'utf8'));
  const romPath = join(ROOT, 'roms', def.rom);
  const rom = new Uint8Array(readFileSync(romPath));
  if (sha1(Buffer.from(rom)) !== def.sha1) { console.log(`❌ ${game}: ROM sha1 ${sha1(Buffer.from(rom))} != games/${game}.json ${def.sha1}`); total++; continue; }
  const envId = def.env_id || game;
  for (const seed of SEEDS) {
    total++;
    const rnd = lcg(seed * 7919 + 17); const acts = Array.from({ length: STEPS }, () => rnd() % (def.action_set.length + 1));
    let js, py;
    try { js = jsTraj(def, rom, seed, acts); } catch (e) { console.log(`❌ ${game} seed${seed}: JS threw ${String(e.stack).split('\n').slice(0, 2).join(' | ')}`); continue; }
    try { py = pyTraj(romPath, envId, seed, acts); } catch (e) { console.log(`⚠️  ${game} seed${seed}: oracle failed: ${String(e.stderr || e.message).split('\n').filter(Boolean).slice(-2).join(' | ')}`); continue; }
    const c = py.constants;
    if (c.action_set.join() !== def.action_set.join() || c.disable_delay !== !!def.disable_delay || c.startup_instructions !== (def.startup_instructions | 0) || c.custom_startup !== !!def.custom_startup) {
      console.log(`❌ ${game}: games/${game}.json disagrees with the module: oracle action_set=${c.action_set} disable_delay=${c.disable_delay} startup=${c.startup_instructions} custom=${c.custom_startup}`); continue;
    }
    const pt = py.traj, n = Math.min(js.length, pt.length);
    let bad = -1, badField = null;
    outer: for (let i = 0; i < n; i++) for (const f of FIELDS) if (JSON.stringify(js[i][f]) !== JSON.stringify(pt[i][f])) { bad = i; badField = f; break outer; }
    if (bad < 0 && js.length !== pt.length) { bad = n; badField = 'length'; }
    if (bad < 0) { pass++; console.log(`✅ ${game} seed${seed}: ${js.length} states exact (terminated at ${pt.findIndex(r => r.terminated)})`); }
    else {
      console.log(`❌ ${game} seed${seed}: diverge at step ${bad} field ${badField} (action ${bad > 0 ? acts[bad - 1] : '-'})`);
      if (badField !== 'length') console.log(`   octax: ${JSON.stringify(pt[bad][badField])}\n   js:    ${JSON.stringify(js[bad][badField])}`);
      else console.log(`   lengths js=${js.length} octax=${pt.length}`);
      if (bad > 0 && badField !== 'length') { const p = bad - 1; console.log(`   previous step ${p}: pc ${pt[p].pc} I ${pt[p].I} V ${JSON.stringify(pt[p].V)} (octax) / pc ${js[p].pc} I ${js[p].I} V ${JSON.stringify(js[p].V)} (js)`); }
    }
  }
}
console.log(`${pass}/${total} trajectories exact`);
process.exit(pass === total ? 0 : 1);
