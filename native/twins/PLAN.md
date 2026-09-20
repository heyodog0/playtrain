# PLAN — native twins: C++ engines for CHIP-8, VGDL and PuzzleScript behind the vec-host ABI

The three DSL families run today as JavaScript under QuickJS (`native/qjs/qjs_vec_host.cpp`,
loaded by `NativeVecEnv` through ctypes). Measured on this Mac: CHIP-8 12.7k steps/s per
env, PuzzleScript 1.2k-13.4k, VGDL ~17k (aliens). The engines are small; the interpreter
is the cost. This project builds one C++ engine per family ("twin"), links them with the
same `p5.cpp` + Rust rasterizer the QuickJS host uses, and exposes them through the SAME
`vec_*` C ABI in a second shared library, `libtwin_vec`. The Python side does not change:
`NativeVecEnv(game="chip8_brix", lib_path=".../libtwin_vec.dylib")`.

The JS bundles stay the reference for the twins, and they are already gated against the
originals (Octax, py-vgdl / RC_RL, the PuzzleScript engine itself). A twin is correct when
it reproduces the JS bundle's full per-step state on every gate the family has, its
committed golden hashes byte for byte, and the V8 + wasm observation trace byte for byte.
Nothing in the JS families, the QuickJS hosts, the runtime or the rasterizer changes.

Written 2026-09-20 from the three ports (`examples/games/multifile/parity/{chip8,vgdl,
puzzlescript}/PLAN.md`) and the measurements in their PROGRESS.md files.

## 1. Pins and references

| what | value |
|---|---|
| CHIP-8 reference | the JS bundles in `parity/chip8/dist` (39), gated 111/111 + 6/6 vs Octax `3aa53b5`; goldens `parity/chip8/tests/golden.json` (234); opcode vectors `tests/vectors/octax_tests.json` (193); randint vectors (10k) |
| VGDL reference | the JS bundles in `parity/vgdl/dist` (26): `infer` corpus (Colas profile, `src/30_engine.js`, block 50, 138/138 vs py-vgdl) and `vgfmri_rcrl` (RC_RL profile, `src/35_rcrl.js`, block 30, 378/378 vs RC_RL); goldens `parity/vgdl/tests/golden.json`; RNG = CPython MT19937 (`src/10_rng_mt19937.js`) |
| PuzzleScript reference | the JS bundles in `parity/puzzlescript/dist` (17), which ARE the reference engine (`increpare/PuzzleScript` @ `d236596`); the 770 reference tests (`reference/tests/testdata.js`); goldens (102); render draw lists (G8); RNG = RC4 keyed by the seed string (`reference/js/rng.js`) |
| ABI | `native/qjs/qjs_vec_host.cpp` exports; `src/playtrain/runtime/native_vec_env.py` `_load_lib` lists what Python binds: `vec_create(game_path, num_envs, obs_size, max_steps, num_threads, autoreset)`, `vec_obs_bytes`, `vec_num_threads`, `vec_reset(h, seeds, obs)`, `vec_step(h, actions, obs, rew, term, trunc)`, `vec_reset_subset`, `vec_close`, `vec_error`/`vec_last_error`, `vec_set_actions(h, held, press, n_actions, max_held)`, `vec_set_frame_skip`, `vec_set_render_skip`, `vec_set_autoreset_seeds`, `vec_set_obs_symbolic`, `vec_set_group_mode`; the async family (`vec_create_async`, `vec_send`, `vec_recv`, `vec_wait_ids`) is optional and out of scope |
| drawing | `native/runtime/p5.hpp` (`drawTiles`, `background`, `render_obs_rgb`, `frameBegin/frameEnd`), the Rust rasterizer staticlib `crates/rasterizer/target/release/libplaytrain_rasterizer.a`; build flags from `native/build_qjs_vec.sh` (`-O3 -ffp-contract=off -fno-fast-math`, Linux PIC rules) |
| trace protocol | `native/reference_trace.mjs` (V8 + wasm): `reset seed=S score=.. lives=.. state=.. obshash=<fnv1a-64 of the obs bytes>` then per step `i a=A reward=R term=T trunc=U score=.. lives=.. state=.. obshash=..`, `A = (i*3+1) % nActions`, reset with `seed+i+1` after a terminal; `native/gate_qjs.sh` diffs it against a host's `trace` output |
| JSON in C++ | vendor `nlohmann/json` single header (MIT) under `native/twins/third_party/`; record its version and sha256 in `native/twins/manifest.json` |

## 2. What a twin must reproduce (per family)

