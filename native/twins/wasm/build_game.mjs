#!/usr/bin/env node
// build_game.mjs — one PlayTrain bundle -> a .wasm game (the raylib model: the twin's C++ compiled with Emscripten,
// standalone wasm, no Emscripten JS runtime), plus a small classic-script glue that presents the PlayTrain contract
// (setup/resetGame/draw/getGameState[/getObservation]) and routes the twin's p5 calls to the page's/game-env's shim.
//   node build_game.mjs <family_dist/name.js>... --out <dir>          (EMSDK or emcc on PATH)
// Output per game: <out>/<name>.wasm, <out>/<name>.js (glue), <out>/<name>.json (sidecar + format: "wasm").
// Family objects are compiled once into <out>/obj/<family>/ and reused; per game only the embedded-data unit and
// the entry unit are compiled.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url)), TWINS = resolve(HERE, '..'), NATIVE = resolve(TWINS, '..');
const args = process.argv.slice(2);
const OUT = resolve(args[args.indexOf('--out') + 1] || join(TWINS, 'build', 'wasm'));
const bundles = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--out'));
if (!bundles.length) { console.error('usage: build_game.mjs <bundle.js>... --out <dir>'); process.exit(2); }
const EMXX = process.env.EMXX || 'em++';
const CXXFLAGS = ['-std=c++17', '-O3', '-ffp-contract=off', '-fno-fast-math', '-fwasm-exceptions', '-DTWIN_WASM', '-DNDEBUG', '-Wno-unused-parameter',
  '-I', join(NATIVE, 'runtime'), '-I', join(TWINS, 'common'), '-I', join(TWINS, 'third_party')];
