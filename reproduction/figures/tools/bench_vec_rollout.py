"""Measure vec-mode rollout throughput: decisions/s of (batched GPU forward ->
NativeVecEnv.step) — the number that says what inference_mode='vec' actually
sustains on a given node, per game.

    python tools/bench_vec_rollout.py --game analogen_cavequest_hard_explore \
        --frame-skip 7 --envs 128,256 --workers 1,3 --env-threads 0

Reports, for each (envs, workers) combo: decisions/s (= policy queries/s,
the trainer's SPS unit), game frames/s (= decisions x frame_skip), and the
per-vector-step latency split. --no-model isolates the env side (no GPU).

Workers run as separate spawned processes, each with its own NativeVecEnv
(env-threadpool of --env-threads) and its own model copy on the GPU —
exactly the vec_actor architecture minus the learner.
"""
from __future__ import annotations

import argparse
import json
import multiprocessing as mp
import os
import time
from pathlib import Path


def _worker(rank, args_d, out_q):
    import numpy as np
    import torch
    from playtrain.runtime.native_vec_env import NativeVecEnv

    torch.set_num_threads(1)
    M = args_d["envs"]
    device = args_d["device"]
    if device == "auto":
        device = ("cuda" if torch.cuda.is_available() else
                  "mps" if torch.backends.mps.is_available() else "cpu")

    env = NativeVecEnv(
        args_d["game"], num_envs=M, autoreset=True,
        frame_skip=args_d["frame_skip"], max_steps=args_d["max_steps"],
        num_threads=args_d["env_threads"],
        games_dir=args_d["games_dir"] or None,
    )
    model = None
    if not args_d["no_model"]:
        from playtrain_trainers.impala.net import ImpalaNet
        torch.manual_seed(rank)
        model = ImpalaNet((3, 64, 64), 8).to(device)
        model.train()

    obs = env.reset(seeds=(np.arange(M, dtype=np.int32) + rank * M))
    act = np.zeros(M, dtype=np.int32)
    rng = np.random.default_rng(rank)

    def one_step():
        nonlocal obs
        t0 = time.perf_counter()
        if model is not None:
            frame = torch.from_numpy(obs).permute(0, 3, 1, 2).unsqueeze(0).to(
                device, non_blocking=True)
            with torch.no_grad():
                out, _ = model({
                    "frame": frame,
                    "reward": torch.zeros(1, M, device=device),
                    "done": torch.zeros(1, M, dtype=torch.bool, device=device),
                    "last_action": torch.zeros(1, M, dtype=torch.int64,
                                               device=device),
                }, ())
            np.copyto(act, out["action"][0].cpu().numpy().astype(np.int32))
        else:
            np.copyto(act, rng.integers(0, 8, M).astype(np.int32))
        t1 = time.perf_counter()
        obs = env.step(act)[0]
        t2 = time.perf_counter()
        return t1 - t0, t2 - t1

    for _ in range(args_d["warmup"]):
        one_step()
    infer_s = env_s = 0.0
    t0 = time.perf_counter()
    for _ in range(args_d["steps"]):
        a, b = one_step()
        infer_s += a
        env_s += b
    dt = time.perf_counter() - t0
    env.close()
    out_q.put(dict(rank=rank, decisions_per_s=args_d["steps"] * M / dt,
                   ms_infer=1000 * infer_s / args_d["steps"],
                   ms_env=1000 * env_s / args_d["steps"],
                   env_threads=env.num_threads, device=device))


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--game", required=True)
    p.add_argument("--frame-skip", type=int, default=1)
    p.add_argument("--envs", default="128", help="comma list of envs/worker")
    p.add_argument("--workers", default="1", help="comma list of worker counts")
    p.add_argument("--env-threads", type=int, default=0,
                   help="C++ threadpool per worker; 0 = host default. With "
                        "multiple workers set ~cores/workers.")
    p.add_argument("--steps", type=int, default=200)
    p.add_argument("--warmup", type=int, default=20)
    p.add_argument("--max-steps", type=int, default=2000, help="frames/episode")
    p.add_argument("--device", default="auto")
    p.add_argument("--no-model", action="store_true",
                   help="random actions, no GPU — isolates env throughput")
    p.add_argument("--games-dir", default="")
    p.add_argument("--out", type=Path, default=None)
    args = p.parse_args()

    rows = []
    for W in (int(x) for x in args.workers.split(",")):
        for M in (int(x) for x in args.envs.split(",")):
            d = dict(game=args.game, frame_skip=args.frame_skip, envs=M,
                     env_threads=args.env_threads, steps=args.steps,
                     warmup=args.warmup, max_steps=args.max_steps,
                     device=args.device, no_model=args.no_model,
                     games_dir=args.games_dir)
            ctx = mp.get_context("spawn")
            out_q = ctx.Queue()
            procs = [ctx.Process(target=_worker, args=(r, d, out_q))
                     for r in range(W)]
            t0 = time.perf_counter()
            for pr in procs:
                pr.start()
            results = [out_q.get() for _ in procs]
            for pr in procs:
                pr.join()
            del t0
            total = sum(r["decisions_per_s"] for r in results)
            row = dict(game=args.game, workers=W, envs_per_worker=M,
                       frame_skip=args.frame_skip,
                       decisions_per_s=round(total),
                       frames_per_s=round(total * args.frame_skip),
                       per_worker=[round(r["decisions_per_s"]) for r in results],
                       ms_infer=round(sum(r["ms_infer"] for r in results) / W, 2),
                       ms_env=round(sum(r["ms_env"] for r in results) / W, 2),
                       env_threads=results[0]["env_threads"],
                       device=results[0]["device"])
            rows.append(row)
            print(row, flush=True)

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(rows, indent=2))
        print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
