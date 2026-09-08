"""cqhex2 best recipe (abs_one, ent 0.004, lr 1e-4, LSTM) on a SINGLE fixed env
(fixed_env_seed=42, 150M) — the first greedy measurement on cqhex2. Question:
does the deterministic/argmax policy win, like it does on asteroids-with-action-
repeat? (gridworld -> expected yes, unlike the pre-fix asteroids control task.)
Panel 1: GREEDY win-rate (per-seed thin + mean). Panel 2: stochastic win-rate.
Saves outputs/figs/cqhex2_fixed42.png."""
import numpy as np
import matplotlib.pyplot as plt
import wandb

try:
    plt.style.use("seaborn-v0_8-darkgrid")
except OSError:
    plt.style.use("seaborn-darkgrid")

ENT = "truongtruong-harvard-university/analogen"
GROUP = "cqhex2_fixed42"
STEPS_M, GRID = 150, 1000
api = wandb.Api(timeout=60)

def ema(y, a=0.1):
    o = np.empty_like(y, float); acc = y[0]
    for i, v in enumerate(y): acc = a*v+(1-a)*acc; o[i] = acc
    return o

def pull(key, smooth):
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

fig, ax = plt.subplots(1, 2, figsize=(14, 5.2))
for panel, (key, title, greedy) in enumerate([
        ("eval/greedy_win_rate", "GREEDY win-rate (the new measurement)", True),
        ("charts/ep_win_rate", "training (stochastic) win-rate", False)]):
    xg, ys = pull(key, smooth=not greedy)
    if ys:
        arr = np.vstack(ys); c = "#1a7a3a"
        if greedy:
            for row in arr: ax[panel].plot(xg, row, color=c, lw=0.7, alpha=0.4)
        ax[panel].plot(xg, arr.mean(0), color=c, lw=2.4, label=f"fixed_env=42 ({len(ys)} seeds)",
                       **(dict(marker="o", ms=2.5) if greedy else {}))
    ax[panel].axhline(1.0, ls="--", lw=1, color="0.6")
    ax[panel].axhline(0.96, ls=":", lw=1, color="0.5")
    ax[panel].text(2, 0.955, "pool stochastic ~0.96", fontsize=7, color="0.4", va="top")
    ax[panel].set_ylim(-0.02, 1.05); ax[panel].set_title(title)
    ax[panel].set_xlabel("env steps (M)"); ax[panel].set_ylabel("win rate"); ax[panel].legend(fontsize=9)
fig.suptitle("cqhex2 best recipe on a fixed env: does the GREEDY policy win?", fontsize=13)
fig.tight_layout(rect=[0, 0, 1, 0.95])
out = "outputs/figs/cqhex2_fixed42.png"
fig.savefig(out, dpi=140); print("saved", out)
