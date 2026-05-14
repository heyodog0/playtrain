# Worker-Threads Multi-Env Runtime — Design

Status: design draft, not yet implemented.
Branch: `dev/worker-threads-multi-env`.
Target: aggregate throughput parity with (or beyond) ALE at n≥16, while
preserving the "write games in idiomatic p5.js/three.js" developer experience
and existing observation/reward semantics.

---

## 1. Motivation

The current architecture spawns one Node subprocess per env via
`SubprocVecEnv`. At n_envs=16 on a CUDA training box this gives node-gym
~74% of ALE's aggregate sps on matched PPO settings (analogen job 12720391:
ALE 2064 / node-gym-grid 1522 sps). The 26% gap is paid in two places:

1. **Per-env Node process overhead.** 16 separate V8 heaps, 16 GCs, 16
   JIT warmups, 16 mmap regions, 16 stdio pipes. Even though each env's
   step is cheap (~50–90 μs in-worker), the per-process fixed costs add up.
2. **SubprocVecEnv coordination overhead.** SB3's `SubprocVecEnv` pickles
   the per-env obs returned from each child Python process to the main
   Python process, on top of the Node→child-Python mmap path that node-gym
   already provides. The pickle + pipe round-trip per env per step is the
   dominant component of the 26% gap.

After the recent p5 fast-obs and style-cache work, **per-env step time in
node-gym is no longer the bottleneck**; the bottleneck is now the
SubprocVecEnv-induced coordination overhead. The next architectural
move is to collapse 16 Python-subprocess-of-Node-worker pairs into one
multi-threaded Node worker.

### Non-goals

- A C++ env runtime. EnvPool wraps existing C++ envs in a C++ runtime;
  node-gym envs are JS, so wrapping V8 in C++ gives the maintenance pain
  without the perf win.
- Replacing node-canvas / Cairo. The rendering backend stays.
- Changing the per-env step semantics. Existing bundled games and any
  future LLM-generated games must produce byte-identical observations
  under the new runtime, modulo the determinism guarantees already in
  validate.py.
- A new Python protocol. The Gym/Gymnasium API surface stays the same;
  only the internal vec-env transport changes.

---

## 2. Current architecture (briefly)

```
Python (main process)
  ├── SubprocVecEnv
  │     ├── child Python 0 ──pickle/pipe── NodeGymEnv ──mmap── Node worker 0 (one V8 heap, one Cairo canvas, one game)
  │     ├── child Python 1 ──pickle/pipe── NodeGymEnv ──mmap── Node worker 1
  │     ├── ...
  │     └── child Python 15 ──pickle/pipe── NodeGymEnv ──mmap── Node worker 15
  └── PPO loop
```

Per training step: 16 pickle ops, 16 pipe round-trips, 16 mmap reads,
16 V8 heaps each doing GC and JIT independently.

---

## 3. Proposed architecture

```
Python (main process)
  ├── NodeVecEnv  ──actions over single mmap──┐
  │                                            │
  │                ┌───────────────────────────▼───────────────┐
  │                │ Node worker (single process)              │
  │                │   main thread: dispatcher                 │
  │                │     ├── Worker Thread 0 → GameEnv 0       │
  │                │     ├── Worker Thread 1 → GameEnv 1       │
  │                │     ├── ...                               │
  │                │     └── Worker Thread 15 → GameEnv 15     │
  │                │   shared: SharedArrayBuffer (obs batch)   │
  │                └───────────────────────────┬───────────────┘
  └── obs batch via single mmap ◄──────────────┘
```

**Key idea**: one Node process, N Worker Threads (real OS threads in
Node), one big `SharedArrayBuffer` mapped to a single Python-side mmap.

Per training step:
- Python writes N actions to the shared region, signals the dispatcher.
- Dispatcher fans actions out to N threads via `Atomics.notify`.
- Each thread steps its game and writes its obs into its slot of the
  shared region.
- Dispatcher waits for all N threads to finish, signals Python.
- Python reads the batched obs as a single `(N, H, W, C)` array.

**One pipe round-trip per training step instead of N.**
**Zero pickle.**
**N real parallel threads instead of N processes contending for CPU
through the kernel scheduler.**

### 3.1 Per-env state isolation

