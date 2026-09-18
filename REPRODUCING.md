# Reproducing the paper

Everything measured in the paper redraws from this repo.

```console
$ bash reproduction/reproduce.sh          # committed data only, about 5 s
$ bash reproduction/figures/fetch_data.sh # the 277 MB run archive, once
$ bash reproduction/reproduce.sh --all    # adds the four figures that need it
```

Needs [`uv`](https://docs.astral.sh/uv/) and network access on first run (each step
fetches matplotlib, numpy and pillow into uv's cache). Nothing else is installed.

Each step prints the paper's number beside the one it just computed, so a divergence is
visible rather than silent. Steps that need the archive say `skipped` until it is
fetched, and the summary line counts them separately from passes. Output goes to
`reproduction/out/`. `reproduce.sh --list` names the steps and `reproduce.sh <name>`
runs one.

Six steps compare table cells against the paper source. When the paper repo is checked
out beside this one they read `main.tex` directly; otherwise they read
`reproduction/data/paper_values.json`, a committed snapshot, and say which they used.

For the code, data file and cluster job behind each figure and table, see
[`reproduction/PROVENANCE.md`](reproduction/PROVENANCE.md). The as-submitted Slurm
script, submit line, node and log head of every job that produced committed data are
under `reproduction/runs/<jobid>/`.

## What reproduces, and from what

| artifact | generator | data | verified |
|---|---|---|---|
| Figure 4, environment efficiency | `reproduction/figures/tools/plot_env_efficiency_bestonly.py` | `figures/results/env_throughput/` (panels B/C/D); `figures/scaling/fig4a7_44545120/` and two job logs (panel A, checked by `check_panel_a.py`) | 12.62x ALE, 2.18x ProcGen, 13.4x and 117x ladder, all exact |
| Learning-curve composite | `reproduction/figures/tools/plot_main_composite.py` | release asset `figure-data-v1` | 24 / 4 / 8 panels, 3+3 seeds all eight games; the paper's variant names map to files via `data/variant_names.tsv` |
| Per-game suite grids | `reproduction/figures/tools/plot_suite_grid3.py` with `--arms trainers|impala|ppo` | `figures/outputs/_suite4_curves.json` | all three appendix figures, 24 games x 3 seeds x 100M |
| Environment cost | `reproduction/figures/tools/plot_env_cost.py`, `tools/check_env_cost.py` | release asset | every prose number: background 390 ns, pong 11 cmds, miner 75% on 787 |
| Human wall-clock | `figures/human/plot_wallclock5.py` | `data/study/`, `figures/human/rerun_curves_icnn.json` | 20 participants, 8 games; crossing steps and every prose count match |
| Architecture schematic | `figures/fig_schematic.py` | none | **not** a reproduction of `fig:backend`, which is hand-drawn with no source file; this is a draft that adds the double-buffering groups |
| Table 1(a), training throughput | `figures/tables/t1a_agg.py` | `figures/tables/data/` | all six rows, after re-run 47057946 moved the IMPALA-CNN row's six slow-node games (`t1a_nodes.py` shows the per-node spread) |
| Table 1(b), environment swap | `figures/tables/tab1b.py` | `figures/tables/verdicts/` | all four numbers exact |
| Table 7, double buffering | `figures/tables/dbuf_tex2.py` | `figures/tables/data/` | byte-identical, all 72 numbers |
| Thread-scaling table | `figures/tools/check_bench_scaling.py` | Figure 4 panel A's constants, themselves checked against jobs 44545120 / 44601287 / 44614598 | all 70 cells; ratios and both efficiency columns re-derived |
| Appendix eval table | `figures/tools/check_eval.py` | `figures/results/eval_iddp_suite.json` | all 48 cells, parsed from main.tex |
| Token cost table | `figures/tools/check_llm_cost.py` (offline); `playtrain.gen.count_tokens` to regenerate | `data/llm_cost.json`, `data/generation-logs/` | all 7 rows exact; LoC and SPS columns have no committed measurement |

The remaining tables are descriptive: engine and backend comparisons, the action space,
the step-return contract, hyperparameters, and the benchmark and EnvPool configurations.
The two tester screenshots are reproduced as an interface, by running `just tester`.

## Individual commands

```console
$ cd reproduction/figures

# Figure 4. Panels B/C/D read results/env_throughput/; panel A is constants in
# the script (its --ab-results / --pg-job / --ale-job flags are accepted and
# ignored; scaling/ is an independent replication, not the figure's source).
$ uv run --no-project --with matplotlib --with numpy --with pillow \
     python tools/plot_env_efficiency_bestonly.py --out .

# Table 1(a). The t3fix row is the published one. The adv2 row printed beside it
# is the previous build.
$ cd tables && uv run --no-project python t1a_agg.py \
     impala_nature=44748571+44784183 impala_icnn=44748573+47057946 \
     ppo_nature=44748574+44784184 ppo_impala=44748575+44784185
```

The token cost table is checked offline against the committed counts in
`data/llm_cost.json`. Only regenerating those counts needs `GEMINI_API_KEY`,
since that re-tokenizes through the API.

`reproduction/runs/<jobid>/` holds each Slurm submission exactly as it ran: the sbatch
file, the `sacct` submit line, the node, and the log head. They are a record of what
produced the committed data, not an entry point: the paths inside them refer to a
cluster tree and virtualenv that are not in this repo. Read them, do not run them. The
two data directories under `figures/results/` each carry a manifest naming every
committed measurement file, the hardware it was taken on, and the caveats that came
with it.

## Four ways to reproduce the wrong thing

Each of these produced a plausible figure from the wrong input, with no error.

- **Two copies of the tools exist and neither is complete.** `figures/tools/` here is the
  union. Do not replace it wholesale from either source.
- **Runs are selected by config content, never by directory prefix.** Prefix globbing has
  twice dropped a whole arm of a comparison silently.
- **`eval_final_agents_b256.json` sits beside `eval_iddp_suite.json`** and is from weaker
  checkpoints. It gives 20 of 24 greedy returns too low while every random return still
  matches, so the table looks right.
- **`throughput_panels.py` verifies the committed data against the published values and
  refuses to draw when they disagree.** That is deliberate. If it fires, the data and the
  paper have diverged.
