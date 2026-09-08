"""cqhex2 N=1 hybrid-clip A/B: abs_one baseline vs abs_one+win_bonus=15
(both ent 0.004, lr 1e-4, 150M). Does the terminal-win bonus speed up / steady /
raise the win-rate on an env that already consolidates? Baseline = the N=1 seeds
of the cqhex2_nohd_150M sweep; hybrid = cqhex2_hybrid_n1. Two panels: win-rate +
raw return, mean+-range over seeds. Saves outputs/figs/cqhex2_hybrid_ab.png."""
import re
from collections import defaultdict
import numpy as np
import matplotlib.pyplot as plt
import wandb

try:
    plt.style.use("seaborn-v0_8-darkgrid")
except OSError:
    plt.style.use("seaborn-darkgrid")

ENT = "truongtruong-harvard-university/analogen"
STEPS_M, GRID = 150, 1000
# (group, name-filter, label, color)
ARMS = [("cqhex2_nohd_150M", "_N001_", "abs_one (baseline)", "#c0392b"),
        ("cqhex2_hybrid_n1", "_N001_", "hybrid: win_bonus=15", "#1a7a3a")]
api = wandb.Api(timeout=60)

def ema(y, a=0.06):
    o = np.empty_like(y, float); acc = y[0]
    for i, v in enumerate(y): acc = a*v+(1-a)*acc; o[i] = acc
    return o

def pull(group, filt, key):
    xg = np.linspace(0, STEPS_M, GRID); out = []
    for r in api.runs(ENT, filters={"group": group, "state": "finished"}):
        if filt not in r.name: continue
        h = r.history(keys=[key], samples=4000)
        if key not in h.columns: continue
        h = h.dropna(subset=[key])
        if len(h) < 5: continue
        x = (h["_step"] / h["_step"].max() * STEPS_M).to_numpy()
        out.append(np.interp(xg, x, ema(h[key].to_numpy())))
    return xg, out

fig, ax = plt.subplots(1, 2, figsize=(13, 5.2))
for panel, (key, title, ylab, hline) in enumerate([
        ("charts/ep_win_rate", "win-rate (headline)", "win rate", 1.0),
        ("charts/ep_return_mean", "raw return (reference)", "train return", 55000)]):
    for group, filt, label, color in ARMS:
        xg, ys = pull(group, filt, key)
        if not ys: continue
        arr = np.vstack(ys); med = arr.mean(0)
        ax[panel].plot(xg, med, lw=2.0, color=color, label=f"{label} ({len(ys)})")
        ax[panel].fill_between(xg, arr.min(0), arr.max(0), color=color, alpha=0.12)
    ax[panel].axhline(hline, ls="--", lw=1, color="0.5")
    ax[panel].set_title(title); ax[panel].set_xlabel("env steps (M)"); ax[panel].set_ylabel(ylab); ax[panel].legend(fontsize=9)
ax[0].set_ylim(-0.02, 1.05)
fig.suptitle("cqhex2 N=1: does a terminal-win bonus help an env that already consolidates?", fontsize=13)
fig.tight_layout(rect=[0, 0, 1, 0.95])
out = "outputs/figs/cqhex2_hybrid_ab.png"
fig.savefig(out, dpi=140); print("saved", out)
