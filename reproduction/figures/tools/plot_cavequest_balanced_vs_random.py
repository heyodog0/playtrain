"""Balanced vs random training-binding draw, held-out generalization on
analogen_cavequest_easy.

y-axis = held-out win-rate (fraction of the 60 held-out sword=key configs solved).
- random (balance=none): MEAN over draws, with a bootstrap 95% CI band
  (1000 resamples) and the full min-max range as a faint outline.
- balanced (key_visual): 1 run per N -> plain line, no band.

Reads heldout_eval.json written by tools/eval_generalization.py.
"""
import glob, re, json
from collections import defaultdict
import numpy as np
import matplotlib.pyplot as plt

N_BOOT = 1000
RNG = np.random.default_rng(0)

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


# balanced: 1 run per N
bal = {}
for f in glob.glob("outputs/impala_cavequest_finesweep_N*/heldout_eval.json"):
    m = re.search(r"_finesweep_N(\d+)/", f)
    if m:
        bal[int(m.group(1))] = json.load(open(f))["heldout_win_rate"]
bN = np.array(sorted(bal)); bv = np.array([bal[n] for n in bN])

# random: several draws per N
rnd = defaultdict(list)
for f in glob.glob("outputs/impala_cavequest_finesweep_rand_N*_s*/heldout_eval.json"):
    N = int(re.search(r"_rand_N(\d+)_s", f).group(1))
    rnd[N].append(json.load(open(f))["heldout_win_rate"])
rN = np.array(sorted(rnd))
rmean = np.array([np.mean(rnd[n]) for n in rN])
rmn = np.array([np.min(rnd[n]) for n in rN])
rmx = np.array([np.max(rnd[n]) for n in rN])
rblo, rbhi = zip(*[bootstrap_ci(rnd[n]) for n in rN])
rblo, rbhi = np.array(rblo), np.array(rbhi)
ndraws = max(len(v) for v in rnd.values() if len(v))

LBL, TICK, LEG, TITLE = 20, 16, 14, 18
fig, ax = plt.subplots(figsize=(8.5, 6))
# random: faint full range + bootstrap CI + mean line
ax.fill_between(rN, rmn, rmx, color="#DD8452", alpha=0.08,
                label="random: min–max (range)")
ax.fill_between(rN, rblo, rbhi, color="#DD8452", alpha=0.22,
                label=f"random: bootstrap 95% CI (n≤{ndraws})")
ax.plot(rN, rmean, "--s", lw=2.6, ms=8, color="#DD8452",
        label="random (unbalanced): mean")
# balanced: single line
ax.plot(bN, bv, "-o", lw=3, ms=8, color="#4C72B0",
        label="balanced (key_visual): 1 run/N")

ax.set_xscale("log")
ticks = [1, 2, 4, 8, 16, 32, 64, 128, 300]
ax.set_xticks(ticks); ax.set_xticklabels(ticks, fontsize=TICK)
ax.tick_params(axis="y", labelsize=TICK)
ax.set_xlabel("N distinct training bindings", fontsize=LBL)
ax.set_ylabel("Held-out win-rate", fontsize=LBL)
ax.set_ylim(-0.03, 1.05)
ax.set_title("Balanced vs random binding draw\n(analogen_cavequest_easy)",
             fontsize=TITLE)
ax.legend(loc="lower right", fontsize=LEG, framealpha=0.95,
          borderpad=0.8, handletextpad=0.6)
fig.tight_layout()
out = "outputs/figs/cavequest_generalization_balanced_vs_random.png"
fig.savefig(out, dpi=160)
print("saved", out)
