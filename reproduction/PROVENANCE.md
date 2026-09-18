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

Jobs 43570992 (`ep_affinity`) and 43543523 (`final_any`, "the matrix") are now
recovered into `runs/`, and recovering them settled which of panel A's points
are measurements.

**The seven-point ladder was measured — but not on the engine panel A plots.**
Jobs **38145651** (ProcGen, both arms) and **39032276** (ALE, both arms) swept
the full 5/10/20/30/40/60/80 ladder, and their per-game data is committed in
`figures/scaling/`. That is where the figure's x-axis comes from. The mechanism
is explicit in their sbatch, now at `runs/38145651/`:
`WORKERS="${WORKERS:-1,2,4,6,8,12,16}"` with `ENV_THREADS=5`, i.e. seven worker
counts x 5 env threads = 5/10/20/30/40/60/80.

Panel A, however, plots **adv-era** values, and every adv-era sweep used
10/20/40/80 only — 43543523 (its header: "EP thread sweeps 10/20/40/80 on
ProcGen16"), 43574839 (workers 2/4/8, and its EnvPool side logs threads
10/20/40), 43779854 (T in 10/20/40), 43780731 (w=2/4/8 plus an 80-thread block)
and 43570992 (80 threads). So the plotted curves' 5, 30 and 60-thread points have
no adv-era measurement behind them. Point-by-point map, including the pre-adv
value at each thread count for scale:
`figures/scaling/panelA_measured.tsv`.

| series | adv-era measured | derived in the plotted curve |
|---|---|---|
| EnvPool as shipped, ProcGen | 10/20/40/80, all four **exact** against 43543523 | 5 (a duplicate of the 10-thread value), 30, 60 |
| EnvPool as shipped, ALE | 10/20/40 from 43574839 and 80 from 43543523, all four **exact** | 5 (duplicate of 10), 30, 60 |
| | 43574839 swept workers 2/4/8 only, and its EnvPool output records threads 10/20/40 | |
| EnvPool documented best, both suites | 10/20/40 from 43779854, 80 from 43570992, within 0.44% | 5, 30, 60 |
| PlayTrain, both suites | 10/20/40/80 swept by 43780731 | 5, 30, 60 |

The one concrete anomaly is the 5-thread point: in **both** as-shipped series it
is the 10-thread measurement repeated verbatim (ProcGen 178,217; ALE 38,478),
which cannot be right as a 5-thread throughput and makes that column's "100%"
scaling efficiency an artefact. `tab:bench-scaling` normalises both efficiency
columns against that row.

No published ratio is affected: the headline 2.58x and 20.80x are 80-thread
numbers and both denominators are measured (468,997 exact; 350,959 against a
logged 350,601). What is not supported is presenting all seven thread counts as
adv-era measurements. `STATE.md` flag 23.

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
| 517 / 4,952 | pre-adv, in `backend_ladder_fasrc.json` until 2026-09-18 | 11.88x | 113.8x |

The paper's prose (main.tex L543) says **13.4x and 117x** — the adv pair, to the
digit. `backend_ladder_fasrc.json`, which `throughput_panels.py` reads and which
therefore sets the drawn bar heights, carried the pre-adv pair until 2026-09-18: its history
shows the QuickJS rung updated 30,581 → 58,827 when tier3 landed while the lower
two were left at 517 / 4,952. Job `44515373`'s own header names
`~/backend_ladder_fasrc_adv.json` (502 / 4,374) as the rungs it reused, so the
as-run intent was the adv pair.

The adv pair is committed at `backend_ladder_adv/` with its three raw arms, and
recomputing the geomeans from those arms reproduces 502 / 4,374 / 37,350 exactly.
`reproduce.sh backend_ladder` prints the paper's ratios beside both pairs rather
than preferring one. Choosing between them changes the published figure, so it is
recorded as flag 6 in `STATE.md`.

**Resolved 2026-09-18.** `backend_ladder_fasrc.json`'s `playwright` and `v8`
blocks were replaced with the adv pair from `backend_ladder_adv/` (the file
records this under `provenance`), the figure was redrawn, and the new
`fig_env_efficiency.pdf` is in the paper. Panels A, C and D are unchanged; the
drawn ladder now reads 13.4x and 117x, matching L542.

Details for `tab:backend-ladder`, which describes the same three backends and
whose own numeric line is commented out in the tex, are in that label's section.

### Paper numbers and what reproduce.sh computes

| paper | where in main.tex | reproduce.sh | agree? |
|---|---|---|---|
| per-core ALE 12.62x, 8/8 wins | L539, L1533 | 12.62x, 8/8 | yes |
| per-core ProcGen 2.18x, 14/16 wins | L539, L1537 | 2.18x | yes (paper moved to the mean on 2026-09-18, see below) |
| 80 threads, ProcGen 2.58x | L550, L1534, L1604 | 2.58x | yes |
| 80 threads, ALE 20.80x | L550, L1534, L1613 | 20.80x | yes |
| panel B, V8 → QuickJS 13.4x | L542 | 13.4x | yes (adv rungs drawn since 2026-09-18, see panel B) |
| panel B, browser → QuickJS 117x | L542 | 117x | yes (adv rungs drawn since 2026-09-18, see panel B) |
| panel A absolutes 3,650,005 / 7,300,384 | L1604, L1613 | same (they are the constants) | n/a |

The ProcGen per-core ratio depends on how the seven trials per game are
aggregated, and **the plotting code does not use the statistic the paper
describes**. `main.tex` L1538 says "we used the median", and the baseline JSONs
carry their own note `report median` — but `throughput_panels.py` aggregates with
`statistics.fmean` and reads `fps_mean`. The four combinations:

| PlayTrain arm | baseline arm | ProcGen | ALE |
|---|---|---|---|
| mean | mean (**as drawn**) | 2.1850 → 2.18 | 12.6182 → **12.62** |
| mean | median | 2.1911 → **2.19** | 12.6018 → 12.60 |
| median | mean | 2.1869 → **2.19** | 12.6587 → 12.66 |
| median | median (**as described**) | 2.1930 → **2.19** | 12.6423 → 12.64 |

So ProcGen's published 2.19 is reproduced by three of the four combinations and
fails only under the mean/mean pairing the code actually uses, while ALE's
published 12.62 is reproduced *only* by mean/mean. **No single convention gives
both published numbers.** Under the paper's own stated method, median/median,
ProcGen is 2.19 as printed and ALE becomes 12.64.

This supersedes the simpler reading recorded in the first pass over this label,
which treated 2.18 as the truth and the paper as 0.01 high. The substantive
issue is that the code deviates from the documented statistic; fixing that
confirms 2.19 and moves the ALE cell. `STATE.md` flag 1 carries the
recommendation. Run `reproduce.sh bench_setup` to see the whole matrix.

**Resolved 2026-09-18.** The paper now states the mean (L1549) and prints 2.18 at
L539 and L1537; the code was left as it was, so the drawn figure, the table and
the methods sentence agree. The matrix above stands as the record of why.

### The other jobs whose data sits in figures/scaling/

`figures/scaling/` holds three jobs' worth of per-game data and none of it backs
a published panel, so it is worth saying what each is for:

| job | what | why it is here |
|---|---|---|
| 38145651 | ProcGen, both arms, full 5–80 ladder, pre-adv | the origin of panel A's seven-point x-axis |
| 39032276 | ALE, both arms, full 5–80 ladder, pre-adv | same, for the ALE suite |
| 44515188 | ProcGen + ALE, PlayTrain only, 10/20/40/80, tier3 | an independent replication of panel A, below |

All three are now in `runs/` with their submissions and the ladder they swept.

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
| IMPALA, IMPALA-CNN, all 24 | 0.35M | 352,097 | yes, since re-run 47057946 (see below) | 44748573 + 47057946 |
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
the only row that had not been re-run, so six of its games carried
`holygpu8a15203` measurements (per-node means before the re-run):

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

**Resolved 2026-09-18: job 47057946** re-ran exactly those six tasks with the
same sbatch file and `holygpu8a15203` added to the exclude list, as the other
three rows' re-runs had (`runs/47057946/`, nodes holygpu8a15401 and
holygpu8a17304). With `t1a_agg.py`'s later-job-wins rule the row is now
**352,097 → 0.35M**, the paper's figure, and no measurement in Table 1(a) comes
from the excluded node.

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
runs/47057946/  SUBMIT.txt, LOG_HEAD_task0.txt   (re-run of its six holygpu8a15203 tasks, 2026-09-18)
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

### Slurm provenance for the 48 runs

Run directories carry no job id, and their `config.json` records none. Two
independent sources pin them anyway, and they agree:

1. the **array manifests** — `runs/42009688/manifest.txt` (144 lines, the IMPALA
   arm) and `runs/42149380/manifest.txt` (72 lines, the PPO arm) — map an array
   task index to a run name, which is exact;
2. each run's **TensorBoard filename** embeds its start time and hostname
   (`events.out.tfevents.<unixtime>.<host>.<pid>.0`), which confirms the match
   against `sacct`.

`data/suite_run_jobs.tsv` is the join: all 48 runs, each with its array task or
standalone job id, start time and node.

| arm | job | how |
|---|---|---|
| IMPALA, `s3_icnn_*` | 42009688 `suite3`, `--array=1-144%8` | manifest task index |
| PPO, `p3_icnn_*` | 42149380 `ppo3icnn`, and 42382390 which re-ran tasks 17–72 | manifest index; the TB timestamp picks the array |
| PPO, `ppo_impala_*` | 9 standalone jobs, `ppoi_<game>_s<seed>` | job name matches the run name exactly |

The runs span 2026-07-24 to 2026-08-28 across 24 nodes. Node spread is harmless
here for the same reason as `tab:eval`: these are learning curves, not
throughput.

`ppo3_icnn.sbatch`'s header records why the suite was re-run at all —
`flappy_bird`'s dynamics changed after the earlier agents trained, so those
agents and the human-study participants had played different games.

### A naming trap in the PPO runs

Fifteen of the `p3_icnn_*` runs carry a `wandb_name` of `p3_nat_<game>_s<seed>` —
`nat`, not `icnn` — while their directory says `icnn` and their config says
`net: impala`. All 48 selected runs do have `net: impala`, so the figures are
correct, but anyone re-deriving the selection from run names or wandb names
would misclassify those fifteen as Nature-encoder runs. This is concrete
evidence for `_runs()`'s insistence on selecting by config content; see
`STATE.md` flag 24.

```
runs/42009688/  suite3.sbatch, manifest.txt, SUBMIT.txt
runs/42149380/  ppo3_icnn.sbatch, manifest.txt, SUBMIT.txt
data/suite_run_jobs.tsv   all 48 runs -> task/job, start time, node
```

---

## fig:human_wallclock — Human play vs agent training (Figure 6)

```
graphic:   figures/fig_human_wallclock.pdf
redraw:    bash reproduction/reproduce.sh human_cohort      cohort claims
           bash reproduction/reproduce.sh human_wallclock   the figure
           bash reproduction/reproduce.sh human_crossings   steps to the human mean
code:      reproduction/figures/human/plot_wallclock5.py
           reproduction/figures/human/crossings.py, cohort.py, check_curve_encoder.py
data:      reproduction/data/study/*.json.gz   (30 sessions, 20 participants)
           reproduction/figures/human/rerun_curves_icnn.json   (the agent curves)
```

### The curve file: reproduce.sh was drawing the wrong one

Three curve files sit in `figures/human/`, and each records its encoder per arm
in its own metadata:

| file | IMPALA arm | PPO arm |
|---|---|---|
| `rerun_curves.json` | `net: impala` | **`net: nature`** |
| `rerun_curves_nature.json` | `net: nature` | `net: nature` |
| `rerun_curves_icnn.json` | `net: impala` | `net: impala` |

The caption says "Both RL agents use the IMPALA-CNN encoder", so only the third
file matches the paper — and it is the one whose crossing steps reproduce the
paper's quoted numbers. `reproduce.sh` was passing `rerun_curves.json`, which
compares an IMPALA-CNN IMPALA against a **Nature-CNN PPO**. That is the
mixed-encoder hazard that has already bitten the suite panels twice, and it
produced a figure that looked entirely reasonable.