**Common.** One env = one game def + seed. `reset(seed)` and `step(action_index)` with the
family's action table (sidecar `actions`), PlayTrain's episode semantics as the JS prelude
implements them (score, lives, gameState; reward = score delta; terminated = GAMEOVER/WIN;
truncated by `max_steps`), the reset's NOOP-frame convention exactly as `qjs_vec_host`
does it for JS games (the JS prelude's `draw()` steps and draws in one frame; the twin's
`step()` must produce the same state sequence as the host stepping the JS bundle, which the
obs trace checks). Observations: the twin issues the same `p5` calls the JS prelude issues
(`background`, `drawTiles` with the same kinds, palette, tile size and rect), so the
rasterizer produces the same bytes; `render_obs_rgb` reads them back. Symbolic mode where
the family has one (PuzzleScript `getObservation`).

**CHIP-8.** `parity/chip8/src/20_cpu.js` + `30_env.js` + `90_prelude.js`, line for line:
the CPU with JAX's gather/scatter index rules, every 8XYN writes VF, FX29 in uint8, BNNN
= (NN + VX) & 0xFFF, the unchecked stack, `fetch` clamping; threefry2x32 split + randint
uint8 (`common/threefry2x32.js`, `src/10_threefry.js`); the env: 44 instructions per step,
the timer rule (`disable_delay` zeroes; else `(t - 1) & 0xFF`), key press/release, score
and terminated as the expression trees in `games/*.json` with the c8Eval dtype rules
(uint8 wrap vs int32), custom startups (deep, vertical_brix), cached post-startup state,
`playable` level pick is not a thing here. Render: 64x32 display as 2-colour tiles into a
256x256 canvas band (rows 64..191), classic green on black.

**VGDL.** `parity/vgdl/src/30_engine.js` (Colas) and `35_rcrl.js` (RC_RL): the typed-array
sprite tables, cell grids, tick order, kill/create deferral, RNG draw order, effect pass
order, block sizes 50 / 30, level = `seed % nLevels`, MT19937 + CPython `random()` /
`choice()` bit-exact (`10_rng_mt19937.js`), the RC_RL group order embedded per game
(`<game>.groups.json`), `tiles` render mode as `90_prelude.js` draws it (statics in one
`drawTiles`, movers as rects: the twin issues the same rects through `p5::rect`). The
parser (`20_parser.js`) is NOT ported: a node tool runs the JS parser at bundle time and
serialises the parsed spec + levels to JSON the twin loads (program-as-data, design doc 3.2).

**PuzzleScript.** Not a rewrite of the reference from its text. A node tool runs the
reference's own `compile()` at bundle time and serialises the compiled `state`: objects
(id, layer, sprite matrix, colours), `STRIDE_OBJ/MOV`, layer masks, `idDict`, `playerMask`,
win conditions, levels (objects Int32Array, width, height, message flags), metadata
(`require_player_movement`, `noundo`, `norestart`, `run_rules_on_level_start`,
`throttle_movement`, `background_color`...), and every rule and late rule as the engine holds
it after compilation: cell rows, the per-cell object/movement masks and replacement masks,
directions, `randomRule`, rigid groups, commands, `loopPoint`/`lateLoopPoint`. The C++
rule VM then implements `processInput` as `engine.js` does: `startMovement`, `applyRules`
(the rule-group loop with `randomRule`, the ten matcher shapes `cellRowMatches` /
`matchCellRow` / `matchCellRowWildCard` generate, `applyAt`, `rigidGroupIndexMask` and
the 50-iteration rigid retry), `resolveMovements` (`repositionEntitiesOnLayer` order),
late rules, `processCommandQueue` (cancel, restart, checkpoint, again with its dry run,
win, message, sfx ignored), `checkWin`, `require_player_movement`, the `again` loop as
the test runner runs it, undo/restart/backups (`backupLevel`, `unconsolidateDiff`,
`DoUndo`, `DoRestart`, `restartTarget`: the 770 tests use them), RC4 with the seed string
for `random` rules and `randomDir`. Render: the tile atlas as `90_prelude.js` composes it
(ascending object id, transparent `.`), `getObservation` multihot.

## 3. Architecture

