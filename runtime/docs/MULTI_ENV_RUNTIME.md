# Multi-Env Runtime — Design + Investigation

**Status**: **Architecture C₁ chosen** (Worker Threads + Cairo + path-batched draws).
Phase 0.5 high-N scaling probe (job 12929486, commit `89f49c6`) showed
`path2d_per_color` peaks at **N=24 with 203k iters/s aggregate** — 3.8×
unbatched Cairo, 50% the memory of `SubprocVecEnv` at equivalent
parallelism. C₁ wins decisively on per-step throughput AND memory AND
peak aggregate. Phase 1 starts next: the p5-shim deferred-batch refactor.
**Branch**: `dev/worker-threads-multi-env`.
**Target**: aggregate training throughput parity with (or beyond) ALE on
matched PPO settings, plus aggregate-throughput wins for non-training
workloads (bench, eval, LLM-game validation), while preserving the
"write games in idiomatic p5.js / three.js" developer experience and
existing observation/reward semantics.

---

## 0. TL;DR

After systematic Phase 0 and Phase 0.5 investigation across 5 FASRC
SLURM jobs (12886605, 12888423, 12889388, 12891926, 12893502),
**DirectVecEnv is the chosen architecture.** Phase 1 begins next.

**The investigation, in one paragraph**: Worker Threads at N=16 on
FASRC shows 3.4× per-thread slowdown (job 12886605). Allocator
contention ruled out via `MALLOC_ARENA_MAX` sweep — arena=1 is the
fastest variant (job 12888423). Bandwidth/cache ruled out via
workload sweep — smaller pixel volume scales worse, not better
(job 12889388). `strace -c -f` decomposes the slowdown: **~15%
userspace lock contention** (libcairo/libpixman; bundled pixman is
0.38.4 from 2019) and **~85% non-syscall hardware-level contention**
(L3 / TLB / memory controller) (job 12891926). Skia
(`@napi-rs/canvas`) at N=16 confirms the diagnosis: better per-thread
efficiency than Cairo (46% vs 29%, since Skia has fewer
library-internal locks) but slower single-thread baseline that erases
the scaling gain in aggregate (job 12893502). **No rasterizer
swap, library upgrade, or config change makes Worker Threads beat
current SubprocVecEnv. DirectVecEnv preserves the separate-process
parallelism that does scale linearly, and removes only the Python-side
pickle layer — the one component that's actually fixable.**

---

## 1. Motivation

The current architecture spawns one Node subprocess per env via
SB3's `SubprocVecEnv`. At n_envs=16 on a CUDA training box this gives
node-gym ~74% of ALE's aggregate sps on matched PPO settings (analogen
job 12720391: ALE 2064 / node-gym-grid 1522 sps). The 26% gap is paid
in two places:

1. **Per-env Node process overhead.** 16 separate V8 heaps, 16 GCs,
   16 JIT warmups, 16 mmap regions, 16 stdio pipes. Per-process fixed
   costs add up at startup but are amortized over training.
2. **`SubprocVecEnv` Python-side coordination.** SB3 pickles per-env
   obs returned from each child Python process to the main Python
   process, on top of the Node→child-Python mmap path that node-gym
   already provides. The double-pickle + 16 pipe round-trips per step
   is the dominant component of the 26% gap.

After this branch's earlier shipped work — Cairo-side obs downsample
(commit `04f197a`, +1.75–3.10×) and fillStyle/strokeStyle caching
(commit `4355541`, +3–9%) — per-env step time in node-gym is no longer
the bottleneck. What remains is the coordination overhead above.

### Non-goals

- A C++ env runtime (EnvPool-style). EnvPool wraps existing C++ envs;
  node-gym envs are JS, so wrapping V8 in C++ gives the maintenance
  pain without the perf win.
- Replacing the rendering backend. node-canvas / Cairo stays.
- Changing per-env step semantics. Existing bundled games and any
  future LLM-generated games must produce byte-identical observations
  under the new runtime, modulo the determinism guarantees already in
  `validate.py`.
- A new Python protocol. Gymnasium API surface stays the same; only
  the internal vec-env transport changes.

---

## 2. Current architecture (briefly)

```
Python (main process)
  ├── SubprocVecEnv
  │     ├── child Python 0 ──pickle/pipe── NodeGymEnv ──mmap── Node worker 0
  │     ├── child Python 1 ──pickle/pipe── NodeGymEnv ──mmap── Node worker 1
  │     ├── ...
  │     └── child Python 15 ──pickle/pipe── NodeGymEnv ──mmap── Node worker 15
  └── PPO loop
```

