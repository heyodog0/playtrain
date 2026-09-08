"""Scaling sweep for Figure 1(d): aggregate SPS vs core budget C, geomean over a
suite, each system at its best config for that C. Two modes (run separately to
keep deps clean):

  procgen:  PlayTrain(16 ProcGen clones) + ProcGen(ProcgenGym3Env)
  atari:    PlayTrain(8 Atari clones)    + ALE(envpool, sync+async best)

Single process per measurement (memory-safe — no 100-process sharding).

  uv run --no-project --python 3.10 --with procgen --with "numpy<2" --with gymnasium \
      python benchmarks/bench_scaling.py --mode procgen
  uv run --no-project --python 3.10 --with envpool --with "numpy<2" --with gym \
      python benchmarks/bench_scaling.py --mode atari
"""
from __future__ import annotations

import argparse, json, math, os, sys, time
from pathlib import Path
import numpy as np

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT / "src"))

PROCGEN = ["bigfish", "bossfight", "caveflyer", "chaser", "climber", "coinrun",
           "dodgeball", "fruitbot", "heist", "jumper", "leaper", "maze", "miner",
           "ninja", "plunder", "starpilot"]
ATARI = {"pong": "Pong-v5", "freeway": "Freeway-v5", "seaquest": "Seaquest-v5",
         "space_invaders": "SpaceInvaders-v5", "asteroids": "Asteroids-v5",
         "frostbite": "Frostbite-v5", "breakout": "Breakout-v5", "qbert": "Qbert-v5"}
CS = [1, 14, 28, 42, 56, 70, 84, 98, 112]   # evenly spaced for smooth linear-x curves
STEPS, TRIALS = 2000, 2


def geo(xs):
    xs = [x for x in xs if x > 0]
    return math.exp(sum(math.log(x) for x in xs) / len(xs)) if xs else 0.0


def _time(step, warmup, n, obs):
    for _ in range(warmup):
        step()
    best = 0.0
    for _ in range(TRIALS):
        t = time.perf_counter()
        for _ in range(STEPS):
            step()
        best = max(best, n * STEPS / (time.perf_counter() - t))
    return best


def ng_agg(game, C, obs):
    from playtrain.runtime.native_vec_env import NativeVecEnv
    N = 2 * C
    e = NativeVecEnv(game, num_envs=N, obs_size=obs, autoreset=True, num_threads=C)
    e.reset(seeds=np.arange(N, dtype=np.int32))
    a = np.random.randint(0, 8, size=N).astype(np.int32)
    r = _time(lambda: e.step(a), 30, N, obs)
    e.close()
    return r


def pg_agg(game, C):
    from procgen import ProcgenGym3Env
    N = 2 * C
    best = 0.0
    nts = sorted(set([min(C, 8), min(C, 16), min(C, 32), C]))
    for nt in nts:
        try:
            e = ProcgenGym3Env(num=N, env_name=game, num_threads=nt, distribution_mode="hard")
            a = np.random.randint(0, 15, size=N).astype(np.int32)
            e.observe()
            r = _time(lambda: (e.act(a), e.observe()), 30, N, 64)
            best = max(best, r)
            del e
        except Exception as ex:
            print(f"    (pg {game} C={C} nt={nt}: {str(ex)[:40]})", flush=True)
    return best


ATARI_KW = dict(img_height=84, img_width=84, gray_scale=True, stack_num=1, frame_skip=1)
PROCGEN_EP = {g: g.capitalize() + "Hard-v0" for g in PROCGEN}   # envpool procgen ids (64x64 RGB)


def ale_agg(task, C, kw=None):
    import envpool
    kw = ATARI_KW if kw is None else kw
    best = 0.0
    # sync
    try:
        e = envpool.make(task, env_type="gymnasium", num_envs=2 * C, num_threads=C, **kw)
        e.reset()
        a = np.random.randint(0, e.action_space.n, size=2 * C).astype(np.int32)
        best = max(best, _time(lambda: e.step(a), 30, 2 * C, 84))
        e.close()
    except Exception as ex:
        print(f"    (ale sync {task} C={C}: {str(ex)[:40]})", flush=True)
    # async (needs batch<num; skip at C=1)
    if C >= 2:
        for (T, B, M) in [(C, C, 3 * C), (C, C // 2, 2 * C)]:
            if B < 1 or M <= B:
                continue
            try:
                e = envpool.make(task, env_type="gym", num_envs=M, batch_size=B, num_threads=T, **kw)
                n_act = e.action_space.n
                e.async_reset()
                done = 0
                while done < 8000:
                    out = e.recv(); eid = out[-1]["env_id"]
                    e.send(np.random.randint(0, n_act, size=len(eid)).astype(np.int32), eid); done += len(eid)
                t = time.perf_counter(); done = 0
                while done < 60000:
                    out = e.recv(); eid = out[-1]["env_id"]
                    e.send(np.random.randint(0, n_act, size=len(eid)).astype(np.int32), eid); done += len(eid)
                best = max(best, done / (time.perf_counter() - t))
                del e
            except Exception as ex:
                print(f"    (ale async {task} C={C} cfg{(T,B,M)}: {str(ex)[:40]})", flush=True)
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["procgen", "atari", "procgen_envpool"], required=True)
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    out = args.out or str(_ROOT / "outputs" / "compare" / f"scaling_{args.mode}.json")

    result = {"mode": args.mode, "cores": CS, "playtrain": [], "baseline": []}
    print(f"mode={args.mode}  C sweep {CS}\n", flush=True)
    if args.mode == "procgen":
        obs = 64
        for C in CS:
            ng = geo([ng_agg(g, C, obs) for g in PROCGEN])
            pg = geo([pg_agg(g, C) for g in PROCGEN])
            result["playtrain"].append(ng); result["baseline"].append(pg)
            print(f"  C={C:<4} PlayTrain={ng:>12,.0f}   ProcGen={pg:>12,.0f}", flush=True)
    elif args.mode == "atari":
        obs = 84
        for C in CS:
            ng = geo([ng_agg(g, C, obs) for g in ATARI])
            al = geo([ale_agg(t, C) for t in ATARI.values()])
            result["playtrain"].append(ng); result["baseline"].append(al)
            print(f"  C={C:<4} PlayTrain={ng:>12,.0f}   ALE={al:>12,.0f}", flush=True)
    else:  # procgen_envpool: same 16 games, envpool's procgen wrapper (64x64 RGB)
        obs = 64
        for C in CS:
            ng = geo([ng_agg(g, C, obs) for g in PROCGEN])
            ep = geo([ale_agg(PROCGEN_EP[g], C, kw={}) for g in PROCGEN])
            result["playtrain"].append(ng); result["baseline"].append(ep)
            print(f"  C={C:<4} PlayTrain={ng:>12,.0f}   envpool-ProcGen={ep:>12,.0f}", flush=True)

    Path(out).parent.mkdir(parents=True, exist_ok=True)
    json.dump(result, open(out, "w"), indent=2)
    print(f"\nsaved {out}", flush=True)


if __name__ == "__main__":
    main()
