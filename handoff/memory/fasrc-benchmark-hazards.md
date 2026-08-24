---
name: fasrc-benchmark-hazards
description: "Traps that silently corrupt PlayTrain throughput benchmarks on FASRC — shared-venv pruning, node clock variance, the cores-per-GPU cap, hetjob teardown, missing MPS, and multi-learner MPS races"
metadata: 
  node_type: memory
  type: project
  originSessionId: cd4c6b8b-fd45-4369-b921-2f401fe36bf4
  modified: 2026-08-03T00:51:08.303Z
---

Throughput runs on FASRC broke four separate ways in one session. All four are
silent and none produce an obvious error.

**`uv sync` destroys the shared venv.** `analogen-jaxbench/.venv` carries
**envpool and PyQt5 installed by hand**, in no lockfile. Any `uv sync` against
that tree prunes both. `scripts/bench_train_suite.sh` still contains
`uv sync --frozen || uv sync`, and running it deleted envpool out from under two
concurrently-running A/B jobs — their arms died mid-run with
`No module named 'envpool'`, and reruns then failed preflight with
`ImportError: EnvPool Procgen requires the system Qt 5 runtime` because PyQt5 had
gone too. Reinstall both with `uv pip install --python .venv/bin/python envpool
PyQt5`, and set `LD_LIBRARY_PATH` to `.venv/lib/python3.13/site-packages/PyQt5/Qt5/lib`.

**Identical nodes run at different clocks.** `kempner_h100` nodes are all
96-core AMD EPYC 9454 with 4x H100, but `holygpu8a13401` measured 2.35 GHz against
`holygpu8a17201`'s 3.8 GHz, a **1.56x throughput difference on the same config**
(bigfish 626k vs 973k). Slurm allocates lowest Slurm-weight first and the slow
`134xx` nodes are weight ~37-43k against `17xxx`'s ~77-96k, so unpinned jobs
land on the slow end by default. **Pin `--nodelist` to a `17xxx` node** for any
number that goes in the paper. Ratios survive the difference; absolute numbers do not.

**The partition caps cores per GPU.** `sbatch` rejects more than 23 cores per
GPU, so `-c 92` needs `--gres=gpu:4`. A single-GPU run is therefore also a
quarter-CPU run, and CPU is what binds PlayTrain. This is why the local 1-GPU
suite lands at 132k while the fleet reaches 289k on the same one GPU.

**`bench_train_suite.sh` never starts MPS, and that costs 1.9x.** Confirmed
2026-08-07 on breakout, `b256`/12 workers, same node type: **586,442 without
MPS vs 1,084,599 with** (job 37661544). The published per-game `pt_b256_*` runs
DO start it (`logs/34652508.out`: "MPS daemon started"); `bench_train_suite.sh`
and anything derived from it do not. So the only committed uniform 24-game
suite runs (jobs 34467113/34469309, geomean 583k/600k) are ~1.9x under-powered
for this reason alone — they are not a real measurement of the suite.

The tell is unchanged but the magnitude is not: in this configuration missing
MPS presents as **every game returning ~590k**, not the ~150k seen earlier.
What identifies it is the flatness across unlike workloads, not the value.
Add to any new bench script:

    export CUDA_MPS_PIPE_DIRECTORY="${TMPDIR:-/tmp}/mps_pipe_${SLURM_JOB_ID}"
    export CUDA_MPS_LOG_DIRECTORY="${TMPDIR:-/tmp}/mps_log_${SLURM_JOB_ID}"
    mkdir -p "$CUDA_MPS_PIPE_DIRECTORY" "$CUDA_MPS_LOG_DIRECTORY"
    nvidia-cuda-mps-control -d && echo "MPS up" || echo "WARN: no MPS"
    trap 'echo quit | nvidia-cuda-mps-control 2>/dev/null || true' EXIT

**Two hetjob gotchas.** Wrapping `srun` in `timeout` tears down the *whole*
hetjob, not the step — use `srun --time` instead. And an MPS daemon started in
its own `srun` step dies with that step, so it must start inside each game's
trainer step. Missing MPS cost 1.9x and showed up as every game returning an
identical ~150k, which is the tell: a flat result across different workloads
means the GPU is binding, not the environments.

See [[fasrc-figure-pipeline]] for the working tree layout and [[playtrain-benchmark-results]].

**Multi-learner configs are flaky under MPS (2026-08-07).** The paper's 348k row
uses `impala_fullnode_throughput.json` (`learner_gpus: 2`), and ~30% of launches
died with `cudaErrorDevicesUnavailable`. Two distinct causes:

1. *Learner side.* `nvidia-cuda-mps-control -d` starts only the CONTROL daemon;
   each GPU's MPS server spawns on first client connect. ~15 processes launch at
   once, so ranks race to be first client and the loser fails on its first CUDA
   call. Fixed by `scripts/mps_warm.sh` (`mps_up`: start MPS, then touch every
   GPU SERIALLY before the workload) plus `_acquire_device()` retry in
   `ddp_learner.py` (`4a2ddd9`). Took failures from 5/16 to 1/5.
2. *Worker side, still open.* `vec_infer_graphs: true` capture fails under MPS
   contention — first `cudaErrorDevicesUnavailable` (falls back to eager, fine),
   then `cudaErrorStreamCaptureInvalidated`, after which the run emits no stats
   and exits clean with `stats: {}`. miner hit this twice. Fix would be retrying
   capture or disabling graphs when `learner_gpus > 1`; not done.

The 1-learner headline config never failed across 24 games. Anyone reproducing
348k should expect retries.

`bench_train_suite.py` recorded a dead game as `sps: 0` with empty windows and
carried on — the geomean correctly excluded it, but only a `22/24` count hinted
anything was wrong. It now sets `failed: True` on the row, records
`games_failed`, and prints a banner.
