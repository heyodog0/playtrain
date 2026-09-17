# Provenance for every figure and table in the paper

One section per label in `ICLR-PlayTrain-Fast-LLM-VGEs/main.tex`, in paper order.
Each says what drew the asset, what data it read, and which cluster job produced
that data. The as-submitted sbatch, its `sacct` submit line and its log head are
under `reproduction/runs/<jobid>/`.

Everything measured ran on Harvard FASRC. Node names matter: the same node class
differs by up to 1.56x in clock, so every `SUBMIT.txt` records `NodeList`.

Redraw anything with `bash reproduction/reproduce.sh <name>`; `--list` prints the
names. Sections not yet written are tracked in
`playtrain-internal/repro-loop/STATE.md`.

---

## fig:env_efficiency — Environment efficiency (Figure 4)

```
graphic:   figures/fig_env_efficiency.pdf
redraw:    bash reproduction/reproduce.sh env_efficiency
code:      reproduction/figures/tools/plot_env_efficiency_bestonly.py
           (+ reproduction/figures/tools/throughput_panels.py, which draws B/C/D)
```

Four panels with **four different provenances**. Read the panel you care about.

### Panel A — thread scaling (env-only, 5→80 threads)

Not data-driven. The seven points per arm are **constants in the plot script**
(`plot_env_efficiency_bestonly.py`, `main()`), transcribed from the jobs below.
The script also defines `load_scaling()` and accepts `--ab-results/--pg-job/
--ale-job`, but nothing calls it and the flags are ignored — see § Flags in
`STATE.md`. The `figures/scaling/ab_*.json` files in the repo therefore back no
published panel; they are an independent replication, described at the end of
this section.

| arm | constant @80t | job | node | date |
|---|---|---|---|---|
| PlayTrain, 16 ProcGen | 3,650,005 | 43780731 `adv_anchor` | holy8a24307 | 2026-09-01 |
| PlayTrain, 8 ALE | 7,300,384 | 43780731 `adv_anchor` | holy8a24307 | 2026-09-01 |
| EnvPool documented best, ProcGen | 1,412,903 | 43779854 `ep_best_sweep` (10/20/40t) + 43570992 (80t) | holy8a24307 | 2026-09-01 |
| EnvPool documented best, ALE | 350,959 | same | holy8a24307 | 2026-09-01 |
| EnvPool as shipped (sync1) | 468,997 / 238,829 | the config matrix, HANDOFF-2026-09-01 §2 | holy8a24307 | 2026-09-01 |

```
runs/43780731/  adv_anchor.sbatch, SUBMIT.txt, LOG_HEAD.txt
runs/43779854/  ep_best_sweep.sbatch, SUBMIT.txt, LOG_HEAD.txt, GEOMEANS.txt
```

`43779854`'s own printed geomeans (`GEOMEANS.txt`) agree with the plotted
constants to within 0.4%: ProcGen 355,451 / 587,070 / 931,786 at 10/20/40
threads against the plotted 354,686 / 584,458 / 931,467; ALE 45,662 / 89,285 /
177,869 against 45,600 / 89,270 / 177,666. Its 80-thread points were taken from
the earlier 43570992 and its 5-thread point from the matrix, so panel A's
EnvPool curve is a **composite of three jobs**, all on holy8a24307.

`43779854` measures EnvPool at its documented best: async, one pool per NUMA
domain, in-pool `thread_affinity_offset`, `batch_size = 3 x threads`. The
as-shipped sync arm is omitted from the plot but kept for the printout, which is
where the "vs as shipped: 7.78x / 30.57x" line comes from.

Jobs 43570992 and the matrix are **not yet recovered** into `runs/`.

### Panels C and D — per-core throughput vs ProcGen C++ and ALE

This is where the paper's headline per-core numbers come from.

```
data (PlayTrain):  figures/results/env_throughput/qjs_raw4.txt        (16 ProcGen x 7 trials)
                   figures/results/env_throughput/qjs_atari6_raw.txt  (8 ALE x 7 trials)
data (baselines):  figures/results/env_throughput/procgen4.json
                   figures/results/env_throughput/ale_atari6.json
```

`throughput_panels.py` derives the bars from those files and hard-fails if they
disagree with the published constants by more than 1 step/s. They agree for all
24 games in both suites.

