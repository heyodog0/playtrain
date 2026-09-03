---
name: fasrc-benchmark-hazards
description: "Four traps that silently corrupt PlayTrain throughput benchmarks on FASRC — shared-venv pruning, node clock variance, the cores-per-GPU cap, and hetjob teardown"
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

**Two hetjob gotchas.** Wrapping `srun` in `timeout` tears down the *whole*
hetjob, not the step — use `srun --time` instead. And an MPS daemon started in
its own `srun` step dies with that step, so it must start inside each game's
trainer step. Missing MPS cost 1.9x and showed up as every game returning an
identical ~150k, which is the tell: a flat result across different workloads
means the GPU is binding, not the environments.

See [[fasrc-figure-pipeline]] for the working tree layout and [[playtrain-benchmark-results]].
