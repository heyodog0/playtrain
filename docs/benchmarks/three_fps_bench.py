"""Throughput benchmark for Three.js (v2) games via PlayTrainThreeEnv.

Replaces the older docs/benchmarks/three-fps-bench{,-single}.mjs which
duplicated PlayTrain's Three.js runtime. This goes through the canonical
Python env, so the FPS measured here is what Python+IPC actually delivers
(the relevant number for SB3 PPO etc.).

Usage:
  uv run python docs/benchmarks/three_fps_bench.py                # all games
  uv run python docs/benchmarks/three_fps_bench.py --game crossy_road_3d
  uv run python docs/benchmarks/three_fps_bench.py --frames 1000
  uv run python docs/benchmarks/three_fps_bench.py --obs-size 64
"""

from __future__ import annotations

import argparse
import platform
import time

from fast_games.env import ThreeGameGymEnv, list_available_threejs_games


def bench_one(game: str, frames: int, warmup: int, obs_size: int) -> dict:
    env = ThreeGameGymEnv(game=game, obs_size=obs_size, max_steps=frames + warmup + 100)
    try:
        obs, _ = env.reset(seed=42)
        for i in range(warmup):
            obs, *_ = env.step(i % 15)
        t0 = time.perf_counter()
        n = 0
        for i in range(frames):
            obs, r, term, trunc, info = env.step((i + 7) % 15)
            n += 1
            if term or trunc:
                env.reset(seed=42 + i)
        elapsed = time.perf_counter() - t0
        return {"name": game, "frames": n, "rl_fps": round(n / elapsed),
                "rl_ms": round(elapsed / n * 1000, 3)}
    finally:
        env.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--game", default=None)
    parser.add_argument("--frames", type=int, default=300)
    parser.add_argument("--warmup", type=int, default=30)
    parser.add_argument("--obs-size", type=int, default=64)
    args = parser.parse_args()

    games = [args.game] if args.game else list_available_threejs_games()
    print(f"\nThree.js v2 throughput bench (via PlayTrainThreeEnv)")
    print(f"  {len(games)} games × {args.frames} frames each ({args.warmup} warmup), obs {args.obs_size}×{args.obs_size}")
    print(f"  System: {platform.system()} {platform.machine()}, Python {platform.python_version()}\n")

    results = []
    for g in games:
        print(f"  {g:<24} ... ", end="", flush=True)
        try:
            r = bench_one(g, args.frames, args.warmup, args.obs_size)
            results.append(r)
            print(f"rl={r['rl_fps']:>5} FPS  ({r['rl_ms']:>5.2f} ms/step)")
        except Exception as e:
            results.append({"name": g, "error": str(e)[:120]})
            print(f"FAIL: {e!s:.80}")

    valid = [r for r in results if "error" not in r]
    if valid:
        avg = sum(r["rl_fps"] for r in valid) // len(valid)
        srt = sorted(r["rl_fps"] for r in valid)
        med = srt[len(srt) // 2]
        print(f"\n  passed: {len(valid)}/{len(results)}")
        print(f"  median: {med} RL FPS  |  avg: {avg} RL FPS")


if __name__ == "__main__":
    main()
