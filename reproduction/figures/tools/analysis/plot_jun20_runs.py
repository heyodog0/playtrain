"""Plot the Jun20 finished runs (asteroids procedural/memo, cavequest_hard
memo +values/noval) in the reference medium_seeds style: raw return shaded +
EMA-smoothed line per seed, dotted 30k win threshold. 2x2 grid, one group/panel.

    uv run python tools/analysis/plot_jun20_runs.py --root /tmp/allruns --out outputs/figs/jun20_runs.png
"""
import argparse, glob, os
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from tensorboard.backend.event_processing.event_accumulator import EventAccumulator

SEED_COLOR = {0: "#2ca08c", 1: "#e07b39", 2: "#7b6cd0"}
GROUPS = [
    ("asteroids_easy — procedural (10M)",        "impala_aste_easy_lstm_10M_seed{}",            10, None),
    ("asteroids_easy — memorize 1 instance (10M)","impala_aste_easy_memo_h4000_seed{}",          10, None),
    ("cavequest_hard memo +values (25M, sp=0)",  "impala_cavequest_hard_memo_h5000_seed{}",     25, (0, 5000)),
    ("cavequest_hard memo NO-VALUE (25M, sp=0)", "impala_cavequest_hard_noval_memo_h5000_seed{}",25, (0, 5000)),
]


def curve(d):
    ev = glob.glob(os.path.join(d, "**", "events.*"), recursive=True)
    if not ev: return None, None
    ea = EventAccumulator(sorted(ev)[-1], size_guidance={"scalars": 0}); ea.Reload()
    s = ea.Scalars("charts/ep_return_mean")
    return np.array([x.step for x in s], float), np.array([x.value for x in s], float)


def ema(v, a=0.03):
    o = np.empty_like(v); acc = v[0]
    for i, x in enumerate(v): acc = a*x + (1-a)*acc; o[i] = acc
    return o


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="/tmp/allruns")
    ap.add_argument("--out", default="outputs/figs/jun20_runs.png")
    args = ap.parse_args()
    fig, axes = plt.subplots(2, 2, figsize=(15, 9))
    for ax, (title, pat, xmax, ylim) in zip(axes.flat, GROUPS):
        for seed in (0, 1, 2):
            st, v = curve(os.path.join(args.root, pat.format(seed)))
            if st is None: continue
            x = st / 1e6; c = SEED_COLOR[seed]
            ax.plot(x, v, color=c, alpha=0.15, lw=0.6)
            ax.plot(x, ema(v), color=c, lw=2.2, label=f"seed {seed}")
        ax.axhline(30000, ls=":", c="gray", lw=1)
        ax.set_title(title, fontsize=11)
        ax.set_xlabel("env steps (M)"); ax.set_ylabel("episode return")
        ax.set_xlim(0, xmax); ax.grid(alpha=0.25); ax.legend(fontsize=8)
        if ylim:
            ax.set_ylim(*ylim)
            ax.text(0.97, 0.94, "y clipped to 5k (door/spike≈1000 each;\nrare win-spikes off-panel)",
                    transform=ax.transAxes, fontsize=7, ha="right", va="top", color="gray")
    fig.suptitle("analogen — IMPALA+LSTM — Jun20 runs (ep_return_mean)", fontsize=14)
    plt.tight_layout(rect=[0, 0, 1, 0.97])
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    plt.savefig(args.out, dpi=120); print("wrote", args.out)


if __name__ == "__main__":
    main()
