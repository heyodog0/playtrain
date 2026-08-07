# PPO speed engineering — plan and handoff

Written 2026-08-07. Target: **PPO 73k → ~137k agent-steps/s** on breakout
(1.87×), without giving up the data reuse that makes PPO sample-efficient.

Everything below is measured, not estimated, unless marked otherwise. Profiling
scripts are on FASRC at `analogen-jaxbench/tools/_ppo_*.py`.

---

## 0. RESULTS — read this before §1–§5

The plan in §1–§5 was executed end-to-end on 2026-08-07. **Three of its five
steps did not survive contact with the real trainer.** §1–§5 are kept as written
so the reasoning can be audited, but where they disagree with this section, this
section is what was measured.

Every run below: breakout, 8M steps, one H100, MPS on, whole matrix on ONE node
per job (nodes differ up to 1.56×, so only compare within a job).

**What was wrong**

| plan step | projected | measured | verdict |
|---|---|---|---|
| 1. bf16 (at n_envs=192) | 1.55× on update | **1.00× end-to-end** | no effect |
| 2. `n_minibatches` 8→4 (at 192) | 1.2× on update | **1.03×** | ~no effect |
| 4. double-buffered rollout | 1.58× | **0.78×** | **a regression** |
| 5. `n_envs` 384 needs `n_steps` 64 | horizon halved | **not needed** | premise false |

**Why step 4 fails.** Double buffering splits `n_envs` into two groups, so at
`n_envs=192` each rollout forward is batch 96, not 192. PPO's rollout forward is
launch-bound at these sizes, so halving the batch costs more than the overlap
recovers. Confirmed by the phase profiler, not inferred: enabling it *raises*
the rollout's share of wall clock, 56.5% → 66.3%. The penalty is 0.78× at
`n_envs=192` and 0.78× again at 384 (83,889 vs 107,078) — it is not a tuning
problem. **The IMPALA overlap does not transfer to PPO.**

**Why steps 1–2 looked free and were not.** The microbenchmark timed the update
in isolation. The *share* it reported was roughly right (43% in situ vs 39%
projected) — what was wrong is that bf16 speeds that phase up. At the baseline
config a minibatch is 3,072 samples and the update is launch-bound, where bf16
does nothing. bf16 only pays once the minibatch is large enough to be
compute-bound: **1.03× at `n_envs`=192, but 1.17× at both 384 and 768.** Both
numbers are correct; they are different points on one curve.

**What actually works: `n_envs`.** Throughput tracks the rollout forward batch,
which `n_envs` sets. `n_steps` is nearly irrelevant to it — 384×64 and 384×128
measured 83,889 vs 84,210, a 0.4% difference. So the speedup does NOT require
cutting `n_steps`, and **the GAE horizon can stay at 128.**

| config | precision | sps | vs baseline |
|---|---|---|---|
| 192×128 (paper baseline) | fp32, nmb8 | 69,410 | 1.00× |
| 384×128 | fp32, nmb8 | 93,037 | 1.34× |
| 384×128 | bf16, nmb4 | 108,762 | 1.57× |
| 768×128 | fp32, nmb8 | 110,012 | 1.59× |
| **768×128** | **bf16, nmb4** | **129,184** | **1.86×** |

The 1.87× target is reached, with the GAE horizon intact.

**⚠ But this is not free, and the plan had no way to see it.** Raising `n_envs`
at fixed `n_steps` inflates the batch, and with `n_minibatches` pinned at 4 the
gradient steps per transition collapse:

- baseline 192×128 nmb8 → 24 steps / 24,576 transitions = **1 per 1,024**
- 768×128 nmb4 → 12 steps / 98,304 = **1 per 8,192** (8× less optimization)

Part of that 1.86× is simply doing less work per frame, which costs exactly the
sample efficiency the paper claims for PPO. Job 37683400 re-measures with
`n_minibatches` scaled to the batch (e384/nmb16, e768/nmb32 → 1 per 1,024,
matching baseline); whatever speed survives *there* is the genuinely free part.

**Do not report any of these numbers as a PPO speedup until the matched-
optimization arms land AND learning is checked (§3).** Returns at 8M steps were
comparable across all arms (~90–100), but breakout at 8M is far too early to
settle sample efficiency.

