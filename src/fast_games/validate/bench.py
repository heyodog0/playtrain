"""Benchmark step throughput for all games.

Usage:
    uv run python -m fast_games.validate.bench --all
    uv run python -m fast_games.validate.bench --game breakout
"""

from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path

from fast_games.env import GameGymEnv

GAMES_DIR = Path(__file__).resolve().parents[3] / "games" / "js"
OUTPUT_DIR = Path(__file__).resolve().parents[3] / "outputs" / "benchmarks"


def list_games() -> list[str]:
    return sorted(p.stem for p in GAMES_DIR.glob("*.js"))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Benchmark game environment throughput")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--game", type=str)
    group.add_argument("--all", action="store_true")
    parser.add_argument("--frames", type=int, default=1000)
    parser.add_argument("--warmup", type=int, default=50)
    return parser.parse_args()


def bench_game(game: str, frames: int, warmup: int) -> dict:
    env = GameGymEnv(game=game, max_steps=frames + warmup + 100)
    env.reset(seed=123)

    # Warmup
    for i in range(warmup):
        _, _, term, trunc, _ = env.step(i % 8)
        if term or trunc:
            env.reset(seed=123 + i)

    # Timed run
    checksum = 0
    start = time.perf_counter()
    for i in range(frames):
        obs, reward, term, trunc, info = env.step(i % 8)
        checksum += int(obs[0, 0, 0]) + int(obs[-1, -1, -1]) + int(reward) + int(info["score"])
        if term or trunc:
            env.reset(seed=123 + warmup + i)
    elapsed = time.perf_counter() - start
    env.close()

    fps = frames / elapsed
    ms_per_step = (elapsed / frames) * 1000
    return {
        "game": game,
        "frames": frames,
        "elapsed_ms": elapsed * 1000,
        "fps": round(fps, 1),
        "ms_per_step": round(ms_per_step, 3),
        "checksum": checksum,
    }


def main() -> None:
    args = parse_args()
    games = [args.game] if args.game else list_games()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    results = []
    print(f"{'Game':<20} {'FPS':>8} {'ms/step':>10}")
    print("-" * 40)

    for game in games:
        try:
            r = bench_game(game, args.frames, args.warmup)
            results.append(r)
            print(f"{game:<20} {r['fps']:>8.0f} {r['ms_per_step']:>10.3f}")
        except Exception as exc:
            print(f"{game:<20} {'ERROR':>8}  {str(exc)[:50]}")
            results.append({"game": game, "error": str(exc)[:200]})

    # Summary
    fps_values = [r["fps"] for r in results if "fps" in r]
    if fps_values:
        print("-" * 40)
        print(f"{'Mean':<20} {sum(fps_values)/len(fps_values):>8.0f}")
        print(f"{'Min':<20} {min(fps_values):>8.0f}")
        print(f"{'Max':<20} {max(fps_values):>8.0f}")

    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "frames_per_game": args.frames,
        "results": results,
    }
    out_path = OUTPUT_DIR / "per_game_fps.json"
    out_path.write_text(json.dumps(output, indent=2) + "\n")
    print(f"\nSaved to {out_path}")


if __name__ == "__main__":
    main()
