"""ProcGen-style metrics for comparing RL algorithms across games.

Key metrics:
  - Normalized score: (agent - random) / max(1, |random|)
  - Interquartile Mean (IQM): trim top/bottom 25%, average the middle
  - Per-game and aggregate statistics
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np


def normalize_score(
    agent_score: float,
    random_mean: float,
    random_std: float,
) -> float:
    """Normalize agent score relative to random baseline.

    Returns a value where:
      0.0 = random agent performance
      1.0 = one standard deviation above random
    If random_std is ~0, falls back to (agent - random) / max(1, |random|).
    """
    if random_std > 1e-6:
        return (agent_score - random_mean) / random_std
    denom = max(1.0, abs(random_mean))
    return (agent_score - random_mean) / denom


def interquartile_mean(scores: list[float] | np.ndarray) -> float:
    """Compute the Interquartile Mean (IQM).

    Trim the bottom 25% and top 25% of scores, then average
    the remaining middle 50%. Standard ProcGen aggregate metric.
    """
    arr = np.sort(np.asarray(scores, dtype=np.float64))
    n = len(arr)
    if n < 4:
        return float(arr.mean())
    q1 = n // 4
    q3 = 3 * n // 4
    return float(arr[q1:q3].mean())


def load_random_baselines(path: str | Path) -> dict[str, dict]:
    """Load random agent baselines from JSON file."""
    data = json.loads(Path(path).read_text())
    return data.get("baselines", data)


def compute_normalized_scores(
    agent_scores: dict[str, float],
    baselines: dict[str, dict],
) -> dict[str, float]:
    """Compute normalized score per game."""
    normalized = {}
    for game, score in agent_scores.items():
        if game in baselines and "mean_return" in baselines[game]:
            bl = baselines[game]
            normalized[game] = normalize_score(score, bl["mean_return"], bl["std_return"])
        else:
            normalized[game] = score
    return normalized


def aggregate_results(
    per_game_scores: dict[str, float],
) -> dict[str, float]:
    """Compute aggregate metrics from per-game normalized scores."""
    scores = list(per_game_scores.values())
    if not scores:
        return {}
    arr = np.array(scores)
    return {
        "mean": float(arr.mean()),
        "median": float(np.median(arr)),
        "iqm": interquartile_mean(arr),
        "std": float(arr.std()),
        "min": float(arr.min()),
        "max": float(arr.max()),
        "n_games": len(scores),
    }
