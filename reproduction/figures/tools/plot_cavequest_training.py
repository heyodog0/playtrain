"""Training-return curves for the cavequest sweep, pulled from W&B: two panels,
IMPALA-LSTM (finesweep N=1-10) and IMPALA-FF (nsweep N=1..300), one line per run
colored by N. Shows both train to mastery (~win) regardless of N."""
import re
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
GROUPS = [("cavequest_finesweep", "IMPALA-LSTM"), ("cavequest_ff_nsweep", "IMPALA-FF")]

api = wandb.Api(timeout=40)

def getN(r):
    m = re.search(r"_N(\d+)", r.name)
    if m:
        return int(m.group(1))
    return int(r.config.get("train_pool", {}).get("n_train_bindings", 0))

fig, axes = plt.subplots(1, 2, figsize=(13.5, 5.2), sharey=True)
for ax, (grp, title) in zip(axes, GROUPS):
    runs = sorted(api.runs(ENT, filters={"group": grp}), key=getN)
    Ns = [getN(r) for r in runs]
    norm = mpl.colors.LogNorm(vmin=max(1, min(Ns)), vmax=max(Ns))
    cmap = mpl.cm.viridis
    for r in runs:
        N = getN(r)
        total = float(r.config.get("total_steps", 10_000_000))
        h = r.history(keys=[KEY], samples=1500)
        if h.empty or KEY not in h:
            print("no history:", r.name); continue
        h = h.dropna(subset=[KEY])
        # wandb _step is a log counter, not env steps; map it linearly onto the
        # run's true env-step budget (all ran total_steps).
        x = h["_step"] / h["_step"].max() * (total / 1e6)
        ax.plot(x, h[KEY], lw=1.4, alpha=0.85, color=cmap(norm(N)))
    ax.set_title(title, fontsize=15)
    ax.set_xlabel("env steps (millions)", fontsize=12)
    sm = mpl.cm.ScalarMappable(norm=norm, cmap=cmap)
    cb = fig.colorbar(sm, ax=ax, pad=0.01)
    cb.set_label("N train bindings", fontsize=10)
axes[0].set_ylabel("training return (episode mean)", fontsize=12)
fig.suptitle("Both architectures train to mastery at every N\n(generalization is what differs)", fontsize=16)
fig.tight_layout()
out = "outputs/figs/cavequest_training_curves.png"
fig.savefig(out, dpi=160)
print("saved", out)
