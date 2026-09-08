"""Balanced finesweep at n=8 draws/N, 4 visual conditions, scored on ALL 360
bindings (not just the 60 held-out). Mirror of plot_cavequest_balanced_n8.py."""
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
    for f in glob.glob(f"outputs/impala_cavequest_finesweep_N[0-9]*/{fn}"):
        d[int(re.search(r"finesweep_N(\d+)", f).group(1))].append(json.load(open(f))["heldout_win_rate"])
    N = np.array(sorted(d)); mean = np.array([np.mean(d[n]) for n in N])
    lo, hi = zip(*[ci(d[n]) for n in N]); return N, mean, np.array(lo), np.array(hi), [len(d[n]) for n in N]

conds = [("heldout_eval_all360.json", "normal", "#4C72B0"), ("heldout_eval_all360_recolor.json", "recolor", "#C44E52"),
         ("heldout_eval_all360_mono.json", "monochrome", "#8172B3"), ("heldout_eval_all360_swap.json", "sprite-swap", "#55A868")]
fig, ax = plt.subplots(figsize=(8.8, 6))
for fn, lab, col in conds:
    N, m, lo, hi, ns = curve(fn)
    if len(N) == 0: print(f"{lab}: NO DATA ({fn})"); continue
    ax.fill_between(N, lo, hi, color=col, alpha=0.15)
    ax.plot(N, m, "-o", lw=2.6, ms=7, color=col, label=f"{lab}")
    print(f"{lab:11}", {int(n): round(float(v), 3) for n, v in zip(N, m)}, "n=", ns[0])
ax.set_xlabel("N distinct training bindings", fontsize=20); ax.set_ylabel("Win-rate (all 360 bindings)", fontsize=20)
ax.set_xticks(N); ax.set_xticklabels(N, fontsize=15); ax.tick_params(axis='y', labelsize=15); ax.set_ylim(-0.03, 1.05)
ax.set_title("cavequest_easy BALANCED (n=8 draws/N): visual robustness\n(scored on ALL 360 bindings, bootstrap 95% CI)", fontsize=16)
ax.legend(loc="lower right", fontsize=14, framealpha=.95)
fig.tight_layout(); fig.savefig("outputs/figs/cavequest_balanced_n8_all360.png", dpi=160); print("saved")
