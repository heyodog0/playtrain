"""cqhex2 N=1 stabilizer bake-off: which mechanism kills the mid-training
drawdown? Arms: entlo (const ent 0.002), anneal (ent 0.004->0.0005), gclip
(grad-norm 40->10), vs the const-0.004 baseline (reused from cqhex2_nohd_150M
N001). Panel 1: win-rate curves (mean +- seed range). Panel 2: the two decisive
metrics per arm — max drawdown (lower=better) and %held>0.7 (higher=better).
Saves outputs/figs/cqhex2_stab.png."""
from collections import defaultdict
import numpy as np
import matplotlib.pyplot as plt
import wandb

try:
    plt.style.use("seaborn-v0_8-darkgrid")
except OSError:
    plt.style.use("seaborn-darkgrid")

ENT = "truongtruong-harvard-university/analogen"
STEPS_M, GRID, KEY = 150, 1000, "charts/ep_win_rate"
# (group, name-filter, label, color)
ARMS = [
    ("cqhex2_nohd_150M", "_N001_",       "baseline: const 0.004",  "#7f8c8d"),
    ("cqhex2_stab_sweep", "_stab_entlo_", "const ent 0.002",        "#2980b9"),
    ("cqhex2_stab_sweep", "_stab_anneal_","anneal 0.004->0.0005",   "#1a7a3a"),
    ("cqhex2_stab_sweep", "_stab_gclip_", "grad-clip 40->10",       "#c0392b"),
]
api = wandb.Api(timeout=60)

def ema(y, a=0.06):
    o = np.empty_like(y, float); acc = y[0]
    for i, v in enumerate(y): acc = a*v+(1-a)*acc; o[i] = acc
    return o

def pull(group, filt):
    xg = np.linspace(0, STEPS_M, GRID); curves = []; dd = []; held = []
    for r in api.runs(ENT, filters={"group": group, "state": "finished"}):
        if filt not in r.name: continue
        h = r.history(keys=[KEY], samples=4000)
        if KEY not in h.columns: continue
        h = h.dropna(subset=[KEY])
        if len(h) < 20: continue
        x = (h["_step"] / h["_step"].max() * STEPS_M).to_numpy()
        y = h[KEY].to_numpy()
        curves.append(np.interp(xg, x, ema(y)))
        # consolidation metrics on the RAW (un-smoothed) series
        if (y >= 0.7).any():
            cross = int(np.argmax(y >= 0.7)); post = y[cross:]
            peak = np.maximum.accumulate(post)
            dd.append(float((peak - post).max())); held.append(float((post >= 0.7).mean()))
    return xg, curves, dd, held

fig, ax = plt.subplots(1, 2, figsize=(15, 5.4), gridspec_kw={"width_ratios": [1.6, 1]})
summ = []
for group, filt, label, color in ARMS:
    xg, curves, dd, held = pull(group, filt)
    if not curves: continue
    arr = np.vstack(curves)
    ax[0].plot(xg, arr.mean(0), lw=2.0, color=color, label=f"{label} ({len(curves)})")
    ax[0].fill_between(xg, arr.min(0), arr.max(0), color=color, alpha=0.10)
    summ.append((label, color, np.mean(dd) if dd else np.nan, np.mean(held) if held else np.nan))
ax[0].axhline(1.0, ls="--", lw=1, color="0.6"); ax[0].set_ylim(-0.02, 1.05)
ax[0].set_title("win-rate (mean +- seed range)"); ax[0].set_xlabel("env steps (M)")
ax[0].set_ylabel("win rate"); ax[0].legend(fontsize=9, loc="lower right")

# metrics bars
labels = [s[0] for s in summ]; colors = [s[1] for s in summ]
ddv = [s[2] for s in summ]; hv = [s[3] for s in summ]
x = np.arange(len(labels)); w = 0.36
ax[1].bar(x - w/2, ddv, w, color=colors, alpha=0.55, label="max drawdown (lower better)")
ax[1].bar(x + w/2, hv, w, color=colors, alpha=1.0, label="%held >0.7 (higher better)")
ax[1].set_xticks(x); ax[1].set_xticklabels([l.split(":")[0] for l in labels], rotation=20, ha="right", fontsize=8)
ax[1].set_ylim(0, 1.05); ax[1].set_title("consolidation metrics"); ax[1].legend(fontsize=8)
for xi, (d, hh) in enumerate(zip(ddv, hv)):
    if not np.isnan(d): ax[1].text(xi - w/2, d + 0.01, f"{d:.2f}", ha="center", fontsize=7)
    if not np.isnan(hh): ax[1].text(xi + w/2, hh + 0.01, f"{hh:.2f}", ha="center", fontsize=7)

fig.suptitle("cqhex2 N=1 stabilizer bake-off: which mechanism holds the win (kills the mid-training drawdown)?", fontsize=13)
fig.tight_layout(rect=[0, 0, 1, 0.95])
out = "outputs/figs/cqhex2_stab.png"
fig.savefig(out, dpi=140); print("saved", out)
