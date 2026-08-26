# Ladder bake-off — running notes (working file, 2026-08-26)

## Failure / hazard log (running)

- **gpu_test caps cores below 8 per GPU.** `sbatch` rejected `-c 32 --gres=gpu:1`
  ("You must request less that 8 cores per gpu"). Phase 0 resubmitted as
  `-c 28 --gres=gpu:4` (MIG slices), num_actors 20. Job 42055481.
- **All 12 gpu_test nodes are inside maintenance reservation `upgrade_stage3`
  (2026-08-26 08:00-17:00).** Phase 0 pends until 17:00 EDT. `upgrade_stage4`
  takes 6 of the 12 nodes again 2026-08-27 08:00-17:00.
- **`.venv-sf` is broken on the cluster**: built 2026-07-23 against
  `/usr/bin/python3.11` (`home = /usr/bin` in pyvenv.cfg); the login node
  (Rocky 8.10) now has only python3.6/3.12, so `bin/python` is a dangling
  symlink. May still resolve on compute nodes; else rebuild a fresh venv for
  Phase 2 (it is its own venv by design — never touch `analogen-jaxbench/.venv`).
- **Cross-check confounder, identified in advance**: published tab:dbuf-ablation
  (job 37689188) ran 2026-08-07 16:28-17:07, hours BEFORE commit 7119a57
  (23:52 same day) which makes vec workers ALWAYS skip CUDA-graph capture under
  MPS. The published 1.35x was measured with graph capture attempted (and
  intermittently failing) under MPS; today's code never captures under MPS.
  Expected effect: slightly lower absolute vec SPS (~10-15% of inference time),
  ratio shift unknown. If A4/A3 deviates from 1.35x, check this first.
- bench_train_suite.py's `w > 5000` window filter would discard every A1/A2
  window; tools/bench_ladder.py uses per-arm min_sps (10 for a1/a2, 5000 for
  a3/a4) with the same median-of-windows-first-discarded statistic.
- The config-file trainer path with `env_backend="playtrain"` and no env_fn
  uses the superseded Node/canvas fallback (3-4x slower/env). A1/A2 must go
  through tools/bench_ladder_a12.py, which injects the canonical qjs GameEnv.

## Facts locked in

- dbuf-ablation games: breakout, bigfish, miner, plunder; published ratios
  1.55/1.20/1.59/1.12, geomean 1.35x (dbuf 745k vs single 553k).
- All four game .js files last modified 2026-07-19 (commit af1d804), before the
  published ablation — cross-check compares identical environments.
- All arms resolve games to ../playtrain/examples/games/js (vec via template's
  vec_games_dir; a1/a2 via GameEnv's hardcoded asset path).
- Local Mac smoke 2026-08-26 ~15:02: shared_cpu AND central_gpu both run
  10k steps clean on current playtrain-trainers head (c38d6be), qjs GameEnv,
  4 actors, CPU device. Bit-rot risk now limited to cluster/CUDA specifics.
- Phase 1 skeleton: impala_db_ablate.sbatch (b256 / 15 workers / 5 threads /
  MPS / 4 GPUs / vec_worker_device cuda:1,2,3), pinned holygpu8a17402.
- Statistic: median of 60s `sps=` windows, first discarded (each window is the
  monitor's 5s sample logged every 60s).

## Phase 0 verdict (job 42055481, gpu_test holygpu7c26106, A100-40GB, 28 cores)

- Backfilled ahead of the maintenance window; ran 15:18-15:20 EDT, COMPLETED.
- A1 shared_cpu: exit 0, 200,960 steps in ~26 s => ~7.7k sps at 20 actors
  (~385 sps/actor, consistent with the MiniGrid-era ~315/actor figure).
  Returns 50-260, finite losses; CUDA learner fine under fork.
- A2 central_gpu: exit 0, 200,960 steps in ~20 s => ~10k sps at 20 actors.
  InferenceServer on cuda: n_inferences=10241, avg_batch=19.94 of 20 —
  batching across actors works exactly as designed.
- Neither run lasted 60 s, so no sps= windows (expected); rates derived from
  log timestamps. NOT bit-rotted; no repair needed; nothing dropped.
- Topology note: both arms scaled fine at 20 actors on 28 cores; Phase 1
  probes {23,46,91} (A1) and {46,91,182} (A2) on the 92-core node.

## Phase 1 scheduling intel (2026-08-26 ~18:10 EDT)

- All 17xxx nodes mixed; 17402's long jobs (afang 9h23, bingbin) are on
  kempner_requeue => PREEMPTIBLE by a kempner_h100 job. Only real blocker is
  mkwun's 1-GPU kempner_h100 job, ~54 min left at submit time.
- Array tasks are 1 GPU / 23 cores each; QOSMaxGRESPerUser binds around
  ~13-16 GPUs. suite3 + ppo3nat drain within ~1 h, freeing 4-GPU headroom.
- Phase 1 submitted: **job 42060782**, PENDING (Priority), pinned 17402.

## State (as of 2026-08-26 ~18:30 EDT)

- Phase 0: DONE, both arms pass (job 42055481, verdict above). Nothing
  bit-rotted, nothing dropped.
- Phase 1: **job 42060782 submitted**, PENDING (Priority), pinned
  holygpu8a17402, 4 GPUs / 92 cores / 4:30 walltime. Runs A4→A3→A2→A1 on
  breakout/bigfish/miner/plunder, JSON to outputs/ladder_42060782.json.
  Expected start within ~1-3 h of submit (~18:10 EDT).
- Arms in ladder driver: a4, a3 (published template +/- vec_double_buffer),
  a2/a1 with num_actors probe {46,91,182}/{23,46,91} on breakout.
- Next steps: read ladder_42060782.json, cross-check A4/A3 vs published
  1.35x (see confounder above if it deviates), then Phases 2-4 (Sample
  Factory: fresh venv — .venv-sf is a dangling symlink post-OS-upgrade),
  then Phase 5 via mktab_ladder.py (in this directory).
- Cluster artifacts: analogen-jaxbench/tools/bench_ladder_a12.py,
  tools/bench_ladder.py, ladder_phase0.sbatch, ladder_phase1.sbatch,
  outputs/ladder_phase0/*.
