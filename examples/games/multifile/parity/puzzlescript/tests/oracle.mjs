#!/usr/bin/env node
// PuzzleScript reference oracle: the UNMODIFIED checkout (PS_REF) under node, driven the way the
// reference's own test runner drives it (src/tests/run_tests_node.js + testingFrameWork.js):
//   PS_REF=<checkout at the pin> node tests/oracle.mjs --game games/microban.txt --level 0 --seed 1 --actions 0,1,2,3,4,5 --json
//   PS_REF=... node tests/oracle.mjs --game games/microban.txt --info          # levels, playable levels, metadata
//   PS_REF=... node tests/oracle.mjs --selftest                                 # the reference's 770 tests on the checkout
// Actions: 0 up, 1 left, 2 down, 3 right, 4 action (processInput's dir codes), 5 NOOP (nothing). After every input
// the `again` loop runs to completion, as in testingFrameWork.runTest. Stepping stops at `winning` unless --no-stop.
// State per step: convertLevelToString() (the reference's own serialiser), sha1(level.objects), curlevel, winning,
// againing, textMode, messagetext, backups.length, movements all zero, RandomGen RC4 {i, j, sha1(s)}.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import vm from 'node:vm';

const REF = process.env.PS_REF;
if (!REF) { console.error('set PS_REF to the PuzzleScript checkout at the pinned commit'); process.exit(2); }
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const sha1 = (b) => createHash('sha1').update(b).digest('hex');

// The load order of src/tests/run_tests_node.js (the reference's own runner).
export const ENGINE_FILES = ['js/storagewrapper.js', 'js/bitvec.js', 'js/level.js', 'js/languageConstants.js', 'js/globalVariables.js', 'js/debug.js',
  'js/font.js', 'js/rng.js', 'js/riffwave.js', 'js/sfxr.js', 'js/codemirror/stringstream.js', 'js/colorhelpers.js', 'js/colors.js', 'js/engine.js',
  'js/parser.js', 'js/compiler.js', 'js/soundbar.js'];

// The browser shims run_tests_node.js installs, reproduced here (it runs the tests on import, so it cannot be imported).
export function makeContext() {
  const _storage = {};
  const ctx = {
    console,
    localStorage: { getItem(k) { return Object.prototype.hasOwnProperty.call(_storage, k) ? _storage[k] : null; }, setItem(k, v) { _storage[k] = String(v); }, removeItem(k) { delete _storage[k]; } },
    document: { URL: 'test://', body: { classList: { contains() { return false; } }, addEventListener() {}, removeEventListener() {} },
      createElement() { return { style: {}, innerHTML: '', textContent: '', getContext() { return null; } }; }, getElementById() { return null; } },
    lastDownTarget: null, canvas: null,
    canvasResize() {}, redraw() {}, forceRegenImages: false, consolePrintFromRule() {}, consolePrint() {}, console_print_raw() {}, consoleError() {},
    consoleCacheDump() {}, addToDebugTimeline() {}, killAudioButton() {}, showAudioButton() {}, regenSpriteImages() {}, jumpToLine() {}, printLevel() {}, playSound() {},
    levelString: '', inputString: '', outputString: '', editor: { getValue() { return ctx.levelString; } },
    PuzzleScriptTestAssertions: { push() {}, equal() {} }, UnitTestingThrow(e) { throw e; },
  };
  ctx.input = ctx.document.createElement('TEXTAREA');
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  return ctx;
}

export function loadEngine(ctx, root, files) {
  let code = '';
  for (const f of files) code += `\n// ---- ${f} ----\n` + readFileSync(join(root, f), 'utf8') + '\n';
  vm.runInContext(code, ctx, { filename: 'puzzlescript_engine.js' });
  // debug.js's stripHTMLTags needs a DOM; the runner overrides it the same way.
  vm.runInContext(`stripHTMLTags = function(s) { return s.replace(/<\\/?[a-zA-Z][^>]*>/g, '').trim(); };`, ctx);
}