Fixed this iteration: both human steps now pass `rerun_curves_icnn.json` and run
`check_curve_encoder.py` first, which fails the step if either arm is not
`impala`. The human means, the spread panel and panel B are unaffected — they come
from the study data, not the curves.

### Steps to reach the human mean

`crossings.py` rule: the first step at which the 3-seed mean reaches the human
mean **and** stays within 10% of it for the rest of the run, so a curve that
touches the line once and collapses does not count.

| paper claim | where | recomputed (icnn) | agree? |
|---|---|---|---|
| PPO is the only one to learn flappy_bird, at 1M | L714 | PPO 1.0M, IMPALA never | yes |
| IMPALA is the only one on coinrun, after 81M | L715 | IMPALA 81.2M, PPO never | yes |
| Neither reaches it on caveflyer | L716 | neither | yes |
| Neither reaches it on VVVVVV (removed 2026-09-18) | L714 | IMPALA 85.9M | paper corrected |
| seven of the eight games are reached | L712 | seven of eight | yes (corrected 2026-09-18) |

Reached under `rerun_curves_icnn.json`: asteroids (IMPALA 26.3M, PPO 68.2M),
vvvvvv (IMPALA 85.9M), breakout (PPO 68.2M), flappy_bird (PPO 1.0M), seaquest
(IMPALA 30.5M, PPO 14.4M), coinrun (IMPALA 81.2M), plunder (PPO 16.1M). Only
caveflyer is never reached, so the count is seven.

The commented-out prose at L718–L721 also matches this file exactly — asteroids
26M, seaquest 30M, flappy_bird 1M, coinrun 81M, plunder 16M — which is good
evidence that `rerun_curves_icnn.json` is the set the text was written against,
and that the two surviving claims were simply not updated when VVVVVV's IMPALA
curve crossed. Recorded as `STATE.md` flag 11.

For contrast, the superseded Nature file gives exactly six games reached (coinrun
never), which is where "six of the eight" came from.

### The cohort

| paper claim | L | recomputed | agree? |
|---|---|---|---|
| 20 participants | 703 | 20 of 30 sessions kept | yes |
| eight named games | 702 | all eight, 20 blocks each | yes |
| 6 female | 704 | 6 `Woman` | yes |
| 13 men, 1 non-binary | 701 | 13 `Man`, 1 `Non-binary` | yes (corrected 2026-09-18) |
| mean age 32.4, SD 9.0, range 19–54 | 703 | not recomputable | see below |

`data/study/` holds 30 sessions; the 20 that count are those with a real
participant id, started at or after `2026-08-05T16:52:00Z`, and not partial —
which drops p01–p10, an earlier pilot cohort. `cohort.py` applies the same rule
`plot_wallclock5.py` uses and prints what it dropped.

**Ages cannot be checked.** `anonymize_study_data.py` replaces exact ages with
bands before the data is committed, so the file carries `ageBand`
(`30-39` x7, `20-29` x8, `18-27` x2, `40-49` x2, `50-59` x1) and no ages. The
paper's mean, SD and range come from the Prolific export, which is not committed
and should not be. The banding is also not a single scheme — `18-27` sits
alongside `20-29` and `30-39` — so even a band-weighted estimate would be
approximate. This is a deliberate privacy limit, recorded as a caveat, not a
defect.

The gender count is a real disagreement and it is visible in committed data:
6 women, 13 men, 1 non-binary participant, totalling 20. `STATE.md` flag 12.

### Other scripts in figures/human/

Twenty scripts sit beside these four. `build_rerun_curves.py` and
`extract_human_curves.py` built the curve files; `add_ppo.py`, `add_sps.py`,
`fix_flappy.py`, `force_flappy_ppo.py`, `restore_flappy_impala.py`,
`gen_rerun.py` and `discover2.py` are one-shot repair and assembly steps from
the study's own history; `plot_human.py`, `plot_spread.py`, `plot_steps.py` and
`plot_wallclock4.py` are superseded plotters. None is on the path from committed
data to the published figure. They are listed in § File index under "kept, not
on any paper path"; whether to delete them is `STATE.md` flag 13.

```
runs/  not applicable: the human sessions came from the web study, not Slurm.
       The agent curves in rerun_curves_icnn.json are sourced from the suite
       runs (their metadata says "suite (_suite4_curves.json)"), whose job
       provenance belongs to fig:suite_trainers.
```

---

## tab:dbuf-ablation — Double buffering (Table 7)

```
graphic:   tabular, main.tex L1413
redraw:    bash reproduction/reproduce.sh dbuf         the table body
           bash reproduction/reproduce.sh dbuf_check   the caption's claims
code:      reproduction/figures/tables/dbuf_tex2.py, dbuf_check.py
data:      reproduction/figures/tables/data/dbuf_t3_44861569_<game>.json  (24 files)
           reproduction/figures/tables/nodes/dbuf_jobs.tsv  (task -> game -> raw id)
job:       array 44861569 dbuf_t3_24, tasks 0-23, node holygpu8a15203,
           2026-09-06T15:00:50 to 2026-09-07T08:07:20
```

**The table body reproduces byte for byte.** `dbuf_tex2.py` emits all 24 game
rows, all 72 numbers, and the geometric-mean row identical to the LaTeX in
`main.tex` — including `median 1.20x, range 0.92--2.08x`. Nothing to flag there.

Setup: IMPALA with the Nature-CNN encoder at the topology in `tab:hyperparams`,
fifteen workers, template
`configs/pt_throughput/pt_bigfish_nature_fullnode.json`, arms `a4` (double
buffered) and `a3` (single). The statistic is the median of 60-second SPS
windows with the first discarded.

### One array job, not twenty-four

The 24 data files are all named `dbuf_t3_44861569_<game>.json`, but each records
a **different** `job_id` inside — 44989151, 44995888, … 45032367. Those are not
separate jobs. `SLURM_JOB_ID` inside an array task is the per-task `JobIDRaw`,
while the filename carries `SLURM_ARRAY_JOB_ID`. `sacct -o JobID,JobIDRaw`
confirms all 24 are tasks of array job **44861569**, and the full join is
committed at `nodes/dbuf_jobs.tsv`. A reader who took the inner ids at face
value would go looking for two dozen jobs that do not exist.

`--array=0-23%1` means the tasks ran strictly one at a time, so no two games ever
shared the node.

### The node, and why the ratios survive it

All 24 tasks were pinned with `--nodelist=holygpu8a15203` — the same node the
Table 1(a) re-runs added to their exclude list, and the same silicon class that
varies by up to 1.56x in clock. That makes the absolute `k`/`M` columns a
statement about that one node.

The **ratios are unaffected**, because both arms of a given game ran inside the
same array task on that node: a slow clock divides out. This is the opposite
situation from Table 1(a), where each game sat on a different node and the
per-game numbers were node-confounded.

### The caption's claims

| claim | recomputed | agree? |
|---|---|---|
| double buffering gives 1.34x overall | 1.34x | yes |
| median 1.20x, range 0.92–2.08x | identical | yes |
| plunder "at nearly a million steps-per-second reduces at 0.97x" | 0.97x at 907,653 single-buffered | yes |
| "the gain tracks how environment-bound a game is" | r = **−0.871** against env-only per-core SPS, **−0.949** against single-buffered throughput, over all 24 games | yes, strongly |
| "miner and leaper, the two slowest environments present in the table" | they are the two largest **gains**, not the two slowest environments | **no** |

The mechanism claim is the substantive one and it holds well. The worked example
is what slips: miner (2.08x) and leaper (1.92x) top the *ratio* column, but by
env-only per-core speed the two slowest games in the table are **qbert**
(14,706) and **climber** (16,876), and by single-buffered trainer throughput they
are **climber** (415,609) and **fruitbot** (435,804). `leaper` runs at 66,213
env-only SPS — **13th slowest of the 24** — and is the clearest exception to the
caption's own trend, gaining 1.92x while the similarly-paced heist and frostbite
gain only 1.18x and 1.15x.

So the sentence conflates "largest gain" with "slowest environment" and picks, as
one of its two examples, the game that least fits the pattern it is illustrating.
`STATE.md` flag 14 has the recommendation. The numbers in the table are right
either way — this is a wording problem, not a data problem.

```
runs/44861569/  dbuf_t3_24.sbatch, SUBMIT.txt
```

---

## fig:suite_trainers, fig:suite_enc_impala, fig:suite_enc_ppo — Full-suite curves (Figures 9–11)

```
graphic:   figures/fig_suite_trainers.pdf, fig_suite_enc_impala.pdf, fig_suite_enc_ppo.pdf
redraw:    bash reproduction/reproduce.sh suite_check    composition
           bash reproduction/reproduce.sh suite_grids    all three figures
code:      reproduction/figures/tools/plot_suite_grid3.py, tools/check_suite.py
data:      figures/outputs/_suite4_curves.json  (in the figure-data-v1 archive)
           24 games x 4 arms x 3 seeds
```

All three figures come from **one script and one data file**, differing only in
which arms they show:

| label | `--arms` | `--name` | arms drawn |
|---|---|---|---|
| fig:suite_trainers | `trainers` | `fig_suite_trainers` | IMPALA + IMPALA-CNN, PPO + IMPALA-CNN |
| fig:suite_enc_impala | `impala` | `fig_suite_enc_impala` | IMPALA at both encoders |
| fig:suite_enc_ppo | `ppo` | `fig_suite_enc_ppo` | PPO at both encoders |

**`reproduce.sh` was producing none of them.** It called
`plot_suite_grid3.py --out …` with no `--arms` and no `--name`, which emits the
4-arm `fig_suite_grid` — a figure no label in `main.tex` uses — and also ran
`plot_suite_grid.py`, whose own docstring says it draws the superseded
single-seed 150M DDP2 run. So the step reported ok while redrawing nothing the
paper contains. Fixed this iteration: the step now runs the three invocations
above.

Evidence the pairing is right: the redrawn PDFs come out at 354,793 / 346,426 /
369,651 bytes against the paper's 354,996 / 346,192 / 369,377 — within 0.1%,
the residue being embedded timestamps.

While fixing this, `--arms` selection was hoisted out of the per-game loop (it
was being rebuilt 24 times and then read after the loop by the final printout,
which relied on loop-variable leakage), and that printout now names the arms it
actually drew instead of always claiming four.

### Caption claims

| claim | recomputed | agree? |
|---|---|---|
| all 24 games | 24 of 24 present | yes |
| three seeds per plot | 3 for every game in all four arms | yes |
| 100M environment steps | IMPALA to 99.94M, PPO to 100.00M | yes |
| both arms IMPALA-CNN (fig:suite_trainers) | `--arms trainers` = indices 0 and 2, the two IMPALA-CNN arms | yes |
| lines are the seed mean, bands min and max | `seed_band` returns nanmean, nanmin, nanmax | yes |
| PPO curves start at 0.5M | PPO data begins at 0.02M; the plotter cuts at 0.5M | yes, by deliberate cut |
| the 2,000-frame horizon is at 12.3M | 6,144 envs x 2,000 = 12.288M | yes |

The PPO cut is a censoring correction, not cosmetic: before the first truncation
wave at 192 envs x 2,000 frames = 0.38M steps, only *winning* episodes have
terminated, so every return average in that range is wins-only. The cut drops
the censored head before smoothing, because masking afterwards would let the EMA
carry the plateau across the boundary. IMPALA is not cut: its wave sits at 12.3M
but its first log lands at 1.64M with returns accumulating from step one — which
is exactly why `maze`, `heist` and `freeway`, the three games with no failure
state, need the caption's caveat instead.

One caveat the caption does not mention: the curves are **EMA-smoothed** before
aggregation (`span_frac=0.02`), so a plotted line is a smoothed seed mean rather
than the raw mean. Smoothing before the min/max is deliberate — at the logged
resolution the raw band is driven by single-point spikes in one seed — but a
reader comparing a plotted value against a raw TB number should expect a small
difference. Recorded as a caveat, not a flag.

`np.nanmean` over an all-NaN column raises a RuntimeWarning for grid points below
a given arm's first sample (the PPO figure's first 0.5M). Harmless: those points
are meant to be empty.

```
runs/  the suite training runs are identified by run directory inside the
       archive, as for fig:learning. Their Slurm provenance is not yet
       recovered; see STATE.md.
```

