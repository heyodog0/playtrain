"""Main-text learning-curves figure: 6 games x 2 trainers, 3-seed bands.

IMPALA (V-trace, b256 record config) vs PPO (native backend, fixed config),
both with the identical NatureCNN encoder. Per game/trainer: mean line +
min-max band across seeds 0/1/2, interpolated onto a common step grid.

Usage: plot_learning_bands.py IMPALA_S0.json IMPALA_S12.json PPO.json OUT.png
"""
import json, sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

IMPALA_C, PPO_C = "#1f77b4", "#ff7f0e"
GAMES = ["bigfish", "coinrun", "qbert", "seaquest", "pong", "miner"]
# seed-0 IMPALA runs (the b256 suite runs; bigfish = the record run itself,
# NOT its same-seed reproductions)
S0 = {"bigfish": "impala_34603289", "coinrun": "impala_34652499",
      "qbert": "impala_34652510", "seaquest": "impala_34652504",
      "pong": "impala_34652502", "miner": "impala_34652500"}

j_s0, j_s12, j_ppo = (json.load(open(p)) for p in sys.argv[1:4])

def series(entry, min_step=1e6):
    # Drop the logging-warmup region (<1M steps): the two trainers seed their
    # running episode-return stats differently (IMPALA from an empty window,
    # PPO from the random policy), which is a logging artifact, not learning.
    tag = sorted(entry["series"])[0]
    pts = [(st, v) for st, v in entry["series"][tag] if st >= min_step]
    return np.array([st for st, _ in pts], float), np.array([v for _, v in pts], float)

def ema(y, span_frac=0.02):
    # span-aware: same effective smoothing window regardless of log frequency
    alpha = min(0.3, 1.0 / max(1.0, span_frac * len(y)))
    out = np.empty_like(y); m = 0.0; corr = 0.0
    for i, v in enumerate(y):
        m = alpha * v + (1 - alpha) * m
        corr = alpha + (1 - alpha) * corr  # debias: EMA of ones
        out[i] = m / corr
    return out

def collect(game):
    """-> {trainer: list[(steps, returns)]}"""
    runs = {"IMPALA": [], "PPO": []}
    runs["IMPALA"].append(series(j_s0[S0[game]]))
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

fig, axes = plt.subplots(3, 2, figsize=(8.6, 8.6))
for ax, game in zip(axes.ravel(), GAMES):
    runs = collect(game)
    for name, color in (("IMPALA", IMPALA_C), ("PPO", PPO_C)):
        if not runs[name]:
            continue
        x, m, lo, hi = band(runs[name])
        ax.plot(x, m, lw=1.6, color=color, label=name)
        ax.fill_between(x, lo, hi, color=color, alpha=0.18, lw=0)
    ax.set_title(game, fontsize=13)
    ax.tick_params(labelsize=10)
    ax.grid(alpha=0.22, lw=0.5)
    ax.spines[["top", "right"]].set_visible(False)
for ax in axes[-1]:
    ax.set_xlabel("env steps (M)", fontsize=11)
for ax in axes[:, 0]:
    ax.set_ylabel("episode return", fontsize=11)
axes[0, 0].legend(fontsize=10, frameon=False, loc="upper left")
fig.tight_layout()
fig.savefig(sys.argv[4], dpi=150, bbox_inches="tight")
print("wrote", sys.argv[4])
