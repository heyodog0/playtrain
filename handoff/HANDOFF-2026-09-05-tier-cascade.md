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
