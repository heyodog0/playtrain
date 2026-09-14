# Progress ledger

Statuses: `todo`, `in-progress`, `done`, `blocked`, `handoff`. One row per task
from PLAN.md section 11, split into sub-tasks where a task has more than one gate.
The agent edits only the status, gate, commit, and notes columns. Add rows for
sub-tasks under the parent; never delete rows.

| # | Task | Where | Status | Gate result | Commit | Notes |
|---|---|---|---|---|---|---|
| 1a | Vendor `games/craftax_src/` at commit 6ffa5b1 with LICENSE and README | mac | done | `shasum -a 256 -c`: 6/6 OK; git-blob ids match the pinned tree | f8d38ed | 5 headers + LICENSE + README in `games/craftax_src/`. `craftax_parity.h` deliberately not vendored (PLAN 2 layout). PLAN.md corrected: upstream has no `pufferlib/` prefix. `craftax_classic.h` includes `raylib.h` and `pufferenv.h` only — so 2a needs a `raylib.h` stub; `ini.h` is not included by the Classic header. |
| 1b | `THIRD_PARTY_LICENSES.md` row; `multifile/README.md`; directory skeleton | mac | done | no pytest gate; skeleton matches PLAN 2 layout, TPL row + PufferLib section added | e605ff8 | Also wrote `parity/craftax_classic/README.md` with the empty **Reference quirks** table — quirks found later go there. Empty dirs hold `.gitkeep` files whose text says which task fills them; delete each when its task lands. |
| 2a | `cc_ref_driver.c`, stubs, `build.sh`; `layout`, `rng`, `world`, `run` modes | mac | done | `15 passed in 0.55s` (`tests/test_driver.py`) | f4360be | Canonical state = **6880 bytes**, packed LE, 47 fields; `cc_ref layout` prints the table and `common/parity.js` must reproduce it byte for byte. Driver exits non-zero if its `cc_step_no_reset` transcription ever disagrees with the real `puf_step`. `reference/build/` is gitignored — every C gate builds it first. Random-action episodes die in ~140 steps, so the corpus (3a) needs the scripted policies to reach late-game branches. |
| 2b | Same build on FASRC; 100-episode self-diff mac vs cluster | cluster | done | `19 passed in 5.74s` (`tests/test_selfdiff.py`) | a647941 | **arm64 Mac and x86_64 FASRC agree bit-for-bit** on all 100 episodes / 17705 steps, despite different `-march` and different per-arch V8 FMA settings — Craftax's `cosf` inputs never hit the 1 ULP arm/x86 divergence `native/build_qjs.sh` warns about. The `cosf`/`sinf` redirect had to move from `-D` on the command line into `cc_ref_driver.c`: glibc's `math.h` token-pastes `__DECL_SIMD_` onto the function name, so the command-line form dies inside `/usr/include/math.h` (Apple libc does not, so it only broke on FASRC). Cluster scratch tree: `/n/home06/truong/craftax_selfdiff` (the live tree was left untouched). Cluster `python3` is 3.6 — use `/usr/bin/python3.12`. |
| 3a | Corpus policies in Python against the driver; action files committed | mac | done | `25 passed in 6.64s` (`tests/test_corpus.py`) | 03c01de | 210 episodes / 48561 steps in `traces/corpus/`, manifest `traces/corpus.json`. Needed a new driver mode, `cc_ref serve` (one action in, one canonical dump out), so policies can decide from the C's own state. **Two gaps 3b must close:** (a) only **15/22** achievements reached — missing `collect_coal`, `collect_iron`, `collect_diamond`, `make_iron_pick`, `make_iron_sword`, `defeat_skeleton`, `eat_plant`; (b) **every** episode terminates by health, so neither the timeout nor the lava terminal branch is in the corpus. Lava is unreachable by construction (quirk 1); a timeout episode needs a survive-and-idle policy, which PLAN 4.3's table does not list — adding one is a PLAN change, so 3b should decide it. |
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
- 2026-09-14 — 2b — built on FASRC (clang 21.1.8, x86_64); fixed the glibc math.h clash; `traces/selfdiff_{arm64,x86_64}.txt` committed and identical; gate also re-derives this machine's digest so a drifted local build cannot pass.
- 2026-09-14 — 3a — `ccstate.py` (layout-driven dump decoder + `Serve`), `policies.py` (5 policies), `build_corpus.py`; `cc_ref serve` added to the driver. Two reference quirks documented in README: lava never generates (0 cells in 500 seeds), and the sand band's upper bound is dead code.
