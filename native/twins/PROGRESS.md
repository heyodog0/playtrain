# PROGRESS — native twins (CHIP-8, VGDL, PuzzleScript in C++ behind the vec ABI)

The only record of state. `LOOP.md` reads this first every iteration.

STATUS: RUNNING
ITERATION: 5
BRANCH: twins (from puzzlescript @ 8fc96c6)
LAST_COMMIT: 7da6655

## Ledger

| unit | status | gate output (last line) | commit | notes for the next iteration |
|---|---|---|---|---|
| U00 branch, skeleton, json.hpp | done | chip8 `54 passed in 134s`, puzzlescript `36 passed in 125s` (oracles + browser configured) | 7e6c6c0 | json.hpp 3.11.3 (919,975 bytes) vendored, sha256 in manifest.json; `native/twins/build/` gitignored; skeleton dirs common/ chip8/ vgdl/ puzzlescript/ tests/ third_party/ |
| U01 common vec host + registry + twin_host + blank twin + build.sh | done | `3 passed` (NativeVecEnv over the blank twin: 4 envs, 2 threads, (4,64,64,3) uint8, 8 truncations at max_steps 50; trace lines in reference_trace shape; unknown family fails loudly); blank twin `bench` 1.33M steps/s incl. readback | de35b06 | `common/twin.hpp` Twin = the JS prelude in C++ (setup/resetGame/draw/getGameState + symbolicDim/getObservation/snapshot); `vec_host.cpp` copies qjs_vec_host's structure (shards, per-worker-flag spin barrier with 5 ms parking, SAME_STEP autoreset, 3 seed modes, frame_skip, symbolic slab) with a Twin per env and per-env rasterizer + p5 state; the reset's NOOP frame is one draw() after resetGame, like the JS host. Actions default to the sidecar's `held` codes (registry reads `<bundle>.json`), `vec_set_actions` overrides. Python's `_load_lib` binds the async / analog / box symbols unconditionally, so the library exports them as loud stubs. `build.sh` = build_qjs_vec.sh flags + staticlibs; `DEBUG=1` adds ASan/UBSan; family twins are compiled when `<family>/*.cpp` exists (`-DTWIN_HAVE_<FAMILY>`). `twin_host trace|bench|snap`; `TWIN_BLANK=1` forces the blank twin. |
| U02 CHIP-8 twin: CPU, threefry, env | done | `193/193 vectors match (15 legacy-mode)` + `keys ok; randint 10000/10000; split sha1 ok` under ASan/UBSan (DEBUG=1) and release; pytest `4 passed`; brix seed 1: 7 hook snapshots text-identical to the JS | 5d099e4 | `chip8/{cpu,threefry,env}.cpp` port 20_cpu.js / common threefry / 30_env.js line for line (c8Eval over the def's expression trees with u8 wrap via fmod and `v|0` as ToInt32); `twin_chip8.cpp` is 90_prelude.js (keypad key codes, first held key in action_set order, GAMEOVER at terminated, 2-colour tiles in the 256x256 band; `snapshot()` emits JSON.stringify(__chip8.snap()) with `nlohmann::ordered_json` and integral doubles as integers so the text hashes equally). `twin_host snap` now resets like the gate hook (no NOOP draw: `twin_debug_reset`), which is what lines its snapshots up with the JS; `vec_reset` keeps the host's NOOP frame. `tests/test_vectors.cpp` carries a 40-line SHA-1 for the split-stream check. Brix trace: GAMEOVER at step 18 with LEFT held, like the JS host. |
| U03 CHIP-8 lockstep + goldens | done | `117/117 trajectories identical` (39 bundles x seeds 1,2,3 x 500 steps, snapshot text equality); `golden ok (234 trajectories)` against parity/chip8/tests/golden.json; pytest `6 passed` | 6bf6699 | `tests/lockstep_js_vs_twin.mjs <family> [games] [--steps] [--seeds] [--golden]`: JS bundle in a node vm via the family hook vs `twin_host snap`, text-equal snapshots; `--golden` re-runs the family's golden.mjs recipe (6 seeds, LCG actions, sha256 over the JSON texts) on the twin. First run was 27/117: `snap` stepped through draw(), which stops at GAMEOVER, while `__chip8.step` steps the env past termination (the goldens include those steps). Added `Twin::hookStep(a)` (= the hook's env step) and `twin_debug_step`; `snap` uses hookStep, the host's vec_step still drives draw(). |
| U04 CHIP-8 trace + vec + bench | done | T4 `78 pass, 0 fail` (39 bundles x seeds 1,42 x 300 steps vs reference_trace.mjs, obs hash included; pytest 40 passed); T5 `4 passed` (brix, tetris, cavern1, space_flight3: 8 envs x 200 steps identical obs/rew/term/trunc between libtwin_vec and libqjs_vec); T7 table under Numbers | 7da6655 | Twin 1 env 213k-305k steps/s (cavern4a/b lowest, 5-line lookups over a 3.2 KB ROM cost nothing: their extra time is the rasterizer on busier displays), 20 env / 10 thr 1.02M-1.65M; QuickJS host 8.5k-13.4k / 49k-114k on the same protocol. Per-env twin cost is ~3.3 us, of which the emulator is well under 1 us: the tile blit + 64x64 readback is the rest (blank twin: 1.33M/s). `benchmarks/bench_twins.py <family>` runs both hosts. |
| U05 VGDL twin, Colas profile | in-progress | (no gate run yet) | - | DONE so far: `parity/vgdl/tools/twin_spec.mjs` runs the JS parser and writes `parity/vgdl/twin/<corpus>/<game>.json` = {corpus, game, block_size, profile, spec{header,defs,keys,charMap,interactions,terminations,singletons[]}, levels[], groupOrder} for all 26 games (`--check` for freshness); files generated, NOT yet committed. NEXT: `vgdl/mt19937.cpp` (10_rng_mt19937.js: init_genrand, init_by_array seed of |n| limbs, genrand u32, random() 53-bit, randbelow rejection), `vgdl/engine.cpp` = 30_engine.js line for line (types with typed-array fields, cell grids, vgCreate/Kill/Flush, updaters incl. GravityAvatar, effects table incl. teleportToExit/DestroyAllBreakwalls, vgApplyEffect with the outer/inner swap and EOS reverse order, vgCollectType aligned probe, terminations, resources as per-sprite maps), `vgdl/twin_vgdl.cpp` = 90_prelude.js (canvas = max level dims x 8, vgFitLevel, level = seed % n, tiles render: statics as kinds grid with palette index type+1 in one drawTiles, movers as rects, VG_COLORS table for `img=colors/NAME`), registry: family vgdl -> `twin/<corpus>/<game>.json` (sidecar has corpus). Gate hook shape: JSON.stringify({t, score, ended, won, sprites}) with sprites rows [key,x,y,[[res,val]..]] sorted by their JSON text; hook actions KEYS=[[273],[274],[276],[275],[],[32]] (= sidecar vgdl6 order); goldens key `infer/<game>/lvl<l>/seed<s>` value `steps:hash16`, 3 seeds [42,7,3], 300 steps, stops at ended. Needs `Twin::hookReset(seed, level)` + `twin_host snap --level`. |
| U06 VGDL RC_RL profile + trace/vec/bench | todo | | | group order per game from <game>.groups.json |
| U07 PuzzleScript CACHE precompile + AOT measurement | todo | | | engine caches: CACHE_RULE_CELLROWMATCHESFUNCTION, CACHE_MATCHCELLROW, CACHE_MATCHCELLROWWILDCARD, CACHE_CELLPATTERN_MATCHFUNCTION/REPLACEFUNCTION, CACHE_RULE_APPLYAT, CACHE_MOVEENTITIESATINDEX, CACHE_CALCULATEROWCOLMASKS, CACHE_REPOSITIONENTITIESATCELL (keys = generated source) |
| U08 PuzzleScript rule VM: 770 reference tests | todo | | | may span iterations; record passed/770 and the first failing test name each time |
| U09 PuzzleScript twin integration | todo | | | |
| U10 report + docs | todo | | | |
| U11 human handoff | handoff | | | |

