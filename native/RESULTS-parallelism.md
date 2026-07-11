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
4. **`python/node_gym/native_vec_env.py`** — `NativeVecEnv`, a ctypes wrapper.
   ctypes releases the GIL for the whole batch, so N envs step in parallel with
   **no Python in the hot loop, no subprocess, no pipe.**

## Correctness

`tests/test_native_vec_env.py`: each env in the threadpool host is **bit-exact**
(obs + reward + term + trunc) vs a single `QuickJSEnv` on the same
game + seed + action sequence (bigfish, coinrun, miner; 200 steps × 4 envs).

## Results (Apple M4 Pro, 10 perf + 4 eff cores, N = 10 = perf-core count)

Reproduce: `uv run python tools/bench_native_vec.py --n 10`
(JSON → `outputs/compare/native_vec_bench.json`).

| game      | single/env | ceiling@10 (indep procs) | **native-vec@10** | eff  | native-vec@20 | py-coord@10 | native/py |
|-----------|-----------:|-------------------------:|------------------:|-----:|--------------:|------------:|----------:|
| plunder   |    297k    |  2.73M                   | **1.52M**         | 56%  | **1.86M**     | 280k        | 5.4×      |
| bigfish   |    205k    |  1.91M                   | 904k              | 47%  | 1.02M         | 313k        | 2.9×      |
| starpilot |    140k    |  1.31M                   | 848k              | 65%  | 906k          | 256k        | 3.3×      |
| leaper    |     85k    |  786k                    | 631k              | 80%  | 626k          | 204k        | 3.1×      |
| coinrun   |     25k    |  234k                    | 196k              | 84%  | 208k          | 151k        | 1.3×      |
| maze      |     40k    |  362k                    | 305k              | 84%  | 314k          | 155k        | 2.0×      |
| miner     |     16k    |  141k                    | 126k              | 89%  | 121k          | 92k         | 1.4×      |

**geomean: 70% of the embarrassingly-parallel ceiling, 2.5× over the Python
coordinator.** Peak aggregate reached: **plunder 1.86M sps, bigfish 1.02M** — in
one process, one clean batched API.

### The one honest caveat

Efficiency tracks frame cost monotonically: realistic games (miner, maze,
coinrun, leaper) hit **77–91% of the hardware ceiling** — envpool-class. Only the
ultra-cheap-frame games (plunder/bigfish, ~5 µs/step) fall to 45–57%, because a
**fixed ~6 µs/step coordination cost** (ctypes marshalling + Python loop + sync
barrier) is a large fraction of a 5 µs frame. This is the exact regime where
envpool's *synchronous* mode is also barrier-bound and needs **async mode**
(`batch_size < num_envs`, step the first-ready M). Raising N past the thread
count amortizes the barrier (`native-vec@20` recovers plunder to 1.9M).

## Next steps

1. **Async stepping** (`vec_send`/`vec_recv` with `batch_size < N`) — drops the
   full-barrier tail-latency, the last multiple for cheap-frame games; fully
   matches envpool's async API.
2. **Trim the fixed per-step cost** — a small pybind11/C-extension entrypoint
   instead of ctypes, and a leaner Python `step` (cache the actions/pointer
   marshalling) to shave the ~6 µs floor.
3. **Re-measure on FASRC sapphire** (homogeneous Xeon — pass `--threads` =
   core count; no perf/eff split, so no core-heterogeneity discount) for the
   paper's headline aggregate SPS/node.
```
build:  native/build_qjs.sh   (once, for the staticlibs)
        native/build_qjs_vec.sh
```
