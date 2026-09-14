# Progress ledger

Statuses: `todo`, `in-progress`, `done`, `blocked`, `handoff`. One row per task
from PLAN.md section 11, split into sub-tasks where a task has more than one gate.
The agent edits only the status, gate, commit, and notes columns. Add rows for
sub-tasks under the parent; never delete rows.

| # | Task | Where | Status | Gate result | Commit | Notes |
|---|---|---|---|---|---|---|
| 1a | Vendor `games/craftax_src/` at commit 6ffa5b1 with LICENSE and README | mac | done | `shasum -a 256 -c`: 6/6 OK; git-blob ids match the pinned tree | f8d38ed | 5 headers + LICENSE + README in `games/craftax_src/`. `craftax_parity.h` deliberately not vendored (PLAN 2 layout). PLAN.md corrected: upstream has no `pufferlib/` prefix. `craftax_classic.h` includes `raylib.h` and `pufferenv.h` only — so 2a needs a `raylib.h` stub; `ini.h` is not included by the Classic header. |
| 1b | `THIRD_PARTY_LICENSES.md` row; `multifile/README.md`; directory skeleton | mac | done | no pytest gate; skeleton matches PLAN 2 layout, TPL row + PufferLib section added | e605ff8 | Also wrote `parity/craftax_classic/README.md` with the empty **Reference quirks** table — quirks found later go there. Empty dirs hold `.gitkeep` files whose text says which task fills them; delete each when its task lands. |
| 2a | `cc_ref_driver.c`, stubs, `build.sh`; `layout`, `rng`, `world`, `run` modes | mac | done | `15 passed in 0.55s` (`tests/test_driver.py`) | COMMIT2A | Canonical state = **6880 bytes**, packed LE, 47 fields; `cc_ref layout` prints the table and `common/parity.js` must reproduce it byte for byte. Driver exits non-zero if its `cc_step_no_reset` transcription ever disagrees with the real `puf_step`. `reference/build/` is gitignored — every C gate builds it first. Random-action episodes die in ~140 steps, so the corpus (3a) needs the scripted policies to reach late-game branches. |
| 2b | Same build on FASRC; 100-episode self-diff mac vs cluster | cluster | todo | | | depends on 2a |
| 3a | Corpus policies in Python against the driver; action files committed | mac | todo | | | depends on 2a |
| 3b | Golden hash chains; C coverage of game functions 100% | mac | todo | | | G3 half |
| 4a | `common/f32.js`, `rng_pcg32.js`, `u64bits.js`, `parity.js` | mac | todo | | | G0 |
| 4b | `10_constants.js`, `20_state.js`; layout test vs `cc_ref layout` | mac | todo | | | |
| 5 | `30_worldgen.js` | mac | todo | | | G1, 1000 seeds |
| 6a | `40_player.js` | mac | todo | | | lockstep on forager episodes only |
| 6b | `50_mobs.js` | mac | todo | | | lockstep on random + sticky |
| 6c | `60_world_tick.js`, `70_step.js` | mac | todo | | | G2 whole corpus |
| 7a | `tools/bundle_multifile.py`, `just bundle`; bundle-fresh test | mac | todo | | | |
| 7b | Second games root + sidecar loading (PLAN 3.1, 3.2) in Python and node envs | mac | todo | | | the only runtime edit |
| 8a | `80_render.js`, `90_playtrain.js` | mac | todo | | | |
| 8b | `tools/validate.py --game craftax_classic` with 17 actions | mac | todo | | | G5 |
| 9 | `gate_qjs.sh`, `gate_async.py`, AOT tier with the sidecar action table | mac + cluster | todo | | | G4 |
| 10a | Study harness reads sidecar actions and pacing | mac | todo | | | |
| 10b | Human quickplay session, replay-verified | human | handoff | | | G6 |
| 11 | Website: third source dir, overlay, label | human | handoff | | | agent builds; human checks the page |
| 12 | Throughput bench on paper node; first PPO run | cluster | todo | | | after 9 |
| 13 | Symbolic obs mode (PLAN 3.6) | mac | todo | | | after 6c and 7b |

## Log

Newest first. One line per iteration: date, task, what happened.

- 2026-09-14 — 1a — vendored PufferLib @6ffa5b1 into `games/craftax_src/`, byte-identical (git blob ids checked against the commit tree); README records sha256 + upstream path per file; PLAN.md path corrected.
- 2026-09-14 — 1b — `multifile/README.md` (the tree's contract: bundle-step-only rule, what earns `parity/`, dist/bundler rules, "tools read manifests not directory names"); game README with provenance / exact / not-matched / gates / quirks; PufferLib row + section in `THIRD_PARTY_LICENSES.md`; skeleton dirs created.
- 2026-09-14 — 2a — driver + `stubs/{raylib,ini}.h` + `build.sh` + `v8_shim.cc`; four modes work; 5619 steps cross-checked against the real `puf_step` across 40 seeds. PLAN 4.2 corrected on three points (ini.h stub, v8libm not frozenmath, the transcription requirement) and 1.4's frozenmath path fixed.
