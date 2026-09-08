"""Generalization curve on analogen_cavequest_easy for the RANDOM (unbalanced)
training-binding draw.

y-axis = held-out win-rate (the directly-measured quantity: fraction of the 60
held-out sword=key configs solved). Per N we have several random draws; we plot
their MEAN with a bootstrap 95% CI band (1000 resamples) and the full min-max
range as a faint outline. Individual per-seed points are also shown.

N=300 is the deterministic full-set point (the draw can't vary) -> single point.
"""
import glob, re, json
from collections import defaultdict
import numpy as np
import matplotlib.pyplot as plt

N_BOOT = 1000
RNG = np.random.default_rng(0)  # fixed for reproducible CI

try:
    plt.style.use("seaborn-v0_8-darkgrid")
except OSError:
    plt.style.use("seaborn-darkgrid")


def bootstrap_ci(vals, n_boot=N_BOOT):
    a = np.asarray(vals, dtype=float)
    if len(a) < 2 or np.ptp(a) == 0:
        return float(a.mean()), float(a.mean())
    idx = RNG.integers(0, len(a), size=(n_boot, len(a)))
    means = a[idx].mean(axis=1)
    return float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5))


vals = defaultdict(list)
for f in glob.glob("outputs/impala_cavequest_finesweep_rand_N*_s*/heldout_eval.json"):
    N = int(re.search(r"_rand_N(\d+)_s", f).group(1))
    vals[N].append(json.load(open(f))["heldout_win_rate"])

Ns = np.array(sorted(vals))
mean = np.array([np.mean(vals[n]) for n in Ns])
mn = np.array([np.min(vals[n]) for n in Ns])
mx = np.array([np.max(vals[n]) for n in Ns])
blo, bhi = zip(*[bootstrap_ci(vals[n]) for n in Ns])
blo, bhi = np.array(blo), np.array(bhi)
ndraws = max(len(vals[n]) for n in Ns)

LBL, TICK, LEG, TITLE = 20, 16, 15, 18
fig, ax = plt.subplots(figsize=(8.5, 6))
# full range, faint outline
ax.fill_between(Ns, mn, mx, color="#4C72B0", alpha=0.07, label="min–max (range)")
# bootstrap 95% CI of the mean
ax.fill_between(Ns, blo, bhi, color="#4C72B0", alpha=0.25,
                label="bootstrap 95% CI")
# mean line
ax.plot(Ns, mean, "-o", lw=3, ms=8, color="#4C72B0", label="mean held-out win-rate")
# individual per-seed points
for n in Ns:
    ax.plot([n] * len(vals[n]), vals[n], "o", ms=5, color="#4C72B0",
            alpha=0.30, zorder=3)

ax.set_xscale("log")
ticks = [1, 2, 4, 8, 16, 32, 64, 128, 300]
ax.set_xticks(ticks); ax.set_xticklabels(ticks, fontsize=TICK)
ax.tick_params(axis="y", labelsize=TICK)
ax.set_xlabel("N distinct training bindings", fontsize=LBL)
ax.set_ylabel("Held-out win-rate", fontsize=LBL)
ax.set_ylim(-0.03, 1.05)
ax.set_title(f"Binding generalization — random (unbalanced) draw\n"
             f"(analogen_cavequest_easy, {ndraws} draws/N; N=300 deterministic)",
             fontsize=TITLE)
ax.legend(loc="lower right", fontsize=LEG, framealpha=0.95,
          borderpad=0.8, handletextpad=0.6)
fig.tight_layout()
out = "outputs/figs/cavequest_generalization_curve_random.png"
fig.savefig(out, dpi=160)
print("saved", out)
