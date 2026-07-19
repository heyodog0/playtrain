"""Raw env-only throughput ceiling: NodeVecEnv stepping random actions,
NO model / inference / learner. Measures the CPU env SPS limit at a given
parallelism. Aggregate frames/s = num_envs * step-calls/s (synchronous vec).

    python tools/raw_vec_bench.py <num_envs> [game] [steps]
"""
import sys, time
import numpy as np
from playtrain.runtime.vec_env import NodeVecEnv

N = int(sys.argv[1])
game = sys.argv[2] if len(sys.argv) > 2 else "breakout"
K = int(sys.argv[3]) if len(sys.argv) > 3 else 500

venv = NodeVecEnv(games=[game] * N)
venv.reset(seed=42)
rng = np.random.default_rng(42)
for _ in range(50):
    venv.step(rng.integers(0, 8, size=N))

best = 0.0
for trial in range(3):
    t = time.perf_counter()
    for _ in range(K):
        venv.step(rng.integers(0, 8, size=N))
    dt = time.perf_counter() - t
    agg = N * K / dt
    best = max(best, agg)
    print(f"N={N:<3} trial{trial} aggregate={agg:8.0f} f/s   per-env={K/dt:6.0f} f/s")
print(f"N={N:<3} BEST aggregate={best:8.0f} f/s   per-env={best/N:6.0f} f/s")
venv.close()
