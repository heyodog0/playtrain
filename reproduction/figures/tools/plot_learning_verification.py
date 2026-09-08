"""Two-panel learning-verification figure for the paper.

Panel A: six representative training curves (EMA-smoothed), including the
bigfish record run + its 3 reproductions overlaid.
Panel B: all 24 suite games as a dumbbell plot — random-policy baseline vs
final greedy checkpoint on the SAME held-out seeds, sorted by normalized
improvement, symlog x (returns span -36..829 across games).

Usage: python tools/plot_learning_verification.py CURVES.json EVAL.json OUT.png
"""
import json, sys
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

CURVE = "#1f77b4"
GREEDY = "#1f77b4"
RANDOM = "#9aa3ad"
ZERO_NOTE = "#c44e52"

curves = json.load(open(sys.argv[1]))
evals = json.load(open(sys.argv[2]))

def ema(vals, alpha=0.15):
    out, m = [], None
    for v in vals:
        m = v if m is None else alpha * v + (1 - alpha) * m
        out.append(m)
    return out

def series(run):
    e = curves[run]
    tag = sorted(e["series"])[0]
    pts = e["series"][tag]
    return [s / 1e6 for s, _ in pts], [v for _, v in pts]

# game -> run dir(s)
by_game = {}
for run, e in curves.items():
    by_game.setdefault(e["game"], []).append(run)

PANEL_A = [
    ("bigfish", [sorted(by_game["bigfish"])[0]], "bigfish"),
    ("coinrun", [by_game["coinrun"][0]], "coinrun"),
    ("qbert", [by_game["qbert"][0]], "qbert"),
    ("seaquest", [by_game["seaquest"][0]], "seaquest"),
    ("pong", [by_game["pong"][0]], "pong"),
    ("miner", [by_game["miner"][0]], "miner"),
]

fig = plt.figure(figsize=(12.5, 6.2))
gs = fig.add_gridspec(1, 2, width_ratios=[1.3, 1.0], wspace=0.34)
gsa = gs[0].subgridspec(3, 2, hspace=0.52, wspace=0.28)

for i, (game, runs, title) in enumerate(PANEL_A):
    ax = fig.add_subplot(gsa[i // 2, i % 2])
    for run in runs:
        xs, ys = series(run)
        ax.plot(xs, ema(ys), lw=1.4, color=CURVE,
                alpha=0.85 if len(runs) > 1 else 1.0)
    ax.set_title(title, fontsize=12)
    ax.tick_params(labelsize=9.5)
    ax.grid(alpha=0.22, lw=0.5)
    ax.spines[["top", "right"]].set_visible(False)
    if i // 2 == 2:
        ax.set_xlabel("env steps (M)", fontsize=10.5)
    if i % 2 == 0:
        ax.set_ylabel("episode return", fontsize=10.5)

# ---- Panel B ----
rows = []
for game, d in evals.items():
    g, r = d["greedy_return"], d["random_return"]
    norm = (g - r) / (abs(g) + abs(r) + 1e-9) if (g or r) else 0.0
    rows.append((norm, game, r, g))
rows.sort()

axb = fig.add_subplot(gs[1])
ys = range(len(rows))
for y, (norm, game, r, g) in zip(ys, rows):
    color = GREEDY if norm > 0.05 else (ZERO_NOTE if norm <= 0 else "#666666")
    axb.plot([r, g], [y, y], lw=1.1, color="#cccccc", zorder=1)
    axb.scatter([r], [y], s=18, color=RANDOM, zorder=2)
    axb.scatter([g], [y], s=22, color=color, zorder=3)
axb.set_yticks(list(ys))
axb.set_yticklabels([f"{game}" for _, game, _, _ in rows], fontsize=10.5)
axb.set_xscale("symlog", linthresh=2)
axb.set_xlabel("mean return, 8 held-out seeds (symlog)", fontsize=10.5)
axb.tick_params(axis="x", labelsize=9.5)
axb.grid(axis="x", alpha=0.22, lw=0.5)
axb.spines[["top", "right"]].set_visible(False)
axb.axvline(0, color="#888888", lw=0.6, alpha=0.5)
from matplotlib.lines import Line2D
proxies = [
    Line2D([], [], marker="o", ls="", color=RANDOM, markersize=5, label="random"),
    Line2D([], [], marker="o", ls="", color=GREEDY, markersize=5.5, label="greedy (final ckpt)"),
    Line2D([], [], marker="o", ls="", color=ZERO_NOTE, markersize=5.5, label="greedy \u2264 random"),
]
axb.legend(handles=proxies, loc="lower right", fontsize=8, frameon=False, handletextpad=0.3, borderaxespad=0.2, labelspacing=0.35, markerscale=0.8)
axb.set_title("all 24 games: greedy vs random (held-out seeds)", fontsize=12)

fig.savefig(sys.argv[3], dpi=150, bbox_inches="tight")
print("wrote", sys.argv[3])
