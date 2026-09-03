---
name: playtrain-benchmark-results
description: "Measured PlayTrain throughput numbers as of 2026-08-02, including which published figures did not reproduce"
metadata: 
  node_type: memory
  type: project
  originSessionId: cd4c6b8b-fd45-4369-b921-2f401fe36bf4
  modified: 2026-09-01T11:57:16.006Z
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

Note the per-core and pipeline pictures differ sharply: 7/16 per core becomes
15/16 end to end. See [[fasrc-benchmark-hazards]] before rerunning any of this.

**Superseded in part, 2026-08-31 (see HANDOFF-2026-08-31.md):** the published
EnvPool Fig-4A arm (445k ProcGen, one sync pool, 2,048 envs through one Python
process) was partly a driver artifact. EnvPool at PlayTrain's topology (16
pools × 128 envs × 5 threads, still sync) hits 1.8-2.0M on the same nodes;
EnvPool's documented-best async+NUMA is 1.354M on 17402. PlayTrain anchor
1.798M ProcGen / 3.964M ALE on 17402; PlayTrain+NUMA is a null (~1.01x).
Honest ratios pre-rv2: ~1.33x ProcGen / ~11x ALE vs tuned EnvPool. Gate job
**43246914** (EnvPool sync16 on 17402) decides the final framing — no Fig
4A/line 540-541/Table 7-8 edits until it lands. rv2 (branch native-tuning,
1.29-1.32x, bit-exact) adoption is an open user decision. Two determinism
holes found on main: qbert terminal frame, aim_trainer reset frame.

**Round 3 closed 2026-08-31 night (handoff/tuning_notes.md, ROUND 3 FINAL):**
all three authorized levers dead — BOLT 0.997x vs rv2 (nothing after
self-consistent PGO+LTO), p5 command buffer 0.274x JS-side / 0.977x C-side
(QuickJS binding crossings are cheap; JS-bytecode recording costs 2-4.4x the
call it replaces), span SIMD moot (already auto-vectorized; alpha-blend path
unreachable in the catalog). All failed safe (bit-exact, gates clean). rv2
remains the final recommendation; profile says 55-70% interpreter, so the
only remaining levers are ellipse/path caching (safe tier) and the engine
tier (V8 vec host / AOT twins), both unauthorized so far.

**Round 4 (closed 2026-09-01): the last push BANKED a winner — dv.**
Property inline caches died by mechanism (an IC hit can't beat quickjs's
1-2 probe walk; two correct designs, 99.99% hit rates, still 0.945 —
archived at native/archive/prop-ic/). But the last hurrah found the
never-measured lever: miner has 85% IDENTICAL frames under random play,
and the dirty-rect whole-frame-skip machinery had been built and gated
since before round 1 but never enabled. **dv** = rv2 recipe + hygiene
rasterizer (ellipse-offset cache + flat edge prepass) + ADAPTIVE dirty-skip
(20-frame probe inside the bench warmup, 75% skip-rate threshold, per-env
permanent off; cross-reset hash invalidation added for correctness):
**1.327x ProcGen16 / 1.344x all-24 over live** (dv/rv2 = 1.028/1.022; t12
job 43538942), miner +22.8%, bigfish +7.8%, maze -4% known blemish;
bit-exact, and the 24-game differential gate ran with dirty FORCED ON.
Recommendation in tuning_notes.md is now dv (rv2 = fallback); adoption +
build policy + whether frame-skip memoization is inside the paper's
measurement claims are Ryan's three calls.