---

## tab:eval — Mean return over 8 held-out level seeds (Table 8)

```
graphic:   tabular, main.tex L1483
redraw:    bash reproduction/reproduce.sh eval          all 48 cells
           bash reproduction/reproduce.sh suite_check   the prose around the table
code:      reproduction/figures/tools/check_eval.py
data:      reproduction/figures/results/eval_iddp_suite.json   (committed, no archive needed)
           reproduction/figures/tables/nodes/eval_suite_jobs.tsv  (the 24 jobs)
```

**All 48 cells match exactly.** `check_eval.py` parses the 24 `game & R & G`
triples out of the `tab:eval` tabular in `main.tex` itself and compares them
against the JSON, so this is a paper-versus-data check rather than a
data-versus-data one: 48 cells, 0 mismatches. Greedy beats random on 20 of the
24 games (caveflyer, maze, ninja and freeway being the exceptions).

The step used to print three hand-picked games and a count. It now checks every
cell.

### The sibling file, and why the guard matters

`results/eval_final_agents_b256.json` sits next to the right file with the same
shape and the same 24 games. Pointing the table at it produces **20 mismatches,
every one of them in the G column, while all 24 R values still match** — because
the random-policy returns do not depend on the checkpoint. A table built from it
would look entirely plausible. Run
`python tools/check_eval.py --file results/eval_final_agents_b256.json` to see it.
Its greedy returns come from weaker checkpoints (`outputs/impala_34603289` and
siblings, a different and earlier set of runs).

### The 24 jobs

The evaluated checkpoints are the final checkpoints of the 24 IMPALA suite
training runs, and each job id is embedded in the `run` field
(`outputs/impala_<jobid>`). All 24 recovered into
`figures/tables/nodes/eval_suite_jobs.tsv` with job name, submit and end time,
node and config. They ran on 2026-07-24 within half an hour of each other,
spread over five nodes, under `scripts/run_impala.sh` with
`--export=ALL,USE_MPS=1`, `-c 92 --gres=gpu:4`.

Node spread does not threaten this table the way it threatened Table 1(a): these
cells are **returns**, not throughput, so a slower node changes how long the job
took, not what the agent learned.

One config is odd and worth stating: 23 of the 24 use
`configs/pt_throughput/pt_b256_<game>_icnn_ddp2.json`, but **bigfish alone uses
`pt_bigfish_icnn_ddp2v2.json`**. Whether that is a deliberate per-game override
or a leftover is `STATE.md` flag 17.

**No evaluation script is committed.** The table's numbers come from
`eval_iddp_suite.json`, but nothing in the repo produced it — the ledger's
expected `tools/eval_final_agents.py` does not exist here. So the JSON is
checkable against the paper (and is), but not regenerable from the checkpoints.
`STATE.md` flag 16. The caption's "8 held-out level seeds" is likewise an
assertion the committed data does not record: the JSON holds one random and one
greedy return per game with `ckpt_step: -1`, and no per-seed breakdown.

### Prose around the table

| claim | L | recomputed | agree? |
|---|---|---|---|
| IMPALA's freeway zero holds across both encoders and all 3 seeds | 1477 | 0.0 for all six seed-runs | yes |
| PPO reaches freeway 12 to 13 on five of six seeds | 1481 | 13.23, 13.10, 0.00 and 11.75, 11.97, 11.92 | yes (corrected 2026-09-18) |
| on climber only IMPALA finishes above zero | 1478 | IMPALA +0.74, +0.68, −0.36; PPO all negative | yes |
| IMPALA outperforms PPO on climber, coinrun, chaser, heist, asteroids | 1476 | all five are IMPALA wins | yes |
| PPO wins 17 of the 24 | 1483 | 17 (15 outright, 3 within 2%) | yes (corrected 2026-09-18) |

The "8.8 to 11.8" range is not a seed range but the two PPO **arm means**, and
the lower end is depressed by a dead seed: PPO+IMPALA-CNN scores 13.23, 13.10
and **0.00**, averaging 8.78. The sentence reads as though PPO reliably scores
between 8.8 and 11.8 on freeway when in fact one of its six seed-runs scores
zero, exactly as IMPALA's do. Worth a clause; recorded with flag 18.

"PPO wins 13 of the 24" does not hold under any reasonable definition. Comparing
both IMPALA-CNN arms — the ones the sentence is about — PPO wins 17 and IMPALA 7
(asteroids, chaser, climber, coinrun, heist, jumper, ninja). I swept 36
combinations of arm pairing, final-value window (last point, last 5%, last 20%)
and per-seed aggregator (mean, median, max): every one gives PPO 16 or 17, never
13. `STATE.md` flag 18.

```
runs/  see figures/tables/nodes/eval_suite_jobs.tsv rather than 24 runs/ dirs;
       the submit lines are one-liners with the config named inline.
```

---

## tab:bench-setup — The three throughput measurements (Table 9)

```
graphic:   tabular, main.tex L1524
redraw:    bash reproduction/reproduce.sh bench_setup
code:      reproduction/figures/tools/check_bench_setup.py
data:      no data of its own; every cell cross-references another label
```

Six numeric cells, all restatements:

| row | hardware | vs ALE | vs ProcGen | source | agree? |
|---|---|---|---|---|---|
| per core | Intel Sapphire Rapids | 12.62x | 2.19x | fig:env_efficiency C, D | see that label |
| thread scaling | AMD Genoa | 20.80x | 2.58x | fig:env_efficiency A | yes |
| with a trainer | AMD Genoa, 4xH100 | 5.8x | 2.25x | tab:train-throughput (b) | yes |

The trainer row is worth a note: Table 1(b) gives 5.8105 and 2.2540, and this
table prints them to one and two decimals as **5.8x** and **2.25x**, both of
which round correctly. The *prose* at L547 and L549 prints the same ALE ratio as
"5.80x" to two decimals, which does not — that is `STATE.md` flag 8, and it is a
prose problem, not a problem with this table.

The ledger this harness started from expected "1.13x / 4.00x cells (may be
stale)". Those numbers are not in the table any more; it has been updated since.

### The caption's same-job, same-node claim does not hold for two of three rows

> "Frame skip is 1 and both arms run in one job on one node."

| row | holds? | why |
|---|---|---|
| per core | **no** | PlayTrain from job 44515373 on holy8a32608; the ALE and ProcGen baselines reused from 43783363/64 on holy8a32607, three days earlier |
| thread scaling | **partly** | PlayTrain 43780731 and EnvPool 43779854 + 43570992 are different jobs, though all on holy8a24307 |
| with a trainer | yes | 44516162 and 44516167 each run both arms inside one job |

The same sentence appears again at L1523 in the surrounding prose ("with both
arms of every comparison run in a single job on one node"), so it is asserted
twice. For the per-core row it is the reuse that job 44515373's own header
documents and justifies — the C++ baselines do not depend on the engine build —
so the measurement is defensible; the blanket caption claim is what overreaches.
`STATE.md` flag 19.

### The single-core protocol, and the mean/median deviation

The protocol claims check out against the data files' own metadata: seven trials,
1500 frames, 200 warmup discarded, frame skip 1, PlayTrain and ProcGen at 64x64
RGB with ALE at its native 210x160 (which the caption correctly flags as
unmatched, favouring PlayTrain).

The statistic does not. L1538 says "we used the median" and both baseline JSONs
carry the note `report median`, but `throughput_panels.py` aggregates the seven
trials with `statistics.fmean` and reads `fps_mean`. The consequences are in
§ fig:env_efficiency: it is exactly this choice that decides whether ProcGen's
per-core ratio reads 2.18 or 2.19, and adopting the documented median moves the
ALE cell from 12.62 to 12.64. The baselines also record `fps_median` alongside
`fps_mean`, so switching costs nothing but a decision. The decision was taken the other
way on 2026-09-18: the paper now says mean at L1549, matching the code.

Other method claims in the surrounding prose, recorded here because nothing else
sources them: ALE via `gymnasium/ale-py` at the `NoFrameskip-v4` prefix with
`frameskip=1` and no action repeats; ProcGen v0 with `num_levels=0` and
`start_level=0`; EnvPool 1.2.5 for both baselines in the multi-thread setting;
the 12-second timed window; scaling efficiency defined as throughput per thread
relative to the lowest thread count. The EnvPool arm's configuration is
`tab:envpool-config`, still to be sourced.

---

## tab:bench-scaling — Thread scaling (Table 10)

```
graphic:   tabular, main.tex L1587
redraw:    bash reproduction/reproduce.sh bench_scaling
code:      reproduction/figures/tools/check_bench_scaling.py
data:      none committed -- the two throughput columns are panel A's constants
jobs:      PlayTrain 43780731; EnvPool 43779854 (10/20/40t) + 43570992 (80t)
           + the config matrix (5t); all on holy8a24307
```

**All 70 cells check out: 14 rows x 5 columns, 0 mismatches.**
`check_bench_scaling.py` parses the tabular out of `main.tex`, takes only the two
throughput columns as given, and re-derives the ratio and both scaling-efficiency
columns. Every derived cell matches what the paper prints, including the 99% that
breaks PlayTrain's otherwise unbroken 100% column at ALE 80 threads.

Scaling efficiency is, as the caption says, throughput per thread relative to the
5-thread point. The caption's summary claims follow: PlayTrain holds 100% (99% in
that one cell) on both suites out to eighty threads, while EnvPool falls to
**50%** on ProcGen and holds **96%** on ALE. The headline ratios are 2.58x and
20.80x.

**What this verification does and does not establish.** It establishes that the
table is correctly derived and internally consistent — no arithmetic slip
anywhere in 70 cells. It does *not* establish the measurement, because the two
throughput columns are the same hardcoded constants that draw panel A of
Figure 4, and their source data is not in the repo (§ fig:env_efficiency panel A,
`STATE.md` flags 2 and 3). This table and that panel cannot disagree: they are
the same 28 numbers. Committing panel A's source data would make both
reproducible at once.

The EnvPool column is a composite across four jobs — 43779854 for 10/20/40
threads, 43570992 for the 80-thread points that produce the headline 2.58x and
20.80x, 43543523 for the as-shipped ProcGen curve, and 43574839 for the
as-shipped ALE sweep. All four are now in `runs/`, as are the two pre-adv
full-ladder jobs 38145651 and 39032276.

**The 5-thread row is not an adv-era measurement**, and both
scaling-efficiency columns are normalised against it — in the as-shipped series
it is the 10-thread value repeated verbatim. The full ladder was measured
pre-adv (38145651 / 39032276), but no adv-era sweep covered 5, 30 or 60
threads; see § fig:env_efficiency panel A and
`figures/scaling/panelA_measured.tsv`. The 70 cells remain correctly derived
from the throughputs; three of the seven thread counts are themselves derived.
`STATE.md` flag 23.

### Protocol behind the EnvPool column

From `runs/43779854/ep_best_sweep.sbatch`, which is committed: four seconds of
warmup per NUMA pool, then a twelve-second measured window, summed across pools
and then geometric-meaned over games — exactly as the prose at L1583 describes.
PlayTrain builds carry profile-guided optimization while EnvPool runs on its
prebuilt wheel, which the same paragraph discloses.

---

## fig:envcost — Cost of one operation, and per-game step anatomy (Figure 12)

```
graphic:   figures/fig_env_cost.pdf
redraw:    bash reproduction/reproduce.sh env_cost        the figure
           bash reproduction/reproduce.sh env_cost_check  the prose numbers
code:      reproduction/figures/tools/plot_env_cost.py, tools/check_env_cost.py
data:      figures/outputs/percmd.json, logic_probes.json, grid.json
           (in the figure-data-v1 archive; see fig:learning for the access flag)
job:       44381429 envcost_adv, node holy8a14102, -C sapphirerapids -c 1,
           2026-09-04; built by dependency 44381264 adopt_build_dc
```

Every number the appendix prose quotes checks out:

