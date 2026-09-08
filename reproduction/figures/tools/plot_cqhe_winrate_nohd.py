"""cavequest_hard_explore no-holdout sweep: WIN RATE (%) vs N training bindings
(sampled eval on all 360 bindings), error bars across the seeds.
Each run's heldout_win_rate is the fraction of 360 bindings solved; the point is
the mean over seeds at that N, error bar = std across seeds. Companion to
plot_cqhe_return_nohd.py (same data, win-rate metric instead of return)."""
import glob, re, json
from collections import defaultdict
import numpy as np, matplotlib.pyplot as plt
try: plt.style.use("seaborn-v0_8-darkgrid")
except OSError: plt.style.use("seaborn-darkgrid")

conds = [("heldout_eval_all360.json", "normal", "#4C72B0"),
         ("heldout_eval_all360_recolor.json", "recolor", "#C44E52"),
         ("heldout_eval_all360_mono.json", "monochrome", "#8172B3"),
         ("heldout_eval_all360_swap.json", "sprite-swap", "#55A868")]

def curve(fn):
    d = defaultdict(list)
    for f in glob.glob(f"outputs/impala_cqhe_nohd_N*_s*/{fn}"):
        N = int(re.search(r"_N(\d+)_s", f).group(1))
        d[N].append(json.load(open(f))["heldout_win_rate"] * 100.0)
    return d

allN = set()
data = {}
for fn, lab, col in conds:
    d = curve(fn)
    if d: data[lab] = (d, col); allN.update(d)
ORDER = sorted(allN); pos = {n: i for i, n in enumerate(ORDER)}
fig, ax = plt.subplots(figsize=(9.4, 6))
for lab, (d, col) in data.items():
    x = [pos[n] for n in sorted(d)]
    m = np.array([np.mean(d[n]) for n in sorted(d)])
    sd = np.array([np.std(d[n]) for n in sorted(d)])
    ns = [len(d[n]) for n in sorted(d)]
    ax.errorbar(x, m, yerr=sd, fmt="-o", lw=2.4, ms=7, color=col, capsize=4, label=lab)
    print(f"{lab:11}", {n: (round(float(np.mean(d[n])), 1), f"±{round(float(np.std(d[n])), 1)}") for n in sorted(d)}, "n=", ns)
ax.set_xticks(range(len(ORDER))); ax.set_xticklabels(ORDER, fontsize=14); ax.tick_params(axis='y', labelsize=13)
ax.set_xlim(-0.4, len(ORDER) - 0.6); ax.set_ylim(0, None)
ax.set_xlabel("N distinct training bindings (random draw from all 360)", fontsize=16)
ax.set_ylabel("Win rate (% of 360 bindings solved)", fontsize=15)
ax.set_title("cavequest_hard_explore: held-out WIN RATE vs N training bindings\n"
             "(no holdout, SAMPLED eval on all 360; win = +55k reached; error bars = std across seeds)", fontsize=13)
ax.legend(loc="upper left", fontsize=13, framealpha=.95)
fig.tight_layout(); fig.savefig("outputs/figs/cqhe_winrate_nohd.png", dpi=160); print("saved")
