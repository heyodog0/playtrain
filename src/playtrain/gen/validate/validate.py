"""CLI: validate this repo's p5 games against ProcGen-style criteria.

Thin wrapper over playtrain.runtime.validate.run_validation, pinned to this repo's
games/js/ directory via playtrain.runtime.PlayTrainEnv.

Usage:
    uv run gym-gen-validate --all
    uv run gym-gen-validate --game breakout
"""

from __future__ import annotations

import argparse
import sys
from functools import partial
from pathlib import Path

from playtrain.runtime import PlayTrainEnv, list_available_games
from playtrain.runtime.action_space import load_action_space
from playtrain.runtime.validate import run_validation

from playtrain.gen.constants import variant_names


GAMES_DIR = Path(__file__).resolve().parents[4] / "games" / "js"
OUTPUT_DIR = Path(__file__).resolve().parents[4] / "outputs" / "validation"


def _env_factory(*, game: str, **kwargs):
    kwargs.setdefault("games_dir", GAMES_DIR)
    return PlayTrainEnv(game=game, **kwargs)


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
    if args.game:
        games = [args.game]
    else:
        variants = variant_names()
        games = [g for g in list_available_games(GAMES_DIR) if g not in variants]
    return run_validation(
        env_factory=_env_factory,
        games=games,
        expected_shape=(64, 64, 3),
        n_actions=len(load_action_space()),
        determinism_tolerance=0.0,
        skip_throughput=args.skip_throughput,
        output_path=None if args.no_save else OUTPUT_DIR / "summary.json",
    )


if __name__ == "__main__":
    sys.exit(main())
