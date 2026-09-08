"""Price the probe environments and read the per-unit costs off the slopes.

See tools/gen_probes.py for why probes rather than a decomposition of real
games. Single-threaded, frame_skip=1, obs 64 -- the per-core units Figure 4D
reports.

usage:
  uv run python tools/bench_probes.py --out outputs/probes.json
"""
from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path

import numpy as np

from playtrain.runtime.native_vec_env import NativeVecEnv

DRAW_N = [0, 32, 64, 128, 256, 512, 1024]
FILL_S = [2, 4, 8, 16, 32, 64]
LOGIC_N = [0, 64, 128, 256, 512, 1024, 2048]


def time_game(game: str, *, games_dir: str, obs: int, num_envs: int,
              seconds: float, seed: int = 0) -> float:
    """Microseconds of wall-clock per env-step, single-threaded."""
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


def fit(xs, ys):
    """Least-squares slope and intercept, plus R^2 -- a bad fit means the probe
    is not measuring one thing and the number should not be quoted."""
    x, y = np.asarray(xs, float), np.asarray(ys, float)
    m, c = np.polyfit(x, y, 1)
    pred = m * x + c
    ss_res = float(((y - pred) ** 2).sum())
    ss_tot = float(((y - y.mean()) ** 2).sum())
    return m, c, (1 - ss_res / ss_tot if ss_tot > 0 else float("nan"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--games-dir", default="../playtrain/examples/games/probe")
    ap.add_argument("--obs", type=int, default=64)
    ap.add_argument("--num-envs", type=int, default=8)
    ap.add_argument("--seconds", type=float, default=4.0)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    res, t = {}, {}
    for fam, vals in (("draw", DRAW_N), ("fill", FILL_S), ("logic", LOGIC_N)):
        print(f"=== {fam}")
        for v in vals:
            g = f"probe_{fam}_{v}"
            us = time_game(g, games_dir=args.games_dir, obs=args.obs,
                           num_envs=args.num_envs, seconds=args.seconds)
            t[g] = us
            print(f"  {g:<20} {us:9.2f} us/step   {1e6 / us:10,.0f} sps/core")

    # draw: us/step vs number of 8x8 rect() calls
    m, c, r2 = fit(DRAW_N, [t[f"probe_draw_{n}"] for n in DRAW_N])
    res["per_draw_call_us"] = m
    res["baseline_us"] = c
    res["draw_r2"] = r2
    # fill: us/step vs total pixels covered by 16 rects of side S
    px = [16 * s * s for s in FILL_S]
    mf, cf, r2f = fit(px, [t[f"probe_fill_{s}"] for s in FILL_S])
    res["per_pixel_us"] = mf
    res["fill_r2"] = r2f
    # logic: us/step vs number of entity updates
    ml, cl, r2l = fit(LOGIC_N, [t[f"probe_logic_{n}"] for n in LOGIC_N])
    res["per_state_update_us"] = ml
    res["logic_r2"] = r2l

    print("\n--- per-unit costs (single core, obs 64)")
    print(f"  draw call (8x8 rect)   {res['per_draw_call_us'] * 1000:8.2f} ns   R2={r2:.4f}")
    print(f"  pixel filled           {res['per_pixel_us'] * 1000:8.4f} ns   R2={r2f:.4f}")
    print(f"  entity state update    {res['per_state_update_us'] * 1000:8.2f} ns   R2={r2l:.4f}")
    print(f"  empty env baseline     {res['baseline_us']:8.2f} us")
    if res["per_draw_call_us"] > 0 and res["per_state_update_us"] > 0:
        ratio = res["per_draw_call_us"] / res["per_state_update_us"]
        print(f"\n  one draw call == {ratio:,.1f} entity state updates")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({"per_step_us": t, "fits": res,
                                    "obs": args.obs, "threads": 1}, indent=1))
    print("wrote", args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