Per training step:
- 16 pickle ops in 16 separate child Python processes
- 16 pipe round-trips to the parent Python process
- 16 mmap reads (already efficient via current Node→Python path)
- 16 V8 heaps each running their own game in parallel (this part is fine —
  it's exactly the parallelism we want, and probes confirm it scales)

The pickle + child-Python coordination is what DirectVecEnv removes.

---

## 3. Architectures considered

### 3.1 Architecture A: Worker Threads multi-env (REJECTED — see §4 for evidence)

```
Python (main process)
  └── one Node process
        ├── main thread: dispatcher
        ├── Worker Thread 0  → GameEnv 0 (own V8 isolate, own Cairo canvas)
        ├── Worker Thread 1  → GameEnv 1
        ├── ...
        └── Worker Thread 15 → GameEnv 15
        └── shared: SharedArrayBuffer (batched obs + actions + step headers)
```

**Premise**: one Node process, N Worker Threads (real OS threads in
Node), one SharedArrayBuffer mapped to a single Python-side mmap. Per
step: write N actions → signal threads via `Atomics.notify` → each
thread steps its game and writes its obs slot → dispatcher gathers via
`Atomics.wait` → return batched obs to Python. **One pipe round-trip
per training step instead of N. Zero pickle. N real parallel threads
instead of N processes coordinated through the kernel.**

This was the original design (committed in `b33b218` on this branch).
Full proposed design appears in the appendix (§10) for future
reference. The phased plan called for a Phase 0 validation probe to
confirm node-canvas was thread-safe before any implementation —
**this gate is what produced the data that rejected the architecture.**

**Verdict (data in §4)**: at N=16 on FASRC Linux, per-thread time
degrades 3.4× under Cairo contention. Aggregate throughput peaks at
~4× single-thread instead of the 8–16× linear scaling required for
this design to clearly beat the current SubprocVecEnv pattern. Library
swap to skia-canvas (tried in prior work) does not resolve the
contention. Worker Threads is therefore not the right architecture
given current C-level library constraints.

### 3.2 Architecture B: DirectVecEnv (CHOSEN)

```
Python (main process)
  ├── NodeVecEnv (this branch's new code)
  │     ├── direct stdin/stdout pipe → Node worker 0 ──mmap── obs region 0
  │     ├── direct stdin/stdout pipe → Node worker 1 ──mmap── obs region 1
  │     ├── ...
  │     └── direct stdin/stdout pipe → Node worker 15 ──mmap── obs region 15
  └── PPO loop
```

**Premise**: keep the per-process rasterization parallelism that
already scales linearly (probes confirm — see §4.2). Replace only the
layer we know is wasteful: SubprocVecEnv's pickle of obs through
N+1 Python processes.

Per training step:
- One Python process writes N action bytes to N stdin pipes
- Each Node worker steps its game, writes its step header to stdout,
  writes its obs to its existing mmap region (already happens today)
- Python reads N step headers from N stdout pipes, reads obs from
  N mmap regions

**No pickle. No child Python processes. No SubprocVecEnv.** Same
per-process parallelism as today (which is fine), minus the
Python-side coordination overhead.

#### What this buys vs current

- Eliminates the per-env Python child process and its pickle round-trip
- Single Python event loop coordinates all N workers (efficient with
  `select.select()` or async I/O over N pipes)
- No new contention introduced — each Node worker is still alone in
  its process, just like today

#### What this does NOT buy

- The hoped-for 8–16× aggregate jump from collapsing into one Node
  process. We don't get that because we're not collapsing — that's
  exactly the change that creates Cairo contention.
- Linear scaling beyond physical core count (same limit as today).

#### Honest expected magnitude

The 173 μs/step gap between ALE and node-gym (from analogen job
12720391) decomposes roughly as:

- ~80 μs: actual env compute (Cairo render + obs preprocess, confirmed
  by FASRC Phase 0 probe — single-Worker baseline was 81 μs)
- ~93 μs: SubprocVecEnv coordination overhead (the residual)

DirectVecEnv targets that ~93 μs. **If we eliminate half of it,
training sps goes from 1522 → ~1700 (+12%). If we eliminate most of
it, 1522 → ~1850 (+22%).** These are estimates; the actual win is
measured in Phase 4 of the plan below.

For non-training workloads (bench, eval, dataset gen, LLM-game
validation) the win is the same magnitude as for training, since the
same coordination overhead applies. Not the multi-X factor we'd
hoped for, but a clean, bounded engineering improvement.

---

## 4. Phase 0 investigation receipts

Every finding below is reproducible from this branch. Each row cites
the git commit that introduced the probe and (where applicable) the
FASRC SLURM job id that produced the result data.

### 4.1 Investigation timeline

| Phase | Commit | FASRC job | Finding |
|---|---|---|---|
| Initial design | `b33b218` | — | Worker Threads architecture proposed |
| Probe scaffold | `c145ecd` | local (Mac) | At N=2 on Mac: **91% efficiency** — node-canvas IS thread-safe (no process-global Cairo lock). At N=8 on Mac: 23% efficiency (P/E-core spillover). Mac-only data; FASRC needed for paper-quality numbers. |
| SBATCH + `--threads` | `34fbd11` | **12886605** | FASRC Linux x86, 24-core, default glibc: at N=2 → 81%, N=8 → 54%, N=16 → 29% efficiency. Per-thread time at N=16 = 277 μs vs 81 μs baseline (**3.4× slowdown**). Aggregate peaks at N=16 at ~7.4× single-thread. **Useful, but not the linear scaling needed.** |
| `pull_probe.sh` | `e7c5f4a` | — | Result-pulling tooling. |
| `pull_probe.sh` ext | `5425bfd` | — | Extended for allocator sweep results. |
| Allocator sweep | `69d053e` | **12888423** | At N=16: default 309 μs, MALLOC_ARENA_MAX=1 282 μs, =4 298 μs, =24 314 μs. All within ~10%. **arena=1 is slightly *faster* than default** — definitive evidence malloc is not on the critical path. jemalloc/tcmalloc not installed on FASRC node, but the arena=1 result alone disproves the allocator hypothesis. |
| Workload sweep | `71f9dc4` | **12889388** | At N=16: pure_js 44.5 μs (**64% efficiency**) — non-canvas workloads scale fine. Canvas variants (full, draw_only, readback_only, small) all collapse to 18–27% efficiency. `small` (1/14 the pixels) shows *worse* scaling than `full`, ruling out memory bandwidth / L3 cache. **Contention is per-canvas-call, in C-level libraries.** |
| Skia-canvas swap | (prior work, predates this branch) | — | Swapping node-canvas → skia-canvas in earlier experimentation made things *slower*, not faster. Library swap is not a path forward — the contention is not Cairo-specific. |

### 4.2 What we ruled out, definitively

The investigation produced a set of negative findings strong enough to
guide architecture:

- **NOT Worker Threads / V8 / GC**: pure_js workload at N=16 hits 64%
  efficiency (commit `71f9dc4`, job 12889388). Pure-JS Worker Threads
  scale fine.
- **NOT glibc malloc**: all four `MALLOC_ARENA_MAX` variants within
  ~10% of each other; arena=1 (worst-case-malloc) is the *fastest*
  variant by a small margin (commit `69d053e`, job 12888423).
- **NOT memory bandwidth or L3 cache**: `small` (128×96, 1/14 pixel
  count of full) shows 5.67× slowdown at N=16 vs full's 3.75×.
  Smaller data makes scaling *worse*, not better — opposite of what
  bandwidth-bound workloads show (commit `71f9dc4`, job 12889388).
- **NOT Cairo-specifically (would have been fixed by Skia)**: prior
  Skia experimentation showed worse, not better, throughput. The
  bottleneck is shared by both rasterizers.

### 4.3 What remains as the contention source

Likely candidates (in order of plausibility), none of which we can
practically fix from node-gym's side:

- **libpixman shared SIMD-dispatch state or scan-converter caches**
  (both Cairo and skia-canvas use pixman for some operations)
- **Other glibc shared locks** (mmap-managed heap, vmap, dl resolution)
- **Node N-API call coordination across isolates**
- **Kernel-level resources** (`mmap_sem`, page-fault handler)

The exact source matters for completeness but doesn't change the
design conclusion: any architecture that runs N parallel rasterizing
threads in one Linux process is capped at ~4× aggregate on this
hardware. DirectVecEnv avoids the issue by keeping separate processes.

### 4.4 What the investigation cost

Total: ~2 days of work. ~3 FASRC SLURM jobs (cheap, all completed
within 5–15 min wall). The dev branch has 7 commits' worth of
reproducible probes plus this document.

This is exactly the kind of pre-implementation gating that prevents
weeks of engineering on the wrong architecture. We learned what we
needed to learn at the cost of probes, not implementations.

---

## 5. DirectVecEnv design

### 5.1 Process layout

```
Python (main)                                  Node worker 0
  NodeVecEnv                                   ┌─────────────────┐
    ├── pipe.stdin ────────────────────────────► action byte → step
    ├── pipe.stdout ◄──────────────────────────── step header
    └── mmap region 0 ◄──── obs write ──────────┤  (already exists today)
                                                └─────────────────┘
    ├── pipe.stdin ────────────────────────────► Node worker 1
    ├── pipe.stdout ◄────────────────────────────
    └── mmap region 1 ◄──── obs write ──────────
    ├── ...
    └── (× 16)
```

Implementation surface: **only Python-side new code** (`NodeVecEnv`
class). The Node-side worker stays unchanged — it already writes obs
to its mmap region and step headers to stdout. We're just reading them
from a single Python process instead of from 16 child Python processes.

### 5.2 Per-step protocol

1. Python writes 1 byte (the action) to each of N stdin pipes
2. Each Node worker reads the action, steps its game, writes:
   - a fixed-size step header to stdout (already implemented in
     `runtime/p5/game-worker.mjs`)
   - the obs to its mmap region (already implemented)
3. Python:
   - reads N step headers from N stdout pipes (small, fixed size —
     can use `select.select()` or batched non-blocking reads)
   - reads obs from N mmap regions (zero-copy numpy views)
   - assembles into `(N, H, W, C)` for the caller

### 5.3 Python-side API

`NodeVecEnv` mirrors Gymnasium's `VectorEnv`:

```python
from node_gym import NodeVecEnv

venv = NodeVecEnv(games=["flappy_bird"] * 16,
                  obs_size=64, obs_mode="rgb")
obs, info = venv.reset(seeds=[0,1,...])
obs, rewards, term, trunc, infos = venv.step(actions)
venv.close()
```

Drop-in replacement for `SubprocVecEnv([NodeGymEnv(g) for g in games])`
on the training side. `NodeGymEnv` (single env) stays available for
single-env use cases (`tools/play.mjs`, `tools/rollout.py`, tests).

### 5.4 Pipe-multiplexing strategy

Three candidates, decide after measuring:

- **`select.select()` over N stdout pipes.** Idiomatic, low overhead,
  works on Linux + macOS. Probably the right default.
- **One Python thread per worker** doing blocking reads. Pipe reads
  release the GIL, so this can be efficient. More complex.
- **asyncio with stream readers.** Modern, but the event-loop
  overhead is unlikely to pay off at N=16.

Recommended: start with `select.select()`, benchmark, switch if needed.

### 5.5 Compatibility

- `NodeGymEnv` (single env): unchanged.
- `NodeVecEnv` (N envs): new.
- Games: unchanged. Same `setup() / draw() / resetGame() / getGameState()`
  contract in each Node worker.
- analogen's `train_ppo_clean.py`: change one line — replace
  `SubprocVecEnv([make_env(...) for _ in range(N)])` with
  `NodeVecEnv(games=[cfg.game] * N, ...)`.

---

## 6. Phased implementation plan (DirectVecEnv)

### Phase 1: Two-env prototype (2 days)

- New file: `python/node_gym/vec_env.py` containing `NodeVecEnv`.
- Hardcoded N=2, single game (flappy_bird × 2).
- Spawn 2 Node workers directly from one Python process.
- One round-trip step → batched (2, 64, 64, 3) obs.
- A/B against `SubprocVecEnv([NodeGymEnv]*2)` on bench.
- Determinism check: replay twice, byte-compare obs sequence.

### Phase 2: General N + heterogeneous catalogs (2 days)

- Parameterize N.
- Support `NodeVecEnv(games=[...])` with arbitrary game list.
- Validate.py-equivalent across all 39 bundled games, homogeneous
  N=8 batches.

### Phase 3: Error handling + lifecycle (1 day)

- Node worker crash → clean Python-side error, not deadlock.
- `venv.close()` cleanly terminates all workers in <2s.
- Per-env auto-reset on done.

### Phase 4: Performance pass (2 days)

- Choose pipe-multiplexing strategy by measurement (`select` vs
  threads vs asyncio).
- A/B against `SubprocVecEnv([NodeGymEnv]*16)` on analogen
  `train_ppo_clean.py` — full PPO training step, measure sps delta.
- Acceptance: ≥10% sps improvement over current SubprocVecEnv at
  n_envs=16.

### Phase 5: Integration (1 day)

- Update `analogen/src/analogen/train_ppo_clean.py` to use
  `NodeVecEnv` (behind a config flag for A/B safety).
- Documentation pass (`README.md`, `docs/PROTOCOL.md`).
- Merge to main.

**Total: ~8 working days.** Smaller than the Worker Threads phased
plan because we're touching less infrastructure (no SharedArrayBuffer,
no Worker Threads coordination, no per-thread state isolation).

