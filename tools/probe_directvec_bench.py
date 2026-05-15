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
import statistics
import sys
import time
from typing import Any

import numpy as np

# HandRolledSubprocVecEnv lives under node_gym/_subproc_vec_env.py so it's
# importable from multiprocessing-spawned children (which can't use sys.path
# tricks) AND so we don't need to put tools/ on PYTHONPATH (which would
# shadow stdlib 'profile' via tools/profile.py and break torch._dynamo).
from node_gym._subproc_vec_env import HandRolledSubprocVecEnv  # noqa: E402


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
        # NodeVecEnv (Gymnasium 1.0): seed= accepts int or list.
        venv.reset(seed=seeds)
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


def bench_sb3_venv(label: str, venv, *, n: int, steps: int, warmup: int,
                   actions_seed: int = 0) -> dict:
    """Like bench_venv, but for SB3's SubprocVecEnv API: reset() takes no args,
    step() returns 4-tuple (obs, rewards, dones, infos)."""
    rng = np.random.default_rng(actions_seed)
    venv.reset()
    for _ in range(warmup):
        acts = rng.integers(0, 8, size=n)
        venv.step(acts)
    per_step_ns: list[int] = []
    t_start = time.perf_counter_ns()
    for _ in range(steps):
        acts = rng.integers(0, 8, size=n)
        t0 = time.perf_counter_ns()
        venv.step(acts)
        per_step_ns.append(time.perf_counter_ns() - t0)
    t_total_ns = time.perf_counter_ns() - t_start
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
                   help="Skip the hand-rolled SubprocVecEnv arm")
    p.add_argument("--skip-direct", action="store_true",
                   help="Skip the NodeVecEnv arm")
    p.add_argument("--include-sb3", action="store_true",
                   help="Also bench against stable_baselines3.SubprocVecEnv "
                        "(real production baseline). Skipped if SB3 not importable.")
    args = p.parse_args()

    games = [args.game] * args.n
    print(f"\n=== A/B bench: N={args.n}, game={args.game}, "
          f"steps={args.steps}, warmup={args.warmup} ===\n")

    results: list[dict] = []

    if not args.skip_subproc:
        print(f"[1/2] HandRolledSubprocVecEnv (N child Python procs + pickle) ...")
        # Both arms use SB3-style same-step autoreset for an apples-to-apples
        # comparison (SubprocVecEnv only does same-step; we match that on the
        # NodeVecEnv arm too).
        venv = HandRolledSubprocVecEnv(games=games, obs_size=args.obs_size,
                                       autoreset=True, autoreset_seed=0)
        try:
            r = bench_venv("SubprocVecEnv", venv, n=args.n, steps=args.steps,
                           warmup=args.warmup)
            results.append(r)
            print(fmt_row(r))
        finally:
            venv.close()

    sb3_skipped_reason: str | None = None
    if args.include_sb3:
        try:
            from stable_baselines3.common.vec_env import SubprocVecEnv as SB3SubprocVecEnv  # noqa: F401
        except ImportError as e:
            sb3_skipped_reason = f"stable_baselines3 not importable: {e}"
        else:
            print(f"[+] SB3 SubprocVecEnv (real production baseline) ...")
            from node_gym import NodeGymEnv
            def make_env_factory(game: str, obs_size: int):
                def _make():
                    return NodeGymEnv(game=game, obs_size=obs_size, obs_mode="rgb")
                return _make
            env_fns = [make_env_factory(g, args.obs_size) for g in games]
            venv = SB3SubprocVecEnv(env_fns, start_method="spawn")
            try:
                r = bench_sb3_venv("SB3 SubprocVecEnv", venv,
                                   n=args.n, steps=args.steps,
                                   warmup=args.warmup)
                results.append(r)
                print(fmt_row(r))
            finally:
                venv.close()

    if not args.skip_direct:
        # Import here so the SubprocVecEnv arm runs without parent importing
        # NodeVecEnv (cleaner timing isolation).
        from node_gym import NodeVecEnv
        idx_label = "[+]" if args.include_sb3 else "[2/2]"
        print(f"{idx_label} NodeVecEnv (1 Python proc + N Node workers via pipes/mmap) ...")
        venv = NodeVecEnv(games=games, obs_size=args.obs_size,
                          autoreset_mode="same_step", autoreset_seed=0)
        try:
            r = bench_venv("NodeVecEnv", venv, n=args.n, steps=args.steps,
                           warmup=args.warmup)
            results.append(r)
            print(fmt_row(r))
        finally:
            venv.close()

    if sb3_skipped_reason:
        print(f"\nNOTE: --include-sb3 requested but skipped — {sb3_skipped_reason}")

    if len(results) >= 2:
        # Headline delta: NodeVecEnv vs the slowest baseline (typically SubprocVec).
        direct = next((r for r in results if r["label"] == "NodeVecEnv"), None)
        if direct is not None:
            for baseline in results:
                if baseline["label"] == "NodeVecEnv":
                    continue
                delta_sps = direct["aggregate_sps"] - baseline["aggregate_sps"]
                delta_pct = 100.0 * delta_sps / baseline["aggregate_sps"]
                delta_us = baseline["mean_step_us"] - direct["mean_step_us"]
                print(f"\n  vs {baseline['label']!s}:")
                print(f"    Δ aggregate sps : {delta_sps:+8.0f}  ({delta_pct:+5.1f}%)")
                print(f"    Δ mean step    : {-delta_us:+8.0f} μs   (negative = faster)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
