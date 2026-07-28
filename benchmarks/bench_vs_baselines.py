"""Definitive, fair apples-to-apples: PlayTrain (PlayTrain) vs ProcGen on the SAME
games (PlayTrain's bigfish/coinrun/... ARE JS reimplementations of these ProcGen
games), same 64x64 RGB, frameskip=1, same node.

Each system gets its BEST config:
  * raw per-core     — single env (num=1), the fundamental env cost
  * best VectorEnv   — the in-process C++ vec each ships. PlayTrain NativeVecEnv
                       (threads=cores); ProcGen ProcgenGym3Env swept over
                       num_threads (its threadpool peaks ~16 and DEGRADES past it,
                       so we take the max — giving ProcGen its fair best).
  * ceiling          — single-env x cores (both scale ~linearly with independent
                       processes; this is the embarrassingly-parallel aggregate).

  uv run --no-project --python 3.10 --with procgen --with "numpy<2" --with gymnasium \
      python benchmarks/bench_vs_baselines.py
"""
from __future__ import annotations

import argparse, json, os, sys, time
from pathlib import Path
import numpy as np

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT / "src"))
GAMES = ["plunder", "bigfish", "starpilot", "leaper", "maze", "coinrun", "miner"]


def _timeit(step_fn, warmup, steps, n_envs, trials=3):
    for _ in range(warmup):
        step_fn()
    best = 0.0
    for _ in range(trials):
        t = time.perf_counter()
        for _ in range(steps):
            step_fn()
        best = max(best, n_envs * steps / (time.perf_counter() - t))
    return best


def ng_run(game, N, threads, steps):
    from playtrain.runtime.native_vec_env import NativeVecEnv
    e = NativeVecEnv(game, num_envs=N, obs_size=64, autoreset=True, num_threads=threads)
    e.reset(seeds=np.arange(N, dtype=np.int32))
    a = np.random.randint(0, 8, size=N).astype(np.int32)
    r = _timeit(lambda: e.step(a), 50, steps, N)
    e.close()
    return r


def pg_run(game, N, threads, steps):
    from procgen import ProcgenGym3Env
    e = ProcgenGym3Env(num=N, env_name=game, num_threads=threads, distribution_mode="hard")
    a = np.random.randint(0, 15, size=N).astype(np.int32)
    e.observe()
    r = _timeit(lambda: (e.act(a), e.observe()), 50, steps, N)
    del e
    return r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cores", type=int, default=0)
    ap.add_argument("--steps", type=int, default=3000)
    ap.add_argument("--games", nargs="+", default=GAMES)
    ap.add_argument("--out", default=str(_ROOT / "outputs" / "compare" / "vs_procgen.json"))
    args = ap.parse_args()
    C = args.cores or int(os.environ.get("SLURM_CPUS_ON_NODE", 0)) or os.cpu_count()
    PG_NT = [8, 16, 32]              # ProcGen's threadpool peaks in here; take the best
    print(f"cores={C}, 64x64 RGB, frameskip=1, {args.steps} steps/trial, best-of-3\n")

    print(f"{'game':<10} | {'RAW per-core':^23} | {'BEST in-proc VectorEnv':^30}")
    print(f"{'':<10} | {'ng':>9}{'procgen':>9}{'x':>5} | {'ng-vec':>10}{'pg-vec':>9}{'x':>7}{'pg_nt':>6}")
    rows = []
    for g in args.games:
        ng1 = ng_run(g, 1, 1, max(2000, args.steps))
        pg1 = pg_run(g, 1, 1, max(2000, args.steps))
        ngV = ng_run(g, 2 * C, C, args.steps)                 # PlayTrain best vec
        pgV, pg_best_nt = 0.0, 0
        for nt in PG_NT:                                       # procgen best vec
            v = pg_run(g, 2 * C, nt, args.steps)
            if v > pgV:
                pgV, pg_best_nt = v, nt
        rows.append(dict(game=g, ng_single=ng1, pg_single=pg1, ng_vec=ngV,
                         pg_vec=pgV, pg_best_nt=pg_best_nt))
        print(f"{g:<10} | {ng1:>9,.0f}{pg1:>9,.0f}{ng1/pg1:>4.1f}x | "
              f"{ngV:>10,.0f}{pgV:>9,.0f}{ngV/pgV:>6.1f}x{pg_best_nt:>6}")

    def geo(f):
        xs = [f(r) for r in rows if f(r) > 0]
        return float(np.exp(np.mean(np.log(xs)))) if xs else 0.0
    print("\n" + "-" * 72)
    print(f"  raw per-core   PlayTrain/procgen geomean: {geo(lambda r: r['ng_single']/r['pg_single']):.2f}x")
    print(f"  best VectorEnv PlayTrain/procgen geomean: {geo(lambda r: r['ng_vec']/r['pg_vec']):.2f}x")
    print(f"  PlayTrain best-vec aggregate  geomean: {geo(lambda r: r['ng_vec']):,.0f} sps/node")
    print(f"  procgen  best-vec aggregate  geomean: {geo(lambda r: r['pg_vec']):,.0f} sps/node")
    print(f"  PlayTrain ceiling (single x {C}) geomean: {geo(lambda r: r['ng_single']*C):,.0f} sps/node")
    print(f"  procgen  ceiling (single x {C}) geomean: {geo(lambda r: r['pg_single']*C):,.0f} sps/node")

    outp = Path(args.out); outp.parent.mkdir(parents=True, exist_ok=True)
    json.dump({"cores": C, "steps": args.steps, "rows": rows}, open(outp, "w"), indent=2)
    print(f"\nsaved {outp}")


if __name__ == "__main__":
    main()