| claim | where | recomputed | agree? |
|---|---|---|---|
| background is the most expensive at 390 ns per call | L1694 | background, 390.34 ns, dearest of the priced primitives | yes |
| fill is the fastest, only sets colour state | L1695 | fill, 79.25 ns, cheapest priced primitive | yes |
| shapes priced per polygon | caption | `shape_unit_ns` 372.31; beginShape/vertex/endShape all 0 | yes |
| pong is the fastest, 11 p5 commands per frame | L1696 | pong, 233,103 sps, exactly 11.0 commands | yes |
| flappy_bird issues fewer commands yet is slower | L1698 | 6.2 commands, 222,614 sps — fewer and slower | yes |
| maze is the one game whose costs exceed its step time | caption | maze alone: 67.45 us priced against a 64.21 us step | yes |
| miner spends 75% of its step on 787 drawing commands | L778 | 75% and 787 commands | yes |
| one core of one Sapphire Rapids node | L1692 | `-C sapphirerapids -c 1` | yes |

`maze`'s over-attribution is why its bar carries no residual: with the priced
operations already exceeding the measured step, there is nothing left to assign
to game logic, and `logic_us` is 0. It is the only such game.

### The variant hazard

Four `percmd*.json` files sit side by side. The figure reads `percmd.json`, and
it is **byte-identical to `percmd_adv_nodirty.json`** — the adopted build with
dirty-rectangle skipping off, exactly what the caption states. The others are
live traps:

| file | background | pong |
|---|---|---|
| `percmd.json` = `percmd_adv_nodirty.json` (**drawn**) | 390.34 ns | 233,103 sps |
| `percmd_adv_dirty.json` | 386.82 ns | 226,405 sps |
| `percmd_preadv.json` | **1303.84 ns** | **107,354 sps** |

The pre-adv file would redraw the entire figure with every price about 3.3x
higher and every game about 2x slower, and nothing about the result would look
wrong. `check_env_cost.py` asserts the identity, so a swap fails loudly.

Job 44381429's header explains why the anatomy runs with `QJS_DIRTY` unset:
dirty-rectangle skipping removes the raster pass on skipped frames, so a step
decomposition measured under it would not be an anatomy of a rendered step. The
figure is internally consistent on this — both its prices and its bracketed
throughputs come from the same dirty-off file.

### Two places the methods text is narrower than the data

Neither changes a published number; both would mislead someone rebuilding the
probes.

- **The probe sweep.** L1685 says N "varies from 0, 64, 128, 256, and 512". The
  committed grid actually sweeps drawing at {0, 64, 128, 192, 256, 320, 512, 768}
  and logic at {0, 128, 256, 384, 512, 768, 1024, 1536}, and the standalone logic
  probes use {0, 256, 512, 1024, 2048, 4096} — a different ladder from the one
  described, not "the same structure".
- **The logic operations.** L1687 names four: collision checks, allocations,
  entity updates, typed-array writes. The data fits **five**, the unnamed one
  being `lgrid`, "tile-grid cell scan" at 78.82 ns per unit. That omission is
  worth closing precisely because `maze` — the one game whose decomposition
  overflows — is a tile-grid game.

All five fits are near-perfect lines (r^2 from 0.99977 to 0.99999), and
`grid.json` records a held-out check of the additive draw+logic model with a mean
absolute error of **0.36%**, which is good evidence the decomposition in panel B
is sound. Neither the r^2 values nor the held-out error appear in the paper;
they are the strongest support it has for panel B and are recorded here.
`STATE.md` flag 20.

```
runs/44381429/  envcost_adv.sbatch, SUBMIT.txt
```

---

## tab:llm-cost — Authorship cost and training throughput per artifact (Table 11)

```
graphic:   tabular, main.tex L1774
redraw:    bash reproduction/reproduce.sh llm_cost        offline, no API key
regenerate: GEMINI_API_KEY=... uv run --with google-genai \
              python -m playtrain.gen.count_tokens
code:      playtrain/src/playtrain/gen/count_tokens.py  (the generator)
           reproduction/figures/tools/check_llm_cost.py  (the offline check)
data:      reproduction/data/llm_cost.json      the counts
           reproduction/data/tab_llm_cost.tex   the generated tabular
           reproduction/data/generation-logs/   26 logs, one per LLM call
```

The ledger this harness began with listed this table as needing `GEMINI_API_KEY`
and suggested committing the counted JSON so it redraws offline. **That is
already done**: `count_tokens.py` writes both the JSON and the LaTeX beside the
counts, and both are committed. `reproduce.sh llm_cost` now checks the whole
table with no API call, so the step is no longer excluded from the run.

**Five of the seven columns verify completely, offline.**

| column | source | status |
|---|---|---|
| Calls | one generation log per call | 26 of 26 logs present on disk; every row's Calls equals its number of logs |
| Tokens (in / out) | Gemini `count_tokens` over each log's stored prompt and `raw_output` | all 12 cells match |
| Time | wall-clock from the logs | all 6 match |
| Cost | recomputed from $2 / $12 per 1M | all 6 match to the cent |
| LoC Δ | **hardcoded** in `count_tokens.EXTRA` | unsourced |
| SPS | **hardcoded** in `count_tokens.EXTRA` | unsourced |

The rates in the code (`RATE_IN, RATE_OUT = 2.0, 12.0`) match the caption's
Gemini 3.1 Pro prices, and every row's cost recomputes from its own token counts.

### The Total row: the paper is 8 tokens high

| | calls | tokens in | tokens out | time | cost |
|---|---|---|---|---|---|
| data (`llm_cost.json`, and the row sum) | 26 | **70,918** | 67,206 | 34.4 min | $0.95 |
| paper (L1794, corrected 2026-09-18) | 26 | **70,918** | 67,206 | 34.4 min | $0.95 |

Everything else in the row agrees, and the six artifact rows sum exactly to the
data's 70,918 — so this is a transcription slip in the paper, not a data problem.
The committed `data/tab_llm_cost.tex`, which the generator emits, prints 70,918.
The cost is unaffected: 8 input tokens is $0.000016. `STATE.md` flag 22.

### The two hardcoded columns

`count_tokens.EXTRA` carries LoC Δ and SPS with the comment "Measured elsewhere,
carried here so the table has a single source" — but where is not recorded, and
the comment then describes SPS as "single-core throughput on the suite's
full-node configuration", which is self-contradictory. The paper's caption says
full-node, and it is right: the committed single-core figures for these same
games (`outputs/percmd.json`) are 11,222 for breakout.multi and **623** for
qbert.v2, against the table's 355k and 39k. So the column is full-node trainer
throughput and the code comment is wrong by a factor of 30 to 60.

The qbert value is corroborated elsewhere: main.tex L778 says "qbert.bigmap
reaches 39k SPS against the suite's 0.35M ceiling", and 39k is the table's own
cell, with the four non-render-bound artifacts sitting at 354–356k, i.e. that
0.35M ceiling. The numbers are coherent; what is missing is the measurement they
came from. `STATE.md` flag 21.

### Artifact names

Four of the six rows are printed in the paper under different names than
everything in the repo uses — `breakout.multiball` for `breakout.multi`,
`qbert.bigmap` for `qbert.v2`, `flappy_bird.hoop` for `flappy_bird.dunk2`, and
`downwell` for `downwell_fresh`. The generation logs, the JSON's `artifact` keys
and the generated LaTeX all use the repo names. `check_llm_cost.py` resolves them
through `data/variant_names.tsv`, which this iteration extended with the
`downwell` row, and reports each match under the name the paper prints. Same
issue as § fig:learning panel B; `STATE.md` flag 9.

`qbert.v2` is worth one note: its two calls are logged under two different names,
`qbert.v1_variant` and `qbert.v2_variant`, because the first produced v1 and the
second produced v2 from it. `count_tokens.ARTIFACTS` globs both, which is why its
Calls is 2 rather than 1.

```
runs/  not applicable: these are LLM API calls, logged in
       reproduction/data/generation-logs/, not cluster jobs. The SPS column's
       measurement is the one piece with no recorded provenance (flag 21).
```

---

## tab:contrast — Qualitative properties of environment families (Table 2)

```
graphic:   tabular, main.tex L727
code:      none — a qualitative judgement table
data:      none measured
```

Descriptive. No cell is a measurement, so what this section records is where each
judgement comes from: a citation for the other families, and for PlayTrain's own
column, the label in this paper that supports it.

| row | PlayTrain's cell | what backs it |
|---|---|---|
| Complexity | Flexible | § sec:variants; the generation pipeline, `playtrain/src/playtrain/gen/` |
| Efficiency/Speed | High | **measured**: fig:env_efficiency (12.62x ALE, 2.19x ProcGen per core) and tab:train-throughput (1.07M agent-steps/s) |
| Adaptability — training variations | Anything Describable | § sec:variants; tab:llm-cost, six artifacts generated for $0.95 total |
| Adaptability — test environments | Anything Describable | same; the held-out level seeds in tab:eval |
| Adaptability — game designs/dynamics | Very High | § sec:variants' three variant axes (parametric, structural, visual/thematic) |
| Human Playability | High and Adaptable | **measured**: fig:human_wallclock, 20 participants played the same game files the agents train on |

The comparison columns rest on citations rather than measurements of those
systems: Atari on `bellemare2013ale`, ProcGen on `cobbe2020procgen`, and the
GPU-port column on `radji2025octax` and `earle2025puzzlejax` as the caption
states. All four keys resolve in the bibliography. The rows for those columns are
the authors' reading of those systems, not anything this repo can check — which
is the honest status of a qualitative table and is worth saying plainly rather
than implying the whole table is sourced.

Two of the six PlayTrain cells are backed by labels this harness verified
(Efficiency/Speed and Human Playability). The other four are claims about
capability, supported by the generation pipeline existing and being exercised,
not by a number.

### A latent LaTeX defect: one column too many

`\begin{tabular}{l|ccccc}` declares **six** columns. The header supplies five
(`Property & Atari & ProcGen & GPU-port & PlayTrain (ours)`), and so does every
data row. The commented-out `Edit Target` row just below supplies **six** —
`& ROM & C++ source & ROM/script & Python & \textbf{JS file}` — so the table
previously had a fifth data column (Python) that was removed from the header and
the rows but left in the column specification.

The effect is a trailing empty column with the `|` rule sitting one column too
far left of where the content ends. It renders without an error, which is why it
has survived. `STATE.md` flag 25.

The `Adaptability` row is a deliberate bare label with a single cell and is not
part of this problem.

---

## tab:action-space — The default Discrete(8) action space (Table 3)

```
graphic:   tabular, main.tex L1008
redraw:    bash reproduction/reproduce.sh action_space
code:      reproduction/figures/tools/check_action_space.py
source:    playtrain/runtime/action_spaces.json  ->  key "default8"
           playtrain/src/playtrain/runtime/action_space.py  (the loader and contract)
```

**All eight rows verify against the shipped spec, 0 mismatches.** The checker
parses the tabular out of `main.tex` and compares every index, name, keycode
list and delivery mode against `runtime/action_spaces.json`, which is the
canonical file — wheel-bundled, and read by the Python runtime, the Node runtime
and the study-harness builder alike, so the table describes what all three use.

| index | name | keycodes | delivery | spec entry |
|---|---|---|---|---|
| 0 | NOOP | — | — | `held: []`, `press: null` |
| 1 | LEFT | 37 | held | `held: [37]` |
| 2 | RIGHT | 39 | held | `held: [39]` |
| 3 | UP | 38 | held | `held: [38]` |
| 4 | DOWN | 40 | held | `held: [40]` |
| 5 | D | 32 | press | `press: 32` |
| 6 | LEFT+D | 37, 32 | held + press | `held: [37]`, `press: 32` |
| 7 | RIGHT+D | 39, 32 | held + press | `held: [39]`, `press: 32` |

The paper's "Delivery" column is a rendering of the spec's two fields, and
`action_space.py`'s docstring defines them: `held` keys are down for every frame
of the step; `press` fires the game's `keyPressed()` handler once before the
first frame **and** is down for that frame. So "held" means a non-empty `held`
with `press: null`, "press" the reverse, and "held + press" both. That
distinction is why row 5 lists keycode 32 under "press" while rows 1–4 list
theirs under "held".

The only difference is cosmetic: the paper writes `LEFT+D` and `RIGHT+D` where
the spec names them `LEFT_D` and `RIGHT_D`. The checker treats `+` and `_` as
equivalent and says so.

### Context the surrounding prose asserts

- "the action space is defined by the framework's backend instead of the games"
  (L989) — borne out by the spec being a runtime asset, not a per-game field;
  the generated game files contain no action definitions.