### Node-filled PPO (the actually-useful result)

The comparison the paper implicitly invites — PPO vs IMPALA throughput — was
never matched on hardware: **IMPALA's 938,973 is measured on 4 GPUs** (2 DDP
learners + 2 inference, `pt_b256_*_icnn_ddp2.json`) while every PPO number has
been on 1. So `ddp` was added to `train_ppo_clean.py`: launch under torchrun and
n_envs (still the TOTAL) is split across ranks.

Unlike raising n_envs on one GPU, this is genuinely free — minibatch size,
gradient-steps-per-transition, total gradient steps over a 100M run (97,656
either way) and the GAE horizon are all unchanged. Only the hardware differs.

All arms below at 1 grad step per 1,024 transitions, minibatch 3,072, breakout:

| config | GPUs | envs | sps | vs 1 GPU |
|---|---|---|---|---|
| 192, nmb8 (paper config) | 1 | 192 | 74,959 | 1.00× |
| 192, nmb8 | 4 | 192 | 84,398 | 1.14× |
| 768, nmb32 | 4 | 768 | **181,652** | **2.42×** |
| 768, nmb32, bf16 | 4 | 768 | 170,981 | 2.28× |
| 1536, nmb64 | 4 | 1536 | 199,648 | 2.66× |
| 1536, nmb64, bf16 | 4 | 1536 | 194,421 | 2.59× |

**768 envs is the operating point.** 1536 is already in diminishing returns
(2.42× → 2.66×) while doubling batch staleness again.

**Same total envs (192) across 4 GPUs buys almost nothing (1.14×)** — each rank's
rollout forward is batch 48, deep in the launch-bound regime. The gain needs
more envs, not just more GPUs.

**So at matched hardware IMPALA is ~4.7-5.2x faster than PPO** (938,973 vs
181,652-199,648), not the ~13x a 4-GPU-vs-1-GPU comparison implies. That is the
honest architectural statement: V-trace consumes each frame once, PPO makes 24
gradient passes over it.

### bf16 helps or hurts depending on minibatch size, not on the trainer

| minibatch | bf16 |
|---|---|
| 3,072 (nmb8 @192 / nmb32 @768 / nmb64 @1536) | 1.00×, 0.94×, 0.97× — neutral to negative |
| 12,288 (nmb4 @384) | 1.17× |
| 24,576 (nmb4 @768) | 1.17× |

autocast only pays when the conv/matmul is compute-bound. A Nature CNN at
minibatch 3,072 is launch-bound, so the cast kernels are pure overhead. PPO's
24-small-passes update keeps it in that regime; IMPALA's learner does ONE pass
over 16,384 and lands in the other, which is why bf16 is correct in the paper's
IMPALA column and wrong in a matched PPO one. **Keep PPO fp32.**

### ⚠ native_env_threads: 0 is a trap on multi-GPU allocations

Auto-sizing takes the whole node, so 4 ranks each spawn ~92 threads onto 92
cores. Measured on one node, 192 envs, env-layer only:

| num_threads | env steps/s |
|---|---|
| 23 | **759,938** |
| 0 (auto -> 92) | 113,141 |
| 92 | 29,740 |

A **26x** cliff. It only ever looked safe because a 23-core single-GPU
allocation auto-detects 23, which is near-optimal by coincidence. Under DDP,
12 threads/rank beat 23 (258,434 vs 229,563) — the right value is SMALLER than
cores/ranks. Always set it explicitly.

(Also: `nproc` reports 1 on these nodes because it honors `OMP_NUM_THREADS=1`.
That is not CPU starvation — `sched_getaffinity` shows all 92. Do not diagnose
from `nproc`.)

**Code landed** (`playtrain-trainers`, pushed):
- `843381e` — `double_buffer` config flag + `_PingPongVecAdapter` + interleaved
  rollout. Guarded to the feedforward extrinsic path (raises on LSTM/RND/NovelD
  rather than silently mis-training). **Off by default; keep it off** — retained
  as a recorded negative result, not a recommendation.
- `526052d` — `profile_phases` flag: per-log-line rollout/update/other split.
  Costs a cuda sync per phase boundary; diagnostic only.
