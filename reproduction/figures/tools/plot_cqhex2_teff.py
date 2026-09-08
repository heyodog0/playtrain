"""cqhex2 TERMINAL EFFICIENCY bonus: does rewarding fast wins at the terminal
(graded win clip, no per-step tax) make the policy more efficient WITHOUT losing
win-rate? teff (game cqhex2_teff, win graded 4.67->8 by speed) vs baseline
(cqhex2_fixed42, abs_one win->+1). Both fixed_env=42, fs7, 150M.
Panel 1: win-rate (must stay ~0.96 — did efficiency pressure cost anything?).
Panel 2: raw return — teff climbing ABOVE the ~70-80k win-base = the agent is
claiming the speed bonus = winning FASTER (back out frames: bonus=return-base,
frames=15000*(1-bonus/40000)). Panel 3: greedy win-rate.
Saves outputs/figs/cqhex2_teff.png."""
import numpy as np
import matplotlib.pyplot as plt
import wandb

try:
    plt.style.use("seaborn-v0_8-darkgrid")
except OSError:
    plt.style.use("seaborn-darkgrid")

ENT = "truongtruong-harvard-university/analogen"
STEPS_M, GRID = 150, 1000
ARMS = [("cqhex2_fixed42", "baseline (abs_one win=+1)", "#7f8c8d"),
        ("cqhex2_teff", "teff (graded speed bonus)", "#1a7a3a")]
api = wandb.Api(timeout=60)

def ema(y, a=0.08):
    o = np.empty_like(y, float); acc = y[0]
    for i, v in enumerate(y): acc = a*v+(1-a)*acc; o[i] = acc
    return o

def pull(group, key, smooth):
    xg = np.linspace(0, STEPS_M, GRID); out = []
    for r in api.runs(ENT, filters={"group": group, "state": "finished"}):
        h = r.history(keys=[key], samples=4000)
        if key not in h.columns: continue
        h = h.dropna(subset=[key])
        if len(h) < 5: continue
        x = (h["_step"]/h["_step"].max()*STEPS_M).to_numpy(); y = h[key].to_numpy()
        out.append(np.interp(xg, x, ema(y) if smooth else y))
    return xg, out

fig, ax = plt.subplots(1, 3, figsize=(18, 5.2))
panels = [("charts/ep_win_rate", "stochastic win-rate (must hold ~0.96)", True, (-0.02, 1.05)),
          ("charts/ep_return_mean", "raw return (teff above base = faster wins)", True, None),
          ("eval/greedy_win_rate", "greedy win-rate", False, (-0.02, 1.05))]
for pi, (key, title, smooth, ylim) in enumerate(panels):
    for group, label, color in ARMS:
        xg, ys = pull(group, key, smooth)
        if not ys: continue
        arr = np.vstack(ys)
        ax[pi].plot(xg, arr.mean(0), color=color, lw=2.2, label=f"{label} ({len(ys)})",
                    **(dict(marker="o", ms=2) if not smooth else {}))
        ax[pi].fill_between(xg, arr.min(0), arr.max(0), color=color, alpha=0.10)
    ax[pi].set_title(title); ax[pi].set_xlabel("env steps (M)"); ax[pi].legend(fontsize=8)
    if ylim: ax[pi].set_ylim(*ylim)
ax[1].axhline(80000, ls=":", lw=1, color="0.5"); ax[1].text(2, 81000, "win base ~80k (0 speed bonus)", fontsize=7, color="0.4")
fig.suptitle("cqhex2 terminal-efficiency bonus: faster wins without losing win-rate?", fontsize=13)
fig.tight_layout(rect=[0, 0, 1, 0.95])
out = "outputs/figs/cqhex2_teff.png"
fig.savefig(out, dpi=140); print("saved", out)
