# PROGRESS — PuzzleScript on PlayTrain (reference-engine identity)

The only record of state. `LOOP.md` reads this first every iteration.

STATUS: RUNNING
ITERATION: 9
BRANCH: puzzlescript (from chip8 @ 64e8a3f)
LAST_COMMIT: fba2f41

## Ledger

| unit | status | gate output (last line) | commit | notes for the next iteration |
|---|---|---|---|---|
| U00 branch + harness | done | chip8 suite `54 passed in 132s` (with oracle + browser configured) | e80d7c4 | branch created from chip8 tip 64e8a3f; only `native/aotfork/out/` and `analogen_*` untracked |
| U01 pin, vendor, corpus, oracle | done | `4 passed` with PS_REF (`Failed: 0 | Errors: 0 | Total: 770 tests in 6.72s` on the checkout); `2 passed, 2 skipped` without | 0c679c7 | Vendored 18 engine files (17 in run_tests_node's load order + graphics.js) and 3 test files, 5.4 MB, sha256 in manifest `vendored`. Corpus = the editor dropdown minus 'blank': 17 games, 111 playable levels, 0 compile errors, 0 realtime (PLAN section 2 corrected). `tests/oracle.mjs` (PS_REF=<checkout>) reproduces run_tests_node's shims and exports makeContext/loadEngine/snapshot/compileGame/stepInput for the lockstep gate; `--info`, `--selftest`, `--json`. Level indices include message screens (microban: 21 levels, 10 playable at odd indices); loading a message level leaves no `level`, so the prelude must pick from `playable_levels`. RNG state is `RandomGen._state.s/i/j`. Metadata in the corpus: require_player_movement (5 games), noundo (octat), run_rules_on_level_start (whaleworld), color_palette (4), background/text_color (2), key_repeat_interval (2). |
| U02 shims + 770 reference tests in the bundle | done | `Passed: 770 / Failed: 0 / Errors: 0` in 8.0 s under node; pytest `5 passed` | 3306015 | `src/05_shims.js`: guarded (typeof) versions of everything run_tests_node.js installs, plus `performance.now` for QuickJS; all functions named. `tests/run_reference_tests.mjs` builds the exact bundler concatenation (src/0*, reference engine order, src/9*) + vendored test data + a copy of the runner loop, runs it in a fresh vm context; `--emit <file>` writes the flat script for U05's QuickJS run (it prints via `print` when that exists). Quirks recorded: sfxr.js's `typeof exports` require() guard (never wrap as CommonJS: conftest.run_js now writes .mjs), performance.now, stripHTMLTags. |
| U03 prelude, bundler, sidecars, corpus compile | done | `17/17 bundles ok` (compile 9-20 ms each under node, 0 errors, playable counts match the manifest, 3 seeds stepped); pytest `7 passed`; `list_available_games()` shows 17 `ps_*` | a2bcea5 | `src/90_prelude.js`: compile once (unitTesting false, lazyFunctionGeneration false, `muted = 1`), reset = setGameState's flag resets + `loadLevelFromState(state, idx, String(seed))` + again loop, level = playable[seed % n]; one draw() = one processInput + again loop, WIN at `winning`; render composites each cell's ascending-id object stack into a growing 5x5 RGBA atlas, one drawTiles call, viewport as redraw() (flick/zoom); hooks `__ps` (reset, step, snap, tiles, playable, compileErrors). Sound: 11 games threw `Audio is not defined` on a rule-triggered sound (the reference runner never reaches it because unitTesting mutes); fixed by the engine's own `muted` flag plus an inert `Audio` shim. Sidecar actions ps6 = UP 38, LEFT 37, DOWN 40, RIGHT 39, ACTION X 88, NOOP. `not_matched` written. Canvas = largest playable level x 5 px (or the flick/zoom screen). |
| U04 lockstep, goldens, freshness | done | `51/51 trajectories exact` (17 games x seeds 1,2,3 x 300 steps, 15 fields incl. convertLevelToString, sha1(objects), RC4 i/j/sha1(s), again count); `golden ok (102)`; `dist/ fresh (17)`; pytest `10 passed` | b5d3d53 | `tests/gate_oracle.mjs` runs the bundle in a node vm and the checkout in-process via oracle.mjs's exports (2.9 s for the corpus). The oracle had to set the engine's `muted = 1` too: with unitTesting false, a rule-triggered sound in sokoban_basic/eyeball/match3/whaleworld crashed the reference inside riffwave's base64 (`src[i] << 16` on an undefined buffer), a path the reference runner never reaches. Wins under random play within 300 steps: octat lvl3 seed1 at step 188; kettle and nekopuzzle reach WIN in the corpus check. Goldens: 6 seeds x 300 steps, key `game/lvl<n>/seed<s>`, value `steps:won_at:hash16`. |
| U05 QuickJS: reference tests + cross-engine gate | done | 770/770 under qjs_host (`score=770 lives=0`, 80 s vs 8 s node); `GATE PASS` x17 (300 steps, seeds 1, 42, obs hash included); pytest `19 passed in 90s` | f2b139b | qjs_host defines no `console`: shim adds a no-op one; the flat test script reports through getGameState() (score = passed, lives = failed + errored) because the trace line is qjs_host's only output. Found and fixed a prelude render bug on the way: `BitVec.get` returns a boolean and `!== 0` treated false as set, so every cell composited into one tile (goldens unaffected: state only). The obs now shows the level (microban 9 colours, 1181 lit px). gate_qjs.sh's action formula `(i*3+1) % 6` alternates LEFT/ACTION only, so sokoban-like games show 1-4 distinct frames in the trace (the player leans on a wall); dynamics coverage comes from G3/G4, not this gate. |
| U06 runtime + throughput | done | G7 `2 passed` (sidecar; NativeVecEnv 4 envs x 100 steps, obs 64x64x3 with >= 4 colours and > 10% lit); G10 table under Numbers | 7b595af | Compile under QuickJS is ~20 ms per game (PLAN Q5 closed). 1 env: 1,174 (byyourside) to 13,396 (notsnake) steps/s; 20 env / 10 thr: 4,718 (constellationz) to 96,940 (notsnake). Sokoban-likes ~10-13k, rule-heavy games 1-4k. PLAN section 6 rewritten with the numbers. |
| U07 render gate | done | `3538 states checked, 0 mismatches` (17 games x 10 seeds x up to 21 states: every cell's ordered sprite ids + viewport); pytest render+golden+fresh+corpus+runtime `7 passed` | 948342b | `tests/render_gate.mjs` loads the bundle then the reference's graphics.js in the same vm context with a document whose canvases record drawImage; sizes the fake canvas to 5 px/cell, calls canvasResize() (which itself redraws: those draws are discarded) then redraw(), decodes (sprite canvas -> index via canvasdict, (x - xoffset)/cellwidth) and compares with `__ps.tiles()`. Fixed on the way: `__ps.tiles()` listed atlas keys via Object.keys, which orders integer-like keys first (`'0'` before `'0,3'`), misaligning key <-> tile index; render output itself was right. No flickscreen/zoomscreen game in the corpus, so the viewport path is exercised only as the whole level. |
| U08 browser smoke | done | `PASS ps_microban / ps_kettle / ps_midas` (turns 0->5/8/6 on arrow keys, 3-5 colours, overlay from the sidecar, no console errors); full suite `36 passed` with PS_REF + playwright | fba2f41 | Two findings. (1) The play page loads a game with `(0, eval)(text)`; under an indirect eval the engine's top-level `let`/`const` are eval-scoped, invisible to the matchers the engine builds with `new Function` -> `_movementVecs is not defined` on the first turn (node vm and qjs_host run the bundle as a classic script, so they never saw it). Fix without touching engine or page: `05_shims.js` detects eval scoping (`new Function('return typeof psShimProbe')`) and the bundler emits a generated bridge after the engine: for each of the 191 top-level let/const names in the vendored files, a global accessor closing over the real binding (setter for lets). No-op as a classic script; goldens, lockstep, G6 unchanged. (2) The page forwards only keys 32 37-40 65 66 68 83 87 to the game, so X (88) could never act for a human; ACTION is now held as space (32), one of the reference's four action keys (enter, space, c, x). Screenshot (scratch `shots_ps/ps_midas.png`, inspected): two panels, the 105x85 rasterizer view and the 64x64 obs preview, both showing the Midas level letterboxed: white room, grey structure, orange pieces, one blue player cell; header 'score: 0 | lives: 1 | PLAYING'; parity label 'exact dynamics vs PuzzleScript (increpare): the engine itself, vendored d236596 . 7 documented caveats'; overlay 'Arrows move, SPACE acts. Midas by wanderlands: level = seed % 15 ...'. |
| U09 report + docs | todo | | | |
| U10 human handoff | handoff | | | |

Status values: `todo`, `in-progress`, `done`, `blocked`, `handoff`.

## Numbers

(G10 results go here: game, compile time on QuickJS, steps/s 1 env / 1 thread, 20 env / 10 thr.)

First datapoint (U05): the 770 reference tests (compile + simulate, mixed) take 8.0 s under node and 79.9 s under qjs_host on this Mac: QuickJS is ~10x slower on this engine.

G10 (U06, this Mac, arm64, `benchmarks/bench_puzzlescript.py`): the first column is the wall time of a whole 1-step `qjs_host bench` run (process start + engine load + compile + one turn), so compile is at most ~20 ms for every corpus game under QuickJS; 1-env steps/s from `qjs_host bench 3000` with the bench's own action formula; 20 env / 10 threads from NativeVecEnv, 200 batched steps after 10 warm-up. Random play resets on win under autoreset, so the 20-env column includes level reloads.

| game | QuickJS load + compile (1-step run, s) | 1 env / 1 thread steps/s (qjs_host bench, 3000 steps) | 20 env / 10 thr (NativeVecEnv) |
|---|---|---|---|
| blockfaker | 0.02 | 5,989 | 22,741 |
| byyourside | 0.02 | 1,174 | 10,577 |
| constellationz | 0.02 | 3,086 | 4,718 |
| kettle | 0.02 | 2,298 | 14,543 |
| limerick | 0.02 | 1,585 | 14,900 |
| microban | 0.02 | 12,794 | 65,494 |
| midas | 0.02 | 3,525 | 13,025 |
| nekopuzzle | 0.02 | 10,201 | 78,113 |
| notsnake | 0.02 | 13,396 | 96,940 |
| octat | 0.02 | 3,674 | 31,816 |
| randomrobots | 0.02 | 5,795 | 51,560 |
| randomspawner | 0.02 | 3,621 | 35,915 |
| sokoban_basic | 0.02 | 12,660 | 89,788 |
| sokoban_eyeball | 0.01 | 9,577 | 63,742 |
| sokoban_match3 | 0.02 | 7,905 | 62,316 |
| whaleworld | 0.02 | 3,106 | 11,415 |
| zenpuzzlegarden | 0.02 | 4,362 | 29,991 |

## Reference quirks found

(Anything the engine does that its documentation would not predict, with the game and step where it was seen.)

- A rule-triggered sound (`sfx0`.. in kettle, microban, sokoban_basic, ...) reaches `new Audio()` in sfxr.js when `muted` is 0 and `unitTesting` is false; the reference's runner only ever runs with unitTesting true. The prelude uses the engine's own `muted = 1` (sfxr.js playSound returns before checkAudioContextExists).
- With `unitTesting` false and `muted` 0, a rule-triggered sound reaches sfxr's synthesiser and, headless, dies in riffwave's base64 encoder (`n = (src[i] << 16) | ...`); both the prelude and the oracle use the engine's `muted = 1`.
- `IDE` and `canOpenEditor` default to true in debug.js; the compile path then assigns `document.title` (fine on the shim object) and calls colorhelpers.js updateFocusBorderColour (safe without a DOM).

## Iteration log

(one line per iteration: `N | unit | what changed | gate`)
1 | U00 | branch puzzlescript, harness committed | chip8 54 passed
2 | U01 | reference/ vendored, games/*.txt x17, manifest.json, tests/oracle.mjs + conftest + test_vendor.py | G0 4 passed
3 | U02 | src/05_shims.js, tests/run_reference_tests.mjs, test_reference_tests.py, conftest .mjs, 2 quirks | G1 770/770
4 | U03 | src/90_prelude.js, tools/bundle_puzzlescript.mjs + bundle_all.mjs, games/*.json x17, dist/ x17 + sidecars, tests/corpus_check.mjs + test_corpus.py, manifest not_matched, Audio shim | G2 17/17
5 | U04 | tests/gate_oracle.mjs, golden.mjs + golden.json (102), test_lockstep/test_golden/test_bundle_fresh, oracle muted | G3 51/51, G4 102, G5 fresh
6 | U05 | tests/test_engine_gate.py (770 under qjs_host + gate_qjs.sh x17), console shim, BitVec.get fix, dist rebuilt | G6 19 passed
7 | U06 | tests/test_runtime.py, benchmarks/bench_puzzlescript.py, Numbers table, PLAN section 6 + Q5 | G7 2 passed, G10 recorded
8 | U07 | tests/render_gate.mjs + test_render.py, psAtlasKeys() in the prelude, dist rebuilt | G8 3538/3538
9 | U08 | tests/browser_smoke.mjs + test_browser.py, eval-scope bridge (shim probe + bundler), ACTION=space in prelude/sidecars/controls, manifest quirk, dist rebuilt | G9 3 PASS, suite 36 passed