- `ad067b0` — `ddp` flag: multi-GPU PPO under torchrun. n_envs stays the total
  and is split across ranks; advantages are standardized across ranks (per-shard
  would not match single-GPU); gradients are averaged BEFORE grad-norm clipping.
  Explicit all-reduce rather than `DistributedDataParallel`, because the rollout
  calls `model.act()` and the update calls `forward()` — DDP only syncs on its
  own `forward()`. RND/NovelD/reward_norm rejected (unsynced running stats).
  Not bit-identical to 1 GPU: the k-th global minibatch is stratified across
  ranks rather than freely shuffled. Same distribution, different draw.

  Launch: `torchrun --standalone --nproc_per_node=4 -m
  playtrain_trainers.train_ppo_clean --config ...` with `ddp: true` and
  `native_env_threads` set EXPLICITLY (see the trap above).

**Still open:** whether 768 envs costs sample efficiency. n_minibatches=32 keeps
optimization-per-frame identical, but the policy now refreshes once per 98,304
env steps instead of once per 24,576, so envs act under a 4x staler policy
between improvements. Job 37687689 runs 3 games x 3 seeds at 100M in the
768/nmb32 config, writing `pv_p768_{game}_s{seed}`, to compare per env step
against the existing `pv_p_{game}_s{seed}` baselines. **Until that lands, no
speed number here should be quoted as free.**

---

## 1. Where PPO's time goes

Measured on one H100, breakout, `n_envs=192`, `n_steps=128`, Nature encoder,
fp32. Per 24,576-transition cycle (one rollout + one update):

| phase | time | share |
|---|---|---|
| rollout inference (H2D + preprocess + forward) | 0.1024s | 30% |
| rollout env stepping | 0.0384s | 11% |
| **update (3 epochs × 8 minibatches)** | **0.1302s** | **39%** |
| buffers, logging, python overhead | 0.0656s | 19% |
| total | 0.3366s | → **73,012 sps** |

That reconstructs the measured 73,016 to four digits, so the model is trustworthy.

Inside the update (job 37676428):

| | time | share |
|---|---|---|
| forward + backward + optimizer | 0.1339s | **90.5%** |
| gather + preprocess | 0.0071s | 4.8% |
| GAE | 0.0069s | 4.7% |

**There is no cheap win in GAE or buffer handling.** The update is gradient compute.

Inside the rollout, by game (job 37675979) — inference is a *fixed* ~0.48s per
115,200 transitions regardless of game; only env stepping varies:

| game | inference | env step | overlap ceiling |
|---|---|---|---|
| bigfish | 83% | 17% | 1.20× |
| breakout | 73% | 27% | 1.37× |
| miner | 38% | 62% | 1.61× |

Overlap hides the **smaller** phase, so env-heavy games gain most. This is the
opposite of the intuition that env-bound games have less to gain.

---

## 2. The plan, in order

### Step 1 — bf16 autocast on the update  (1.55× on the update, FREE)

| config | update time |
|---|---|
| fp32 | 0.1302s |
| **bf16 autocast** | **0.0841s** |

**This contradicts the existing note in [[fasrc-trainer-throughput-traps]]** that
"torch.compile and bf16 make PPO slower" (caveflyer: 59,162 → 45,116 with
compile+bf16). The suspect is **compile, not bf16**: `train_ppo_clean.py:145`
notes recompilation "the first time a new batch shape is seen (rollout n_envs
vs update)" — two shapes, so it recompiles. bf16 was measured here without
compile and clearly helps.

**Do not re-enable `compile_learner` for PPO.** Enable bf16 only.

Risk: bf16 changes numerics. Verify learning is unchanged before adopting (§3).

### Step 2 — `n_minibatches` 8 → 4  (1.2× on the update, FREE)

| config | update time |
|---|---|
| bf16, `n_mb=8` | 0.0841s |
| **bf16, `n_mb=4`** | **0.0685s** |

Same transitions, same 3 epochs, same data reuse — 12 larger gradient passes
(6,144 each) instead of 24 smaller (3,072). Only the optimization granularity
changes: fewer, bigger steps.

Risk: larger minibatches can change the effective learning rate regime. Verify.

