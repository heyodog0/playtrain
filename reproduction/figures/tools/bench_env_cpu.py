"""CPU-partition env throughput probe — training-faithful NativeVecEnv sweep.

Prices the "envs on cheap CPU-partition cores" leg of the decoupled
(hetjob / SEED-style) IMPALA layout: steps ONE NativeVecEnv (QuickJS +
native rasterizer C++ threadpool) with random actions at the production
env config (frame_skip=7 + render_skip, autoreset, obs 64, production
episode horizon), sweeping the threadpool size. No GPU, no learner, no
inference — pure env-side ceiling, in DECISIONS/s (the trainer's frames/s
unit at frame_skip>1).

Numbers to compare against: the ~3k decisions/s/core implied on the
kempner_h100 GPU-node CPUs (68k per 23-core slice, commit 16187d0), and
sapphire's TRES billing weight of 0.6/core-hour vs the H100's 2648.8.

    uv run python tools/bench_env_cpu.py --game games/js/analogen_cqhex2.js \
        --threads 12,23,46,92,110 --out outputs/bench_env_cpu.json
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np

from playtrain.runtime.native_vec_env import NativeVecEnv


def bench_one(game: str, threads: int, num_envs: int, frame_skip: int,
              render_skip: bool, obs: int, max_steps: int, seconds: float,
              num_actions: int = 8, seed: int = 0) -> dict:
    env = NativeVecEnv(game, num_envs=num_envs, obs_size=obs,
                       max_steps=max_steps, num_threads=threads,
                       autoreset=True, frame_skip=frame_skip,
                       render_skip=render_skip)
    rng = np.random.default_rng(seed)
    env.reset(seeds=(seed + np.arange(num_envs)).astype(np.int32))
    # Pre-generated action batches: the bench must not measure RNG cost.
    acts = rng.integers(0, num_actions, size=(64, num_envs), dtype=np.int32)

    for i in range(20):  # warmup (JIT-free backend, but warms caches/pages)
        env.step(acts[i % 64])
    t0 = time.perf_counter()
    steps = 0
    while time.perf_counter() - t0 < seconds:
        env.step(acts[steps % 64])
        steps += 1
    dt = time.perf_counter() - t0
    env.close()
    rate = steps * num_envs / dt
    return {
        "threads": threads, "num_envs": num_envs,
        "decisions_per_s": round(rate),
        "per_core": round(rate / threads),
        "game_frames_per_s": round(rate * frame_skip),
    }


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--game", required=True)
    p.add_argument("--threads", default="12,23,46,92,110")
    p.add_argument("--envs-per-thread", type=int, default=8)
    p.add_argument("--max-envs", type=int, default=1024)
    p.add_argument("--frame-skip", type=int, default=7)
    p.add_argument("--render-skip", action="store_true", default=True)
    p.add_argument("--obs", type=int, default=64)
    # Production horizon: max_decisions=5000 * frame_skip=7 (cqhex2 configs).
    p.add_argument("--max-steps", type=int, default=35000)
    p.add_argument("--seconds", type=float, default=15.0)
    p.add_argument("--out", type=Path, default=None)
    args = p.parse_args()

    rows = []
    for t_str in args.threads.split(","):
        t = int(t_str)
        n = min(args.envs_per_thread * t, args.max_envs)
        try:
            r = bench_one(args.game, t, n, args.frame_skip, args.render_skip,
                          args.obs, args.max_steps, args.seconds)
        except Exception as e:  # noqa: BLE001
            r = {"threads": t, "num_envs": n, "error": repr(e)[:200]}
        rows.append(r)
        print(r, flush=True)

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(
            {"game": args.game, "frame_skip": args.frame_skip,
             "render_skip": args.render_skip, "obs": args.obs,
             "max_steps": args.max_steps, "rows": rows}, indent=2))
        print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