```
native/twins/
  PLAN.md PROGRESS.md LOOP.md manifest.json (pins, vendored header sha256, numbers)
  third_party/json.hpp          nlohmann/json single header (MIT)
  common/
    twin.hpp                    the Twin interface: reset(seed), step(a) -> {reward, terminated, truncated, score, lives, state},
                                draw(), obs_symbolic(float*), snapshot(json&) for the lockstep gates
    vec_host.cpp                the vec_* ABI: thread pool + spin barrier, obs slab, action table (native/qjs/action_table.hpp),
                                autoreset + seed modes, frame_skip, render_skip, symbolic obs: the structure of qjs_vec_host.cpp
                                with the QuickJS context replaced by a Twin
    registry.cpp                game_path -> sidecar (family, game) -> twin factory + def loading from the family directory
    twin_host.cpp               CLI: `twin_host <bundle.js> trace <seed> <n>` (reference_trace format), `bench <seed> <n>`,
                                `snap <seed> <actions.csv>` (per-step JSON snapshots in the family's __hook.snap() shape)
    fnv.hpp                     the 64-bit FNV-1a reference_trace.mjs hashes obs with
  chip8/   cpu.cpp cpu.hpp threefry.cpp env.cpp twin_chip8.cpp
  vgdl/    engine.cpp (Colas) rcrl.cpp (RC_RL) mt19937.cpp twin_vgdl.cpp    + parity/vgdl/tools/twin_spec.mjs (parsed spec -> JSON)
  puzzlescript/ vm.cpp rules.cpp rc4.cpp twin_ps.cpp                       + parity/puzzlescript/tools/twin_state.mjs (compiled state -> JSON)
  tests/
    test_vectors.cpp            CHIP-8: the 193 opcode vectors + 10k randint keys
    lockstep_js_vs_twin.mjs     runs the JS bundle (node vm) and `twin_host snap` on the same seeds/actions, diffs every field
    test_*.py                   pytest: build, ABI, per-family lockstep, goldens (twin snapshots -> the family's golden.json hashes),
                                obs trace vs reference_trace (gate_qjs.sh protocol with EXTRA_HOSTS), NativeVecEnv(lib_path=twin),
                                PuzzleScript 770 through the VM, bench
  build.sh                      builds build/libtwin_vec.{dylib,so} and build/twin_host; never touches native/build/
  build/                        GENERATED, untracked
```

The twin never reads the JS bundle's code, only its header constants or the family
directory next to it (`games/<game>.json`, `roms/`, the serialised spec/state JSON). The
serialisation tools run the JS front ends (VGDL parser, PuzzleScript compiler) under node
at bundle time; their outputs are committed and hash-checked for freshness.

## 4. Gates (per family, in order)

| gate | proves | subject |
|---|---|---|
| T0 build + ABI | `libtwin_vec` builds on this Mac; `NativeVecEnv(game, lib_path=...)` constructs, resets, steps, closes a built-in blank twin | `tests/test_abi.py` |
| T1 unit vectors | CHIP-8: 193/193 opcode vectors, 10k/10k randint; PuzzleScript: the 770 reference tests through the VM (level string == expected, undo/restart included) | `tests/test_vectors.cpp`, `tests/test_ps_reference.py` |
| T2 lockstep JS vs twin | same seeds and actions: every field of the family's snapshot (`__chip8.snap`, `__vgdl` state+sprites, `__ps.snap`) identical every step, all bundles, 3 seeds, 300-500 steps | `tests/lockstep_js_vs_twin.mjs`, `test_lockstep_<family>.py` |
| T3 goldens | the twin's snapshots hash to the family's committed golden.json values, every entry | `test_golden_<family>.py` |
| T4 obs trace | `twin_host trace` byte-identical to `reference_trace.mjs` (V8 + wasm), obs hash included, all bundles, 300 steps, seeds 1 and 42 | `test_trace_<family>.py` |
| T5 vec | `NativeVecEnv(lib_path=twin)` over N envs: obs/rew/term/trunc identical to `NativeVecEnv` on `libqjs_vec` for the same seeds and actions (autoreset on), 200 batched steps | `test_vec_<family>.py` |
| T6 render draw list (PuzzleScript, VGDL tiles) | the twin's tile kinds/palette equal the JS prelude's for 200 random states | `test_render_<family>.py` |
| T7 throughput | steps/s 1 env / 1 thread and 20 env / 10 threads per family, next to the QuickJS and node numbers, in PROGRESS.md | `benchmarks/bench_twins.py` |

T4 is the one that makes "same bytes as the JS" literal: the twin draws through the same
`p5.cpp` and rasterizer the QuickJS host uses, and the V8 + wasm reference is what the
models were trained on.

## 5. Not matched

- the async ABI (`vec_create_async`, `vec_send/recv`), box/analog actions, matter games: not twins' business
- PuzzleScript title/message screens, sound, level-select; the 770 tests exercise undo/restart, so those ARE implemented in the VM even though the action space excludes them
- anything the JS bundles themselves list under `not_matched`

## 6. Speed expectation

