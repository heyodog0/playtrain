---
name: playtrain-benchmark-results
description: "Measured PlayTrain throughput numbers as of 2026-08-02, including which published figures did not reproduce"
metadata: 
  node_type: memory
  type: project
  originSessionId: cd4c6b8b-fd45-4369-b921-2f401fe36bf4
  modified: 2026-08-03T00:51:26.084Z
---

Measured on FASRC, 2026-08-02. Scripts live in
`playtrain-trainers/benchmarks/`, results in `benchmarks/results/`.

- **16-game matched ProcGen A/B: geomean 1.66x, faster on 15/16.** Only miner
  loses (0.81x); bossfight is the max at 4.95x. Geomean SPS 618k vs 372k. This
  replaced the published single-game bigfish 2.3x, which was real but the most
  favourable game in the suite. Jobs 36690635/6 plus reruns 36737224/5.
- **24-game worker scaling: 99-100% parallel efficiency out to 16 workers**, all
  24 games, env-only. Geomean 148k at 1 worker to 2.34M at 16. Backs the
  "near-linear past $10^6$" claim, which was previously unmeasured. Job 36696921,
  figure at `figures/fig_vec_scaling.pdf`.
- **Local single-GPU suite geomean 132k** (24 games, 1 GPU + 23 cores, job 36693963).
  **Remote fleet on one GPU reaches 289k on bigfish** (job 36736932), a 1.66x gain
  over the same game locally (170k). The 24-game fleet run has **not** been
  relaunched since the MPS fix and is the one outstanding measurement.
- **MinAtar's published row is its fastest game.** Breakout 122k, SpaceInvaders
  45k, Freeway 9.6k, so the three-game geomean is ~38k against the 99,646 printed.
  `num_envs` is flat between 1024 and 2048, so the row was mismeasured rather than
  undertuned, and it varies 1.7x across nodes. gymnax ships four MinAtar games, not
  five (no Seaquest), and Asterix never completed a 20M-step run.
- **Environment level, per core:** PlayTrain beats ALE 8/8 (geomean 6.96x) and
  ProcGen 7/16 (geomean 1.13x, arithmetic mean 1.48x, 33.0k vs 22.3k). Raw data
  is committed in `playtrain-paper/results/env_throughput/`.

**Best single-node training config, measured 2026-08-07 (jobs 37661544/45/47):
`b256`, 15 vec workers, 5 env threads, MPS on.** 15 workers beats both 12 and 18
on every environment-bound game; 75 env threads is the peak, 60 starves and 90
oversubscribes a 92-96 core node. Learner-bound games are unmoved (breakout
1.06M at all three worker counts).

| game | 12w | **15w** | 18w | fleet |
|---|---|---|---|---|
| miner | 399,695 | **484,638** | 439,084 | 737,270 |
| coinrun | 553,679 | **668,352** | 570,060 | 785,910 |
| qbert | 576,705 | **694,570** | 570,064 | 773,312 |
| climber | 602,920 | **753,528** | 615,929 | 753,633 |

climber on one node now **equals its fleet number** (753,528 vs 753,633). With
these four, the 24-game single-node geomean is **959,467**, against the 987,415
printed in `tab:train-throughput` — which uses fleet runs for those same four
games under a header saying "one node". An all-single-node table is now within
2.8% and needs no footnote. See [[fasrc-benchmark-hazards]] for the MPS trap
that made every earlier suite sweep read ~590k.

Note the per-core and pipeline pictures differ sharply: 7/16 per core becomes
15/16 end to end. See [[fasrc-benchmark-hazards]] before rerunning any of this.

**ALE arms of the A/B, both finished and verified 2026-08-19.**
- *Training swap*, job **36215614** (2026-07-29, COMPLETED): 8/8 games PASS,
  geomean **872,514 vs 174,763 = 4.99x**, PlayTrain faster on all eight. Range
  2.58x (qbert, its slowest replica at 449k) to 6.37x (freeway). Reproduces the
  873k/175k table rows exactly. Launcher `benchmarks/baselines/as_run/run_ale_ab_matched.sh`.
- *Env-only scaling*, job **39032276** (2026-08-13): the arm that commit e5eed04
  called "ALE arm pending". PlayTrain 243,803 -> 3,855,055 (99% efficiency) vs
  EnvPool 20,232 -> 254,653 (79%), **12.05x at 5 threads growing to 15.14x at 80**.
  The ProcGen counterpart is job **38145651**. Both ran on **holygpu8a17402**, so
  the two panels are directly comparable.

**The A/B arms match observations; the per-core figure does not.** Both training
arms force `obs_shape [3,64,64]`, frame_skip 1, `net: nature`, 12 workers x 5 env
threads, `vec_double_buffer: false`, and the launcher preflight-asserts ALE really
emits 64x64x3 (exit 3 otherwise). EnvPool's Atari default is 84x84 gray stack-4
skip-4, which would have made the EnvPool arm look 4x faster. The one residual
mismatch is `num_actions`: 18 (ALE `full_action_space`) vs 8. `fig:learning` D is
the opposite case, its caption says ALE "emits its native frame", so the 7.0x
per-core ALE number is NOT observation-matched and must not be compared with the
5x swap number.
