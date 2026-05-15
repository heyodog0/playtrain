# node-gym multi-env runtime — handoff

**Branch**: `dev/worker-threads-multi-env`
**Full design doc**: `docs/MULTI_ENV_RUNTIME.md` (12 sections, all claims cited)
**Status**: `NodeVecEnv` (Architecture B / DirectVecEnv) productionized,
ready to merge to main. C₁ (Worker Threads) deferred — not needed at
analogen's n_envs=8 setting.

---

## TL;DR

`NodeVecEnv` is implemented, FASRC-validated, and productionized for
merge. Single Python process drives N Node workers via direct
stdin/stdout pipes + mmap obs. Drop-in replacement for
`SubprocVecEnv([NodeGymEnv]*N)` with measured wins:

- **Pure env throughput** (FASRC, job 12972050): +71% on grid_v4 N=8,
  +121% on flappy_bird N=8.
- **Training-loop sps under real torch+cuda** (FASRC, job 12978195):
  **+13.8% on grid_v4 N=8**, +17.8% on flappy_bird N=8 — should lift
  analogen grid_v4 from 1903 → ~2160 sps, putting it above ALE Pong
  (2078) on the chart.

Productionization complete:
- Subclasses `gymnasium.vector.VectorEnv` (Gymnasium 1.0 API)
- All three autoreset modes: `next_step` (default), `same_step` (SB3
  drop-in), `disabled`
