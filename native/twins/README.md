# native/twins — C++ engines for the three DSL families, gated bit for bit against their JS bundles

Three engines, one host, one gate story. CHIP-8 (Octax semantics), VGDL (py-vgdl, Colas and RC_RL profiles) and
PuzzleScript (a rule VM over the reference compiler's output) are reimplemented in C++ as *twins* of the JS bundles
in `examples/games/multifile/parity/<family>/dist`. A twin draws through the same `native/runtime/p5.cpp` and the
same Rust rasterizer as the QuickJS host, speaks the same `vec_*` ABI (`NativeVecEnv(game=..., lib_path=...)`, no
Python change), and is accepted only when it reproduces the JS bundle exactly: every field of every gate snapshot,
the committed goldens, and the V8 + wasm observation trace, byte for byte. The JS stays the specification and the
human runtime; the C++ is an accelerator. The same C++ also compiles to a standalone `.wasm` game the play page and
the node runtime load (the raylib model, U12).

Record of the work: `PLAN.md` (design, gates, units), `PROGRESS.md` (the ledger: every unit's gate output, commit,
notes; the numbers; reference quirks; iteration log), `PACKAGE_SPLIT.md` (moving this directory to a sibling repo).

## Layout

```
common/    twin.hpp (the Twin interface = the JS prelude in C++), vec_host.cpp (vec_* ABI, shards, autoreset,
           obs slab; the structure of native/qjs/qjs_vec_host.cpp), registry.cpp (sidecar -> family -> twin),
           vfs.{hpp,cpp} (file reads: disk natively, an embedded table in the wasm build), twin_host.cpp (CLI:
           trace | bench | snap | tiles), jsnum.hpp, blank_twin.cpp
chip8/     threefry, cpu, env, twin_chip8: parity/chip8/src/*.js line for line
vgdl/      mt19937, engine (30_engine.js, Colas), rcrl (35_rcrl.js, RC_RL), twin_vgdl (90_prelude.js)
puzzlescript/ rc4, vm (engine.js's runtime over the serialised compiled state), twin_ps (90_prelude.js)
wasm/      build_game.mjs (bundle -> .wasm + glue + sidecar), p5_wasm.cpp (p5 calls -> page shim imports),
           wasm_game.cpp (pt_* exports)
tests/     T0-T7 + wasm gates: pytest files and the node harnesses they drive
build.sh   -> build/libtwin_vec.{dylib,so}, build/twin_host, build/test_vectors, build/test_ps_reference
```

Data the twins read is produced in the families by JS tools and committed there, hash-checked against the JS
sources: `parity/vgdl/twin/<corpus>/<game>.json` (`tools/twin_spec.mjs`), `parity/puzzlescript/twin/state/ps_<game>.json`
(`tools/twin_state.mjs`), chip8 `games/*.json` + `roms/`. The twins never parse VGDL or PuzzleScript text.

## Build and run

```
bash native/build_qjs.sh                # once: rasterizer staticlib + frozenmath (prerequisites)
bash native/twins/build.sh              # release; DEBUG=1 for -O1 -g -fsanitize=address,undefined
uv run --no-sync python -m pytest native/twins/tests -q      # every gate (153 tests, ~3 min)
./native/twins/build/twin_host examples/games/multifile/parity/chip8/dist/chip8_brix.js trace 1 300
./native/twins/build/twin_host examples/games/multifile/parity/vgdl/dist/vgdl_aliens.js bench 1 100000
uv run --no-sync python benchmarks/bench_twins.py puzzlescript   # QuickJS vs twin, 1 env and 20 env / 10 thr
```

From Python: `NativeVecEnv(game="ps_sokoban_basic", num_envs=20, num_threads=10, lib_path="native/twins/build/libtwin_vec.dylib")`.
Symbolic observations (PuzzleScript multihot) as in the JS: `vec_set_obs_symbolic` / `TWIN_OBS_MODE=symbolic`.

wasm games: `EMSDK=<emsdk checkout> node native/twins/wasm/build_game.mjs <family dist>/*.js --out native/twins/build/wasm`
(82 games in 89 s; 156-296 KB each). `PLAYTRAIN_GAMES_DIR=native/twins/build/wasm node native/reference_trace.mjs chip8_brix 1 300`
runs one through PlayTrain's node runtime; `node tools/build-pages.mjs --games native/twins/build/wasm --out <dir>` builds
self-contained play pages (the module is inlined and compiled before the glue runs).

## Gates (all green at 2026-09-20, this Mac, arm64)

| gate | chip8 | vgdl | puzzlescript |
|---|---|---|---|
| T1 unit | 193/193 opcode vectors, 10k/10k randint | (front ends run in JS) | 470/470 reference runtime tests through the VM (+300 compiler-error tests via the JS front end, G1) |
| T2 lockstep vs JS hook, every snapshot field | 117/117 (39 x 3 seeds x 500) | 138/138 infer + 378/378 vgfmri_rcrl (levels x 3 seeds x 300) | 51/51 (17 x 3 x 300, RC4 state included) |
| T3 goldens (family golden.json) | 234/234 | 138 + 378 (reset-state hashes: the family's golden.mjs has a NaN-steps bug, see PROGRESS) | 102/102 |
| T4 obs trace == V8 + wasm reference | 78/78 | 52/52 | 34/34 rgb + 34/34 symbolic |
| T5 libtwin_vec == libqjs_vec (8 envs x 200) | 4/4 games | 4/4 | 4/4 |
| T6 render draw list | (covered by T4) | (covered by T4) | 51/51 tile lists (viewport, kinds, atlas keys) |
| wasm == js == native traces | 78/78 | 52/52 | 34/34 |
| browser (headless Chromium, wasm page) | brix | aliens | sokoban_basic |

## Numbers (steps/s with 64x64 observation readback; QuickJS = the adopted `libqjs_vec`/`qjs_host`)

| family (games) | QuickJS 1 env | twin 1 env | QuickJS 20 env / 10 thr | twin 20 env / 10 thr | V8 in-process (engine only) |
|---|---|---|---|---|---|
| CHIP-8 (39) | 8.5k-13.4k | 213k-305k | 49k-114k | 1.02M-1.65M | 110k |
| VGDL Colas / infer (12) | 14.6k-79k | 141k-222k | 69k-198k | 670k-1.01M | ~17k (aliens, node backend) |
| VGDL RC_RL / vgfmri (14) | 15.6k-54k | 105k-201k | 28k-292k | 301k-781k | |
| PuzzleScript (17) | 1.2k-13.2k | 27k-168k | 3.7k-82k | 27k-679k | 51k-258k (sokoban_basic 258k) |

Per game tables, protocol and caveats: `PROGRESS.md` > Numbers. Two measured negatives also recorded there:
pre-populating PuzzleScript's `CACHE_*` matcher tables at bundle time changes nothing (the matchers were never on the
step path), and the `qjsc -A` AOT tier segfaults at load on every PuzzleScript bundle (a fork bug), so the twin is
the speed path for that family. Cluster numbers: the node-backend benchmark jobs (47370091 / 47372830) were still
queued when this was written.

## What is deliberately not here

- No editing of the JS families, the QuickJS hosts, the runtime (except the two approved wasm-loader branches in
  `runtime/p5/game-env.mjs` and `tools/play-templates.mjs` + `tools/build-pages.mjs`), the rasterizer or the catalog.
- No pixel computed in twin code: twins issue the same p5 calls the JS preludes issue.
- No default switch of `NativeVecEnv` to the twins (PLAN section 9, question 1: the human's call), no move of the
  `.wasm` games into the families' `dist/` (same), no package split yet (`PACKAGE_SPLIT.md`).
