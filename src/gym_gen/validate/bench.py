"""CLI: benchmark step throughput on this repo's games (p5 + three.js).

Thin wrapper over node_gym.bench.run_bench.

Usage:
    uv run gym-gen-bench --backend p5 --all
    uv run gym-gen-bench --backend three --all
    uv run gym-gen-bench --backend p5 --game breakout
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from node_gym import (
    NodeGymEnv,
    NodeGymThreeEnv,
    list_available_games,
    list_available_threejs_games,
)
from node_gym.bench import run_bench

from gym_gen.constants import variant_names


GAMES_DIR         = Path(__file__).resolve().parents[3] / "games" / "js"
THREEJS_GAMES_DIR = Path(__file__).resolve().parents[3] / "games" / "threejs"
OUTPUT_DIR        = Path(__file__).resolve().parents[3] / "outputs" / "bench"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Benchmark game env throughput")
    parser.add_argument("--backend", choices=["p5", "three"], default="p5")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--game", type=str)
    group.add_argument("--all", action="store_true")
    parser.add_argument("--frames", type=int, default=None,
                        help="Frames per trial (default 500 for p5, 200 for three)")
    parser.add_argument("--warmup", type=int, default=50)
    parser.add_argument("--trials", type=int, default=3)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--no-save", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.backend == "p5":
        games_dir = GAMES_DIR
        def env_factory(*, game, **kwargs):
            kwargs.setdefault("games_dir", games_dir)
            return NodeGymEnv(game=game, **kwargs)
        games = [args.game] if args.game else [
            g for g in list_available_games(games_dir) if g not in variant_names()
        ]
        n_actions = 8
        frames = args.frames if args.frames is not None else 500
    else:
        games_dir = THREEJS_GAMES_DIR
        def env_factory(*, game, **kwargs):
            kwargs.setdefault("games_dir", games_dir)
            return NodeGymThreeEnv(game=game, **kwargs)
        games = [args.game] if args.game else list_available_threejs_games(games_dir)
        n_actions = 15
        frames = args.frames if args.frames is not None else 200

    return run_bench(
        env_factory=env_factory,
        games=games,
        n_actions=n_actions,
        backend_label=args.backend,
        frames=frames,
        warmup=args.warmup,
        trials=args.trials,
        seed=args.seed,
        output_path=None if args.no_save else OUTPUT_DIR / f"{args.backend}.json",
    )


if __name__ == "__main__":
    sys.exit(main())
