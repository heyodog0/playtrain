"""Training-return curves for the cavequest_hard_explore no-holdout sweep at 100M
steps (vec recipe, batch 64 @ 2e-4, MPS). Companion to plot_cqhe_training_nohd.py
(the original 40M figure); same style, pointed at the 100M W&B group and x-axis.
Saves:
  cqhex2_training_nohd_150M.png      - small multiples, one panel per N, 4 seed lines
  cqhex2_training_nohd_150M_agg.png  - single panel, per-N median (EMA) + seed band
Raw episode-mean return is spiky, so every curve is EMA-smoothed."""
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
GROUP = "cqhex2_nohd_150M"
WIN = 55000
STEPS_M = 150        # x-axis max, millions (was 40 for the original)
GRID = 1000          # resample every curve onto a common step grid

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

# Only FINISHED runs — the group also holds crashed/cancelled runs (failed canary,
# scancel'd first batch) that would add stray short curves. All 40 sweep jobs are
# sacct COMPLETED, so state=="finished" isolates exactly them.
runs = sorted(api.runs(ENT, filters={"group": GROUP, "state": "finished"}), key=getN)
print(f"{len(runs)} finished runs in group {GROUP}")

byN = defaultdict(dict)  # N -> {seed: y_smoothed}, dict dedups any requeued repeats
xg = np.linspace(0, STEPS_M, GRID)
for r in runs:
    N = getN(r)
    sm = re.search(r"_s(\d+)$", r.name)
    seed = int(sm.group(1)) if sm else len(byN[N])
    total = float(r.config.get("total_steps", 100_000_000))
    h = r.history(keys=[KEY], samples=4000)
    if h.empty or KEY not in h:
        print("  no history:", r.name); continue
    h = h.dropna(subset=[KEY])
    x = (h["_step"] / h["_step"].max() * (total / 1e6)).to_numpy()
    ys = ema(h[KEY].to_numpy())
    byN[N][seed] = np.interp(xg, x, ys)

byN = {N: list(d.values()) for N, d in byN.items()}
print("seeds per N:", {N: len(v) for N, v in sorted(byN.items())})

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
fig.suptitle("cqhex2 (no holdout): training return per N (EMA-smoothed) — 150M steps\n"
             "dashed = win (+55k); abs_one, entropy 0.004, lr 1e-4 (tuned)",
             fontsize=13)
fig.tight_layout(rect=[0, 0, 1, 0.94])
out1 = "outputs/figs/cqhex2_training_nohd_150M.png"
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
ax.set_title("cavequest_hard_explore (no holdout): per-N median training return — 150M steps (cqhex2, abs_one, ent 0.004, lr 1e-4)\n"
             "(band = seed min-max; colored by N train bindings)", fontsize=14)
sm = mpl.cm.ScalarMappable(norm=norm, cmap=cmap)
cb = fig2.colorbar(sm, ax=ax, pad=0.01); cb.set_label("N train bindings", fontsize=11)
fig2.tight_layout()
out2 = "outputs/figs/cqhex2_training_nohd_150M_agg.png"
fig2.savefig(out2, dpi=160); print("saved", out2)
