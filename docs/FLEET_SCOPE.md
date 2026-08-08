# Fleet scope — getting the suite honestly past 1M

Written 2026-08-07, after the topology 2x2 (see `PPO_SPEED_PLAN.md` §0).

## Why this is now worth doing

The uniform one-node suite is **938,973**. The printed table reads 987,415 only
because four games (coinrun, climber, miner, qbert) were measured on the remote
fleet while the header says "one node". That is the defect. There are two honest
ways out: drop to 938,973, or make the fleet an explicit, labelled row.

Today's 2-learner ablation is what makes the second option principled rather than
convenient. Nature at 2 DDP learners is a **net loss (0.967x)** over 23 matched
games, and the per-game split is sharply bimodal:

| | ratio | games |
|---|---|---|
| gain | 1.02-1.13x | heist, breakout, freeway, bigfish, ninja, starpilot, bossfight, plunder, frostbite, asteroids, space_invaders, pong, seaquest |
| loss | 0.80-0.90x | miner, fruitbot, maze, jumper, climber, caveflyer, qbert, coinrun, dodgeball, leaper |

The split falls almost exactly at the 1-learner ceiling (~1.06M). Games already
pinned there are **learner-bound** and gain from a second learner; everything
below is **environment-bound** and simply pays for the inference GPU and workers
the second learner costs.

So the slow games are slow for a reason we can name, and more env capacity is the
matching fix. The fleet is not a way to inflate the number — it is the correct
response to a measured bottleneck.

## What it buys (arithmetic on the real per-game numbers)

| lift slowest N to the ~1.06M ceiling | geomean | |
|---|---|---|
| 0 (today) | 938,973 | |
| 2 (miner, coinrun) | 988,753 | 1.053x |
| **4 (+ qbert, climber)** | **1,022,515** | **1.089x — clears 1M** |
| 6 | 1,048,086 | 1.116x |
| 8 | 1,059,880 | 1.129x |

**Four games is enough**, and they are the four already fleet-measured. Note the
asymptote: ~1.06M is the ONE-LEARNER ceiling, so no amount of env capacity takes
the geomean past ~1.06M. Going further requires scaling the learner too.

## Existing infrastructure (do not rebuild)

| script | shape | status |
|---|---|---|
| `benchmarks/remote_suite24.sbatch` | 1 billed H100 + 1 `test` fleet node, 24 games | written, hetjob traps handled |
| `benchmarks/hetjob_analogen_remote.sbatch` | 4 GPUs + 2 `sapphire` nodes | written, documented, for analogen |
| `configs/pt_throughput/pt_bigfish_remote_1gpu.json` | `inference_mode: remote_vec` | the config shape |

Saved fleet configs already exist for miner, coinrun, qbert, climber, fruitbot,
bigfish (`outputs/pt_*_remote_*.json`, all `inference_mode: remote_vec`,
`vec_workers: 4`). **Their sps could not be located in the logs**, so treat these
as evidence the plumbing works, not as results to reuse.

Measured fleet gain on record: **bigfish 170,391 local -> 283,000 fleet, 1.66x on
the same single GPU** (`remote_suite24.sbatch` header, job 36695457).

## The three experiments

### A. Honest minimum — 4 env-bound games, 4-GPU trainer + fleet

Re-measure miner, coinrun, qbert, climber under the **uniform** config (b256, 15
workers, MPS) with the fleet supplying environments, trainer on the full 4-GPU
node. Everything else identical to the 938,973 run so the rows compose.

- Output: a second table row, "one node + fleet (4 env-bound games)".
- Cost: 1 hetjob, 4 games x ~6 min + handshake ~= 40 min runtime.
- This is the only one the submission needs.

⚠ `remote_suite24.sbatch` is a **1-GPU** shape. Experiment A needs the 4-GPU
trainer shape (`hetjob_analogen_remote.sbatch`) with PlayTrain games and the
uniform config. That adaptation is the actual work — maybe an hour.

### B. Full 24-game fleet suite

