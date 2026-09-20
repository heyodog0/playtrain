# PROGRESS — native twins (CHIP-8, VGDL, PuzzleScript in C++ behind the vec ABI)

The only record of state. `LOOP.md` reads this first every iteration.

STATUS: RUNNING
ITERATION: 0
BRANCH: (create `twins` from `puzzlescript` in U00)
LAST_COMMIT: -

## Ledger

| unit | status | gate output (last line) | commit | notes for the next iteration |
|---|---|---|---|---|
| U00 branch, skeleton, json.hpp | todo | | | |
| U01 common vec host + registry + twin_host + blank twin + build.sh | todo | | | copy the STRUCTURE of native/qjs/qjs_vec_host.cpp (pool, spin barrier, slab, autoreset, action table), not the QuickJS parts; reuse native/qjs/action_table.hpp as-is |
| U02 CHIP-8 twin: CPU, threefry, env | todo | | | vectors: parity/chip8/tests/vectors/{octax_tests,randint_10k}.json |
| U03 CHIP-8 lockstep + goldens | todo | | | snapshot shape: parity/chip8/src/90_prelude.js `__chip8.snap()`; golden hash: parity/chip8/tests/golden.mjs |
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