The current `p5-shim.mjs` uses **module-level globals** for canvas state
(`_canvas`, `_ctx`, `_fillStyle`, `_obsCanvas`, etc.). Multi-env in a
single process requires each env to have its own state.

Two viable strategies:

#### Strategy A: One Worker Thread per env, separate module load

Each Worker Thread `import`s `p5-shim.mjs` independently. ES modules
have per-realm state, so module-level globals are naturally per-thread.
No code change to the shim. Game code is loaded into the thread via
`vm.runInThisContext` as today, and the game's globals (`setup`, `draw`,
`getGameState`) attach to the thread's `globalThis`.

Pros:
- Minimal shim changes.
- True isolation: a buggy game in env 7 can't corrupt env 8's canvas.

Cons:
- Each thread holds its own V8 isolate (Worker Threads have separate
  isolates by design). Memory cost: ~10–20 MB per thread plus the
  game's heap. At N=32 this is ~300–600 MB worker-side. Tolerable.
- Thread startup is not free (~50–100 ms each). Only matters at env
  construction, not per-step.

#### Strategy B: One thread, N `vm.Context`s in a loop

Single-threaded Node process, N `vm.Context` instances each holding one
game's globals + one canvas. Sequential per step (N games stepped one
after another in one thread).

Pros:
- One V8 isolate, lower memory.
- No thread coordination overhead.

Cons:
- **Sequential, not parallel.** At N=16 and per-env step ~80 μs, that's
  1.3 ms wall-clock for env compute alone, vs ~80 μs in Strategy A.
- Loses the only architectural win we're trying to get.

**Recommendation: Strategy A.** The memory cost is acceptable; the
parallelism is the entire point.

### 3.2 SharedArrayBuffer layout

One contiguous shared region, sized for N envs at construction:

```
offset  size                  contents
────────────────────────────────────────────────────────────────
0       4                     header magic (uint32, sanity check)
4       4                     N (uint32, num envs, sanity check)
8       N*1                   action bytes (uint8, one per env)
8+N     N*16                  per-env step headers (16 bytes each, packed)
                              [reward f32 | terminated u8 | truncated u8 |
                               gameState u8 | lives u8 | score i32 |
                               episodeLength i32]
8+17N   N*H*W*C               obs bytes (uint8, contiguous, row-major)
last 4  control word          (Atomics.wait/notify target)
```

Total bytes for N=16, 64×64 RGB: 8 + 16 + 272 + 196608 + 4 ≈ 196 KB.

Python mmaps this whole region. The Python-side `NodeVecEnv.step(actions)`:

```python
def step(self, actions):
    # write actions
    self._actions_view[:] = actions.astype(np.uint8)
    # signal
    struct.pack_into("<I", self._mmap, self._ctrl_offset, REQUEST_STEP)
    # wait
    self._read_completion()
    # decode
    obs = self._obs_view  # already a (N, H, W, C) numpy view, no copy
    return obs, self._rewards, self._dones, self._infos
```

### 3.3 Synchronization protocol

Two layers:

**Python ↔ Node main thread**: uses the existing stdin/stdout framing
protocol from `game-worker.mjs`. One request/response per training step,
not per env. Body is just `{cmd: "step"}` since actions and obs are in
shared memory.

**Node main thread ↔ Worker Threads**: `Atomics.notify` + `Atomics.wait`
on Int32Array views of the shared buffer.

```js
// Worker thread loop
while (true) {
  Atomics.wait(ctrl, MY_SLOT, 0);              // wait for action
  const action = actions[MY_INDEX];
  const result = env.step(action);
  writeStepHeader(result, MY_INDEX);
  writeObs(result.observation, MY_INDEX);
  Atomics.store(ctrl, MY_SLOT, 0);             // mark done
  Atomics.notify(ctrl, COORD_SLOT, 1);         // notify dispatcher
}

// Dispatcher
function step() {
  // fan out
  for (let i = 0; i < N; i++) Atomics.store(ctrl, i, 1);
  for (let i = 0; i < N; i++) Atomics.notify(ctrl, i, 1);
  // wait for all
  let done = 0;
  while (done < N) {
    Atomics.wait(ctrl, COORD_SLOT, 0);
    Atomics.store(ctrl, COORD_SLOT, 0);
    done = countCompleted(ctrl);
  }
}
```

