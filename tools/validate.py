"""CLI: validate bundled p5 games against ProcGen-style criteria.

Usage:
    just validate                       # all bundled games
    just validate-one <game>            # one game
    uv run python tools/validate.py --all
    uv run python tools/validate.py --game flappy_bird --skip-throughput
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from playtrain.runtime import PlayTrainEnv, list_available_games
from playtrain.runtime.validate import run_validation

OUTPUT_DIR = Path(__file__).resolve().parents[1] / "outputs" / "validation"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--game", type=str, help="Single game to validate")
    group.add_argument("--all", action="store_true", help="Validate all bundled games")
    parser.add_argument("--skip-throughput", action="store_true", help="Skip throughput benchmark")
    parser.add_argument("--no-save", action="store_true", help="Don't write summary.json")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    games = [args.game] if args.game else list_available_games()
    return run_validation(
        env_factory=PlayTrainEnv,
        games=games,
        expected_shape=(64, 64, 3),
        n_actions=8,
        determinism_tolerance=0.0,
        skip_throughput=args.skip_throughput,
        output_path=None if args.no_save else OUTPUT_DIR / "summary.json",
    )


if __name__ == "__main__":
    sys.exit(main())
