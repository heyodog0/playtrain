"""asteroids frame_skip (action-repeat) sweep on the winning hybrid base.
frame_skip{2,3,4} x frame_stack=4, win_bonus=15, LSTM, const ent 0.004.
The DECISIVE question: does committing to an action for K frames let the
GREEDY (argmax) policy win, where per-frame control (fs=1) collapsed to 0?
Panel 1: greedy win-rate (decisive). Panel 2: training (stochastic) win-rate.
Grouped by frame_skip from each run's config. Saves outputs/figs/asteroids_fskip.png."""
from collections import defaultdict
import numpy as np
import matplotlib.pyplot as plt
import wandb

try:
    plt.style.use("seaborn-v0_8-darkgrid")
except OSError:
    plt.style.use("seaborn-darkgrid")

ENT = "truongtruong-harvard-university/analogen"
GROUP = "asteroids_fskip_sweep"
STEPS_M, GRID = 100, 1000
COLORS = {2: "#1a7a3a", 3: "#e67e22", 4: "#c0392b"}
# reference: the fs=1 hybrid baseline (greedy stayed 0, stochastic ~0.8)
REF_GROUP = "asteroids_hybrid_ab"
api = wandb.Api(timeout=60)

def ema(y, a=0.1):
    o = np.empty_like(y, float); acc = y[0]
    for i, v in enumerate(y): acc = a*v+(1-a)*acc; o[i] = acc
    return o

def collect(group, key, steps_m, smooth):
    xg = np.linspace(0, steps_m, GRID)
    by = defaultdict(list)
    for r in api.runs(ENT, filters={"group": group, "state": "finished"}):
        fs = int(r.config.get("frame_skip", 1))
        h = r.history(keys=[key], samples=4000)
        if key not in h.columns: continue
        h = h.dropna(subset=[key])
        if len(h) < 3: continue
        x = (h["_step"] / h["_step"].max() * steps_m).to_numpy()
        y = h[key].to_numpy()
        by[fs].append(np.interp(xg, x, ema(y) if smooth and len(y) > 5 else y))
    return xg, by

fig, ax = plt.subplots(1, 2, figsize=(14, 5.2))
for panel, (key, title, greedy) in enumerate([
        ("eval/greedy_win_rate", "GREEDY win-rate (decisive)", True),
        ("charts/ep_win_rate", "training (stochastic) win-rate", False)]):
    xg, by = collect(GROUP, key, STEPS_M, smooth=not greedy)
    for fs in sorted(by):
        arr = np.vstack(by[fs]); med = arr.mean(0)
        c = COLORS.get(fs, "0.3")
        kw = dict(marker="o", ms=3) if greedy else {}
        ax[panel].plot(xg, med, lw=2.0, color=c, label=f"frame_skip={fs} ({len(by[fs])})", **kw)
        ax[panel].fill_between(xg, arr.min(0), arr.max(0), color=c, alpha=0.12)
    # fs=1 baseline reference (dashed grey), rescaled to this x-range
    xr, byr = collect(REF_GROUP, key, STEPS_M, smooth=not greedy)
    wb = [v for f, v in byr.items()]  # any fs=1 winbonus runs
    ref = [a for lst in byr.values() for a in lst]
    if ref:
        m = np.vstack(ref).mean(0)
        ax[panel].plot(xg, m, lw=1.5, ls="--", color="0.4", label="fs=1 hybrid (ref)")
    ax[panel].set_ylim(-0.02, 1.05); ax[panel].axhline(1.0, ls="--", lw=1, color="0.7")
    ax[panel].set_title(title); ax[panel].set_xlabel("env frames (M)"); ax[panel].set_ylabel("win rate")
    ax[panel].legend(fontsize=9)
fig.suptitle("asteroids action-repeat (frame_skip) sweep: can committed control push GREEDY off 0?", fontsize=13)
fig.tight_layout(rect=[0, 0, 1, 0.95])
out = "outputs/figs/asteroids_fskip.png"
fig.savefig(out, dpi=140); print("saved", out)
