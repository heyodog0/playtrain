"""Price the five logic-kind probes; report per-unit cost per mechanism.

See tools/gen_logic_probes.py. Draw calls are fixed at 8 in every probe, so the
slope of us/step against the swept quantity is the cost of that mechanism alone.

usage:
  uv run python tools/bench_logic_probes.py --out outputs/logic_probes.json
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np

from playtrain.runtime.native_vec_env import NativeVecEnv

FAMS = {"lent": "entity object update", "larr": "typed-array slot update",
        "lgrid": "tile-grid cell scan", "lcoll": "pairwise collision check",
        "lalloc": "object allocated per frame"}
NS = [0, 256, 512, 1024, 2048, 4096]


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


def fit(xs, ys):
    x, y = np.asarray(xs, float), np.asarray(ys, float)
    m, c = np.polyfit(x, y, 1)
    pred = m * x + c
    ss_res = float(((y - pred) ** 2).sum())
    ss_tot = float(((y - y.mean()) ** 2).sum())
    return m, c, (1 - ss_res / ss_tot if ss_tot > 0 else float("nan"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--games-dir", default="../playtrain/examples/games/probe")
    ap.add_argument("--seconds", type=float, default=4.0)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    per_step, fits = {}, {}
    for fam, label in FAMS.items():
        print(f"=== {fam}  ({label})")
        ys = []
        for n in NS:
            g = f"probe_{fam}_{n}"
            us = time_game(g, games_dir=args.games_dir, seconds=args.seconds)
            per_step[g] = us
            ys.append(us)
            print(f"  {g:<22} {us:9.2f} us/step  {1e6 / us:10,.0f} sps/core")
        m, c, r2 = fit(NS, ys)
        fits[fam] = {"per_unit_ns": m * 1000, "intercept_us": c, "r2": r2,
                     "label": label}

    print("\n--- cost per unit of game logic (single core, 8 draw calls fixed)")
    for fam, f in sorted(fits.items(), key=lambda kv: -kv[1]["per_unit_ns"]):
        print(f"  {f['label']:<28} {f['per_unit_ns']:8.2f} ns   R2={f['r2']:.4f}")
    if fits["lent"]["per_unit_ns"] and fits["larr"]["per_unit_ns"]:
        r = fits["lent"]["per_unit_ns"] / fits["larr"]["per_unit_ns"]
        print(f"\n  entity object vs typed array: {r:.1f}x  "
              f"(that gap is QuickJS object-property cost)")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({"per_step_us": per_step, "fits": fits}, indent=1))
    print("wrote", args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
