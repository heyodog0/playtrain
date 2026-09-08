"""Combined main-text learning figure.

Left (panel A): 6 games x 2 trainers (IMPALA vs PPO, same NatureCNN),
3-seed mean + min-max band.
Right (panel B): all 24 suite games, final greedy checkpoint vs random
policy on the same held-out seeds (dumbbell, symlog x).

Usage: plot_learning_combined.py IMPALA_S0.json IMPALA_S12.json PPO.json EVAL.json OUT.png
"""
import json, sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D

IMPALA_C, PPO_C = "#1f77b4", "#ff7f0e"
RANDOM_C, ZERO_C = "#9aa3ad", "#c44e52"
GAMES = ["bigfish", "coinrun", "qbert", "seaquest", "pong", "miner"]
S0 = {"bigfish": "impala_34603289", "coinrun": "impala_34652499",
      "qbert": "impala_34652510", "seaquest": "impala_34652504",
      "pong": "impala_34652502", "miner": "impala_34652500"}

j_s0, j_s12, j_ppo, j_eval = (json.load(open(p)) for p in sys.argv[1:5])

def series(entry, min_step=1e6):
    tag = sorted(entry["series"])[0]
    pts = [(st, v) for st, v in entry["series"][tag] if st >= min_step]
    return np.array([st for st, _ in pts], float), np.array([v for _, v in pts], float)

def ema(y, span_frac=0.02):
    alpha = min(0.3, 1.0 / max(1.0, span_frac * len(y)))
    out = np.empty_like(y); m = 0.0; corr = 0.0
    for i, v in enumerate(y):
        m = alpha * v + (1 - alpha) * m
        corr = alpha + (1 - alpha) * corr
        out[i] = m / corr
    return out

def collect(game):
    runs = {"IMPALA": [series(j_s0[S0[game]])], "PPO": []}
    for e in j_s12.values():
        if e["game"] == game:
            runs["IMPALA"].append(series(e))
    for e in j_ppo.values():
        if e["game"] == game:
            runs["PPO"].append(series(e))
    return runs

def band(seed_runs, n=200):
    hi = min(s[-1] for s, _ in seed_runs)
    lo0 = max(s[0] for s, _ in seed_runs)
    grid = np.linspace(lo0, hi, n)
    ys = np.stack([np.interp(grid, s, ema(v)) for s, v in seed_runs])
    return grid / 1e6, ys.mean(0), ys.min(0), ys.max(0)

fig = plt.figure(figsize=(13.6, 8.2))
gs = fig.add_gridspec(1, 2, width_ratios=[1.25, 1.0], wspace=0.30)
gsa = gs[0].subgridspec(3, 2, hspace=0.45, wspace=0.30)

for i, game in enumerate(GAMES):
    ax = fig.add_subplot(gsa[i // 2, i % 2])
    runs = collect(game)
    for name, color in (("IMPALA", IMPALA_C), ("PPO", PPO_C)):
        if not runs[name]:
            continue
        x, m, lo, hi = band(runs[name])
        ax.plot(x, m, lw=1.5, color=color, label=name)
        ax.fill_between(x, lo, hi, color=color, alpha=0.18, lw=0)
    ax.set_title(game, fontsize=12)
    ax.tick_params(labelsize=9)
    ax.grid(alpha=0.22, lw=0.5)
    ax.spines[["top", "right"]].set_visible(False)
    if i // 2 == 2:
        ax.set_xlabel("env steps (M)", fontsize=10.5)
    if i % 2 == 0:
        ax.set_ylabel("episode return", fontsize=10.5)
    if i == 0:
        ax.legend(fontsize=9.5, frameon=False, loc="upper left")

# ---- Panel B: dumbbell ----
rows = []
for game, d in j_eval.items():
    g, r = d["greedy_return"], d["random_return"]
    norm = (g - r) / (abs(g) + abs(r) + 1e-9) if (g or r) else 0.0
    rows.append((norm, game, r, g))
rows.sort()

axb = fig.add_subplot(gs[1])
ys = range(len(rows))
for y, (norm, game, r, g) in zip(ys, rows):
    color = IMPALA_C if norm > 0.05 else (ZERO_C if norm <= 0 else "#666666")
    axb.plot([r, g], [y, y], lw=1.1, color="#cccccc", zorder=1)
    axb.scatter([r], [y], s=18, color=RANDOM_C, zorder=2)
    axb.scatter([g], [y], s=22, color=color, zorder=3)
axb.set_yticks(list(ys))
axb.set_yticklabels([g for _, g, _, _ in rows], fontsize=10)
axb.set_xscale("symlog", linthresh=2)
axb.set_xlabel("mean return, 8 held-out seeds (symlog)", fontsize=10.5)
axb.tick_params(axis="x", labelsize=9)
axb.grid(axis="x", alpha=0.22, lw=0.5)
axb.spines[["top", "right"]].set_visible(False)
axb.axvline(0, color="#888888", lw=0.6, alpha=0.5)
proxies = [
    Line2D([], [], marker="o", ls="", color=RANDOM_C, markersize=5, label="random"),
    Line2D([], [], marker="o", ls="", color=IMPALA_C, markersize=5.5, label="greedy (final ckpt)"),
    Line2D([], [], marker="o", ls="", color=ZERO_C, markersize=5.5, label="greedy ≤ random"),
]
axb.legend(handles=proxies, loc="lower right", fontsize=8.5, frameon=False,
           handletextpad=0.3, borderaxespad=0.2, labelspacing=0.35)
axb.set_title("all 24 games: greedy vs random (held-out seeds)", fontsize=12)

fig.savefig(sys.argv[5], dpi=150, bbox_inches="tight")
print("wrote", sys.argv[5])
