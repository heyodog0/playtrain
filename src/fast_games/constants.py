"""Frozen, paper-archival constants for the fast-games benchmark.

Mirrors `train_procgen/constants.py` from the OpenAI baseline:
  - CANONICAL_GAMES: the official catalog used in the paper / sweeps
  - RANDOM_BASELINES: per-game random-agent mean return
  - BEST_BASELINES:   per-game best-attainable score (current best PPO run,
                      stand-in for "expert" until a better source exists)

Numbers are loaded from `outputs/baselines/random_agent_scores.json` and
`outputs/experiments/...` lazily — committing them here would mean re-running
the whole grid for any change. To freeze a snapshot for a paper, call
`freeze_constants()` and commit the resulting dict literal in this file.

Score normalization uses ProcGen-style:
    normalized = (agent - random) / (best - random)
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np


REPO_ROOT = Path(__file__).resolve().parents[2]
BASELINES_PATH = REPO_ROOT / "outputs" / "baselines" / "random_agent_scores.json"
EXPERIMENTS_DIR = REPO_ROOT / "outputs" / "experiments"


# Canonical game list — the 30 games we ship with all 5 validation checks
# passing. Keep this in sync with games/js/*.js when adding new games to the
# paper sweep.
CANONICAL_GAMES: tuple[str, ...] = (
    "angry_birds",
    "asteroids",
    "bigfish",
    "bossfight",
    "breakout",
    "caveflyer",
    "chaser",
    "climber",
    "coinrun",
    "crossy_road",
    "dodgeball",
    "downwell",
    "flappy_bird",
    "freeway",
    "frostbite",
    "fruitbot",
    "heist",
    "jetpack_joyride",
    "jumper",
    "leaper",
    "mario",
    "maze",
    "miner",
    "ninja",
    "plunder",
    "sonic",
    "space_invaders",
    "starpilot",
    "suika",
    "vvvvvv",
)


def load_random_baselines() -> dict[str, float]:
    """Per-game random-agent mean return from outputs/baselines/.

    Returns empty dict if baselines haven't been collected yet — callers
    should treat that as "skip normalization, report raw scores".
    """
    if not BASELINES_PATH.exists():
        return {}
    data = json.loads(BASELINES_PATH.read_text())
    out: dict[str, float] = {}
    for game, entry in data.get("baselines", {}).items():
        if "mean_return" in entry:
            out[game] = float(entry["mean_return"])
    return out


def load_best_baselines() -> dict[str, float]:
    """Per-game best mean episode return across all PPO runs found in outputs/.

    Stand-in for "expert" or "human" baseline. Walks every
    `outputs/experiments/{game}/ppo/{ts}/eval/evaluations.npz` and reports the
    max-over-time of mean-eval-return per game. Returns empty dict if no runs
    are present.
    """
    if not EXPERIMENTS_DIR.exists():
        return {}
    out: dict[str, float] = {}
    for game_dir in EXPERIMENTS_DIR.iterdir():
        if not game_dir.is_dir() or game_dir.name == "multigame":
            continue
        ppo_dir = game_dir / "ppo"
        if not ppo_dir.exists():
            continue
        best = float("-inf")
        for run_dir in ppo_dir.iterdir():
            evals = run_dir / "eval" / "evaluations.npz"
            if not evals.exists():
                continue
            try:
                data = np.load(str(evals))
                if "results" in data and len(data["results"]) > 0:
                    run_best = float(data["results"].mean(axis=1).max())
                    best = max(best, run_best)
            except Exception:
                pass
        if best > float("-inf"):
            out[game_dir.name] = best
    return out


def normalize_procgen(raw: float, random: float, best: float) -> float:
    """ProcGen normalization: (agent - random) / (best - random).

    Clamps the denominator at 1e-6 to avoid divide-by-zero when best ≈ random.
    Output is roughly in [0, 1] for in-distribution agents but can exceed 1
    if the agent beats the recorded "best" (in which case best should be
    refreshed).
    """
    denom = max(best - random, 1e-6)
    return (raw - random) / denom


def freeze_constants() -> str:
    """Emit a Python literal block snapshotting the current baselines.

    Print the output, paste into this file under a `RANDOM_BASELINES_FROZEN`
    / `BEST_BASELINES_FROZEN` constant, and commit. Use before paper writeup
    so figure regeneration doesn't depend on `outputs/` being intact.
    """
    rb = load_random_baselines()
    bb = load_best_baselines()
    lines = ["RANDOM_BASELINES_FROZEN: dict[str, float] = {"]
    for g in CANONICAL_GAMES:
        if g in rb:
            lines.append(f"    {g!r}: {rb[g]:.4f},")
    lines.append("}")
    lines.append("")
    lines.append("BEST_BASELINES_FROZEN: dict[str, float] = {")
    for g in CANONICAL_GAMES:
        if g in bb:
            lines.append(f"    {g!r}: {bb[g]:.4f},")
    lines.append("}")
    return "\n".join(lines)


# Frozen snapshots — populated by paste from `freeze_constants()` for paper runs.
# Empty by default so live values from outputs/ are used.
RANDOM_BASELINES_FROZEN: dict[str, float] = {}
BEST_BASELINES_FROZEN: dict[str, float] = {}


def get_random_baselines(use_frozen: bool = False) -> dict[str, float]:
    if use_frozen and RANDOM_BASELINES_FROZEN:
        return dict(RANDOM_BASELINES_FROZEN)
    return load_random_baselines()


def get_best_baselines(use_frozen: bool = False) -> dict[str, float]:
    if use_frozen and BEST_BASELINES_FROZEN:
        return dict(BEST_BASELINES_FROZEN)
    return load_best_baselines()


if __name__ == "__main__":
    # `python -m fast_games.constants` -> print live snapshot for inspection
    print(freeze_constants())
