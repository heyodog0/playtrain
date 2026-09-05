# HANDOFF 2026-09-05 — the tier-3 measurement cascade, submitted UNPINNED

Continues `HANDOFF-2026-09-04-round6-E6-adoption-done.md` (step 4c, "measurement
cascade — not started") and replaces the adv1 absolutes in
`HANDOFF-2026-09-04.md` §1. Nothing here is a number yet: this file records what
was submitted, what each job loads, and what was reused rather than re-measured.
Read `HANDOFF-2026-09-04.md` §§1-2 for the edit checklist the results feed.

**Ryan's constraint for this round: NO NODE PINS.** No `--nodelist`, no `-w`, on
anything. Class constraints only (`-C genoa`, `-p sapphire`, `-p kempner_h100`).
Speed into the queue beat same-node purity. Every job therefore carries **adv2
as an in-job reference arm**, so tier3/adv2 ratios are same-node by
construction even though absolutes depend on where each job landed. Record the
node with every absolute — the node is printed as the first line of each log.

## 1. Jobs

| job | measures | partition / node it landed on | arms | wall |
|---|---|---|---|---|
| **44515188** `tier3_fig4a` | **Fig 4A env-only scaling absolutes.** 24 games, w=16 × 3 trials and w=2/4/8 × 2 trials (10/20/40/80 env threads), 128 envs/worker, 5 env-threads, 300 steps, `--no-model --device cpu --frame-skip 1 --max-steps 2000` | serial_requeue `-C genoa --mincpus=96 --exclusive`, landed **holy8a28510** (EPYC 9654, 192 CPU) | adv2, tier3 | ~45 min, `-t 8:00` |
| **44515373** `tier3_pcd` | **Fig 4 panels C/D single-core** (24 games × 7 trials, `bench 0 100000`) **and the backend-ladder QuickJS rung** (24 games × 3, `bench 0 80000`) | sapphire `-c 1`, landed **holy8a32608** (Xeon 8480CL — same class as the adv sweeps' holy8a32607) | adv2 host, tier3 host, plus adv2 on the node-gym games dir | ~1.5 h, `-t 2:30` |
| **44515752** `tier3_table1a` | **Table 1(a), all four PlayTrain-only rows**, 24 games each, ONE GAME PER PROCESS | kempner_h100, landed **holygpu8a13301** (4×H100, EPYC 9454) | tier3 on all four rows; adv2 additionally on IMPALA+Nature | `-t 20:00` |
| **44516162** `tier3_pg_ab` | **Table 1(b) ProcGen swap**, 16 games, all in one job | kempner_h100, pending at write time | adv2, tier3, real ProcGen (EnvPool) | `-t 8:00` |
| **44516167** `tier3_ale_ab` | **Table 1(b) ALE swap**, 8 games | kempner_h100, pending at write time | adv2, tier3, real ALE (EnvPool) | `-t 6:00` |

Scripts are in `analogen-jaxbench/`: `tier3_fig4a.sbatch`,
`tier3_panelc_ladder.sbatch`, `tier3_table1a.sbatch`, `tier3_pg_ab.sbatch`,
`tier3_ale_ab.sbatch`. Results land in
`analogen-jaxbench/outputs/tier3_*_<jobid>/` and each job prints its own
summary table (geomeans, per-game, tier3/adv2) at the end of its log in
`analogen-jaxbench/logs/`.

## 2. What each arm loads, and how that is enforced

- **adv2** = `playtrain-wt-tuning/native/build/variants/libqjs_vec.adv.so`,
  md5 `1c5149364c32fb58ce9b81cda49fa763`; single-core host
  `playtrain-wt-engine/native/aotfork/out/qjs_host.adv`, md5
  `5dcce14f4dfddc59a6b0f4e33d8a3127`. Every job hard-gates both md5s at start
  and exits 2 on mismatch.
- **tier3** = the per-game compile-at-load production binaries in
  `playtrain-wt-engine/native/aotfork/out/`: `libqjs_vec.futIT2_<game>.so` for
  the vec path, `host_f1IT2_<game>` for the single-core path. All 24 verified
  present (both tiers' hosts too) before any job was written.
- **`QJS_DIRTY=1` on every PlayTrain arm**, every job.
- **Job-private shadow tree.** No job writes a shared tree.
  `$TMPDIR/pttree_<jobid>/` gets a REAL copy of `$WT/src`, `$WT/runtime`,
  `pyproject.toml` (native_vec_env resolves symlinks, so a linked `src` escapes
  to the worktree) plus `native/build/libqjs_vec.so`. A Python gate asserts
  `nve._LIB_PATH` starts with the shadow path, that its md5 is adv2's, and that
  `QJS_DIRTY` is set — before any measurement. Confirmed passing in 44515188 /
  44515752 logs.
- **Per-game swap, gated per swap.** `bench_vec_rollout.py` has **no
  `--lib-path`** (only `bench_vec_knobs.py` does — that is what the E6 bank
  used). Since Fig 4A and Table 1 must use the same harness as the adv curve,
  every job re-copies the intended `.so` over the shadow tree's
  `libqjs_vec.so` before each run and md5-compares source against destination,
  aborting the job on mismatch. The per-run md5 is echoed on the `=== <game>
  <arm>` line, so the log itself is the provenance record.
- `PLAYTRAIN_AOT=off` is exported everywhere. It is a no-op for the tuning
  tree (no `aot_cache`), and belt-and-braces if `PYTHONPATH` ever picks up the
  engine tree: the resolver must never override the explicit shadow `.so`.

## 3. Reused, not re-measured

All binary-independent and re-measured on 2026-09-01 on the same class
(sapphire, holy8a32607; jobs 43783363/64/67, scripts `~/sweep4_adv.sh`,
`~/sweep6_adv.sh`, `~/sweep7_adv.sh`):

- ProcGen C++ per-core baseline — `~/procgen4_adv.json`
- ALE per-core baseline — `~/ale_atari6_adv.json`
- Backend-ladder Playwright (**502**) and Node/V8 (**4,374**) rungs —
  `~/backend_ladder_fasrc_adv.json`. Only the QuickJS rung is re-measured.

44515373 asserts all three files exist before it measures anything and folds
them into its own summary, so the ladder and panel C/D ratios come out of the
job directly.

Also reused: nothing else. Every PlayTrain number in the cascade is new.

## 4. Scripts adapted, and how

- `tier3_fig4a.sbatch` — from `analogen-jaxbench/adv_anchor.sbatch`. Same
  harness, topology, trial counts and flags. Two changes: arms are adv2/tier3
  instead of live/adv, and the `.so` goes into a job-private shadow tree
  instead of being `cp`'d over `$WT/native/build/libqjs_vec.so` (adv_anchor
  and final_any both mutate that shared path while they run — never trust the
  worktree default).
- `tier3_panelc_ladder.sbatch` — from `benchmarks/as_run/sweep_procgen16.sh` /
  `sweep_atari8.sh` / `sweep_backend_ladder.sh` and their `_adv` re-runs. Same
  partition class, `-c 1`, 7 trials, `bench 0 100000` (ladder: 3 × `bench 0
  80000`). Panel C/D and the ladder QuickJS rung are merged into one job so
  both arms share one core on one node.
- `tier3_table1a.sbatch` — from `suite_mps_adv.sbatch` (IMPALA+Nature config:
  `_mk_sweep_cfg pt_bigfish_nature_fullnode.json 15 5 256`),
  `icnn_suite24_adv.sbatch` (ICNN template
  `playtrain-trainers/configs/impala_fullnode_throughput.json`) and
  `ppo_suite24_adv.sbatch` (the PPO template builder, verbatim). No
  `--nodelist` anywhere; the `--exclude` list of five bad nodes is kept.
- `tier3_pg_ab.sbatch` / `tier3_ale_ab.sbatch` — from
  `playtrain-trainers/benchmarks/baselines/as_run/run_procgen_ab_adv16.sh` /
  `run_ale_ab_adv.sh`, verbatim except: a third arm (tier3) per game, separate
  `log_dir`s per arm so the TB verifier cannot pass on a stale event file, a
  fresh `pgt3_` / `alet3_` verdict prefix so the aggregator cannot fold in the
  adv1 verdicts, and (ProcGen) all 16 games in one job rather than 8+8. Those
  scripts never had a `--nodelist` — the pin was applied at submit time — so
  nothing had to be stripped.

## 5. The one real design decision: one game per process

Table 1(a) rows were run as a 24-game in-process loop. That is impossible here
for **two** independent reasons, so every row in 44515752 runs one game per
`python` invocation inside a single allocation:

1. **tier 3 is a per-game binary.** A single process cannot swap
   `libqjs_vec.so` between games.
2. **The in-loop form hangs under the ICNN encoder** — 44162619 failed 20/24
   (game 1 passed, every later game hung at `step=0` with workers alive; GPU/MPS
   state is not released between games). The published ICNN row had the same
   defect; `icnn_suite24_adv_array.sbatch` worked around it with a Slurm array.

A serial per-game process gives the array's fresh process tree **and** keeps all
four rows on one node — which is what Table 1 actually needs — without a pin.
That is why the array form was not reused here.

## 6. What is NOT covered, and the known risks

- **Table 1(a) has an adv2 reference arm on the IMPALA+Nature row only.** A
  second arm on all four rows is roughly another 14 h of H100 time and does not
  fit one allocation. The other three rows have tier3 absolutes on a known node
  and the Nature row's same-node tier3/adv2 ratio to calibrate against. If Ryan
  wants full four-row adv2, it is a second job on the same script with the arm
  loop widened — but it will not be the same node.
- **The ALE swap row is unpinned by instruction and its absolutes may move.**
  The adv re-measure (44161947) was deliberately pinned to holygpu8a15204
  because an unpinned attempt (43783185) landed on another class and came out
  ~35% low in absolutes while its ratio was fine. Expect the same failure mode
  here. The ratio is the defensible number; the absolute needs the node
  recorded, and if the ProcGen/ALE baseline arm in the job does not reproduce
  ~372.5k / ~171.4k, the node class did not match and the absolutes must not go
  in the table.
- **Games-dir discrepancy (new, worth knowing).** `maze` and `freeway` differ
  between `playtrain/examples/games/js` (which the tier binaries were built
  against, and which the E6 bank used) and `~/node-gym-smoke/node-gym/examples/
  games/js` (which the published and adv panel-C/ladder sweeps used). The other
  22 are byte-identical. 44515373 therefore takes both panel-C arms on the LIVE
  dir and additionally runs adv2 on the node-gym dir for all 24, so the
  published-protocol absolutes stay bridgeable and the size of the discrepancy
  is measured rather than assumed.
  **Which copy is current: the LIVE tree's, for both.** Live maze/freeway are
  dated 2026-08-24/25 and are byte-identical to repo `main`
  (maze `004b673f…`, freeway `b240938e…`, history `817082d` / `a69ea3c` /
  `e116b04`); node-gym-smoke's are 2026-07-12, from its single "initial commit",
  with no later commit touching either. The diffs are gameplay, not cosmetics:
  maze now samples the maze size per level (9-21, centred in a fixed world) to
  reproduce ProcGen's curriculum, picks the goal uniformly among open cells
  rather than at max BFS distance, and forbids diagonal movement — that is the
  change that put the random baseline at 41% against real ProcGen's 44%;
  freeway moved to ALE's model (one life, a collision knocks you back one lane
  instead of ending the run) with slower, sparser cars (1.0-3.0 and 1-2 per
  lane, was 1.5-5.0 and 1-3). Both also change per-step cost, so **the
  published AND the adv1 panel-C/ladder QuickJS numbers for maze and freeway
  were measured against superseded games** — a staleness independent of the
  binary. The ProcGen/ALE baselines are unaffected. Do not carry those two
  per-game QuickJS values forward; take them from 44515373, which runs the
  live dir.
  **Games-dir resolution was verified for all five jobs, and every PlayTrain
  arm reads the LIVE tree** — i.e. the current maze and freeway. 44515188 and
  44515373 pass the live path explicitly; the trainer jobs get it from the
  as-run configs' `vec_games_dir` / `native_games_dir`
  (`../playtrain/examples/games/js`, relative to the process CWD, which is
  analogen-jaxbench for Table 1(a) and playtrain-trainers for the swap rows —
  both land on the live tree). `bench_train_suite.py` / `bench_ppo_suite.py`
  overwrite only `cfg["game"]`, never the dir. Note `suite_mps_adv.sbatch`
  exports `NODE_GYM_GAMES_DIR=$(pwd)/games/js`; that dir holds only the
  `analogen_*` research games and the string appears nowhere in the playtrain
  source, so the export is inert and was inert for the adv1 runs too. It is not
  set in `tier3_table1a.sbatch`. All templates carry `frame_skip: 1`.
- **serial_requeue can requeue 44515188.** If it restarts, the whole job
  re-runs from scratch on a possibly different node; that is fine (both arms
  restart together) but check the node line before using the absolutes.
- Nothing was run against `playtrain` (the live tree) or written into
  `playtrain-wt-engine/native/aotfork/out`. No `uv sync`. No job that was not
  submitted here was touched.

## 7. Early sanity, first data point

44515188, bigfish, w=16, three interleaved trials: adv2 8.75M / 8.75M / 8.69M
env steps/s, tier3 10.15M / 10.20M / 10.22M — 1.166×. bigfish is one of the
fast host-bound games (tier 2 was 1.13 there in the E6 bank), so this is on the
expected curve, not a surprise.

## 8. Next actions

1. Collect the five summaries. Each job prints its own; the raw JSONs are in
   `analogen-jaxbench/outputs/tier3_*_<jobid>/`.
2. Replace the adv1 absolutes in `HANDOFF-2026-09-04.md` §1 with the tier-3
   ones, keeping the EnvPool arms as they are (binary-independent), and work
   the §2 edit checklist.
3. Figure pipeline: new raw files into
   `playtrain-paper/results/env_throughput/`, and update `_EXPECTED_PROCGEN` /
   `_EXPECTED_ATARI` in BOTH `tools/plot_throughput_all.py` and
   `tools/throughput_panels.py` (they checksum-guard the published values).
4. Watch the mean-type trap in `HANDOFF-2026-09-04.md` §1: the figure and the
   prose use the GEOMEAN. Never print the arithmetic mean.

## 9. Commands

```bash
fasrc 'sacct -j 44515188,44515373,44515752,44516162,44516167 -X -o JobID,JobName%18,Partition,State,Elapsed,NodeList'
fasrc 'A=/n/holylabs/gershman_lab/Users/rtruong/analogen-jaxbench/logs; tail -60 $A/tier3_fig4a_44515188.out'
fasrc 'A=/n/holylabs/gershman_lab/Users/rtruong/analogen-jaxbench/logs; tail -80 $A/tier3_pcd_44515373.out'
fasrc 'A=/n/holylabs/gershman_lab/Users/rtruong/analogen-jaxbench/logs; tail -60 $A/tier3_table1a_44515752.out'
fasrc 'A=/n/holylabs/gershman_lab/Users/rtruong/analogen-jaxbench/logs; tail -50 $A/tier3_pg_ab_*.out $A/tier3_ale_ab_*.out'
```

---

## 10. RESULTS — the two CPU jobs are DONE and these numbers are final

44515188 COMPLETED in 20:53 on holy8a28510 (432/432 runs).
44515373 COMPLETED in 35:03 on holy8a32608 (504 + 144 raw lines).

**Validation first: the adv2 reference arm reproduces the adv1 cascade**, so the
unpinned nodes matched the class and every reused baseline is valid.

| quantity | adv1 (HANDOFF-2026-09-04 §1) | adv2 here | agreement |
|---|---|---|---|
| Fig 4A ProcGen16 curve | 290,228 / 582,092 / 1,161,420 / 2,325,995 | 291,016 / 582,548 / 1,162,569 / 2,331,893 | within 0.3% |
| Fig 4A ALE8 @80 | 5,308,537 | 5,308,804 | within 0.01% |
| Panel C geomean / arith / wins | 1.35 / 1.87 / 10 of 16 | 1.341 / 1.831 / 10 of 16 | exact |
| Panel D (6-game protocol) | 8.1x | 8.20x | 1.2% |
| Ladder QuickJS rung | 37,350 | 37,850 | 1.3% |

### 10.1 Figure 4A — env-only scaling, geomean env steps/s at 10/20/40/80 threads

| arm | ProcGen16 | ALE8 @80 |
|---|---|---|
| **PlayTrain tier3** | **453,493 / 909,788 / 1,812,814 / 3,642,545** | **7,355,750** |
| PlayTrain adv2 (reference) | 291,016 / 582,548 / 1,162,569 / 2,331,893 | 5,308,804 |
| EnvPool tuned (REUSE, unchanged) | 355,451 / 587,070 / 931,786 / 1,413,748 | 350,601 |
| EnvPool as-shipped (REUSE, unchanged) | 178,217 / 278,042 / 417,106 / 468,997 | 238,829 |

ALE8 tier3 full curve: 918,228 / 1,827,240 / 3,645,279 / 7,355,750.

- Headline at 80 threads: **2.58x ProcGen / 20.98x ALE** vs tuned (was 1.64x / 15.1x);
  **7.77x / 30.8x** vs as-shipped (was 5.0x / 22x).
- Scaling per doubling: 2.01 / 1.99 / 2.01 (ProcGen16), 1.99 / 1.99 / 2.02 (ALE8).
- **THE CROSSOVER IS GONE.** tier3 vs EnvPool tuned is 1.28x / 1.55x / 1.95x /
  2.58x — PlayTrain now wins at every thread count. The adv-era concession
  ("EnvPool tuned WINS at 10 threads and ties at 20 — the claim is about
  scaling, and conceding that point is what makes it defensible") no longer
  describes the data and must be rewritten, not just re-numbered. §2 line ~540
  and the panel-A caption both depend on it.

### 10.2 Panel C — per-core vs ProcGen C++ (16 games, 7 trials)

geomean **1.35x -> 2.185x**; wins **10 of 16 -> 14 of 16** (so "remaining six"
becomes "remaining two"); arithmetic mean 1.831 -> 2.795 (**never print this**,
see the mean-type trap). tier3/adv2 on this panel is 1.630.
Losses are now only chaser (0.99) and climber (0.74).

### 10.3 Panel D — per-core vs ALE

Published **6.95x** -> adv1 8.1x -> **tier3 11.98x** on the published 6-game
protocol (`qbert seaquest pong breakout space_invaders frostbite`, which is
what `sweep_atari8.sh` actually geomeans — it drops freeway and asteroids).
Over all 8 games with a baseline it is **12.62x** (adv2 8.85x). Quote 11.98x
unless the protocol is deliberately widened; say which.

### 10.4 Panel B — backend ladder (24 games)

Playwright **502** and Node/V8 **4,374** REUSED unchanged; QuickJS rung
**37,350 (adv1) -> 58,827 (tier3)**.
Ladder reads **502 / 4,374 / 58,827**: PW->V8 8.7x, **V8->QJS 13.4x** (was
8.5x), **PW->QJS 117x** (was 74x).

### 10.5 The games-dir effect, now measured

Only **maze** and **freeway** differ between the live tree and node-gym across
all 24 (full md5 sweep). Same-node, same-binary (adv2), mean of 7:

| game | live | node-gym | ng/live |
|---|---|---|---|
| maze | 16,098 | 17,944 | 1.115 |
| freeway | 128,363 | 108,688 | 0.847 |

The cross-check's noise floor is ~3% (caveflyer, byte-identical, read 1.030),
so both are real. The live maze is 12% SLOWER (the ProcGen-matched curriculum
draws more) and the live freeway 18% FASTER (fewer, slower cars). Panel C/D use
the live dir, which is correct and current — but it means part of panel D's
adv-to-tier3 movement is the freeway file, not the binary. Panels quoted above
are all live-dir.

### 10.6 What is still pending

Only the three GPU jobs — Table 1(a) 44515752 (ETA ~12:00-13:00), Table 1(b)
ProcGen 44516162 (~05:40) and ALE 44516167 (~02:45). Early per-game reads have
tier3/adv2 at 1.030 (bigfish), 1.070 (bossfight), 0.994 (pong), 1.028
(freeway) — i.e. a 1.5x faster environment buys ~0-7% once the trainer is
attached, which strengthens rather than weakens the trainer-bound explanation
near line 539.

### 10.7 Figure-pipeline mechanics

`playtrain-paper/tools/plot_env_efficiency.py` draws panels (b)-(d) through
`throughput_panels.py`, which derives them from the committed per-trial files in
`playtrain-paper/results/env_throughput/` (`qjs_raw4.txt`, `procgen4.json`,
`qjs_atari6_raw.txt`, `ale_atari6.json`, `backend_ladder_fasrc.json`,
`pw_fasrc.json`) and **hard-fails** against the `_EXPECTED_PROCGEN` /
`_EXPECTED_ATARI` tables (game, qjs_mean, qjs_std, base_mean, base_std). So
updating those panels is two mechanical steps: drop in the new raw files, then
regenerate both `_EXPECTED_*` tables. The new per-trial raw is
`analogen-jaxbench/outputs/tier3_pcd_44515373/raw_panelc.txt` (format:
`arm game trial steps_per_s`; take the `tier3` rows) and `raw_ladder.txt`.
The ProcGen/ALE baseline JSONs do not change.

## 11. Where the Fig 4A data is, for regenerating the figure

Three different things live in three places; the `ab_pt_*` glob only matches the
OLD published run, which is why searching for it finds nothing new.

| what | where |
|---|---|
| **new tier3 + adv2 per-trial raw** | `analogen-jaxbench/outputs/tier3_fig4a_44515188/` — 432 files `<game>_<arm>_w<W>_r<R>.json`, each a 1-element list with `workers` / `decisions_per_s`. arm in {adv2, tier3}, W in {2,4,8,16}, R in {1,2,3} |
| **new data in `ab_` schema** (generated 2026-09-05, ready for `load_scaling`) | `analogen-jaxbench/outputs/tier3_ab_44515188/` — 48 files, `ab_pt_<game>_44515188.json` (tier3) and `ab_ptadv2_<game>_44515188.json` (adv2), 24 games each, medians over trials, 4 thread points |
| **old published panel-A A/B run** | `playtrain-trainers/results/ab_{pt,ep}_<game>_38145651.json` (ProcGen16) and `_39032276.json` (ALE8) — superseded, but the only per-game EnvPool arm in `ab_` schema |

**The fastest path is not `load_scaling` at all.** The adv-era panel A was
already redesigned and lives in `handoff/fig_preview_2026-09-03/plot_4a_adv.py`
(plus `plot_env_efficiency_2arm.py` / `plot_env_efficiency_bestonly.py` for the
two treatments in §4 decision 1). Those scripts **hardcode the curves in a
`DATA` dict** — no file loading. Updating to tier 3 is a two-line edit:

```python
"procgen": {"PlayTrain": [453493, 909788, 1812814, 3642545], ...}
"ale":     {"PlayTrain": [918228, 1827240, 3645279, 7355750], ...}
```

Both EnvPool rows stay exactly as they are — binary-independent, not re-measured:
ProcGen documented-best `[355451, 587070, 931786, 1413748]`, as-shipped
`[178217, 278042, 417106, 468997]`; ALE documented-best `[45662, 89285, 177869,
350601]`, as-shipped `[38478, 73884, 141421, 238829]`.

Ratio per thread point under tier 3 — ProcGen **1.28 / 1.55 / 1.95 / 2.58x**,
ALE **20.1 / 20.5 / 20.5 / 21.0x**. ProcGen climbs because EnvPool flattens;
ALE is flat because both scale, PlayTrain just starts 20x up.

`plot_env_efficiency.py`'s panels (b)-(d) are a separate pipeline — see §10.7.

## 12. CORRECTION — the thread grid was too coarse; job 44545120 fixes it

**Ryan caught this.** Job 44515188 measured 10/20/40/80 env threads. The
PUBLISHED panel A used **seven** points — 5, 10, 20, 30, 40, 60, 80 — for both
arms and both suites, verified directly from the as-run files:

```
ProcGen16  pt/ep  job 38145651  threads=[5, 10, 20, 30, 40, 60, 80]
ALE8       pt/ep  job 39032276  threads=[5, 10, 20, 30, 40, 60, 80]
```

The 4-point grid entered in the adv-era redesign
(`handoff/fig_preview_2026-09-03/plot_4a_adv.py` hardcodes `T = [10, 20, 40,
80]`, and HANDOFF-2026-09-04 §1 lists 4-point curves); this round inherited it
from the brief. It is a resolution regression against the published figure, and
5/30/60 are exactly where the crossover and EnvPool's flattening are legible —
the two things panel A exists to show.

**Job 44545120** (`tier3_fig4a_full.sbatch`) restores the published grid, all
four arms in ONE job so the whole panel is same-node:

| arm | what |
|---|---|
| PlayTrain tier3 | `libqjs_vec.futIT2_<game>.so`, per game, md5-gated per run |
| PlayTrain adv2 | reference arm |
| EnvPool tuned | async + NUMA-bound shards (final_any's `async_numa`) |
| EnvPool as-shipped | single sync pool (final_any's `sync1`) |

Workers 1/2/4/6/8/12/16 x 5 env threads, 128 envs/worker, 2 trials (3 at 80),
24 games. The EnvPool child scripts are final_any.sbatch's verbatim, with the
T loop widened to all seven points and **ALE swept too** — final_any swept
ProcGen only and took ALE at 80 alone, so the ALE EnvPool curve in
`plot_4a_adv.py` came from the older matrix and was never re-measured
alongside. Now it is, same node, same job.

Landed on **holy8a28510 — the same node as 44515188**, so the 4-point run is a
free consistency check on the 7-point one. `-t 10:00`; PlayTrain side ~40 min,
EnvPool side the bulk.

Until it lands, the §10.1 four-point numbers stand and are correct as far as
they go — 44545120 adds resolution, it does not revise them.

## 13. RESULT — Table 1(b) ALE row (job 44516167, COMPLETED 02:56:02, holygpu8a17603)

**The unpinned-node risk flagged in §6 did NOT materialise.** The in-job ALE
baseline arm reproduces the published value almost exactly, so holygpu8a17603
matched the class and the absolutes are usable, not just the ratio:

| ALE baseline geomean | source |
|---|---|
| 175k | published (job 36215614, holygpu8a15204, pinned) |
| 171,423 | adv1 re-measure (44161947, pinned to the same node) |
| **175,119** | **this job, UNPINNED** |

### Table 1(b) ALE row

| binary | PlayTrain | real ALE | ratio |
|---|---|---|---|
| published (live) | 873k | 175k | 4.99x |
| adv1 | 917,289 | 171,423 | 5.35x |
| adv2 (this job) | 934,133 | 175,119 | 5.33x |
| **tier3** | **1,017,529** | **175,119** | **5.81x** |

PlayTrain faster on 8/8 for both arms. **tier3/adv2 = 1.089** geomean.

Per game (tier3/adv2): qbert 1.267, breakout 1.178, seaquest 1.114,
space_invaders 1.069, frostbite 1.048, asteroids 1.042, freeway 1.028,
pong 0.994.

**What the baseline arm actually is (and is NOT).** The EnvPool arm here is
`configs/pt_throughput/pt_ale_<game>_envpool.json`, unchanged from the as-run
published methodology: `vec_backend: "envpool"`, **12 vec workers x 5 env
threads**, `envpool_kwargs` = 64x64 RGB, stack 1, frame_skip 1,
full_action_space. It is **NOT** the Fig 4A "EnvPool tuned" arm. Those are two
different baselines on purpose:

- Table 1(b) is a **matched swap**: both arms are the same trainer at the same
  topology, the same batch/unroll/precision/compile settings — literally the
  same config with `vec_backend` swapped. The point is to isolate the backend
  inside an otherwise identical system.
- Fig 4A's tuned arm (async `recv`/`send` over NUMA-bound shards) is a
  different PROCESS ARCHITECTURE, not a config flag. It is not selectable
  inside the trainer, so its absence here is structural, not a handicap.

**Do not let the two ratios be read as the same kind of claim** — this is the
same family of error as the panel C/D vs 4A trap in HANDOFF-2026-09-04 §1.
5.81x is a system-throughput ratio with the backend swapped at a fixed
topology; Fig 4A's 21x is env-only against a separately tuned EnvPool.

**Two measurement facts to know before quoting per-game numbers:**

1. **The reported sps is quantized.** Values move in steps of ~3,277 — one
   16,384-step batch (batch 256 x unroll 64) per 5 s log window. At the ALE
   arm's ~170k that quantum is **1.9%**, which is why breakout, frostbite and
   qbert all report 170,390.x: they are within one rung, not identical. At the
   PlayTrain arm's ~1.0M it is 0.3%, negligible. Effective resolution on the
   baseline geomean is about +/-1% — fine for a 5.81x ratio, but per-game
   baseline differences below ~2% are not real.
2. **The EnvPool arm is not limited by per-game environment cost.** Across the
   8 games it spans only 160.6k-183.5k (+/-6%, no correlation with game
   complexity) while the PlayTrain arm spans 491k-1.17M. Something
   game-independent caps it. qbert is the one game still env-bound on the
   PlayTrain side (491k adv2 / 623k tier3), which is exactly why it shows the
   largest tier3 gain (1.267) while pong shows none (0.994): tier 3 only moves
   a row where the environment is still the constraint. That is the same
   trainer-bound story as line ~539, now with a within-table demonstration.

**Minor asymmetry, inherited from the published configs:** the ALE arm runs
`full_action_space: true` -> `num_actions: 18`, the PlayTrain arm
`num_actions: 8` for pong. A slightly larger policy head on the baseline side.
Compute-negligible, but it is a real difference in the as-run pair.

## 14. Main-text edits this round forces (`ICLR-PlayTrain-Fast-LLM-VGEs/main.tex`)

Line numbers are against **origin/main 9273521**, pulled from the Overleaf-synced
repo on 2026-09-05 (`git merge --ff-only`, clean fast-forward, 0 ahead / 2 behind).
Those two commits were prose and appendix polish only — no number and none of the
sentences below changed. Per [[overleaf-github-sync]]: fetch before editing, and
after any push tell Ryan to pull in Overleaf before anyone types there.

Panels B/C/D numbers are already in the text (12.62x, 2.19x, "fourteen of the
sixteen", "remaining two", 13.4x, 117x, 20.98x, 2.58x). What the Table 1(b) ALE
result and the 7-point grid change:

| line | now says | should say | status |
|---|---|---|---|
| 521 (Table 1b) | `175k & 873k` | `175k & 1{,}018k` | **READY** (44516167) |
| 520 (Table 1b) | `372k & 618k` | pending | blocked on 44516162 |
| 539 | "5$\times$ faster than ALE on all eight" | **5.8$\times$** | **READY** |
| 539 | "15 of 16 ... 1.7$\times$ ... miner 0.81$\times$" | pending | blocked on 44516162 |
| 540 | "ALE ratio is 5$\times$ here rather than 12.62$\times$" | **5.8$\times$** | **READY** |
| 542 | "PlayTrain scale linearly while Envpool's ProcGen **and ALE** flatten ... which is remarkable" | **WRONG for ALE — rewrite, see below** | **READY** |
| 547 | "at eighty threads \texttt{fruitbot} and \texttt{miner} join them" | must be re-derived under tier 3 | blocked on 44545120 |
| 1540 / 1546 | 4 scaling rows | 7 rows | blocked on 44545120 |

### 14.1 Line 542 is factually wrong for ALE

Measured per-doubling scaling, tuned arms:

| arm | 10->20 | 20->40 | 40->80 |
|---|---|---|---|
| PlayTrain tier3 ProcGen | 2.01x | 1.99x | 2.01x |
| **EnvPool tuned ProcGen** | **1.65x** | **1.59x** | **1.52x** |
| PlayTrain tier3 ALE | 1.99x | 1.99x | 2.02x |
| **EnvPool tuned ALE** | **1.96x** | **1.99x** | **1.97x** |

**EnvPool's ALE does not flatten — it scales linearly.** Only ProcGen does.
(As-shipped ALE does droop at the last doubling, 1.69x, but the as-shipped
protocol is the thing HANDOFF-2026-09-04 §2 already said must go.)

Consequently the two suites tell *different* stories, and saying "flatten" for
both is both wrong and a wasted opportunity:

| threads | 10 | 20 | 40 | 80 |
|---|---|---|---|---|
| tier3 / tuned, ProcGen | 1.28x | 1.55x | 1.95x | **2.58x** |
| tier3 / tuned, ALE | 20.11x | 20.47x | 20.49x | **20.98x** |

ProcGen is a **scaling** result (the gap grows because EnvPool flattens); ALE is
a **constant-factor** result (~20x at every point, both scale linearly).
Suggested replacement for 542:

> This has two distinct causes. Against ProcGen the advantage grows with scale,
> from 1.28$\times$ at ten threads to 2.58$\times$ at eighty, because EnvPool's
> ProcGen flattens (1.65$\times$ to 1.52$\times$ per doubling) while PlayTrain
> stays linear (2.01$\times$). Against ALE both scale linearly, so the
> $\approx$20$\times$ advantage is a constant factor rather than a scaling
> effect.

**"which is remarkable" STAYS — Ryan's advisor wants it (2026-09-05).** Do not
re-cut it; the 09-04 checklist entry is superseded. The objection was never the
sentiment, only that the referent was ambiguous and the word asserted a reaction
instead of earning one. Fix by giving it a subject: attach it to *our JS scaling
where hand-written C++ does not*, NOT to *EnvPool flattening* — the latter reads
as an attack on the baseline and invites "you misconfigured it".

Attaching it to the SCALING sentence is also the defensible placement given the
open build-provenance asymmetry (HANDOFF-2026-09-04 §4.5: tier 3 is a
PGO/-march binary, EnvPool runs its generic manylinux wheel). That asymmetry
moves absolute throughput, so 2.58x is contestable; it does NOT move scaling
efficiency, since a faster binary lifts the curve without changing its slope.
Use once per paragraph — twice reads as pleading.

### 14.2 Line 540's explanation is now demonstrable, and needs a second clause

"restricted by the trainer" is right and the ALE row now proves it internally:
qbert is the only ALE game still env-bound on the PlayTrain side (623k vs
1.0-1.17M for the other seven) and it is the only one where tier 3 moves the
row at all (1.267x vs ~1.0). Worth one clause.

But there is a **second, unstated** reason the two ALE ratios differ, and a
reviewer will find it: **they are different baselines.** Per-core 12.62x is the
QuickJS host vs real ALE. Table 1(b)'s 5.8x is the same trainer with
`vec_backend` swapped at a fixed 12-worker x 5-thread topology — NOT the tuned
async+NUMA EnvPool of Fig 4A, which is a different process architecture and is
not selectable inside the trainer. State it; do not let 5.8x, 12.62x and 20.98x
read as three measurements of one quantity.

### 14.3 Line 547 must be re-derived, and probably changes

"at eighty threads \texttt{fruitbot} and \texttt{miner} join them" was true
under the old binary. Under tier 3 miner nearly doubles env-only (815,862 ->
1,638,386, 2.008x) and fruitbot gains 1.392x, so both may now win at eighty
threads. This needs per-game PlayTrain-vs-EnvPool at 80 threads; job 44545120
produces exactly that, same node, for all 24 games. Do not edit this line until
it lands.

### 14.4 The pull deleted the draft sentence the tier-3 story needs

Commit 11a2442 removed these two commented-out lines from main.tex:

```
% By default, we perform an ahead-of-compilation step across all of our 24 games.
% A game's JavaScript can also be compiled to C and built into its own shared
% library, which removes the interpreter's dispatch from every step.
```

That is a draft of exactly the mechanism this whole round measures. Tier 3 IS
that shared library, built per game; with adoption, the paper needs a sentence
describing the compile-at-load path (E6.1, `src/playtrain/runtime/aot_cache.py`)
because every Fig 4A / panel C / panel D number now comes from it. The
supported claim is in HANDOFF-2026-09-04-round6-E6-adoption-done.md §2: a new
game gets tier 2 immediately and tier 3 about a minute later, bit-exact, with
the same PGO increment as the paper games; the gain scales with the game's
engine share, 1.05-2.1x, geomean 1.19/1.30 on the nine held-out games.
Do not let the deletion stand as the final word — it is currently unmentioned.

## 15. RESULTS — ProcGen swap row DONE; 7-point grid DONE but its EnvPool arm is WRONG

44516162 COMPLETED 06:14:21 on holygpu8a15502, exit 0.
44545120 COMPLETED 02:10:52 on holy8a28510, exit 0, 720/720 PlayTrain runs.

### 15.1 Table 1(b) ProcGen row — READY TO EDIT

Baseline reproduces the published value again (unpinned): **371,617** vs
published 372k, adv1 372,539. Node class matched; absolutes usable.

| binary | PlayTrain | real ProcGen | ratio |
|---|---|---|---|
| published (live) | 618k | 372k | 1.66x |
| adv1 | 701,992 | 372,539 | 1.88x |
| adv2 (this job) | 695,014 | 371,617 | 1.87x |
| **tier3** | **837,639** | **371,617** | **2.25x** |

**PlayTrain is now faster on 16/16, and the worst game is 1.43x.** miner, the
published row's only loss at 0.81x, is now **1.67x**. tier3/adv2 = 1.205.
Biggest tier-3 gains: miner 1.520, maze 1.458, caveflyer 1.449, coinrun 1.444,
heist 1.319. Smallest: plunder 1.020, bigfish 1.030, ninja 1.055.

### 15.2 PlayTrain 7-point curves — READY (geomean env steps/s)

Threads 5 / 10 / 20 / 30 / 40 / 60 / 80:

| suite | arm | curve |
|---|---|---|
| ProcGen16 | **tier3** | **225,875 / 453,744 / 907,954 / 1,363,524 / 1,814,048 / 2,729,986 / 3,636,231** |
| ProcGen16 | adv2 | 145,502 / 290,839 / 581,892 / 872,838 / 1,166,241 / 1,749,424 / 2,331,766 |
| ALE8 | **tier3** | **458,714 / 917,021 / 1,838,391 / 2,752,241 / 3,657,695 / 5,466,618 / 7,226,918** |
| ALE8 | adv2 | 333,250 / 666,052 / 1,330,191 / 1,995,438 / 2,658,963 / 3,983,308 / 5,317,124 |

Step-to-step growth tracks the thread ratio EXACTLY — 2.01/2.00/1.50/1.33/1.50/
1.33 against an ideal 2.0/2.0/1.5/1.333/1.5/1.333 (the grid is not all
doublings). **PlayTrain is linear at 100% efficiency across all seven points**,
a stronger version of the existing claim.

Cross-check vs the 4-point job on the same node: ProcGen 80thr 3,636,231 vs
3,642,545 (**-0.17%**), ALE 7,226,918 vs 7,355,750 (-1.75%). Consistent.

### 15.3 TRAP — 44545120's EnvPool arm is NOT the documented-best config

I replicated `final_any.sbatch`'s `async_numa` (numactl NUMA binding). The
paper's "EnvPool tuned / documented best" is `ep_best_sweep.sbatch`: async, one
pool per NUMA domain, **envpool's own `thread_affinity_offset`** (not numactl),
bs = 3x threads-per-pool. Mine understates it, worst at low thread counts:

| threads | mine (async_numa) | documented-best | mine/best |
|---|---|---|---|
| 10 | 256,963 | 355,451 | 0.723 |
| 20 | 454,633 | 587,070 | 0.774 |
| 40 | 784,018 | 931,786 | 0.841 |
| 80 | 1,264,550 | 1,413,748 | 0.894 |

**Using my arm as "tuned" would report 2.88x at eighty threads instead of the
correct 2.58x — a 12% overstatement in our favour.** Do not use
`outputs/tier3_fig4a7_44545120/envpool_7pt.json` for the figure. The
`sync1` (as-shipped) arm in that file is fine: 463,817 vs 468,997 at 80 threads
(-1.1%), 176,017 vs 178,217 at 10 (-1.2%).

**Job 44601287** (`ep_best_7pt.sbatch`) re-measures the tuned arm at all seven
points with ep_best_sweep's child VERBATIM. Confirmation the config is right:
at 80 threads its BS computes to exactly **120**, matching the "bs120" recorded
in HANDOFF-2026-09-04 §1. It also runs a PlayTrain tier3 anchor at 80 threads
(24 games x 2) so that if it lands off holy8a28510 the node offset is measured,
not assumed. ~1-1.5 h.

### 15.4 Main-text status after this round

| line | edit | status |
|---|---|---|
| 520 | `372k & 618k` -> `372k & 838k` | **READY** |
| 521 | `175k & 873k` -> `175k & 1{,}018k` | **READY** |
| 539 | "15 ... 1.7$\times$ ... miner the only exception 0.81$\times$" -> **all 16, 2.25$\times$, no exception** | **READY** |
| 539/540 | ALE swap 5$\times$ -> 5.8$\times$ | **READY** |
| 542 | ALE-flattening rewrite | **READY** |
| 1546 (t40 ALE) | 20.53 -> 20.49 | **READY** |
| 547 | fruitbot/miner at 80 threads | blocked on 44601287 |
| 1538-1546 | 4 scaling rows -> 7 | blocked on 44601287 |
| Table 1(a) | four PlayTrain rows | blocked on 44515752 (~12:15-13:15) |

## 16. FAILURE — Table 1(a) job 44515752 is not usable; recommend cancel + redesign

Diagnosed 2026-09-05 09:34, job still RUNNING at 9:50 elapsed. Three
independent problems; the row data is not salvageable as designed.

### 16.1 The ICNN row is producing zeros (14 of 18)

Only the first four games returned a number (plunder, bigfish, bossfight,
ninja, geomean 348,962). Every game from starpilot onward wrote
`final_step: 0, stats: {}` — 14 zero runs — and `freeway` was reported by the
harness itself as "1 GAME(S) FAILED ... geomean covers 0 of 1 games".
**One-process-per-game did NOT prevent the documented hang**; it only moved it
from game 2 to game 5. Whatever leaks is surviving process exit, so it is
GPU/MPS state at the job level, not process state. The Slurm-array form
(44382216) got a fresh MPS per task, which this job does not.

`seaquest` has been hung since 07:36:50 — nearly 2 h with no output at all,
its suite log untouched since the Nature row wrote it at 02:31.

### 16.2 The Nature row's tier3 arm is order-confounded

| arm | ProcGen16 | ALE8 | all-24 geomean |
|---|---|---|---|
| adv2 | 982,087 | 1,020,093 | **994,596** |
| tier3 | 889,818 | 1,027,710 | 933,593 |

**tier3/adv2 = 0.939** — tier 3 apparently 6% SLOWER attached to a trainer,
and 9.4% slower on ProcGen. That is not credible next to the ALE swap row
(1.089) and ProcGen swap row (1.205) measured the same night.

The cause is my loop: `for arm in adv2 tier3` runs **adv2 first every time**,
so tier 3 always occupies second position within each game's pair and eats any
within-pair degradation (MPS/GPU state accumulating across the 120 processes —
the same leak §16.1 exposes). Corroboration that adv2 is the clean arm: its
994,596 matches the adv1 Nature row's 997,689 (job 44162618) to 0.3%.
**Fix for any re-run: alternate arm order per game** (adv2-first on even games,
tier3-first on odd) so position cancels.

### 16.3 It cannot finish anyway

Measured ICNN rate is **16:55 per game**, dead regular. Remaining at 09:34:
6 ICNN + 24 PPO-Nature + 24 PPO-IMPALA = 54 runs x 16:55 = **15.2 h** against
**10.1 h** of wall left (expires 19:43). Best case if ICNN were stopped now:
PPO-Nature alone completes ~18:05 and PPO-IMPALA does not start.

Note the Nature row ran at 4:25/game but ICNN at 16:55 — the ICNN template sets
`compile_learner: true` with `max-autotune`, and one-process-per-game pays that
compile **per game** instead of once. My earlier claim that per-process startup
was negligible held only for the Nature row.

### 16.4 What IS salvageable

- **IMPALA+Nature, adv2 arm, 24/24 games: geomean 994,596** (mean 1,002,852;
  ProcGen16 982,087 / ALE8 1,020,093). Reproduces adv1 to 0.3%, so the node is
  sound. This is a valid adv2 reference row.
- Nothing else. tier3 Nature is confounded, ICNN is 14/18 zeros, PPO never ran.

### 16.5 Recommendation

Cancel 44515752 and redesign before resubmitting:
1. **Alternate arm order per game.**
2. **Restart MPS between games** (or go back to a Slurm array, one task per
   game, which is the only form empirically shown to survive 24 ICNN games).
3. **Budget realistically**: at 16:55/game a single 24-game ICNN row is 6.8 h.
   Four rows x 2 arms does not fit one allocation. Either drop the adv2 arm on
   the three expensive rows (keeping it only on Nature, which is cheap at
   4:25/game) or accept rows on different nodes and record them.
4. Consider a shared `TORCHINDUCTOR_CACHE_DIR` so max-autotune is compiled once
   and reused across processes — untested, but it would cut ~11 min/game
   without touching the measured configuration.

## 17. ROOT CAUSE of the 44515752 zeros, and the replacement arrays

### 17.1 Root cause: a worker->learner deadlock, not an env or binary fault

The hung ICNN runs log this once per minute for the whole window:

```
step=0 sps=0.0 total_rss=39228MB main=10294 actors=['2412','2411','2412',...]
stats={}
```

Sequence in every failed game (e.g. maze, 04:39:39-04:47:42):
1. 12 VecWorkers start normally on cuda:2/cuda:3, "aot enabled" each;
2. all 12 log `[mem] vec_worker_db.N rollouts=1` — each produces exactly ONE
   rollout;
3. then nothing. The learner never consumes it. `step` stays 0 for eight
   minutes, worker rss is flat and healthy (~2.41 GB each), **no exception is
   ever raised**, and the harness exits cleanly with `final_step: 0, stats: {}`.

A working game's log is byte-identical up to step 2. So the failure is a
deadlock in the worker->learner handoff (DDP learner init / queue pickup),
**not** the environment, the binary, or the tier-3 .so — every one of those had
already done its job by the time it hangs. That is why one-process-per-game did
not help: the leak outlives process exit and is job-scoped (MPS/driver/DDP
rendezvous state), which a fresh Slurm task resets and a fresh process does not.
It is also the same defect as the published ICNN row and 44162619 — pre-existing,
not caused by tier 3.

### 17.2 Replacement: four per-row arrays, tier3 only (submitted 09:38)

44515752 CANCELLED at 09:55:11 elapsed.

| job | row | harness |
|---|---|---|
| **44602115** | IMPALA + Nature-CNN | `bench_train_suite` on `_mk_sweep_cfg(pt_bigfish_nature_fullnode, 15, 5, 256)` |
| **44602116** | IMPALA + IMPALA-CNN | `bench_train_suite` on `impala_fullnode_throughput.json` |
| **44602117** | PPO + Nature-CNN | `bench_ppo_suite --nproc 4` |
| **44602118** | PPO + IMPALA-CNN | `bench_ppo_suite --nproc 4`, bf16 |

All `t1a_row.sbatch`, `--array=0-23%1`, one game per task, `-t 0-00:45/task`,
tier 3 only, per-task shadow tree + md5 gate + `QJS_DIRTY=1`, fresh `mps_up`
per task. Results: `outputs/t1a_<row>_<arrayjob>_<game>.json`.

**Why tier3-only is sound:** adv2/adv1 = 1.005 globally and 44515752's own adv2
Nature row (994,596, 24/24) reproduces adv1's 997,689 to 0.3%. Re-measuring adv2
per row buys nothing, doubles cost, and — critically — its removal eliminates
the arm-ordering confound by construction.

**Reference row to use for adv2:** 994,596 (24/24, geomean; ProcGen16 982,087 /
ALE8 1,020,093), salvaged from 44515752 on holygpu8a13301.

### 17.3 Cross-row comparability

The four rows are separate jobs and will land on different nodes. Accepted:
the adv1 cascade measured all four rows' structure on ONE node (44162618/20/21,
holygpu8a15204), so the per-row tier3/adv ratios carry the cross-row story.
**Record the node each row used.** `%1` keeps each row's 24 games serialized,
but a row's array can still migrate between allocations — if a row scatters
across nodes, flag it rather than averaging over it. Each task prints its node.

## 18. The array fix WORKED; two Table 1(a) rows done; EnvPool 7-point validated

### 18.1 Zero deadlocks — the array form fixed it

All four rows, no `final_step: 0` anywhere (44515752 had 14 of 18 on ICNN).
Per-task time also collapsed: **ICNN 4:33-7:30 per game in the array vs 16:55
in the single job.** The in-job form was not just deadlocking, it was ~2.5x
slower per game — consistent with the diagnosis that accumulated job-scoped
MPS/GPU state was the cause. Fresh MPS per Slurm task fixes both.

### 18.2 Two rows COMPLETE

| row | tier3 | published | adv1 | tier3/adv1 |
|---|---|---|---|---|
| **PPO + Nature-CNN** | **186,494** (24/24) | 171k | 177,786 | 1.049 |
| **PPO + IMPALA-CNN** | **67,273** (24/24) | 64k | 66,583 | 1.010 |

In progress: IMPALA+Nature **1,045,132** over 13 games (ETA ~11:52) —
**over 1M**, as predicted; IMPALA+ICNN 351,565 over 10 games (ETA ~12:20).
PPO+ICNN at 1.010 is another clean trainer-bound datapoint: a 1.5x faster
environment buys 1%.

### 18.3 EnvPool 7-point (44601287) validates to within 0.5%

Re-measured with `ep_best_sweep`'s child verbatim, same node as the PlayTrain
curves (holy8a28510):

| threads | 10 | 20 | 40 | 80 |
|---|---|---|---|---|
| ProcGen new vs reused | -0.22% | -0.44% | -0.03% | -0.06% |
| ALE new vs reused | -0.14% | -0.02% | -0.11% | +0.10% |

So the documented-best config is confirmed and the curve is now same-node
end to end. Full curves:
ProcGen 147,716 / 354,686 / 584,458 / 777,384 / 931,467 / 1,197,708 / 1,412,903;
ALE 18,390 / 45,600 / 89,270 / 134,145 / 177,666 / 265,505 / 350,959.

### 18.4 DEFECT at T=5 — do not use that point (fix: job 44614598)

44601287 split every point over K=2 NUMA pools with `pt = max(1, T//K)`, so
**T=5 ran 2 pools x 2 threads = FOUR threads, not five.** EnvPool is
under-threaded by 20% at that point only. The tell is impossible superlinear
growth 5->10 (**2.40x** ProcGen, **2.48x** ALE) and an inflated ratio there
(1.53x vs 1.28x at ten threads; ALE 24.94x vs 20.11x) — inflated in OUR favour.
All other points use whole threads and validate above.

Job **44614598** re-runs T=5 as ONE pool of 5 real threads. ~10 min.
Until it lands, quote the curve from 10 threads up.

### 18.5 Ratios with the corrected EnvPool arm (10 threads and above)

| threads | 10 | 20 | 30 | 40 | 60 | 80 |
|---|---|---|---|---|---|---|
| ProcGen tier3/tuned | 1.28x | 1.55x | 1.75x | 1.95x | 2.28x | **2.57x** |
| ALE tier3/tuned | 20.11x | 20.59x | 20.52x | 20.59x | 20.59x | **20.59x** |

The two-mechanism story holds at seven points: ProcGen climbs monotonically
(EnvPool per-doubling 1.65 -> 1.18), ALE is flat at ~20.6x. Note 80-thread
ProcGen is **2.57x** on this arm (vs 2.58x from the reused number) and ALE
**20.59x** (vs 20.98x) — use these, they are same-node with the PlayTrain curve.

## 19. FINAL NUMBERS — cascade complete (49/49 tasks, all rows 24/24)

T=5 fix (44614598) landed: ProcGen 177,338, ALE 22,806. EnvPool 5->10 growth is
now exactly 2.00x on both suites (was 2.40/2.48), scaling efficiency starts at
100%. The 7-point grid is clean.

### 19.1 Table 1(a), tier 3, 24/24 every row

| row | published | adv1 | **tier3** | vs published |
|---|---|---|---|---|
| IMPALA + Nature-CNN | 0.94M | 997,689 | **937,029** | 1.00x |
| IMPALA + IMPALA-CNN | 0.35M | (never completed) | **344,803** | 0.99x |
| PPO + Nature-CNN | 171k | 177,786 | **186,494** | 1.09x |
| PPO + IMPALA-CNN | 64k | 66,583 | **67,273** | 1.05x |
| IMPALA+Nature, 16 ProcGen | 0.91M | 985,269 | **895,265** | 0.98x |
| IMPALA+Nature, 8 ALE | 1.01M | 1,023,001 | **1,026,494** | 1.02x |

**CORRECTION to §16.2.** I attributed 44515752's tier3/adv2 = 0.939 to arm
ordering (tier3 always ran second). That was WRONG. This array is single-arm,
so no ordering exists, and it reproduces the same value: **937,029 vs
44515752's 933,593, a 0.4% match.** Tier 3 really is ~6% slower than adv in the
IMPALA+Nature row. It is NOT an artifact.

Why it can be real: Table 1(a) is double-buffered at 15 workers x 128 envs;
the swap rows (where tier3 wins 1.205/1.089) are single-buffered at 12. The
per-game AOT binaries are much larger than the generic one, and 15 concurrent
worker processes each mapping a bigger code image is a plausible I-cache/TLB
cost that only bites at this topology. **Unproven** — a same-job A/B at the
Table 1(a) topology would settle it, and none was run with correct ordering.
Report the number; do not claim the mechanism.

**Answer to "do we reach 1M": NO for the headline geomean.** 937,029 geomean
(mean 972,191). ALE8 alone is 1,026,494. My earlier 1.02-1.10M projection was
wrong because it assumed tier3 >= adv2 in this row. Do not switch to the mean
to cross 1M.

### 19.2 Figure 4A, seven points, all same node (holy8a28510)

| threads | 5 | 10 | 20 | 30 | 40 | 60 | 80 |
|---|---|---|---|---|---|---|---|
| PT ProcGen16 | 225,875 | 453,744 | 907,954 | 1,363,524 | 1,814,048 | 2,729,986 | **3,636,231** |
| EP ProcGen16 | 177,338 | 354,686 | 584,458 | 777,384 | 931,467 | 1,197,708 | **1,412,903** |
| ratio | 1.27x | 1.28x | 1.55x | 1.75x | 1.95x | 2.28x | **2.57x** |
| PT ALE8 | 458,714 | 917,021 | 1,838,391 | 2,752,241 | 3,657,695 | 5,466,618 | **7,226,918** |
| EP ALE8 | 22,806 | 45,600 | 89,270 | 134,145 | 177,666 | 265,505 | **350,959** |
| ratio | 20.11x | 20.11x | 20.59x | 20.52x | 20.59x | 20.59x | **20.59x** |

Scaling efficiency (per-thread, relative to 5 threads):
PT ProcGen 100/100/100/101/100/101/101; **EP ProcGen 100/100/82/73/66/56/50**.
PT ALE 100/100/100/100/100/99/98; **EP ALE 100/100/98/98/97/97/96**.

### 19.3 Line 547 needs NO change — verified per game at 80 threads

Slower than EnvPool at eighty threads: **chaser 0.98x, climber 0.69x,
fruitbot 0.75x, miner 0.79x** — exactly the four the sentence names (chaser and
climber per-core, fruitbot and miner joining at eighty). Tier 3 did not flip any
of them.

**Caveat on one EnvPool datum:** BossfightEasy reads 78,149 at 80 threads, 20x
below every other ProcGen game, giving a 129.75x ratio. It is NOT a fluke of my
run — the reused documented-best geomean (1,413,748) matches mine (1,412,903) to
0.06%, so the same value is in the published-era data. It is a reproducible
EnvPool weakness on Bossfight, but it lifts our ProcGen geomean materially
(excluding it would drop the 80-thread ratio from ~2.57x toward ~2.1x). Worth a
footnote before a referee finds it.

## 20. The Table 1(a) Nature deficit is TWO GAMES, not the suite — diagnostic 44640608

### 20.1 What the per-game data shows

Comparing the array's tier3 against 44515752's adv2, per game (the array
reproduces 44515752's tier3 to **1.003**, so both are solid):

| game | adv2 | tier3 | ratio | env-only tier3/adv2 |
|---|---|---|---|---|
| **fruitbot** | 850,092 | **288,347** | **0.34** | **1.392x (faster!)** |
| **climber** | 820,514 | **507,777** | **0.62** | **1.269x (faster!)** |
| jumper | 1,064,771 | 891,128 | 0.84 | 1.308x |
| dodgeball | 1,051,671 | 1,002,066 | 0.95 | 1.467x |
| coinrun | 812,630 | 1,061,658 | **1.31** | 1.878x |
| other 18 | — | — | 0.95-1.04 | — |

**Excluding fruitbot and climber the row is 1.005 — parity.** The whole "tier 3
is 6% slower" result is two games. And both are *faster* standalone under
tier 3, so a 3x collapse that appears only in the double-buffered 15-worker
trainer path is a defect, not a property of the workload.

### 20.2 Two hypotheses, and the one that must be ruled out

1. tier 3 is anomalously LOW on those two games; or
2. **adv2 is anomalously HIGH on them.** Their adv2 values (850k, 820k) sit
   well below the ~1.05M every other game reaches, which is suspicious in its
   own right.

The same-job A/B settles which. **The report must state which of the two it
was** — this is not optional.

### 20.3 Job 44640608 (step 1)

Three arms in ONE job on ONE node, at the exact Table 1(a) topology
(`_mk_sweep_cfg` 15 workers / 5 threads / b256):
adv2 | **tier2** (`futIT2u_<g>.so`, PGO engine + UNPROFILED game unit) | tier3.

**tier 2 is the diagnostic bit**: if tier 2 is clean and only tier 3 regresses,
the defect is isolated to the PGO/profile step of the per-game unit.

Games: fruitbot, climber (the regressions), coinrun (tier 3 WINS 1.31 — proves
the harness detects both directions), bigfish (clean control, 0.994).
3 reps, **LATIN-SQUARE arm order** (rep1 adv2/tier2/tier3, rep2 tier2/tier3/adv2,
rep3 tier3/adv2/tier2) so within-game position cannot confound — the mistake
44515752 made by always running adv2 first. ~2.8 h.

Step 2 (12 vs 15 workers, double-buffer on/off, fruitbot only) runs only if
step 1 confirms.

### 20.4 REPORTING CONSTRAINTS (Ryan, 2026-09-05) — read before writing this up

- **Frame any improvement as recovering a regression, NEVER as reaching 1M.**
  If a fix lands the row near 1.00M that is a *consequence*, not the goal. This
  handoff says so explicitly so that nobody later reads the sequence
  (937k -> investigate -> ~1.00M) as tuning toward a round number. The
  investigation was opened because a 3x regression on a binary that is 1.4x
  faster standalone is a defect we would otherwise ship into the paper's
  headline table.
- **If the fix does not fully close the gap, publish 937,029 with the defect
  documented.** A documented defect beats an unexplained 6% hole.
- **Do NOT rebuild and re-measure fruitbot/climber unilaterally.** If step 1
  shows a genuine tier-3 build defect on those games, report and stop —
  selectively rebuilding the two games that happen to hurt us is exactly the
  pattern that requires a human signature.
