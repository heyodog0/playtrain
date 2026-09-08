"""No-holdout sweep: train on a RANDOM draw of N bindings from ALL 360 (no
id12=key holdout), test visual-transform robustness (recolor/mono/sprite-swap)
scored on all 360. X-axis = N training bindings on an evenly-spaced categorical
axis. N<360 = draws (split_seed-varied); N=360 = full pool (reuses the existing
rand_N360 runs, init-varied)."""
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
    # nohd_N### (N=1..256 draws) + rand_N360 (full pool, reused)
    pats = ["outputs/impala_cavequest_finesweep_nohd_N[0-9]*_s*/" + fn,
            "outputs/impala_cavequest_finesweep_rand_N360_s*/" + fn]
    for pat in pats:
        for f in glob.glob(pat):
            N = int(re.search(r"_N(\d+)_s", f).group(1))
            d[N].append(json.load(open(f))["heldout_win_rate"])
    N = sorted(d)
    return N, {n: (np.mean(d[n]),) + ci(d[n]) + (len(d[n]),) for n in N}

conds = [("heldout_eval_all360.json", "normal", "#4C72B0"), ("heldout_eval_all360_recolor.json", "recolor", "#C44E52"),
         ("heldout_eval_all360_mono.json", "monochrome", "#8172B3"), ("heldout_eval_all360_swap.json", "sprite-swap", "#55A868")]
curves, allN = {}, set()
for fn, lab, col in conds:
    N, data = curve(fn)
    if not N: print(f"{lab}: NO DATA ({fn})"); continue
    curves[lab] = (data, col); allN.update(N)
ORDER = sorted(allN); pos = {n: i for i, n in enumerate(ORDER)}
fig, ax = plt.subplots(figsize=(9.4, 6))
for lab, (data, col) in curves.items():
    x = [pos[n] for n in sorted(data)]
    m = [data[n][0] for n in sorted(data)]; lo = [data[n][1] for n in sorted(data)]; hi = [data[n][2] for n in sorted(data)]
    ax.fill_between(x, lo, hi, color=col, alpha=0.15)
    ax.plot(x, m, "-o", lw=2.6, ms=7, color=col, label=lab)
    print(f"{lab:11}", {n: round(data[n][0], 3) for n in sorted(data)}, "n=", [data[n][3] for n in sorted(data)])
ax.set_xticks(range(len(ORDER))); ax.set_xticklabels(ORDER, fontsize=14); ax.tick_params(axis='y', labelsize=15)
ax.set_xlim(-0.4, len(ORDER) - 0.6); ax.set_ylim(-0.03, 1.05)
ax.set_xlabel("N distinct training bindings (random draw from all 360)", fontsize=17)
ax.set_ylabel("Win-rate (all 360 bindings)", fontsize=18)
ax.set_title("cavequest_easy: visual-transform robustness vs N training bindings\n"
             "(no holdout — train on normal, test on recolor/mono/swap; deterministic env, bootstrap 95% CI)", fontsize=13)
ax.legend(loc="lower right", fontsize=14, framealpha=.95)
fig.tight_layout(); fig.savefig("outputs/figs/cavequest_nohd_n8_all360.png", dpi=160); print("saved")
