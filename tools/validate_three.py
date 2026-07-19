"""CLI: validate bundled three.js games against ProcGen-style criteria.

Usage:
    just validate-three                       # all bundled three.js games
    just validate-three-one <game>            # one game
    uv run python tools/validate_three.py --all
    uv run python tools/validate_three.py --game ball_roller --skip-throughput

NOTE: NodeGymThreeEnv quantizes obs to 7 bits/channel by default to absorb
Dawn/WebGPU rasterization jitter, so strict determinism (tolerance=0) is the
default here. Use --legacy-tolerance to allow ≤1 LSB mean diff (relevant only
if you instantiate the env with obs_quantize_bits=8).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from playtrain.runtime import NodeGymThreeEnv, list_available_threejs_games
from playtrain.runtime.validate import run_validation

OUTPUT_DIR = Path(__file__).resolve().parents[1] / "outputs" / "validation_three"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--game", type=str, help="Single game to validate")
    group.add_argument("--all", action="store_true", help="Validate all bundled three.js games")
    parser.add_argument("--skip-throughput", action="store_true", help="Skip throughput benchmark")
    parser.add_argument("--legacy-tolerance", action="store_true",
                        help="Allow ≤1 LSB mean obs diff (only needed if obs_quantize_bits=8)")
    parser.add_argument("--no-save", action="store_true", help="Don't write summary.json")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    games = [args.game] if args.game else list_available_threejs_games()
    return run_validation(
        env_factory=NodeGymThreeEnv,
        games=games,
        expected_shape=(84, 84, 3),
        n_actions=15,
        bench_frames=200,  # three.js is ~3-4× slower per step than p5
        determinism_tolerance=1.0 if args.legacy_tolerance else 0.0,
        skip_throughput=args.skip_throughput,
        output_path=None if args.no_save else OUTPUT_DIR / "summary.json",
    )


if __name__ == "__main__":
    sys.exit(main())
