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

## Phase 1 run 1: TIMEOUT that was a hang (job 42060782, 2026-08-26)

- Ran 18:01-22:31 on 17402, killed at 4:30 walltime. **A4 and A3 completed
  all four games** (partial JSON: outputs/ladder_42060782.json). Then the
  a2 probes ran 46 and 91, and the driver hung 3h45m: `bench_one` reads
  `for line in proc.stdout`, forked a2 actors inherit the pipe, and when the
  trainer didn't fully exit after SIGINT the readline blocked forever.
- Fixed in tools/bench_ladder.py (backup: bench_ladder.py.pre-hang-fix):
  start_new_session + daemon reader thread + hard wall-clock deadline even
  with zero output + SIGINT -> 120s grace -> SIGKILL the process group.

## Cross-check verdict: 1.35x does NOT reproduce — and why (2026-08-27)

Run-1 A4/A3: breakout 1.05, bigfish 0.93, miner 1.28, plunder 0.95 —
**geomean ~1.04x** vs published 1.35x. Forensics, each step verified:

- Trainer code: NOT the cause. Cluster trainer = editable install from
  ~/playtrain-trainers (reflog: ablation ran at ad067b0; ladder ran at
  7f26997; delta is startup/tooling only). The CUDA-graph lead (7119a57) is
  dead: capture ALWAYS failed under MPS, so the published run was eager too.
- Config: identical (diffed tpl_dbon_37689188.json vs the as-run
  ladder config; only new-dataclass-fields differ, all inert here).
- Game .js, torch, venv: unchanged since before the ablation.
- **Cause: ../playtrain's native vec host `libqjs_vec.so` was rebuilt
  2026-08-09 20:19** during the profiling/renderGame session (commits
  79d55d4..a92213a). The ablation ran the pre-Aug-9 host, the ladder the
  post-Aug-9 one. Faster env stepping shrinks the serial fraction dbuf
  overlaps: the win collapsed to ~1.04x, stays largest on env-heavy miner
  (1.59 -> 1.28), goes negative on inference-heavy bigfish/plunder (halving
  the inference batch now costs more than overlap saves). Not PPO-related;
  both runs were train_impala.
- Paper implication: tab:dbuf-ablation and the "large reason we reach ~1M"
  prose describe the pre-Aug-9 env-cost regime. On the current stack dbuf
  buys ~4% geomean on these games. Optional isolation experiment: rebuild
  the host at the Aug-7 state in a worktree, rerun the A3/A4 pair on 17402.

## State (as of 2026-08-27 ~10:45 EDT)

- Phase 0: DONE, both arms pass (job 42055481).
- Home-session resubmit 42149485 (9h, same hang) cancelled deliberately.
- Phase 1 run 2: **job 42250401**, all four arms, patched driver, 6:00
  walltime, pinned 17402, PENDING on today's maintenance reservation
  (node is being upgraded — a4/a3 are re-run so every arm lands on the
  SAME post-upgrade node; run-1 a4/a3 double as a pre/post-upgrade probe).
- Then: Phases 2-4 (Sample Factory: fresh venv — .venv-sf is a dangling
  symlink post-OS-upgrade), Phase 5 via mktab_ladder.py (in this directory).
- Cluster artifacts: analogen-jaxbench/tools/bench_ladder_a12.py,
  tools/bench_ladder.py (+.pre-hang-fix backup), ladder_phase0.sbatch,
  ladder_phase1.sbatch, outputs/ladder_phase0/*, outputs/ladder_42060782.json,
  outputs/suite_logs/a{3,4}_*_n0.log.
- NOTE: cluster playtrain-trainers checkout was pulled 7f26997 -> c38d6be on
  2026-08-26 22:59 (home session). Run 2 therefore runs c38d6be; delta from
  7f26997 is stats/encoder-registry only, no vec steady-state change.