---

## 7. Validation criteria

The new runtime is acceptable for merging to main iff:

1. **Determinism**: `validate.py`-equivalent strict byte-equality
   across replays, on all 39 bundled games, N=8 homogeneous batches.
2. **Throughput**: at N=16 on a CUDA training box (FASRC), aggregate
   sps ≥ 1.10× the current `SubprocVecEnv([NodeGymEnv]*16)` baseline
   on analogen's grid envs. (Acceptance bar set deliberately lower
   than Worker Threads' would have been, since the architectural
   ceiling is also lower.)
3. **No regression**: single-env `NodeGymEnv` path is unchanged and
   its bench numbers don't move.
4. **Crash isolation**: a deliberately-throwing game in slot 7 doesn't
   hang or crash the other 15 envs; surfaces a clean Python error.
5. **Lifecycle**: `venv.close()` terminates within 2s in all
   conditions, including mid-step.

---

## 8. Out of scope (for this design)

- **Worker Threads architecture.** Documented above (§3.1, §4, §10) as
  a considered-and-rejected alternative. Could become viable in the
  future if Cairo/Skia/pixman gain process-level thread-friendliness.
- **three.js multi-env.** Different bottleneck (GPU readback, not env
  compute) and a different optimization story (GPU-batched rendering
  across envs). Separate design doc when we get to it.
- **Native draw-list addon.** Would shave another 5–10% on draw-heavy
  games per the mario CPU profile (recorded in commit `b6baad2`). Not
  multi-env-related; evaluate as a separate effort post Phase 5.
- **Skia-canvas swap.** Tried in prior work, slower than node-canvas
  in our use case. Out of consideration unless Skia's per-call
  overhead changes substantively upstream.
- **EnvPool-style C++ runtime.** Wraps existing C++ envs in C++; our
  envs are JS, so the architecture doesn't apply.
