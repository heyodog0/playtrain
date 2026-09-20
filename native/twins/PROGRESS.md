# PROGRESS — native twins (CHIP-8, VGDL, PuzzleScript in C++ behind the vec ABI)

The only record of state. `LOOP.md` reads this first every iteration.

STATUS: RUNNING
ITERATION: 13
BRANCH: twins (from puzzlescript @ 8fc96c6)
LAST_COMMIT: c05ab60

## Ledger

| unit | status | gate output (last line) | commit | notes for the next iteration |
|---|---|---|---|---|
| U00 branch, skeleton, json.hpp | done | chip8 `54 passed in 134s`, puzzlescript `36 passed in 125s` (oracles + browser configured) | 7e6c6c0 | json.hpp 3.11.3 (919,975 bytes) vendored, sha256 in manifest.json; `native/twins/build/` gitignored; skeleton dirs common/ chip8/ vgdl/ puzzlescript/ tests/ third_party/ |
| U01 common vec host + registry + twin_host + blank twin + build.sh | done | `3 passed` (NativeVecEnv over the blank twin: 4 envs, 2 threads, (4,64,64,3) uint8, 8 truncations at max_steps 50; trace lines in reference_trace shape; unknown family fails loudly); blank twin `bench` 1.33M steps/s incl. readback | de35b06 | `common/twin.hpp` Twin = the JS prelude in C++ (setup/resetGame/draw/getGameState + symbolicDim/getObservation/snapshot); `vec_host.cpp` copies qjs_vec_host's structure (shards, per-worker-flag spin barrier with 5 ms parking, SAME_STEP autoreset, 3 seed modes, frame_skip, symbolic slab) with a Twin per env and per-env rasterizer + p5 state; the reset's NOOP frame is one draw() after resetGame, like the JS host. Actions default to the sidecar's `held` codes (registry reads `<bundle>.json`), `vec_set_actions` overrides. Python's `_load_lib` binds the async / analog / box symbols unconditionally, so the library exports them as loud stubs. `build.sh` = build_qjs_vec.sh flags + staticlibs; `DEBUG=1` adds ASan/UBSan; family twins are compiled when `<family>/*.cpp` exists (`-DTWIN_HAVE_<FAMILY>`). `twin_host trace|bench|snap`; `TWIN_BLANK=1` forces the blank twin. |
| U02 CHIP-8 twin: CPU, threefry, env | done | `193/193 vectors match (15 legacy-mode)` + `keys ok; randint 10000/10000; split sha1 ok` under ASan/UBSan (DEBUG=1) and release; pytest `4 passed`; brix seed 1: 7 hook snapshots text-identical to the JS | 5d099e4 | `chip8/{cpu,threefry,env}.cpp` port 20_cpu.js / common threefry / 30_env.js line for line (c8Eval over the def's expression trees with u8 wrap via fmod and `v|0` as ToInt32); `twin_chip8.cpp` is 90_prelude.js (keypad key codes, first held key in action_set order, GAMEOVER at terminated, 2-colour tiles in the 256x256 band; `snapshot()` emits JSON.stringify(__chip8.snap()) with `nlohmann::ordered_json` and integral doubles as integers so the text hashes equally). `twin_host snap` now resets like the gate hook (no NOOP draw: `twin_debug_reset`), which is what lines its snapshots up with the JS; `vec_reset` keeps the host's NOOP frame. `tests/test_vectors.cpp` carries a 40-line SHA-1 for the split-stream check. Brix trace: GAMEOVER at step 18 with LEFT held, like the JS host. |
| U03 CHIP-8 lockstep + goldens | done | `117/117 trajectories identical` (39 bundles x seeds 1,2,3 x 500 steps, snapshot text equality); `golden ok (234 trajectories)` against parity/chip8/tests/golden.json; pytest `6 passed` | 6bf6699 | `tests/lockstep_js_vs_twin.mjs <family> [games] [--steps] [--seeds] [--golden]`: JS bundle in a node vm via the family hook vs `twin_host snap`, text-equal snapshots; `--golden` re-runs the family's golden.mjs recipe (6 seeds, LCG actions, sha256 over the JSON texts) on the twin. First run was 27/117: `snap` stepped through draw(), which stops at GAMEOVER, while `__chip8.step` steps the env past termination (the goldens include those steps). Added `Twin::hookStep(a)` (= the hook's env step) and `twin_debug_step`; `snap` uses hookStep, the host's vec_step still drives draw(). |
| U04 CHIP-8 trace + vec + bench | done | T4 `78 pass, 0 fail` (39 bundles x seeds 1,42 x 300 steps vs reference_trace.mjs, obs hash included; pytest 40 passed); T5 `4 passed` (brix, tetris, cavern1, space_flight3: 8 envs x 200 steps identical obs/rew/term/trunc between libtwin_vec and libqjs_vec); T7 table under Numbers | 7da6655 | Twin 1 env 213k-305k steps/s (cavern4a/b lowest, 5-line lookups over a 3.2 KB ROM cost nothing: their extra time is the rasterizer on busier displays), 20 env / 10 thr 1.02M-1.65M; QuickJS host 8.5k-13.4k / 49k-114k on the same protocol. Per-env twin cost is ~3.3 us, of which the emulator is well under 1 us: the tile blit + 64x64 readback is the rest (blank twin: 1.33M/s). `benchmarks/bench_twins.py <family>` runs both hosts. |
| U05 VGDL twin, Colas profile | done | T2 `138/138 trajectories identical` (12 infer games x 46 levels x seeds 1,2,3 x 300 steps, every snapshot text-equal to the `__vgdl` hook) and `92/92` at 1500 steps x seeds 11,23; T3 `golden ok (138 trajectories)` (all infer entries of parity/vgdl/tests/golden.json); ASan/UBSan clean (DEBUG=1) and release; pytest `52 passed` | 2692f6a | `vgdl/mt19937.cpp` = 10_rng_mt19937.js (CPython seeding over the 32-bit limbs of the seed, 53-bit random(), rejection randbelow). `vgdl/engine.cpp` = 30_engine.js line for line: types as per-field vectors + per-type cell grid, kill/create/resource deferral, updaters incl. GravityAvatar, the 20 effects, vgApplyEffect outer/inner swap + EOS reverse order, the aligned collision probe, abstract-group snapshots only during the collision phase (fresh during updates and terminations, as the JS), terminations, snapshot rows sorted by their JSON text. `vgdl/twin_vgdl.cpp` = 90_prelude.js: canvas = largest level x 8, vgFitLevel, level = seed % n (or the sidecar's fixed index), all three render modes (dist uses tiles), VG_COLORS, hook actions from the sidecar's held codes via the same key map as vgActiveKeys. V8 Math.hypot reproduced (scale by max + Kahan) for unit vectors. New `Twin::hookReset(seed, level)` + `twin_debug_reset_level` + `twin_host snap ... [level]`; registry reads corpus/level_mode/render/level_index from the sidecar; `common/jsnum.hpp` shared. FINDING: `parity/vgdl/tests/golden.mjs` parses `--steps` as `parseInt(args[indexOf+1])` = `parseInt("--check")` = NaN under --write/--check, so its loop never runs and every committed golden hashes the RESET snapshot only (`1:<hash>`); the twin reproduces those as committed and `--steps N` in the harness hashes N steps the way the recipe meant to. Fixing golden.mjs is a family edit (out of this loop's scope): handoff. The rcrl-profile bundles (vgfmri_rcrl corpus) are refused with a clear error until U06; bench skips them. |
| U06 VGDL RC_RL profile + trace/vec/bench | done | T2 `378/378 trajectories identical` (14 vgfmri_rcrl games x 126 levels x seeds 1,2,3 x 300 steps) + `54/54` at 1500 steps; T3 `golden ok (378 trajectories)`; T4 26/26 bundles x seeds 1,42 x 300 steps byte-identical to reference_trace.mjs (obs hash included); T5 4/4 (aliens, pushBoulders, vgfmri3_bait, vgfmri4_zelda: 8 envs x 200 steps identical to libqjs_vec); ASan/UBSan clean; pytest `86 passed` | 6a6b55d | `vgdl/rcrl.cpp` = 35_rcrl.js line for line over the shared sprite tables: sprite_order build (wall, avatar defaults; avatar last), `x = x or default` parameter semantics, `(lastmove+1) % cooldown` gating, class-sorted effects (stable, descending priority), avatar-loss-first terminations with per-termination bonuses, Python 2 `random.choice` as floor(random()*n), soft-reset tick at reset, avatar skipped on NOOP, defaultdict resource reads that create the key, the fixpoint collision loop (pair keys `(idx<<20|i)` and `k1<<26|k2`, dead set, insertion-ordered force sets for bounceForward/stepBack chains, cache entries invalidated per actor stype, the small-side enumeration replayed in reference order). Group order comes from the twin JSON `groupOrder` (the bundle's VG_GROUP_ORDER). RC_COLORS palette. One deliberate non-literal: transformTo copies the resource map where the JS aliases it (`st.res[j] = a.res[ai]`); the source sprite is killed in the same call so nothing observes the alias, and 378/378 agree. Bench columns are printed in header order (qjs 1 env, twin 1 env, qjs 20/10, twin 20/10). |
| U07 PuzzleScript CACHE precompile + AOT measurement | done | G1 `1 passed` (770/770 through the bundle engine, unchanged); precompiled bundles: `85/85 trajectories identical (precompiled vs dist), 0 new Function calls` (17 games x seeds 1,2,3 + unseen 101,202 x 300 steps, every __ps.snap field) and `golden ok (102 trajectories)`; G6 `GATE PASS` 17/17 (V8 reference vs qjs_host on the precompiled bundles, 300 steps x seeds 1,42); pytest `19 passed`. AOT: f1 (`qjsc -A`) hosts crash at load on all 6 bundles; numbers under Numbers > PuzzleScript AOT | e5dd432 | DECISION: REJECT the precompiled-cache change for adoption (no dist change; tool + caches + gates kept as the record). `tools/precompile_caches.mjs --write|--check|--assemble <dir>` plays every playable level with the 8 gate seeds under node, reads the 11 CACHE_* tables from inside the script scope, and emits every generated matcher/applier as a function expression (11-67 per game, 1.0 MB total in `twin/caches/`, hash-checked against dist); `--assemble` inserts the block before the prelude in a scratch copy. The functions are the engine's own text with the same bindings, and every gate is exact. Measured effect on QuickJS: none. Steps/s within noise (sokoban_basic 12.4k vs 12.5k, kettle 2.33k vs 2.27k, zen 4.28k vs 4.25k; same on the fork interpreter), load+compile 28-38 ms either way: the engine compiles each generated function once per game and the caches are hit for the rest of the run, so `new Function` was never on the step path. Two `new Function` calls remain at load (the shims' scope probe, the engine's FALSE_FUNCTION): static text, not generated. AOT tier: `qjsc -A` compiles the bundles (526 functions; +24/+67/+22 with the caches, exactly the cache counts) but every f1 host segfaults at load, dist and precompiled alike: a call through a null pointer reached by tail call from `call1` at pc167 of the AOT'd `compile()` (game_aot.c:382148, lr into aot381_compile), no `Bytecode mismatch` lines; the fork interpreter (f0) runs all 6 and matches V8. That is an ivankra-fork bug on the PuzzleScript engine (chip8 f1 still runs), out of scope; the AOT tier is not available for this family as-is. The QuickJS path for PuzzleScript stays at 2.3k-12.5k steps/s; the speed answer for this family is the twin (U08/U09). Build note: gate_fork.sh writes the reference cache relative to the cwd it cds into, so pass an absolute out dir; bench_fork.sh's summary aborts when an arm prints nothing. |
| U08 PuzzleScript rule VM: 770 reference tests | done | `passed 470 / 470 (failed 0, skipped 0)` under ASan/UBSan (DEBUG=1, 45 s) and release (5.5 s): every runtime test of tests/testdata.js (level string AND sound history; 90 audio tests, 423 seeded, 311 undo, 64 restart, 2347 ticks) through the VM; the other 300 (errormessage_testdata.js) are compiler-error tests of the JS front end and stay under the family's G1 (`1 passed`, 770/770); `state fresh (17 games)`; pytest `107 passed` | d42c375 | `parity/puzzlescript/tools/twin_state.mjs` runs the vendored compile() under node (bundle concatenation + a same-scope probe) and serialises the compiled state: strides, idDict, layers, layerMasks, playerMask, win conditions, levels (Int32 objects), metadata flags, sfx masks (creation/destruction/movement per layer/movement failure), rule groups + late groups with every CellPattern (present/missing/any/movement masks) and CellReplacement (clear/set/movement clear+set/layer mask/random entity/random dir), ellipsis counts, rigid, commands, loop points, rigid maps. `--games` writes `twin/state/ps_<game>.json` (17 files, 204 KB, hash-checked vs games/*.txt), `--tests` exports the 470 tests with the RNG's exact seed string (`JSON.stringify` for numeric seeds). `puzzlescript/vm.cpp` = engine.js runtime line for line: getPlayerPositions/startMovement/moveEntitiesAtIndex, calculateRowColMasks, the three cellRowMatches shapes (0/1/2 ellipses) with matchCellRow/WildCard bounds and kmax rules, generateTuples order (first row fastest), tryApply/applyAt (re-check for tuples after the first), replace with random entity/dir draws and the rigid group masks, resolveMovements (repositionEntitiesAtCell/OnLayer incl. the action=16 exception and the sfx CanMove/CantMove seeds), applyRules with loop points and banned groups, the 50-iteration rigid loop, processCommandQueue (cancel/restart/checkpoint/again dry run/win), checkWin (NO/SOME/ALL with aggregate filters), DoWin->nextLevel in unit-test mode, undo/restart backups with consolidateDiff/unconsolidateDiff/backupDiffers (incl. engine.js's `movements[i]=0` over n_tiles only), RC4 + 7-byte uniform. `tests/test_ps_reference.cpp` replays testingFrameWork.js runTest. `twin_ps.cpp` is a placeholder factory until U09. Quirk: testdata targets are sometimes strings ("7"); JS array indexing coerces, the replayer parses. |
| U09 PuzzleScript twin integration | done | T2 `51/51 trajectories identical` (17 games x seeds 1,2,3 x 300 steps, stop at winning, every __ps.snap field incl. RC4 state); T3 `golden ok (102 trajectories)`; T6 `51/51` tile lists (viewport, kinds, atlas keys) equal to the prelude for 17 x 3 x 100 states; T4 17/17 bundles x seeds 1,42 x 300 steps byte-identical to reference_trace.mjs in rgb AND symbolic mode; T5 4/4 vs libqjs_vec (8 envs x 200 steps); ASan/UBSan clean; pytest `149 passed` (all three families) | 903ac8a | `puzzlescript/twin_ps.cpp` = 90_prelude.js over the VM in non-unit-test mode (DoWin sets winning; message commands enter textMode like showTempMessage): level = playable[seed % n] or the fixed level, String(seed) as RC4 seed, processInput + again loop per step, NOOP = no turn, first held key in UP LEFT DOWN RIGHT ACTION order, the 5x5 atlas composited per distinct id stack over state.bgcolor, flick/zoom viewport with oldflickscreendat carried through backups/restarts exactly as engine.js does (Backup now stores it; loadLevelFromLevelDat and nextLevel set it), one drawTiles call centred on the canvas, multihot getObservation. `Twin::hookStep` now returns the hook value (again count) and `twin_host snap` appends it as `agains` under TWIN_SNAP_AGAINS=1 because golden.mjs hashes it; `Twin::renderSnapshot` + `twin_debug_render` + `twin_host tiles` for T6; `tools/twin_state.mjs` also serialises bgcolor/fgcolor. Tests: test_ps_{lockstep,trace,vec}.py; test_abi's no-twin case now uses a scratch sidecar with an unknown family. Numbers under Numbers > PuzzleScript twin. |
| U12 wasm game format (raylib model): Emscripten build of the twins, wasm branch in play-templates/game-env (runtime change approved 2026-09-20), native == wasm == JS traces | done | `78/78`, `52/52`, `34/34 traces identical (wasm == js == native)` (every chip8/vgdl/puzzlescript bundle x seeds 1,42 x 300 steps: the .wasm game through game-env.mjs + the wasm rasterizer vs the JS bundle vs twin_host, byte for byte incl. obs hashes); browser: `PASS chip8_brix / vgdl_aliens / ps_sokoban_basic` (headless Chromium, module compiled from the page-inlined bytes, frames advance at the sidecar pace, the sidecar keys change the frame); pytest `153 passed` (whole twins suite incl. test_wasm.py) | 8129364 | `native/twins/wasm/build_game.mjs <bundle.js>... --out <dir>`: per game a standalone .wasm (em++ 6.0.9, -O3 -ffp-contract=off, `-sSTANDALONE_WASM --no-entry`, wasm exceptions, no Emscripten JS runtime; 156-296 KB; 82 games in 89 s with family objects compiled once), a ~2.5 KB classic-script glue that presents setup/resetGame/draw/getGameState[/getObservation] and routes the twin's p5 calls (`wasm/p5_wasm.cpp` imports pt_createCanvas/pt_background1|3/pt_fill1|3/pt_noStroke/pt_rect/pt_keyIsDown/pt_drawTiles) to the same shim globals the JS preludes call, and a sidecar copy with `format: "wasm"`. Data files (sidecar, spec/state JSON, ROM) are embedded through `common/vfs.{hpp,cpp}` (`twin::readFile`: disk natively, an embedded table under TWIN_WASM); the five ifstream sites now go through it (native gates unchanged). `wasm/wasm_game.cpp` is the entry (pt_setup/pt_reset/pt_draw/pt_score/pt_lives/pt_state/pt_obs_dim/pt_observation). Runtime changes (approved): `runtime/p5/game-env.mjs` reads `<name>.wasm` beside a glue that declares `const __PT_WASM_FILE = "..."` into `globalThis.__PT_WASM_BYTES`; `tools/play-templates.mjs` inlines the module (base64) and `await WebAssembly.compile`s it into `__PT_WASM_MODULE` before the boot evals the glue (sync compile of a >4 KB module is disallowed on the main thread); `tools/build-pages.mjs` passes the bytes. Output lives in `native/twins/build/wasm/` (untracked); moving the .wasm games into the families' dist is the owner's call (U11). Toolchain: emsdk is NOT installed on this Mac; this run installed it in the session scratchpad (`git clone emsdk; ./emsdk install latest; ./emsdk activate latest`) and test_wasm.py takes `EMSDK=<checkout>` or em++ on PATH, skipping otherwise (a not-built library). Browser test env: `PLAYWRIGHT_CORE_DIR` (playwright-core installed in the scratchpad: the repo's `node_modules/playwright-core` is a dead symlink into an old scratchpad) and `PLAYWRIGHT_CHROMIUM=~/Library/Caches/ms-playwright/chromium_headless_shell-1243/.../chrome-headless-shell`. |
| U13 package split notes: sibling `playtrain-engines`, dependency rule, migration notes | done | `native/twins/PACKAGE_SPLIT.md` written (no code moved) | cc528e9 | The rule: nothing ships that does not pass T0-T7 against a pinned playtrain commit (`playtrain.lock` with the sha256s of the bundles, goldens and twin/ data; `make gate` refuses on a mismatched checkout). What moves: common/, the three engines, wasm/, tests/, third_party, build.sh, the ledger, bench_twins.py. What stays: p5.hpp/p5.cpp, the rasterizer, frozenmath/ieee754, reference_trace + game-env + the page tools, native_vec_env.py, the families with their front-end tools and twin/ data. Six interfaces named as the contract. Migration in six steps (~1 day). Recommendation: split after U11's decisions so the first engines release, the lock and PROGRESS name one commit; in-tree until then. |
| U10 report + docs | done | `153 passed in 185.66s` (one run of every twin gate incl. the wasm gates, with EMSDK + PLAYWRIGHT_CORE_DIR set) | c05ab60 | `native/twins/README.md` (layout, build/run, the gate matrix per family, the numbers table QuickJS vs twin vs V8 per family, what is deliberately not here); status-log entry appended to `playtrain-internal/docs/DSL_PORTS_DESIGN.md` (commit b60dee8 there); memory note `twins-loop.md` rewritten as the finished-state record. Node-backend cluster numbers are still absent (jobs 47370091 / 47372830 PENDING since morning): the README and the log say so. |
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

### VGDL, Colas profile / infer corpus (U05, this Mac, arm64; `benchmarks/bench_twins.py vgdl`, same protocol as CHIP-8; block_size 50, 64x64 rgb)

| game | QuickJS 1 env | twin 1 env | QuickJS 20 env / 10 thr | twin 20 env / 10 thr |
|---|---|---|---|---|
| aliens | 16,696 | 147,628 | 116,309 | 831,827 |
| avoidGeorge | 21,675 | 150,188 | 109,964 | 747,730 |
| beesAndBirds | 22,021 | 173,552 | 85,057 | 807,705 |
| jaws | 27,032 | 156,456 | 114,717 | 734,128 |
| missile_command | 19,315 | 148,860 | 82,768 | 791,957 |
| picoparkish | 79,383 | 222,371 | 69,315 | 670,126 |
| plaqueAttack | 14,612 | 141,354 | 98,661 | 827,929 |
| portals | 23,250 | 155,155 | 71,641 | 715,265 |
| preconditions | 48,321 | 187,182 | 141,145 | 940,230 |
| pushBoulders | 22,525 | 159,454 | 130,931 | 922,367 |
| relational | 28,437 | 162,073 | 191,082 | 983,566 |
| tutorial | 36,001 | 165,954 | 197,608 | 1,009,570 |

Twin 1 env 141k-222k (picoparkish highest: its levels are small), 20 env / 10 thr 670k-1.01M; QuickJS 14.6k-79k / 69k-198k on the same protocol. The twin at 1 env already beats QuickJS at 20 env / 10 threads on every game.

### VGDL, RC_RL profile / vgfmri_rcrl corpus (U06, this Mac, arm64; same protocol; block_size 30)

| game | QuickJS 1 env | twin 1 env | QuickJS 20 env / 10 thr | twin 20 env / 10 thr |
|---|---|---|---|---|
| vgfmri3_bait | 46,714 | 200,826 | 119,745 | 629,726 |
| vgfmri3_chase | 30,922 | 157,289 | 28,245 | 300,666 |
| vgfmri3_helper | 17,930 | 114,869 | 97,194 | 555,284 |
| vgfmri3_lemmings | 23,386 | 177,336 | 100,753 | 539,686 |
| vgfmri3_plaqueAttack | 28,314 | 145,011 | 64,115 | 484,335 |
| vgfmri3_sokoban | 54,270 | 187,932 | 289,339 | 781,068 |
| vgfmri3_zelda | 37,065 | 155,200 | 143,817 | 632,539 |
| vgfmri4_avoidgeorge | 32,321 | 140,022 | 142,958 | 663,231 |
| vgfmri4_bait | 41,996 | 139,536 | 179,372 | 683,839 |
| vgfmri4_chase | 15,634 | 114,205 | 77,851 | 536,623 |
| vgfmri4_helper | 17,121 | 104,531 | 79,972 | 371,151 |
| vgfmri4_lemmings | 24,873 | 130,469 | 122,131 | 559,278 |
| vgfmri4_sokoban | 54,068 | 186,730 | 291,872 | 777,899 |
| vgfmri4_zelda | 27,933 | 120,433 | 135,744 | 629,908 |

Twin 1 env 105k-201k, 20 env / 10 thr 301k-781k (chase lowest: Chaser targets by sqrt distance over a live group, per NPC per tick, in both engines); QuickJS 15.6k-54k / 28k-292k. The RC_RL fixpoint collision loop is the twin's cost centre here; a `std::map`-keyed cache per tick allocates where the JS allocates too (an object per tick), so it stays within the "no allocation where the JS has none" rule.

### PuzzleScript: precompiled caches and the AOT tier (U07, this Mac, arm64; `bench 1 5000`, 3 interleaved reps, medians; load+compile = wall time of `trace 1 1`)

| game | qjs_host dist | qjs_host precompiled | fork f0 dist | fork f0 precompiled | load+compile dist | load+compile precompiled | f1 (`qjsc -A`) |
|---|---|---|---|---|---|---|---|
| sokoban_basic | 12,399 | 12,514 | 12,669 | 12,658 | 29 ms | 28 ms | segfault at load (both) |
| kettle | 2,333 | 2,273 | 2,332 | 2,305 | 34 ms | 38 ms | segfault at load (both) |
| zenpuzzlegarden | 4,280 | 4,249 | 4,417 | 4,427 | 34 ms | 33 ms | segfault at load (both) |

Precompiling the caches changes nothing measurable: the generated functions are compiled once per game and cached, so `new Function` is off the step path already. The AOT tier cannot be measured for this family (see U07 notes). For scale: the node in-process engine runs sokoban_basic at 258k and the CHIP-8/VGDL twins at 140k-300k per env.

### PuzzleScript twin (U09, this Mac, arm64; `benchmarks/bench_twins.py puzzlescript`, same protocol; 64x64 rgb, 5px cells)

| game | QuickJS 1 env | twin 1 env | QuickJS 20 env / 10 thr | twin 20 env / 10 thr |
|---|---|---|---|---|
| blockfaker | 5,923 | 97,754 | 21,593 | 325,313 |
| byyourside | 1,161 | 26,896 | 9,547 | 179,199 |
| constellationz | 3,052 | 54,965 | 3,663 | 27,104 |
| kettle | 2,280 | 35,373 | 13,523 | 139,675 |
| limerick | 1,548 | 29,806 | 13,436 | 200,058 |
| microban | 12,957 | 167,712 | 58,622 | 644,858 |
| midas | 3,460 | 67,260 | 12,090 | 147,599 |
| nekopuzzle | 9,963 | 110,064 | 76,323 | 679,108 |
| notsnake | 13,238 | 113,875 | 79,532 | 449,962 |
| octat | 3,637 | 56,346 | 31,176 | 375,377 |
| randomrobots | 5,734 | 68,403 | 48,313 | 458,425 |
| randomspawner | 3,603 | 47,703 | 32,896 | 213,506 |
| sokoban_basic | 12,173 | 109,199 | 82,180 | 595,457 |
| sokoban_eyeball | 9,389 | 95,737 | 52,508 | 534,226 |
| sokoban_match3 | 7,779 | 84,693 | 64,302 | 564,082 |
| whaleworld | 3,090 | 34,854 | 10,946 | 91,308 |
| zenpuzzlegarden | 4,259 | 60,837 | 30,061 | 392,678 |

Twin 1 env 27k-168k (11x-23x QuickJS on the same game), 20 env / 10 thr 27k-679k. For comparison: node in-process (V8, engine only, no render) sokoban_basic 258k, notsnake 65k, zen 106k, limerick 59k, kettle 51k; PuzzleJAX's RTX 4090 peaks 80k-1.2M. The twin at 1 env already beats QuickJS at 20 env / 10 threads on every game except constellationz and the vec number there (27k, below its own 1-env 55k) and whaleworld's are worth a look in U10: both have large levels (byyourside/whaleworld/constellationz) where the per-step level scan and the 20-env autoreset reload dominate; the VM still allocates match lists per rule per turn (the JS does too), a `no allocation where the JS has none` rule is satisfied but a faster twin is available by hoisting those buffers.

### wasm game format (U12, this Mac)

| | chip8 (39) | vgdl (26) | puzzlescript (17) |
|---|---|---|---|
| .wasm size | 156 KB | 200-296 KB | ~230 KB |
| wasm == js == native traces (2 seeds x 300 steps) | 78/78 | 52/52 | 34/34 |
| browser (headless Chromium, page-inlined module) | brix PASS | aliens PASS | sokoban_basic PASS |

Build: 82 games in 89 s (family objects once, then embed + entry + link per game). The wasm game draws through the page's own p5 shim, so its frame is the shim's frame: the same drawTiles/rect/fill stream the JS prelude issues, which is what makes the three traces identical without any pixel work in the twin.

## Reference quirks found

(Anything the JS bundles do that their PLAN sections did not predict, found while porting; with the bundle, seed and step.)

- runtime: the repo's `node_modules/playwright-core` is a symlink into a previous session's scratchpad (dead); the families' browser tests skip because of it unless PLAYWRIGHT_CORE_DIR points at a real install. Worth fixing by the owner.
- wasm: the wasm rasterizer's drawTiles skips re-staging the atlas when the SAME typed array object is passed again; the glue therefore hands it a fresh copy every call (correct for atlases rebuilt in place, at a small cost).
- puzzlescript: `restoreLevel` zeroes `level.movements[i]` for i < n_tiles only (the array is n_tiles * STRIDE_MOV long); harmless because processInput recomputes, reproduced literally. `startState`'s rigid-mask arrays are shallow copies of BitVecs that resolveMovements has already zeroed, so a rigid rollback restores zeros. `getBytes` for RC4 seeds splits each UTF-16 code unit big-endian; seeds are ASCII decimals. The soundHistory the audio tests compare records only `playSounds()` (CantMove, CanMove, creation, destruction, in that order); `sfxN` commands and undo/restart/level sounds go through `playSound(seed, true)` and are not recorded; compile() clears the history after the level load.
- puzzlescript: CACHE_CELLPATTERN_REPLACEFUNCTION is keyed by the replacement bit array (like the MATCHFUNCTION Map), not by the generated source as the other object caches are; the precompile tool emits keys verbatim.
- puzzlescript: `qjsc -A` (ivankra fork @ cee72b9) output for any bundle of this engine dies at load in the AOT'd `compile()` (null tail call after `call1` at pc167); the fork interpreter is fine. Not chip8-specific machinery: the same harness and archive run chip8 f1 hosts correctly.
- vgdl: `tests/golden.mjs` `--check`/`--write` run with STEPS = NaN (see U05), so golden.json's 516 entries are reset-state hashes; the JS-vs-py oracle gate (`gate_oracle.mjs`) is what actually proves the trajectories. Twin T3 reproduces golden.json as committed; T2 (138 x 300 + 92 x 1500 steps lockstep) is the real trajectory gate.
- vgdl: the twin's hook reset must pick the level exactly like `resetLevel(idx, seed)`; the PlayTrain `resetGame(seed)` path picks `seed % nLevels`. Both are reproduced (`twin_host snap <seed> <acts> [level]`).

## Iteration log

(one line per iteration: `N | unit | what changed | gate`)
1 | U00 | branch twins, harness + manifest + json.hpp committed | both family suites green
2 | U01 | common/{twin.hpp,vec_host.cpp,registry.cpp,blank_twin.cpp,twin_host.cpp}, build.sh, tests/{conftest,test_abi}.py | T0 3 passed
3 | U02 | chip8/{threefry,cpu,env,twin_chip8}, tests/test_vectors.cpp + test_chip8_vectors.py, snap reset semantics | T1 193/193 + 10k/10k
4 | U03 | tests/lockstep_js_vs_twin.mjs, test_chip8_lockstep.py, Twin::hookStep + twin_debug_step | T2 117/117, T3 234/234
5 | U04 | tests/test_chip8_trace.py, test_chip8_vec.py, benchmarks/bench_twins.py, Numbers table | T4 78/78, T5 4/4, T7 recorded
6 | U05 (in-progress) | tools/twin_spec.mjs + twin/ (26 spec files); design decisions recorded in PLAN section 9 (engines only, wasm target U12, package split U13) | -
14 | U10 | README.md, DSL_PORTS_DESIGN.md status log (playtrain-internal b60dee8), memory note | 153 passed
13 | U13 | PACKAGE_SPLIT.md (rule, what moves/stays, six interfaces, migration steps, alternatives, recommendation) | notes only
12 | U12 | wasm/{build_game.mjs,p5_wasm.cpp,wasm_game.cpp}, common/vfs.{hpp,cpp} (+5 read sites), tests/{wasm_trace_gate.mjs,wasm_browser_smoke.mjs,test_wasm.py}; runtime: game-env.mjs wasm branch, play-templates.mjs inlined module, build-pages.mjs | 164/164 traces, browser 3/3, 153 passed
11 | U09 | puzzlescript/twin_ps.cpp, Twin::hookStep->int + renderSnapshot, twin_host tiles + TWIN_SNAP_AGAINS, lockstep --tiles, tests/test_ps_{lockstep,trace,vec}.py, VM viewport/message-screen state, Numbers table | T2 51/51, T3 102/102, T6 51/51, T4 17/17 rgb+symbolic, T5 4/4, 149 passed
10 | U08 | puzzlescript/{rc4.hpp,vm.hpp,vm.cpp,twin_ps.cpp}, tests/test_ps_reference.{cpp,py}, tools/twin_state.mjs + twin/state (17), build.sh test binary | T1 470/470 (+300 front-end via G1), 107 passed
9 | U07 | parity/puzzlescript/tools/precompile_caches.mjs + twin/caches (17 files, manifest), tests/ps_precompiled_gate.mjs, test_ps_precompiled.py; AOT f1 hosts built for 6 bundles (all crash at load), f0 + qjs_host benched | G1 770/770, 85/85 + 0 new Function, goldens 102/102, G6 17/17, 19 passed; decision: reject (no effect)
8 | U06 | vgdl/rcrl.cpp, twin_vgdl rcrl wiring + RC_COLORS, tests/test_vgdl_{trace,vec}.py, lockstep gate over both corpora, Numbers table | T2 378/378, T3 378/378, T4 26/26, T5 4/4, 86 passed
7 | U05 | vgdl/{mt19937,engine,twin_vgdl}.cpp, common/jsnum.hpp, Twin::hookReset + twin_debug_reset_level + snap [level], lockstep harness vgdl branch (per level + golden recipe), test_vgdl_lockstep.py, bench skips uncovered profiles; golden.mjs NaN-steps finding | T2 138/138 + 92/92 (1500 steps), T3 138/138, 52 passed
