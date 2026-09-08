"""Training-return curves for the cavequest_hard_explore no-holdout sweep, pulled
from W&B. Two views, both saved:
  cqhe_training_nohd.png        - small multiples, one panel per N, 4 seed lines each
  cqhe_training_nohd_agg.png    - single panel, per-N median (EMA-smoothed) + seed band
Raw episode-mean return is extremely spiky (0<->80k every log step), so every
curve is EMA-smoothed. Shows whether each N trains to mastery (win ~ +55k)."""
import re
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
KEY = "charts/ep_return_mean"
GROUP = "cavequest_hard_explore_nohd"
WIN = 55000
GRID = 400  # resample every curve onto a common step grid (millions)

api = wandb.Api(timeout=60)

def getN(r):
    m = re.search(r"_N(\d+)_s", r.name)
    if m:
        return int(m.group(1))
    return int(r.config.get("train_pool", {}).get("n_train_bindings", 0))

def ema(y, alpha=0.06):
    out = np.empty_like(y, dtype=float)
    acc = y[0]
    for i, v in enumerate(y):
        acc = alpha * v + (1 - alpha) * acc
        out[i] = acc
    return out

runs = sorted(api.runs(ENT, filters={"group": GROUP}), key=getN)
print(f"{len(runs)} runs in group {GROUP}")

# Pull + resample every run onto a common 0..40M grid.
byN = defaultdict(list)  # N -> list of (xgrid, y_smoothed)
xg = np.linspace(0, 40, GRID)
for r in runs:
    N = getN(r)
    total = float(r.config.get("total_steps", 40_000_000))
    h = r.history(keys=[KEY], samples=2000)
    if h.empty or KEY not in h:
        print("no history:", r.name); continue
    h = h.dropna(subset=[KEY])
    x = (h["_step"] / h["_step"].max() * (total / 1e6)).to_numpy()
    y = h[KEY].to_numpy()
    ys = ema(y)
    yi = np.interp(xg, x, ys)
    byN[N].append(yi)

Ns = sorted(byN)
norm = mpl.colors.LogNorm(vmin=max(1, min(Ns)), vmax=max(Ns))
cmap = mpl.cm.viridis

# ---- View 1: small multiples, one panel per N ----
ncol = 5
nrow = int(np.ceil(len(Ns) / ncol))
fig, axes = plt.subplots(nrow, ncol, figsize=(3.1 * ncol, 2.7 * nrow),
                         sharex=True, sharey=True)
axes = np.array(axes).reshape(-1)
for ax, N in zip(axes, Ns):
    col = cmap(norm(N))
    for yi in byN[N]:
        ax.plot(xg, yi, lw=1.2, alpha=0.85, color=col)
    ax.axhline(WIN, ls="--", lw=1.0, color="0.4", alpha=.7)
    ax.set_title(f"N = {N}  ({len(byN[N])} seeds)", fontsize=11)
    ax.set_ylim(-2000, 80000)
for ax in axes[len(Ns):]:
    ax.set_visible(False)
for ax in axes.reshape(nrow, ncol)[-1]:
    ax.set_xlabel("env steps (M)", fontsize=10)
for ax in axes.reshape(nrow, ncol)[:, 0]:
    ax.set_ylabel("train return", fontsize=10)
fig.suptitle("cavequest_hard_explore (no holdout): training return per N (EMA-smoothed)\n"
             "dashed = win (+55k); every N reaches mastery, higher N is steadier",
             fontsize=13)
fig.tight_layout(rect=[0, 0, 1, 0.94])
out1 = "outputs/figs/cqhe_training_nohd.png"
fig.savefig(out1, dpi=150); print("saved", out1)

# ---- View 2: single panel, per-N median + seed band ----
fig2, ax = plt.subplots(figsize=(10.5, 6.2))
for N in Ns:
    arr = np.vstack(byN[N])
    med = np.median(arr, axis=0)
    lo, hi = arr.min(0), arr.max(0)
    col = cmap(norm(N))
    ax.fill_between(xg, lo, hi, color=col, alpha=0.10)
    ax.plot(xg, med, lw=2.0, color=col, label=f"N={N}")
ax.axhline(WIN, ls="--", lw=1.4, color="0.35", alpha=.8)
ax.text(0.5, WIN, "  win ≈ +55k", va="bottom", ha="left", fontsize=11, color="0.3")
ax.set_xlabel("env steps (millions)", fontsize=13)
ax.set_ylabel("training return (episode mean, EMA-smoothed)", fontsize=13)
ax.set_title("cavequest_hard_explore (no holdout): per-N median training return\n"
             "(band = seed min-max; colored by N train bindings)", fontsize=14)
sm = mpl.cm.ScalarMappable(norm=norm, cmap=cmap)
cb = fig2.colorbar(sm, ax=ax, pad=0.01); cb.set_label("N train bindings", fontsize=11)
fig2.tight_layout()
out2 = "outputs/figs/cqhe_training_nohd_agg.png"
fig2.savefig(out2, dpi=160); print("saved", out2)
