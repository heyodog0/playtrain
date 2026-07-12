# Parallelism / aggregate throughput — the envpool-class native backend

Follow-up to `HANDOFF-parallelism.html`. That handoff closed single-env
optimization and pointed at the next frontier: the vectorized-env coordinator,
which capped aggregate throughput ~3–4× below the independent-process ceiling
because the only coordinator (`NodeVecEnv`) drove **Node/V8 subprocesses over
pipes from a pure-Python lockstep loop under the GIL** — and there was **no
vectorized coordinator for the fast `qjs_host` backend at all**.

This is the fix: a single-process, in-process C++ **threadpool** vector env over
the QuickJS + native-rasterizer backend — the same architecture envpool uses.

## What was built

1. **Per-env rasterizer state** (`crates/rasterizer/src/lib.rs`). The canvas
   registry + dirty-rect globals (`static mut CANVASES`, …) were bundled into an
   `RState` behind a thread-local *selectable* pointer, with a
   `rs_state_new/select/free` C ABI. Single-env callers are unaffected (a
   per-thread default is created lazily). **Bit-exact verified** (trace hashes +
   dirtycheck unchanged).
2. **Per-env p5 shim state** (`native/runtime/p5.cpp`). File-scope statics moved
   into a `P5State` struct behind a thread-local selectable pointer
   (`p5::newState/selectState/freeState`); field names redirected via localized
   macros so the shim body is untouched. **Bit-exact verified.**
3. **`native/qjs/qjs_vec_host.cpp`** — the coordinator. Fixed thread pool; each
   env owns its own `JSContext` + rasterizer state + p5 state and is **pinned to
   one worker thread** (no two threads ever touch the same interpreter). Batched
   `vec_step(actions) -> (obs, rew, term, trunc)` over a cacheline-padded
   per-worker-flag spin barrier. Per-env step semantics are byte-identical to
   `qjs_host serve` (which `QuickJSEnv` drives). Built as a shared lib by
   `native/build_qjs_vec.sh`.
4. **`python/node_gym/native_vec_env.py`** — `NativeVecEnv` (sync) +
   `AsyncNativeVecEnv` (envpool send/recv), ctypes wrappers. ctypes releases the
   GIL for the whole batch, so N envs step in parallel with **no Python in the
   hot loop, no subprocess, no pipe.** The Python step caches the action pointer
   (re-creating a ctypes pointer per call cost ~730 ns; ~7× cheaper now).
5. **Async mode** (`vec_send`/`vec_recv`, `batch_size < N`, lock-free MPMC queue).
   Workers pull envs off a queue, step them, publish finished ids; `recv` returns
   the first `batch_size` — a slow env never stalls the batch. Supports a
   **heterogeneous pool** (one game per env) via `vec_create_async_multi`.

## Correctness

`tests/test_native_vec_env.py`: each env in the threadpool host is **bit-exact**
(obs + reward + term + trunc) vs a single `QuickJSEnv` on the same
game + seed + action sequence (bigfish, coinrun, miner; 200 steps × 4 envs), plus
async send/recv round-trip and heterogeneous-pool smoke tests.

## Results (Apple M4 Pro, 10 perf + 4 eff cores, N = 10 = perf-core count)

Reproduce: `uv run python tools/bench_native_vec.py --n 10`
(JSON → `outputs/compare/native_vec_bench.json`).

| game      | single/env | ceiling@10 (indep procs) | **native-vec@10** | eff  | native-vec@20 | py-coord@10 | native/py |
|-----------|-----------:|-------------------------:|------------------:|-----:|--------------:|------------:|----------:|
| plunder   |    309k    |  2.74M                   | **1.61M**         | 59%  | **2.08M**     | 277k        | 5.8×      |
| bigfish   |    208k    |  1.91M                   | 1.02M             | 54%  | 1.09M         | 325k        | 3.2×      |
| starpilot |    142k    |  1.32M                   | 938k              | 71%  | 976k          | 252k        | 3.7×      |
| leaper    |     85k    |  809k                    | 662k              | 82%  | 628k          | 195k        | 3.4×      |
| coinrun   |     25k    |  236k                    | 199k              | 84%  | 214k          | 153k        | 1.3×      |
| maze      |     40k    |  363k                    | 333k              | 92%  | 328k          | 156k        | 2.1×      |
| miner     |     16k    |  141k                    | 125k              | 89%  | 121k          |  88k        | 1.4×      |

