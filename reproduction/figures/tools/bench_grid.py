"""H2 (additivity) and H3 (held-out prediction) for the env cost model.

Fits t = t0 + a*N + b*M on the grid, compares against a model with an N*M
interaction term, then predicts the held-out probes. Reports R^2 and percent
error, so the section can state a number that could have come out wrong.

usage:
  uv run python tools/bench_grid.py --out outputs/grid.json
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np

from playtrain.runtime.native_vec_env import NativeVecEnv

GRID_N = [0, 128, 256, 512]
GRID_M = [0, 256, 512, 1024]
HELDOUT = [(64, 384), (192, 768), (320, 128), (768, 1536)]


def time_game(game, *, games_dir, obs=64, num_envs=8, seconds=4.0, seed=0):
    env = NativeVecEnv(game, num_envs=num_envs, obs_size=obs, max_steps=100000,
                       num_threads=1, autoreset=True, frame_skip=1,
                       render_skip=False, games_dir=games_dir)
    rng = np.random.default_rng(seed)
    env.reset(seeds=(seed + np.arange(num_envs)).astype(np.int32))
    acts = rng.integers(0, 8, size=(64, num_envs), dtype=np.int32)
    for i in range(20):
        env.step(acts[i % 64])
    t0, steps = time.perf_counter(), 0
    while time.perf_counter() - t0 < seconds:
        env.step(acts[steps % 64])
        steps += 1
    el = time.perf_counter() - t0
    try:
        env.close()
    except Exception:
        pass
    return el / (steps * num_envs) * 1e6


def r2(y, pred):
    ss_res = float(((y - pred) ** 2).sum())
    ss_tot = float(((y - y.mean()) ** 2).sum())
    return 1 - ss_res / ss_tot if ss_tot > 0 else float("nan")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--games-dir", default="../playtrain/examples/games/probe")
    ap.add_argument("--seconds", type=float, default=4.0)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    meas = {}
    print("=== grid")
    for n in GRID_N:
        for m in GRID_M:
            us = time_game(f"probe_grid_{n}_{m}", games_dir=args.games_dir,
                           seconds=args.seconds)
            meas[f"{n}_{m}"] = us
            print(f"  N={n:<5} M={m:<5} {us:9.2f} us/step")
    print("=== held out")
    for n, m in HELDOUT:
        us = time_game(f"probe_grid_{n}_{m}", games_dir=args.games_dir,
                       seconds=args.seconds)
        meas[f"{n}_{m}"] = us
        print(f"  N={n:<5} M={m:<5} {us:9.2f} us/step")

    N = np.array([n for n in GRID_N for _ in GRID_M], float)
    M = np.array([m for _ in GRID_N for m in GRID_M], float)
    y = np.array([meas[f"{int(n)}_{int(m)}"] for n, m in zip(N, M)])

    # H2: additive vs additive + interaction
    A = np.column_stack([np.ones_like(N), N, M])
    coef, *_ = np.linalg.lstsq(A, y, rcond=None)
    r2_add = r2(y, A @ coef)
    Ai = np.column_stack([np.ones_like(N), N, M, N * M])
    coefi, *_ = np.linalg.lstsq(Ai, y, rcond=None)
    r2_int = r2(y, Ai @ coefi)
    t0, a, b = coef
    print(f"\nH2  additive     t = {t0:.2f} + {a * 1000:.1f}ns*N + {b * 1000:.1f}ns*M"
          f"   R2={r2_add:.5f}")
    print(f"    +interaction R2={r2_int:.5f}  (gain {r2_int - r2_add:+.5f}, "
          f"coef {coefi[3] * 1e6:.4f} ps per N*M)")
    # what the interaction would cost at the corner of the grid
    corner = coefi[3] * max(GRID_N) * max(GRID_M)
    print(f"    interaction term at N={max(GRID_N)},M={max(GRID_M)}: "
          f"{corner:.2f} us of {y.max():.2f} us ({100 * corner / y.max():+.1f}%)")

    # H3: predict held-out from the grid fit
    print("\nH3  held-out prediction")
    rows = []
    for n, m in HELDOUT:
        pred = t0 + a * n + b * m
        obs_ = meas[f"{n}_{m}"]
        err = 100 * (pred - obs_) / obs_
        tag = "extrapolation" if (n > max(GRID_N) or m > max(GRID_M)) else ""
        rows.append({"n": n, "m": m, "pred_us": pred, "meas_us": obs_, "err_pct": err})
        print(f"  N={n:<5} M={m:<5} pred {pred:8.2f}  meas {obs_:8.2f}  "
              f"{err:+6.2f}%  {tag}")
    mae = float(np.mean([abs(r["err_pct"]) for r in rows]))
    print(f"  mean |error| = {mae:.2f}%")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(
        {"measured_us": meas, "fit": {"t0_us": t0, "per_draw_us": a,
                                      "per_logic_us": b, "r2_additive": r2_add,
                                      "r2_interaction": r2_int,
                                      "interaction_coef": coefi[3]},
         "heldout": rows, "mae_pct": mae}, indent=1))
    print("wrote", args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
