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
| 3b-i | Golden hash chains (`traces/golden/*.fnv`, `golden.json`) | mac | done | `31 passed in 7.49s` (`tests/test_golden.py`) | d170ae4 | 210 chains, 49061 steps, 13 bytes/step (state hash + reward bits + done). CI-checkable without a compiler; the C-present half replays every episode and reports the first diverging step. |
| 3b-ii | G3: every `ACH_*` fires, every action index appears, C game-function coverage 100% | mac | blocked | C game-function line coverage **96.43% (567/588)**; 18/22 achievements | | **Exact blocker below.** Do not write `tests/test_coverage.py` until the corpus closes it — a green gate over a corpus that misses these lines would be the gate lying. |
| 4a | `common/f32.js`, `rng_pcg32.js`, `u64bits.js`, `parity.js` | mac | done | `35 passed in 38.11s` (`tests/test_rng.py` = G0) | 025b350 | G0 green: 10^6 draws on one seed and 16 draws on each of 1000 seeds, all five columns (pcg, rf bits, ri4/8/64) identical to the C. 64-bit LCG is two uint32 words in 16-bit limbs, no BigInt. `cc_ref rng` now prints 5 columns, not 3. **Use `tests/jsrun.py`, never `node -e`** — under eval a top-level `const`/`class` is invisible to later snippets while `function` leaks, which is not how the concatenated bundle behaves. `parity.js` ships `ParityWriter` + `fnv1a64`; 4b wires it to the real state buffer and checks it against `cc_ref layout`. |
| 4b | `10_constants.js`, `20_state.js`; layout test vs `cc_ref layout` | mac | done | `40 passed in 38.15s` (`tests/test_layout.py`) | 627ae56 | JS dump = **6880 bytes**, field for field identical to `cc_ref layout` (name, offset, size, type, count). **Storage order is not dump order**: typed-array views need natural alignment and the packed dump puts a float32 at offset 6674, so the buffer groups fields 4-byte / 2-byte / 1-byte (6876 bytes) and `PARITY_ORDER` reorders on the way out. `PARITY_ORDER` is the table that must match the C — edit it, not the storage tables, when a field moves. The gate also writes a sentinel into each field in turn and checks the bytes land only in that field's span, which is what catches two same-width fields swapped. |
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
- 2026-09-14 — 3b — forager rewritten as a monotonic phase machine (the old recompute-from-inventory version oscillated between wood and stone and died mid-swing); survival core corrected. Corpus regenerated: 15 -> 18 achievements. Golden chains built and gated. G3 coverage measured and blocked; see below.

## 3b-ii blocker: the 21 uncovered lines

*(Still open. 4a was taken next because the loop skips blocked tasks.)*

Measured with a `--coverage` build of the driver over all 210 corpus episodes
(`clang -O0 --coverage`, then `gcov -b`). Restricted to the game functions
(`craftax_classic.h` lines 236-1011, so excluding `puf_render` and `puf_log`):
**567/588 lines = 96.43%**. The whole header reads 79.45% of 730 lines, but the
difference is the render path, which G3 excludes.

Every uncovered line traces to one of four unreached achievements:

| Lines | Code | Needs |
|---|---|---|
| 508-509, 513-514 | `make_iron_pick`, `make_iron_sword` bodies in `do_crafting` | a table **and** furnace adjacent while holding wood, stone, iron and coal |
| 547-554 | attacking a skeleton in `do_action` | a skeleton adjacent; they only spawn on `BLK_PATH`, which only exists where stone has been mined |
| 582-586 | collecting diamond in `do_action` | an iron pickaxe, so it is downstream of the two above |
| 718-720 | skeleton despawn at `MOB_DESPAWN_DIST` | a skeleton spawned, then the player walking 14 away from it |

`puf_close` (line 1011) was also uncovered and is now called by the driver.

**Why the corpus does not get there.** Distance is not the constraint: from
spawn, tunnelling included, stone is ~20 cells away, coal ~30, iron ~30 and
diamond ~30 on every seed measured. The constraint is survival. The forager
reliably reaches stone tools (18/22 achievements, `make_stone_pick`,
`make_stone_sword`, `place_furnace`, `place_stone` all covered) but usually
dies between 200 and 900 steps, and only 1 seed in 20 reaches iron ore at all.
Deaths are combat, not starvation — zombies, three at a time at night, against
a 5-health-per-zombie / 2-damage-per-swing arithmetic.

**Tried and measured, so the next iteration does not repeat it:**

- Best-of-6 random restarts per world seed over all 30 forager seeds: union
  stays at **18/22**, best single episode 17. Variance is not the answer.
- Fleeing from zombies instead of fighting: worse. A zombie closes with
  p=0.75 per step, so it matches the player's speed and running only defers
  the fight with less health.
- Survival thresholds at 7 instead of 4: worse — the agent shuttles between
  water and cows and never prospects. At 4 it starves. 6 is the current value.
- Stockpiling 6 wood + 6 stone before the ore trip: worse (14/22); the
  stockpile consumes the lifespan.
- Walking back to an existing table+furnace instead of rebuilding: no change.

**What is most likely to work next.** The agent needs to survive the night
rather than out-fight it. Zombies spawn only on `BLK_GRASS` and `BLK_PATH`
(`try_spawn`, and note the `!need_grass && !need_path` branch still requires
one of the two), and `can_move_mob` refuses solid blocks — so a player sealed
inside mined stone is unreachable. A "burrow at dusk" behaviour (mine into a
stone mass, place stone behind, idle until `light_level` recovers) should turn
the 200-900 step lifespan into a full 10000-step episode, which would also
produce the first `timeout` terminal the corpus lacks. Skeleton coverage
follows for free, since burrowing creates the `BLK_PATH` they spawn on.

Second, smaller thing: **no episode reaches the step cap**, so the
`timestep >= MAX_TIMESTEPS` terminal is untested too. All 210 end by health.
PLAN 4.3's policy table has no survive-and-idle policy; adding one is a PLAN
change and should be decided explicitly, not slipped in.
- 2026-09-14 — 4a — four `common/` modules written and gated. FNV-1a 64 and the writer checked against Python; RNG checked against the C on 1_000_000 + 16000 draws.
- 2026-09-14 — 4b — constants mirrored from the header; state as one ArrayBuffer with typed views (Int8Array gives C's int8_t wrap for free, which the un-clamped health field needs); `getParityState` + layout gate green.
