# PROGRESS — native twins (CHIP-8, VGDL, PuzzleScript in C++ behind the vec ABI)

The only record of state. `LOOP.md` reads this first every iteration.

STATUS: RUNNING
ITERATION: 7
BRANCH: twins (from puzzlescript @ 8fc96c6)
LAST_COMMIT: 23b8f7a

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

## Reference quirks found

(Anything the JS bundles do that their PLAN sections did not predict, found while porting; with the bundle, seed and step.)

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
8 | U06 | vgdl/rcrl.cpp, twin_vgdl rcrl wiring + RC_COLORS, tests/test_vgdl_{trace,vec}.py, lockstep gate over both corpora, Numbers table | T2 378/378, T3 378/378, T4 26/26, T5 4/4, 86 passed
7 | U05 | vgdl/{mt19937,engine,twin_vgdl}.cpp, common/jsnum.hpp, Twin::hookReset + twin_debug_reset_level + snap [level], lockstep harness vgdl branch (per level + golden recipe), test_vgdl_lockstep.py, bench skips uncovered profiles; golden.mjs NaN-steps finding | T2 138/138 + 92/92 (1500 steps), T3 138/138, 52 passed
