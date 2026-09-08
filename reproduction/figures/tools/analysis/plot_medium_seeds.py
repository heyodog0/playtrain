"""Minimal 3-seed overlay of the medium 2000-decision IMPALA+LSTM run, in the
run-card house style (faint raw + bold smoothed, despined, dotted reference).

The three runs differ only in seed, so they're labelled seed 0/1/2. Reads each
run's TB scalar `charts/ep_return_mean`.

Pull the runs first if they aren't local (tb only is enough):
    NO_CKPT=1 ./pull_results.sh 23525671   # (and 23525682, 23525683)

Then:
    uv run python tools/analysis/plot_medium_seeds.py --out outputs/figs/medium_seeds.png
"""
import argparse
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from tensorboard.backend.event_processing import event_accumulator

# seed -> run dir. Only the seed differs across the three.
SEEDS = [
    ("seed 0", "outputs/impala_23525671", "#1b9e77"),
    ("seed 1", "outputs/impala_23525682", "#d95f02"),
    ("seed 2", "outputs/impala_23525683", "#7570b3"),
]
WIN_THRESHOLD = 30_000  # dotted reference, matches the run-card convention


def load_curve(run_dir: Path):
    """(steps, returns) for charts/ep_return_mean from the LATEST event file.

    Picking the newest event file (not the whole dir) avoids the requeue
    zig-zag artifact — see make_run_card.load_curve for the rationale."""
    tb = run_dir / "tb"
    evs = sorted(tb.glob("events.out.tfevents.*"))
    if not evs:
        raise FileNotFoundError(f"no event files in {tb}")
    ea = event_accumulator.EventAccumulator(str(evs[-1]), size_guidance={"scalars": 0})
    ea.Reload()
    tags = ea.Tags()["scalars"]
    if "charts/ep_return_mean" not in tags:
        raise KeyError(f"no charts/ep_return_mean in {evs[-1].name}; have {tags}")
    s = ea.Scalars("charts/ep_return_mean")
    return (np.array([e.step for e in s], dtype=np.int64),
            np.array([e.value for e in s], dtype=np.float32))


def rolling_mean(x: np.ndarray, window: int) -> np.ndarray:
    """Centered rolling mean (same smoother as make_run_card)."""
    if window <= 1 or x.size <= window:
        return x.astype(float, copy=True)
    out = np.full_like(x, np.nan, dtype=float)
    half = window // 2
    for i in range(x.size):
        seg = x[max(0, i - half):min(x.size, i + half + 1)]
        out[i] = seg.mean()
    return out


def auto_window(n: int) -> int:
    return int(np.clip(n * 0.04, 5, 2000))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="outputs/figs/medium_seeds.png")
    ap.add_argument("--title",
                    default="analogen_cavequest_medium — IMPALA+LSTM — 25M")
    args = ap.parse_args()

    fig, ax = plt.subplots(figsize=(7.0, 4.6), dpi=140)
    plotted = 0
    for label, d, color in SEEDS:
        rd = Path(d)
        try:
            steps, rets = load_curve(rd)
        except (FileNotFoundError, KeyError) as e:
            print(f"  skip {label}: {e}")
            continue
        x = steps / 1e6
        smooth = rolling_mean(rets, auto_window(rets.size))
        ax.plot(x, rets, color=color, lw=0.6, alpha=0.15)          # faint raw
        ax.plot(x, smooth, color=color, lw=1.8, label=label)       # bold smoothed
        plotted += 1

    if not plotted:
        raise SystemExit("no runs found locally — pull them first "
                         "(NO_CKPT=1 ./pull_results.sh <jobid>)")

    ax.axhline(WIN_THRESHOLD, color="gray", lw=0.6, ls=":")
    ax.set_title(args.title, fontsize=12)
    ax.set_xlabel("env steps (M)")
    ax.set_ylabel("episode return")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.legend(frameon=False, loc="center right")
    fig.tight_layout()
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(args.out, dpi=140, bbox_inches="tight")
    print("wrote", args.out)


if __name__ == "__main__":
    main()
