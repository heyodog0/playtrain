"""G10 for the PuzzleScript family: per game, compile time under QuickJS (qjs_host `bench` with 1 step, minus a
1-step floor is not separable, so the compile is measured as the time of a 1-step run), steps/s on QuickJS for one
env (qjs_host bench) and 20 envs on 10 threads (NativeVecEnv). Prints a markdown table for PROGRESS.md.

    uv run --no-sync python benchmarks/bench_puzzlescript.py [--games microban kettle] [--steps 3000] [--vec-steps 200]
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import time
from pathlib import Path

import numpy as np

from playtrain.runtime import NativeVecEnv

ROOT = Path(__file__).resolve().parents[1]
HOST = ROOT / "native" / "build" / "qjs_host"
DIST = ROOT / "examples" / "games" / "multifile" / "parity" / "puzzlescript" / "dist"


def qjs_run(game: str, steps: int) -> tuple[float, float]:
    """(wall seconds for the whole process, steps/s reported by bench)."""
    side = json.loads((DIST / f"{game}.json").read_text())
    env = {**os.environ, "PLAYTRAIN_QJS_ACTIONS": json.dumps(side["actions"])}
    t = time.perf_counter()
    out = subprocess.run([str(HOST), str(DIST / f"{game}.js"), "bench", "1", str(steps)], capture_output=True, text=True, env=env).stdout
    wall = time.perf_counter() - t
    return wall, float(out.split("= ")[1].split(" ")[0])


def vec_sps(game: str, n: int, threads: int, steps: int) -> float:
    v = NativeVecEnv(game=game, num_envs=n, num_threads=threads, obs_size=64, autoreset=True)
    v.reset(list(range(n)))
    rng = np.random.default_rng(0)
    for _ in range(10):
        v.step(rng.integers(0, 6, size=n))
    t = time.perf_counter()
    for _ in range(steps):
        v.step(rng.integers(0, 6, size=n))
    dt = time.perf_counter() - t
    v.close()
    return n * steps / dt


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--games", nargs="*", default=None)
    ap.add_argument("--steps", type=int, default=3000)
    ap.add_argument("--vec-steps", type=int, default=200)
    ap.add_argument("--n", type=int, default=20)
    ap.add_argument("--threads", type=int, default=10)
    a = ap.parse_args()
    games = a.games or sorted(p.stem[len("ps_"):] for p in DIST.glob("ps_*.js"))
    print(f"| game | QuickJS load + compile (1-step run, s) | 1 env / 1 thread steps/s (qjs_host bench, {a.steps} steps) | {a.n} env / {a.threads} thr (NativeVecEnv) |")
    print("|---|---|---|---|")
    for g in games:
        wall1, _ = qjs_run(f"ps_{g}", 1)
        _, s1 = qjs_run(f"ps_{g}", a.steps)
        sv = vec_sps(f"ps_{g}", a.n, a.threads, a.vec_steps)
        print(f"| {g} | {wall1:.2f} | {s1:,.0f} | {sv:,.0f} |", flush=True)