- "hot-swappable, and only requires filling out a JSON file" — the file ships
  **five** named spaces, not one: `default8`, `thrust10`, `aimgrid18`,
  `mouse2d`, `gamepad2s`. `action_space.py` accepts a name, a path to a `.json`,
  or `None` for `default8`. The last two are continuous: the module documents a
  `Box` form over `pointer_x` / `pointer_y` / `axis:0..3` / `button:mouse` /
  `key:<code>` channels.
- The wire contract, which nothing in the paper states and which matters for the
  reproducibility claim: every analog value is quantized to uint16 at the
  producer as `q = floor(clamp(v01) * 65535 + 0.5)` and dequantized identically
  in every engine, with button and key channels pressed iff `q >= 32768`.
  "Continuous above the wire, bit-exact below it" is what keeps replay and the
  cross-engine gate exact.

`fig:action-spaces` (L1067) quotes two entries from this same file and is
recorded under its own label.

---

## tab:step-return — What a step returns (Table 4)

```
graphic:   tabular, main.tex L1045
redraw:    bash reproduction/reproduce.sh step_return
code:      reproduction/figures/tools/check_step_return.py
source:    playtrain/src/playtrain/runtime/env.py   (the contract and the defaults)
           playtrain/src/playtrain/runtime/validate.py  (terminal states)
           playtrain/native/qjs/qjs_host.cpp, native/aotfork/qjs_host_fork.cpp
```

Every claim in the table is fixed by source rather than measured, and six of the
eight rows check out exactly:

| row | paper | source |
|---|---|---|
| observation | `uint8[64,64,3]` | `observation_space = Box(0, 255, (obs_size, obs_size, channels), uint8)`, `obs_size: int = 64` |
| reward | change in the game's score | `reward = score - lastScore` in both native hosts |
| terminated | true when `gameState` is no longer `PLAYING` | `TERMINAL_STATES = {WIN, EXIT, GAMEOVER}` in `validate.py`, which also asserts the two agree |
| truncated | true at `max_steps`, default 2000 | `DEFAULT_MAX_STEPS = 2000` |
| `info.score` | cumulative score | in `_build_step_message` |
| `info.lives` | lives remaining | in `_build_step_message` |
| `info.seed` | seed for the current episode | in `_build_step_message` |

Two rows are incomplete rather than wrong, and both are worth closing because
this table is the step contract a reader implements against.

### `info.gameState` omits a state

The paper gives three values — `PLAYING`, `WIN`, `GAMEOVER`. The runtime defines
**four**: `_GS_NAMES = ("PLAYING", "WIN", "GAMEOVER", "EXIT")`, with `"UNKNOWN"`
as an out-of-range fallback. `EXIT` is not hypothetical: `validate.py`'s
`TERMINAL_STATES = {"WIN", "EXIT", "GAMEOVER"}` treats it as terminal and flags
any step that reports `terminated` without a terminal `gameState`. So a reader
implementing against the table would treat an `EXIT` step as a contract
violation. `STATE.md` flag 26.

### `info.episodeLength` is returned but not listed

`_build_step_message` puts five keys in `info` — `score`, `lives`, `gameState`,
`episodeLength`, `seed` — and the table lists four. `episodeLength` is missing.
Same flag.

### Context

The caption's derivation note is right on both counts: the reward is a score
delta, and `terminated` is derived from `gameState` rather than reported
independently, which is exactly what `validate.py` cross-checks.

One thing the table describes only in its default configuration, worth stating
since the prose calls the observation "a single 64x64 RGB frame with no
stacking": `env.py` also supports `obs_mode="symbolic"`, which replaces the
frame with a `Box(-inf, inf, (symbolic_dim,), float32)` and requires the game to
declare `obs.symbolic`. The 64x64 RGB row is the default path, not the only one.

---

## fig:action-spaces — Two entries from the action-space file (Figure 7)

```
graphic:   lstlisting, main.tex L1067  (style=jsonfig, defined at L63)
source:    playtrain/runtime/action_spaces.json
verify:    bash reproduction/reproduce.sh action_space  covers the default8 rows
```

The listing quotes two entries verbatim from `runtime/action_spaces.json`.

**`default8`** — the three actions shown match the file exactly, and the caption
correctly says it is "abridged to three of its eight actions", with the listing
itself carrying a `/* [...] five more */` marker:

| listing | file |
|---|---|
| `{ "name": "NOOP", "held": [], "press": null }` | identical |
| `{ "name": "LEFT", "held": [37], "press": null }` | identical |
| `{ "name": "LEFT_D", "held": [37], "press": 32 }` | identical |

All eight actions are checked against the file under § tab:action-space.

**`mouse2d` is abridged too, but nothing says so.** The listing shows

```
"mouse2d": { "type": "box", "channels": ["pointer_x", "pointer_y"] }
```

while the file has **three** channels:
`["pointer_x", "pointer_y", "button:mouse"]`. Unlike `default8`, this entry
carries no ellipsis and the caption does not mention trimming it, so it reads as
complete.

This one costs the paper something. The prose two paragraphs later says the
continuous backend "sets `mouseX`, `mouseY`, and `mousePressed` instead of key
state" — three things. With `button:mouse` restored the entry matches that
sentence exactly; as printed, the illustration is missing the very channel that
`mousePressed` corresponds to. `STATE.md` flag 27.

The file ships two more entries the figure does not quote, both discrete:
`thrust10` (10 actions) and `aimgrid18` (18). The `//` key at the top of the
file is a documentation string, not a space.

### The listing style is hand-fitted, and one listing already loses by it

`\lstdefinestyle{jsonfig}` at L63 highlights by enumerated keyword, not by
grammar:

```
emph={default8, mouse2d, name, held, press, type, channels}
emph={[2]NOOP, LEFT, LEFT_D, box, pointer_x, pointer_y}
```

Those two lists are exactly the tokens in *this* listing and nothing more, so
any edit here silently loses its colour. Adding `button:mouse` would render
unhighlighted — and, because the token contains a colon, `lstlisting`'s
word-boundary matching may not treat it as one word at all, so it likely needs
`literate` or a different mechanism rather than an `emph` entry.

The same style is reused at L1763 for `fig:catalog`, and it already loses there:
of that listing's four keys, only `name` is in the list. **`ref`,
`actions_used` and `mechanic` render unhighlighted** while `name` is coloured,
which looks like a deliberate distinction and is not one. Recorded under
`fig:catalog` as well; same flag.

### Prose claims around the figure

- "The action space ... is a named entry in a JSON configuration file and is not
  built into PlayTrain" — borne out: `action_space.py` reads
  `runtime/action_spaces.json` and accepts a name, a `.json` path, or `None`.
- "A held key is down for the step, while a press key is down for the step *and*
  fires `keyPressed()` once" — matches both `action_space.py`'s docstring and
  the `//` note in the JSON itself.
- "continuous input values are given to the PlayTrain backend as integers ...
  because floating point values are not exactly reproducible across JavaScript
  engines" — this is the uint16 wire contract recorded under § tab:action-space:
  `q = floor(clamp(v01) * 65535 + 0.5)`, dequantized identically in every
  engine.
- The Configuration paragraph's adjustables (resolution, frame skip, render
  skip, frame stack, truncation horizon, grayscale; env count, worker threads,
  action space, seeding mode) are `PlayTrainEnv.__init__` keyword arguments —
  `obs_size`, `obs_mode`, `max_steps` and the rest — none of which require
  touching a game file, as claimed.

---

## tab:p5-subset — The p5.js subset the backend binds (Table 5)

```
graphic:   tabular, main.tex L1114
redraw:    bash reproduction/reproduce.sh p5_subset
code:      reproduction/figures/tools/check_p5_subset.py
source:    playtrain/native/qjs/qjs_host.cpp  ->  BINDINGS[], registered in a
           loop with JS_NewCFunction (L327)
```

Three counts are involved and no two of them agree.

| count | value |
|---|---|
| commands the table lists | **37** |
| commands the caption claims | **40** |
| C functions the host actually binds | **65** |

### Where the 40 comes from

The caption's own text names three compatibility no-ops — `noLoop`, `frameRate`,
`cursor` — and all three are in `BINDINGS[]`. **37 listed + those 3 = 40.** That
is almost certainly the arithmetic behind the number, but the caption reads as
describing the table ("40 p5.js commands the C++ later binds to" above a table of
37), so as printed the count does not match what is shown. `STATE.md` flag 28.

### "binds to" does not describe five of the 37

The Input row mixes three different mechanisms:

- `keyIsDown` — a bound C function, in `BINDINGS[]`;
- `keyPressed` — a callback the **game** defines and the host calls;
- `mouseX`, `mouseY`, `mouseIsPressed`, `gamepadAxes` — globals the **host
  writes** each step via `JS_SetPropertyStr`, not functions a game calls.

So five of the 37 names are not bindings in the sense the caption states. They
are still part of the surface a generated game sees, which is the point the table
is making; the wording is what is loose. The host's per-step writes are visible
at `qjs_host.cpp` L449–454, including the uint16 dequantization
(`f.qx / 65535.0 * p5::width()`) recorded under § tab:action-space.

### 33 bound commands the table does not list

The caption covers this with "operations such as noLoop, frameRate, cursor, and
more a compatible no-ops so that games don't crash" — a reasonable summary, but
worth recording what the 33 actually are, because **20 of them are 3D and voxel
commands**: `box`, `sphere`, `cone`, `cylinder`, `ellipsoid`, `rotateX/Y/Z`,
`ambientLight`, `directionalLight`, `pointLight`, `noLights`,
`ambientMaterial`, `emissiveMaterial`, `normalMaterial`, `specularMaterial`,
`shininess`, `voxelDusk`, `voxelSprite`, `voxelView`.

Those are the surface of the 3D runtime that was removed from the project; their
bindings remain in the host. They are not no-ops in the sense the caption means,
and a reader counting `BINDINGS[]` to check the table would hit them first. The
remaining 13 are genuine 2D extras and no-ops: `loop`, `noLoop`, `frameRate`,
`cursor`, `noCursor`, `smooth`, `noSmooth`, `tint`, `textFont`, `createBitmap`,
`loadBitmap`, `setTarget`, `clearTarget`.

### What the table gets right

Every one of the 32 non-input names it lists **is** in `BINDINGS[]` — no listed
2D drawing command is missing from the host. The grouping is also faithful to
the rasterizer's own structure: `beginShape`/`vertex`/`endShape` are the custom-
shape path priced per polygon in fig:envcost, and `createGraphics`/`image` are
the offscreen path. The claim that "the command names match p5.js so that a
generated file runs as written" holds for all 37.

---

## tab:backend-pieces — The four pieces compiled into the backend (Table 6)

```
graphic:   tabular, main.tex L1140
source:    playtrain/native/build_qjs.sh   (the build that compiles all four)
           playtrain/crates/rasterizer/    (Rust staticlib)
           playtrain/native/runtime/p5.cpp (the C++ p5 layer)
           playtrain/native/frozenmath/    (vendored OpenLibm, exposed as fm_*)
```

All four rows check out against the build script, which compiles exactly these
and no others. `native/build_qjs.sh`'s own header says it: "Builds: rasterizer
staticlib (cargo) + QuickJS staticlib (clang) + qjs_host."

| piece | paper's language | evidence |
|---|---|---|
| QuickJS | C | QuickJS staticlib built with clang; `native/qjs/` |
| p5 layer | C++ | `native/runtime/p5.cpp`, whose header says it mirrors `runtime/p5/p5-shim.mjs` "call-for-call against the rasterizer C ABI" |
| Rasterizer | **Rust** | `cargo rustc --release --lib --crate-type staticlib` in `crates/rasterizer/`, linked as `libplaytrain_rasterizer.a`; p5.cpp calls it through `raster_abi.h` (`rs_set_fill`, `rs_set_stroke`, …) |
| Frozen math | C | `native/frozenmath/`, a vendored clone of **JuliaMath/openlibm** compiled with `-Dsin=fm_sin -Dcos=fm_cos` |