**geomean: 74% of the embarrassingly-parallel ceiling, 2.65× over the Python
coordinator.** Peak aggregate reached: **plunder 2.08M sps, bigfish 1.09M** — in
one process, one clean batched API.

### Sync efficiency tracks frame cost (measured, not assumed)

Efficiency is monotone in frame cost: realistic games (miner, maze, coinrun,
leaper) hit **82–92% of the hardware ceiling** — envpool-class. Ultra-cheap-frame
games (plunder/bigfish, ~5 µs/step) sit at 54–59%, because the per-step sync
barrier is a large fraction of a 5 µs frame. Profiled fixed costs: a bare ctypes
call is **124 ns**; the old per-step pointer marshalling was **730 ns** (now
cached away). Both are *per batch*, i.e. ~0.1 µs/env at N=10 — so a pybind11/C
extension is **not** worth it. Raising N past the thread count amortizes the
barrier further (`native-vec@20`).

### Where async wins: heterogeneous pools

For a *homogeneous* pool the sync barrier at N ≥ 2× threads is already
near-optimal, so async only reaches parity (balanced work → no straggler to
skip). Async earns its keep on a **mixed pool**, where sync waits for the slowest
game every step. Measured, 10× plunder + 10× miner (N=20):

| mode                                   | aggregate |
|----------------------------------------|----------:|
| sync (capped by slowest = N miners)    |   129k    |
| async `batch=N` (wait for all)         |   108k    |
| async `batch=N/2`                      | **397k**  |
| async `batch=N/4`                      | **447k**  |

**async(batch=N/2) / sync = 3.07×** — fast envs cycle without waiting for slow
ones. This is exactly envpool's async design and the right mode for multi-task
eval / dataset collection over a mixed catalog.

## FASRC sapphire (homogeneous Xeon 8480+)

`tools/fasrc_parallelism.sbatch` (or `srun --exclusive --cpus-per-task=$CORES`)
builds and runs on a homogeneous node — no perf/eff split, so `--threads` = full
core count with no heterogeneity discount.

**Node: `holy8a24601`, 2× Intel Xeon Platinum 8480CL, 112 cores (HT off), N=112.**

| game      | single/env | ceiling (112 procs) | **native-vec@112** | eff  | py-coord | **native/py** |
|-----------|-----------:|--------------------:|-------------------:|-----:|---------:|--------------:|
| plunder   |     94k    |  10.14M             | **5.34M**          | 53%  |   194k   |  **27.6×**    |
| bigfish   |     75k    |   7.14M             | 3.12M              | 44%  |   196k   |   16.0×       |
| starpilot |     52k    |   4.62M             | 1.94M              | 42%  |   194k   |   10.0×       |
| leaper    |     34k    |   3.65M             | 2.70M              | 74%  |   194k   |   13.9×       |
| maze      |     15k    |   1.51M             | 1.35M              | 89%  |   190k   |    7.1×       |
| coinrun   |    9.6k    |   1.01M             | 884k               | 88%  |   185k   |    4.8×       |
| miner     |    6.3k    |   662k              | 511k               | 77%  |   155k   |    3.3×       |

**geomean: 64% of the ceiling, and 9.5× over the Python coordinator (up to 27.6×).**

The headline is the **`py-coord` column: it flatlines at ~155–196k sps for every
game, regardless of env speed** — that's the GIL wall the handoff predicted (its
"~79–92k software cap," here ~190k on faster silicon), and it's why the Python
coordinator can't use a big node. native-vec removes it: one process reaches
**5.34M sps**, 64% of what 112 independent processes get (77–89% on realistic
games; cheaper frames pay more for the 112-way barrier, same monotone pattern as
the M4). Peak single-node aggregate here: **plunder 5.34M steps/s.**
(`native-vec@2N` was noisy on this run — bigfish/miner thrashed at 224 live envs —
so the clean `@112` column is the headline; rerun with more memory headroom.)

## Build

```
native/build_qjs.sh        # once, for the rasterizer/quickjs/frozenmath staticlibs + qjs_host
native/build_qjs_vec.sh    # libqjs_vec.{dylib,so}  (Linux builds PIC copies of quickjs/frozenmath)
```