- Action validation, dict info shape, length-checked seeds
- Background stderr drainage (workers can't deadlock on stderr writes)
- 18 pytest tests covering API conformance, autoreset modes, determinism

C₁ (Worker Threads) work is preserved in the design doc but not pursued
— at n_envs=8 the gain over DirectVecEnv is negligible, and the
implementation is ~3 weeks vs DirectVecEnv's 1 week.

The original investigation overturned an earlier "library-locks are
fundamental" diagnosis. Real bottleneck for C₁ would be **N-API call
frequency**; batching draws into ~9 native fills/iter preserves
multi-color rendering AND gets 66% scaling efficiency at N=16. That
work is filed for future expansion to higher N.

---

## State of the world

| Thing | Where |
|---|---|
| Branch (this work) | `dev/worker-threads-multi-env` on github.com/heyodog0/node-gym |
| Local worktree | `~/code/lab/node-gym-gen/node-gym-dev/` (sibling of main checkout) |
| Main `node-gym/` | unchanged (still on `main`, analogen depends on it editable) |
| Probe tools | `tools/probe_*.{mjs,sbatch}` — 7 probes, all reproducible |
| Pull-results helper | `tools/pull_probe.sh` |
| Full design + receipts | `docs/MULTI_ENV_RUNTIME.md` |

Everything is pushed. analogen is unaffected — main checkout never moved off `main`.

---

## Your options going forward

### Option A: Ship `torch.compile` first, decide C₁ later

- 30-min change to `analogen/src/analogen/train_ppo_clean.py:149`
  (add `model = torch.compile(model)` after `.to(device)`)
- Probably +20-30% training sps on its own
- Independent of node-gym work; no risk to dev branch
- Tells you whether GPU-side compounds before committing to ~3 weeks of C₁

**Best if**: priority is faster analogen iteration *now*.

### Option B: Phase 1 of C₁ — deferred-batch shim refactor

- Modify `runtime/p5/p5-shim.mjs` to defer `rect()/ellipse()/etc.` calls
  into per-color buckets, flush at draw() end or before non-batchable ops
- Games unchanged (the batching is transparent)
- ~3-4 days of work + 1 day validate.py determinism check
- Phase 1c (just the shim, no Worker Threads) gets ~30% per-env speedup
  under existing SubprocVecEnv — paper-worthy intermediate result
- Phase 1d (add Worker Threads scaffold) gets the +48% training-sps win

**Best if**: ready to commit to the full C₁ architecture.
Full plan in `docs/MULTI_ENV_RUNTIME.md` §11 (1a through 1e, ~3 weeks).

### Option C: Push further on framework throughput

If you want to close the analogen-vs-ALE training gap further
than C₁'s 16% (down to ~2-5%):

- **Lever 2** (render-at-obs-size for clean-ratio games like v4):
  half day, ~6 more percentage points
- **Lever 1** (C₂ native draw-list addon): 1-2 weeks of C++,
  ~10 percentage points but adds native-code maintenance burden
- **Lever 4** (JS software rasterizer, no Cairo at all):
  1-3 weeks, could close to ~1% gap but trades flexibility

ROI tails off sharply past C₁. See §10.12 of design doc for the table.

**Best if**: TMLR reviewer-proof framework numbers matter more than
shipping speed.

### Option D: Stop here, write the paper

Investigation is in a stable state. You have:
- 19 commits of reproducible probes
- 9 SLURM job receipts
- A 12-section design doc with every claim cited
- A clear architecture answer with measured evidence
- Two ready-to-implement next phases (B above)

Write the paper as "future work: implementation of Architecture C₁".
The investigation itself is a contribution.

**Best if**: TMLR deadline is near and engineering time is scarce.

---

## My honest recommendation (you asked, so saying it once)

**A in parallel with B.** Test `torch.compile` today (it's 30 min and
either works or doesn't). Start B's Phase 1a (the shim refactor) on
the dev branch this week. Phase 1c gives you a paper-quality
intermediate (the batched shim under current SubprocVecEnv) within
the first week of work — independent of the Worker Threads scaffold,
ship-able to main on its own.

C and D both leave value on the table. C only matters if you really
need ALE parity; D throws away the implementation that turns the
investigation into a useful artifact.

---

## Key receipts (commit + SLURM job)

| Phase | Commit | Job | Finding |
|---|---|---|---|
| Original design | `b33b218` | — | WT architecture proposed |
| Phase 0 (Mac) | `c145ecd` | local | node-canvas thread-safe @ N=2 (91% eff) |
| Phase 0 (FASRC) | `34fbd11` | 12886605 | 3.4× per-thread slowdown @ N=16 |
| Allocator sweep | `69d053e` | 12888423 | malloc not the cause |
| Workload sweep | `71f9dc4` | 12889388 | contention is canvas-specific |
| perf attempt | `7c1f7ce` | 12891926 | strace: 15% futex / 85% non-syscall |
| Skia multi-env | `3b60a6c` | 12893502 | Skia scales better (46%) but slower baseline |
| Skia tuning ⭐ | `c5d0a01` | 12895792 | **path2d_batch at 95% — N-API frequency is the bottleneck** |
| Skia multi-color | `0dee9bb` | 12897259 | path2d_per_color at 93% — batching survives realistic workloads |
| Cairo tuning ⭐⭐ | `b5c922f` | 12899297 | Cairo + path2d_per_color: 134k iters/s @ N=16 |
| Cairo high-N ⭐⭐⭐ | `89f49c6` | 12929486 | **Peak 203k iters/s @ N=24** — C₁ architecture confirmed |
| Decision lock-in | `086c788` | — | Architecture C₁ chosen |
| Training-impact framing | `e4405e3` | — | Corrected: C₁ + torch.compile compound to +48% |

---

## Quick how-to-resume

1. **Read the doc**: `docs/MULTI_ENV_RUNTIME.md` (especially §10.4 receipts table and §11 Phase 1 plan)
2. **Re-run any probe to verify**:
   ```bash
   cd ~/code/lab/node-gym-gen/node-gym-dev
   sbatch tools/probe_cairo_high_n.sbatch      # the headline probe
   ./tools/pull_probe.sh latest                # pull results back
   ```
3. **Start Phase 1a** (the batched-shim refactor):
   - Edit `runtime/p5/p5-shim.mjs`
   - Add per-color batch buffers
   - Defer `rect()/ellipse()/etc.` calls
   - Flush before text/readback/transform and at end of draw()
   - Run `uv run python tools/validate.py --all` to verify determinism
   - See §11.1 of the design doc for the full spec including the
     draw-order correctness concern

---

## Things NOT to forget

- **Games are 100% unchanged** in C₁. The batching is shim-internal.
- **analogen's `-c 8` SLURM allocation is currently a self-imposed limit**.
  At higher `-c` (16, 24), C₁'s training-sps win is larger.
- **DirectVecEnv was ruled out** in favor of C₁ — see §10.6 math table
  for why. Worker Threads + batched draws is strictly better at N=24.
- **The `path2d_batch` 100% efficiency at N=32 (Skia) was an outlier**
  — it loses multi-color. `path2d_per_color` is the real architecture.
- **The dev branch's `package.json` has `@napi-rs/canvas` as devDependency.**
  That's only for the probe; production C₁ uses bundled `canvas` (Cairo).
