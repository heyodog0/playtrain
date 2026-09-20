"""Cluster benchmark for the PuzzleScript bundles on the node backends (and the QuickJS vec host for comparison).
Rows: engine-only per-env ceiling (node, one thread) | PlayTrainVecEnv (N node processes, pipes + mmap) rgb |
node_vec_proto (one node process, N worker_threads, shared slab) symbolic + rgb | NativeVecEnv (QuickJS) rgb.
    PYTHONPATH=<worktree>/src python cluster_bench.py --games sokoban_basic kettle notsnake --ns 1 8 16 32 64 96
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
DIST = ROOT / "examples" / "games" / "multifile" / "parity" / "puzzlescript" / "dist"
sys.path.insert(0, str(HERE))
from client import NodeVecProto  # noqa: E402

ENGINE_ONLY = r"""
const vm=require('vm'),fs=require('fs');const g=process.argv[2];
const ctx={console,createCanvas(){},background(){},noStroke(){},fill(){},rect(){},drawTiles(){},keyIsDown:()=>false};ctx.globalThis=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync(g,'utf8'),ctx);ctx.setup();ctx.__ps.reset(1);
const won=vm.runInContext('(function(){return winning;})',ctx);let x=1;const rnd=()=>{x=(x*1103515245+12345)>>>0;return x>>>8;};
for(let i=0;i<2000;i++){ctx.__ps.step(rnd()%6); if(won()) ctx.__ps.reset(i);}
const N=30000;let t=process.hrtime.bigint();for(let i=0;i<N;i++){ctx.__ps.step(rnd()%6); if(won()) ctx.__ps.reset(i);}
console.log(Math.round(N/(Number(process.hrtime.bigint()-t)/1e9)));
"""


def engine_only(game: str) -> float:
    out = subprocess.run(["node", "-e", ENGINE_ONLY, str(DIST / f"ps_{game}.js")], capture_output=True, text=True)
    return float(out.stdout.strip().split()[-1])


def vec_env_rgb(game: str, n: int, steps: int) -> float:
    from playtrain.runtime.vec_env import PlayTrainVecEnv
    v = PlayTrainVecEnv(games=[f"ps_{game}"] * n, obs_size=64, max_steps=1000)
    v.reset(seed=1); rng = np.random.default_rng(0)
    for _ in range(20): v.step(rng.integers(0, 6, size=n))
    t = time.perf_counter()
    for _ in range(steps): v.step(rng.integers(0, 6, size=n))
    dt = time.perf_counter() - t; v.close()
    return n * steps / dt


def proto(game: str, n: int, mode: str, steps: int) -> float:
    v = NodeVecProto(str(DIST / f"ps_{game}.js"), n, mode)
    v.reset(np.arange(n)); rng = np.random.default_rng(0)
    for _ in range(20): v.step(rng.integers(0, 6, size=n))
    t = time.perf_counter()
    for _ in range(steps): v.step(rng.integers(0, 6, size=n))
    dt = time.perf_counter() - t; v.close()
    return n * steps / dt


def native_qjs(game: str, n: int, threads: int, steps: int, lib: str | None) -> float | str:
    try:
        from playtrain.runtime import NativeVecEnv
        kw = {"lib_path": lib} if lib else {}
        v = NativeVecEnv(game=f"ps_{game}", num_envs=n, num_threads=threads, obs_size=64, autoreset=True, **kw)
    except Exception as e:  # noqa: BLE001
        return f"unavailable: {str(e)[:80]}"
    v.reset(list(range(n))); rng = np.random.default_rng(0)
    for _ in range(10): v.step(rng.integers(0, 6, size=n))
    t = time.perf_counter()
    for _ in range(steps): v.step(rng.integers(0, 6, size=n))
    dt = time.perf_counter() - t; v.close()
    return n * steps / dt


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--games", nargs="*", default=["sokoban_basic", "kettle", "notsnake"])
    ap.add_argument("--ns", nargs="*", type=int, default=[1, 8, 16, 32, 64])
    ap.add_argument("--steps", type=int, default=400)
    ap.add_argument("--qjs-lib", default=os.environ.get("PS_QJS_LIB"))
    a = ap.parse_args()
    fmt = lambda x: f"{x:,.0f}" if isinstance(x, float) else x
    print(f"host {os.uname().nodename}, nproc {os.cpu_count()}, node {subprocess.run(['node', '--version'], capture_output=True, text=True).stdout.strip()}")
    for g in a.games:
        print(f"\n## {g}\n\nengine-only, node, 1 thread: {fmt(engine_only(g))} steps/s\n")
        print("| N | PlayTrainVecEnv rgb (N processes) | node_vec_proto symbolic | node_vec_proto rgb | NativeVecEnv QuickJS rgb (N envs, N threads) |")
        print("|---|---|---|---|---|")
        for n in a.ns:
            row = [fmt(vec_env_rgb(g, n, a.steps)) if n <= 64 else "-", fmt(proto(g, n, "symbolic", a.steps)), fmt(proto(g, n, "rgb", max(100, a.steps // 2))),
                   fmt(native_qjs(g, n, n, a.steps, a.qjs_lib))]
            print(f"| {n} | " + " | ".join(row) + " |", flush=True)
