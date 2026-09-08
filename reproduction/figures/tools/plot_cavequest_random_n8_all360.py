"""Random (balance=none) finesweep, n<=8 draws/N, 4 visual conditions, scored on
ALL 360 bindings. Mirror of plot_cavequest_random_n8_conditions.py (log-N)."""
import glob, re, json
from collections import defaultdict
import numpy as np, matplotlib.pyplot as plt
RNG = np.random.default_rng(0)
try: plt.style.use("seaborn-v0_8-darkgrid")
except OSError: plt.style.use("seaborn-darkgrid")

def ci(v):
    a = np.asarray(v, float)
    if len(a) < 2 or np.ptp(a) == 0: return a.mean(), a.mean()
    m = a[RNG.integers(0, len(a), size=(1000, len(a)))].mean(1)
    return np.percentile(m, 2.5), np.percentile(m, 97.5)

def curve(fn):
    d = defaultdict(list)
    for f in glob.glob(f"outputs/impala_cavequest_finesweep_rand_N[0-9]*_s*/{fn}"):
        d[int(re.search(r"finesweep_rand_N(\d+)", f).group(1))].append(json.load(open(f))["heldout_win_rate"])
    N = np.array(sorted(d)); mean = np.array([np.mean(d[n]) for n in N])
    lo, hi = zip(*[ci(d[n]) for n in N]); return N, mean, np.array(lo), np.array(hi), [len(d[n]) for n in N]

conds = [("heldout_eval_all360.json", "normal", "#4C72B0"), ("heldout_eval_all360_recolor.json", "recolor", "#C44E52"),
         ("heldout_eval_all360_mono.json", "monochrome", "#8172B3"), ("heldout_eval_all360_swap.json", "sprite-swap", "#55A868")]
# Gather every curve first, then place N on an EVENLY-SPACED categorical axis
# (the exponential draws 1..128 plus the two endpoints 300 = full non-held-out,
# 360 = no-holdout ceiling sit too close on a log axis; categorical spreads them).
curves, allN = {}, set()
for fn, lab, col in conds:
    N, m, lo, hi, ns = curve(fn)
    if len(N) == 0: print(f"{lab}: NO DATA ({fn})"); continue
    curves[lab] = (N, m, lo, hi, ns, col); allN.update(int(n) for n in N)
ORDER = sorted(allN)
pos = {n: i for i, n in enumerate(ORDER)}
fig, ax = plt.subplots(figsize=(9.4, 6))
for lab, (N, m, lo, hi, ns, col) in curves.items():
    x = [pos[int(n)] for n in N]
    ax.fill_between(x, lo, hi, color=col, alpha=0.15)
    ax.plot(x, m, "-o", lw=2.6, ms=7, color=col, label=lab)
    print(f"{lab:11}", {int(n): round(float(v), 3) for n, v in zip(N, m)}, "n=", ns)
# Mark N=360 as a distinct regime (no held-out set) vs the held-out sweep.
if 360 in pos and 300 in pos:
    ax.axvline(pos[360] - 0.5, color="0.5", ls="--", lw=1.2, alpha=0.7)
    ax.text(pos[360], -0.135, "no\nholdout", fontsize=9.5, ha="center", va="top", color="0.35")
ax.set_xticks(range(len(ORDER))); ax.set_xticklabels(ORDER, fontsize=14); ax.tick_params(axis='y', labelsize=15)
ax.set_xlim(-0.4, len(ORDER) - 0.6)
ax.set_xlabel("N distinct training bindings", fontsize=20); ax.set_ylabel("Win-rate (all 360 bindings)", fontsize=20)
ax.set_ylim(-0.03, 1.05)
ax.set_title("cavequest_easy RANDOM (n≤8 seeds/N): visual robustness\n(trained + scored under deterministic env, on ALL 360 bindings, bootstrap 95% CI)", fontsize=14)
ax.legend(loc="lower right", fontsize=14, framealpha=.95)
fig.tight_layout(); fig.savefig("outputs/figs/cavequest_random_n8_all360.png", dpi=160); print("saved")