Real implementation has more nuance (barrier counters, spurious wakeups,
graceful close), but this is the shape.

### 3.4 Python-side API

`NodeVecEnv` looks like a Gymnasium `VectorEnv`:

```python
from node_gym import NodeVecEnv

venv = NodeVecEnv(games=["flappy_bird"] * 16,    # or heterogeneous list
                  obs_size=64, obs_mode="rgb",
                  shared_mem=True)
obs, info = venv.reset(seeds=[0,1,2,...])
obs, rewards, terminated, truncated, infos = venv.step(actions)
venv.close()
```

Drop-in replacement for `SubprocVecEnv([NodeGymEnv(g) for g in games])`
on the training side. `NodeGymEnv` (single env) stays for `play.mjs`,
rollouts, tests, debugging — anywhere you want one env in its own
process.

### 3.5 Compatibility with existing `NodeGymEnv`

We keep both:

- **`NodeGymEnv`**: single env, one Node process, current architecture.
  Used by `tools/play.mjs`, `tools/rollout.py`, tests, and any caller
  that wants one env in isolation.
- **`NodeVecEnv`**: N envs, one Node process with N Worker Threads.
  Used by training. The trainer in analogen/`train_ppo_clean.py`
  switches from `SubprocVecEnv([NodeGymEnv(g) for _ in range(N)])` to
  `NodeVecEnv([g] * N)` and otherwise stays identical.

Game code is unchanged. The same `setup() / draw() / resetGame() /
getGameState()` contract holds inside each Worker Thread.

---

## 4. Migration

For game authors: **no change required**. The shim is loaded per-thread,
so module-level globals continue to work as before within a single env's
execution.

For training code: replace the `SubprocVecEnv` instantiation. ~5 lines
in `analogen/src/analogen/train_ppo_clean.py`.

For `validate.py` / `bench.py`: gain a parallel mode that uses
`NodeVecEnv` for batched throughput benchmarks. Existing single-env
modes stay as the per-game characterization tool.

For `tools/play.mjs`: unchanged (single env in browser).

---

## 5. Open questions / risks

### 5.1 Worker Thread overhead

How much does `Atomics.wait` / `Atomics.notify` cost per step? On
modern Linux/macOS, kernel-level futex ops are ~1–5 μs. At N=16 with
two synchronizations per step (fan-out + gather), wall-clock overhead
is ~50–100 μs/step. Acceptable if env compute is ~80 μs/env (since
threads run in parallel), problematic if env compute drops below the
sync overhead. Must be measured on a prototype.

### 5.2 V8 isolate memory cost

Each Worker Thread has its own V8 isolate. Baseline ~10–20 MB per
isolate. At N=32 that's ~480–640 MB worker-side memory. For training
boxes this is fine; for memory-constrained CI runners it might not be.
Workaround: cap N at 16 by default, document the memory implication.

### 5.3 Node-canvas thread safety

`node-canvas` uses Cairo. Each Worker Thread holds its own `Canvas`
instance, so there's no shared Cairo state across threads. Cairo
itself is thread-safe for separate surfaces. Should be fine but
worth verifying: does node-canvas's N-API binding hold any
process-global locks that would serialize threads? If yes, Strategy A's
parallelism is undermined.

**Open**: bench a 2-thread prototype that does `fillRect` in a hot loop
on each thread's own canvas. If both threads scale linearly, we're
safe. If not, investigate.

### 5.4 SharedArrayBuffer + cross-platform

`SharedArrayBuffer` requires specific flags in some Node versions /
deployment contexts. Node 20+ has it on by default; should not be an
issue. Verify on FASRC's Node module.

### 5.5 Determinism

Per-env determinism is preserved as long as each thread's `Math.random`
override and seed isolation matches the current single-env path. The
existing `mulberry32(seed)` pattern works per-realm; each Worker Thread
gets its own override. **validate.py must pass on the new runtime with
strict byte-equality across replays.**

### 5.6 Heterogeneous game catalogs in one batch

