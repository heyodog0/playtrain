"""asteroids_medium hybrid-clip A/B (env42, 100M, ent 0.004 const, lr 1e-4):
baseline (abs_one) vs win_bonus=15. The decisive panel is GREEDY win-rate — does
the win bonus create a gradient that makes the argmax policy actually win, where
plain abs_one leaves it stuck at 0?
Saves outputs/figs/asteroids_hybrid_ab.png."""
import numpy as np
import matplotlib.pyplot as plt
import wandb

try:
    plt.style.use("seaborn-v0_8-darkgrid")
except OSError:
    plt.style.use("seaborn-darkgrid")

ENT = "truongtruong-harvard-university/analogen"
GROUP = "asteroids_hybrid_ab"
ARMS = [("baseline", "abs_one (baseline)", "#c0392b"),
        ("winbonus", "hybrid: win_bonus=15", "#1a7a3a")]
STEPS_M, GRID = 100, 1000
api = wandb.Api(timeout=60)

def ema(y, a=0.1):
    o = np.empty_like(y, float); acc = y[0]
    for i, v in enumerate(y): acc = a*v+(1-a)*acc; o[i] = acc
    return o

def series(arm_tag, key, smooth=True):
    xg = np.linspace(0, STEPS_M, GRID); out = []
    for r in api.runs(ENT, filters={"group": GROUP, "state": "finished"}):
        if arm_tag not in r.name: continue
        h = r.history(keys=[key], samples=4000)
        if key not in h.columns: continue
        h = h.dropna(subset=[key])
        if len(h) < 3: continue
        x = (h["_step"] / h["_step"].max() * STEPS_M).to_numpy()
        y = h[key].to_numpy()
        out.append(np.interp(xg, x, ema(y) if smooth and len(y) > 5 else y))
    return xg, out

fig, ax = plt.subplots(1, 2, figsize=(13, 5.2))
for tag, label, color in ARMS:
    xg, gr = series(tag, "eval/greedy_win_rate", smooth=False)
    for y in gr: ax[0].plot(xg, y, lw=2.2, color=color, marker="o", ms=3, alpha=.85)
    ax[0].plot([], [], color=color, marker="o", label=label)
    xg, tr = series(tag, "charts/ep_win_rate")
    for y in tr: ax[1].plot(xg, y, lw=1.6, color=color, alpha=.8)
    ax[1].plot([], [], color=color, label=label)
ax[0].set_title("GREEDY (deterministic) win-rate — the decisive metric")
ax[1].set_title("training (stochastic) win-rate")
for a in ax:
    a.set_ylim(-0.02, 1.05); a.axhline(1.0, ls="--", lw=1, color="0.5")
    a.set_xlabel("env steps (M)"); a.set_ylabel("win rate"); a.legend(fontsize=10)
fig.suptitle("asteroids_medium hybrid clip A/B: does a terminal-win bonus make the policy CONSOLIDATE winning?",
             fontsize=13)
fig.tight_layout(rect=[0, 0, 1, 0.95])
out = "outputs/figs/asteroids_hybrid_ab.png"
fig.savefig(out, dpi=140); print("saved", out)