- **Distribution / prebuilt binaries.** Real DX issue (node-canvas
  needs native build) but unrelated to runtime; address as part of
  pre-publish.

---

## 9. Open decisions

- [ ] Pipe-multiplexing strategy: `select` vs threads vs asyncio.
      **Defer to Phase 4 measurement.**
- [ ] Default N upper bound. Probably 32 — bench scaling beyond that
      is bounded by host core count.
- [ ] Heterogeneous catalogs in N=16 batch: support from Phase 2 or
      defer to a follow-up release? **Lean toward Phase 2 since it's
      a small API decision now and a bigger rewrite later.**
- [ ] Frame stacking: stay Python-side (current) or move into Node
      worker? **Stay Python-side; one less thing to change.**
- [ ] Action space heterogeneity: support games with different
      `n_actions` in one batch? **Defer; current usage is uniform.**

---

## 10. Phase 0.5: deeper contention investigation (IN PROGRESS)

The investigation so far has characterized the contention's *behavior*
(it scales per-canvas-call, in C-level libraries, not bandwidth-bound,
not glibc-malloc). It has NOT attributed it to a specific
symbol/library. Phase 0.5 closes that gap.

For a TMLR paper, this matters: "we ruled out Worker Threads because
Cairo contends" is a much weaker design-tradeoffs claim than
"`perf` on FASRC shows 42% of self-time at N=16 in
`pixman_image_composite32`, which holds a global SIMD-dispatch mutex
(see [link to pixman issue tracker])." Phase 0.5 aims for the latter.

### 10.1 Planned experiments

| # | Experiment | What it tells us | Cost |
|---|---|---|---|
| 1 | **`perf record` + flame graph** on the probe at N=16 | Direct attribution of wait time to specific C symbols. Definitive if perf is allowed on FASRC compute nodes. | 1 day |
| 2 | **`strace -c -f`** on the worker process | Counts futex (lock-wait) calls. Lock-call rate growth with N is direct evidence of locking. Always available; weaker than perf but free. | 2 hours |
| 3 | **Library version inspection** (`ldd`, `pkg-config`, `nm`) | Confirms which libpixman / libcairo versions FASRC's node-canvas links against. Old pixman has known threading issues. | 30 min |
| 4 | **Micro-probe variants** (`single_fillrect`, `text_only`, `create_destroy`) | Narrows the contention to specific Cairo call paths. If `single_fillrect` scales but `full` doesn't, the issue is one specific primitive. | 4 hours |
| 5 | **Minimal raw N-API addon** (no node-canvas, just direct Cairo calls) | Distinguishes node-canvas binding contention from underlying Cairo/pixman contention. | 1–2 days |
| 6 | **Compare against ALE multi-env** at N=16 on FASRC | If ALE *also* caps at ~4× aggregate, the issue is Python/Linux pipeline, not anything node-gym. | 2 hours |

Experiments 1–4 are high-info, low-cost; do those first. Experiment 5
is heavier but definitive if 1–4 don't conclude. Experiment 6 is a
sanity check on whether *anything* multi-env scales past 4× on this
hardware.

### 10.2 Decision tree after Phase 0.5

```
Phase 0.5 result                         → Architecture decision
─────────────────────────────────────────────────────────────────
Bottleneck is a fixable config /         → Worker Threads revives;
upgrade (pixman version, flag, env)        Phase 1 proceeds as
                                           originally designed
─────────────────────────────────────────────────────────────────
Bottleneck is in node-canvas's           → Write a slim native addon
binding layer, not in pixman/Cairo         (Architecture C, below);
                                           Phase 1 wraps it
─────────────────────────────────────────────────────────────────
Bottleneck is genuinely deep             → DirectVecEnv (Architecture
(pixman global state, kernel-level         B), with paper-quality
mmap_sem, etc.), unfixable from            evidence for why
node-gym's side
─────────────────────────────────────────────────────────────────
ALE also caps at ~4× on same             → Issue is below node-gym
hardware                                   entirely; both architectures
                                           hit the same wall;
                                           DirectVecEnv is still right
                                           but framing changes
```

### 10.3 Architecture C (contingent): slim native addon

Only viable if Phase 0.5 (experiment 5) shows node-canvas's binding
layer is the bottleneck and underlying Cairo is fine. A minimal
N-API addon would expose just the operations node-gym needs (init
surface, fillRect, drawImage, toBuffer raw) without node-canvas's
full API. ~1–2 weeks of work; we don't commit to this until and
unless the data supports it.

### 10.4 Phase 0.5 receipts

