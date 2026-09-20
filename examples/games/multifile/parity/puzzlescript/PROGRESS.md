# PROGRESS — PuzzleScript on PlayTrain (reference-engine identity)

The only record of state. `LOOP.md` reads this first every iteration.

STATUS: RUNNING
ITERATION: 5
BRANCH: puzzlescript (from chip8 @ 64e8a3f)
LAST_COMMIT: b5d3d53

## Ledger

| unit | status | gate output (last line) | commit | notes for the next iteration |
|---|---|---|---|---|
| U00 branch + harness | done | chip8 suite `54 passed in 132s` (with oracle + browser configured) | e80d7c4 | branch created from chip8 tip 64e8a3f; only `native/aotfork/out/` and `analogen_*` untracked |
| U01 pin, vendor, corpus, oracle | done | `4 passed` with PS_REF (`Failed: 0 | Errors: 0 | Total: 770 tests in 6.72s` on the checkout); `2 passed, 2 skipped` without | 0c679c7 | Vendored 18 engine files (17 in run_tests_node's load order + graphics.js) and 3 test files, 5.4 MB, sha256 in manifest `vendored`. Corpus = the editor dropdown minus 'blank': 17 games, 111 playable levels, 0 compile errors, 0 realtime (PLAN section 2 corrected). `tests/oracle.mjs` (PS_REF=<checkout>) reproduces run_tests_node's shims and exports makeContext/loadEngine/snapshot/compileGame/stepInput for the lockstep gate; `--info`, `--selftest`, `--json`. Level indices include message screens (microban: 21 levels, 10 playable at odd indices); loading a message level leaves no `level`, so the prelude must pick from `playable_levels`. RNG state is `RandomGen._state.s/i/j`. Metadata in the corpus: require_player_movement (5 games), noundo (octat), run_rules_on_level_start (whaleworld), color_palette (4), background/text_color (2), key_repeat_interval (2). |
| U02 shims + 770 reference tests in the bundle | done | `Passed: 770 / Failed: 0 / Errors: 0` in 8.0 s under node; pytest `5 passed` | 3306015 | `src/05_shims.js`: guarded (typeof) versions of everything run_tests_node.js installs, plus `performance.now` for QuickJS; all functions named. `tests/run_reference_tests.mjs` builds the exact bundler concatenation (src/0*, reference engine order, src/9*) + vendored test data + a copy of the runner loop, runs it in a fresh vm context; `--emit <file>` writes the flat script for U05's QuickJS run (it prints via `print` when that exists). Quirks recorded: sfxr.js's `typeof exports` require() guard (never wrap as CommonJS: conftest.run_js now writes .mjs), performance.now, stripHTMLTags. |
| U03 prelude, bundler, sidecars, corpus compile | done | `17/17 bundles ok` (compile 9-20 ms each under node, 0 errors, playable counts match the manifest, 3 seeds stepped); pytest `7 passed`; `list_available_games()` shows 17 `ps_*` | a2bcea5 | `src/90_prelude.js`: compile once (unitTesting false, lazyFunctionGeneration false, `muted = 1`), reset = setGameState's flag resets + `loadLevelFromState(state, idx, String(seed))` + again loop, level = playable[seed % n]; one draw() = one processInput + again loop, WIN at `winning`; render composites each cell's ascending-id object stack into a growing 5x5 RGBA atlas, one drawTiles call, viewport as redraw() (flick/zoom); hooks `__ps` (reset, step, snap, tiles, playable, compileErrors). Sound: 11 games threw `Audio is not defined` on a rule-triggered sound (the reference runner never reaches it because unitTesting mutes); fixed by the engine's own `muted` flag plus an inert `Audio` shim. Sidecar actions ps6 = UP 38, LEFT 37, DOWN 40, RIGHT 39, ACTION X 88, NOOP. `not_matched` written. Canvas = largest playable level x 5 px (or the flick/zoom screen). |
| U04 lockstep, goldens, freshness | done | `51/51 trajectories exact` (17 games x seeds 1,2,3 x 300 steps, 15 fields incl. convertLevelToString, sha1(objects), RC4 i/j/sha1(s), again count); `golden ok (102)`; `dist/ fresh (17)`; pytest `10 passed` | b5d3d53 | `tests/gate_oracle.mjs` runs the bundle in a node vm and the checkout in-process via oracle.mjs's exports (2.9 s for the corpus). The oracle had to set the engine's `muted = 1` too: with unitTesting false, a rule-triggered sound in sokoban_basic/eyeball/match3/whaleworld crashed the reference inside riffwave's base64 (`src[i] << 16` on an undefined buffer), a path the reference runner never reaches. Wins under random play within 300 steps: octat lvl3 seed1 at step 188; kettle and nekopuzzle reach WIN in the corpus check. Goldens: 6 seeds x 300 steps, key `game/lvl<n>/seed<s>`, value `steps:won_at:hash16`. |
| U05 QuickJS: reference tests + cross-engine gate | todo | | | `native/build/qjs_host` exists on this Mac; per-run `PLAYTRAIN_QJS_ACTIONS` |
| U06 runtime + throughput | todo | | | |
| U07 render gate | todo | | | |
| U08 browser smoke | todo | | | playwright-core in `<scratch>/pw`, Chromium `~/Library/Caches/ms-playwright/chromium_headless_shell-1243/...` (see chip8 PROGRESS U08) |
| U09 report + docs | todo | | | |
| U10 human handoff | handoff | | | |

Status values: `todo`, `in-progress`, `done`, `blocked`, `handoff`.

## Numbers

(G10 results go here: game, compile time on QuickJS, steps/s 1 env / 1 thread, 20 env / 10 thr.)

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
