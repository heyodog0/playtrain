"""Benchmark step throughput (FPS) on bundled games.

Usage:
    just bench                          # all p5 games
    just bench-three                    # all three.js games
    just bench-one <game>               # one p5 game
    just bench-three-one <game>         # one three.js game
    uv run python tools/bench.py --backend p5    --all
    uv run python tools/bench.py --backend three --all --frames 200 --trials 3

Reports per-game FPS (mean ± std across trials, after warmup), plus mean.
Writes outputs/bench/{p5,three}.json with the raw numbers.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

OUTPUT_DIR = Path(__file__).resolve().parents[1] / "outputs" / "bench"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--backend", choices=["p5", "three"], required=True,
                        help="Which env backend to benchmark")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--game", type=str, help="Single game to benchmark")
    group.add_argument("--all", action="store_true", help="Benchmark all bundled games")
    parser.add_argument("--frames", type=int, default=500,
                        help="Frames per trial (default 500 for p5, override 200 for three)")
    parser.add_argument("--warmup", type=int, default=50, help="Warmup frames (default 50)")
    parser.add_argument("--trials", type=int, default=3, help="Trials per game (default 3)")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--no-save", action="store_true", help="Don't write outputs/bench/*.json")
    return parser.parse_args()


def make_env(backend: str, game: str, max_steps: int):
    if backend == "p5":
        from node_gym import NodeGymEnv
        return NodeGymEnv(game=game, max_steps=max_steps), 8
    from node_gym import NodeGymThreeEnv
    return NodeGymThreeEnv(game=game, max_steps=max_steps), 15


def list_games(backend: str) -> list[str]:
    if backend == "p5":
        from node_gym import list_available_games
        return list_available_games()
    from node_gym import list_available_threejs_games
    return list_available_threejs_games()


def bench_one(backend: str, game: str, frames: int, warmup: int, trials: int, seed: int) -> dict:
    print(f"  {game:<20} ", end="", flush=True)
    fps_per_trial: list[float] = []
    error: str | None = None
    try:
        for _ in range(trials):
            env, n_actions = make_env(backend, game, max_steps=frames + warmup + 100)
            try:
                env.reset(seed=seed)
                rng = np.random.default_rng(seed)
                for _ in range(warmup):
                    _, _, term, trunc, _ = env.step(int(rng.integers(0, n_actions)))
                    if term or trunc:
                        env.reset(seed=seed)
                start = time.perf_counter()
                steps = 0
                for _ in range(frames):
                    _, _, term, trunc, _ = env.step(int(rng.integers(0, n_actions)))
                    steps += 1
                    if term or trunc:
                        env.reset(seed=seed)
                elapsed = time.perf_counter() - start
                fps_per_trial.append(steps / elapsed)
            finally:
                env.close()
    except Exception as exc:
        error = str(exc)[:120]
        print(f"ERROR -- {error}")
        return {"game": game, "error": error, "fps_trials": fps_per_trial}

    mean = statistics.fmean(fps_per_trial)
    std = statistics.pstdev(fps_per_trial) if len(fps_per_trial) > 1 else 0.0
    ms = 1000.0 / mean
    print(f"{mean:7.0f} ± {std:5.0f} FPS   ({ms:5.2f} ms/step)")
    return {"game": game, "fps_mean": mean, "fps_std": std, "ms_step": ms, "fps_trials": fps_per_trial}


def main() -> int:
    args = parse_args()
    games = [args.game] if args.game else list_games(args.backend)

    # default frame count per backend if not overridden
    frames = args.frames
    if args.frames == 500 and args.backend == "three":
        frames = 200  # three.js is ~3-4x slower per step

    print(f"\n=== Benchmark ({args.backend}, {len(games)} games, {frames} frames × {args.trials} trials, warmup {args.warmup}) ===\n")
    results = [bench_one(args.backend, g, frames, args.warmup, args.trials, args.seed) for g in games]

    ok = [r for r in results if "fps_mean" in r]
    fail = [r for r in results if "error" in r]

    if ok:
        agg_mean = statistics.fmean(r["fps_mean"] for r in ok)
        agg_min = min(ok, key=lambda r: r["fps_mean"])
        agg_max = max(ok, key=lambda r: r["fps_mean"])
        print(f"\n  {'mean':<20} {agg_mean:7.0f} FPS")
        print(f"  {'fastest':<20} {agg_max['fps_mean']:7.0f} FPS  ({agg_max['game']})")
        print(f"  {'slowest':<20} {agg_min['fps_mean']:7.0f} FPS  ({agg_min['game']})")
    if fail:
        print(f"\n  {len(fail)} games failed to bench:")
        for r in fail:
            print(f"    {r['game']}: {r['error']}")

    if not args.no_save:
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        out = OUTPUT_DIR / f"{args.backend}.json"
        out.write_text(json.dumps({
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "backend": args.backend,
            "frames": frames,
            "warmup": args.warmup,
            "trials": args.trials,
            "seed": args.seed,
            "results": results,
        }, indent=2) + "\n")
        print(f"\nSaved to {out}")

    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main())
