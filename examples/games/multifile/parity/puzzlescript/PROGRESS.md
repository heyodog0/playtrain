# PROGRESS — PuzzleScript on PlayTrain (reference-engine identity)

The only record of state. `LOOP.md` reads this first every iteration.

STATUS: RUNNING
ITERATION: 0
BRANCH: (create `puzzlescript` from `chip8` in U00)
LAST_COMMIT: -

## Ledger

| unit | status | gate output (last line) | commit | notes for the next iteration |
|---|---|---|---|---|
| U00 branch + harness | todo | | | |
| U01 pin, vendor, corpus, oracle | todo | | | checkout: `git clone https://github.com/increpare/PuzzleScript` into the scratchpad, `git checkout d236596d993b6ebb7988f1a078f582c0840ccbca`; the dropdown example list is in the editor source (grep `demo/` in `src/js/editor.js` / `src/editor.html`) |
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