Status values: `todo`, `in-progress`, `done`, `blocked`, `handoff`.

## Numbers

(T7: per family, steps/s 1 env / 1 thread and 20 env / 10 thr for QuickJS (`libqjs_vec`), node (engine only, and the vec backends), and the twin, this Mac. Cluster numbers when they exist.)

### CHIP-8 (U04, this Mac, arm64; `benchmarks/bench_twins.py chip8`: 1 env = host `bench` 100k twin / 20k qjs steps with readback; 20 env / 10 thr = NativeVecEnv 300 batched steps after 20 warm-up, autoreset)

For reference: V8 emulator-only (no render) 110k; QuickJS + qjsc -A (U14 of the chip8 port) 28.6k-34.6k.

| game | QuickJS 1 env | twin 1 env | QuickJS 20 env / 10 thr | twin 20 env / 10 thr |
|---|---|---|---|---|
| airplane | 12,917 | 282,061 | 113,898 | 1,532,632 |
| blinky | 11,943 | 291,539 | 81,763 | 1,476,878 |
| brix | 12,423 | 292,029 | 91,455 | 1,396,499 |
| cavern1 | 13,040 | 297,896 | 100,400 | 1,524,358 |
| cavern2 | 12,990 | 298,201 | 72,339 | 1,159,859 |
| cavern3 | 12,782 | 292,061 | 72,683 | 1,176,692 |
| cavern4a | 9,449 | 213,206 | 59,707 | 1,018,705 |
| cavern4b | 9,417 | 214,568 | 53,996 | 1,039,358 |
| cavern5 | 13,164 | 302,537 | 59,887 | 1,090,504 |
| cavern6 | 12,527 | 282,610 | 61,306 | 1,066,754 |
| deep | 12,044 | 287,777 | 101,284 | 1,493,761 |
| filter | 12,723 | 299,384 | 108,482 | 1,554,589 |
| flight_runner | 12,893 | 284,423 | 105,280 | 1,542,532 |
| missile | 13,362 | 304,458 | 99,495 | 1,349,831 |
| pong | 11,000 | 233,882 | 79,220 | 1,390,485 |
| rocket | 8,936 | 287,135 | 73,251 | 1,555,966 |
| shooting_stars | 12,150 | 280,173 | 77,368 | 1,490,961 |
| space_flight1 | 12,534 | 272,118 | 94,239 | 1,436,553 |
| space_flight10 | 9,781 | 264,927 | 49,473 | 1,362,011 |
| space_flight2 | 12,149 | 266,679 | 70,757 | 1,454,810 |
| space_flight3 | 11,573 | 265,765 | 70,140 | 1,414,399 |
| space_flight4 | 11,308 | 269,425 | 69,668 | 1,465,261 |
| space_flight5 | 10,979 | 268,472 | 65,747 | 1,400,628 |
| space_flight6 | 10,753 | 268,231 | 62,864 | 1,385,042 |
| space_flight7 | 10,533 | 266,596 | 56,226 | 1,396,188 |
| space_flight8 | 10,241 | 263,901 | 57,196 | 1,387,551 |
| space_flight9 | 9,952 | 267,049 | 58,849 | 1,384,722 |
| spacejam | 12,585 | 287,297 | 107,335 | 1,559,843 |
| squash | 13,104 | 294,094 | 111,880 | 1,614,368 |
| submarine | 9,148 | 279,573 | 76,256 | 1,492,986 |
| tank | 12,271 | 285,559 | 107,028 | 1,576,735 |
| target_shooter1 | 13,194 | 297,283 | 108,907 | 1,654,944 |
| target_shooter2 | 13,096 | 300,772 | 111,195 | 1,603,260 |
| target_shooter3 | 12,337 | 298,453 | 108,018 | 1,645,865 |
| tetris | 12,824 | 294,087 | 114,219 | 1,379,416 |
| ufo | 8,475 | 272,270 | 72,587 | 1,552,812 |
| vertical_brix | 12,695 | 298,106 | 80,570 | 1,457,623 |
| wipe_off | 12,467 | 288,812 | 108,082 | 1,622,115 |
| worm | 11,357 | 277,743 | 68,707 | 1,363,262 |

## Reference quirks found

(Anything the JS bundles do that their PLAN sections did not predict, found while porting; with the bundle, seed and step.)

## Iteration log

(one line per iteration: `N | unit | what changed | gate`)
1 | U00 | branch twins, harness + manifest + json.hpp committed | both family suites green
2 | U01 | common/{twin.hpp,vec_host.cpp,registry.cpp,blank_twin.cpp,twin_host.cpp}, build.sh, tests/{conftest,test_abi}.py | T0 3 passed
3 | U02 | chip8/{threefry,cpu,env,twin_chip8}, tests/test_vectors.cpp + test_chip8_vectors.py, snap reset semantics | T1 193/193 + 10k/10k
4 | U03 | tests/lockstep_js_vs_twin.mjs, test_chip8_lockstep.py, Twin::hookStep + twin_debug_step | T2 117/117, T3 234/234
5 | U04 | tests/test_chip8_trace.py, test_chip8_vec.py, benchmarks/bench_twins.py, Numbers table | T4 78/78, T5 4/4, T7 recorded
6 | U05 (in-progress) | tools/twin_spec.mjs + twin/ (26 spec files); design decisions recorded in PLAN section 9 (engines only, wasm target U12, package split U13) | -
