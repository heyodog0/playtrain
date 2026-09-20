#!/usr/bin/env node
// U12 gate: for every bundle of a family, the .wasm game (native/twins/build/wasm, through PlayTrain's own node
// runtime: game-env.mjs + the wasm rasterizer) produces the same reference_trace.mjs output as the JS bundle and as
// the native twin (twin_host trace), byte for byte, obs hashes included. Seeds 1 and 42, 300 steps.
//   node wasm_trace_gate.mjs <family> [--wasm-dir <dir>] [--steps N]
import { readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url)), TWINS = join(HERE, '..'), REPO = join(TWINS, '..', '..');
const args = process.argv.slice(2); const family = args[0];
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const WASM = opt('wasm-dir', join(TWINS, 'build', 'wasm')), STEPS = opt('steps', '300');
const DIST = join(REPO, 'examples', 'games', 'multifile', 'parity', family, 'dist');
const HOST = join(TWINS, 'build', 'twin_host');
const games = readdirSync(DIST).filter(f => f.endsWith('.js')).map(f => f.slice(0, -3)).sort();
const env = { ...process.env }; delete env.PLAYTRAIN_ACTION_SPACE;
const ref = (dir, game, seed) => execFileSync('node', [join(REPO, 'native', 'reference_trace.mjs'), game, String(seed), STEPS], { cwd: join(REPO, 'native'), encoding: 'utf8', env: { ...env, PLAYTRAIN_GAMES_DIR: dir }, maxBuffer: 1 << 26 });
let pass = 0, total = 0, missing = 0;
for (const game of games) {
  if (!existsSync(join(WASM, `${game}.wasm`))) { missing++; console.log(`MISSING ${game}.wasm`); continue; }
  for (const seed of [1, 42]) {
    total++;
    let w, j, t;
    try { w = ref(WASM, game, seed); j = ref(DIST, game, seed); t = execFileSync(HOST, [join(DIST, `${game}.js`), 'trace', String(seed), STEPS], { encoding: 'utf8', maxBuffer: 1 << 26 }); }
    catch (e) { console.log(`❌ ${game} seed${seed}: ${String(e.stderr || e.message).split('\n').filter(Boolean).slice(-1)[0]}`); continue; }
    if (w === j && w === t) { pass++; console.log(`✅ ${game} seed${seed}: wasm == js == native (${w.split('\n').length - 1} lines)`); }
    else { const a = w.split('\n'), b = (w === j ? t : j).split('\n'); let k = 0; while (k < a.length && a[k] === b[k]) k++; console.log(`❌ ${game} seed${seed}: wasm ${w === j ? '==' : '!='} js, wasm ${w === t ? '==' : '!='} native; first difference line ${k}:\n   wasm: ${a[k]}\n   other: ${b[k]}`); }
  }
}
console.log(`${pass}/${total} traces identical (wasm == js == native)${missing ? `, ${missing} wasm games missing` : ''}`);
process.exit(pass === total && !missing ? 0 : 1);
