"""cavequest_medium: balanced vs random binding-draw generalization (C3 holdout).

y = held-out win-rate vs N distinct training bindings (held-out re-binds
KEY+BOOTS+sword onto novel icons; 6 bindings x 10 placements = 60 episodes).
- balanced (key_visual): 1 draw per N -> line.
- random (balance=none): up to 3 draws per N -> mean + bootstrap 95% CI band
  (1000 resamples) + faint min-max outline.
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


def boot_ci(vals):
    a = np.asarray(vals, float)
    if len(a) < 2 or np.ptp(a) == 0:
        return float(a.mean()), float(a.mean())
    idx = RNG.integers(0, len(a), size=(N_BOOT, len(a)))
    m = a[idx].mean(axis=1)
    return float(np.percentile(m, 2.5)), float(np.percentile(m, 97.5))


bal = {}
for f in glob.glob("outputs/impala_cqm_balsweep_c3_N*_50M/heldout_eval.json"):
    N = int(re.search(r"_N(\d+)_", f).group(1))
    bal[N] = json.load(open(f))["heldout_win_rate"]
bN = np.array(sorted(bal)); bv = np.array([bal[n] for n in bN])

rnd = defaultdict(list)
for f in glob.glob("outputs/impala_cqm_randsweep_c3_N*_s*_30M/heldout_eval.json"):
    N = int(re.search(r"_N(\d+)_s", f).group(1))
    rnd[N].append(json.load(open(f))["heldout_win_rate"])
rN = np.array(sorted(rnd))
rmean = np.array([np.mean(rnd[n]) for n in rN])
rlo = np.array([np.min(rnd[n]) for n in rN]); rhi = np.array([np.max(rnd[n]) for n in rN])
bclo, bchi = zip(*[boot_ci(rnd[n]) for n in rN]); bclo, bchi = np.array(bclo), np.array(bchi)
ndraws = max(len(v) for v in rnd.values())

LBL, TICK, LEG, TITLE = 20, 16, 14, 17
fig, ax = plt.subplots(figsize=(8.5, 6))
ax.fill_between(rN, rlo, rhi, color="#DD8452", alpha=0.08, label="random: min–max")
ax.fill_between(rN, bclo, bchi, color="#DD8452", alpha=0.22,
                label=f"random: bootstrap 95% CI (n≤{ndraws})")
ax.plot(rN, rmean, "--s", lw=2.6, ms=8, color="#DD8452", label="random (unbalanced): mean")
ax.plot(bN, bv, "-o", lw=3, ms=8, color="#4C72B0", label="balanced (key_visual)")
ax.set_xscale("log")
ticks = [1, 2, 4, 8, 16, 32]
ax.set_xticks(ticks); ax.set_xticklabels(ticks, fontsize=TICK)
ax.tick_params(axis="y", labelsize=TICK)
ax.set_xlabel("N distinct training bindings", fontsize=LBL)
ax.set_ylabel("Held-out win-rate", fontsize=LBL)
ax.set_ylim(-0.03, 1.05)
ax.set_title("cavequest_medium: balanced vs random draw\n(C3 held-out: KEY+BOOTS+sword re-bound)",
             fontsize=TITLE)
ax.legend(loc="lower right", fontsize=LEG, framealpha=0.95, borderpad=0.7)
fig.tight_layout()
out = "outputs/figs/cqm_balanced_vs_random_c3.png"
fig.savefig(out, dpi=160)
print("saved", out)
for n in rN:
    print(f"  N={n:>2}  random {np.mean(rnd[n]):.3f} (n={len(rnd[n])})  | balanced {bal.get(n,float('nan')):.3f}")
