"""Honest ALE comparison: envpool at its TRUE best (grayscale 84x84, ASYNC
send/recv, fs=1, swept over thread/batch configs) vs PlayTrain's best VectorEnv.

Caveats made explicit: envpool uses grayscale (ALE's standard + its fast path);
PlayTrain outputs RGB (3 channels, i.e. MORE readback work) — so this is
conservative for PlayTrain on the obs axis. Metric = environment frames/s (fs=1),
112-core node.

  uv run --no-project --python 3.10 --with envpool --with "numpy<2" --with gym \
      python benchmarks/bench_ale_async.py
"""
from __future__ import annotations

import argparse, json, os, sys, time
from pathlib import Path
import numpy as np

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT / "src"))
GAMES = {"pong": "Pong-v5", "freeway": "Freeway-v5", "seaquest": "Seaquest-v5",
         "space_invaders": "SpaceInvaders-v5", "asteroids": "Asteroids-v5",
         "frostbite": "Frostbite-v5", "breakout": "Breakout-v5", "qbert": "Qbert-v5"}
OBS = 84


def ng_vec(game, N, threads, steps=3000):
    from playtrain.runtime.native_vec_env import NativeVecEnv
    e = NativeVecEnv(game, num_envs=N, obs_size=OBS, autoreset=True, num_threads=threads)
    e.reset(seeds=np.arange(N, dtype=np.int32))
    a = np.random.randint(0, 8, size=N).astype(np.int32)
    for _ in range(50):
        e.step(a)
    best = 0.0
    for _ in range(3):
        t = time.perf_counter()
        for _ in range(steps):
            e.step(a)
        best = max(best, N * steps / (time.perf_counter() - t))
    e.close()
    return best


def ale_sync_gray(task, N, threads, steps=3000):
    import envpool
    e = envpool.make(task, env_type="gymnasium", num_envs=N, num_threads=threads,
                     img_height=OBS, img_width=OBS, gray_scale=True, stack_num=1, frame_skip=1)
    e.reset()
    a = np.random.randint(0, e.action_space.n, size=N).astype(np.int32)
    for _ in range(50):
        e.step(a)
    best = 0.0
    for _ in range(3):
        t = time.perf_counter()
        for _ in range(steps):
            e.step(a)
        best = max(best, N * steps / (time.perf_counter() - t))
    e.close()
    return best


def ale_async_gray_best(task, C, target=250000):
    """envpool async (send/recv) grayscale — its headline-throughput mode. Sweep a
    few (num_threads, batch_size, num_envs) configs; take the best frames/s."""
    import envpool
    best, best_cfg = 0.0, None
    configs = [(C, C, 3 * C), (C, C, 2 * C), (C // 2, C // 2, 3 * (C // 2)),
               (C, C // 2, 3 * C), (C * 3 // 4, C * 3 // 4, 3 * (C * 3 // 4))]
    for (T, B, M) in configs:
        if B < 1 or M < B:
            continue
        try:
            e = envpool.make(task, env_type="gym", num_envs=M, batch_size=B, num_threads=T,
                             img_height=OBS, img_width=OBS, gray_scale=True, stack_num=1, frame_skip=1)
            n_act = e.action_space.n
            e.async_reset()
            done = 0
            while done < 30000:                              # warmup
                out = e.recv()                               # (obs,rew,term,trunc,info) or (obs,rew,done,info)
                eid = out[-1]["env_id"]
                e.send(np.random.randint(0, n_act, size=len(eid)).astype(np.int32), eid)
                done += len(eid)
            t = time.perf_counter(); done = 0
            while done < target:
                out = e.recv()
                eid = out[-1]["env_id"]
                e.send(np.random.randint(0, n_act, size=len(eid)).astype(np.int32), eid)
                done += len(eid)
            rate = done / (time.perf_counter() - t)
            if rate > best:
                best, best_cfg = rate, (T, B, M)
            del e
        except Exception as ex:
            print(f"    (async {task} cfg {(T,B,M)} failed: {str(ex)[:50]})", flush=True)
    return best, best_cfg


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cores", type=int, default=0)
    ap.add_argument("--out", default=str(_ROOT / "outputs" / "compare" / "vs_ale_fair.json"))
    args = ap.parse_args()
    C = args.cores or int(os.environ.get("SLURM_CPUS_ON_NODE", 0)) or os.cpu_count()
    print(f"cores={C}, 84x84 fs=1, env-frames/s. PlayTrain=RGB(best vec), "
          f"ALE=envpool grayscale (sync + async-best)\n", flush=True)
    print(f"{'game':<15}{'ng-vec(RGB)':>13}{'ale-sync':>11}{'ale-async':>11}{'cfg(T,B,M)':>16}{'ng/ale':>9}", flush=True)
    rows = []
    for g, task in GAMES.items():
        ng = ng_vec(g, 2 * C, C)
        asy = ale_sync_gray(task, 2 * C, C)
        aas, cfg = ale_async_gray_best(task, C)
        ale_best = max(asy, aas)
        rows.append(dict(game=g, ng_vec=ng, ale_sync=asy, ale_async=aas, ale_best=ale_best, cfg=cfg))
        print(f"{g:<15}{ng:>13,.0f}{asy:>11,.0f}{aas:>11,.0f}{str(cfg):>16}{ng/ale_best:>8.1f}x", flush=True)

    def geo(f):
        xs = [f(r) for r in rows if f(r) > 0]
        return float(np.exp(np.mean(np.log(xs)))) if xs else 0.0
    print("\n" + "-" * 70, flush=True)
    print(f"  PlayTrain best-vec (RGB)      geomean: {geo(lambda r: r['ng_vec']):,.0f} frames/s", flush=True)
    print(f"  ALE envpool best (gray,async) geomean: {geo(lambda r: r['ale_best']):,.0f} frames/s", flush=True)
    print(f"  PlayTrain / ALE(best) geomean: {geo(lambda r: r['ng_vec']/r['ale_best']):.2f}x", flush=True)

    outp = Path(args.out); outp.parent.mkdir(parents=True, exist_ok=True)
    json.dump({"cores": C, "obs": OBS, "rows": rows}, open(outp, "w"), indent=2)
    print(f"\nsaved {outp}", flush=True)


if __name__ == "__main__":
    main()
