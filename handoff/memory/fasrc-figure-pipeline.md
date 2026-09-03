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
