# PROGRESS — native twins (CHIP-8, VGDL, PuzzleScript in C++ behind the vec ABI)

The only record of state. `LOOP.md` reads this first every iteration.

STATUS: RUNNING
ITERATION: 4
BRANCH: twins (from puzzlescript @ 8fc96c6)
LAST_COMMIT: 6bf6699

## Ledger

| unit | status | gate output (last line) | commit | notes for the next iteration |
|---|---|---|---|---|
| U00 branch, skeleton, json.hpp | done | chip8 `54 passed in 134s`, puzzlescript `36 passed in 125s` (oracles + browser configured) | 7e6c6c0 | json.hpp 3.11.3 (919,975 bytes) vendored, sha256 in manifest.json; `native/twins/build/` gitignored; skeleton dirs common/ chip8/ vgdl/ puzzlescript/ tests/ third_party/ |
| U01 common vec host + registry + twin_host + blank twin + build.sh | done | `3 passed` (NativeVecEnv over the blank twin: 4 envs, 2 threads, (4,64,64,3) uint8, 8 truncations at max_steps 50; trace lines in reference_trace shape; unknown family fails loudly); blank twin `bench` 1.33M steps/s incl. readback | de35b06 | `common/twin.hpp` Twin = the JS prelude in C++ (setup/resetGame/draw/getGameState + symbolicDim/getObservation/snapshot); `vec_host.cpp` copies qjs_vec_host's structure (shards, per-worker-flag spin barrier with 5 ms parking, SAME_STEP autoreset, 3 seed modes, frame_skip, symbolic slab) with a Twin per env and per-env rasterizer + p5 state; the reset's NOOP frame is one draw() after resetGame, like the JS host. Actions default to the sidecar's `held` codes (registry reads `<bundle>.json`), `vec_set_actions` overrides. Python's `_load_lib` binds the async / analog / box symbols unconditionally, so the library exports them as loud stubs. `build.sh` = build_qjs_vec.sh flags + staticlibs; `DEBUG=1` adds ASan/UBSan; family twins are compiled when `<family>/*.cpp` exists (`-DTWIN_HAVE_<FAMILY>`). `twin_host trace|bench|snap`; `TWIN_BLANK=1` forces the blank twin. |
| U02 CHIP-8 twin: CPU, threefry, env | done | `193/193 vectors match (15 legacy-mode)` + `keys ok; randint 10000/10000; split sha1 ok` under ASan/UBSan (DEBUG=1) and release; pytest `4 passed`; brix seed 1: 7 hook snapshots text-identical to the JS | 5d099e4 | `chip8/{cpu,threefry,env}.cpp` port 20_cpu.js / common threefry / 30_env.js line for line (c8Eval over the def's expression trees with u8 wrap via fmod and `v|0` as ToInt32); `twin_chip8.cpp` is 90_prelude.js (keypad key codes, first held key in action_set order, GAMEOVER at terminated, 2-colour tiles in the 256x256 band; `snapshot()` emits JSON.stringify(__chip8.snap()) with `nlohmann::ordered_json` and integral doubles as integers so the text hashes equally). `twin_host snap` now resets like the gate hook (no NOOP draw: `twin_debug_reset`), which is what lines its snapshots up with the JS; `vec_reset` keeps the host's NOOP frame. `tests/test_vectors.cpp` carries a 40-line SHA-1 for the split-stream check. Brix trace: GAMEOVER at step 18 with LEFT held, like the JS host. |
| U03 CHIP-8 lockstep + goldens | done | `117/117 trajectories identical` (39 bundles x seeds 1,2,3 x 500 steps, snapshot text equality); `golden ok (234 trajectories)` against parity/chip8/tests/golden.json; pytest `6 passed` | 6bf6699 | `tests/lockstep_js_vs_twin.mjs <family> [games] [--steps] [--seeds] [--golden]`: JS bundle in a node vm via the family hook vs `twin_host snap`, text-equal snapshots; `--golden` re-runs the family's golden.mjs recipe (6 seeds, LCG actions, sha256 over the JSON texts) on the twin. First run was 27/117: `snap` stepped through draw(), which stops at GAMEOVER, while `__chip8.step` steps the env past termination (the goldens include those steps). Added `Twin::hookStep(a)` (= the hook's env step) and `twin_debug_step`; `snap` uses hookStep, the host's vec_step still drives draw(). |
| U04 CHIP-8 trace + vec + bench | todo | | | gate_qjs.sh takes EXTRA host binaries via the twin_host trace format; per-game PLAYTRAIN_QJS_ACTIONS not needed for the twin (it reads the sidecar) |
| U05 VGDL twin, Colas profile | todo | | | serialise the parsed spec with the JS parser (tools/twin_spec.mjs); MT19937 + CPython random()/choice() from 10_rng_mt19937.js |
| U06 VGDL RC_RL profile + trace/vec/bench | todo | | | group order per game from <game>.groups.json |
| U07 PuzzleScript CACHE precompile + AOT measurement | todo | | | engine caches: CACHE_RULE_CELLROWMATCHESFUNCTION, CACHE_MATCHCELLROW, CACHE_MATCHCELLROWWILDCARD, CACHE_CELLPATTERN_MATCHFUNCTION/REPLACEFUNCTION, CACHE_RULE_APPLYAT, CACHE_MOVEENTITIESATINDEX, CACHE_CALCULATEROWCOLMASKS, CACHE_REPOSITIONENTITIESATCELL (keys = generated source) |
| U08 PuzzleScript rule VM: 770 reference tests | todo | | | may span iterations; record passed/770 and the first failing test name each time |
| U09 PuzzleScript twin integration | todo | | | |
| U10 report + docs | todo | | | |
| U11 human handoff | handoff | | | |

Status values: `todo`, `in-progress`, `done`, `blocked`, `handoff`.

## Numbers

(T7: per family, steps/s 1 env / 1 thread and 20 env / 10 thr for QuickJS (`libqjs_vec`), node (engine only, and the vec backends), and the twin, this Mac. Cluster numbers when they exist.)

## Reference quirks found

(Anything the JS bundles do that their PLAN sections did not predict, found while porting; with the bundle, seed and step.)

## Iteration log

(one line per iteration: `N | unit | what changed | gate`)
1 | U00 | branch twins, harness + manifest + json.hpp committed | both family suites green
2 | U01 | common/{twin.hpp,vec_host.cpp,registry.cpp,blank_twin.cpp,twin_host.cpp}, build.sh, tests/{conftest,test_abi}.py | T0 3 passed
3 | U02 | chip8/{threefry,cpu,env,twin_chip8}, tests/test_vectors.cpp + test_chip8_vectors.py, snap reset semantics | T1 193/193 + 10k/10k
4 | U03 | tests/lockstep_js_vs_twin.mjs, test_chip8_lockstep.py, Twin::hookStep + twin_debug_step | T2 117/117, T3 234/234