export function snapshot(ctx) {
  return vm.runInContext(`(function () {
    const lvl = convertLevelToString();
    let mz = true; if (level.movements) for (let i = 0; i < level.movements.length; i++) if (level.movements[i]) { mz = false; break; }
    return { level: lvl, objects_sha1: null, objects: Array.from(level.objects), curlevel, winning, againing, textMode, messagetext,
      backups: backups.length, movements_zero: mz, rng: { i: RandomGen._state.i, j: RandomGen._state.j, s: Array.from(RandomGen._state.s) },
      width: level.width, height: level.height };
  })()`, ctx);
}
export function finish(snap) {
  snap.objects_sha1 = sha1(Buffer.from(Int32Array.from(snap.objects).buffer));
  snap.rng_s_sha1 = sha1(Buffer.from(Uint8Array.from(snap.rng.s)));
  delete snap.objects; delete snap.rng.s;
  return snap;
}

export function playableLevels(ctx) {
  return vm.runInContext(`state.levels.map((l, i) => l.message === undefined ? i : -1).filter(i => i >= 0)`, ctx);
}

export function compileGame(ctx, text, levelIndex, seedStr) {
  ctx.levelString = text;
  vm.runInContext(`unitTesting = false; lazyFunctionGeneration = false; errorStrings = []; errorCount = 0;`, ctx);
  vm.runInContext(`compile(["loadLevel", ${levelIndex}], levelString, ${JSON.stringify(seedStr)});`, ctx);
  const errors = vm.runInContext(`errorCount`, ctx);
  agains(ctx);
  return errors;
}
export function agains(ctx) { return vm.runInContext(`(function(){ let n = 0; while (againing) { againing = false; processInput(-1); n++; } return n; })()`, ctx); }
export function stepInput(ctx, a) {
  if (a === 5) return 0;                                   // NOOP: nothing happens without a key
  vm.runInContext(`processInput(${a})`, ctx);
  return agains(ctx);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (args.includes('--selftest')) {
    const out = execFileSync('node', [join(REF, 'src/tests/run_tests_node.js')], { encoding: 'utf8', cwd: REF, maxBuffer: 1 << 26 });
    const tail = out.trim().split('\n').slice(-4).join(' | ');
    console.log(tail);
    process.exit(/Failed:\s*0/.test(out) && /Errors:\s*0/.test(out) ? 0 : 1);
  }
  const game = opt('game', null); if (!game) { console.error('--game <txt> required'); process.exit(2); }
  const text = readFileSync(game, 'utf8');
  const ctx = makeContext(); loadEngine(ctx, join(REF, 'src'), ENGINE_FILES);
  if (args.includes('--info')) {
    ctx.levelString = text;
    vm.runInContext(`unitTesting = false; lazyFunctionGeneration = false; errorStrings = []; errorCount = 0; compile(["restart"], levelString, "1");`, ctx);
    const info = vm.runInContext(`({ title: state.metadata.title || null, author: state.metadata.author || null, metadata: Object.keys(state.metadata),
      levels: state.levels.length, playable: state.levels.map((l, i) => l.message === undefined ? i : -1).filter(i => i >= 0),
      errors: errorCount, winconditions: state.winconditions.length, objects: Object.keys(state.objects).length, layers: state.collisionLayers.length,
      sizes: state.levels.filter(l => l.message === undefined).map(l => [l.width, l.height]) })`, ctx);
    console.log(JSON.stringify(info)); process.exit(0);
  }
  const level = parseInt(opt('level', '0'), 10), seed = opt('seed', '1');
  const acts = opt('actions', '').split(',').filter(x => x !== '').map(Number);
  const stop = !args.includes('--no-stop');
  const errors = compileGame(ctx, text, level, String(seed));
  const traj = [Object.assign(finish(snapshot(ctx)), { t: 0, agains: 0 })];
  for (const a of acts) {
    if (stop && traj[traj.length - 1].winning) break;
    const n = stepInput(ctx, a);
    traj.push(Object.assign(finish(snapshot(ctx)), { t: traj.length, agains: n }));
  }
  const out = { constants: { ref_commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REF, encoding: 'utf8' }).trim(), game, level, seed: String(seed), compile_errors: errors,
    playable: playableLevels(ctx), again_loop: 'while (againing) { againing = false; processInput(-1); } after every input (testingFrameWork.runTest)', noop: 5 }, traj };
  if (args.includes('--json')) console.log(JSON.stringify(out));
  else { console.log(JSON.stringify(out.constants)); for (const r of traj) console.log(r.t, 'lvl', r.curlevel, 'win', r.winning, 'text', r.textMode, 'bk', r.backups, 'ag', r.agains, 'rng', r.rng.i, r.rng.j, r.rng_s_sha1.slice(0, 8), 'obj', r.objects_sha1.slice(0, 8)); }
}