Measured before writing: QuickJS 12.7k (chip8), 1.2k-13.4k (PuzzleScript), ~17k (vgdl
aliens) per env; V8 in-process 110k (chip8) and 258k (sokoban_basic). Expected native:
CHIP-8 in the millions per core (44 opcodes, no allocation); VGDL 100k-1M (grid probes,
memory-bound); PuzzleScript 0.2-2M on sokoban-likes (a level scan per rule per turn), far
less on rule-heavy games. Rendering is one `drawTiles` per step, already native. Numbers
land in T7; if a twin is under 10x QuickJS, profile before touching anything.

## 7. Lessons that bind here

1. **Port the gated JS, not the original.** The JS engines carry the quirks (uint8 timers,
   VF writes, RC_RL fixpoint, RC4 seed strings) and have the gates. A twin that reproduces
   the JS reproduces the reference transitively; a twin that re-reads the original re-does
   three ports.
2. **Full state every step, then goldens, then bytes.** T2 before T3 before T4. Score-only
   gates passed a frozen VGDL game for a week.
3. **Same draw calls, same bytes.** Do not re-implement any pixel: call `drawTiles` /
   `rect` / `background` with the values the JS prelude computes, in the same order, and
   let the rasterizer be the pixel reference.
4. **Front ends run once, in their own language.** The VGDL parser and the PuzzleScript
   compiler stay JS; the twins load their serialised output. Freshness-check the output.
5. **JAX/Python/CPython arithmetic is part of the spec**: uint8 wrap, int32 floordiv/mod,
   MT19937 `random()` 53-bit construction, RC4 byte stream. Copy the JS expressions
   literally; do not simplify.
6. **Every function a table may reference has a name; no UB.** `-fsanitize=address,undefined`
   in a debug build during T1/T2; the release build is `-O3 -ffp-contract=off`.
7. **Never edit the QuickJS hosts, the runtime, the rasterizer or the families' JS.** New
   files under `native/twins/` and new tools under the families' `tools/` only. If the
   vec ABI needs something that only exists in Python, that is a `blocked` note.
8. **`uv run --no-sync python -m pytest`; node for JS; `bash native/twins/build.sh`.**
   Scratch files in the session scratchpad.
9. **One unit per iteration; a unit may stay `in-progress` across iterations** (the
   PuzzleScript VM will). Commit only green gates; a partial VM commits only when the
   gates it claims are green and the row says which.

## 8. Units

Branch: `twins`, created from `puzzlescript` in U00.