**PlayTrain arm — job 44515373 `tier3_pcd`, node holy8a32608, 2026-09-04.**
Specifically its **`tier3` arm** (the per-game compile-at-load AOT host
`host_f1IT2_<game>`), single core, 7 trials, games from the live tree. The raw
lines are committed at `runs/44515373/raw_panelc.txt` and reproduce the published
constants exactly, mean and sample SD both: plunder 191069±1407, bigfish
127317±1548, pong 477263±4618, seaquest 115031±654. The job's `adv2` arm in the
same file is the previous engine (plunder 125035) and is *not* what the figure
shows.

**Baseline arms — jobs 43783363 / 43783364, node holy8a32607, 2026-09-01.**
`44515373` deliberately reused them rather than re-measuring (its header says
so: the C++ baselines do not depend on our engine build). `procgen4.json` and
`ale_atari6.json` carry `generated_at` 2026-09-02T02:57:01Z and 02:50:30Z, which
are those two jobs' end times to the second.

So panels C and D pair a PlayTrain arm from one job and node with baselines from
another job and node, three days apart. Both are FASRC Sapphire Rapids, one core,
`frame_skip=1`. This contradicts what
`figures/results/env_throughput/README.md` used to claim; that file is corrected
in the same commit as this section.

```
runs/44515373/  tier3_panelc_ladder.sbatch, SUBMIT.txt, LOG_HEAD.txt,
                raw_panelc.txt, raw_ladder.txt
runs/43783363/  sweep4_adv.sh, sweep4_adv.out, SUBMIT.txt, LOG_HEAD.txt
runs/43783364/  sweep6_adv.sh, sweep6_adv.out, SUBMIT.txt, LOG_HEAD.txt
```

### Panel B — the backend ladder

```
data:   figures/results/env_throughput/backend_ladder_fasrc.json          (what the plotter reads)
        figures/results/env_throughput/backend_ladder_adv/                (what the prose quotes)
redraw: bash reproduction/reproduce.sh backend_ladder
code:   reproduction/figures/tools/check_backend_ladder.py  (the ratios; bars come from throughput_panels.py)
```

