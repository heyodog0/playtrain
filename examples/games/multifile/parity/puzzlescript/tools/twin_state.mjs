#!/usr/bin/env node
// twin_state.mjs — the reference compiler's output as data for the native twin (native/twins/puzzlescript/vm.cpp).
// Runs the vendored engine's own compile() under node (the same concatenation the bundles use) and serialises the
// compiled `state`: objects (id, layer), strides, layer masks, playerMask, win conditions, levels, metadata flags,
// sfx masks, and every rule group with its cell patterns and replacements exactly as engine.js holds them after
// compilation. The VM interprets this; it never parses PuzzleScript text.
//   node tools/twin_state.mjs --games            twin/state/ps_<game>.json for every corpus game (+ manifest)
//   node tools/twin_state.mjs --check            freshness of twin/state against games/*.txt
//   node tools/twin_state.mjs --tests <out.json> the 470 runtime reference tests: compiled state + inputs + expected
//                                                level string + seed + expected sounds (scratch file for the C++ replayer)
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..'), OUTDIR = join(ROOT, 'twin', 'state');
const args = process.argv.slice(2);
const sha256 = (t) => createHash('sha256').update(t).digest('hex');
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const srcs = readdirSync(join(ROOT, 'src')).filter(f => f.endsWith('.js')).sort();
const SOURCES = [...srcs.filter(f => f < '9').map(f => join(ROOT, 'src', f)), ...manifest.reference.engine_load_order.map(f => join(ROOT, 'reference', f)), ...srcs.filter(f => f >= '9').map(f => join(ROOT, 'src', f))];
// A probe appended to the same script scope exposes the engine's top-level lets to the tool.
const PROBE = `\nglobalThis.__twin = { compile: (cmd, text, seed) => compile(cmd, text, seed), state: () => state, level: () => level,
  errorCount: () => errorCount, convertLevelToString: () => convertLevelToString(), soundHistory: () => soundHistory,
  setUnitTesting: (v) => { unitTesting = v; lazyFunctionGeneration = !v; }, resetErrors: () => { if (typeof resetParserErrorState === 'function') resetParserErrorState(); else { errorStrings = []; errorCount = 0; } },
  run: (inputs) => { while (againing) { againing = false; processInput(-1); }
    for (const val of inputs) { if (val === 'undo') DoUndo(false, true); else if (val === 'restart') DoRestart(); else if (val === 'tick') processInput(-1); else processInput(val); while (againing) { againing = false; processInput(-1); } } },
  ellipsis: () => ellipsisPattern };\n`;
