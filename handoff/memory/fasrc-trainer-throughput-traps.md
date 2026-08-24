---
name: fasrc-trainer-throughput-traps
description: "Two settings that silently halve PlayTrain trainer throughput on FASRC, one of which may understate three rows of tab:train-throughput"
metadata: 
  node_type: memory
  type: project
  originSessionId: 81477060-ad6e-48bb-8136-d0fdcd1f8994
  modified: 2026-08-06T13:56:46.108Z
---

Found 2026-08-06 while rebuilding the human-play figure, whose x-axis is measured
wall-clock and so exposed both.

**`vec_worker_device` must not name the learner's GPU.** The learner sits on `cuda:0`.
A config with `vec_worker_device=cuda:0,cuda:1` puts a vec worker on that same device
and **halves throughput**: 157k vs 308k sps on breakout, identical config otherwise,
confirmed across four nodes at both 46 and 92 cores. Cores are not the constraint —
92 gave the same 157k as 46. The fast historical runs use `cuda:2,cuda:3` with 4 GPUs.

**Why this matters beyond one figure:** in `tab:train-throughput`'s underlying data,
caveflyer, plunder and flappy_bird all measured *exactly* 85k. Those are the
`impala_3504*` / `impala_3503*` runs, which use the overlapping setting. A flat
identical number across three different games is the same tell as missing MPS — when
unrelated workloads return one figure, something upstream binds. Those three rows are
likely understated ~2x, which would move the 24-game geomean and possibly which game
is "slowest". Not yet audited.

**`torch.compile` and bf16 make PPO slower.** Measured on caveflyer, 4M steps, one node:
baseline 59,162 sps; `max-autotune-no-cudagraphs` 39,094; compile+bf16 45,116. PPO's
bottleneck is synchronous in-process env stepping, not the network, so compiling the
network only adds overhead. `tab:hyperparams` records PPO as fp32/compile-off — that is
correct, not an oversight to fix.

**PPO is ~5x slower than IMPALA architecturally**, not by configuration: 192 envs stepped
synchronously in one process against IMPALA's 12 workers x 5 env threads that never idle
the actors. Any wall-clock comparison between the two is a comparison of architectures.

Pipeline and full notes: `playtrain-trainers/tools/human_study/README.md`.
See [[fasrc-benchmark-hazards]] and [[playtrain-benchmark-results]].
