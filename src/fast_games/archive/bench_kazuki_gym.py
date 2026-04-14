from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

from .kazuki_gym_env import KazukiGymEnv


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Benchmark the Python KazukiGymEnv wrapper")
    parser.add_argument("--frames", type=int, default=1000)
    parser.add_argument("--output", type=Path, default=Path("outputs/kazuki_gym_benchmark_latest.json"))
    parser.add_argument(
        "--playwright-benchmark",
        type=Path,
        default=Path("outputs/kazuki-benchmark-latest.json"),
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)

    env = KazukiGymEnv()
    obs, info = env.reset(seed=123)

    start = time.perf_counter()
    checksum = 0
    for i in range(args.frames):
        action = 2 if i % 60 < 30 else 1
        obs, reward, terminated, truncated, info = env.step(action)
        checksum += int(obs[0, 0, 0]) + int(obs[-1, -1, -1]) + int(reward) + int(info["score"])
        if terminated or truncated:
            obs, info = env.reset(seed=123 + i + 1)
    elapsed_ms = (time.perf_counter() - start) * 1000.0
    fps = args.frames / (elapsed_ms / 1000.0)
    env.close()

    result = {
        "frames": args.frames,
        "elapsed_ms": elapsed_ms,
        "fps": fps,
        "checksum": checksum,
    }

    if args.playwright_benchmark.exists():
        playwright = json.loads(args.playwright_benchmark.read_text())
        result["comparison"] = {
            "vs_playwright_getimagedata": fps / playwright["browser"]["canvasReadback"]["fps"],
            "vs_playwright_screenshot": fps / playwright["browser"]["screenshotReadback"]["fps"],
            "vs_node_headless_rl_step": fps / playwright["headless"]["rlStep"]["fps"],
        }

    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
