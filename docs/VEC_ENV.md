# Vec-Env Architecture — Orientation

Short read for collaborators who want to know what's running in production,
what came before, and what the multi-worker-thread investigation
concluded. For the full receipts (5 FASRC SLURM jobs, ~12 probe commits)
see [`MULTI_ENV_RUNTIME.md`](MULTI_ENV_RUNTIME.md).

---

## What's shipped: `NodeVecEnv`

`python/node_gym/vec_env.py`. Subclasses `gymnasium.vector.VectorEnv`
(Gymnasium 1.0 API). One Python process drives N Node workers directly
via stdin/stdout pipes + per-worker mmap regions for obs.

```
Python (main)                          Node worker 0
  NodeVecEnv                           ┌──────────────────┐
    ├── pipe.stdin ─── action ────────►│ step game        │
    ├── pipe.stdout ◄── step header ───│                  │
    └── mmap region 0 ◄── obs write ───│                  │
                                       └──────────────────┘
    ├── (× N workers)
```

**Per step, per env:**
- Python writes a small JSON request (`{"cmd":"step","action":N}`) to that
  worker's stdin
- Worker steps the game, writes a 16-byte binary step header to stdout,
  and writes obs bytes into its mmap region
- Python `select.select()`s across all N stdouts, drains responses, and
  reads obs zero-copy out of mmap into a pre-allocated `(N, H, W, C)` batch

