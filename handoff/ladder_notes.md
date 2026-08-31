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
- Native host `libqjs_vec.so`: rebuilt 2026-08-09 20:19, but **the rebuild
  is instrumentation-only** (draw counters, per-JS-function profiling,
  shadow call stack; commits 79d55d4..2b9038e). Previous build was Jul 25
  15:08 (qjs_host mtime), source 8e38a6e, and there are no functional
  native commits in between. `native/build/libqjs_vec.so.bak_precounter`
  IS the ablation-era binary, preserved (symbol-verified: arc-era symbols
  present, counter symbols absent). playtrain python layer and the four
  game .js: zero commits since Aug 7.
- **Every software layer is therefore accounted for and functionally
  identical between the two runs.** Remaining suspect by elimination:
  node software on 17402 (kernel/driver/MPS, FASRC upgrade wave between
  Aug 7 and Aug 26). The mechanism still fits the per-game pattern:
  whatever sped up the serial path (a3 +~50%, a4 +~15%) collapsed dbuf to
  ~1.04x, largest residual win on env-heavy miner (1.59 -> 1.28), negative
  on inference-heavy bigfish/plunder. Not PPO-related; both runs were
  train_impala.
- Isolation A/B (queued behind 42250401): A4/A3 pair with the exact old
  binary (.bak_precounter, copied, live .so untouched) vs the new one,
  same node, same day. Expected null (old = new = ~1.04x) -> node upgrade
  confirmed by elimination; if old returns to ~1.35x the host matters
  after all.
- Paper implication: tab:dbuf-ablation and the "large reason we reach ~1M"
  prose describe the pre-Aug-9 env-cost regime. On the current stack dbuf
  buys ~4% geomean on these games. Optional isolation experiment: rebuild
  the host at the Aug-7 state in a worktree, rerun the A3/A4 pair on 17402.

## Isolation experiment: old host vs new host, queued (2026-08-27 ~11:10 EDT)

Setup, all verified rather than assumed:

- Worktree `/n/holylabs/gershman_lab/Users/rtruong/playtrain-wt-8e38a6e`
  at 8e38a6e — reflog-confirmed as the Aug-7-era HEAD (held 2026-07-25
  15:08 -> 2026-08-09 17:48). `src/playtrain` is byte-identical between
  8e38a6e and live a92213a (`git diff` empty), so PYTHONPATH-selecting the
  worktree changes ONLY which libqjs_vec.so loads: `_ROOT` in
  native_vec_env.py is `Path(__file__).parents[3]`, giving
  `<worktree>/native/build/libqjs_vec.so`.
- The worktree's `.so` is a byte-copy of the live tree's
  `libqjs_vec.so.bak_precounter` (md5 927758149d09a808e8d89adb7567ee66 both;
  backup and live `libqjs_vec.so` untouched). Symbol check reconfirmed:
  backup has 0 counter/profiler dynamic symbols, live has 3.
- Belt-and-braces: the host was ALSO rebuilt from 8e38a6e source in the
  worktree (login-node clang; engine/rasterizer/frozenmath staticlibs copied
  from live — git-identical inputs, only qjs_vec_host.cpp+p5.cpp recompiled).
  The rebuild is size-identical to the backup (3,159,768 B) and behaviorally
  bit-exact on a 50-step breakout probe (same obs checksum as the backup
  binary). Kept as `native/build/libqjs_vec.so.rebuilt-8e38a6e` in the
  worktree; the measured job runs the EXACT backup binary, not the rebuild.