Same as A but all 24 games, so the fleet row is a geomean over the same set
rather than a partial lift.

- Cost: 24 games x ~6 min ~= 2.5-3 h in one hetjob.
- Better for the paper (no mixed-provenance row at all), but A is sufficient if
  time is short.

### C. Fleet + 2 DDP learners  (the upside, not required)

The one route past ~1.06M. On one node the 2-learner config hurt env-bound games
because it took their workers and an inference GPU. If the fleet supplies
environments remotely, that objection disappears: local GPUs go to learners,
env capacity comes from elsewhere.

The `hetjob_analogen_remote.sbatch` header independently reaches the same
ordering — *"the fleet is the fix, and DDP is the step after it"* — and states
the precondition: a second learner rank pays **only once env supply exceeds one
learner's ceiling**.

- Prerequisite: confirm fleet env supply for the slow games exceeds ~1.06M
  agent-steps/s. Size it first; do not assume.
- Cost: 1 hetjob after A/B, plus sizing.
- Risk: unmeasured. Treat as optional upside.

### Why not 4 learners?

Because **the fleet does not supply inference**. `remote_vec.py`: the remote env
actors are torch-free and ship observations over TCP; "the worker does batched
GPU inference for its groups" — on the TRAINER's GPUs. The fleet replaces CPU
env stepping only.

So the 4 local GPUs must still split between learners and inference workers:

| learners + inference | Nature | IMPALA-CNN |
|---|---|---|
| 1 + 3 | **938,973** | 194,001 |
| 2 + 2 | 909,827 (0.967x) | **353,888** (1.82x) |
| 3 + 1 | untested | **untested — the one worth trying** |
| 4 + 0 | impossible | impossible |

4 learners leaves nothing for inference, and putting inference on a learner's GPU
is the documented `vec_worker_device` trap (roughly halves IMPALA). 3+1 is worth
measuring for IMPALA-CNN, where the learner is the sole bottleneck; for Nature it
is the wrong direction, since 2 learners already cost 3.3% by starving
environment-bound games.

Independent cap: `remote_vec`'s docstring records the fleet's measured aggregate
at **1.09M SPS across 4 probe shards** (~45.5k per remote actor worker), i.e.
barely above the ~1.06M one-learner ceiling. **Fleet shards must scale before
learners do**, or the extra ranks idle.

Genuine 4+ learners needs a multi-node trainer (2 H100 nodes, NCCL across nodes).
That breaks the paper's "on one GPU node" framing — out of scope.

## Traps (all previously paid for)

- **`timeout` around `srun` tears down the whole hetjob.** Use `srun --time`.
  Job 36696517 died at 7:03 this way.
- **An MPS daemon started in its own `srun` step dies with that step.** It must
  start inside each game's trainer step. Missing MPS is 1.9x and presents as a
  flat number across unlike games.
- **Never `uv sync`** against `analogen-jaxbench` — prunes hand-installed
  envpool/PyQt5 out from under concurrent jobs.
- **Node clock variance is 1.56x.** Pin `--nodelist` to a `17xxx` node for any
  number that goes in the paper.
- **Partition caps 23 cores/GPU**, which is why a 1-GPU local run is CPU-starved
  by policy — that is the whole reason the fleet exists.
- **MPS start-up race** with 2 DDP learners: ~30% of launches failed with
  `cudaErrorDevicesUnavailable`. Fixed by `scripts/mps_warm.sh` (serial per-GPU
  pre-warm) plus `_acquire_device()` retry in `ddp_learner.py` (`4a2ddd9`).
  Relevant to C, not A/B.
- **Fleet partition choice:** `test` schedules immediately; `sapphire` has queued
  long for this account. Both allow the needed runtime.

## Recommendation

Do **A**. It converts the table's one real defect into a labelled measurement for
about an hour of adaptation and 40 minutes of compute. Do **B** if the schedule
allows, since a full-suite fleet geomean removes the mixed-provenance row
entirely. Treat **C** as post-submission upside — it is the only path past
~1.06M, but it is unmeasured and the paper does not depend on it.
