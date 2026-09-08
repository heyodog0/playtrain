"""asteroids hybrid+anneal tuning grid: win_bonus{15,30} x entropy-anneal-end
{0.0001,0} (ent 0.004 start, frac 0.8, lr 1e-4). Decisive panel: GREEDY win-rate
— does annealing entropy (now that a win gradient exists) push the argmax policy
off 0? Panel 2: training (stochastic) win-rate. Grouped by (win_bonus, ent_final)
from each run's config. Saves outputs/figs/asteroids_anneal_tune.png."""
from collections import defaultdict
import numpy as np
import matplotlib.pyplot as plt
import wandb

try:
    plt.style.use("seaborn-v0_8-darkgrid")
except OSError:
    plt.style.use("seaborn-darkgrid")

ENT = "truongtruong-harvard-university/analogen"
GROUP = "asteroids_hybrid_anneal_tune"
STEPS_M, GRID = 100, 1000
COLORS = {(15.0, 0.0001): "#1a7a3a", (15.0, 0.0): "#27ae60",
          (30.0, 0.0001): "#c0392b", (30.0, 0.0): "#e67e22"}
api = wandb.Api(timeout=60)

def ema(y, a=0.1):
    o = np.empty_like(y, float); acc = y[0]
    for i, v in enumerate(y): acc = a*v+(1-a)*acc; o[i] = acc
    return o

def collect(key, smooth=True):
    xg = np.linspace(0, STEPS_M, GRID)
    by = defaultdict(list)
    for r in api.runs(ENT, filters={"group": GROUP, "state": "finished"}):
        wb = round(float(r.config.get("win_bonus", 0)), 3)
        ef = round(float(r.config.get("entropy_cost_final", -1)), 5)
        h = r.history(keys=[key], samples=4000)
        if key not in h.columns: continue
        h = h.dropna(subset=[key])
        if len(h) < 3: continue
        x = (h["_step"] / h["_step"].max() * STEPS_M).to_numpy()
        y = h[key].to_numpy()
        by[(wb, ef)].append(np.interp(xg, x, ema(y) if smooth and len(y) > 5 else y))
    return xg, by

fig, ax = plt.subplots(1, 2, figsize=(14, 5.2))
for panel, (key, title, greedy) in enumerate([
        ("eval/greedy_win_rate", "GREEDY win-rate (decisive)", True),
        ("charts/ep_win_rate", "training (stochastic) win-rate", False)]):
    xg, by = collect(key, smooth=not greedy)
    for combo in sorted(by):
        arr = np.vstack(by[combo]); med = arr.mean(0)
        c = COLORS.get(combo, "0.3")
        lab = f"wb={combo[0]:g}, ent→{combo[1]:g}"
        kw = dict(marker="o", ms=3) if greedy else {}
        ax[panel].plot(xg, med, lw=2.0, color=c, label=lab, **kw)
    ax[panel].set_ylim(-0.02, 1.05); ax[panel].axhline(1.0, ls="--", lw=1, color="0.5")
    ax[panel].set_title(title); ax[panel].set_xlabel("env steps (M)"); ax[panel].set_ylabel("win rate")
    ax[panel].legend(fontsize=9)
fig.suptitle("asteroids hybrid clip + entropy annealing: can we push GREEDY off 0?", fontsize=13)
fig.tight_layout(rect=[0, 0, 1, 0.95])
out = "outputs/figs/asteroids_anneal_tune.png"
fig.savefig(out, dpi=140); print("saved", out)
