---
name: fasrc-figure-pipeline
description: Paper figures regenerate only on FASRC at a rtruong-owned path; the local playtrain-paper repo has no outputs/ tree
metadata: 
  node_type: memory
  type: project
  originSessionId: 4dc4b283-70be-487c-a981-f272b2041ace
  modified: 2026-08-01T19:31:17.326Z
---

The figure scripts in `~/code/lab/playtrain/playtrain-paper/tools/` cannot run
locally — there is no `outputs/` tree (TB runs, `game_thumbs/`, `variant_strips/`,
checkpoints). The real working tree is on FASRC at

    /n/holylabs/gershman_lab/Users/rtruong/analogen-jaxbench

Note **rtruong**, not `truong`; the home dir `/n/home06/truong` and
`~/node-gym-smoke/*` are dead ends with older job IDs. Found it via
`sacct -j <jobid> --format=WorkDir`, which is the fastest way to relocate it.

**How to apply:** connect with the `fasrc` shell function (defined in
`~/.config/fasrc-passwordless/shell/fasrc.sh`, sourced from `.zshrc`); `scp` also
works over its ControlMaster. Run scripts with `$W/.venv/bin/python`
(matplotlib 3.10.9, tensorboard, torch all present). `plot_main_composite.py`
takes ~40s. `throughput_panels.py` resolves its data as `parents[1]/results/
env_throughput`, so that tree must exist in the working dir — I copied the five
committed data files there. Pull results back with `scp` to the paper dir.

**The trainers tree is a sibling, not inside analogen-jaxbench.** Benchmark jobs
run from

    /n/holylabs/gershman_lab/Users/rtruong/playtrain-trainers

and write their JSON to **`results/` at the repo root**, not `benchmarks/results/`
(the sbatch does `cd $SLURM_SUBMIT_DIR` then `mkdir -p results`). `~/node-gym-smoke/
playtrain-trainers` is the dead end: it has no `logs/` and an empty `results/`, so
a search there reports "never ran" for jobs that did. `sacct -X -j <id> -o WorkDir%100`
is the way to relocate it. Note also that `sacct -u rtruong` fails with "Too wide
of a date range" for any range; query job IDs directly instead.

`benchmarks/plot_vec_scaling_ab.py` is the exception to the can't-run-locally rule:
it reads only `results/ab_*.json`, so pulling those down and running
`uv run --with matplotlib` works. It now takes `--ale-job` plus `--same-node` for
the two-panel version.

**The main composite can now drop its throughput row.** `tools/plot_main_composite.py`
in the cluster clone takes `--no-throughput`, which sets `D_BLOCK = 0`, skips the
`gD` gridspec, and renumbers the panel letters to A/B/C. Regenerate with

    .venv/bin/python tools/plot_main_composite.py --no-throughput out.png

`fig_main_D.png` in the paper is that version as of 2026-08-20 (2040x1200, was
2040x1593). Panel D moved into `fig:env_efficiency`, built locally by
`playtrain-paper/tools/plot_env_efficiency.py`, which imports a vendored copy of
the cluster's `throughput_panels.py` so the strip is drawn by the same code.

Two traps found while doing it. `_c_legend_anchor` offsets the panel-C legend by a
figure FRACTION (0.055), tuned against the 10.62in figure; with the throughput row
gone the figure is 8.0in and the same fraction crowds the plots, so it is now an
absolute `0.62 / H`. And `ax.xaxis.grid(False, color=..., lw=...)` turns gridlines
**on** -- matplotlib forces `visible=True` whenever any style kwarg is passed, so
grid(False) must be called bare.

The cluster clone is behind its own remote, so a commit there lands locally but
`git push` is rejected; do not force it.

