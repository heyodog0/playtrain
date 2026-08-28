"""CLI: benchmark step throughput on this repo's p5.js games.

Thin wrapper over playtrain.runtime.bench.run_bench.

Usage:
    uv run gym-gen-bench --all
    uv run gym-gen-bench --game breakout
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from playtrain.runtime import PlayTrainEnv, list_available_games
from playtrain.runtime.action_space import load_action_space
from playtrain.runtime.bench import run_bench

from playtrain.gen.constants import variant_names


GAMES_DIR  = Path(__file__).resolve().parents[4] / "games" / "js"
OUTPUT_DIR = Path(__file__).resolve().parents[4] / "outputs" / "bench"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Benchmark p5 game env throughput")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--game", type=str)
    group.add_argument("--all", action="store_true")
    parser.add_argument("--frames", type=int, default=500,
                        help="Frames per trial")
    parser.add_argument("--warmup", type=int, default=50)
    parser.add_argument("--trials", type=int, default=3)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--no-save", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    def env_factory(*, game, **kwargs):
        kwargs.setdefault("games_dir", GAMES_DIR)
        return PlayTrainEnv(game=game, **kwargs)

    games = [args.game] if args.game else [
        g for g in list_available_games(GAMES_DIR) if g not in variant_names()
    ]

    return run_bench(
        env_factory=env_factory,
        games=games,
        n_actions=len(load_action_space()),
        backend_label="p5",
        frames=args.frames,
        warmup=args.warmup,
        trials=args.trials,
        seed=args.seed,
        output_path=None if args.no_save else OUTPUT_DIR / "p5.json",
    )


if __name__ == "__main__":
    sys.exit(main())
