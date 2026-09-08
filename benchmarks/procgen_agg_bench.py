"""ProcGen native-vectorized aggregate throughput (C++ batcher), no learner.

    python benchmarks/procgen_agg_bench.py <num_envs> [game] [steps]
"""
import sys, time
import numpy as np

N = int(sys.argv[1])
game = sys.argv[2] if len(sys.argv) > 2 else "bigfish"
K = int(sys.argv[3]) if len(sys.argv) > 3 else 1000
rng = np.random.default_rng(42)

# gym3 native API (fully vectorized); fall back to the gym VecEnv adapter.
try:
    from procgen import ProcgenGym3Env
    env = ProcgenGym3Env(num=N, env_name=game)
    def step():
        env.act(rng.integers(0, 15, size=N).astype(np.int32))
        env.observe()
except Exception:
    from procgen import ProcgenEnv
    env = ProcgenEnv(num_envs=N, env_name=game)
    env.reset()
    def step():
        env.step(rng.integers(0, 15, size=N))

for _ in range(50):
    step()
best = 0.0
for tr in range(3):
    t = time.perf_counter()
    for _ in range(K):
        step()
    dt = time.perf_counter() - t
    agg = N * K / dt
    best = max(best, agg)
    print(f"N={N:<3} trial{tr} aggregate={agg:8.0f} f/s   per-env={K/dt:6.0f} f/s")
print(f"N={N:<3} BEST aggregate={best:8.0f} f/s   per-env={best/N:6.0f} f/s")