**The figure and the prose do not divide by the same rungs.** The QuickJS rung is
settled: 58,827, job `44515373`'s **tier3** ladder block (`runs/44515373/
raw_ladder.txt`, exact; the same job's adv2 rung was 37,850 and is not plotted).
The two rungs below it exist in two versions:

| Playwright / V8 rungs | source | V8 → QuickJS | browser → QuickJS |
|---|---|---|---|
| 502 / 4,374 | job 43783367, adv, `backend_ladder_adv/` | **13.45x** | **117.2x** |
| 517 / 4,952 | pre-adv, in `backend_ladder_fasrc.json` | 11.88x | 113.8x |

The paper's prose (main.tex L543) says **13.4x and 117x** — the adv pair, to the
digit. `backend_ladder_fasrc.json`, which `throughput_panels.py` reads and which
therefore sets the drawn bar heights, still carries the pre-adv pair: its history
shows the QuickJS rung updated 30,581 → 58,827 when tier3 landed while the lower
two were left at 517 / 4,952. Job `44515373`'s own header names
`~/backend_ladder_fasrc_adv.json` (502 / 4,374) as the rungs it reused, so the
as-run intent was the adv pair.

The adv pair is committed at `backend_ladder_adv/` with its three raw arms, and
recomputing the geomeans from those arms reproduces 502 / 4,374 / 37,350 exactly.
`reproduce.sh backend_ladder` prints the paper's ratios beside both pairs rather
than preferring one. Choosing between them changes the published figure, so it is
recorded as flag 6 in `STATE.md` and nothing has been adjusted to make them
agree.

Details for `tab:backend-ladder`, which describes the same three backends and
whose own numeric line is commented out in the tex, are in that label's section.

### Paper numbers and what reproduce.sh computes

| paper | where in main.tex | reproduce.sh | agree? |
|---|---|---|---|
| per-core ALE 12.62x, 8/8 wins | L539, L1533 | 12.62x, 8/8 | yes |
| per-core ProcGen 2.19x, 14/16 wins | L539, L1533 | **2.18x**, 14/16 | **no** |
| 80 threads, ProcGen 2.58x | L550, L1534, L1604 | 2.58x | yes |
| 80 threads, ALE 20.80x | L550, L1534, L1613 | 20.80x | yes |
| panel B, V8 → QuickJS 13.4x | L543 | 13.4x from the adv rungs, 11.9x as plotted | see panel B |
| panel B, browser → QuickJS 117x | L543 | 117x from the adv rungs, 114x as plotted | see panel B |
| panel A absolutes 3,650,005 / 7,300,384 | L1604, L1613 | same (they are the constants) | n/a |

The ProcGen per-core geomean ratio computed from the committed data is
**2.1849664823**, which rounds to 2.18. The paper prints 2.19 in two places.
Recorded as a MISMATCH in `STATE.md` § Flags; the data is not adjusted to the
paper.

### Independent replication of panel A (job 44515188)

`figures/scaling/ab_{pt,ptadv2}_<game>_44515188.json` are the per-game outputs of
job **44515188 `tier3_fig4a`** (node holy8a28510, 2026-09-04), which re-ran
panel A's protocol with two arms, `adv2` and `tier3`, at 10/20/40/80 env threads.
`ab_pt_*` is the tier3 arm and `ab_ptadv2_*` the adv2 arm; there is no EnvPool
arm in that job.

Split by suite, its tier3 arm at 80 threads gives ProcGen 3,642,545 and ALE
7,355,750, against panel A's 3,650,005 and 7,300,384 — 0.2% and 0.8% apart on a
different node. That is a replication, not the source. Nothing in the paper reads
these files.

The job's own in-log summary block produced no numbers: it reads
`json.load(f)["env_steps_per_s"]` while `bench_vec_rollout.py --out` writes a
list, so all 432 records printed `BAD` (visible in `runs/44515188/LOG_HEAD.txt`
context). The committed JSONs were reshaped from the per-game output files
afterwards.

```
runs/44515188/  tier3_fig4a.sbatch, SUBMIT.txt, LOG_HEAD.txt
```

### Caveats a reader must know

- **Different harnesses on the two sides of panels C/D.** PlayTrain is stepped by
  the QuickJS host's own C benchmark loop; the baselines by a Python loop over
  their Gym APIs. Measured directly, same machine and games: bigfish −15%,
  coinrun +12%, i.e. about ±15% with no consistent direction. Do not "fix" this
  by re-measuring through PlayTrain's pipe-based single-env API, which is 4x
  slower than the engine and is not the path the trainer uses.
- **Games-dir difference.** `44515373` took panel C/D ratios on the live tree's
  game sources; `maze` and `freeway` differ in the `node-gym` tree. Its `adv2ng`
  arm re-ran adv2 on the node-gym dir for all 24 as a bridge, and agrees with
  `adv2` to under 1% (plunder 125007 vs 125035).
- **Panel letters.** The script's printout labels the per-core panels (b) and (c);
  the paper calls them C and D. Same panels.
- `sweep4.out` and `sweep6.out` in `results/env_throughput/` are the **superseded
  pre-adv** sweeps (plunder 95,442) whose numbers back
  `tools/plot_throughput_all.py`, the old figure. They are not the console output
  of anything in the paper. `sweep6.out`'s `NODE: holy8a32603` line is the reason
  the old README named that node.

---

## tab:train-throughput — Single-node training throughput (Table 1)

```
graphic:   tabular, main.tex L490
redraw:    bash reproduction/reproduce.sh t1a        (a)
           bash reproduction/reproduce.sh t1a_nodes  (a), node provenance
           bash reproduction/reproduce.sh t1b        (b)
code:      reproduction/figures/tables/t1a_agg.py, t1a_nodes.py, tab1b.py
data:      reproduction/figures/tables/data/     (a), one JSON per row x game
           reproduction/figures/tables/verdicts/ (b), one .verdict per game x arm
           reproduction/figures/tables/nodes/t1a_nodes.tsv  (task -> game -> node)