| unit | task | done when |
|---|---|---|
| U00 | `git checkout -b twins` from `puzzlescript`; skeleton dirs; vendor `json.hpp` (record version + sha256 in manifest.json); commit harness | chip8 + puzzlescript pytest suites still green (`54`, `35` with oracles; skips without) |
| U01 | `common/`: `twin.hpp`, `vec_host.cpp` (the qjs_vec_host structure: pool, spin barrier, slab, action table, autoreset seed modes, frame_skip, render_skip, symbolic), `registry.cpp` (sidecar -> family/game -> def), `twin_host.cpp` (trace/bench/snap), `fnv.hpp`, a built-in `blank` twin (black frame, score 0, ends at max_steps), `build.sh` (Mac dylib + Linux so, mirroring build_qjs_vec.sh flags and PIC rules) | T0: `libtwin_vec` builds; `NativeVecEnv(game="chip8_brix", lib_path=...)` on the blank twin resets/steps/closes with the right shapes; `twin_host <bundle> trace 1 5` prints reference_trace-shaped lines |
| U02 | CHIP-8 twin: `cpu.cpp` (20_cpu.js line for line), `threefry.cpp`, `env.cpp` (30_env.js + c8Eval), `twin_chip8.cpp` (prelude semantics: action from key table, GAMEOVER, render as 2-colour tiles into the 256x256 band); defs from `parity/chip8/games/*.json` + `roms/` | T1: 193/193 vectors, 10,000/10,000 randint (C++ test reading the JSON files) |
| U03 | CHIP-8 lockstep + goldens: `twin_host snap` in `__chip8.snap()` shape; `lockstep_js_vs_twin.mjs` over 39 bundles x 3 seeds x 500 steps; twin snapshots hash to `parity/chip8/tests/golden.json` (234) | T2 117/117, T3 234/234 |
| U04 | CHIP-8 obs trace + vec + bench: T4 over 39 bundles vs `reference_trace.mjs`; T5 vs `libqjs_vec`; T7 numbers | T4 78/78, T5 green, numbers in PROGRESS.md |
| U05 | VGDL twin, Colas profile: `parity/vgdl/tools/twin_spec.mjs` (parsed spec + levels + groups -> JSON, freshness-checked), `mt19937.cpp`, `engine.cpp` (30_engine.js), `twin_vgdl.cpp` (prelude: level = seed % n, tiles render); lockstep vs JS on the `infer` corpus (12 games x levels x 3 seeds x 300) | T2 exact on infer; T3: infer entries of `parity/vgdl/tests/golden.json` |
| U06 | VGDL RC_RL profile (`35_rcrl.js`) + render/trace/vec/bench for both corpora | T2/T3 on `vgfmri_rcrl` (378 trajectories' worth of goldens), T4 26/26, T5, T7 |
| U07 | PuzzleScript quick win on the existing QuickJS path: `parity/puzzlescript/tools/precompile_caches.mjs` pre-populates the engine's `CACHE_*` tables with statically emitted functions at bundle time so no `new Function` runs; 770 tests + goldens + G6 unchanged; measure `qjsc -A` on 3 bundles with `native/aotfork` | 770/770 and G3/G4/G6 green with precompiled bundles; AOT numbers recorded (accept or reject the change on the numbers; document either way) |
| U08 | PuzzleScript rule VM, part 1: `parity/puzzlescript/tools/twin_state.mjs` (compiled state -> JSON, per game, freshness-checked), `vm.cpp`/`rules.cpp`/`rc4.cpp` implementing section 2; the 770 reference tests through the VM (a node tool exports each test's game text -> compiled state + inputs + expected level string; C++ reads and replays, undo/restart included) | T1: 770/770. May span iterations: the row records `passed/770` and the first failing test each time |
| U09 | PuzzleScript twin integration: `twin_ps.cpp` (prelude semantics, level pick, tile atlas render, `getObservation`), lockstep vs JS (17 x 3 x 300), goldens (102), render draw list, obs trace, vec, bench | T2 51/51, T3 102/102, T6, T4 34/34, T5, T7 |
| U12 | wasm game format (raylib model): Emscripten build of the twins to `dist/<name>.wasm` exporting setup/resetGame/draw/getGameState and importing the p5 calls (background, drawTiles, rect, fill, noStroke, keyIsDown, createCanvas); a wasm branch in `tools/play-templates.mjs` and `runtime/p5/game-env.mjs` (runtime change: human-approved 2026-09-20); `twin_host trace` == wasm trace == JS trace, byte for byte | native vs wasm vs JS traces identical on chip8 (39), vgdl (26), puzzlescript (17); brix plays in headless Chromium from the .wasm |
| U13 | package split: move `native/twins/` to a sibling `playtrain-engines` (depends on playtrain for p5.hpp, the rasterizer, the reference bundles); the rule: nothing ships that does not pass the gates against a PlayTrain bundle | decision + migration notes for the human (U11) |
| U10 | Report: `native/twins/README.md`, numbers table (QuickJS vs node vs twin per family), status log in `playtrain-internal/docs/DSL_PORTS_DESIGN.md`, memory note; all twin tests green in one `uv run --no-sync python -m pytest native/twins/tests -q` | files written; one green run |
| U11 | handoff: whether `libtwin_vec` becomes the default `lib_path` for these families (runtime change), cluster numbers, and the AOT decision from U07 | notes for the human in PROGRESS.md |

## 9. Open questions for the human (do not block on them)

1. Should `NativeVecEnv` pick `libtwin_vec` automatically for `chip8_*`/`vgdl_*`/`ps_*` (a runtime change), or stay opt-in through `lib_path`?
2. Cluster runs: the node-backend benchmark (jobs 47370091 / 47372830) is queued; twins should be benchmarked on the same node type once they exist.
3. PuzzleScript symbolic vs pixel observations for training: the twin implements both; which is the default is a training decision.
4. If the PuzzleScript VM stalls on a semantics corner (rigid bodies are the likely one), is a 17-game corpus with one game marked `blocked` acceptable, or is 770/770 the bar? (The plan says 770/770.)

**Decided by the human, 2026-09-20 (after U04):** the twins are ENGINE ports only (three engines; games stay
VGDL text / PuzzleScript text / ROMs, readable and browser-playable). JS stays the specification and the human
runtime; the C++ is an accelerator accepted only through the gates. Proceed with VGDL (U05, U06) and PuzzleScript
(U07-U09). Then U12: the raylib model, the same C++ compiled with Emscripten to a `.wasm` game the play page and the
node backend load (one source, native for training, wasm for play), gated byte-identical against native and JS.
Then U13: the package moves to a sibling `playtrain-engines`. V8 embedding was considered as the "keep all JS"
alternative (9-20x, one engine job) and set aside in favour of the engine twins; it remains the lever for the
hand-written p5 catalog if that ever needs it.
