# PROGRESS — CHIP-8 on PlayTrain (Octax parity)

The only record of state. `LOOP.md` reads this first every iteration.

STATUS: RUNNING
ITERATION: 0
BRANCH: (create `chip8` from `vgdl` in U00)
LAST_COMMIT: -

## Ledger

| unit | status | gate output (last line) | commit | notes for the next iteration |
|---|---|---|---|---|
| U00 commit vgdl, branch chip8 | todo | | | see PLAN.md section 8 for the exact file list; leave `reproduction/*` alone |
| U01 scaffold + oracle | todo | | | Octax checkout: clone `https://github.com/riiswa/octax` into the scratchpad, record the full commit hash in manifest.json |
| U02 CPU core + opcode vectors | todo | | | |
| U03 threefry split + randint | todo | | | craftax's `16_threefry.js` has the block function and `threefrySplit` |
| U04 env step + 3 games lockstep | todo | | | |
| U05 prelude, bundles, sidecars, goldens | todo | | | |
| U06 all 22 games lockstep | todo | | | |
| U07 cross-engine gate, runtime, benchmark | todo | | | |
| U08 browser smoke | todo | | | playwright-core: `npm i playwright-core` in a scratch dir; Chromium under `~/Library/Caches/ms-playwright/` |
| U09 report + docs | todo | | | |
| U10 human handoff | handoff | | | |

Status values: `todo`, `in-progress`, `done`, `blocked`, `handoff`.

## Numbers

(G9 results go here: game, steps/s 1 env / 1 thread, 20 env / 10 thr, QuickJS.)

## Reference quirks found

(Anything Octax does that a CHIP-8 reference manual would not predict, with the ROM and step where it was seen.)

## Iteration log

(one line per iteration: `N | unit | what changed | gate`)