```

One node, four H100s, 92 CPU cores, frame skip 1, 64x64x3 RGB, geometric mean
over games. Every number is agent-steps/s.

### (a) PlayTrain environments, double-buffered

Four array jobs, one per row, one game per task, `--array=0-23%1` so tasks run
serially. The published arm is **t3fix**; `t1a_agg.py` prints the previous
engine (**adv2**) beside it for comparison, and only the t3fix line is in the
paper.

| paper row | paper | t3fix, all 24 | agree? | job(s) |
|---|---|---|---|---|
| IMPALA, Nature-CNN, all 24 | 1.07M | 1,071,262 | yes | 44748571 + 44784183 |
| IMPALA, IMPALA-CNN, all 24 | 0.35M | **344,125 → 0.34M** | **no**, see below | 44748573 |
| PPO, Nature-CNN, all 24 | 185k | 185,113 | yes | 44748574 + 44784184 |
| PPO, IMPALA-CNN, all 24 | 68k | 67,636 | yes | 44748575 + 44784185 |
| IMPALA, Nature-CNN, 16 ProcGen | 1.06M | 1,062,735 | yes | 44748571 + 44784183 |
| IMPALA, Nature-CNN, 8 ALE | 1.09M | 1,088,521 | yes | 44748571 + 44784183 |

The `+ 447841xx` jobs are re-runs of selected tasks; `t1a_agg.py` lets the later
job win per game.

**The 0.35M cell: the paper is right and the committed data is short one re-run.**
None of these jobs is node-pinned, so each row's 24 games were measured on seven
or eight different nodes. The campaign knew some were degraded —
`t1a_t3fix.sbatch` excludes `holygpu8a134{01..04}` and `holygpu8a17601`, and all
three re-run submissions add **`holygpu8a15203`** to that list. `impala_icnn` is
the only row that was never re-run, so six of its games still carry
`holygpu8a15203` measurements:

```
holygpu8a17204   n=5  mean 354,544
holygpu8a15102   n=5  mean 353,887
holygpu8a13202   n=1  mean 353,887
holygpu8a17304   n=6  mean 349,514
holygpu8a15203   n=6  mean 320,024   <- excluded by every re-run
```

That node runs the row 9.5% slow. Drop it and the row's geometric mean over the
remaining 18 games is **352,600 → 0.35M, the paper's figure exactly**. The
published 0.35M is therefore not stale adv2 (which was 347,722, also 0.35M) — it
is this row measured off the bad node. Affected games: bigfish, caveflyer,
climber, frostbite, plunder, seaquest. Closing the gap needs those six re-run
with `--exclude=…,holygpu8a15203`, which is a cluster submission and so is
`STATE.md` flag 7, not something this harness does.

`reproduce.sh t1a_nodes` prints the per-node breakdown for all four rows from the
committed `nodes/t1a_nodes.tsv`, so the node spread is visible rather than
implicit. The other three rows match the paper despite the same spread, because
their re-runs already moved the worst tasks.

Binary provenance is gated inside the job: `t1a_t3fix.sbatch` copies the
per-game `libqjs_vec.futIT2fix2_<game>.so` into a job-private shadow tree under
`$TMPDIR`, md5-checks the copy, and then asserts from Python that the loaded
library is that file and that `QJS_DIRTY` is set. It never swaps a `.so` inside a
shared tree.

Configs, per row:

| row | template |
|---|---|
| impala_nature | `configs/pt_throughput/pt_bigfish_nature_fullnode.json`, widened by `tools/_mk_sweep_cfg.py <cfg> 15 5 256` |
| impala_icnn | `playtrain-trainers/configs/impala_fullnode_throughput.json` |
| ppo_nature, ppo_impala | `outputs/pv_p_breakout_s0/config.json` with `n_envs=768, n_steps=128, n_minibatches=32, ddp=True, native_env_threads=12, compile_mode=None, double_buffer=False, bf16=(net=="impala")` |

### (b) PlayTrain clones vs originals, single-buffered

| paper | EnvPool | PlayTrain | recomputed | job |
|---|---|---|---|---|
| 16 ProcGen | 372k | 838k | 371,617 → 837,638 | 44516162 |
| 8 ALE | 175k | 1,018k | 175,119 → 1,017,528 | 44516167 |

All four numbers agree. Unlike (a), each suite ran as **one job on one node**
(`holygpu8a15502` and `holygpu8a17603`), so both sides of every swap are same-node
by construction — which is what makes these the ratios the prose quotes.

### Prose numbers around the table

| paper | where | recomputed | agree? |
|---|---|---|---|
| all clones faster than ProcGen originals | L547 | true, 16/16 | yes |
| ProcGen swap "2.25x on average" | L547 | 2.2540x (geomean of ratios = ratio of geomeans) | yes |
| ALE swap 5.80x, "on all eight" | L547, L549 | **5.8105x**, and 8/8 faster | **no**, 5.81 vs 5.80 |

The arithmetic means are 2.3888x and 5.9036x, so the paper is quoting geometric
means, consistently with the caption. The ALE ratio rounds to 5.81, not 5.80;
recorded in `STATE.md` § Flags with the ProcGen per-core rounding issue.

```
runs/44748571/  t1a_t3fix.sbatch, SUBMIT.txt, LOG_HEAD_task0.txt
runs/44748573/  SUBMIT.txt   (same sbatch file, ROW=impala_icnn)
runs/44748574/  SUBMIT.txt   runs/44748575/  SUBMIT.txt
runs/44784183/  SUBMIT.txt   runs/44784184/  SUBMIT.txt   runs/44784185/  SUBMIT.txt
runs/44670988/  t1a_adv2.sbatch, SUBMIT.txt   (adv2 comparison arm)
runs/44670899/  SUBMIT.txt   runs/44670900/  SUBMIT.txt   runs/44670901/  SUBMIT.txt
runs/44516162/  tier3_pg_ab.sbatch, SUBMIT.txt, LOG_HEAD.txt
runs/44516167/  tier3_ale_ab.sbatch, SUBMIT.txt
```

---

## fig:learning — Generated environments and training curves (Figure 5)

```
graphic:   figures/fig_main_D.png
redraw:    bash reproduction/reproduce.sh learning      (needs the data archive)
code:      reproduction/figures/tools/plot_main_composite.py
           (+ throughput_panels.py for its bottom strip, shared with fig:env_efficiency)
