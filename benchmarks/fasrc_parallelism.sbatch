#!/bin/bash
#SBATCH --job-name=ng-parallelism
#SBATCH --partition=sapphire
#SBATCH --nodes=1
#SBATCH --exclusive
#SBATCH --cpus-per-task=56
#SBATCH --mem=64G
#SBATCH --time=00:40:00
#SBATCH --output=%x-%j.out
#
# Headline aggregate-throughput measurement for the native threadpool vec backend
# on a homogeneous Xeon node — no perf/eff core split, so --threads = full core
# count with no heterogeneity discount (unlike the Apple-Silicon dev numbers).
#
# Produces:
#   - sync scaling & efficiency vs the independent-process ceiling per game
#   - the async heterogeneous-pool win (batch_size < N over a mixed game pool)
#
# Submit:  sbatch benchmarks/fasrc_parallelism.sbatch
# Repo must be checked out with native/ present. Adjust --cpus-per-task to the
# node's physical core count (sapphire = Xeon 8480+, 56 cores/socket).
set -euo pipefail
cd "${SLURM_SUBMIT_DIR:-$PWD}"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

# --- toolchain (FASRC modules; adjust names if the cluster's differ) ----------
module load rust/1.78.0-fasrc01 2>/dev/null || module load rust 2>/dev/null || true
module load gcc/12.2.0-fasrc01 2>/dev/null || module load gcc 2>/dev/null || true
command -v cargo   >/dev/null || { echo "need cargo (module load rust)"; exit 1; }
command -v clang++ >/dev/null || command -v g++ >/dev/null || { echo "need a C++ compiler"; exit 1; }
command -v uv      >/dev/null || { echo "need uv (curl -LsSf https://astral.sh/uv/install.sh | sh)"; exit 1; }

# --- build the native backend (staticlibs + shared lib) -----------------------
echo "=== building native backend ==="
bash native/build_qjs.sh          # rasterizer + quickjs + frozenmath staticlibs, qjs_host
bash native/build_qjs_vec.sh      # libqjs_vec.so

CORES="${SLURM_CPUS_PER_TASK:-$(nproc)}"
echo "=== node $(hostname)  cores=$CORES ==="
lscpu | grep -E "Model name|Socket|Core|Thread" || true

# --- sync scaling + efficiency vs ceiling (headline table) --------------------
echo "=== native-vec vs ceiling vs Python coordinator (N=cores, threads=cores) ==="
uv run --with numpy --with gymnasium python benchmarks/bench_native_vec.py \
    --n "$CORES" --threads "$CORES" \
    --out "outputs/compare/native_vec_bench_fasrc_${SLURM_JOB_ID:-local}.json"

# --- async heterogeneous-pool win --------------------------------------------
echo "=== async mixed-pool throughput (batch_size < N) ==="
uv run --with numpy --with gymnasium python - "$CORES" <<'PY'
import sys, time
import numpy as np
from playtrain.runtime.native_vec_env import AsyncNativeVecEnv, NativeVecEnv
cores = int(sys.argv[1])
N = 2 * cores
pool = (["plunder"] * (N // 2)) + (["miner"] * (N // 2))   # fast + slow mix

def async_mixed(batch, env_steps=200000):
    e = AsyncNativeVecEnv(games=pool, batch_size=batch, autoreset=True, num_threads=cores)
    e.reset(seeds=np.arange(N, dtype=np.int32))
    e.send(np.arange(N, dtype=np.int32), np.ones(N, dtype=np.int32))
    d = 0
    while d < 20000:
        ids, *_ = e.recv(); e.send(ids, np.ones(len(ids), dtype=np.int32)); d += len(ids)
    best = 0.0
    for _ in range(3):
        t = time.perf_counter(); d = 0
        while d < env_steps:
            ids, *_ = e.recv(); e.send(ids, np.ones(len(ids), dtype=np.int32)); d += len(ids)
        best = max(best, d / (time.perf_counter() - t))
    e.close(); return best

def sync_homog(game, n, steps=8000):
    e = NativeVecEnv(game, num_envs=n, autoreset=True, num_threads=cores)
    e.reset(seeds=np.arange(n, dtype=np.int32)); a = np.ones(n, dtype=np.int32)
    for _ in range(50): e.step(a)
    best = 0.0
    for _ in range(3):
        t = time.perf_counter()
        for _ in range(steps): e.step(a)
        best = max(best, n * steps / (time.perf_counter() - t))
    e.close(); return best

slow_cap = sync_homog("miner", N)     # a mixed sync pool degrades to the slowest game
print(f"pool = {N//2}x plunder + {N//2}x miner  (N={N}, threads={cores})")
print(f"  sync mixed ~ capped by slowest (N miners lockstep): {slow_cap:12,.0f} f/s")
for b in (N, N // 2, N // 4):
    print(f"  async batch={b:<4}                                  : {async_mixed(b):12,.0f} f/s")
PY

echo "=== done ==="
