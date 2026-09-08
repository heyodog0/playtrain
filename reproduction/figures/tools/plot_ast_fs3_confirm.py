"""asteroids fs=3 confirmation @150M: pin the greedy ceiling & test whether
entropy annealing pushes greedy toward 1.0. Arms: fs3 (const 0.004), fs3anneal
(ent->0.0005), fs2 (const). Panel 1: GREEDY win-rate (decisive, per-seed thin +
arm mean bold). Panel 2: training (stochastic) win-rate. Grouped by (frame_skip,
annealed) from config. Saves outputs/figs/ast_fs3_confirm.png."""
from collections import defaultdict
import numpy as np
import matplotlib.pyplot as plt
import wandb

try:
    plt.style.use("seaborn-v0_8-darkgrid")
except OSError:
    plt.style.use("seaborn-darkgrid")

ENT = "truongtruong-harvard-university/analogen"
GROUP = "asteroids_fs3_confirm"
STEPS_M, GRID = 150, 1000
# key: (frame_skip, annealed) -> (label, color)
STYLE = {
    (3, False): ("fs3 const 0.004", "#1a7a3a"),
    (3, True):  ("fs3 anneal->0.0005", "#8e44ad"),
    (2, False): ("fs2 const 0.004", "#e67e22"),
}
api = wandb.Api(timeout=60)

def ema(y, a=0.1):
    o = np.empty_like(y, float); acc = y[0]
    for i, v in enumerate(y): acc = a*v+(1-a)*acc; o[i] = acc
    return o

def collect(key, smooth):
    xg = np.linspace(0, STEPS_M, GRID)
    by = defaultdict(list)
    for r in api.runs(ENT, filters={"group": GROUP, "state": "finished"}):
        fs = int(r.config.get("frame_skip", 1))
        an = r.config.get("entropy_cost_final") is not None
        h = r.history(keys=[key], samples=4000)
        if key not in h.columns: continue
        h = h.dropna(subset=[key])
        if len(h) < 3: continue
        x = (h["_step"] / h["_step"].max() * STEPS_M).to_numpy()
        y = h[key].to_numpy()
        by[(fs, an)].append(np.interp(xg, x, ema(y) if smooth and len(y) > 5 else y))
    return xg, by

fig, ax = plt.subplots(1, 2, figsize=(14, 5.4))
for panel, (key, title, greedy) in enumerate([
        ("eval/greedy_win_rate", "GREEDY win-rate (decisive)", True),
        ("charts/ep_win_rate", "training (stochastic) win-rate", False)]):
    xg, by = collect(key, smooth=not greedy)
    for combo in sorted(by, key=lambda k: (-k[0], k[1])):
        lab, c = STYLE.get(combo, (str(combo), "0.3"))
        arr = np.vstack(by[combo])
        if greedy:  # show each seed thin so variance is visible
            for row in arr: ax[panel].plot(xg, row, color=c, lw=0.7, alpha=0.35)
        ax[panel].plot(xg, arr.mean(0), color=c, lw=2.4, label=f"{lab} ({len(by[combo])})",
                       **(dict(marker="o", ms=2.5) if greedy else {}))
    ax[panel].set_ylim(-0.02, 1.05); ax[panel].axhline(1.0, ls="--", lw=1, color="0.6")
    ax[panel].set_title(title); ax[panel].set_xlabel("env frames (M)"); ax[panel].set_ylabel("win rate")
    ax[panel].legend(fontsize=9, loc="upper left")
fig.suptitle("asteroids fs=3 confirmation @150M: can we pin GREEDY at 1.0?", fontsize=13)
fig.tight_layout(rect=[0, 0, 1, 0.95])
out = "outputs/figs/ast_fs3_confirm.png"
fig.savefig(out, dpi=140); print("saved", out)
