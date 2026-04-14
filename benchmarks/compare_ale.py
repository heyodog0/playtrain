"""Benchmark ALE/Atari vs our headless games on the same machine.

Measures raw env step throughput (no neural network) for fair comparison.

Usage:
    uv run python benchmarks/compare_ale.py
"""

import time

import ale_py
import gymnasium
import numpy as np

gymnasium.register_envs(ale_py)


def bench_env(env, n_steps=5000, warmup=100):
    """Benchmark raw step throughput: action -> step -> observation."""
    obs, _ = env.reset(seed=42)
    action_space = env.action_space

    # Warmup
    for _ in range(warmup):
        action = action_space.sample()
        obs, rew, term, trunc, info = env.step(action)
        if term or trunc:
            obs, _ = env.reset()

    # Benchmark
    start = time.perf_counter()
    for _ in range(n_steps):
        action = action_space.sample()
        obs, rew, term, trunc, info = env.step(action)
        if term or trunc:
            obs, _ = env.reset()
    elapsed = time.perf_counter() - start

    fps = n_steps / elapsed
    return fps, obs.shape, elapsed


def main():
    n_steps = 5000

    print("=" * 65)
    print("Environment Throughput Comparison — Raw Step FPS (no neural net)")
    print("=" * 65)
    print()

    # --- ALE/Atari ---
    ale_games = [
        ("ALE/Breakout-v5", {}),
        ("ALE/SpaceInvaders-v5", {}),
        ("ALE/Freeway-v5", {}),
        ("ALE/Frostbite-v5", {}),
        ("ALE/Asteroids-v5", {}),
    ]

    print("ALE/Atari (210x160 RGB, Discrete actions)")
    print("-" * 65)
    ale_fps_list = []
    for name, kwargs in ale_games:
        env = gymnasium.make(name, **kwargs)
        fps, shape, elapsed = bench_env(env, n_steps)
        env.close()
        ale_fps_list.append(fps)
        print(f"  {name:<30s}  {fps:>8,.0f} FPS  obs={shape}")

    ale_mean = np.mean(ale_fps_list)
    print(f"  {'Mean':<30s}  {ale_mean:>8,.0f} FPS")
    print()

    # --- ALE with 64x64 resize (closer to our setup) ---
    print("ALE/Atari + ResizeObservation(64,64) + Grayscale")
    print("-" * 65)
    ale_resized_fps = []
    for name, kwargs in ale_games:
        env = gymnasium.make(name, **kwargs)
        env = gymnasium.wrappers.GrayscaleObservation(env)
        env = gymnasium.wrappers.ResizeObservation(env, shape=(64, 64))
        fps, shape, elapsed = bench_env(env, n_steps)
        env.close()
        ale_resized_fps.append(fps)
        print(f"  {name:<30s}  {fps:>8,.0f} FPS  obs={shape}")

    ale_resized_mean = np.mean(ale_resized_fps)
    print(f"  {'Mean':<30s}  {ale_resized_mean:>8,.0f} FPS")
    print()

    # --- Our headless games ---
    from fast_games import GameGymEnv, list_available_games

    our_games = list_available_games()
    print(f"Headless Node games (64x64 RGB, Discrete(8)) — {len(our_games)} games")
    print("-" * 65)
    our_fps_list = []
    for name in our_games:
        env = GameGymEnv(game=name)
        fps, shape, elapsed = bench_env(env, n_steps)
        env.close()
        our_fps_list.append(fps)
        print(f"  {name:<30s}  {fps:>8,.0f} FPS  obs={shape}")

    our_mean = np.mean(our_fps_list)
    print(f"  {'Mean':<30s}  {our_mean:>8,.0f} FPS")
    print()

    # --- Summary ---
    print("=" * 65)
    print("Summary")
    print("=" * 65)
    print(f"  ALE/Atari (native 210x160):     {ale_mean:>8,.0f} FPS")
    print(f"  ALE/Atari (resized 64x64 gray): {ale_resized_mean:>8,.0f} FPS")
    print(f"  Headless Node (64x64 RGB):      {our_mean:>8,.0f} FPS")
    print()
    print(f"  Headless vs ALE native:         {our_mean/ale_mean:.1f}x")
    print(f"  Headless vs ALE resized:        {our_mean/ale_resized_mean:.1f}x")
    print()
    print("Note: ProcGen cannot be installed on Python 3.12 / Apple Silicon.")
    print("Published ProcGen numbers (Intel, 2020): 2,000-5,000 FPS.")


if __name__ == "__main__":
    main()
