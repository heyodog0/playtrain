"""Multi-seed × multi-game training sweep.

Fans out a grid of (game, seed) into per-run subprocesses, each writing to
`outputs/sweeps/{sweep_id}/{game}/seed{N}/`. Designed for server runs where
you want one sweep_id you can `rsync` back wholesale.

Usage:
    # Per-game PPO sweep across the canonical 30, 3 seeds each
    uv run python -m fast_games.sweep --algo ppo --games all --seeds 0 1 2 \\
        --config configs/full_run.json

    # Multigame ProcGen-style sweep (one sweep_id per seed)
    uv run python -m fast_games.sweep --algo multigame --seeds 0 1 2 \\
        --config configs/full_run.json

    # Foreground (live tail) — useful for one-off
    uv run python -m fast_games.sweep --algo ppo --games breakout --seeds 0 1 \\
        --config configs/smoke_test.json --foreground
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from fast_games.constants import CANONICAL_GAMES

REPO_ROOT = Path(__file__).resolve().parents[2]
SWEEPS_DIR = REPO_ROOT / "outputs" / "sweeps"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Multi-seed RL sweep runner")
    p.add_argument("--algo", choices=["ppo", "dqn", "multigame"], required=True)
    p.add_argument("--games", nargs="+", default=["all"],
                   help="Game names, or 'all' for the canonical 30. Ignored for --algo multigame.")
    p.add_argument("--seeds", nargs="+", type=int, required=True)
    p.add_argument("--config", type=Path, required=True)
    p.add_argument("--sweep-id", type=str, default=None,
                   help="Defaults to {algo}_{timestamp}.")
    p.add_argument("--max-parallel", type=int, default=1,
                   help="Max concurrent runs (default 1; bump on multi-GPU servers).")
    p.add_argument("--foreground", action="store_true",
                   help="Tail each run's output to this terminal (sequential).")
    p.add_argument("--use-wandb", action="store_true")
    p.add_argument("--extra", nargs=argparse.REMAINDER, default=[],
                   help="Extra args forwarded to the training script (after --).")
    return p.parse_args()


def resolve_games(games_arg: list[str]) -> list[str]:
    if games_arg == ["all"]:
        return list(CANONICAL_GAMES)
    return games_arg


def build_command(algo: str, game: str | None, seed: int, config: Path,
                  output_dir: Path, use_wandb: bool, extra: list[str]) -> list[str]:
    """Build the argv for one run."""
    base: list[str] = ["uv", "run", "python", "-m"]
    if algo == "ppo":
        base += ["fast_games.train.ppo", "--game", game, "--config", str(config)]
    elif algo == "dqn":
        base += ["fast_games.train.dqn", "--game", game, "--config", str(config)]
    elif algo == "multigame":
        base += ["fast_games.train.multigame", "--all-games", "--config", str(config)]
    else:
        raise ValueError(f"unknown algo {algo}")
    base += ["--seed", str(seed), "--output-dir", str(output_dir)]
    if use_wandb:
        base += ["--use-wandb"]
    if extra:
        base += extra
    return base


def run_one(cmd: list[str], log_path: Path, foreground: bool) -> subprocess.Popen:
    """Spawn a single training run; log stdout/stderr to log_path."""
    log_path.parent.mkdir(parents=True, exist_ok=True)
    if foreground:
        # Inherit stdout/stderr — user sees everything live, sequential only
        return subprocess.Popen(cmd, cwd=str(REPO_ROOT))
    log_f = open(log_path, "w", buffering=1)
    return subprocess.Popen(
        cmd, cwd=str(REPO_ROOT), stdout=log_f, stderr=subprocess.STDOUT,
        env={**os.environ, "PYTHONUNBUFFERED": "1"},
    )


def main() -> int:
    args = parse_args()

    # Strip a leading "--" from --extra so users can write `... -- --norm-reward false`
    extra = args.extra
    if extra and extra[0] == "--":
        extra = extra[1:]

    sweep_id = args.sweep_id or f"{args.algo}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    sweep_root = SWEEPS_DIR / sweep_id
    sweep_root.mkdir(parents=True, exist_ok=True)

    # Build the (game, seed) grid
    grid: list[tuple[str | None, int, Path]] = []
    if args.algo == "multigame":
        for seed in args.seeds:
            run_dir = sweep_root / "multigame" / f"seed{seed}"
            grid.append((None, seed, run_dir))
    else:
        games = resolve_games(args.games)
        for game in games:
            for seed in args.seeds:
                run_dir = sweep_root / game / f"seed{seed}"
                grid.append((game, seed, run_dir))

    # Write a manifest so `pull-results` knows what's expected
    manifest = {
        "sweep_id": sweep_id,
        "algo": args.algo,
        "games": resolve_games(args.games) if args.algo != "multigame" else None,
        "seeds": args.seeds,
        "config": str(args.config),
        "extra_args": extra,
        "use_wandb": args.use_wandb,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "n_runs": len(grid),
        "max_parallel": args.max_parallel,
        "host": os.uname().nodename,
    }
    (sweep_root / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")

    print(f"[sweep] {sweep_id} — {len(grid)} runs, max_parallel={args.max_parallel}, "
          f"foreground={args.foreground}")
    print(f"[sweep] root: {sweep_root}")
    sys.stdout.flush()

    # Drive the queue
    in_flight: list[tuple[subprocess.Popen, str, Path]] = []
    queue = list(grid)
    failures: list[tuple[str, int]] = []
    completed = 0

    def label(g: str | None, s: int) -> str:
        return f"{g or 'multigame'}/seed{s}"

    while queue or in_flight:
        # Launch up to max_parallel
        while queue and len(in_flight) < args.max_parallel:
            game, seed, run_dir = queue.pop(0)
            run_dir.mkdir(parents=True, exist_ok=True)
            cmd = build_command(args.algo, game, seed, args.config, run_dir,
                                args.use_wandb, extra)
            log_path = run_dir / "sweep.log"
            print(f"[sweep] start  {label(game, seed)}  →  {run_dir}")
            sys.stdout.flush()
            proc = run_one(cmd, log_path, args.foreground)
            in_flight.append((proc, label(game, seed), run_dir))

        # Reap finished
        still: list[tuple[subprocess.Popen, str, Path]] = []
        for proc, lbl, run_dir in in_flight:
            rc = proc.poll()
            if rc is None:
                still.append((proc, lbl, run_dir))
                continue
            completed += 1
            if rc == 0:
                print(f"[sweep] done   {lbl}  ({completed}/{len(grid)})")
            else:
                print(f"[sweep] FAIL   {lbl}  rc={rc}  log={run_dir / 'sweep.log'}")
                failures.append((lbl, rc))
            sys.stdout.flush()
        in_flight = still

        if in_flight:
            time.sleep(2)

    # Finalize manifest
    manifest["completed_at"] = datetime.now(timezone.utc).isoformat()
    manifest["failures"] = [{"run": lbl, "rc": rc} for lbl, rc in failures]
    (sweep_root / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")

    print(f"\n[sweep] {sweep_id} complete: {completed - len(failures)}/{len(grid)} ok, "
          f"{len(failures)} failed")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
