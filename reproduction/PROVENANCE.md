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
