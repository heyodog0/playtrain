# PROGRESS — PuzzleScript on PlayTrain (reference-engine identity)

The only record of state. `LOOP.md` reads this first every iteration.

STATUS: RUNNING
ITERATION: 2
BRANCH: puzzlescript (from chip8 @ 64e8a3f)
LAST_COMMIT: 0c679c7

## Ledger

| unit | status | gate output (last line) | commit | notes for the next iteration |
|---|---|---|---|---|
| U00 branch + harness | done | chip8 suite `54 passed in 132s` (with oracle + browser configured) | e80d7c4 | branch created from chip8 tip 64e8a3f; only `native/aotfork/out/` and `analogen_*` untracked |
| U01 pin, vendor, corpus, oracle | done | `4 passed` with PS_REF (`Failed: 0 | Errors: 0 | Total: 770 tests in 6.72s` on the checkout); `2 passed, 2 skipped` without | 0c679c7 | Vendored 18 engine files (17 in run_tests_node's load order + graphics.js) and 3 test files, 5.4 MB, sha256 in manifest `vendored`. Corpus = the editor dropdown minus 'blank': 17 games, 111 playable levels, 0 compile errors, 0 realtime (PLAN section 2 corrected). `tests/oracle.mjs` (PS_REF=<checkout>) reproduces run_tests_node's shims and exports makeContext/loadEngine/snapshot/compileGame/stepInput for the lockstep gate; `--info`, `--selftest`, `--json`. Level indices include message screens (microban: 21 levels, 10 playable at odd indices); loading a message level leaves no `level`, so the prelude must pick from `playable_levels`. RNG state is `RandomGen._state.s/i/j`. Metadata in the corpus: require_player_movement (5 games), noundo (octat), run_rules_on_level_start (whaleworld), color_palette (4), background/text_color (2), key_repeat_interval (2). |
| U02 shims + 770 reference tests in the bundle | todo | | | |
| U03 prelude, bundler, sidecars, corpus compile | todo | | | |
| U04 lockstep, goldens, freshness | todo | | | |
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

## Iteration log

(one line per iteration: `N | unit | what changed | gate`)
1 | U00 | branch puzzlescript, harness committed | chip8 54 passed
2 | U01 | reference/ vendored, games/*.txt x17, manifest.json, tests/oracle.mjs + conftest + test_vendor.py | G0 4 passed