const LDFLAGS = ['-sSTANDALONE_WASM', '--no-entry', '-sALLOW_MEMORY_GROWTH=1', '-sINITIAL_MEMORY=33554432', '-fwasm-exceptions', '-Wl,--export=pt_setup,--export=pt_reset,--export=pt_draw,--export=pt_score,--export=pt_lives,--export=pt_state,--export=pt_obs_dim,--export=pt_observation'];
const FAMILY_SRCS = {
  chip8: ['chip8/threefry.cpp', 'chip8/cpu.cpp', 'chip8/env.cpp', 'chip8/twin_chip8.cpp'],
  vgdl: ['vgdl/mt19937.cpp', 'vgdl/engine.cpp', 'vgdl/rcrl.cpp', 'vgdl/twin_vgdl.cpp'],
  puzzlescript: ['puzzlescript/vm.cpp', 'puzzlescript/twin_ps.cpp'],
};
const COMMON_SRCS = ['common/registry.cpp', 'common/blank_twin.cpp', 'common/vfs.cpp', 'wasm/p5_wasm.cpp'];
// the data files a family's twin reads (registry: info.dir = the family dir; embedded under /game)
function dataFiles(famDir, side) {
  const files = [[`/game/dist/${side.name}.json`, join(famDir, 'dist', `${side.name}.json`)]];
  if (side.family === 'chip8') { const def = JSON.parse(readFileSync(join(famDir, 'games', `${side.game}.json`), 'utf8')); files.push([`/game/games/${side.game}.json`, join(famDir, 'games', `${side.game}.json`)], [`/game/roms/${def.rom}`, join(famDir, 'roms', def.rom)]); }
  else if (side.family === 'vgdl') files.push([`/game/twin/${side.corpus}/${side.game}.json`, join(famDir, 'twin', side.corpus, `${side.game}.json`)]);
  else if (side.family === 'puzzlescript') files.push([`/game/twin/state/ps_${side.game}.json`, join(famDir, 'twin', 'state', `ps_${side.game}.json`)], [`/game/games/${side.game}.json`, join(famDir, 'games', `${side.game}.json`)]);
  else throw new Error('no wasm data recipe for family ' + side.family);
  return files;
}
function embedSource(files) {
  let s = '#include "vfs.hpp"\n';
  files.forEach(([, p], i) => { const b = readFileSync(p); s += `static const unsigned char f${i}[] = {${Array.from(b).join(',')}${b.length ? ',' : ''}0};\n`; });
  s += 'extern "C" { const twin::EmbeddedFile twin_embedded_files[] = {' + files.map(([vp], i) => `{${JSON.stringify(vp)}, f${i}, ${statSync(files[i][1]).size}u}`).join(', ') + `}; const int twin_embedded_count = ${files.length}; }\n`;
  return s;
}
function newer(out, srcs) { if (!existsSync(out)) return false; const t = statSync(out).mtimeMs; return srcs.every(s => statSync(s).mtimeMs < t); }
function compileObj(src, obj, extra = []) {
  const deps = [src, ...readdirSync(join(TWINS, 'common')).filter(f => f.endsWith('.hpp')).map(f => join(TWINS, 'common', f)), ...readdirSync(dirname(src)).filter(f => f.endsWith('.hpp')).map(f => join(dirname(src), f))];
  if (newer(obj, deps)) return;
  mkdirSync(dirname(obj), { recursive: true });
  execFileSync(EMXX, [...CXXFLAGS, ...extra, '-c', src, '-o', obj], { stdio: 'inherit' });
}
function glue(name, side) {
  const symbolic = side.obs && Number.isInteger(side.obs.symbolic) ? side.obs.symbolic : 0;
  return `// ${name} — PlayTrain wasm game (native twin compiled with Emscripten; native/twins/wasm/build_game.mjs). The
// loader supplies the module: game-env.mjs sets globalThis.__PT_WASM_BYTES from the .wasm beside this file, the play
// page sets globalThis.__PT_WASM_MODULE from an inlined copy. The contract functions below are the game.
const __PT_WASM_FILE = ${JSON.stringify(name + '.wasm')};
var __ptw = (function () {
  var mod = globalThis.__PT_WASM_MODULE || (globalThis.__PT_WASM_BYTES ? new WebAssembly.Module(globalThis.__PT_WASM_BYTES) : null);
  if (!mod) throw new Error(${JSON.stringify(name)} + ': no wasm module (loader must set __PT_WASM_MODULE or __PT_WASM_BYTES)');
  globalThis.__PT_WASM_MODULE = undefined; globalThis.__PT_WASM_BYTES = undefined;
  var mem = null;
  var u8 = function () { return new Uint8Array(mem.buffer); };
  var cstr = function (p) { var b = u8(); var e = p; while (b[e]) e++; return new TextDecoder().decode(b.subarray(p, e)); };
  var env = {
    pt_createCanvas: function (w, h) { createCanvas(w, h); },
    pt_background1: function (g) { background(g); },
    pt_background3: function (r, g, b) { background(r, g, b); },
    pt_fill1: function (g) { fill(g); },
    pt_fill3: function (r, g, b) { fill(r, g, b); },
    pt_noStroke: function () { noStroke(); },
    pt_rect: function (x, y, w, h) { rect(x, y, w, h); },
    pt_keyIsDown: function (c) { return keyIsDown(c) ? 1 : 0; },
    pt_drawTiles: function (kp, gw, gh, ap, tilePx, nTiles, x, y, w, h) {
      var kinds = new Uint16Array(mem.buffer, kp, gw * gh).slice();
      var atlas = new Uint8Array(mem.buffer, ap, nTiles * tilePx * tilePx * 4).slice();
      drawTiles(kinds, gw, gh, atlas, tilePx, nTiles, x, y, w, h);
    },
    pt_abort: function (p) { throw new Error(${JSON.stringify(name)} + ': ' + cstr(p)); },
    emscripten_notify_memory_growth: function () {},
  };
  var wasi = new Proxy({}, { get: function (_, k) { return function () { return k === 'proc_exit' ? undefined : 0; }; } });
  var inst = new WebAssembly.Instance(mod, { env: env, wasi_snapshot_preview1: wasi });
  mem = inst.exports.memory;
  if (typeof inst.exports._initialize === 'function') inst.exports._initialize();
  return { exports: inst.exports, cstr: cstr, mem: function () { return mem; } };
})();
function setup() { __ptw.exports.pt_setup(); }
function resetGame(seed) { __ptw.exports.pt_reset(seed >>> 0); }
function draw() { __ptw.exports.pt_draw(); }
function getGameState() { return { score: __ptw.exports.pt_score(), lives: __ptw.exports.pt_lives(), gameState: __ptw.cstr(__ptw.exports.pt_state()) }; }
${symbolic ? `function getObservation() { var p = __ptw.exports.pt_observation(); return new Float32Array(__ptw.mem().buffer, p, ${symbolic}).slice(); }` : ''}
`;
}
mkdirSync(OUT, { recursive: true });
for (const bundle of bundles) {
  const bpath = resolve(bundle), name = basename(bpath, '.js'), famDir = resolve(dirname(bpath), '..');
  const side = JSON.parse(readFileSync(bpath.replace(/\.js$/, '.json'), 'utf8'));
  const fam = side.family; if (!FAMILY_SRCS[fam]) throw new Error('unknown family ' + fam);
  const objDir = join(OUT, 'obj', fam); const objs = [];
  for (const rel of [...COMMON_SRCS, ...FAMILY_SRCS[fam]]) { const obj = join(objDir, rel.replace(/\//g, '_').replace(/\.cpp$/, '.o')); compileObj(join(TWINS, rel), obj, [`-DTWIN_HAVE_${fam.toUpperCase()}`]); objs.push(obj); }
  const gdir = join(OUT, 'obj', 'games', name); mkdirSync(gdir, { recursive: true });
  writeFileSync(join(gdir, 'embedded.cpp'), embedSource(dataFiles(famDir, side)));
  execFileSync(EMXX, [...CXXFLAGS, '-c', join(gdir, 'embedded.cpp'), '-o', join(gdir, 'embedded.o')], { stdio: 'inherit' });
  execFileSync(EMXX, [...CXXFLAGS, `-DPT_GAME_NAME="${name}"`, `-DTWIN_HAVE_${fam.toUpperCase()}`, '-c', join(TWINS, 'wasm', 'wasm_game.cpp'), '-o', join(gdir, 'wasm_game.o')], { stdio: 'inherit' });
  execFileSync(EMXX, [...LDFLAGS, '-O3', ...objs, join(gdir, 'embedded.o'), join(gdir, 'wasm_game.o'), '-o', join(OUT, `${name}.wasm`)], { stdio: 'inherit' });
  writeFileSync(join(OUT, `${name}.js`), glue(name, side));
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify({ ...side, format: 'wasm', wasm: `${name}.wasm`, source_sha256: undefined }, null, 2) + '\n');
  console.log(`${name}: ${statSync(join(OUT, `${name}.wasm`)).size} bytes`);
}
