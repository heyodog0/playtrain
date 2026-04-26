"""CLI: benchmark step throughput on bundled games.

Usage:
    just bench                          # all p5 games
    just bench-three                    # all three.js games
    just bench-one <game>               # one p5 game
    just bench-three-one <game>         # one three.js game
    uv run python tools/bench.py --backend p5    --all
    uv run python tools/bench.py --backend three --all --frames 200 --trials 3
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from node_gym.bench import run_bench

OUTPUT_DIR = Path(__file__).resolve().parents[1] / "outputs" / "bench"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--backend", choices=["p5", "three"], required=True)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--game", type=str, help="Single game to benchmark")
    group.add_argument("--all", action="store_true", help="Benchmark all bundled games")
    parser.add_argument("--frames", type=int, default=None,
                        help="Frames per trial (default 500 for p5, 200 for three)")
    parser.add_argument("--warmup", type=int, default=50)
    parser.add_argument("--trials", type=int, default=3)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--no-save", action="store_true", help="Don't write outputs/bench/*.json")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.backend == "p5":
        from node_gym import NodeGymEnv, list_available_games
        env_factory = NodeGymEnv
        games = [args.game] if args.game else list_available_games()
        n_actions = 8
        frames = args.frames if args.frames is not None else 500
    else:
        from node_gym import NodeGymThreeEnv, list_available_threejs_games
        env_factory = NodeGymThreeEnv
        games = [args.game] if args.game else list_available_threejs_games()
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
