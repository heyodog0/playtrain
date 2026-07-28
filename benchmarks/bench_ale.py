"""PlayTrain (PlayTrain) vs ALE (via envpool) on the SAME Atari games at MATCHED
resolution — both 84x84 RGB, frameskip=1, single frame (no stack). PlayTrain has
JS reimplementations of these Atari games, so this is same-game, JS-on-QuickJS +
native rasterizer vs the Stella 6502/TIA emulator behind envpool's C++ threadpool.

  uv run --no-project --python 3.10 --with envpool --with "numpy<2" --with gymnasium \
      python benchmarks/bench_ale.py
"""
from __future__ import annotations

import argparse, json, os, sys, time
from pathlib import Path
import numpy as np

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT / "src"))

# PlayTrain game -> envpool Atari task id
GAMES = {
    "pong": "Pong-v5", "breakout": "Breakout-v5", "seaquest": "Seaquest-v5",
    "space_invaders": "SpaceInvaders-v5", "qbert": "Qbert-v5",
    "frostbite": "Frostbite-v5", "asteroids": "Asteroids-v5", "freeway": "Freeway-v5",
}
OBS = 84


def _timeit(step, warmup, steps, n, trials=3):
    for _ in range(warmup):
        step()
    best = 0.0
    for _ in range(trials):
        t = time.perf_counter()
        for _ in range(steps):
            step()
        best = max(best, n * steps / (time.perf_counter() - t))
    return best


def ng_run(game, N, threads, steps):
    from playtrain.runtime.native_vec_env import NativeVecEnv
    e = NativeVecEnv(game, num_envs=N, obs_size=OBS, autoreset=True, num_threads=threads)
    e.reset(seeds=np.arange(N, dtype=np.int32))
    a = np.random.randint(0, 8, size=N).astype(np.int32)
    r = _timeit(lambda: e.step(a), 50, steps, N)
    e.close()
    return r


def ale_run(task, N, threads, steps):
    import envpool
    e = envpool.make(task, env_type="gymnasium", num_envs=N, num_threads=threads,
                     img_height=OBS, img_width=OBS, gray_scale=False, stack_num=1, frame_skip=1)
    e.reset()
    a = np.random.randint(0, e.action_space.n, size=N).astype(np.int32)
    r = _timeit(lambda: e.step(a), 50, steps, N)
    e.close()
    return r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cores", type=int, default=0)
    ap.add_argument("--steps", type=int, default=3000)
    ap.add_argument("--out", default=str(_ROOT / "outputs" / "compare" / "vs_ale.json"))
    args = ap.parse_args()
    C = args.cores or int(os.environ.get("SLURM_CPUS_ON_NODE", 0)) or os.cpu_count()
    print(f"cores={C}, MATCHED 84x84 RGB, frameskip=1, {args.steps} steps/trial, best-of-3\n")

    print(f"{'game':<15} | {'RAW per-core':^21} | {'BEST in-proc VectorEnv':^26}")
    print(f"{'':<15} | {'ng':>9}{'ale':>8}{'x':>4} | {'ng-vec':>11}{'ale-vec':>10}{'x':>5}")
    rows = []
    for g, task in GAMES.items():
        ng1 = ng_run(g, 1, 1, max(2000, args.steps))
        al1 = ale_run(task, 1, 1, max(2000, args.steps))
        ngV = ng_run(g, 2 * C, C, args.steps)
        alV = ale_run(task, 2 * C, C, args.steps)
        rows.append(dict(game=g, ng_single=ng1, ale_single=al1, ng_vec=ngV, ale_vec=alV))
        print(f"{g:<15} | {ng1:>9,.0f}{al1:>8,.0f}{ng1/al1:>3.1f}x | {ngV:>11,.0f}{alV:>10,.0f}{ngV/alV:>4.1f}x")

    def geo(f):
        xs = [f(r) for r in rows if f(r) > 0]
        return float(np.exp(np.mean(np.log(xs)))) if xs else 0.0
    print("\n" + "-" * 66)
    print(f"  raw per-core   PlayTrain/ALE geomean: {geo(lambda r: r['ng_single']/r['ale_single']):.2f}x")
    print(f"  best VectorEnv PlayTrain/ALE geomean: {geo(lambda r: r['ng_vec']/r['ale_vec']):.2f}x")
    print(f"  PlayTrain best-vec aggregate geomean: {geo(lambda r: r['ng_vec']):,.0f} sps/node")
    print(f"  ALE(envpool) best-vec aggregate geomean: {geo(lambda r: r['ale_vec']):,.0f} sps/node")

    outp = Path(args.out); outp.parent.mkdir(parents=True, exist_ok=True)
    json.dump({"cores": C, "steps": args.steps, "obs": OBS, "rows": rows}, open(outp, "w"), indent=2)
    print(f"\nsaved {outp}")


if __name__ == "__main__":
    main()
