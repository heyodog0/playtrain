"""Count p5 draw calls per frame, per game, and test the cost model with them.

Panel C of the env-cost figure previously read operation counts BACKWARDS out of
the timing they were meant to explain, which makes it an illustration rather than
a test. This counts calls directly (vec_set_count_draws in qjs_vec_host.cpp), so
a game's count and its measured throughput are independent measurements and the
model can actually be wrong.

Validation first: probe_draw_N issues exactly N rect() calls plus one
background() per frame, so the counter must return N+1. If it does not, nothing
downstream is trustworthy.

usage:
  uv run python tools/bench_draw_counts.py --out outputs/draw_counts.json
"""
from __future__ import annotations

import argparse
import ctypes
import json
import time
from pathlib import Path

import numpy as np

from playtrain.runtime.native_vec_env import NativeVecEnv

SUITE = ("plunder bigfish bossfight ninja starpilot heist leaper maze dodgeball "
         "jumper chaser caveflyer coinrun fruitbot climber miner pong freeway "
         "seaquest space_invaders asteroids frostbite breakout qbert").split()
VARIANTS = ["breakout.multi", "qbert.v2", "flappy_bird", "flappy_bird.dunk2",
            "frostbite.jungle"]
PROBE_CHECK = [0, 32, 128, 512]      # probe_draw_N -> expect 2N+1


def _bind(lib):
    lib.vec_set_count_draws.restype = None
    lib.vec_set_count_draws.argtypes = [ctypes.c_int]
    lib.vec_get_draw_calls.restype = ctypes.c_ulonglong
    lib.vec_get_draw_calls.argtypes = []
    lib.vec_reset_draw_calls.restype = None
    lib.vec_reset_draw_calls.argtypes = []


def count_and_time(game, *, games_dir, steps=200, num_envs=4, obs=64, seed=0):
    """Returns (draw calls per frame, us per env-step). Timing is taken with
    counting OFF so the counter cannot perturb it."""
    env = NativeVecEnv(game, num_envs=num_envs, obs_size=obs, max_steps=100000,
                       num_threads=1, autoreset=True, frame_skip=1,
                       render_skip=False, games_dir=games_dir)
    lib = env._lib
    _bind(lib)
    rng = np.random.default_rng(seed)
    env.reset(seeds=(seed + np.arange(num_envs)).astype(np.int32))
    acts = rng.integers(0, 8, size=(64, num_envs), dtype=np.int32)
    for i in range(20):
        env.step(acts[i % 64])

    lib.vec_reset_draw_calls()
    lib.vec_set_count_draws(1)
    for i in range(steps):
        env.step(acts[i % 64])
    lib.vec_set_count_draws(0)
    calls = lib.vec_get_draw_calls() / float(steps * num_envs)

    t0, n = time.perf_counter(), 0
    while time.perf_counter() - t0 < 3.0:
        env.step(acts[n % 64])
        n += 1
    us = (time.perf_counter() - t0) / (n * num_envs) * 1e6
    try:
        env.close()
    except Exception:
        pass
    return calls, us


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--games-dir", default="../playtrain/examples/games/js")
    ap.add_argument("--probe-dir", default="../playtrain/examples/games/probe")
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    print("=== counter validation (probe_draw_N must count 2N+1)")
    ok = True
    for n in PROBE_CHECK:
        calls, _ = count_and_time(f"probe_draw_{n}", games_dir=args.probe_dir)
        good = abs(calls - (2 * n + 1)) < 0.01
        ok &= good
        print(f"  probe_draw_{n:<5} counted {calls:9.2f}  expected {2 * n + 1:<6}"
              f"  {'OK' if good else 'MISMATCH'}")
    if not ok:
        print("counter is wrong; not proceeding to games")
        return 1

    print("\n=== games")
    rows = []
    for g in SUITE + VARIANTS:
        try:
            calls, us = count_and_time(g, games_dir=args.games_dir)
        except Exception as e:  # noqa: BLE001
            print(f"  {g:<20} {type(e).__name__}: {e}")
            continue
        rows.append({"game": g, "draw_calls_per_frame": calls, "us_per_step": us,
                     "sps": 1e6 / us})
        print(f"  {g:<20} {calls:9.1f} draw calls/frame   {1e6 / us:9,.0f} sps")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({"rows": rows}, indent=1))
    print("wrote", args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
