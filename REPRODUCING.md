# Reproducing the paper

Everything measured in the paper redraws from this repo.

```console
$ bash reproduction/reproduce.sh          # no download needed
$ bash reproduction/reproduce.sh --all    # adds the learning curves (277 MB, once)
```

Each step prints the paper's number beside the one it just computed, so a divergence is
visible rather than silent. Output goes to `reproduction/out/`. `reproduce.sh --list`
names the steps and `reproduce.sh <name>` runs one.

For the code, data file and cluster job behind each figure and table, see
[`reproduction/PROVENANCE.md`](reproduction/PROVENANCE.md).

## What reproduces, and from what

| artifact | generator | data | verified |
|---|---|---|---|
| Figure 4, environment efficiency | `reproduction/figures/tools/plot_env_efficiency_bestonly.py` | `figures/results/env_throughput/` (panels B/C/D); panel A is constants in the script | 12.62x ALE exact; 2.18x ProcGen against the paper's 2.19x; panel B's lower rungs disagree with the prose, see PROVENANCE.md |
| Learning-curve composite | `reproduction/figures/tools/plot_main_composite.py` | release asset (**not yet on the public repo**, see PROVENANCE.md) | 24 / 4 / 8 panels, 3+3 seeds all eight games; panel B's variant names differ from the paper's |
| Per-game suite grids | `reproduction/figures/tools/plot_suite_grid.py`, `plot_suite_grid3.py` | `figures/results/suite_tb`, curve JSONs | runs |
| Environment cost | `reproduction/figures/tools/plot_env_cost.py` | release asset | both panels match |
| Human wall-clock | `figures/human/plot_wallclock5.py` | `data/study/`, `figures/human/rerun_curves_icnn.json` | 20 participants, 8 games; crossing steps match the paper, but two prose claims and the gender count do not (PROVENANCE.md) |
| Architecture schematic | `figures/fig_schematic.py` | none | redraws, in the script |
| Table 1(a), training throughput | `figures/tables/t1a_agg.py` | `figures/tables/data/` | five of six rows; the IMPALA-CNN row reads 0.34M against the paper's 0.35M because six of its games sit on a node every re-run excluded (`t1a_nodes.py`) |
| Table 1(b), environment swap | `figures/tables/tab1b.py` | `figures/tables/verdicts/` | all four numbers exact |
| Table 7, double buffering | `figures/tables/dbuf_tex2.py` | `figures/tables/data/` | byte-identical; the caption's "two slowest environments" example is wrong (PROVENANCE.md) |
| Thread-scaling table | shares Figure 4 panel A's constants | see PROVENANCE.md | 2.58x at 80 threads |
| Appendix eval table | `results/eval_iddp_suite.json` | committed | 24 of 24 games |
| Token cost table | `playtrain.gen.count_tokens` | `data/generation-logs/` | 6 of 7 rows exact, total differs by 8 tokens |

The remaining tables are descriptive: engine and backend comparisons, the action space,
the step-return contract, hyperparameters, and the benchmark and EnvPool configurations.
Figure 12 is a screenshot of the tester UI, reproduced by running `just tester`.

## Individual commands

```console
$ cd reproduction/figures

# Figure 4. Panels B/C/D read figures/results/env_throughput/; panel A is
# constants in the script. Its --ab-results / --pg-job / --ale-job flags are
# accepted and ignored -- figures/scaling/ backs no published panel.
$ uv run --no-project --with matplotlib --with numpy --with pillow \
     python reproduction/figures/tools/plot_env_efficiency_bestonly.py --out .

# Table 1(a). The t3fix row is the published one. The adv2 row printed beside it
# is the previous build.
$ cd tables && uv run --no-project python t1a_agg.py \
     impala_nature=44748571+44784183 impala_icnn=44748573 \
     ppo_nature=44748574+44784184 ppo_impala=44748575+44784185
```

The token cost table is the one thing the script does not run. It needs
`GEMINI_API_KEY`, since it re-counts tokens through the API.

`figures/as_run/` holds the sweep scripts and Slurm submissions exactly as they were
submitted to the cluster. They are a record of what produced the committed data, not an
entry point, and the paths inside them refer to the tree as it stood at run time. Read
them, do not run them. The two data directories under `figures/results/` each carry a
manifest naming every committed measurement file, the hardware it was taken on, and the
caveats that came with it.

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
