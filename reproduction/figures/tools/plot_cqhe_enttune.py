"""Entropy-tuning comparison for cavequest_hard_explore N=1, abs_one, 100M.
Groups runs by their actual entropy_cost (from config, robust to naming) and
colors them along a colormap, so it handles any set of entropy values. Two
panels: win-rate (the honest headline, charts/ep_win_rate) and raw return.
Saves outputs/figs/cqhe_enttune_winrate.png."""
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
GROUP = "cqhe_enttune_n1"
STEPS_M, GRID = 100, 1000
api = wandb.Api(timeout=60)

def ema(y, a=0.06):
    o = np.empty_like(y, float); acc = y[0]
    for i, v in enumerate(y): acc = a*v+(1-a)*acc; o[i] = acc
    return o

def collect(key):
    xg = np.linspace(0, STEPS_M, GRID)
    by_ent = defaultdict(list)
    for r in api.runs(ENT, filters={"group": GROUP, "state": "finished"}):
        ent = round(float(r.config.get("entropy_cost", 0)), 6)
        if ent <= 0: continue
        h = r.history(keys=[key], samples=4000)
        if key not in h.columns: continue
        h = h.dropna(subset=[key])
        if len(h) < 5: continue
        x = (h["_step"] / h["_step"].max() * STEPS_M).to_numpy()
        by_ent[ent].append(np.interp(xg, x, ema(h[key].to_numpy())))
    return xg, by_ent

# color by log(entropy) along viridis
_x, probe = collect("charts/ep_win_rate")
ents = sorted(probe)
if ents:
    norm = mpl.colors.LogNorm(vmin=min(ents), vmax=max(ents))
    cmap = mpl.cm.viridis
    col = {e: cmap(norm(e)) for e in ents}
else:
    col = {}

fig, axes = plt.subplots(1, 2, figsize=(14, 5.2))
for ax, (key, title, ylab) in zip(axes, [
        ("charts/ep_win_rate", "win-rate (honest headline)", "win rate"),
        ("charts/ep_return_mean", "raw return (for reference)", "train return")]):
    xg, by_ent = collect(key)
    for e in sorted(by_ent):
        arr = np.vstack(by_ent[e]); med = arr.mean(0)
        ax.plot(xg, med, lw=2.0, color=col.get(e, "0.3"),
                label=f"ent={e:g} ({len(by_ent[e])} seeds)")
        ax.fill_between(xg, arr.min(0), arr.max(0), color=col.get(e, "0.3"), alpha=0.10)
    ax.set_title(title); ax.set_xlabel("env steps (M)"); ax.set_ylabel(ylab); ax.legend(fontsize=9)
axes[0].axhline(1.0, ls="--", lw=1, color="0.5"); axes[0].set_ylim(-0.02, 1.05)
axes[1].axhline(55000, ls="--", lw=1, color="0.5")
fig.suptitle("cavequest_hard_explore N=1 abs_one: entropy tuning (mean±range over seeds)", fontsize=13)
fig.tight_layout(rect=[0, 0, 1, 0.94])
out = "outputs/figs/cqhe_enttune_winrate.png"
fig.savefig(out, dpi=140); print("saved", out)
