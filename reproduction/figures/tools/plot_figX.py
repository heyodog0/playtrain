"""Figure [X] for the paper: (A) 6-game curves grid, IMPALA-DDP2 vs PPO,
both ImpalaCNN, seed bands; (B) wall-clock inversion panel (bigfish);
(C) 24-game greedy-vs-random dumbbell.

Reads TB event dirs directly so partially-finished runs contribute
partial curves; re-run as more seeds land.
"""
import json, sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D
from tensorboard.backend.event_processing.event_accumulator import EventAccumulator

IMP_C, PPO_C = "#1f77b4", "#ff7f0e"
RANDOM_C, ZERO_C = "#9aa3ad", "#c44e52"
GAMES = ["bigfish", "coinrun", "qbert", "seaquest", "pong", "miner"]
IMPALA_RUNS = {
  "bigfish": ["impala_34819869", "impala_34897676", "impala_34897678"],
  "coinrun": ["impala_34824270", "impala_34897679", "impala_34897680"],
  "qbert":   ["impala_34824306", "impala_34897681", "impala_34897682"],
  "seaquest":["impala_34824301", "impala_34897683", "impala_34897684"],
  "pong":    ["impala_34824299", "impala_34897685", "impala_34897686"],
  "miner":   ["impala_34824295", "impala_34897687", "impala_34897688"],
}

def load(run_dir, want_wall=False, min_step=1e6):
    try:
        acc = EventAccumulator(f"outputs/{run_dir}/tb", size_guidance={"scalars": 0})
        acc.Reload()
        tag = [t for t in acc.Tags()["scalars"] if "return" in t.lower()][0]
        evs = [e for e in acc.Scalars(tag) if e.step >= min_step]
        if len(evs) < 5:
            return None
        s = np.array([e.step for e in evs], float)
        v = np.array([e.value for e in evs], float)
        if want_wall:
            w = np.array([e.wall_time for e in evs], float)
            return s, v, (w - w[0]) / 60.0
        return s, v
    except Exception:
        return None

def ema(y, span_frac=0.02):
    alpha = min(0.3, 1.0 / max(1.0, span_frac * len(y)))
    out = np.empty_like(y); m = 0.0; c = 0.0
    for i, val in enumerate(y):
        m = alpha * val + (1 - alpha) * m
        c = alpha + (1 - alpha) * c
        out[i] = m / c
    return out

def band(runs, n=200):
    runs = [r for r in runs if r is not None]
    if not runs:
        return None
    hi = min(s[-1] for s, _ in runs)
    lo = max(s[0] for s, _ in runs)
    grid = np.linspace(lo, hi, n)
    ys = np.stack([np.interp(grid, s, ema(v)) for s, v in runs])
    return grid / 1e6, ys.mean(0), ys.min(0), ys.max(0), len(runs)

fig = plt.figure(figsize=(8.8, 8.4))
gsa = fig.add_gridspec(3, 2, hspace=0.45, wspace=0.30)

for i, game in enumerate(GAMES):
    ax = fig.add_subplot(gsa[i // 2, i % 2])
    imp = band([load(d) for d in IMPALA_RUNS[game]])
    ppo = band([load(f"ppo_impala_{game}_s{s}") for s in (0, 1, 2)])
    for data, color, name in ((imp, IMP_C, "IMPALA"), (ppo, PPO_C, "PPO")):
        if data is None:
            continue
        x, m, lo, hi, k = data
        ax.plot(x, m, lw=1.5, color=color, label=name)
        if k > 1:
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

fig.savefig(sys.argv[1], dpi=150, bbox_inches="tight")
print("wrote", sys.argv[1])

print("wrote", sys.argv[1])


# ---- standalone appendix dumbbell ----
fig2 = plt.figure(figsize=(6.4, 7.6))
# ---- Panel C: dumbbell ----
evals = json.load(open("outputs/eval_iddp_suite.json"))
rows = []
for game, d in evals.items():
    g, r = d["greedy_return"], d["random_return"]
    norm = (g - r) / (abs(g) + abs(r) + 1e-9) if (g or r) else 0.0
    rows.append((norm, game, r, g))
rows.sort()
axc = fig2.add_subplot(111)
for y, (norm, game, r, g) in enumerate(rows):
    color = IMP_C if norm > 0.05 else (ZERO_C if norm <= 0 else "#666666")
    axc.plot([r, g], [y, y], lw=1.0, color="#cccccc", zorder=1)
    axc.scatter([r], [y], s=14, color=RANDOM_C, zorder=2)
    axc.scatter([g], [y], s=18, color=color, zorder=3)
    d = g - r
    label = "0" if d == 0 else f"{d:+,.0f}" if abs(d) >= 10 else f"{d:+.1f}"
    axc.annotate(label, xy=(1.0, y), xycoords=("axes fraction", "data"),
                 xytext=(4, 0), textcoords="offset points",
                 fontsize=7.5, color="#666666", va="center", ha="left")
axc.set_yticks(range(len(rows)))
axc.set_yticklabels([g for _, g, _, _ in rows], fontsize=8.5)
axc.set_xscale("symlog", linthresh=2)
axc.set_xlabel("mean return, 8 held-out seeds (symlog)", fontsize=10)
axc.tick_params(axis="x", labelsize=9)
axc.grid(axis="x", alpha=0.22, lw=0.5)
axc.spines[["top", "right"]].set_visible(False)
axc.axvline(0, color="#888888", lw=0.6, alpha=0.5)
proxies = [
    Line2D([], [], marker="o", ls="", color=RANDOM_C, markersize=4.5, label="random"),
    Line2D([], [], marker="o", ls="", color=IMP_C, markersize=5, label="greedy (final ckpt)"),
    Line2D([], [], marker="o", ls="", color=ZERO_C, markersize=5, label="greedy ≤ random"),
]
axc.legend(handles=proxies, loc="lower right", fontsize=8, frameon=False,
           handletextpad=0.3, borderaxespad=0.2, labelspacing=0.3)
axc.set_title("all 24 games: greedy vs random", fontsize=12)


fig2.savefig(sys.argv[2], dpi=150, bbox_inches="tight")
print("wrote", sys.argv[2])
