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
| 2 + 2 | 909,827 (0.967x) | **353,888 / 340,781 <- optimum** |
| 3 + 1 | (wrong direction) | **212,585 (0.62x)** |
| 4 + 0 | impossible | impossible |

4 learners leaves nothing for inference, and putting inference on a learner's GPU
is the documented `vec_worker_device` trap (roughly halves IMPALA).

**3+1 measured, job 37723136, node-matched on holygpu8a13503: 340,781 (2+2) vs
212,585 (3+1) — a 37% LOSS.** One inference GPU cannot feed three learners. The
tell is instability: 2+2 holds 340,781 across all four windows, while 3+1 swings
186,774->235,684 on bigfish and 229,372->180,193 on plunder. The bottleneck moves
off the learner onto inference and the ranks fight over a starved feed.

**So 2+2 is a real interior optimum for IMPALA-CNN**, with measurements on both
sides of it (~187k at 1+3 on this node, 340,781 at 2+2, 212,585 at 3+1). The
paper's 348k topology was chosen by measurement, not arbitrarily — worth saying
in Table 1.

For Nature 3+1 is the wrong direction and was not run: 2 learners already cost
3.3% by starving environment-bound games, and a third takes another inference
GPU from exactly those games.

Independent cap: `remote_vec`'s docstring records the fleet's measured aggregate
at **1.09M SPS across 4 probe shards** (~45.5k per remote actor worker), i.e.
barely above the ~1.06M one-learner ceiling. **Fleet shards must scale before
learners do**, or the extra ranks idle.

Genuine 4+ learners needs a multi-node trainer (2 H100 nodes, NCCL across nodes).
That breaks the paper's "on one GPU node" framing — out of scope.

## What the pilots taught us (2026-08-08)

### The core budget inverts the earlier fleet result

The recorded fleet win — 132k local -> 289k fleet, and bigfish 170,391 -> 283,000
— was measured against a **1-GPU** trainer, which `kempner_h100` caps at 23
cores. There the fleet's 72 cores were a 3x increase. At **4 GPUs you already
have 92 local cores**, so the headroom is far smaller:

| | env cores |
|---|---|
| local 4-GPU node | 92 |
| fleet via `test` | <= 112 (QOS `cpu=112` per user, hard) |
| fleet via `shared`, 8 x 24 | 192 |
| fleet via `sapphire`, 2 x 112 | 224 |

**`test` cannot help a 4-GPU trainer** — its QOS cap is barely above the local
allocation. Sizing must come from `shared` or `sapphire`.

### Partition choice: `shared`, not `sapphire`

Both deny `kempner_gershman_lab` but allow `gershman_lab` (which the het group
already uses). The difference is scheduling:

| | sapphire | shared |
|---|---|---|
| nodes / cores | 147 x 112 | 370 x 48 |
| idle | 6 | 0, but 291 in `mix` |
| pending ahead | 235 | 180 |

`shared` is built for partial-node CPU allocations, so many small asks backfill
into the `mix` nodes. A 112-core sapphire request effectively needs a whole free
node and sat on `(Resources)`. Use **8 nodes x 24 cores**, not 2 x 112.

### Pilot 1 (job 37730449): the plumbing works, the config did not

4-GPU trainer + 1 `test` fleet node, proven remote topology unchanged (batch 64,
6 workers x 4 groups). Ran clean, no errors — **the 4-GPU fleet handshake is
validated.** But:

| game | fleet pilot | local 4-GPU |
|---|---|---|
| miner | 246,574 | 491,432 |
| bigfish | 242,478 | 1,064,888 |

**miner ~= bigfish is the tell: that config is LEARNER-bound, not env-bound**, so
extra fleet cores buy nothing. Two other defects: the trainer landed on
holygpu8a13401 (a 2.35GHz node, 1.56x penalty — the script had no exclude list),
and batch 64 is not comparable to the uniform suite's 256.

### The scaled config (`outputs/fleet24_base.json`)

The trainer must be able to CONSUME more than the local cores supply, or the
fleet is pointless:

    batch_size                 64 -> 256    (== GROUP_SIZE, == uniform suite)
    vec_workers                 6 -> 12     (== TRAINER_WORKERS)
    remote_groups_per_worker    4           -> 48 groups x 256 = 12,288 envs
    learner_gpus                1           (Nature optimum, measured)
    vec_worker_device      cuda:1,2,3       (never share the learner's GPU)

Fleet: 8 `shared` nodes x 3 workers x 8 threads = 24 fleet workers (the proven
2-per-trainer-worker ratio), **192 env threads** vs the local node's 75.

Scripts: `benchmarks/fleet24_pilot.sbatch` (2 games) and
`benchmarks/fleet24_sapphire.sbatch` (24 games; name is stale, it is on `shared`
now). **Always pilot before the 3h run** — pilot 1 would have wasted it.

### The decision the pilot makes

- miner rises well above 491,432 while bigfish stays near 1,064,888 -> the fleet
  does what the bimodal analysis predicts; run the full 24 and report the row.
- both flat and equal again -> the trainer is still the wall at 4 GPUs, the
  fleet does not help, and **938,973 is the number**. Drop the fleet row rather
  than chase it.

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
