"""CLI: validate this repo's three.js games against ProcGen-style criteria.

Thin wrapper over node_gym.validate.run_validation, pinned to this repo's
games/threejs/ directory via fast_games.env.ThreeGameGymEnv.

Usage:
    uv run fast-games-validate-three --all
    uv run fast-games-validate-three --game ball_roller
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from node_gym.validate import run_validation

from fast_games.env import ThreeGameGymEnv, list_available_threejs_games

OUTPUT_DIR = Path(__file__).resolve().parents[3] / "outputs" / "validation_three"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate three.js games against ProcGen-style criteria")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--game", type=str, help="Single game to validate")
    group.add_argument("--all", action="store_true", help="Validate all three.js games")
    parser.add_argument("--skip-throughput", action="store_true", help="Skip throughput benchmark")
    parser.add_argument("--legacy-tolerance", action="store_true",
                        help="Allow ≤1 LSB mean obs diff (only needed if obs_quantize_bits=8)")
    parser.add_argument("--no-save", action="store_true", help="Don't write summary.json")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    games = [args.game] if args.game else list_available_threejs_games()
    return run_validation(
        env_factory=ThreeGameGymEnv,
        games=games,
        expected_shape=(84, 84, 3),
        n_actions=15,
        bench_frames=200,
        determinism_tolerance=1.0 if args.legacy_tolerance else 0.0,
        skip_throughput=args.skip_throughput,
        output_path=None if args.no_save else OUTPUT_DIR / "summary.json",
    )


if __name__ == "__main__":
    sys.exit(main())
