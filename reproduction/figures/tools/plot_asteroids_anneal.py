"""asteroids_medium IMPALA test: greedy-eval + entropy annealing (env42, 100M).
Three panels:
  1. GREEDY win-rate (eval/greedy_win_rate) vs TRAINING win-rate (charts/ep_win_rate)
     — does the deterministic policy vastly outperform the noisy stochastic metric?
  2. raw return (charts/ep_return_mean) for reference.
  3. entropy anneal (charts/entropy_cost) — confirms the schedule fired.
Saves outputs/figs/asteroids_anneal_greedy_vs_train.png."""
import numpy as np
import matplotlib.pyplot as plt
import wandb

try:
    plt.style.use("seaborn-v0_8-darkgrid")
except OSError:
    plt.style.use("seaborn-darkgrid")

ENT = "truongtruong-harvard-university/analogen"
GROUP = "asteroids_impala_anneal"
STEPS_M, GRID = 100, 1000
api = wandb.Api(timeout=60)

def ema(y, a=0.1):
    o = np.empty_like(y, float); acc = y[0]
    for i, v in enumerate(y): acc = a*v+(1-a)*acc; o[i] = acc
    return o

def series(key, smooth=True):
    xg = np.linspace(0, STEPS_M, GRID); out = []
    for r in api.runs(ENT, filters={"group": GROUP, "state": "finished"}):
        h = r.history(keys=[key], samples=4000)
        if key not in h.columns: continue
        h = h.dropna(subset=[key])
        if len(h) < 3: continue
        x = (h["_step"] / h["_step"].max() * STEPS_M).to_numpy()
        y = h[key].to_numpy()
        out.append(np.interp(xg, x, ema(y) if smooth and len(y) > 5 else y))
    return xg, out

fig, ax = plt.subplots(1, 3, figsize=(18, 5))
# panel 1: greedy vs training win-rate
xg, tr = series("charts/ep_win_rate")
for y in tr: ax[0].plot(xg, y, lw=1.4, color="#c0392b", alpha=.7)
xg, gr = series("eval/greedy_win_rate", smooth=False)
for y in gr: ax[0].plot(xg, y, lw=2.2, color="#1a7a3a", marker="o", ms=3)
ax[0].plot([], [], color="#c0392b", label="training (stochastic) win-rate")
ax[0].plot([], [], color="#1a7a3a", marker="o", label="GREEDY (deterministic) win-rate")
ax[0].set_ylim(-0.02, 1.05); ax[0].axhline(1.0, ls="--", lw=1, color="0.5")
ax[0].set_title("greedy vs training win-rate"); ax[0].legend(fontsize=9); ax[0].set_ylabel("win rate")
# panel 2: raw return
xg, rr = series("charts/ep_return_mean")
for y in rr: ax[1].plot(xg, y, lw=1.4, color="#2471a3", alpha=.8)
ax[1].axhline(55000, ls="--", lw=1, color="0.5"); ax[1].set_title("raw return (reference)"); ax[1].set_ylabel("train return")
# panel 3: entropy anneal
xg, en = series("charts/entropy_cost", smooth=False)
for y in en: ax[2].plot(xg, y, lw=2.0, color="#8e44ad")
ax[2].set_title("entropy anneal (schedule check)"); ax[2].set_ylabel("entropy_cost")
for a in ax: a.set_xlabel("env steps (M)")
fig.suptitle("asteroids_medium (env42) IMPALA: greedy-eval + entropy annealing", fontsize=14)
fig.tight_layout(rect=[0, 0, 1, 0.95])
out = "outputs/figs/asteroids_anneal_greedy_vs_train.png"
fig.savefig(out, dpi=140); print("saved", out)