### Step 3 — `channels_last`  (~1%, optional)

0.0685s vs 0.0689s. Below noise. Skip unless it comes free with bf16.

**After steps 1–2: 73,016 → 97,757 sps (1.34×), no algorithmic change.**

### Step 4 — double-buffered rollout  (→ 115,380 sps, 1.58×)

Overlap env stepping with inference by splitting envs into two groups, exactly
as IMPALA's vec path does. **On-policy is preserved** — both groups act under
the same weights within a rollout.

Implementation:

- `train_ppo_clean.py:422` builds `NativeVecEnv`. Swap for `PingPongVecEnv`
  (`playtrain/src/playtrain/runtime/native_vec_env.py`) with
  `group_size = cfg.n_envs // 2`.
- The rollout loop at `train_ppo_clean.py:658` is `model.act()` then
  `venv.step()`, strictly serial. Restructure to:

```python
env.send(0, act0); env.send(1, act1)          # prime both groups
for step in range(cfg.n_steps):
    for g in (0, 1):
        obs, rew, term, trunc = env.wait(g)   # this group's frames are ready
        sl = slice(g * B, (g + 1) * B)        # its half of the buffers
        record(step, sl, obs, rew, term, trunc)
        action = infer(obs)                   # other group is stepping NOW
        env.send(g, action)
```

- Buffers stay `(n_steps, n_envs)`; each env's trajectory remains contiguous in
  time, so GAE is unaffected.
- `wait()` returns **views** into the shared observation buffer — copy anything
  retained past the next `send`.

Reference implementation of the same pattern:
`playtrain-trainers/src/playtrain_trainers/impala/vec_actor.py:593-651`.

### Step 5 — `n_envs` 384, `n_steps` 128 → 64  (→ 136,609 sps, 1.87×)  ⚠ NOT FREE

Rollout inference for 24,576 transitions:

| forward batch | time |
|---|---|
| 192 | 0.0789s |
| **384** | **0.0458s** |
| 768 | 0.0318s |

A batch-192 Nature CNN forward taking 3.75ms on an H100 is launch-bound, not
compute-bound; bigger batches amortize the overhead. **But** holding batch size
at 24,576 while raising `n_envs` means lowering `n_steps`, and `n_steps` sets
the GAE horizon. Halving it to 64 shortens credit assignment — a real
algorithmic change, not an engineering one.

Two ways to take it:
- `n_envs=384, n_steps=64` — batch unchanged, GAE horizon halved. **Must be
  validated on learning, not just speed.**
- `n_envs=384, n_steps=128` — GAE horizon unchanged, batch doubles to 49,152,
  update work doubles. Speed gain mostly cancels.

**This is the step to stop at if the learning check fails.**

---

## 3. Validation — required before any of this goes in the paper

Speed is the easy half. Each change must be shown not to break learning:

1. Run 3 seeds × 3 games (breakout, plunder, flappy_bird — the games PPO wins)
   at 100M steps, current config, as the reference. Some of this already exists
   in `outputs/pv_p_*`.
2. Re-run with steps 1–2 (bf16 + `n_mb=4`). Final returns should be within seed
   noise of the reference.
3. Only if that holds, evaluate step 5 separately — the GAE horizon change is
   the one most likely to cost return.

**Do not report a speed number for a config whose learning has not been checked.**
The paper's PPO curves are in Figure 4C and the human-play figure; changing the
trainer changes both.

---

## 4. What this does and does not fix

| | sps |
|---|---|
| PPO today | 73,016 |
| PPO, steps 1–2 (free) | 97,757 |
| PPO, steps 1–4 | 115,380 |
| PPO, steps 1–5 | 136,609 |
| **PPO update-only ceiling** (bf16, `n_mb=4`, infinitely fast env) | **358,774** |
| IMPALA, uniform 24-game suite geomean | 938,973 |

Even fully engineered, PPO cannot pass ~359k on this config, because 24
forward+backward passes over every rollout is what the algorithm *is*. V-trace
touches each frame once. The gap narrows from ~13× to ~6.6× and stops.

So the paper's claim — PPO is slower architecturally, not by configuration —
**survives**, but needs a qualifier: the current config also leaves ~1.3× of
pure engineering unclaimed. Worth fixing before submission so the comparison is
between two well-tuned trainers.

