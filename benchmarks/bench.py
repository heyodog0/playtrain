"""CLI: benchmark step throughput on bundled p5 games.

Defaults to the QuickJS + native-rasterizer backend — the canonical training
engine and the one every reported number is measured on. ``--backend node``
selects the portable Node.js/node-canvas fallback, which is 3-4x slower and is
NOT what the paper measures; it is kept for machines with no native build.

Usage:
    just bench                # all p5 games, QuickJS
    just bench-one <game>     # one p5 game
    uv run python benchmarks/bench.py --all
    uv run python benchmarks/bench.py --all --backend node   # legacy fallback
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from playtrain.runtime import GameEnv, PlayTrainEnv, list_available_games
from playtrain.runtime.bench import run_bench

OUTPUT_DIR = Path(__file__).resolve().parents[1] / "outputs" / "bench"

BACKENDS = {
    # name: (env factory, label written into the JSON + header)
    "qjs": (GameEnv, "quickjs+native-rasterizer"),
    "node": (PlayTrainEnv, "node+canvas (legacy fallback)"),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--game", type=str, help="Single game to benchmark")
    group.add_argument("--all", action="store_true", help="Benchmark all bundled games")
    parser.add_argument("--backend", choices=sorted(BACKENDS), default="qjs",
                        help="qjs = QuickJS + native rasterizer (default, canonical); "
                             "node = Node.js/node-canvas fallback")
    parser.add_argument("--frames", type=int, default=500, help="Frames per trial")
    parser.add_argument("--warmup", type=int, default=50)
    parser.add_argument("--trials", type=int, default=3)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--no-save", action="store_true", help="Don't write outputs/bench/*.json")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    games = [args.game] if args.game else list_available_games()
    factory, label = BACKENDS[args.backend]
    return run_bench(
        env_factory=factory,
        games=games,
        n_actions=8,
        backend_label=label,
        frames=args.frames,
        warmup=args.warmup,
        trials=args.trials,
        seed=args.seed,
        output_path=None if args.no_save else OUTPUT_DIR / f"{args.backend}.json",
    )


if __name__ == "__main__":
    sys.exit(main())