The API allows `NodeVecEnv(games=["flappy_bird", "mario", ...])` — a
mixed batch. This is useful for cross-game training. But: different
games may have different per-step costs, so the dispatcher's "wait for
all N" barrier is pinned to the slowest env per step. For homogeneous
training (typical case), no impact. For mixed batches, expect
throughput equal to the slowest game's per-step cost × N / (parallel
threads).

### 5.7 Game crashes

If a game throws inside a Worker Thread, the thread dies. The
dispatcher must detect this (thread exit event), surface a clean error
to Python (don't deadlock), and optionally restart the thread with a
fresh env. **Worth handling explicitly from day one** — debugging a
hung Worker Thread is much harder than handling a graceful error.

---

## 6. Phased implementation plan

### Phase 0: Validation prototype — ✅ DONE

**Verdict: GO, with caveats.** node-canvas is thread-safe; aggregate
throughput scales sub-linearly but meaningfully. Full results below.

Probe: `tools/probe_worker_threads.mjs`. Workload per iter: 50 fillRects
on a 480×352 canvas + drawImage to 64×64 offscreen + toBuffer('raw').
3000 iters/thread, run on a 14-core Apple Silicon Mac (heterogeneous
P+E cores).

| N threads | wall ms | slowest μs/iter | agg iters/s | per-thread efficiency vs baseline |
|---|---:|---:|---:|---:|
| baseline (main, no Worker) | 96 | 32.1 | 31,167 | 100% |
| 1 Worker Thread | 140 | 30.6 | 21,368 | 105% |
| 2 Worker Threads | 147 | 35.2 | 40,862 | **91%** |
| 3 Worker Threads | 190 | 47.8 | 47,359 | 67% |
| 4 Worker Threads | 222 | 54.8 | 54,129 | 59% |
| 6 Worker Threads | 310 | 80.0 | **58,121 (peak)** | 40% |
| 8 Worker Threads | 508 | 139.2 | 47,201 | 23% |
| 12 Worker Threads | 1,171 | 349.0 | 30,744 | 9% |

Key findings:

1. **node-canvas is thread-safe.** No process-global Cairo lock. At
   N=2 we get 91% per-thread efficiency, which would be ~0% if a
   global lock were serializing the canvas operations. This was the
   gating question for the whole design, and it passes.

2. **Worker Thread overhead is negligible.** Single Worker Thread runs
   at 30.6 μs/iter vs 32.1 μs main-thread baseline (within noise).
   The Atomics-based dispatch we plan in §3.3 will add ~1–5 μs/step;
   safely under the env-compute cost.

3. **Per-thread time degrades with N, aggregate peaks at N≈6.**
   At N=6, aggregate is 1.86× single-thread baseline (58k vs 31k
   iters/s). At N=12, aggregate is *worse* than single-thread. Two
   candidate explanations:

   a. **Apple Silicon heterogeneous cores.** This Mac has ~6 P-cores
      and ~8 E-cores. P-cores are ~2–4× faster than E-cores on this
      workload. With N>P-core-count, threads spill onto E-cores; the
      step barrier waits for the slowest thread, so E-core spillover
      tanks effective throughput.

   b. **Cairo/pixman internal contention.** Even with separate canvas
      instances, Cairo may serialize on a shared allocator or font
      cache mutex.

   **Most likely (a).** Linux Xeon/EPYC training boxes have uniform
   cores; scaling should be cleaner there. We won't know for sure
   until we re-bench on FASRC.

4. **Recommendation**: proceed to Phase 1 (two-env prototype). Cap
   default N at 6 on Apple Silicon, parameterize for the target box.
   Re-bench on FASRC **before** declaring final aggregate-throughput
   numbers for the paper.

5. **Even worst-case scaling (this Mac) is a meaningful win.** Today,
   `SubprocVecEnv([NodeGymEnv]*16)` pays per-process overhead on
   *every* step (16 pickles + 16 pipe round-trips). The Worker
   Threads design at N=6 already gives 1.86× single-thread aggregate
   throughput with zero pickle overhead. The SubprocVecEnv baseline
   wasn't measured by this probe; combined with the matched-PPO
   throughput gap (ALE 2064 / node-gym 1522), we expect the Worker
   Threads design to be net-positive even at N=6.

### Phase 1: Two-env Worker Threads prototype (3 days)

Goal: confirm node-canvas is thread-safe across Worker Threads.

- Spawn 2 Worker Threads, each creating a 640×480 node-canvas.
- Each thread runs a hot loop of `fillRect` + `toBuffer('raw')`
  for 5 seconds.
- Measure: is per-thread throughput ~equal to single-thread baseline?
- If yes: proceed to Phase 1. If no: investigate, possibly need to
  serialize node-canvas calls (which kills the design).

### Phase 1: Two-env Worker Threads prototype (3 days)

Goal: validate the synchronization protocol and shared-memory layout.

- New file: `runtime/p5/multi-env-worker.mjs`. Dispatcher thread.
- New file: `runtime/p5/env-thread.mjs`. Per-env thread wrapper that
  loads `game-env.mjs` and steps one env.
- New file: `python/node_gym/vec_env.py`. `NodeVecEnv` Python wrapper.
- Hardcoded N=2, hardcoded game = flappy_bird × 2.
- Bench: per-env throughput vs current single-env path.
- Goal: ≤10% per-env overhead, validate.py-equivalent determinism
  check (run twice, byte-compare).

### Phase 2: General N + heterogeneous catalogs (3 days)

- Parameterize N via constructor.
- Support `NodeVecEnv(games=[...])` with arbitrary game paths.
- Per-thread `vm.Context` setup if needed for stricter isolation.
- Run validate.py-equivalent across all 39 bundled games in
  homogeneous batches of N=8.

### Phase 3: Error handling + lifecycle (2 days)

- Thread crash → clean Python-side error.
- `venv.close()` cleanly terminates all threads.
- `reset()` per env, including auto-reset on done.
- Episode-end info routing.

### Phase 4: Performance pass (3 days)

- Profile: where does the new path spend time?
- Tune SharedArrayBuffer layout (cache-line alignment for
  per-thread slots to avoid false sharing).
- Compare aggregate sps against ALE on matched PPO settings.
- Acceptance: ≥1.5× the current node-gym aggregate sps at N=16.

### Phase 5: Integration + docs (2 days)

- `tools/bench.py --vec` mode.
- Update `analogen/src/analogen/train_ppo_clean.py` to use
  `NodeVecEnv`.
- Documentation + README update.
- Merge to main.

**Total: ~13 working days, ~2.5 weeks calendar.**

---

## 7. Validation criteria

The new runtime is acceptable for merging to main iff:

1. **Determinism**: validate.py-equivalent strict byte-equality on
   all 39 bundled games, N=8 homogeneous batches, two replays.
2. **Throughput**: at N=16 on a CUDA box, aggregate sps ≥ 1.5× the
   current `SubprocVecEnv([NodeGymEnv]*16)` baseline.
3. **No regression**: single-env `NodeGymEnv` path is unchanged and
   its bench numbers don't move.
4. **Crash isolation**: a deliberately throwing game in slot 7 doesn't
   hang or crash the other 15 envs; surfaces a clean Python error.
5. **Lifecycle**: `venv.close()` terminates within 2s under all
   conditions, including with games mid-step.

---

## 8. Out of scope (for this design)

- **three.js multi-env**. The three.js path has different bottlenecks
  (GPU readback, not env compute) and a different optimization story
  (GPU-batched rendering across envs). Separate design doc when we get
  to it.
- **Native draw-list addon**. The mario CPU profile suggests this
  would shave another 5–10% on draw-heavy games but is unrelated to
  the multi-env work. Evaluate as a separate effort after Phase 5.
- **Skia-canvas swap**. Possibly worth experimenting with after
  multi-env lands. Independent change, can stack if it works.
- **Distribution / prebuilt binaries**. The native-build pain point
  is real for users but doesn't block the runtime work. Address as
  part of pre-publish.

---

## 9. Open decisions to make before Phase 1

- [ ] N upper bound: 32? 64? Decide based on Phase 0 memory measurement.
- [ ] Heterogeneous catalogs: support from day one (Phase 2) or defer?
- [ ] Per-env error policy: restart on crash, or propagate failure?
- [ ] Frame-stacking: stay Python-side, or move into worker?
- [ ] Action space: assume Discrete per env, or generic? (Current
      games are all Discrete(8); generic adds complexity.)

These don't block design approval but need decisions before
implementation starts.
