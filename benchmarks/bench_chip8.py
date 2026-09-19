"""G9 for the CHIP-8 family: steps/s per game on QuickJS, one env (qjs_host bench) and 20 envs on
10 threads (NativeVecEnv). Prints a markdown table for examples/games/multifile/parity/chip8/PROGRESS.md.

    uv run --no-sync python benchmarks/bench_chip8.py [--games brix tetris] [--steps 20000] [--vec-steps 300]
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
DIST = ROOT / "examples" / "games" / "multifile" / "parity" / "chip8" / "dist"


def single_sps(game: str, steps: int) -> float:
    side = json.loads((DIST / f"{game}.json").read_text())
    env = {**os.environ, "PLAYTRAIN_QJS_ACTIONS": json.dumps(side["actions"])}
    out = subprocess.run([str(HOST), str(DIST / f"{game}.js"), "bench", "1", str(steps)], capture_output=True, text=True, env=env).stdout
    return float(out.split("= ")[1].split(" ")[0])


def vec_sps(game: str, n: int, threads: int, steps: int) -> float:
    v = NativeVecEnv(game=game, num_envs=n, num_threads=threads, obs_size=64, autoreset=True)
    side = json.loads((DIST / f"{game}.json").read_text())
    na = len(side["actions"])
    v.reset(list(range(n)))
    rng = np.random.default_rng(0)
    for _ in range(20):
        v.step(rng.integers(0, na, size=n))
    t = time.perf_counter()
    for _ in range(steps):
        v.step(rng.integers(0, na, size=n))
    dt = time.perf_counter() - t
    v.close()
    return n * steps / dt


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--games", nargs="*", default=None)
    ap.add_argument("--steps", type=int, default=20000)
    ap.add_argument("--vec-steps", type=int, default=300)
    ap.add_argument("--n", type=int, default=20)
    ap.add_argument("--threads", type=int, default=10)
    a = ap.parse_args()
    games = a.games or sorted(p.stem[len("chip8_"):] for p in DIST.glob("chip8_*.js"))
    print(f"| game | 1 env / 1 thread (qjs_host bench) | {a.n} env / {a.threads} thr (NativeVecEnv) |")
    print("|---|---|---|")
    for g in games:
        s1 = single_sps(f"chip8_{g}", a.steps)
        sv = vec_sps(f"chip8_{g}", a.n, a.threads, a.vec_steps)
        print(f"| {g} | {s1:,.0f} | {sv:,.0f} |", flush=True)
