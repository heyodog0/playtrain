# PPO speed engineering — plan and handoff

Written 2026-08-07. Target: **PPO 73k → ~137k agent-steps/s** on breakout
(1.87×), without giving up the data reuse that makes PPO sample-efficient.

Everything below is measured, not estimated, unless marked otherwise. Profiling
scripts are on FASRC at `analogen-jaxbench/tools/_ppo_*.py`.

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
