"""Balanced vs random training-binding draw, with a Wilson binomial 95% CI band
on the random series (analogen_cavequest_easy).

- random (balance=none): each draw scored pass/fail (win-rate > --threshold);
  plot p_hat = k/n = P(a random N-set generalizes) with a Wilson 95% band.
  Since per-draw outcomes are bimodal, p_hat tracks the mean win-rate closely
  but now carries a proper (n-shrinking, [0,1]-bounded) interval.
- balanced (key_visual): 1 run per N, so plotted as its raw held-out win-rate
  line with no band (no replicates to interval over).

Reads heldout_eval.json written by tools/eval_generalization.py.
"""
import argparse, glob, re, json
from collections import defaultdict
import numpy as np
import matplotlib.pyplot as plt

FULLSET = 300  # N == all training bindings -> random draw is deterministic

try:
    plt.style.use("seaborn-v0_8-darkgrid")
except OSError:
    plt.style.use("seaborn-darkgrid")


def wilson(k, n, z=1.96):
    if n == 0:
        return 0.0, 0.0
    p = k / n
    d = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / d
    half = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return max(0.0, centre - half), min(1.0, centre + half)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--threshold", type=float, default=0.5)
    args = ap.parse_args()

    # balanced: 1 run per N
    bal = {}
    for f in glob.glob("outputs/impala_cavequest_finesweep_N*/heldout_eval.json"):
        m = re.search(r"_finesweep_N(\d+)/", f)
        if m:
            bal[int(m.group(1))] = json.load(open(f))["heldout_win_rate"]
    bN = np.array(sorted(bal)); bv = np.array([bal[n] for n in bN])

    # random: multiple draws per N -> proportion + Wilson CI
    rnd = defaultdict(list)
    for f in glob.glob("outputs/impala_cavequest_finesweep_rand_N*_s*/heldout_eval.json"):
        N = int(re.search(r"_rand_N(\d+)_s", f).group(1))
        rnd[N].append(json.load(open(f))["heldout_win_rate"])
    rN = np.array(sorted(rnd))
    phat, lo, hi = [], [], []
    for N in rN:
        a = np.array(rnd[N]); k, n = int((a > args.threshold).sum()), len(a)
        p = k / n
        if N >= FULLSET:                 # deterministic: pinch band to the point
            l = h = p
        else:
            l, h = wilson(k, n)
        phat.append(p); lo.append(l); hi.append(h)
    phat, lo, hi = map(np.array, (phat, lo, hi))
    ndraws = max(len(v) for v in rnd.values() if len(v))

    LBL, TICK, LEG, TITLE = 20, 16, 14, 18
    fig, ax = plt.subplots(figsize=(8.5, 6))
    ax.fill_between(rN, lo, hi, color="#DD8452", alpha=0.20,
                    label=f"random: Wilson 95% CI (n≤{ndraws})")
    ax.plot(rN, phat, "--s", lw=2.6, ms=8, color="#DD8452",
            label="random (unbalanced): P(generalize)")
    ax.plot(bN, bv, "-o", lw=3, ms=8, color="#4C72B0",
            label="balanced (key_visual): win-rate, 1 run/N")

    ax.set_xscale("log")
    ticks = [1, 2, 4, 8, 16, 32, 64, 128, 300]
    ax.set_xticks(ticks); ax.set_xticklabels(ticks, fontsize=TICK)
    ax.tick_params(axis="y", labelsize=TICK)
    ax.set_xlabel("N distinct training bindings", fontsize=LBL)
    ax.set_ylabel("Held-out win-rate / P(generalize)", fontsize=LBL)
    ax.set_ylim(-0.03, 1.05)
    ax.set_title("Balanced vs random binding draw\n(analogen_cavequest_easy)",
                 fontsize=TITLE)
    ax.legend(loc="lower right", fontsize=LEG, framealpha=0.95,
              borderpad=0.8, handletextpad=0.6)
    fig.tight_layout()
    out = "outputs/figs/cavequest_generalization_balanced_vs_random_wilson.png"
    fig.savefig(out, dpi=160)
    print("saved", out)


if __name__ == "__main__":
    main()