The Rust row is worth confirming explicitly because the repo contains a second,
C++ rasterizing path (`p5.cpp` carries AVX2 intrinsics) that could be mistaken
for *the* rasterizer. It is not: `p5.cpp` is the p5 layer, and it forwards to the
Rust staticlib across a C ABI. The Rust crate also holds `three.rs` and
`voxel.rs`, the 3D surface whose host bindings § tab:p5-subset found still
present.

### Why the frozen math exists, which the caption does not say

The build script records the bug that produced it, and it is a better
justification than the paper gives:

> sin/cos were added when a generated asteroids clone exposed that the psin/pcos
> polynomial in jsmath.h diverges from V8's fdlibm sine once game logic calls
> `Math.sin` (the poly is only for rasterizer-internal geometry). fm_sin/fm_cos
> are fdlibm with full Payne-Hanek reduction — the same lineage V8 ships.

So there are two distinct sine implementations by design: a fast polynomial for
rasterizer-internal geometry, and fm_sin/fm_cos for anything a game's JavaScript
calls. The determinism claim rests on the second. The public symbols are renamed
to `fm_*` specifically "so they never collide with the platform libm", which is
what makes the row's "Replaces: the platform's `libm`" accurate.

### One wording caveat

The caption says the four are listed "in the order a frame passes through them".
That holds for the first three — QuickJS interprets the game, the p5 layer
receives its draw calls, the rasterizer writes the observation buffer. The
fourth is not a stage in a frame's path: frozen math is a library the other
pieces call, reached whenever game logic or geometry needs a transcendental, not
after the rasterizer. Minor, and not worth a flag on its own; recorded here so
the ordering claim is not read as a pipeline.

The surrounding prose checks out too: the backend is built per machine with
profile-guided and link-time optimization (the `-flto` and PGO flags in the same
script, and the disclosure in § tab:bench-scaling that EnvPool runs on its
prebuilt wheel while PlayTrain carries PGO), and the ahead-of-time path is the
one § fig:env_efficiency panel C/D measures as the `tier3` arm.

---

## tab:backend-ladder — The three backends behind Figure 4B (Table 8)

```
graphic:   tabular, main.tex L1226
numbers:   none live — the numeric line is commented out at L1229
measured:  the ladder's throughputs belong to fig:env_efficiency panel B
```

Purely descriptive as printed. The commented-out line
`% Stepping the same games gives 502, 4{,}374 and 37{,}350 env steps/s` is the
adv ladder recorded under § fig:env_efficiency panel B, where the live prose's
13.4x and 117x are also resolved. Nothing in the visible table is a
measurement, so this section sources its fifteen cells.

| row | Browser (Playwright) | Node/V8 | QuickJS (PlayTrain) |
|---|---|---|---|
| JS engine | `chromium` from `playwright-core`, launched headless — `as_run/pw_bench_playwright.mjs` L5, L59 | Node's V8 | QuickJS staticlib linked in-process — `native/build_qjs.sh` |
| p5 layer | real `p5.js` on the page | `runtime/p5/p5-shim.mjs` | `native/runtime/p5.cpp` |
| Rendering | browser canvas, read with `ctx.getImageData(...)` — L40 | `runtime/p5/raster-wasm.mjs` + `rasterizer.wasm` | Rust staticlib via `raster_abi.h` |
| Observation out | base64 per step — `Buffer.from(b, 'base64')` at L47 | packed header written to an mmap file — `runtime/p5/game-worker.mjs` | straight into the observation buffer |
| Driver | Node (the `.mjs` bench script itself) | Python — `bench_compare.py --backend node` | C — the QuickJS host's own benchmark loop |

Every cell resolves to a file in the repo. The Playwright arm's as-run driver is
committed at `figures/as_run/pw_bench_playwright.mjs`, and its adv-era
counterpart (`pw_bench_fasrc_adv.mjs`, job 43783367) is the one behind the
published rungs — see § fig:env_efficiency panel B.

### The two rasterizer rows are the same source, compiled twice

"rasterizer (wasm)" and "rasterizer (native)" read as two implementations. They
are one: `raster-wasm.mjs`'s own header says it is "JS glue for the Rust→WASM
rasterizer (**crates/rasterizer**, built to rasterizer.wasm)", and
`crates/rasterizer` is the same crate `build_qjs.sh` compiles to a native
staticlib for the QuickJS arm (§ tab:backend-pieces).

That sharpens what panel B's Node→QuickJS step measures. It is **not** a
rasterizer-quality difference — the rasterizing arithmetic is identical by
construction, which is also what lets the cross-engine determinism gate be
bit-exact. What changes across that rung is the JS engine, the p5 layer's
language, the compilation target of the rasterizer, and how observations leave
the process. The paper's caption says "only the backend layer underneath is
different", which is right; the table's wording just invites reading the two
rasterizer cells as different code.

`PLAYTRAIN_RASTERIZER=wasm` is the switch that selects the wasm path, so the
Node arm's configuration is reproducible from the environment variable alone.

### Caption caveats

- "The browser backend cannot use our p5 layer or rasterizer" — correct, and the
  driver shows why: it runs the game inside `page.evaluate` against a real
  canvas, so observations can only come back through the page boundary, which is
  the base64 step.
- The caption contains a typo, "brpwser" for "browser" (L1228). `STATE.md`
  flag 29.

---

## fig:trainer_timeline — Three ways inference can work (Figure 9)

```
graphic:   TikZ drawn inline, main.tex L1250-L1275. No image file and no
           generating script -- the picture is LaTeX source, so it redraws
           with the paper and has nothing to reproduce separately.
source:    playtrain-trainers/src/playtrain_trainers/impala/train.py
             `inference_mode` -- the three panels are its three values
           playtrain-trainers/src/playtrain_trainers/train_ppo_clean.py
             `double_buffer` and `_PingPongVecAdapter` -- panel C
```

**The three panels are not an abstract taxonomy — they are the trainer's three
real, configurable modes.** `impala/train.py` documents `inference_mode` with
the same three architectures in the same order, and validates against exactly
that set (plus `remote_vec`, a fourth the figure does not draw):

| panel | `inference_mode` | the source's own description |
|---|---|---|
| (A) Shared-CPU actors | `shared_cpu` (the default) | "monobeast-style: actors hold a `share_memory_()` CPU model and run forward locally. Slow on small batches (~315 SPS on MiniGrid) but matches torchbeast lineage" |
| (B) Centralized batched inference | `central_gpu` | "SEED-style: actors send obs to a central inference thread that batches across actors and runs one GPU forward. Targets ~PPO speed (~1500+ SPS)" |
| (C) Vectorized worker, double-buffered | `vec` + `double_buffer` | "each worker owns a NativeVecEnv of batch_size QuickJS envs + its own GPU inference copy, one batched forward + one GIL-released vec_step per vector step ... targets 100k+ SPS" |

Two lineages the source names and the paper does not: (A) is **monobeast /
torchbeast** and (B) is **SEED**. Those are the systems the two panels depict,
and naming them would make the figure's argument easier to place.

### Panel C is the mechanism tab:dbuf-ablation measures

The caption of `tab:dbuf-ablation` points here explicitly ("Figure~\ref{fig:trainer_timeline}C"),
and the implementation matches the drawing precisely: `PingPongVecEnv` is
constructed with `group_size = cfg.n_envs // 2` — the two groups the panel
shows — and `_PingPongVecAdapter`'s docstring states the overlap condition the
figure illustrates:

> Exposes send/wait per group rather than a blocking `step()`, because the
> overlap only exists if the caller runs inference BETWEEN the two. Per-env
> semantics are identical to the serial path (same env_step, SAME_STEP
> autoreset); only the dispatch is split.

So the diagram's claim — one group steps on the C++ env threads while the
other's inference runs on the GPU — is the adapter's contract, and the **1.34x
geometric mean** in Table 7 is the measured value of that overlap. The
"per-env semantics are identical ... only the dispatch is split" note is what
justifies comparing the two arms at all.

The path also carries guardrails worth recording, because they bound when the
panel's picture applies: `double_buffer` requires `vec_backend='native'` and an
**even** `n_envs` (the envs split into two equal groups), and it rejects
`use_lstm`, `use_rnd` and `use_noveld` outright — "that path keeps per-step
state the interleaved rollout does not carry across groups". A run that would
have had quietly wrong credit assignment fails instead.

### Caption caveats

`STATE.md` flag 30, all cosmetic:

- "per-say" should be "per se" (L1275).
- Panels (A) and (B) are labelled with parentheses in the caption but (C) is
  written `\textbf{C}` without them, so it renders inconsistently with the
  other two and with the in-figure label "(C)".
- "the other's observations inference can be ran" is ungrammatical.

Nothing in the figure itself is inaccurate: the hatched idle blocks in (A) and
(B), and their absence in (C), are exactly what the three modes' documented
throughputs (~315 SPS, ~1500+ SPS, 100k+ SPS) reflect.

---

## tab:hyperparams — Training configuration (Table 12)

```
graphic:   tabular, main.tex L1368
redraw:    bash reproduction/reproduce.sh hyperparams   (needs the data archive)
code:      reproduction/figures/tools/check_hyperparams.py
source:    figures/outputs/s3_icnn_*/config.json   (IMPALA, 72 runs)
           figures/outputs/p3_icnn_*/config.json   (PPO, 72 runs)
           playtrain-trainers/src/playtrain_trainers/impala/train.py
           playtrain-trainers/src/playtrain_trainers/train_ppo_clean.py
```

**Every checkable cell traces to a config key, 0 mismatches.** The table
describes the 100M suite runs, so the authority is the `config.json` each run
carries.

| IMPALA cell | key | PPO cell | key |
|---|---|---|---|
| encoder IMPALA-CNN | `net: impala` | encoder IMPALA-CNN | `net: impala` |
| feature dim 256 | `features_dim` | environments 192 | `n_envs` |
| recurrence none | `use_lstm: false` | rollout length 128 | `n_steps` |
| frame skip / stack 1 / 1 | `frame_skip`, `frame_stack` | minibatches 8 | `n_minibatches` |
| batch size 256 | `batch_size` | epochs per batch 3 | `n_epochs` |
| unroll length 64 | `unroll_length` | lr 2.5e-4, annealed | `learning_rate`, `anneal_lr` |
| discount 0.99 | `discounting` | discount 0.999 | `gamma` |
| baseline cost 0.5 | `baseline_cost` | GAE λ 0.95 | `gae_lambda` |
| entropy cost 0.01 | `entropy_cost` | clip coefficient 0.2 | `clip_coef` |
| reward clip to ±1 | `reward_clipping: abs_one` | value coefficient 0.5 | `vf_coef` |
| gradient-norm clip 40.0 | `grad_norm_clipping` | entropy coefficient 0.01 | `ent_coef` |
| learning rate 5e-4 | `learning_rate` | gradient-norm clip 0.5 | `max_grad_norm` |
| α / momentum / ε | `rmsprop_alpha` 0.99, `rmsprop_momentum` 0.0, `rmsprop_epsilon` 1e-05 | precision fp32 | `bf16: false` |
| precision bf16, channels-last | `learner_precision: bf16`, `vec_infer_bf16`, `channels_last` | `torch.compile` off | `compile_mode: null` |

Optimizers are in the trainers rather than the configs: `torch.optim.Adam(...,
eps=1e-5)` at `train_ppo_clean.py` L810 for PPO, and the `rmsprop_*` keys for
IMPALA. The observation row (`3x64x64` RGB) is the runtime default verified
under § tab:step-return.

### The caption's two structural claims are true, and now measured

> "Each config is identical for every game" … "per-game tuning: none"

Diffing all **72 IMPALA** and all **72 PPO** configs against the first, ignoring
only the per-run identity fields (`game`, `seed`, `log_dir`, the wandb names and
`ddp_rdzv_port`): **zero keys differ**, in either arm. That is the strongest form
the claim could take, and it is worth having as a check rather than an assertion
— it is exactly what a reviewer would doubt.

### The topology rows, and a cross-check that closes

`vec_workers: 12` and `batch_size: 256` give 12 x 2 x 256 = **6,144**
environments, matching the table. `vec_worker_device: "cuda:2,cuda:3"` is two
inference GPUs of the four, leaving two for DDP — the table's "2 DDP + 2
inference GPUs".

That 6,144 is the same number § fig:suite_trainers needed: 6,144 x 2,000 frames
= 12.288M, the horizon at which `maze`, `heist` and `freeway` first terminate.
Two labels, derived independently, agree.

