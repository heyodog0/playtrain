"""CLI: profile a p5 game's per-phase step cost.

Two modes, both opt-in via env vars the worker reads:
  - Per-phase wall-clock buckets (always on when --steps>0): draw, downsample,
    swap, info, framing. Printed to stderr at env.close() by the worker.
  - V8 CPU profile (--cpu-prof): writes a .cpuprofile in outputs/profile/ that
    you can load in Chrome DevTools → Performance → Load profile.

Usage:
    uv run python tools/profile.py --game flappy_bird
    uv run python tools/profile.py --game breakout --steps 2000
    uv run python tools/profile.py --game mario --cpu-prof
    PLAYTRAIN_P5_FAST_OBS=0 uv run python tools/profile.py --game flappy_bird   # profile old path
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parents[1]
PROFILE_DIR = REPO_ROOT / "outputs" / "profile"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--game", type=str, required=True)
    parser.add_argument("--steps", type=int, default=1000)
    parser.add_argument("--warmup", type=int, default=100)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--cpu-prof", action="store_true",
                        help="Also write a V8 .cpuprofile to outputs/profile/")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    os.environ["PLAYTRAIN_P5_PROFILE"] = "1"
    if args.cpu_prof:
        PROFILE_DIR.mkdir(parents=True, exist_ok=True)
        existing = os.environ.get("PLAYTRAIN_NODE_FLAGS", "")
        os.environ["PLAYTRAIN_NODE_FLAGS"] = (
            f"{existing} --cpu-prof --cpu-prof-dir={PROFILE_DIR}".strip()
        )

    # Import after env vars are set so any module-level reads pick them up.
    from playtrain.runtime import PlayTrainEnv

    print(f"Profiling {args.game}: {args.warmup} warmup + {args.steps} steps "
          f"(fast_obs={os.environ.get('PLAYTRAIN_P5_FAST_OBS', '1')})",
          file=sys.stderr)

    env = PlayTrainEnv(game=args.game, max_steps=args.steps + args.warmup + 100)
    try:
        env.reset(seed=args.seed)
        rng = np.random.default_rng(args.seed)
        for _ in range(args.warmup):
            _, _, term, trunc, _ = env.step(int(rng.integers(0, 8)))
            if term or trunc:
                env.reset(seed=args.seed)
        # Inside the worker, _profileTimings.n only counts post-this-point steps
        # if we reset it here — but we don't have an IPC for that, so the warmup
        # is included. To keep warmup out of the summary, reset the env (which
        # spins up a fresh worker would help, but here we just accept warmup is
        # included; it's a small fraction unless --warmup is huge).
        for _ in range(args.steps):
            _, _, term, trunc, _ = env.step(int(rng.integers(0, 8)))
            if term or trunc:
                env.reset(seed=args.seed)
    finally:
        env.close()  # triggers the worker's profile summary to its stderr,
                     # which env.py drains and forwards to our stderr.

    if args.cpu_prof:
        # Newest .cpuprofile in the dir is ours.
        profiles = sorted(PROFILE_DIR.glob("CPU.*.cpuprofile"),
                          key=lambda p: p.stat().st_mtime, reverse=True)
        if profiles:
            print(f"\nV8 CPU profile: {profiles[0]}", file=sys.stderr)
            print("Open in Chrome DevTools → Performance → Load profile",
                  file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
