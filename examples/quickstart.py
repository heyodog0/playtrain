# /// script
# requires-python = ">=3.11"
# dependencies = ["playtrain @ git+https://github.com/heyodog0/playtrain"]
# ///
"""PlayTrain in one command — no clone, no install, no toolchain:

    uv run https://raw.githubusercontent.com/heyodog0/playtrain/main/examples/quickstart.py

uv reads the dependency header above, builds a throwaway environment, and runs
this. Nothing is installed into your system Python.
"""
import time

import numpy as np

from playtrain.runtime import GameEnv, NativeVecEnv, list_available_games

games = list_available_games()
print(f"{len(games)} games available: {', '.join(games[:8])} ...\n")

# 1. An ordinary Gymnasium environment.
env = GameEnv(game="breakout", obs_size=64)
print(f"observation {env.observation_space}\naction      {env.action_space}")

obs, _ = env.reset(seed=0)
total = 0.0
for _ in range(300):
    obs, reward, terminated, truncated, _ = env.step(env.action_space.sample())
    total += reward
    if terminated or truncated:
        break
print(f"random rollout: return {total:.0f}\n")
env.close()

# 2. The vectorized backend, which is the point of the runtime.
n = 64
venv = NativeVecEnv(game="breakout", num_envs=n, num_threads=4, obs_size=64)
venv.reset(0)
actions = np.zeros(n, dtype=np.int64)
for _ in range(20):                    # warmup
    venv.step(actions)

start = time.perf_counter()
steps = 300
for _ in range(steps):
    venv.step(actions)
elapsed = time.perf_counter() - start
venv.close()

print(f"{n} envs x {steps} steps in {elapsed:.2f}s = {steps * n / elapsed:,.0f} steps/s")
print("\nEvery game is editable source: see games/js/ in the repo.")