---

## 5. Scripts and job IDs

On FASRC, `/n/holylabs/gershman_lab/Users/rtruong/analogen-jaxbench`:

| script | what | job |
|---|---|---|
| `tools/_ppo_phase_split.py` | rollout inference vs env stepping, per game | 37675979 |
| `tools/_ppo_update_split.py` | inside the update: fwd/bwd vs GAE vs gather | 37676428 |
| `tools/_ppo_speed_knobs.py` | bf16 × channels_last × n_mb, and rollout batch | 37677019 |
| `scripts/ppo_prof.sh`, `ppo_upd.sh`, `ppo_knob.sh` | their sbatch wrappers | |

All use `.venv/bin/python` directly. **Never `uv run` / `uv sync` against that
tree** — it prunes the hand-installed envpool and PyQt5 out from under
concurrent jobs.

⚠ The projection lines printed by `_ppo_speed_knobs.py` are **wrong** — it was
passed per-115,200-transition times as if per-24,576. The sweep timings it
prints are correct; the "baseline / best knobs / ceiling" summary lines are not.
Recompute from the timings.

---

## 6. Session handoff — other work from 2026-08-07

### The MPS discovery (biggest finding of the day)

`bench_train_suite.sh` never starts an MPS daemon, and that costs **1.9×**:
breakout `b256`/12w measured **586,442 without MPS vs 1,084,599 with**. The
per-game `pt_b256_*` runs behind the paper's numbers *do* start it. So every
previous uniform suite sweep (jobs 34467113/34469309, geomean 583k/600k) was
~1.9× under-powered and is not a real measurement. Recorded in
[[fasrc-benchmark-hazards]] with the snippet to add.

The tell is a **flat result across unlike games**, not a specific value — it
presented as ~150k in an earlier context and ~590k here.

### The uniform 24-game suite now exists (jobs 37667723 / 37667727)

One config — `b256`, 15 vec workers, 5 env threads, MPS on — one node, 4-window
medians, all 24 games:

| | 24-game | 16 ProcGen | 8 ALE |
|---|---|---|---|
| **uniform (new)** | **938,973** | 907,580 | **1,005,056** |
| per-game bests, all single node | 959,467 | 894,512 | 1,036,175 |
| `tab:train-throughput` as printed | 987,415 | 948,283 | 1,070,590 |

16 of 24 games clear 1M. **The printed table uses per-game best configs with
four games (coinrun, climber, miner, qbert) on the remote fleet, under a header
saying "one node".** Swapping in the uniform numbers costs 5% and makes the
caption true. Also: under the uniform config the fastest game is dodgeball
(1.10M) and the slowest is miner (491k) — not freeway and qbert as printed.

Best single-node config was found by sweep (jobs 37661544/45/47): **15 workers
beats 12 and 18**; 75 env threads is the peak, 60 starves, 90 oversubscribes.

### Figures pushed to the paper today

- Figure 4 panel B: base and variant as separate side-by-side plots, solid/dashed
  linestyles, independent y-limits, `env steps (M)` under all eight, legend above.
- Figure 4 panel C: new game set (bigfish, bossfight, chaser, leaper, ninja,
  starpilot, miner, pong), more row spacing, legend above the panel.
- Human figure: x-axis is now **env steps (M)**, linear, ticks 0/50/100.
  ⚠ §4.3's prose still says wall-clock and quotes crossing times in seconds —
  Ryan said he would rewrite it.

### Running / outstanding

- **Job 37673776** — 15 PPO runs (5 games × 3 seeds) for panel C's new games:
  bossfight, chaser, leaper, ninja, starpilot had **no** `pv_p_*` runs. Their
  IMPALA curves came free by relaxing the loader's `total_steps == 100M` filter
  to `>= 100M` (they exist at 110M/150M). Re-render the composite when this
  array finishes so the orange curves appear.
- `tab:train-throughput` swap to uniform numbers — not done, awaiting the call.
- The paper's §4.3 prose rewrite after the steps-axis figure change.

See `docs/PROJECT_STATE.md` for cluster access, repo layout, and the human study.