data:      release asset figure-data-v1, playtrain-figure-data.tar.gz
           sha256 03b4c1697d1c1fb7f807ef63c95ba572269872777eef147c4e547fe6a27a8323
           290,073,695 bytes, unpacks to 5,150 files in figures/outputs/
manifests: reproduction/data/fig_learning_runs.tsv   (panel C's 48 run dirs)
           reproduction/data/variant_names.tsv       (panel B's paper vs repo names)
```

**The archive is not on the public repo.** `fetch_data.sh` defaults to
`REPO=heyodog0/playtrain`, which has no `figure-data-v1` release; the asset lives
only on the private `heyodog0/playtrain-dev`. Until it is published, a reader
cloning the public repo cannot draw this figure, `fig:envcost`, or the three
suite grids. Fetch it with
`PLAYTRAIN_DATA_REPO=heyodog0/playtrain-dev bash reproduction/figures/fetch_data.sh`.
`STATE.md` flag 10. The checksum in the script matches the asset as published on
the dev repo, verified 2026-09-17.

### What the caption claims, and what the code draws

The caption states no measured quantity, so verification here is compositional.
`reproduce.sh learning` now prints each claim beside what the run produced.

| caption claim | drawn | agree? |
|---|---|---|
| (A) 24 game examples | 24 thumbnails | yes |
| (B) four base/variant pairs | 4 pairs | yes, but see names below |
| (C) eight representative games | 8 | yes |
| (C) both configurations use the IMPALA-CNN encoder | `_runs()` keeps only configs with `net == "impala"`, for both trainers | yes |
| (C) 3 training seeds in all cases | 3 IMPALA and 3 PPO for all eight games | yes |

A stale comment above the retired `IMPALA_RUNS` block says "Everything is Nature
now". It describes a code path the figure no longer takes (`fixed_block=False`),
and the encoder filter above is what actually runs. The comment is wrong, not the
figure.

Panel C selects runs **by config content, not directory prefix** — the hazard
that twice silently dropped a whole arm. Per game and seed it takes the
lexicographically greatest directory whose config declares the game,
`net == "impala"`, a 100–200M step budget, and a non-empty `tb/`. All 48 winners
are `s3_icnn_*` for IMPALA and `p3_icnn_*` or `ppo_impala_*` for PPO; the full
list is committed at `data/fig_learning_runs.tsv` so it can be read without the
archive. The x-axis is clipped to 100M; bigfish, miner and pong have TB logs
running to about 150M, so their curves are truncated rather than short.

### Panel B: the variant names in the paper do not exist in the repo

| paper | repo game file |
|---|---|
| `breakout.multiball` | `examples/games/js/breakout.multi.js` |
| `qbert.bigmap` | `examples/games/js/qbert.v2.js` |
| `flappy_bird.hoop` | `examples/games/js/flappy_bird.dunk2.js` |
| `frostbite.jungle` | `examples/games/js/frostbite.jungle.js` |

Only the fourth matches. The paper uses its names consistently — the caption at
L618, the prose at L640, L645 and L648, the discussion at L778, and the
`tab:llm-cost` rows at L1783–1786 — while the shipped game files,
`plot_main_composite.py`'s `PAIRS`, and the `artifact` keys in
`data/llm_cost.json` all use the repo names. The token counts in
`llm_cost.json` match the paper's table exactly under the repo names, so no
number is affected; what breaks is the trail from a name in the paper to a file
in the repo. The mapping is committed at `data/variant_names.tsv` and the
decision — rename the files or rename in the paper — is `STATE.md` flag 9.

```
runs/  not applicable: the curves come from the suite training runs in the
       archive, identified by run directory rather than by a single job id.
       Suite job provenance belongs to fig:suite_trainers and is recovered there.
```
