"""Library: per-env step throughput benchmark, parameterized over backend.

Used by PlayTrain's benchmarks/bench.py and by sibling repos that want to
benchmark their own catalogs.
"""

from __future__ import annotations

import json
import statistics
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import numpy as np

EnvFactory = Callable[..., Any]


def bench_one(env_factory: EnvFactory, game: str, *,
              frames: int, warmup: int, trials: int,
              seed: int, n_actions: int) -> dict:
    print(f"  {game:<20} ", end="", flush=True)
    fps_per_trial: list[float] = []
    error: str | None = None
    try:
        for _ in range(trials):
            env = env_factory(game=game, max_steps=frames + warmup + 100)
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


def run_bench(*,
              env_factory: EnvFactory,
              games: list[str],
              n_actions: int,
              backend_label: str,
              frames: int = 500,
              warmup: int = 50,
              trials: int = 3,
              seed: int = 42,
              output_path: Path | None = None) -> int:
    """Benchmark each game; print summary; optionally save JSON. Returns 0 on success, 1 if any game errored."""
    print(f"\n=== Benchmark ({backend_label}, {len(games)} games, "
          f"{frames} frames × {trials} trials, warmup {warmup}) ===\n")
    results = [bench_one(env_factory, g, frames=frames, warmup=warmup, trials=trials,
                         seed=seed, n_actions=n_actions) for g in games]

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

    if output_path is not None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps({
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "backend": backend_label,
            "frames": frames,
            "warmup": warmup,
            "trials": trials,
            "seed": seed,
            "results": results,
        }, indent=2) + "\n")
        print(f"\nSaved to {output_path}")

    return 1 if fail else 0


__all__ = ["run_bench", "bench_one"]