### One cell is abbreviated

`torch.compile` is given as **max-autotune**; the config says
**`max-autotune-no-cudagraphs`**. The suffix is not cosmetic — it disables CUDA
graph capture — so the table names a mode that differs from the one that ran.
Minor, and the direction is conservative (the paper claims the more aggressive
setting), but worth correcting. `STATE.md` flag 31.

The throughput configs are a different thing and should not be confused with
this table: Table 1(a)'s PPO template uses `n_envs=768, n_steps=128,
n_minibatches=32` (§ tab:train-throughput), against the 192 / 128 / 8 here. The
prose at L1408 quotes this table's numbers — 128 steps x 192 environments =
24,576 timesteps — and that arithmetic is right.

---

## tab:envpool-config — The tuned EnvPool configuration (Table 13)

```
graphic:   tabular, main.tex L1560
redraw:    bash reproduction/reproduce.sh envpool_config
code:      reproduction/figures/tools/check_envpool_config.py
source:    reproduction/runs/43779854/ep_best_sweep.sbatch   (the as-run job)
```

**All nine rows are evidenced in the as-run submission, 0 unevidenced.** This is
the configuration behind the EnvPool documented-best arm of
§ fig:env_efficiency panel A, and the sbatch is committed, so each row points at
a line rather than at a description.

| row | paper | line in `ep_best_sweep.sbatch` |
|---|---|---|
| API | `make_gymnasium`, `async_reset`, `send`/`recv` | `envpool.make_gymnasium(...)`, `env.async_reset()`, `env.recv()`, `env.send(...)` |
| pools per node | one per NUMA domain, each in its own process | domains from `glob.glob("/sys/devices/system/node/node[0-9]*")`; one `subprocess.Popen` per domain |
| envs per pool | total ÷ domains (2,048 at 80 threads) | `envs = 2048 * T // 80`, then `pe = envs // K` |
| threads per pool | total ÷ domains | `pe, pt = envs // K, max(1, T // K)` |
| batch size | max(16, 3 × threads per pool) | `BS = max(16, pt * 3)` |
| thread affinity | offset to that domain's first CPU | `thread_affinity_offset=off`, passed as `str(i * CPD)` |
| ALE spec | 64×64 RGB, `stack_num=1`, `frame_skip=1` | `img_height=64, img_width=64, gray_scale=False, stack_num=1, frame_skip=1` |
| ProcGen spec | defaults, already 64×64 RGB | the kwargs above are gated on `if env_id.endswith("-v5")`, so ProcGen gets only `batch_size` |
| actions | uniform random, sampled per batch | `np.random.randint(0, na, size=len(ids))`, sized to the batch `recv` returned |

The ProcGen row is worth spelling out because it is a claim about *absence*: the
observation kwargs apply only to `-v5` ids, which are the ALE ones, so ProcGen
environments are constructed with nothing but `batch_size`. "Defaults" is
literal.

The caption's "ALE is moved off its 84×84 grayscale stack-4 default so both
comparisons see the same observation" is exactly what that `-v5` branch does,
and it is the right direction to disclose: it makes ALE do more work than its
default, not less.

### The prose claims too

Both statements at L1583 check out in the same file:

- "each NUMA pool is warmed up for four seconds, the following twelve seconds
  are then measured" — `pump(4.0); n, dt = pump(12.0)`, where `pump` returns
  the step count and elapsed time and the reported figure is `n / dt`.
- "We sum across all the pools for the node and then take the geometric mean
  afterwards" — the parent sums each child's `sps` (`tot += json.loads(...)`)
  and reports `geo(...)` over games.

`PROVENANCE.md` § tab:bench-scaling records what this configuration produced,
and § fig:env_efficiency panel A records the caveat that matters most: this arm
was measured at 10/20/40 threads in this job and 80 threads in job 43570992,
with 5, 30 and 60 threads derived rather than measured.

One disclosure the paper makes and this section should echo: PlayTrain is
compiled with profile-guided optimization while EnvPool runs on its prebuilt
wheel (L1584). That is stated in the paper, and it is the kind of asymmetry a
reader should weigh against the ratios.

---

## fig:generation and fig:backend — the two hand-drawn schematics (Figures 1 and 3)

```
graphics:  figures/generation.png            (fig:generation,  main.tex L194)
           figures/architecture_schematic.png (fig:backend,    main.tex L325)
source:    NONE. Neither has a source file in any repo -- no .svg, .key, .ai
           or generating script. Confirmed by search and corroborated by
           playtrain-wt-tuning/docs/REPRO.md, which records the same finding.
```

Both are hand-drawn raster images. `generation.png` is 1329x1232 RGBA carrying
an Apple ICC profile and Adobe XMP, i.e. exported from a GUI tool, but nothing
in it names the tool and no project file exists. **A reviewer asking for a
change to either figure means redrawing it from scratch.** That is the honest
status and it is worth stating in a reproducibility appendix rather than leaving
the reader to infer that every figure has a pipeline.

`fig:generation`'s content is not a measurement: panel A is the concept
illustration (DownWell and VVVVVV becoming RL environments) and panel B is the
generation pipeline, whose mechanics are sourced under § fig:catalog and
§ tab:llm-cost.

### fig:backend's published drawing has two identified errors

**Retracted 2026-09-18.** The published `architecture_schematic.png` was checked by
eye against the code: it shows one QuickJS env per box inside the threadpool and
an observation buffer labelled "one slot per env", which is the implementation.
The docstring quoted below describes the drawing that preceded it
(`architecture_schematic_old.png` in the paper repo shows the same corrected
content, so the fix predates both). `fig_schematic.py` remains a draft that adds
the group A / group B double-buffering split; it is not a correction. The
paragraphs below are kept as the record of the claim.

`reproduction/figures/fig_schematic.py` exists and `reproduce.sh` runs it, but
**it does not reproduce `architecture_schematic.png`**. Its own docstring says
what it is:

> Draft replacement for the PlayTrain schematic. Corrects the two things the
> current drawing gets wrong:
> - one QuickJS engine per *environment*, not per batch
> - one observation buffer whose halves belong to two env groups, rather than
>   two buffers that swap roles (there is no swap arrow here)

Both corrections check out against the implementation:

| the draft's claim | evidence |
|---|---|
| one QuickJS engine per environment | `native/qjs/qjs_vec_host.cpp`'s per-env state struct (L389–402) holds a `JSRuntime*` per environment, each with "its own JSContext + rasterizer state + p5 shim state" |
| one shared observation buffer, halves per group | `PingPongVecEnv`: "Group g = env indices [g*group_size, (g+1)*group_size); outputs are contiguous views into the **shared** buffers", with `num_envs = 2 * group_size` |

So the figure printed in the paper misstates the engine granularity and the
buffer topology, and a corrected drawing already exists in the repo but was
never swapped in. `STATE.md` flag 32.

This also means `reproduce.sh`'s schematic step was misleading: it reported
drawing "Architecture schematic" while producing a figure that deliberately
disagrees with the published one. The step is relabelled this iteration to say
so, in the same spirit as the suite-grid fix in § fig:suite_trainers. It still
runs, because the draft is the useful artifact — it is just not a reproduction.

```
runs/  not applicable: no jobs, no data, no pipeline.
```

---

## fig:game-interface and fig:variant-generation-example — the two tester screenshots (Figures 13 and 14)

```
graphics:  figures/game-interface.png, figures/variant-generation-example.png
recipe:    cd playtrain && just tester      # -> uv run --extra gen python tools/tester.py
           then localhost:3000
source:    playtrain/tools/tester.py        (the UI in the screenshots)
           playtrain/runtime/p5/raster.mjs  (what the centre panel renders through)
```

Screenshots of a live UI, so there is no data or job behind them — what a reader
needs is the command that brings the interface up, and confirmation that it comes
up populated from a clean clone. Both hold.

`just tester` resolves to `uv run --extra gen python tools/tester.py`, which
serves the interface on localhost:3000. Every element the captions describe is in
that file:

| caption claim | in `tools/tester.py` |
|---|---|
| left pane lists every game with variants nested underneath | `list_games()` over `games/js/*.js`, with the variant registry from `playtrain.gen.variant.load_registry` |
| centre panel runs the selected game in a canvas "through the same `raster.mjs` rasterizer" | the browser shim loads PlayTrain's own rasterizer — the file's comment says "PlayTrain's own rasterizer, not real p5. The tester used to load…" |
| right pane shows the game's console output alongside the model's generation process | the handler streams generation events through a `queue` to the page |
| the bar switches between Refine and Fork; Refine edits the current game, Fork writes a new file | `refine_game` and `make_variant` / `promote_variant` from `playtrain.gen` |

### It self-seeds, which is what makes the recipe work from a clean clone

The tester reads `games/js/`, **not** the `examples/games/js/` that every
benchmark and training run uses — and `games/js/` ships effectively empty (one
tracked file, no `.js`). On its own that would mean a reader running
`just tester` sees the blank left pane rather than the populated one the caption
describes.

It does not, because the tester seeds itself on startup: if `games/js` contains
no `*.js` it copies every game from `games_dir()`, which resolves to
`playtrain/examples/games/js` — **63 game files** in this checkout. So the first
run populates the interface, and subsequent runs leave it alone (`if
any(JS_DIR.glob("*.js")): return 0`). Worth recording because the two-games-
directory split is otherwise exactly the kind of thing that makes a documented
recipe fail silently.

### What cannot be reproduced

The screenshots are of particular moments: a specific game selected, specific
console output, and in `fig:variant-generation-example` a specific human prompt
with a parent frame beside its result. Re-running the tester gives the interface,
not those frames. The caption's "The text shown is the human's verbatim prompt
feedback" is not recoverable from the repo — that prompt is not in
`data/generation-logs/` under any of the four variant names (§ fig:learning
records the naming mismatch), and the two PNGs carry no provenance metadata
beyond their timestamps.

So these two labels are reproducible as *the interface*, and not as *the images*.
That is the honest status for a UI screenshot and does not need a flag; it is
recorded here so the claim is not read as stronger than it is.

`fig:variant-generation-example`'s substance is checkable elsewhere: the variant
it shows is one of the four in § tab:llm-cost, whose call counts, token counts
and wall-clock are verified against the generation logs.

---

## fig:catalog — A catalog entry (Figure 15)

```
graphic:   lstlisting, main.tex L1760  (style=jsonfig, defined at L63)
source:    playtrain/games/catalogs/arcade_games.json  ->  the "donkey_kong" entry
consumer:  playtrain/src/playtrain/gen/generate.py  ->  build_prompt()
```

**The listing is content-identical to the shipped entry**, all four fields, with
the seven `actions_used` values in the same order:

```json
{ "name": "donkey_kong",
  "ref": "https://ale.farama.org/environments/donkey_kong/",
  "actions_used": ["LEFT","RIGHT","UP","DOWN","D","LEFT+D","RIGHT+D"],
  "mechanic": "climb ladders + jump barrels to rescue" }
```

Eight catalogs ship in `games/catalogs/` — `arcade_games`, `atari_games`,
`atari_enriched`, `nes_games`, `mobile_games`, `procgen_games`, `from_scratch`,
plus a `refs/` directory.

### The caption overstates one field

> "The reference URL is fetched and included as text, `actions_used` **selects
> the action space**, and the mechanic is one line"

The first and third clauses hold: `fetch_ref(url)` dispatches to
`_fetch_wikipedia` / `_fetch_appstore` / `_fetch_steam` and the result is passed
to `build_prompt` as `ref_text`, and `mechanic` is a one-line string gated by
`include_mechanic`.

`actions_used` does **not** select an action space. Its only consumer in the
entire repo is one line of `build_prompt`:

```python
actions = ", ".join(game.get("actions_used", []))
```

It is flattened into **prose in the LLM prompt** — a human-readable list telling
the model which actions the game should use. Nothing resolves it against
`runtime/action_spaces.json`, and the paper says elsewhere (L1091) that "for all
of the experiments in this paper, we use the `default8` action space". So the
action space is fixed, and this field describes which of its eight actions the
generated game should exercise. `STATE.md` flag 33.

### The two naming conventions, resolved