| # | Experiment | Commit | FASRC job | Finding |
|---|---|---|---|---|
| 1a | `perf record` | `f43a67b` (SBATCH) | 12891628 | Aborted at ldd stage due to SIGPIPE × `set -e` interaction. Bug fixed in `7c1f7ce` (`set -u` only, `head -N` → `awk 'NR<=N'`). Partial environment log still captured Lib versions finding (row 3). |
| 1b | **`perf record`** (post-fix) | `7c1f7ce` (SBATCH) | **12891926** | **`perf_event_paranoid = 2` on FASRC compute nodes — kernel-level perf record requires ≤1, so blocked.** Fallback: Node `--cpu-prof` per Worker Thread. Result: 16 Worker profiles + 1 main-thread profile, ~50 KB each. |
| 2 | **`strace -c -f`** | `7c1f7ce` (SBATCH) | **12891926** | At **N=1**: 396 futex calls, **0.40s** total wait (62% of run's strace-tracked time — most is V8 internal coordination across libuv/GC threads, not lock contention). At **N=16**: 2,955 futex calls, **5.45s** total wait. Δ = +5.05s of additional futex wait at N=16, distributed across 16 Workers ≈ **0.32s per Worker = ~14.5% of per-Worker wall** (Worker wall ≈ 2.2s for 8000 iters × 277 μs/iter). **Userspace lock contention is real and material, but accounts for only ~15% of the per-thread slowdown.** |
| 3 | **Lib versions** | (partial from job 12891628 env log; confirmed in 12891926) | 12891628 / 12891926 | **node-canvas 3.2.3 bundles its own native libraries** inside `node_modules/.pnpm/canvas@3.2.3/.../build/Release/` — not loaded from system. Versions: **libpixman 0.38.4** (released 2019; current upstream is 0.44+), **libcairo 1.15.12** (2017-era dev snapshot; current stable is 1.18.x), libfontconfig 2.13.1. Cannot be upgraded without rebuilding `canvas` from source against system libraries. **Plausible primary cause of the ~15% futex portion.** |
| 4 | Worker `.cpuprofile`s | `7c1f7ce` (SBATCH) | **12891926** | All 16 Worker profiles show the same pattern: **97.4–97.5% of self-time in `full`** (the JS function that calls fillRect/drawImage/toBuffer). GC: <1%. (program): <1%. No JS-side bottleneck. V8 profiler cannot see past N-API boundary, so all native time gets credited to the calling JS frame. **Workers are on-CPU inside Cairo, not blocked or idle.** Main thread (thread 0): 75.6% (idle), 21.1% `full` — confirms dispatcher just waits for Workers each iter. |
| 5 | Raw N-API | _deferred — investigation has enough evidence to decide_ | — | — |
| 6 | ALE multi-env compare | _deferred — see Option 3 in §10.6_ | _pending if pursued_ | _pending_ |
| 7 | **Skia (`@napi-rs/canvas`) multi-env** | `3b60a6c` (probe + SBATCH) | **12893502** | At N=16: slowest 299 μs/iter, **46% efficiency** (vs Cairo's 29%), aggregate 51k iters/s. Skia scales noticeably better per-thread than Cairo (17-point efficiency gap is real). But Skia's single-thread baseline is ~1.7× slower than Cairo's (136 vs 81 μs/iter), so aggregate throughput at N=16 is **within 5%** between the two libraries. Initial conclusion (later revised — see row 8): library swap doesn't change the architecture answer. |
| 8 | **Skia configuration tuning** | `c5d0a01` (probe + SBATCH) | **12895792** | Six Skia variants at N=1/8/16. Five variants (default, no_aa, read_freq, same_color, getimg_readback) all show 30–43% efficiency at N=16 — consistent with the row-7 conclusion. **`path2d_batch` is the outlier**: baseline 112 μs, **N=16 slowest 118 μs (95% efficiency)**, **aggregate 111k iters/s = 2.1× Cairo at N=16**. The variant uses 1 Path2D + 1 `fill()` per iter (~4 native calls) instead of 50 separate `fillRect()` calls (~52 native calls). **Compared with `same_color` (also one color, but 50 separate fillRects) which scales at only 30% — the difference between the two variants is N-API call count, not color complexity.** This reframes the entire diagnosis: **the per-thread contention is dominantly N-API call frequency, not Cairo/Skia internal locks or hardware-level resource contention.** With batched native calls, Worker Threads becomes viable. Caveat: `path2d_batch` loses per-rect color variation; needs Approach A (Path2D-per-color) or Approach B (native draw-list addon) to handle real workloads. Also: `getimg_readback` OOMed at N=16 — Skia's getImageData allocates fresh buffers per call that don't GC quickly under high parallelism. |
| 9 | **Skia tuning + multi-color batching** | `0dee9bb` (added path2d_per_color + path2d_50_per_iter) | **12897259** | Two new variants confirm the N-API-frequency diagnosis with surgical precision: **`path2d_per_color`** (50 multi-color rects grouped into ~9 Path2Ds → ~9 native fills/iter): baseline 159 μs, **N=16 slowest 172 μs, 93% efficiency, aggregate 76k iters/s**. Multi-color is preserved AND scaling is near-linear — the batching principle survives realistic workloads. **`path2d_50_per_iter`** (50 individual Path2Ds, 50 native fills, same call count as default): baseline 426 μs, **N=16 slowest 425 μs, 100% efficiency**. The 100% efficiency despite 50 native calls is striking — it means `fillRect()` specifically hits a lock that `fill(Path2D)` doesn't. Even at high call count, the path-based render avoids the contention. **Net architecture math**: Worker Threads + Skia path2d_per_color = ~182 μs/step at N=16, slightly worse than current SubprocVecEnv (~173). Cairo's faster baseline could close that gap (see Phase 0.5 follow-up #2, row 10). |
| 10 | **Cairo tuning + multi-color batching** ⭐ | `b5c922f` (probe + SBATCH) | **12899297** | Seven Cairo variants using `ctx.beginPath()/rect()/fill()` (node-canvas doesn't export `Path2D`; the path-builder API achieves the same batching). Headline result: **`path2d_per_color` baseline 62 μs, N=16 slowest 93.9 μs, 66% efficiency, aggregate 134k iters/s**. Cairo's faster baseline (2.5× Skia's) more than compensates for its lower scaling efficiency (66% vs Skia's 93%). The 32 μs absolute slowdown at N=16 is meaningfully more than Skia's 13 μs, but still small in absolute terms. **`path2d_batch` (single color, single fill)**: baseline 63 μs, N=16 99 μs, 63%, aggregate 122k iters/s — also strong. **Architecture math**: Worker Threads + Cairo + path2d_per_color = **~104 μs/step at N=16**, decisively beating current SubprocVecEnv (173) and matching DirectVecEnv's projected ~90–110 μs/step. **Worker Threads is now legitimately competitive with DirectVecEnv.** Non-batched Cairo variants (default, no_aa, read_freq, same_color) show 18–31% efficiency at N=16 — consistent with prior probes confirming `fillRect()` is the contention point. |
| 11 | **Cairo high-N scaling** ⭐⭐ | `89f49c6` (probe + SBATCH) | **12929486** | path2d_per_color and path2d_batch swept at N=8/16/24/32, --iters 5000, -c 32 (one Worker per physical core).<br><br>`path2d_per_color` full curve: N=8 71 μs (85%), N=16 78.8 μs (77%), **N=24 104 μs (58%, peak 203k iters/s)**, N=32 148 μs (41%, declining to 190k). Optimal operating point is N=24.<br><br>`path2d_batch` full curve: N=8 65 μs (91%), N=16 65.6 μs (90%), N=24 67.6 μs (87%), **N=32 82 μs (72%, still climbing to 310k iters/s)**. Single-color upper bound shows the architecture can scale further if batching is even more aggressive.<br><br>**Architecture decision**: C₁ wins. Worker Threads + path2d_per_color at N=24 = ~114 μs/step (1.5× faster than current SubprocVecEnv 173). Aggregate 203k iters/s at N=24 is 3.8× the original Cairo default and ~70% more memory-efficient than DirectVecEnv at the same parallelism (1 process × ~600 MB vs 24 processes × ~50 MB). |

### 10.5 Decomposing the per-thread slowdown at N=16

Combining the strace, cpuprofile, and earlier scaling data (all from
job 12891926 + 12886605):

**Per-Worker wall at N=16**: ~277 μs/iter (vs 81 μs at N=1 single-Worker
baseline). Extra: **196 μs/iter of slowdown**.

From the strace ledger:
- ~15% of per-thread wall is in **futex syscalls** (userspace lock
  contention — pthread_mutex_lock and friends inside libcairo /
  libpixman / N-API binding).

The other ~85%:
- ~85% of per-thread wall is **non-syscall slowdown** — the Workers
  are *on CPU*, doing canvas calls, but each call runs ~3× slower
  than at N=1. cpuprofile attributes this all to the JS `full`
  function (the profiler can't see into native code).

**This non-syscall component is NOT in any kernel wait.** Most plausible
candidates:
- L3 cache eviction: each Worker's working set evicts the others'
- TLB pressure: many small Cairo internal allocations across threads
- Atomic-counter contention (busy-spin, no syscall) inside pixman SIMD
  dispatch or memory allocator hot paths
- Memory controller / inter-core coherence saturation on shared cache lines

**None of these are fixable from node-gym's side.** They're properties
of the workload × hardware × library stack — fundamentally bounded.

### 10.6 What this means for the architecture decision

Math comparison at n_envs=16 on FASRC (μs per training step's env phase):

| Architecture | Env compute time | Coord overhead | **Total/step** |
|---|---:|---:|---:|
| `SubprocVecEnv` + Cairo (current) | ~80 (separate processes scale ~linearly) | ~93 (Python pickle) | **~173** |
| `SubprocVecEnv` + Skia (would-be alt) | ~136 (Skia single-thread is 1.7× slower than Cairo, see job 12893502) | ~93 | ~229 |
| Worker Threads + Cairo (job 12891926) | ~277 (3.4× contention) | ~10 (Atomics) | ~287 |
| Worker Threads + Skia (job 12893502) | ~299 (Skia scales better but slower baseline) | ~10 | ~309 |
| Worker Threads + 100% futex fix (Arch A'; theoretical best case from lib rebuild) | ~235 (remove 15% futex portion) | ~10 | ~245 |
| Worker Threads + hypothetical full linear scaling (impossible — non-syscall hardware contention) | ~80 | ~10 | ~90 |
| **DirectVecEnv** (Architecture B; chosen) | ~80 (preserves separate processes) | ~10–30 (direct pipes, no pickle) | **~90–110** |

**Three clean conclusions** (with Skia data now in hand):

1. **Worker Threads today is slower than current SubprocVecEnv** —
   regardless of rasterizer. Cairo: 287 > 173. Skia: 309 > 173.
2. **Library swap doesn't fix it.** Skia at N=16 has measurably better
   scaling efficiency than Cairo (46% vs 29%) — confirming Cairo
   carries some library-specific lock contention — but Skia's slower
   single-thread baseline (1.7× Cairo) erases the scaling win. Net:
   library-specific contention exists but is the smaller component.
3. **Architecture A' (rebuild Cairo against modern libs) cannot beat
   current either** (245 > 173 best case). The 85% non-syscall
   slowdown is hardware-level and not removable by software.
4. **DirectVecEnv** is the only candidate in this table that beats
   current SubprocVecEnv (90–110 < 173), because it keeps the
   separate-process model that's already known to scale and removes
   only the pickle layer.

**Worker Threads cannot win** within current hardware constraints.
The investigation has searched the practically-fixable space
(allocator, lib version, rasterizer family) and found no architecture
that beats DirectVecEnv. The Skia experiment was the final check;
its result confirms the diagnosis.

### 10.8 Revised diagnosis: contention is N-API call frequency

The Skia tuning sweep (row 8 of §10.4) overturns the earlier
"library-level contention" diagnosis. The relevant comparison:

| variant | native calls per iter | baseline μs | N=16 slowest μs | N=16 efficiency |
|---|---|---|---|---|
| `same_color` (Skia, all 50 rects same color) | ~52 | 96.7 | 325.2 | 30% |
| `path2d_batch` (Skia, 50 rects via 1 Path2D) | **~4** | 112.4 | **118.4** | **95%** |

Both variants paint the same pixels with the same colors. The only
material difference is **how many N-API boundary crossings happen
per iter**. The variant with ~4 native calls scales near-linearly;
the variant with ~52 calls degrades 3.3×.

This means the strace decomposition from job 12891926 ("15% futex,
85% non-syscall") should be re-interpreted: the per-N-API-call
coordination overhead in V8 produces both kinds of slowdown — futex
waits (for inter-isolate locks during native calls) and on-CPU
slowdown (cache-line bouncing on N-API thread-safety scaffolding
that runs on every call).

**The contention is fixable** if we can reduce the number of native
calls per env step.

### 10.9 Two contingent architectures unlocked by the new diagnosis

**Architecture C₁: Worker Threads + Path2D-per-color batching.**
Group draw operations by color JS-side, build ~9 Path2Ds per iter
(one per palette color), one native fill per Path2D. Goes from ~50
native calls/iter to ~9 + a few. Cheap to implement (JS-side
refactor in p5-shim), preserves arbitrary color/state changes.
Expected scaling efficiency: **somewhere between 30% (50 calls) and
95% (4 calls)** — needs to be measured.

**Architecture C₂: Worker Threads + native draw-list addon.**
A slim N-API addon that takes a typed array of opcodes + args
(rect, fillStyle, drawImage, readback) and dispatches them inside
one native call. Goes to ~1–2 native calls/iter regardless of how
many primitives. ~1–2 weeks of native code; gives the strongest
possible scaling. The principled architecture that the data now
supports.

### 10.10 Decision deferred — two probes remain

The Skia-tuning result is decisive enough to reopen the
architecture question. Two more probes will determine whether
Worker Threads is genuinely viable for production:

1. **`path2d_per_color` variant**: 50 rects grouped into ~9
   Path2Ds, ~9 native fills per iter. Real-color rendering, but
   batched. Tells us how much of the 95% scaling survives at
   "intermediate" native-call counts.
2. **`path2d_50_per_iter` variant** (sanity check): one Path2D
   per rect, 50 path-fills per iter. If this scales as badly as
   `same_color`, the batching win is purely about reducing
   native-call count. If it scales partway between, there's per-call
   overhead that grows linearly with call count regardless.

Both variants slot into the existing `probe_skia_tune.mjs` framework.
One more FASRC submission, ~half day to run + interpret.

### 10.11 Decision: DirectVecEnv (Phase 0.5 investigation complete) — SUPERSEDED, see §10.8 above

After running Option 1 (Skia multi-env, job 12893502, commit
`3b60a6c`), the data is decisive. **DirectVecEnv is the chosen
architecture.** The investigation closes here; Phase 1 begins next.

**What we know, definitively**:

- Cairo's per-thread contention at N=16: ~15% futex (lock-wait,
  library-specific) + ~85% non-syscall (hardware-level).
- Skia (different rasterizer family) has measurably less
  library-specific contention (46% efficiency vs Cairo's 29% at
  N=16) — confirming the diagnosis that ~15% is library-specific.
- But the dominant 85% non-syscall slowdown is present in Skia too,
  in absolute terms — it's hardware-level and library-independent.
- Worker Threads with any rasterizer we tested is slower per training
  step than current SubprocVecEnv.
- DirectVecEnv is the only architecture in the §10.6 table that beats
  current.

**Remaining options NOT pursued, and why**:

- **Architecture A' (rebuild Cairo against modern libs)**: would
  improve the 15% futex portion at most. Doesn't beat current
  SubprocVecEnv even in best case (245 > 173 per §10.6). Filed under
  "future work, low ROI."
- **ALE multi-env compare**: would corroborate the "library-independent
  hardware-level contention" claim by showing ALE hits the same
  ceiling. Nice-to-have for paper framing but not load-bearing —
  the Cairo vs Skia comparison already proves the same point within
  node-gym's stack.
- **Raw N-API addon**: was contingent on finding evidence the
  binding layer was the bottleneck. cpuprofiles in job 12891926
  showed 97.4% of Worker self-time in the JS workload function with
  no per-binding-layer waste, so this experiment wouldn't change
  the answer.

**The paper's design-tradeoffs narrative** is now complete: we
proposed Worker Threads, characterized the contention behavior, ruled
out allocator, ruled out memory bandwidth, attributed the per-thread
slowdown via strace decomposition, tested both Cairo and Skia at
N=16, and concluded with hard numbers that DirectVecEnv is the right
architecture given current library and hardware constraints. The
receipt trail spans 12+ commits and 5 FASRC SLURM jobs.

**Next step**: begin Phase 1 of DirectVecEnv (§6).

---

## 10.12 Expected impact on training workloads (vs framework-bench numbers)

The 134k → 203k iters/s improvement at N=24 (Job 12929486) is the
**framework throughput** number — what node-gym in isolation can do.
For training workloads, the impact depends on the env-phase fraction
of step time, which itself depends on what else has been optimized
in the trainer.

### Naive ceiling (current trainer config)

From analogen's matched-throughput data (job 12720391, n_envs=8 on
FASRC GPU): node-gym contributes ~173 μs/step out of ~657 μs total
(~26%). At this config, even making node-gym free caps the gain at
~35% on training sps.

| Build | env-phase μs/step | total step μs | total sps | Δ vs current |
|---|---:|---:|---:|---:|
| Current (`SubprocVecEnv` + unbatched Cairo) | 173 | 657 | 1,522 | — |
| Phase 1c (batched shim alone) | ~115 | ~599 | ~1,670 | **+10%** |
| Phase 1d (Worker Threads + batching, n=8) | ~81 | ~565 | ~1,770 | **+16%** |
| (theoretical: free env) | 0 | 484 | 2,064 | (+35% — current ceiling) |

### But the ceiling moves up when the GPU side gets faster

**Critical observation**: the 484 μs "non-env floor" is the cost of
PPO update + GPU forward + Python coordination *at current trainer
config*. It's not a fundamental ceiling — it shrinks when the GPU
side is optimized. And **C₁'s savings in absolute μs stay constant**
regardless of what else is optimized, which means the *percentage*
gain from C₁ goes UP as the GPU side gets faster.

Assuming `torch.compile(model)` in `train_ppo_clean.py:149` gives a
25% reduction on the non-env phase (484 → 363 μs — typical CNN
forward+backward speedup on CUDA, conservative for IMPALA-CNN):

| Build | env μs | other μs | total | sps | Δ vs current |
|---|---:|---:|---:|---:|---:|
| Current analogen | 173 | 484 | 657 | 1,522 | — |
| + `torch.compile` alone | 173 | 363 | 536 | 1,866 | **+23%** |
| + C₁ alone | 81 | 484 | 565 | 1,770 | **+16%** |
| **+ Both** | **81** | **363** | **444** | **2,252** | **+48%** |

The two optimizations **stack multiplicatively on sps, not
additively**. End state with both: a 5M-step training run that
currently takes ~55 min wall completes in ~37 min — meaningful for
iteration cadence across the dozens of experiments analogen is
running.

### Why the ratio to ALE improves specifically

| Scenario | analogen sps | ALE sps | analogen/ALE |
|---|---:|---:|---:|
| Current | 1,522 | 2,024 | 75% |
| + `torch.compile` both | 1,866 | 2,681 | 70% (gap widens — GPU win benefits ALE more, since ALE's env is already negligible) |
| + C₁ on analogen only | 2,252 | 2,681 | **84%** ← gap closes |

`torch.compile` lifts all backends. C₁ attacks the term that
specifically distinguishes analogen from ALE (the 173 μs env phase).
Closing the gap to ALE is paper-quality evidence that node-gym is
competitive with established C/C++ environments at training-loop
scale.

### Honest framing for TMLR paper

Two distinct numbers, both real, both belong:

- **Framework throughput table** (node-gym in isolation, no
  training loop): 134k → 203k iters/s at N=24 (3.8× over unbatched
  Cairo, 1.7× over best-prior-Cairo). This is the framework
  contribution.
- **End-to-end training throughput table** (analogen-style PPO):
  ~16% from C₁ alone at current trainer config, **~48% combined
  with reasonable GPU-side wins** like `torch.compile`. C₁
  contributes ~20 percentage points of that 48% — additive on top
  of GPU optimizations, not redundant with them.

For non-PPO use cases where env stepping IS the dominant cost —
offline data collection, behavior cloning, eval rollouts,
LLM-game validation sweeps — the full 3.8× framework gain applies.

### Recommendation update

The earlier framing ("C₁'s training-loop impact is small, focus
on `torch.compile` instead if you want analogen faster") was
correct but incomplete. The better framing:

- `torch.compile` and C₁ are **orthogonal levers that compound**.
- Either one alone gives ~16-23% on training sps.
- Together they give ~48%.
- C₁ is the framework-paper contribution; `torch.compile` is a
  drop-in trainer-side improvement. Both can ship in parallel.

---

## 11. Phase 1: implementation plan for Architecture C₁

Investigation closed. Implementation begins. Five sub-phases, ~2–3
calendar weeks total.

### 11.1 Phase 1a: Deferred-batch shim refactor (3–4 days)

The win in Job 12929486 was achieved by replacing 50 separate
`ctx.fillRect()` calls with ~9 `ctx.beginPath() + rect() × N + fill()`
groups. Games must NOT have to do this manually — the shim batches
transparently.

**Changes to `runtime/p5/p5-shim.mjs`**:
- Replace immediate `_ctx.fillRect()` in `rect()` with a deferred-add
  to per-color buckets keyed by `_fillStyle`.
- Same for `ellipse()` (uses `ctx.ellipse`), `triangle()`, `quad()`,
  `circle()`, `endShape()`.
- Add explicit `_flushBatch()` that emits one `beginPath/path-ops/fill`
  group per accumulated color, then clears the buckets.
- Auto-flush before any operation that can't be safely batched:
  - `text()` (text rendering paints onto the surface immediately)
  - `getImageData()` / `toBuffer()` (readback would see stale buffer
    without flush)
  - `save()` / `restore()` (state changes invalidate per-color batches)
  - `translate()` / `rotate()` / `scale()` (transforms change what
    coordinates mean)
  - End of `draw()` callback (caller expects committed pixels)
- Stroke handling: per-color stroke batches are a second pass after
  fill batches. Most games don't use stroke; can be lazy.

**Critical correctness concern**: batching by color reorders the
draw order across primitives. If game A draws a green rect at (10,10)
then a red rect at (10,10), the red should appear on top. With
batching by color, all greens are drawn first, then all reds — same
visual result if reds are drawn AFTER greens. **Preserving relative
order within color groups is essential.** The shim's batch buffers
must be FIFO per color.

**Cross-color reordering** is the real correctness risk. Most games
don't have overlapping rects of different colors, but some do.
Three options:
- (a) Accept the reordering and document the constraint (games must
      not overlap different-color primitives expecting Z-order).
- (b) Flush whenever a primitive's bounding box overlaps a pending
      batched primitive of a different color (expensive bookkeeping).
- (c) Hybrid: batch only consecutive same-color runs (no
      reordering). Reduces batching opportunity when colors interleave
      but preserves Z-order strictly.

**Recommendation**: ship (c) first. Most batching wins come from
naturally-clustered same-color sequences (tile maps, sprite groups).
(c) is the safest and most predictable.

### 11.2 Phase 1b: validate.py determinism check (1 day)

Run `validate.py --all` on a build that includes the Phase 1a shim
changes. All 39 bundled games must still pass strict byte-equality
across replays. If any game fails:
- Either the batching reorders Z-order in a way that game cares about
- Or there's a missed auto-flush point

Trace the failing game, find the missed flush trigger, add it,
re-validate.

### 11.3 Phase 1c: Bench batched-shim under SubprocVecEnv (0.5 day)

Before introducing Worker Threads at all, measure whether the new
shim alone improves throughput under the current architecture. Run
`tools/bench.py --all` against both:
- main (no batching)
- dev (with deferred-batch shim, single Node process per env as today)

Expected: meaningful per-env speedup (Cairo path2d_per_color was
60 μs/iter vs 86 μs for default) — maybe 30% on FPS for draw-heavy
games. This is a paper-worthy intermediate result independent of
the multi-env story.

### 11.4 Phase 1d: Worker Threads scaffold (4–5 days)

Per the Architecture A design from §3.1 / §11 appendix (now
re-promoted since the contention analysis cleared the way):

- New file `runtime/p5/multi-env-worker.mjs` (dispatcher in main thread)
- New file `runtime/p5/env-thread.mjs` (per-env thread)
- Per-thread: own `vm.Context`, own `p5-shim` realm (module-level globals
  isolated per thread automatically), own `canvas` instance
- Shared: `SharedArrayBuffer` layout per §11.2 of the appendix
- Synchronization: `Atomics.wait`/`Atomics.notify` per §11.3 of the appendix
- Python-side: new `python/node_gym/vec_env.py` containing `NodeVecEnv`
- Default cap: N=24 (matches the measured throughput peak from job 12929486)

### 11.5 Phase 1e: A/B vs analogen's training loop (2 days)

Replace `SubprocVecEnv` with `NodeVecEnv` in
`analogen/src/analogen/train_ppo_clean.py` (single-line change behind
a config flag for safety). Run a 1M-step PPO training and compare
sps against the SubprocVecEnv baseline.

Acceptance: ≥1.5× training sps improvement at n_envs=16 (since env
work is ~26% of step time and we'd reduce that by ~5×, net ~20–25%
overall improvement is realistic and meaningful).

### 11.6 Validation criteria (re-stated for the chosen architecture)

1. `validate.py`-equivalent strict byte-equality across replays, all
   39 bundled games, N=8 homogeneous batches.
2. At N=24 on FASRC, aggregate sps ≥ 1.5× current
   `SubprocVecEnv([NodeGymEnv]*16)` baseline (set the bar by the
   measured Job 12929486 peak).
3. No regression: single-env `NodeGymEnv` path unchanged, its bench
   numbers don't move.
4. Crash isolation: one game throwing in a Worker Thread surfaces a
   clean Python error, doesn't deadlock the other Workers.
5. `venv.close()` terminates within 2s in all conditions.

---

## 12. Appendix: Worker Threads design (for reference)

The original Worker Threads architecture in full detail, preserved here
because the receipts in §4 reference its phased plan. If the contention
landscape changes (Cairo update, skia threadpool change, etc.), this
appendix has the implementation map ready to revive.

### 11.1 Per-env state isolation

Two strategies were considered:

- **Strategy A (one Worker Thread per env, separate module load)**:
  each thread imports `p5-shim.mjs` independently. ES modules have
  per-realm state, so module-level globals are naturally per-thread.
  Memory cost: ~10–20 MB per V8 isolate at N=32 (~480 MB). Cleanest
  isolation. Was the recommended approach.
- **Strategy B (one thread, N `vm.Context`s)**: single-threaded
  process, N contexts, sequential per step. Loses the parallelism
  the design depended on. Rejected.

### 11.2 SharedArrayBuffer layout

```
offset  size          contents
0       4             header magic (uint32)
4       4             N (uint32)
8       N*1           actions (uint8 per env)
8+N     N*16          per-env step headers (reward f32, terminated u8,
                      truncated u8, gameState u8, lives u8, score i32,
                      episodeLength i32)
8+17N   N*H*W*C       obs bytes
last 4  control word  (Atomics.wait/notify target)
```

For N=16, 64×64 RGB: ~196 KB.

### 11.3 Synchronization

Two layers:

- **Python ↔ Node main thread**: existing stdin/stdout framing
  protocol from `game-worker.mjs`. One request/response per training
  step.
- **Node main thread ↔ Worker Threads**: `Atomics.notify` +
  `Atomics.wait` on Int32Array views of the shared buffer.

### 11.4 Why this didn't work (without Phase 0.5 attribution)

Per §4 above: at N=16 on FASRC Linux, the per-thread Cairo contention
overhead (3.4× slowdown) ate more than the SubprocVecEnv pickle
overhead saved. Aggregate throughput would have been comparable to or
slightly worse than current SubprocVecEnv.

The architecture is sound. It's the underlying library stack that
isn't thread-friendly. Revisit if that changes.
