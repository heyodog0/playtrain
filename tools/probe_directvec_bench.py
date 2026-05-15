"""A/B bench: NodeVecEnv vs hand-rolled SubprocVecEnv at N=N envs.

The hand-rolled SubprocVecEnv mirrors SB3's: one multiprocessing.Process per
env, parent communicates via multiprocessing.Pipe, obs travels by pickle. Each
child process owns one NodeGymEnv (which itself spawns a Node worker with mmap).
This is the architecture analogen's training currently uses.

NodeVecEnv: one Python process drives N Node workers directly via stdin/stdout
pipes + mmap. No child Python processes, no pickle.

Reports: aggregate steps/sec, mean per-vec-step latency (μs), and the relative
throughput delta. Use this to validate the design-doc estimate that DirectVecEnv
recovers ~93 μs/step of coordination overhead at N=8.
"""

from __future__ import annotations

import argparse
import multiprocessing as mp
import statistics
import sys
import time
from typing import Any

import numpy as np


# ---------------------------------------------------------------------------
# Hand-rolled SubprocVecEnv (matches SB3's mechanics: Process + Pipe + pickle)
# ---------------------------------------------------------------------------


def _subproc_worker(remote, parent_remote, game: str, obs_size: int,
                    obs_mode: str, max_steps: int) -> None:
    parent_remote.close()
    # Import inside child so the parent never imports node_gym (avoid double
    # mmap setup in parent on fork-based platforms).
    from node_gym import NodeGymEnv
    env = NodeGymEnv(game=game, obs_size=obs_size, obs_mode=obs_mode,
                     max_steps=max_steps)
    try:
        while True:
            cmd, data = remote.recv()
            if cmd == "step":
                obs, reward, term, trunc, info = env.step(int(data))
                remote.send((obs, float(reward), bool(term), bool(trunc), info))
            elif cmd == "reset":
                obs, info = env.reset(seed=data)
                remote.send((obs, info))
            elif cmd == "close":
                remote.send("ok")
                break
            else:
                remote.send(("error", f"unknown cmd {cmd}"))
                break
    finally:
        env.close()
        remote.close()


class HandRolledSubprocVecEnv:
    """Minimal SB3-equivalent: N child Python processes, each owns one NodeGymEnv."""

    def __init__(self, *, games: list[str], obs_size: int = 64,
                 obs_mode: str = "rgb", max_steps: int = 2000) -> None:
        self.num_envs = len(games)
        ctx = mp.get_context("spawn")
        self.remotes, self.work_remotes = zip(*[ctx.Pipe() for _ in range(self.num_envs)])
        self.processes: list[mp.Process] = []
        for game, work_remote, remote in zip(games, self.work_remotes, self.remotes):
            p = ctx.Process(target=_subproc_worker,
                            args=(work_remote, remote, game, obs_size, obs_mode, max_steps),
                            daemon=True)
            p.start()
            work_remote.close()
            self.processes.append(p)
        self._closed = False

    def reset(self, seeds: list[int | None]) -> np.ndarray:
        for r, s in zip(self.remotes, seeds):
            r.send(("reset", s))
        results = [r.recv() for r in self.remotes]
        obs = np.stack([o for o, _ in results], axis=0)
        return obs

    def step(self, actions) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, list]:
        for r, a in zip(self.remotes, actions):
            r.send(("step", int(a)))
        results = [r.recv() for r in self.remotes]
        obs = np.stack([t[0] for t in results], axis=0)
        rewards = np.array([t[1] for t in results], dtype=np.float32)
        terms = np.array([t[2] for t in results], dtype=bool)
        truncs = np.array([t[3] for t in results], dtype=bool)
        infos = [t[4] for t in results]
        return obs, rewards, terms, truncs, infos

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        for r in self.remotes:
            try:
                r.send(("close", None))
                r.recv()
            except Exception:
                pass
            try:
                r.close()
            except Exception:
                pass
        for p in self.processes:
            p.join(timeout=2)
            if p.is_alive():
                p.terminate()
                p.join(timeout=2)

    def __del__(self) -> None:
        try:
            self.close()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Bench harness
# ---------------------------------------------------------------------------