This also settles a loose end from § tab:action-space. The catalog writes
`LEFT+D` and `RIGHT+D`; `runtime/action_spaces.json` names the same actions
`LEFT_D` and `RIGHT_D`. There is no bridging code because none is needed: the
catalog's names are prompt text and the spec's names are runtime identifiers.
They are two deliberate conventions, not a mismatch — which is a better
description than the "cosmetic" note recorded earlier under tab:action-space.

The paper's `tab:action-space` uses the catalog's plus form, so the two figures
are at least consistent with each other.

### The listing's highlighting is broken

Of this listing's four keys, only `name` is in the `jsonfig` style's `emph`
list, so `ref`, `actions_used` and `mechanic` render **unhighlighted** while
`name` is coloured — which reads as a deliberate distinction and is not one.
Recorded under `STATE.md` flag 27 together with the `mouse2d` finding for
§ fig:action-spaces, which shares the style.

### "The only human input"

The caption calls the catalog entry "the only human input in the initial
generation process", and `build_prompt`'s signature supports it: everything else
it takes is either fetched (`ref_text`), a fixed asset (`template`), or derived
(`source_text` for the ProcGen clones, which the prose at L1786 says passes the
original C++ source in place of a mechanic line). Refinement is a separate step
where a human does supply prose — that is § fig:variant-generation-example.

---

## § File index

Every code file under `reproduction/`, and which labels use it. Generated
from `git ls-files` and cross-checked against `reproduce.sh --list`, so a file
added without a label will show up here as unaccounted.

### On a paper path (31 files)

| file | labels |
|---|---|
| `anonymize_study_data.py` | fig:human_wallclock — produced the committed `data/study/` from the raw sessions (it is why ages are banded) |
| `figures/as_run/pw_bench_playwright.mjs` | tab:backend-ladder, fig:env_efficiency B — the as-run Playwright driver (pre-adv; the adv one is in runs/43783367/) |
| `figures/fetch_data.sh` | fig:learning, fig:envcost, the 3 suite figures — fetches the figure-data-v1 archive |
| `figures/fig_schematic.py` | fig:backend — a DRAFT REPLACEMENT, not a reproduction (flag 32) |
| `figures/human/check_curve_encoder.py` | fig:human_wallclock — the guard that fails on a mixed-encoder curve file |
| `figures/human/cohort.py` | fig:human_wallclock — the cohort claims |
| `figures/human/crossings.py` | fig:human_wallclock — steps to reach the human mean |
| `figures/human/plot_wallclock5.py` | fig:human_wallclock — both panels |
| `figures/tables/dbuf_check.py` | tab:dbuf-ablation — the caption's claims and the mechanism correlation |
| `figures/tables/dbuf_tex2.py` | tab:dbuf-ablation — emits the table body |
| `figures/tables/t1a_agg.py` | tab:train-throughput (a) — the published t3fix arm and the adv2 comparison |
| `figures/tables/t1a_nodes.py` | tab:train-throughput (a) — the per-node breakdown that located the 0.34M/0.35M gap, closed by re-run 47057946 |
| `figures/tables/tab1b.py` | tab:train-throughput (b) — the environment swap |
| `figures/tools/check_action_space.py` | tab:action-space — all 8 rows against the shipped spec |
| `figures/tools/check_backend_ladder.py` | fig:env_efficiency B — the ladder ratios, both rung pairs |
| `figures/tools/check_bench_scaling.py` | tab:bench-scaling — all 70 cells, re-derived |
| `figures/tools/check_bench_setup.py` | tab:bench-setup — the six cells and the mean/median deviation |
| `figures/tools/check_env_cost.py` | fig:envcost — the prose numbers, and the percmd variant guard |
| `figures/tools/check_envpool_config.py` | tab:envpool-config — all 9 rows against the as-run job |
| `figures/tools/check_eval.py` | tab:eval — all 48 cells, parsed from main.tex |
| `figures/tools/check_hyperparams.py` | tab:hyperparams — every cell, and the config-identity claim |
| `figures/tools/check_llm_cost.py` | tab:llm-cost — the whole table, offline |
| `figures/tools/check_p5_subset.py` | tab:p5-subset — the three command counts |
| `figures/tools/check_step_return.py` | tab:step-return — the contract against the runtime |
| `figures/tools/check_suite.py` | the 3 suite figures + the tab:eval prose — composition and crossing claims |
| `figures/tools/plot_env_cost.py` | fig:envcost — draws both panels |
| `figures/tools/plot_env_efficiency_bestonly.py` | fig:env_efficiency — draws all four panels |
| `figures/tools/plot_main_composite.py` | fig:learning — the composite, and its own composition report |
| `figures/tools/plot_suite_grid3.py` | fig:suite_trainers, fig:suite_enc_impala, fig:suite_enc_ppo — one script, three `--arms` |
| `figures/tools/throughput_panels.py` | fig:env_efficiency B/C/D, fig:learning D — imported by both, so the two never diverge |
| `reproduce.sh` | ALL — the entry point; `--list` names every step |

### Kept, not on any paper path (34 files)

Nothing here is deleted. The three groups below are each worth keeping for a
stated reason, and `STATE.md` flag 13 records that the call is the authors'.

| file | why it is kept |
|---|---|
| `figures/as_run/fasrc_parallelism.sbatch` | PRE-ADV parallelism probe |
| `figures/as_run/ladder/exp_qjs_opt.sh` | PRE-ADV ladder experiment |
| `figures/as_run/ladder/sweep.sh` | PRE-ADV ladder sweep |
| `figures/as_run/ladder/sweep2.sh` | PRE-ADV ladder sweep |
| `figures/as_run/ladder/sweep3.sh` | PRE-ADV ladder sweep |
| `figures/as_run/ladder/sweep5.sh` | PRE-ADV ladder sweep |
| `figures/as_run/sweep_atari8.sh` | PRE-ADV as-run submission for the per-core ALE sweep |
| `figures/as_run/sweep_backend_ladder.sh` | PRE-ADV as-run submission for the backend ladder |
| `figures/as_run/sweep_procgen16.sh` | PRE-ADV as-run submission for the per-core ProcGen sweep |
| `figures/human/add_ppo.py` | one-shot: added the PPO arm to a curve file |
| `figures/human/add_sps.py` | one-shot: added SPS to a curve file |
| `figures/human/build_rerun_curves.py` | built the committed rerun_curves*.json — keep: it is how the curve files came to be |
| `figures/human/discover2.py` | one-shot: discovered run dirs |
| `figures/human/eval_human_seeds.py` | side analysis: greedy eval on the human seed pool, capped like humans. Not in the paper |
| `figures/human/extract_human_curves.py` | same, for the human side |
| `figures/human/fix_flappy.py` | one-shot repair, flappy_bird |
| `figures/human/force_flappy_ppo.py` | one-shot repair, flappy_bird PPO arm |
| `figures/human/gen_rerun.py` | one-shot: generated the rerun manifest |
| `figures/human/plot_human.py` | superseded human plotter |
| `figures/human/plot_spread.py` | superseded spread plotter, now panel B of plot_wallclock5.py |
| `figures/human/plot_steps.py` | superseded plotter; crossings.py copied its threshold parsing (and says so) |
| `figures/human/plot_wallclock4.py` | superseded by plot_wallclock5.py |
| `figures/human/restore_flappy_impala.py` | one-shot repair, flappy_bird IMPALA arm |
| `figures/human/sps_compare.py` | side analysis: measured PPO vs IMPALA throughput per game |
| `figures/tables/dbuf_agg.py` | earlier aggregation stage for the double-buffering data |
| `figures/tables/dbuf_tex.py` | earlier table emitter, superseded by dbuf_tex2.py |
| `figures/tools/plot_4a_adv.py` | superseded panel-A preview under the adv binary |
| `figures/tools/plot_env_efficiency.py` | superseded draft of the efficiency figure |
| `figures/tools/plot_env_efficiency_2arm.py` | superseded two-arm variant of the same figure |
| `figures/tools/plot_suite_grid.py` | superseded single-seed 150M suite plotter; its geometry is inherited verbatim by plot_suite_grid3.py |
| `figures/tools/plot_throughput_all.py` | the PRE-ADV throughput figure. Kept because it is the only consumer of results/env_throughput/sweep4.out and sweep6.out, and the only record of the superseded measurement (§ fig:env_efficiency) |

### As-submitted cluster scripts under `runs/` (20 files)

Provenance, not entry points: each is the script the cluster actually ran,
committed beside its `SUBMIT.txt`. **Read them, do not run them** — their paths
refer to the cluster trees as they stood. Each job's label is in its section
above, and `runs/<job>/SUBMIT.txt` carries the verbatim `sacct` line.

| job | script | label |
|---|---|---|
| 38145651 | `bench_vec_scaling_ab.sbatch` | fig:env_efficiency A (pre-adv full ladder) |
| 39032276 | `bench_vec_scaling_ab.sbatch` | fig:env_efficiency A (pre-adv full ladder, ALE) |
| 42009688 | `suite3.sbatch` | fig:learning, the 3 suite figures (IMPALA arm) |
| 42149380 | `ppo3_icnn.sbatch` | fig:learning, the 3 suite figures (PPO arm) |
| 43543523 | `final_any.sbatch` | fig:env_efficiency A (as-shipped curve) |
| 43570992 | `ep_affinity.sbatch` | fig:env_efficiency A + tab:bench-scaling (80-thread points) |
| 43574839 | `ale_sweep.sbatch` | fig:env_efficiency A (adv ALE 10/20/40) |
| 43779854 | `ep_best_sweep.sbatch` | fig:env_efficiency A + tab:envpool-config |
| 43780731 | `adv_anchor.sbatch` | fig:env_efficiency A (PlayTrain arm) |
| 43783363 | `sweep4_adv.sh` | fig:env_efficiency C (ProcGen baseline) |
| 43783364 | `sweep6_adv.sh` | fig:env_efficiency D (ALE baseline) |
| 43783367 | `sweep7_adv.sh` | fig:env_efficiency B (adv Playwright + V8 rungs) |
| 44381429 | `envcost_adv.sbatch` | fig:envcost |
| 44515188 | `tier3_fig4a.sbatch` | fig:env_efficiency A replication |
| 44515373 | `tier3_panelc_ladder.sbatch` | fig:env_efficiency B/C/D (PlayTrain arm) |
| 44516162 | `tier3_pg_ab.sbatch` | tab:train-throughput (b), ProcGen |
| 44516167 | `tier3_ale_ab.sbatch` | tab:train-throughput (b), ALE |
| 44670988 | `t1a_adv2.sbatch` | tab:train-throughput (a), adv2 arm |
| 44748571 | `t1a_t3fix.sbatch` | tab:train-throughput (a), t3fix arm |
| 44861569 | `dbuf_t3_24.sbatch` | tab:dbuf-ablation |

### Nothing was deleted

MISSION allows deleting a file no label uses, in a separate commit with proof in
the message. I deleted nothing, for two reasons worth stating rather than leaving
implicit:

- The largest group of unused files — the sixteen one-shot and superseded scripts
  in `figures/human/` — is the human study's own history. `build_rerun_curves.py`
  and `extract_human_curves.py` are how the committed curve files came to exist,
  and the repair scripts record that `flappy_bird`'s dynamics changed mid-study
  (the reason `ppo3_icnn.sbatch` re-ran the suite at all). Deleting them would
  remove the only trace of that.
- `plot_throughput_all.py` and the pre-adv `as_run/` scripts are the only
  consumers and records of `sweep4.out` / `sweep6.out`, the superseded
  measurement. § fig:env_efficiency depends on being able to point at them to
  explain why those two files are in the repo at all.

`STATE.md` flag 13 records the deletion decision as the authors' to make.

### Data and provenance files not listed above

The index covers code. The committed data files are listed in each label's
section, plus two manifests worth naming here because they are read by tooling
rather than by a figure: `figures/tables/nodes/t1a_nodes.tsv` and
`nodes/dbuf_jobs.tsv` (job maps), `figures/scaling/panelA_measured.tsv`
(measured-vs-derived map), `data/suite_run_jobs.tsv`, `data/variant_names.tsv`,
`data/fig_learning_runs.tsv`, and `figures/tables/nodes/eval_suite_jobs.tsv`.
Each is generated by, or cited in, the section that needs it.
