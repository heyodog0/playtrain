"""T7 for the native twins: steps/s per game, one env (twin_host bench) and 20 envs / 10 threads (NativeVecEnv on
libtwin_vec), next to the QuickJS host on the same protocol.  uv run --no-sync python benchmarks/bench_twins.py chip8
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import subprocess
import time
from pathlib import Path

import numpy as np

from playtrain.runtime import NativeVecEnv

ROOT = Path(__file__).resolve().parents[1]
TWIN_HOST = ROOT / "native" / "twins" / "build" / "twin_host"
TWIN_LIB = ROOT / "native" / "twins" / "build" / ("libtwin_vec.dylib" if platform.system() == "Darwin" else "libtwin_vec.so")
QJS_HOST = ROOT / "native" / "build" / "qjs_host"
PREFIX = {"chip8": "chip8_", "vgdl": "vgdl_", "puzzlescript": "ps_"}


def single(host: Path, bundle: Path, steps: int, env: dict) -> float:
    proc = subprocess.run([str(host), str(bundle), "bench", "1", str(steps)], capture_output=True, text=True, env=env)
    if proc.returncode != 0 or "= " not in proc.stdout:
        raise RuntimeError((proc.stdout + proc.stderr).strip().splitlines()[-1] if (proc.stdout + proc.stderr).strip() else "no output")
    return float(proc.stdout.split("= ")[1].split(" ")[0])


def vec(game: str, lib: Path, n: int, threads: int, steps: int, na: int) -> float:
    v = NativeVecEnv(game=game, num_envs=n, num_threads=threads, obs_size=64, autoreset=True, lib_path=str(lib))
    v.reset(list(range(n))); rng = np.random.default_rng(0)
    for _ in range(20): v.step(rng.integers(0, na, size=n))
    t = time.perf_counter()
    for _ in range(steps): v.step(rng.integers(0, na, size=n))
    dt = time.perf_counter() - t; v.close()
    return n * steps / dt


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("family", choices=list(PREFIX))
    ap.add_argument("--games", nargs="*", default=None)
    ap.add_argument("--steps", type=int, default=100000)
    ap.add_argument("--qjs-steps", type=int, default=20000)
    ap.add_argument("--vec-steps", type=int, default=300)
    a = ap.parse_args()
    dist = ROOT / "examples" / "games" / "multifile" / "parity" / a.family / "dist"
    games = a.games or sorted(p.stem[len(PREFIX[a.family]):] for p in dist.glob(PREFIX[a.family] + "*.js"))
    print(f"| game | QuickJS 1 env | twin 1 env | QuickJS 20 env / 10 thr | twin 20 env / 10 thr |\n|---|---|---|---|---|")
    for g in games:
        name = PREFIX[a.family] + g
        side = json.loads((dist / f"{name}.json").read_text()); na = len(side["actions"])
        env = {**os.environ, "PLAYTRAIN_QJS_ACTIONS": json.dumps(side["actions"])}
        q1 = single(QJS_HOST, dist / f"{name}.js", a.qjs_steps, env) if QJS_HOST.exists() else float("nan")
        try:
            t1 = single(TWIN_HOST, dist / f"{name}.js", a.steps, env)
        except RuntimeError as e:   # a family profile the twin does not cover yet (vgdl rcrl until U06)
            print(f"| {g} | - | skipped: {e} | - | - |", flush=True); continue
        qv = vec(name, ROOT / "native" / "build" / ("libqjs_vec.dylib" if platform.system() == "Darwin" else "libqjs_vec.so"), 20, 10, a.vec_steps, na)
        tv = vec(name, TWIN_LIB, 20, 10, a.vec_steps, na)
        print(f"| {g} | {q1:,.0f} | {t1:,.0f} | {qv:,.0f} | {tv:,.0f} |", flush=True)
