"""Measured sharded aggregate (not extrapolated): P independent single-env
processes, synchronized start, wall-clock aggregate. Symmetric — both PlayTrain
and ProcGen driven through their normal single-env Python API in one process each,
so neither gets a coordinator advantage. This is the embarrassingly-parallel
ceiling a practitioner reaches with a sharded launcher.

  uv run --no-project --python 3.10 --with procgen --with "numpy<2" --with gymnasium \
      python benchmarks/bench_sharded.py --steps 20000
"""
from __future__ import annotations

import argparse, json, os, sys, time
import multiprocessing as mp
from pathlib import Path
import numpy as np

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT / "src"))
GAMES = ["plunder", "bigfish", "starpilot", "leaper", "maze", "coinrun", "miner"]


def _sync(barrier):
    try:
        barrier.wait(timeout=90)         # near-synchronized start; never hang the run
    except Exception:
        pass


def ng_worker(game, steps, barrier, q):
    try:
        sys.path.insert(0, str(_ROOT / "src"))
        from playtrain.runtime.native_vec_env import NativeVecEnv
        e = NativeVecEnv(game, num_envs=1, obs_size=64, autoreset=True, num_threads=1)
        e.reset(seeds=np.array([os.getpid() % 100000], dtype=np.int32))
        a = np.ones(1, dtype=np.int32)
        for _ in range(300):
            e.step(a)
        _sync(barrier)
        t = time.perf_counter()
        for _ in range(steps):
            e.step(a)
        q.put(steps / (time.perf_counter() - t))
        e.close()
    except Exception as e:
        _sync(barrier); q.put(0.0)


def pg_worker(game, steps, barrier, q):
    try:
        from procgen import ProcgenGym3Env
        e = ProcgenGym3Env(num=1, env_name=game, num_threads=1, distribution_mode="hard")
        a = np.random.randint(0, 15, size=1).astype(np.int32)
        e.observe()
        for _ in range(300):
            e.act(a); e.observe()
        _sync(barrier)
        t = time.perf_counter()
        for _ in range(steps):
            e.act(a); e.observe()
        q.put(steps / (time.perf_counter() - t))
        del e
    except Exception:
        _sync(barrier); q.put(0.0)


def sharded(worker, game, P, steps):
    # Barrier synchronizes the timed section; each worker reports its own rate
    # (measured under full contention) so aggregate = sum. Deadlock-proof: the
    # barrier has a timeout and workers always report, even on failure.
    barrier = mp.Barrier(P + 1)
    q = mp.Queue()
    procs = [mp.Process(target=worker, args=(game, steps, barrier, q)) for _ in range(P)]
    for p in procs:
        p.start()
    _sync(barrier)
    rates = []
    for _ in range(P):
        try:
            rates.append(q.get(timeout=180))
        except Exception:
            rates.append(0.0)
    for p in procs:
        p.join(timeout=10)
        if p.is_alive():
            p.terminate()
    ok = [r for r in rates if r > 0]
    return sum(ok), len(ok)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--procs", type=int, default=0, help="0 = physical cores")
    ap.add_argument("--steps", type=int, default=20000)
    ap.add_argument("--games", nargs="+", default=GAMES)
    ap.add_argument("--out", default=str(_ROOT / "outputs" / "compare" / "sharded.json"))
    args = ap.parse_args()
    P = args.procs or int(os.environ.get("SLURM_CPUS_ON_NODE", 0)) or os.cpu_count()
    print(f"sharded: {P} independent single-env processes, {args.steps} steps each, "
          f"synchronized start, 64x64 RGB, frameskip=1\n")

    print(f"{'game':<11}{'PlayTrain':>14}{'procgen':>14}{'ng/pg':>8}")
    rows = []
    for g in args.games:
        ng = sharded(ng_worker, g, P, args.steps)
        pg = sharded(pg_worker, g, P, args.steps)
        rows.append(dict(game=g, playtrain=ng, procgen=pg))
        print(f"{g:<11}{ng:>14,.0f}{pg:>14,.0f}{ng/pg:>7.2f}x")

    def geo(k):
        xs = [r[k] for r in rows if r[k] > 0]
        return float(np.exp(np.mean(np.log(xs)))) if xs else 0.0
    print("\n" + "-" * 48)
    print(f"  PlayTrain sharded geomean: {geo('playtrain'):,.0f} sps/node")
    print(f"  procgen  sharded geomean: {geo('procgen'):,.0f} sps/node")
    print(f"  PlayTrain/procgen geomean: {np.exp(np.mean(np.log([r['playtrain']/r['procgen'] for r in rows]))):.2f}x")

    outp = Path(args.out); outp.parent.mkdir(parents=True, exist_ok=True)
    json.dump({"procs": P, "steps": args.steps, "rows": rows}, open(outp, "w"), indent=2)
    print(f"\nsaved {outp}")


if __name__ == "__main__":
    main()
