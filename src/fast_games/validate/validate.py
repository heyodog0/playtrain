"""CLI: validate this repo's p5 games against ProcGen-style criteria.

Thin wrapper over node_gym.validate.run_validation, pinned to this repo's
games/js/ directory via fast_games.env.GameGymEnv.

Usage:
    uv run fast-games-validate --all
    uv run fast-games-validate --game breakout
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from node_gym.validate import run_validation

from fast_games.env import GameGymEnv, list_available_games

OUTPUT_DIR = Path(__file__).resolve().parents[3] / "outputs" / "validation"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate p5 games against ProcGen-style criteria")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--game", type=str, help="Single game to validate")
    group.add_argument("--all", action="store_true", help="Validate all games")
    parser.add_argument("--skip-throughput", action="store_true", help="Skip throughput benchmark")
    parser.add_argument("--no-save", action="store_true", help="Don't write summary.json")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    games = [args.game] if args.game else list_available_games()
    return run_validation(
        env_factory=GameGymEnv,
        games=games,
        expected_shape=(64, 64, 3),
        n_actions=8,
        determinism_tolerance=0.0,
        skip_throughput=args.skip_throughput,
        output_path=None if args.no_save else OUTPUT_DIR / "summary.json",
    )


if __name__ == "__main__":
    sys.exit(main())