def bench_venv(label: str, venv, *, n: int, steps: int, warmup: int,
               actions_seed: int = 0) -> dict:
    rng = np.random.default_rng(actions_seed)
    seeds = [i for i in range(n)]
    if isinstance(venv, HandRolledSubprocVecEnv):
        venv.reset(seeds)
    else:
        venv.reset(seeds=seeds)
    # Warmup
    for _ in range(warmup):
        acts = rng.integers(0, 8, size=n).tolist()
        venv.step(acts)
    # Measure
    per_step_ns: list[int] = []
    t_start = time.perf_counter_ns()
    for _ in range(steps):
        acts = rng.integers(0, 8, size=n).tolist()
        t0 = time.perf_counter_ns()
        venv.step(acts)
        per_step_ns.append(time.perf_counter_ns() - t0)
    t_total_ns = time.perf_counter_ns() - t_start
    # Stats
    aggregate_sps = (steps * n) / (t_total_ns / 1e9)
    mean_step_us = statistics.fmean(per_step_ns) / 1e3
    p50_us = statistics.median(per_step_ns) / 1e3
    p95_us = sorted(per_step_ns)[int(len(per_step_ns) * 0.95)] / 1e3
    p99_us = sorted(per_step_ns)[int(len(per_step_ns) * 0.99)] / 1e3
    return {
        "label": label,
        "n": n,
        "steps": steps,
        "aggregate_sps": aggregate_sps,
        "per_env_sps": aggregate_sps / n,
        "mean_step_us": mean_step_us,
        "p50_us": p50_us,
        "p95_us": p95_us,
        "p99_us": p99_us,
        "wall_s": t_total_ns / 1e9,
    }


def fmt_row(r: dict) -> str:
    return (f"  {r['label']:<22} N={r['n']}  "
            f"agg {r['aggregate_sps']:7.0f} sps  "
            f"per-env {r['per_env_sps']:6.0f}  "
            f"mean {r['mean_step_us']:7.0f} μs  "
            f"p50 {r['p50_us']:7.0f}  p95 {r['p95_us']:7.0f}  p99 {r['p99_us']:7.0f}")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--n", type=int, default=8)
    p.add_argument("--game", default="flappy_bird")
    p.add_argument("--steps", type=int, default=500)
    p.add_argument("--warmup", type=int, default=50)
    p.add_argument("--obs-size", type=int, default=64)
    p.add_argument("--skip-subproc", action="store_true",
                   help="Skip the SubprocVecEnv arm (e.g. just smoke-bench DirectVec)")
    p.add_argument("--skip-direct", action="store_true",
                   help="Skip the DirectVecEnv arm")
    args = p.parse_args()

    games = [args.game] * args.n
    print(f"\n=== A/B bench: N={args.n}, game={args.game}, "
          f"steps={args.steps}, warmup={args.warmup} ===\n")

    results: list[dict] = []

    if not args.skip_subproc:
        print(f"[1/2] HandRolledSubprocVecEnv (N child Python procs + pickle) ...")
        venv = HandRolledSubprocVecEnv(games=games, obs_size=args.obs_size)
        try:
            r = bench_venv("SubprocVecEnv", venv, n=args.n, steps=args.steps,
                           warmup=args.warmup)
            results.append(r)
            print(fmt_row(r))
        finally:
            venv.close()

    if not args.skip_direct:
        # Import here so the SubprocVecEnv arm runs without parent importing
        # NodeVecEnv (cleaner timing isolation).
        from node_gym import NodeVecEnv
        print(f"[2/2] NodeVecEnv (1 Python proc + N Node workers via pipes/mmap) ...")
        venv = NodeVecEnv(games=games, obs_size=args.obs_size)
        try:
            r = bench_venv("NodeVecEnv", venv, n=args.n, steps=args.steps,
                           warmup=args.warmup)
            results.append(r)
            print(fmt_row(r))
        finally:
            venv.close()

    if len(results) == 2:
        sub, direct = results
        delta_sps = direct["aggregate_sps"] - sub["aggregate_sps"]
        delta_pct = 100.0 * delta_sps / sub["aggregate_sps"]
        delta_us = sub["mean_step_us"] - direct["mean_step_us"]
        print(f"\n  Δ aggregate sps : {delta_sps:+8.0f}  ({delta_pct:+5.1f}%)")
        print(f"  Δ mean step    : {-delta_us:+8.0f} μs   (negative = faster)")
        print(f"  → DirectVecEnv saves ~{delta_us:.0f} μs/step coordination overhead")

    return 0


if __name__ == "__main__":
    sys.exit(main())