- Load verified end-to-end on the cluster venv: printed
  `playtrain.__file__` + `_LIB_PATH` resolve to the worktree, NativeVecEnv
  reset+step OK against the LIVE games dir (games stay identical to run 1 /
  42250401; template's vec_games_dir is unchanged).
- Job: **42253917** (`ladder_oldhost.sbatch`), a4+a3 only, patched
  bench_ladder.py, pinned holygpu8a17402, 2:00 walltime, MPS on,
  `--dependency=afterany:42250401` so it serializes after the new-host run
  on the same post-upgrade node. The sbatch re-asserts provenance at runtime
  (md5 gate on the loaded .so, aborts if wrong) and writes
  `outputs/ladder_oldhost_<jobid>.json`.
- Reading the pair: old-host ratio back at ~1.3-1.35x => host rebuild is the
  story. Still ~1.04x => host exonerated, node upgrade implicated by
  elimination (expected, per the null-check framing). In between: note the
  binary-vs-source caveat does NOT apply to the measured arm (it IS the
  Aug-9 17:42 binary); an in-between result would instead mean the collapse
  is multi-factor.
- Standing hazard, reconfirmed while working: the LIVE playtrain tree has
  uncommitted maze.js/freeway.js edits (both games/js and examples/games/js;
  known fixes, not the ladder games). Left untouched; worktree add did not
  disturb them.

## The pin premise was wrong: the published ablation ran on 15203 (2026-08-27)

`sacct -X -j 37689188 -o JobID,NodeList,Start,End`:

    37689188  holygpu8a15203  2026-08-07T16:28:44  2026-08-07T17:07:26

The published tab:dbuf-ablation came from **holygpu8a15203**, not 17402 —
17402 is where the published *scaling* data came from, and the plan
conflated the two. Run 1 (1.04x, on 17402) therefore compared a different
node against the published 1.35x, with software already proven identical.

Node spec comparison (scontrol, 2026-08-27): 15203 and 17402 are nominally
identical — amd genoa, 96 cores, 4x nvidia_h100_80gb_hbm3, RealMemory
1547208, same ActiveFeatures, same kernel 4.18.0-553.44.1.el8_10 (both
read pre-upgrade while sitting in today's stage4 maintenance window; check
`uname -r` in the job banners afterwards to see if stage4 bumped it). If
node identity explains the collapse it is node-local state (clock/power/
MPS behavior), not spec.

Reproduction job on the original node: **42255259** (`ladder_15203.sbatch`)
— A4/A3, four games, CURRENT stack (live host, no PYTHONPATH override;
runtime banner prints the loaded .so md5 and asserts it is not the
worktree), patched driver, MPS on, pinned holygpu8a15203, 2:00 walltime.
No dependency: different node from the 17402 pair, starts when stage4
lifts (~17:00).

Interpretation grid for the three same-day jobs (42250401 new-host/17402,
42253917 old-host/17402, 42255259 new-host/15203):

- 15203 ~1.35x while 17402 ~1.04x -> dbuf benefit is node-dependent; the
  published number is real but node-specific, and the paper should say so
  (or re-measure on a stated node policy).
- 15203 also ~1.04x -> node identity exonerated too; the change is
  time-based (most plausibly the upgrade wave — both nodes got stage4).
  Pre-upgrade 15203 is then unrecoverable, and the paper needs
  current-stack numbers regardless.
- Old-host 42253917 splits software from node/time on 17402 within the
  same grid.

Flag for the author (do not chase now): Table 1's row-division cross-check
(the tex comment's "1.31x for double buffering" from dividing 0.91M/1.01M-
style rows by the 618k/873k-style rows) is only a software ratio if both
row families came from the same node. Which jobs/nodes produced (a) the
0.91M/1.01M rows and (b) the 618k/873k rows is now an open provenance
question — if they differ, part of that 1.31x may be a node ratio.

## Table-1 gap decomposition: the 12-worker pair, queued (2026-08-27)

Table 1(b)'s PlayTrain A/B arms ran **vec_workers=12, single-buffered**
(configs/pt_throughput/pt_pgab_*_playtrain.json in playtrain-trainers,
verified), while the (a) suite ran 15 workers double-buffered — and the A/B
predates the Aug-7 sweep that found 15w beats 12w by ~20-25% on env-bound
games. The tex comment's "dividing the rows of Table 1 gives 1.31x for
double buffering" therefore conflates (at least) the worker step and the
buffering step.

Driver: tools/bench_ladder.py now has a VEC_ARMS map — a4/a3 (15w) plus
**a4w12/a3w12** (12w, otherwise identical: batch 256, 5 threads, same
worker devices; 12x2x256 = 6,144 envs = the paper's hyperparameter-table
topology). Backup of the pre-edit driver: tools/bench_ladder.py.pre-w12.

Job: **42257880** (`ladder_w12.sbatch`), --arms a4w12,a3w12, four ladder
games, pinned holygpu8a17402, 2:00, MPS, live host (md5-printing provenance
banner), --dependency=afterany:42253917 — the 17402 chain stays serialized:
42250401 (A4/A3 @15w, new host) -> 42253917 (A4/A3 @15w, old host) ->
42257880 (A4/A3 @12w, new host). Output outputs/ladder_w12_<jobid>.json.

Decomposition grid this completes (all same node, same day, per game and
geomean):

    dbuf @15w        = A4 / A3            (from 42250401)
    dbuf @12w        = a4w12 / a3w12      (from 42257880)
    workers @single  = A3 / a3w12
    workers @double  = A4 / a4w12
    Table-1(b)-arm topology = a3w12 (12w single) — the direct analogue of
    the pt_pgab playtrain rows, for reading the (a)/(b) division honestly.

## For a fresh session picking this up

Maintenance lifted ~17:00 EDT 2026-08-27; 42255259 started immediately.
The watching session's monitors do NOT survive it — check state with:
`sacct -j 42250401,42253917,42255259,42257880 -X -o JobID,State,Elapsed,NodeList`

When all four are terminal:
1. Pull the JSONs: outputs/ladder_42250401.json, ladder_oldhost_*.json,
   ladder_15203_*.json, ladder_w12_*.json (all in analogen-jaxbench/outputs).
   On a TIMEOUT the driver still flushes per-row — partial JSONs are valid.
2. Read the two grids above: the three-way node/host verdict (section
   "Isolation experiment") and the worker/buffering decomposition (section
   "Table-1 gap decomposition"). Job banners print uname -r, lscpu MHz, and
   the loaded .so md5 — use them before attributing anything to the node.
3. Then resume PLAN-trainer-bakeoff.md at Phase 2 (Sample Factory, fresh
   venv) unless the verdicts demand more diagnosis first.
4. Paper edits pending on these results: replace tab:dbuf-ablation with the
   ladder table; rewrite Table 1's caption sentence attributing the (a)/(b)
   gap to buffering alone (worker count is a second measured factor);
   retire the 1.31x row-division tex comment; soften the "large reason we
   reach ~1M" dbuf prose to the balance-dependent claim.

## VERDICTS (all four jobs COMPLETED 2026-08-27 evening; read 2026-08-31)

**1. The published 1.35x REPRODUCES on its original node with today's
software.** 42255259 (15203, current stack): A4 742,130 / A3 560,183 =
**1.325x**, per game 1.53/1.17/1.61/1.08 vs published 1.55/1.20/1.59/1.12,
absolutes within 1% of the published 745k/553k. Nothing drifted, nothing
was mismeasured, no upgrade effect. tab:dbuf-ablation is a valid
measurement of 15203.

**2. The dbuf ratio is a NODE property.** Same day, same binaries:
17402 gives 1.038x (42250401), 15203 gives 1.325x. Mechanism: 17402 runs
the single-buffered serial path 1.51x faster than 15203 (A3 844k vs 560k;
A4 only 1.18x apart) — identical nominal specs (Genoa/H100), so it is
node-local state, not model. Where the serial path is fast, dbuf has
nothing to hide (bigfish/plunder go 0.94x); where env-stepping bites, it
still pays (miner 1.24x even on 17402, 1.61x on 15203).

**3. Host binary formally exonerated.** 42253917 (ablation-era
.bak_precounter, 17402): A4/A3 = 1.036x, geomeans within 0.3% of the new
host. Null result as predicted.

**4. Table-1 (a)/(b) gap decomposition on 17402** (42257880): dbuf@12w =
1.157x, workers 12->15 @single = 1.154x, @double = 1.035x. The (b)-arm
topology analogue (a3w12) = 731.5k vs A4 876k -> the gap there is ~equal
parts workers and buffering; on a 15203-like node the buffering term
dominates. Caption fix: attribute the gap to BOTH factors, with magnitudes.

**5. NEW FINDING — the ladder inverts at rung 2.** Full ladder on 17402
(current stack): A1 shared_cpu 91.6k (91 actors) -> A2 central_gpu
**20.4k** (91 actors, its probed best) -> A3 844k -> A4 876k. Central
batched GPU inference is 4.5x SLOWER than per-actor CPU on a 92-core
Genoa node: batch-1 CPU forwards are cheap at ~1k sps/actor while the
single inference thread + 5ms batch timeout caps A2 near 20k. The prose
claim "each architectural step was a win" is MiniGrid-era-true (A2 beat A1
at 20 actors in Phase 0) but false at this scale. app:trainer needs the
honest version: the A1->A2 step paid on small nodes/slow envs and inverts
on many-core nodes with fast envs; A2->A3 is the big win (41x).

Paper actions (unchanged from the pending list, now with numbers): ladder
table states its node; keep the 15203/17402 dbuf pair as the
node-dependence exhibit; Table 1 caption gets the two-factor gap
explanation; retire the 1.31x comment; dbuf prose becomes
balance-dependent. Sample Factory (Phases 2-4) still pending.

## State (as of 2026-08-27 ~17:05 EDT)

- Phase 0: DONE, both arms pass (job 42055481).
- Home-session resubmit 42149485 (9h, same hang) cancelled deliberately.
- Phase 1 run 2: **job 42250401**, all four arms, patched driver, 6:00
  walltime, pinned 17402, PENDING on today's maintenance reservation
  (node is being upgraded — a4/a3 are re-run so every arm lands on the
  SAME post-upgrade node; run-1 a4/a3 double as a pre/post-upgrade probe).
- Isolation A/B: **job 42253917** (old-host a4/a3, worktree-selected
  .bak_precounter binary) queued with afterany:42250401 — runs right after
  the new-host ladder on the same pinned node. Do not cancel either.
- Node arm: **job 42255259** (current stack, a4/a3, pinned holygpu8a15203 —
  the node the published ablation ACTUALLY ran on, per sacct). Pending
  stage4 maintenance, no dependency. Do not cancel.
- Decomposition arm: **job 42257880** (a4w12/a3w12, current stack, 17402,
  afterany:42253917). Do not cancel.
- Then: Phases 2-4 (Sample Factory: fresh venv — .venv-sf is a dangling
  symlink post-OS-upgrade), Phase 5 via mktab_ladder.py (in this directory).
- Cluster artifacts: analogen-jaxbench/tools/bench_ladder_a12.py,
  tools/bench_ladder.py (+.pre-hang-fix backup), ladder_phase0.sbatch,
  ladder_phase1.sbatch, outputs/ladder_phase0/*, outputs/ladder_42060782.json,
  outputs/suite_logs/a{3,4}_*_n0.log.
- NOTE: cluster playtrain-trainers checkout was pulled 7f26997 -> c38d6be on
  2026-08-26 22:59 (home session). Run 2 therefore runs c38d6be; delta from
  7f26997 is stats/encoder-registry only, no vec steady-state change.
