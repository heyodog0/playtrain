"""A/B: cqhex (death penalty -5000) vs cqhex2 (no death penalty), N=1, 4 seeds,
PopArt / raw rewards, 100M steps. Two panels side by side; each shows the 4 seed
training-return curves (EMA-smoothed) + the win line (+55k) + a zero line (raw
returns go negative when the agent burns lives). Answers whether punishing death
helps or hurts exploration on this hard-explore env.
Saves outputs/figs/cqhex_ab_death_penalty.png."""
import re
from collections import defaultdict
import numpy as np
import matplotlib as mpl
import matplotlib.pyplot as plt
import wandb

try:
    plt.style.use("seaborn-v0_8-darkgrid")
except OSError:
    plt.style.use("seaborn-darkgrid")

ENT = "truongtruong-harvard-university/analogen"
KEY = "charts/ep_return_mean"
WIN = 55000
STEPS_M = 100
GRID = 1000
ARMS = [
    ("cqhex_popart_n1",  "cqhex  (death −" + "5000)", "#c0392b"),
    ("cqhex2_popart_n1", "cqhex2  (no death penalty)",     "#2471a3"),
]

api = wandb.Api(timeout=60)

def ema(y, alpha=0.06):
    out = np.empty_like(y, dtype=float); acc = y[0]
    for i, v in enumerate(y):
        acc = alpha * v + (1 - alpha) * acc; out[i] = acc
    return out

def pull(group):
    runs = sorted(api.runs(ENT, filters={"group": group, "state": "finished"}),
                  key=lambda r: r.name)
    xg = np.linspace(0, STEPS_M, GRID)
    by_seed = {}
    for r in runs:
        sm = re.search(r"_s(\d+)$", r.name)
        seed = int(sm.group(1)) if sm else len(by_seed)
        total = float(r.config.get("total_steps", 100_000_000))
        h = r.history(keys=[KEY], samples=4000)
        if h.empty or KEY not in h:
            continue
        h = h.dropna(subset=[KEY])
        x = (h["_step"] / h["_step"].max() * (total / 1e6)).to_numpy()
        by_seed[seed] = np.interp(xg, x, ema(h[KEY].to_numpy()))
    return xg, list(by_seed.values())

fig, axes = plt.subplots(1, 2, figsize=(13, 5.2), sharex=True, sharey=True)
for ax, (group, title, color) in zip(axes, ARMS):
    xg, curves = pull(group)
    for y in curves:
        ax.plot(xg, y, lw=1.3, alpha=0.85, color=color)
    ax.axhline(WIN, ls="--", lw=1.0, color="0.4", alpha=.8)
    ax.axhline(0, ls="-", lw=0.8, color="0.6", alpha=.6)
    ax.set_title(f"{title}   ({len(curves)} seeds)", fontsize=12)
    ax.set_xlabel("env steps (M)", fontsize=11)
axes[0].set_ylabel("train return (episode mean, EMA)", fontsize=11)
axes[0].text(1, WIN, "  win ≈ +55k", va="bottom", ha="left", fontsize=9, color="0.3")
fig.suptitle("cavequest_hard_explore N=1, PopArt (raw rewards): death penalty A/B\n"
             "does punishing death (−5000/life) help or hurt exploration?", fontsize=13)
fig.tight_layout(rect=[0, 0, 1, 0.93])
out = "outputs/figs/cqhex_ab_death_penalty.png"
fig.savefig(out, dpi=150); print("saved", out)
