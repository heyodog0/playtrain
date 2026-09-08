"""LR-tuning comparison for cavequest_hard_explore N=1, abs_one, entropy=0.003, 100M.
Combines the cqhe_lrtune_n1 group (lr 1e-4, 3e-4) with the entropy=0.003 runs from
cqhe_enttune_n1 (lr 2e-4). Groups by the run's actual learning_rate (from config,
robust to the lr29e5 naming quirk). Two panels: win-rate + raw return per lr.
Saves outputs/figs/cqhe_lrtune_winrate.png."""
from collections import defaultdict
import numpy as np
import matplotlib.pyplot as plt
import wandb

try:
    plt.style.use("seaborn-v0_8-darkgrid")
except OSError:
    plt.style.use("seaborn-darkgrid")

ENT = "truongtruong-harvard-university/analogen"
COLORS = {1e-4: "#2471a3", 2e-4: "#1a7a3a", 3e-4: "#c0392b"}
STEPS_M, GRID = 100, 1000
api = wandb.Api(timeout=60)

def ema(y, a=0.06):
    o = np.empty_like(y, float); acc = y[0]
    for i, v in enumerate(y): acc = a*v+(1-a)*acc; o[i] = acc
    return o

def collect(key):
    xg = np.linspace(0, STEPS_M, GRID)
    by_lr = defaultdict(list)
    runs = list(api.runs(ENT, filters={"group": "cqhe_lrtune_n1", "state": "finished"}))
    # entropy=0.003 runs from the entropy group double as the lr=2e-4 arm
    runs += [r for r in api.runs(ENT, filters={"group": "cqhe_enttune_n1", "state": "finished"})
             if abs(float(r.config.get("entropy_cost", 0)) - 0.003) < 1e-9]
    for r in runs:
        lr = round(float(r.config.get("learning_rate", 0)), 6)
        if lr not in COLORS: continue
        h = r.history(keys=[key], samples=4000)
        if key not in h.columns: continue
        h = h.dropna(subset=[key])
        if len(h) < 5: continue
        x = (h["_step"] / h["_step"].max() * STEPS_M).to_numpy()
        by_lr[lr].append(np.interp(xg, x, ema(h[key].to_numpy())))
    return xg, by_lr

fig, axes = plt.subplots(1, 2, figsize=(14, 5.2))
for ax, (key, title, ylab) in zip(axes, [
        ("charts/ep_win_rate", "win-rate (honest headline)", "win rate"),
        ("charts/ep_return_mean", "raw return (for reference)", "train return")]):
    xg, by_lr = collect(key)
    for lr in sorted(by_lr):
        arr = np.vstack(by_lr[lr]); med = arr.mean(0)
        ax.plot(xg, med, lw=2.0, color=COLORS[lr], label=f"lr={lr:g} ({len(by_lr[lr])} seeds)")
        ax.fill_between(xg, arr.min(0), arr.max(0), color=COLORS[lr], alpha=0.12)
    ax.set_title(title); ax.set_xlabel("env steps (M)"); ax.set_ylabel(ylab); ax.legend(fontsize=9)
axes[0].axhline(1.0, ls="--", lw=1, color="0.5"); axes[0].set_ylim(-0.02, 1.05)
axes[1].axhline(55000, ls="--", lw=1, color="0.5")
fig.suptitle("cavequest_hard_explore N=1 abs_one, entropy=0.003: LR tuning (mean±range)", fontsize=13)
fig.tight_layout(rect=[0, 0, 1, 0.94])
out = "outputs/figs/cqhe_lrtune_winrate.png"
fig.savefig(out, dpi=140); print("saved", out)
