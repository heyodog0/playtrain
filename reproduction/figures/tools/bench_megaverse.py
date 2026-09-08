"""Megaverse env throughput probe (their MegaverseEnv, Vulkan rendering).

Sweeps (num_envs, agents_per_env, sim_threads) on one GPU and reports
obs/s (their paper's unit: agent-observations per second, pre-frameskip).
Their published: 1.15M obs/s sampling on an 8-GPU node (2021).
"""
import sys, time
import numpy as np
from megaverse.megaverse_env import MegaverseEnv

def bench(num_envs, agents, threads, n_steps=2000, scenario="ObstaclesEasy"):
    env = MegaverseEnv(scenario, num_envs=num_envs, num_agents_per_env=agents,
                       num_simulation_threads=threads, use_vulkan=True, params={})
    env.seed(42)
    env.reset()
    actions = [env.action_space.sample() for _ in range(env.num_agents)]
    for _ in range(50):
        env.step(actions)
    t0 = time.time()
    for _ in range(n_steps):
        obs, rew, dones, infos = env.step(actions)
    dt = time.time() - t0
    fps = env.num_agents * n_steps / dt
    print(f"num_envs={num_envs} agents={agents} threads={threads}: "
          f"{fps:,.0f} obs/s ({dt:.1f}s)", flush=True)
    env.close()
    return fps

best = 0
for cfg in [(16, 1, 8), (32, 2, 16), (64, 2, 16), (64, 4, 22), (128, 2, 22)]:
    try:
        best = max(best, bench(*cfg))
    except Exception as e:
        print(f"cfg {cfg} FAILED: {type(e).__name__}: {e}", flush=True)
print(f"BEST: {best:,.0f} obs/s (1 GPU)")
