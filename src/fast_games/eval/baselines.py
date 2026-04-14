"""Collect random agent baseline scores for all games.

These baselines are used for score normalization (ProcGen-style).

Usage:
    uv run python -m fast_games.eval.baselines --all
    uv run python -m fast_games.eval.baselines --game breakout
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from fast_games.env import GameGymEnv

GAMES_DIR = Path(__file__).resolve().parents[3] / "games" / "js"
OUTPUT_DIR = Path(__file__).resolve().parents[3] / "outputs" / "baselines"


def list_games() -> list[str]:
    return sorted(p.stem for p in GAMES_DIR.glob("*.js"))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect random agent baselines")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--game", type=str)
    group.add_argument("--all", action="store_true")
    parser.add_argument("--episodes", type=int, default=100)
    parser.add_argument("--max-steps", type=int, default=2000)
    return parser.parse_args()


def collect_random_baseline(game: str, episodes: int, max_steps: int) -> dict:
    returns = []
    lengths = []

    for ep in range(episodes):
        env = GameGymEnv(game=game, max_steps=max_steps)
        try:
            _, info = env.reset(seed=ep)
            episode_return = 0.0
            steps = 0
            rng = np.random.default_rng(ep + 10000)

            while True:
                action = int(rng.integers(0, 8))
                _, reward, terminated, truncated, info = env.step(action)
                episode_return += reward
                steps += 1
                if terminated or truncated:
                    break

            returns.append(episode_return)
            lengths.append(steps)
        finally:
            env.close()

    returns_arr = np.array(returns)
    lengths_arr = np.array(lengths)

    return {
        "game": game,
        "episodes": episodes,
        "max_steps": max_steps,
        "mean_return": float(returns_arr.mean()),
        "std_return": float(returns_arr.std()),
        "min_return": float(returns_arr.min()),
        "max_return": float(returns_arr.max()),
        "median_return": float(np.median(returns_arr)),
        "mean_length": float(lengths_arr.mean()),
        "std_length": float(lengths_arr.std()),
    }


def main() -> None:
    args = parse_args()
    games = [args.game] if args.game else list_games()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    all_baselines: dict[str, dict] = {}

    print(f"{'Game':<20} {'Mean':>8} {'Std':>8} {'Min':>8} {'Max':>8} {'EpLen':>8}")
    print("-" * 60)

    for game in games:
        try:
            bl = collect_random_baseline(game, args.episodes, args.max_steps)
            all_baselines[game] = bl
            print(
                f"{game:<20} {bl['mean_return']:>8.1f} {bl['std_return']:>8.1f} "
                f"{bl['min_return']:>8.1f} {bl['max_return']:>8.1f} {bl['mean_length']:>8.0f}"
            )
        except Exception as exc:
            print(f"{game:<20} ERROR: {str(exc)[:50]}")
            all_baselines[game] = {"game": game, "error": str(exc)[:200]}

    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "episodes_per_game": args.episodes,
        "max_steps": args.max_steps,
        "baselines": all_baselines,
    }

    out_path = OUTPUT_DIR / "random_agent_scores.json"
    out_path.write_text(json.dumps(output, indent=2) + "\n")
    print(f"\nSaved to {out_path}")


if __name__ == "__main__":
    main()