function makeContext() {
  const ctx = { console: { log() {}, error() {}, warn() {}, info() {} }, createCanvas() {}, background() {}, noStroke() {}, fill() {}, rect() {}, drawTiles() {}, keyIsDown: () => false };
  ctx.globalThis = ctx; vm.createContext(ctx);
  let code = `const PS_GAME_TEXT = ""; const PS_GAME_DEF = { playable_levels: [0], level_mode: "seed", symbolic: { objects: [], max_width: 1, max_height: 1, dim: 0 } };\n`;
  for (const p of SOURCES) code += `\n// ---- ${p} ----\n` + readFileSync(p, 'utf8') + '\n';
  vm.runInContext(code + PROBE, ctx, { filename: 'ps_twin_state.js' });
  return ctx;
}
const bv = (b) => b && b.data ? Array.from(b.data) : b;
function serializeCell(c, ellipsis) {
  if (c === ellipsis) return null;
  const r = c.replacement;
  return { op: bv(c.objectsPresent), om: bv(c.objectsMissing), aop: c.anyObjectsPresent.map(bv), mp: bv(c.movementsPresent), mm: bv(c.movementsMissing),
    rep: r ? { oc: bv(r.objectsClear), os: bv(r.objectsSet), mc: bv(r.movementsClear), ms: bv(r.movementsSet), mlm: bv(r.movementsLayerMask), rem: bv(r.randomEntityMask), rdm: bv(r.randomDirMask) } : null };
}
function serializeRule(r, ellipsis) {
  return { dir: r.direction, patterns: r.patterns.map(row => row.map(c => serializeCell(c, ellipsis))), hasRep: !!r.hasReplacements, line: r.lineNumber, ell: r.ellipsisCount,
    group: r.groupNumber, rigid: !!r.rigid, commands: r.commands.map(c => c.map(x => x === undefined ? null : x)), random: !!r.isRandom, crm: r.cellRowMasks.map(bv), crmm: r.cellRowMasks_Movements.map(bv), ruleMask: bv(r.ruleMask) };
}
const sparse = (a) => { const o = {}; if (a) for (const k of Object.keys(a)) if (a[k] !== undefined && a[k] !== null) o[k] = a[k]; return o; };
export function serializeState(ctx) {
  const s = ctx.__twin.state(), ell = ctx.__twin.ellipsis();
  const meta = {}; for (const k of ['run_rules_on_level_start', 'require_player_movement', 'noundo', 'norestart', 'noaction', 'throttle_movement', 'realtime_interval', 'again_interval', 'key_repeat_interval', 'flickscreen', 'zoomscreen', 'background_color', 'text_color', 'title', 'author']) if (k in s.metadata) meta[k] = s.metadata[k] === undefined ? true : s.metadata[k];
  const sfxo = (o) => ({ objectMask: bv(o.objectMask), directionMask: bv(o.directionMask), layer: o.layer, seed: o.seed });
  return {
    STRIDE_OBJ: s.STRIDE_OBJ, STRIDE_MOV: s.STRIDE_MOV, LAYER_COUNT: s.LAYER_COUNT, objectCount: s.objectCount, idDict: s.idDict,
    objects: s.idDict.map(n => { const o = s.objects[n]; return { name: n, id: o.id, layer: o.layer, colors: o.colors, sprite: o.spritematrix }; }),
    layerMasks: s.layerMasks.map(bv), playerMask: [s.playerMask[0], bv(s.playerMask[1])], backgroundid: s.backgroundid, backgroundlayer: s.backgroundlayer,
    metadata: meta, rigid: !!s.rigid, rigidGroupIndex_to_GroupIndex: s.rigidGroupIndex_to_GroupIndex || [], groupNumber_to_RigidGroupIndex: sparse(s.groupNumber_to_RigidGroupIndex),
    winconditions: s.winconditions.map(w => [w[0], bv(w[1]), bv(w[2]), w[4], w[5]]),
    levels: s.levels.map(l => l.message !== undefined ? { message: l.message } : { width: l.width, height: l.height, objects: Array.from(l.objects) }),
    rules: s.rules.map(g => g.map(r => serializeRule(r, ell))), lateRules: s.lateRules.map(g => g.map(r => serializeRule(r, ell))),
    loopPoint: sparse(s.loopPoint), lateLoopPoint: sparse(s.lateLoopPoint),
    sfx: { events: s.sfx_Events || {}, creation: (s.sfx_CreationMasks || []).map(sfxo), destruction: (s.sfx_DestructionMasks || []).map(sfxo), movement: (s.sfx_MovementMasks || []).map(l => l.map(sfxo)), movementFailure: (s.sfx_MovementFailureMasks || []).map(sfxo) },
  };
}
if (args.includes('--tests')) {
  const out = args[args.indexOf('--tests') + 1];
  const tctx = {}; vm.createContext(tctx); vm.runInContext(readFileSync(join(ROOT, 'reference', 'tests', 'testdata.js'), 'utf8'), tctx);
  const ctx = makeContext(); const T = ctx.__twin; const tests = [];
  for (const [name, d] of tctx.testdata) {
    T.setUnitTesting(true); T.resetErrors();
    const target = d[3] === undefined ? 0 : d[3], seed = d[4] === undefined ? null : d[4];
    let err = null; try { T.compile(['loadLevel', target], d[0], seed); } catch (e) { err = String(e && e.message || e); }
    const st = err ? null : serializeState(ctx);
    // the JS oracle for this test, run right here (the reference test loop) so a VM divergence is seen against a value
    // produced by the same engine build; expected fields come from the vendored test data itself
    tests.push({ name, target, seed: seed == null ? null : (typeof seed === 'string' ? seed : JSON.stringify(seed)), inputs: d[1], expected: d[2], expectedSounds: d[5] === undefined ? null : d[5], errorCount: T.errorCount(), compileError: err, state: st });
    T.setUnitTesting(false);
  }
  writeFileSync(out, JSON.stringify(tests)); console.log(`wrote ${tests.length} tests to ${out} (${tests.filter(t => t.compileError).length} compile errors)`);
} else if (args.includes('--games') || args.includes('--check')) {
  const games = readdirSync(join(ROOT, 'games')).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort();
  const ctx = makeContext(); const T = ctx.__twin; const man = {}; let bad = 0;
  const prev = args.includes('--check') && existsSync(join(OUTDIR, 'manifest.json')) ? JSON.parse(readFileSync(join(OUTDIR, 'manifest.json'), 'utf8')) : null;
  mkdirSync(OUTDIR, { recursive: true });
  for (const game of games) {
    const def = JSON.parse(readFileSync(join(ROOT, 'games', game + '.json'), 'utf8')); const text = readFileSync(join(ROOT, 'games', game + '.txt'), 'utf8');
    T.setUnitTesting(true); T.resetErrors(); T.compile(['loadLevel', def.playable_levels[0]], text, '0'); T.setUnitTesting(false);
    const st = serializeState(ctx); const js = JSON.stringify(st);
    man[game] = { text_sha256: sha256(text), state_sha256: sha256(js), rules: st.rules.length, lateRules: st.lateRules.length, levels: st.levels.length };
    if (prev) { const p = prev[game]; const cur = existsSync(join(OUTDIR, `ps_${game}.json`)) ? readFileSync(join(OUTDIR, `ps_${game}.json`), 'utf8') : '';
      if (!p || p.text_sha256 !== man[game].text_sha256 || p.state_sha256 !== man[game].state_sha256 || sha256(cur) !== man[game].state_sha256) { bad++; console.log(`STALE ${game}`); } }
    else { writeFileSync(join(OUTDIR, `ps_${game}.json`), js); console.log(`${game}: ${st.rules.length} rule groups, ${st.lateRules.length} late, ${st.levels.length} levels, ${js.length} bytes`); }
  }
  if (prev) { console.log(bad ? `${bad} stale` : `state fresh (${games.length} games)`); process.exit(bad ? 1 : 0); }
  writeFileSync(join(OUTDIR, 'manifest.json'), JSON.stringify(man, null, 1) + '\n');
} else { console.error('usage: twin_state.mjs --games | --check | --tests <out.json>'); process.exit(2); }
