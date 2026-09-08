"""Per-game learning-curve grid from extract_tb_curves.py JSON.

Each panel autoscales its y-axis (the run-card 30k-threshold scaling made
curves unreadable). Repro runs of the same game overlay on one panel.
Usage: python tools/plot_learning_curves.py IN.json OUT.png
"""
import json, sys, math
from collections import defaultdict
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

data = json.load(open(sys.argv[1]))
by_game = defaultdict(list)
for run, e in data.items():
    if e["series"]:
        tag = sorted(e["series"])[0]
        by_game[e["game"]].append((run, e["series"][tag]))

games = sorted(by_game)
n = len(games)
cols = 6
rows = math.ceil(n / cols)
fig, axes = plt.subplots(rows, cols, figsize=(3.2 * cols, 2.6 * rows))
axes = axes.ravel()
for ax in axes[n:]:
    ax.axis("off")
for ax, g in zip(axes, games):
    for run, series in sorted(by_game[g]):
        xs = [s / 1e6 for s, _ in series]
        ys = [v for _, v in series]
        ax.plot(xs, ys, lw=1.2, alpha=0.9)
    last = [s[-1][1] for _, s in by_game[g]]
    first = [s[0][1] for _, s in by_game[g]]
    nruns = len(by_game[g])
    ax.set_title(f"{g}  ({nruns} run{'s' if nruns>1 else ''})  "
                 f"{sum(first)/nruns:.1f}→{sum(last)/nruns:.1f}", fontsize=9)
    ax.tick_params(labelsize=7)
    ax.grid(alpha=0.25)
fig.supxlabel("env steps (M)")
fig.supylabel("mean episode return (training)")
fig.suptitle(sys.argv[3] if len(sys.argv) > 3 else "b256 suite (~1.1M SPS runs) — training return curves", y=1.001)
fig.tight_layout()
fig.savefig(sys.argv[2], dpi=130, bbox_inches="tight")
print("wrote", sys.argv[2])
