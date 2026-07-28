"""CLI: benchmark step throughput on bundled p5 games.

Usage:
    just bench                # all p5 games
    just bench-one <game>     # one p5 game
    uv run python benchmarks/bench.py --all
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from playtrain.runtime import PlayTrainEnv, list_available_games
from playtrain.runtime.bench import run_bench

OUTPUT_DIR = Path(__file__).resolve().parents[1] / "outputs" / "bench"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--game", type=str, help="Single game to benchmark")
    group.add_argument("--all", action="store_true", help="Benchmark all bundled games")
    parser.add_argument("--frames", type=int, default=500, help="Frames per trial")
    parser.add_argument("--warmup", type=int, default=50)
    parser.add_argument("--trials", type=int, default=3)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--no-save", action="store_true", help="Don't write outputs/bench/*.json")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    games = [args.game] if args.game else list_available_games()
    return run_bench(
        env_factory=PlayTrainEnv,
        games=games,
        n_actions=8,
        backend_label="p5",
        frames=args.frames,
        warmup=args.warmup,
        trials=args.trials,
        seed=args.seed,
        output_path=None if args.no_save else OUTPUT_DIR / "p5.json",
    )


if __name__ == "__main__":
    sys.exit(main())