**Result:** one Python process, N parallel Node processes, no pickle
anywhere. ~+14% trainer sps and ~+71% raw env throughput vs the prior
baseline (numbers in the README's bench table).

Autoreset modes: `next_step` (Gymnasium 1.0 default), `same_step`
(SB3-compatible — stashes terminal obs in `info["final_observation"]`),
`disabled` (caller handles resets).

## What it replaced: `SubprocVecEnv` (SB3's pattern)

Before `NodeVecEnv`, the recommended vectorisation was Stable-Baselines3's
`SubprocVecEnv([NodeGymEnv(g) for g in games])`. We keep a hand-rolled
equivalent at `python/node_gym/_subproc_vec_env.py` purely as a benchmark
A/B target — it's not for production use.

```
Python (main)
  ├── SubprocVecEnv
  │     ├── child Python 0 ──pickle/pipe── NodeGymEnv ──mmap── Node worker 0
  │     ├── child Python 1 ──pickle/pipe── NodeGymEnv ──mmap── Node worker 1
  │     └── (× N)
```

**Per step, per env:**
- Main Python sends the action over a `multiprocessing.Pipe` to a child
  Python process (pickle)
- Child Python calls `NodeGymEnv.step()`, which talks to its Node worker
  over stdin/stdout + mmap (this part is the same as today)
- Child Python pickles the obs back to main Python over the pipe

**Two layers of coordination overhead:**
1. N child Python processes (one per env), each with its own pickle
   round-trip per step
2. The N pipes between main Python and the children

`NodeVecEnv` removes (1) and (2) entirely — main Python talks directly
to the Node workers — and keeps the per-worker mmap (which was already
the fast path). The Node workers themselves are unchanged.

## What didn't ship: the Worker Threads design

There was a longer-running effort on the `dev/worker-threads-multi-env`
branch to collapse the N Node workers into **one** Node process with N
Worker Threads sharing a single `SharedArrayBuffer` — one pipe round-trip
per training step instead of N, zero pickle, one V8 heap. On paper, the
biggest possible win.

It didn't ship. The trajectory is worth understanding because the
investigation produced the data that informed `NodeVecEnv`'s shape and
is still load-bearing for any future revival.

### Phase 0 — proposed, then rejected by data

Probes on FASRC at N=16 (job `12886605`) showed each Worker Thread ran
**3.4× slower** than a single-thread baseline. The aggregate peaked at
~4× single-thread instead of the 8–16× linear scaling the design needed
to clearly beat `SubprocVecEnv`. Ruled out as a cause, in order:

- **Not glibc malloc**: a `MALLOC_ARENA_MAX` sweep (job `12888423`) had
  all variants within ~10%; the worst-case `arena=1` was *fastest*.
- **Not memory bandwidth / L3 cache**: a workload sweep (job `12889388`)
  found that a small-pixel variant scaled *worse* than full, opposite
  of what bandwidth-bound code does. Pure-JS Worker Threads at N=16 hit
  64% efficiency — the V8/GC layer scales fine.
- **Not Cairo-specifically**: prior Skia (`@napi-rs/canvas`) experiments
  showed similar contention.

`strace -c -f` decomposed the slowdown at N=16 (job `12891926`) into
**~15% userspace lock contention** (`futex` on libcairo / libpixman /
N-API binding mutexes) and **~85% non-syscall slowdown** — Workers on
CPU but each canvas call running 3× slower. The 85% looked
unfixable from node-gym's side (L3 eviction, TLB pressure, atomic-counter
contention inside pixman's SIMD dispatch).

**Decision at end of Phase 0**: ship `NodeVecEnv` (Architecture B in the
design doc). Keep the separate-process model that already scales linearly,
remove only the Python-side pickle layer. That's what's in production now.

### Phase 0.5 — the diagnosis flipped

After `NodeVecEnv` shipped, the investigation continued with
Skia configuration tuning (job `12895792`) and a striking result: a Skia
`path2d_batch` variant that paints the same pixels but groups 50 separate
`fillRect` calls into 1 `Path2D` + 1 `fill()` (~4 native calls per iter)
scaled to **95% efficiency at N=16**. Same workload, same hardware, same
rasterizer — the only material difference was N-API call count.

That overturned the "hardware-level contention" diagnosis. The 85%
non-syscall slowdown wasn't pixman global state or L3 eviction at all —
it was **per-N-API-call coordination overhead in V8** (cache-line bouncing
on thread-safety scaffolding that runs on every native call).

Follow-up Cairo tuning (job `12899297`) confirmed the principle in the
production rasterizer: `path2d_per_color` (50 rects, ~9 path-batched
fills, multi-color preserved) hit 66% efficiency at N=16. A high-N sweep
(job `12929486`) found the throughput peak at **N=24 with 203k iters/s
aggregate** — 3.8× unbatched Cairo, decisively beating both the current
`SubprocVecEnv` baseline and the projected `NodeVecEnv` ceiling.

### Where it stands

The doc on the dev branch promotes this back to "Architecture C₁" and
sketches a Phase 1 implementation plan:

1. **Deferred-batch shim refactor** in `runtime/p5/p5-shim.mjs` —
   transparently group `rect()` / `ellipse()` / etc. by `fillStyle` and
   emit one `beginPath / path-ops / fill` per color group. Hardest part
   is preserving Z-order across colors without losing the batching win;
   recommended: batch only consecutive same-color runs first.
2. **`validate.py` determinism gate** — all 39 bundled games must still
   pass strict byte-equality across replays after the shim refactor.
3. **Bench batched-shim under current `NodeVecEnv` / `SubprocVecEnv`** —
   the shim is independently useful even before Worker Threads land
   (~30% expected per-env speedup on draw-heavy games).
4. **Worker Threads scaffold** — one Node process, N threads, one
   `SharedArrayBuffer`, `Atomics.wait`/`Atomics.notify` per step.
5. **A/B vs analogen's PPO training loop** — acceptance bar 1.5×
   training sps over current `NodeVecEnv` at N=16+.

**Why this hasn't shipped yet**: Phase 1a is a non-trivial refactor with
a real correctness gate (Z-order preservation across all bundled games).
The shipped `NodeVecEnv` already realised most of the practically
available win; Worker Threads is incremental on top, not a rescue. The
right time to do it is when training throughput becomes a real
bottleneck again, or when the framework throughput number ("203k iters/s
at N=24, 3.8× over unbatched Cairo") becomes load-bearing for the paper.

## Three-line summary

- **`NodeVecEnv`** (shipped): N Node processes, 1 Python process, direct
  pipes, mmap obs. +14% trainer sps over the SB3 baseline.
- **`SubprocVecEnv`** (the predecessor it replaced): N Node processes,
  N+1 Python processes, pickle through pipes — coordination overhead
  was the win.
- **Worker Threads** (investigated, deferred): 1 Node process, N
  threads, 1 SharedArrayBuffer. Initially rejected on Cairo contention
  data; revived by path-batching probes showing the bottleneck was
  N-API call count. Phase 1 plan lives in `MULTI_ENV_RUNTIME.md` §11.
