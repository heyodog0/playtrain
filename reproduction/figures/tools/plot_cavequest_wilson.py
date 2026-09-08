"""Binding-generalization curve as a PROPORTION with a Wilson binomial 95% CI.

Each random draw is scored pass/fail ("did it generalize?" = held-out win-rate
> --threshold; safe because per-draw outcomes are bimodal). At each N we then
have k successes out of n draws, and plot p_hat = k/n = P(a random N-set
generalizes) with a Wilson score-interval error bar (tightens with n, stays in
[0,1] — unlike min-max).

N=FULLSET (all training bindings) is the deterministic full-set point: the draw
can't vary, so it's plotted as a single marker with no CI.

    uv run python tools/plot_cavequest_wilson.py [--threshold 0.5]
"""
import argparse, glob, re, json
from collections import defaultdict
import numpy as np
import matplotlib.pyplot as plt

FULLSET = 300  # N == all training bindings -> draw is deterministic

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
    ap.add_argument("--threshold", type=float, default=0.5,
                    help="held-out win-rate above which a draw counts as 'generalized'")
    args = ap.parse_args()

    vals = defaultdict(list)
    for f in glob.glob("outputs/impala_cavequest_finesweep_rand_N*_s*/heldout_eval.json"):
        N = int(re.search(r"_rand_N(\d+)_s", f).group(1))
        vals[N].append(json.load(open(f))["heldout_win_rate"])

    sweep_N, p, lo, hi = [], [], [], []
    det_N, det_p = [], []
    for N in sorted(vals):
        a = np.array(vals[N])
        k, n = int((a > args.threshold).sum()), len(a)
        if N >= FULLSET:                       # deterministic full-set point
            det_N.append(N); det_p.append(k / n)
            continue
        l, h = wilson(k, n)
        sweep_N.append(N); p.append(k / n); lo.append(l); hi.append(h)

    sweep_N = np.array(sweep_N); p = np.array(p)
    yerr = np.array([p - np.array(lo), np.array(hi) - p])

    LBL, TICK, LEG, TITLE = 20, 16, 15, 17
    fig, ax = plt.subplots(figsize=(8.5, 6))
    ax.errorbar(sweep_N, p, yerr=yerr, fmt="-o", lw=3, ms=8, capsize=5,
                color="#4C72B0", ecolor="#4C72B0", elinewidth=2,
                label="random draw (Wilson 95% CI)")
    if det_N:
        ax.plot(det_N, det_p, "*", ms=18, color="#C44E52",
                label=f"N={FULLSET}: full set (deterministic)")

    ax.set_xscale("log")
    ticks = [1, 2, 4, 8, 16, 32, 64, 128, 300]
    ax.set_xticks(ticks); ax.set_xticklabels(ticks, fontsize=TICK)
    ax.tick_params(axis="y", labelsize=TICK)
    ax.set_xlabel("N distinct training bindings", fontsize=LBL)
    ax.set_ylabel("P(random N-set generalizes)", fontsize=LBL)
    ax.set_ylim(-0.03, 1.05)
    nmax = max(len(v) for v in vals.values())
    ax.set_title("Binding generalization vs random-draw size\n"
                 f"(analogen_cavequest_easy, Wilson 95% CI, n≤{nmax} draws/N, "
                 f"pass>{args.threshold:g})", fontsize=TITLE)
    ax.legend(loc="lower right", fontsize=LEG, framealpha=0.95,
              borderpad=0.8, handletextpad=0.6)
    fig.tight_layout()
    out = "outputs/figs/cavequest_generalization_curve_wilson.png"
    fig.savefig(out, dpi=160)
    print("saved", out)


if __name__ == "__main__":
    main()
