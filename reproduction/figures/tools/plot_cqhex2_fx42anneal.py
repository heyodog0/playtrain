"""cqhex2 fixed-env: does entropy annealing PIN the greedy policy (kill the 0<->1
thrash), like fs3+anneal did on asteroids? const 0.004 (cqhex2_fixed42) vs
anneal 0.004->0.0005 (cqhex2_fixed42_anneal), both fs7 fixed_env=42, 150M.
Panel 1: greedy win-rate (per-seed thin + mean). Panel 2: stochastic. Panel 3:
greedy STABILITY = fraction of late (>60%) eval points at win, mean over seeds.
Saves outputs/figs/cqhex2_fx42anneal.png."""
import numpy as np
import matplotlib.pyplot as plt
import wandb

try:
    plt.style.use("seaborn-v0_8-darkgrid")
except OSError:
    plt.style.use("seaborn-darkgrid")

ENT = "truongtruong-harvard-university/analogen"
STEPS_M, GRID = 150, 1000
ARMS = [("cqhex2_fixed42", "const 0.004", "#c0392b"),
        ("cqhex2_fixed42_anneal", "anneal 0.004->0.0005", "#1a7a3a")]
api = wandb.Api(timeout=60)

def ema(y, a=0.1):
    o = np.empty_like(y, float); acc = y[0]
    for i, v in enumerate(y): acc = a*v+(1-a)*acc; o[i] = acc
    return o

def pull(group, key, smooth):
    xg = np.linspace(0, STEPS_M, GRID); curves=[]; latewin=[]
    for r in api.runs(ENT, filters={"group": group, "state": "finished"}):
        h = r.history(keys=[key], samples=4000)
        if key not in h.columns: continue
        h = h.dropna(subset=[key])
        if len(h) < 3: continue
        x = (h["_step"]/h["_step"].max()*STEPS_M).to_numpy(); y = h[key].to_numpy()
        curves.append(np.interp(xg, x, ema(y) if smooth and len(y)>5 else y))
        if "greedy" in key:
            late = y[x/STEPS_M > 0.6]                       # raw eval points, late training
            if len(late): latewin.append(float((late >= 0.999).mean()))
    return xg, curves, latewin

fig, ax = plt.subplots(1, 3, figsize=(18, 5.2), gridspec_kw={"width_ratios":[1.4,1.4,1]})
stab=[]
for group, label, color in ARMS:
    xg, gc, latewin = pull(group, "eval/greedy_win_rate", smooth=False)
    if gc:
        arr=np.vstack(gc)
        for row in arr: ax[0].plot(xg, row, color=color, lw=0.6, alpha=0.35)
        ax[0].plot(xg, arr.mean(0), color=color, lw=2.4, marker="o", ms=2, label=f"{label} ({len(gc)})")
    _, sc, _ = pull(group, "charts/ep_win_rate", smooth=True)
    if sc:
        arr=np.vstack(sc); ax[1].plot(xg, arr.mean(0), color=color, lw=2.2, label=f"{label} ({len(sc)})")
        ax[1].fill_between(xg, arr.min(0), arr.max(0), color=color, alpha=0.10)
    stab.append((label.split(" ")[0], color, np.mean(latewin) if latewin else np.nan))
for a in (ax[0],ax[1]): a.axhline(1.0, ls="--", lw=1, color="0.6"); a.set_ylim(-0.02,1.05); a.set_xlabel("env steps (M)"); a.set_ylabel("win rate"); a.legend(fontsize=9)
ax[0].set_title("GREEDY win-rate (does anneal pin it?)"); ax[1].set_title("stochastic win-rate")
# stability bar
labs=[s[0] for s in stab]; cols=[s[1] for s in stab]; vals=[s[2] for s in stab]
ax[2].bar(range(len(labs)), vals, color=cols, alpha=0.85)
ax[2].set_xticks(range(len(labs))); ax[2].set_xticklabels(labs, fontsize=9)
ax[2].set_ylim(0,1.05); ax[2].set_title("greedy STABILITY\n(frac of late evals at win)")
for i,v in enumerate(vals):
    if not np.isnan(v): ax[2].text(i, v+0.02, f"{v:.2f}", ha="center", fontsize=9)
fig.suptitle("cqhex2 fixed-env: can entropy annealing pin the greedy policy (the asteroids cure)?", fontsize=13)
fig.tight_layout(rect=[0,0,1,0.95])
out="outputs/figs/cqhex2_fx42anneal.png"
fig.savefig(out, dpi=140); print("saved", out)
