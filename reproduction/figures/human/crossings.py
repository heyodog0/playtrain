"""Steps needed for each trainer to reach the human mean, per game.

Recomputes the numbers quoted in section 4.3. They must be recomputed whenever
the curves are rebuilt: the previously published values were Nature-encoder
runs, and both arms are now IMPALA-CNN.

Crossing rule: the first step at which the 3-seed mean reaches the threshold AND
stays within 10% of it for the remainder of the run. The trailing condition is
what stops a curve that touches the line once and collapses from counting.

usage: python crossings.py CURVES.json STUDY_DATA_DIR
"""
from __future__ import annotations

import glob
import json
import os
import re
import statistics as st
import sys

import numpy as np

NON_PARTICIPANT = re.compile(
    r'^(probe|playtest|debug|incident|deploycheck|readycheck|smoke|test|anon|final)',
    re.I)
MIN_START = "2026-08-05T16:52:00Z"


def human_means(data_dir: str):
    """Mean over participants of each participant's mean score per game.

    Parsing is copied from plot_steps.py so the threshold here is exactly the
    line drawn in the figure: skip non-participants, partials, unfinished and
    pre-cutoff sessions; skip practice blocks and discarded episodes.
    """
    human: dict[str, list[float]] = {}
    for f in sorted(glob.glob(os.path.join(data_dir, "*.json"))):
        d = json.load(open(f))
        if (NON_PARTICIPANT.match(d.get("participantId", "")) or d.get("partial")
                or not d.get("finishedAt") or d.get("startedAt", "") < MIN_START):
            continue
        for b in d.get("blocks", []):
            g = b.get("game")
            if not g or b.get("practice"):
                continue
            sc = [e["score"] for e in b.get("episodes", []) if not e.get("discarded")]
            if sc:
                human.setdefault(g, []).append(st.mean(sc))
    return ({g: st.mean(v) for g, v in human.items()},
            {g: len(v) for g, v in human.items()})


def mean_curve(runs: list[dict], n: int = 400):
    """3-seed mean on a common step grid."""
    lo = max(min(r["step"]) for r in runs)
    hi = min(max(r["step"]) for r in runs)
    grid = np.linspace(lo, hi, n)
    ys = np.stack([np.interp(grid, r["step"], r["value"]) for r in runs])
    return grid, ys.mean(0)


def crossing(grid, y, thr: float, tol: float = 0.10):
    """First step reaching thr and staying within tol of it thereafter."""
    for i in range(len(grid)):
        if y[i] >= thr and (y[i:] >= thr * (1 - tol)).all():
            return float(grid[i])
    return None


def main() -> int:
    curves_path, data_dir = sys.argv[1], sys.argv[2]
    d = json.load(open(curves_path))
    hmean, hn = human_means(data_dir)

    print(f"{'game':<13}{'human':>9}{'IMPALA':>14}{'PPO':>14}   final (I / P)")
    for game in d["curves"]:
        thr = hmean.get(game)
        if thr is None:
            print(f"{game:<13}  no human data")
            continue
        out, finals = {}, {}
        for label, key in (("IMPALA", "curves"), ("PPO", "ppo_curves")):
            runs = d[key].get(game) or []
            if not runs:
                out[label], finals[label] = "no runs", float("nan")
                continue
            grid, y = mean_curve(runs)
            x = crossing(grid, y, thr)
            out[label] = "never" if x is None else f"{x / 1e6:,.1f}M"
            finals[label] = float(y[-1])
        print(f"{game:<13}{thr:9.1f}{out['IMPALA']:>14}{out['PPO']:>14}"
              f"   {finals['IMPALA']:.0f} / {finals['PPO']:.0f}"
              f"   (n={hn.get(game, 0)})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
