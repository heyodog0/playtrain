"""Plot the 30M cavequest_medium horizon sweep (max_decisions in
{512,1000,1500,2000,2500,3000} x 2 seeds), reference style: raw return shaded +
EMA-smoothed line per seed, dotted win threshold (30k), faceted one panel per
horizon. Also prints an escape-step table (first step return crosses 30k).

Reads TB event dirs pulled to a local --root (default /tmp/h30M).
    uv run python tools/analysis/plot_horizon30M.py --root /tmp/h30M --out outputs/figs/horizon30M.png
"""
import argparse
import glob
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from tensorboard.backend.event_processing.event_accumulator import EventAccumulator

HORIZONS = [512, 1000, 1500, 2000, 2500, 3000]
SEED_COLOR = {0: "#2ca08c", 1: "#e07b39"}  # teal / orange, like the ref
WIN_THRESH = 30000.0


def curve(run_dir):
    evs = glob.glob(os.path.join(run_dir, "**", "events.*"), recursive=True)
    if not evs:
        return None, None
    ea = EventAccumulator(sorted(evs)[-1], size_guidance={"scalars": 0})
    ea.Reload()
    s = ea.Scalars("charts/ep_return_mean")
    return np.array([x.step for x in s], float), np.array([x.value for x in s], float)


def ema(v, alpha=0.02):
    out = np.empty_like(v)
    acc = v[0]
    for i, x in enumerate(v):
        acc = alpha * x + (1 - alpha) * acc
        out[i] = acc
    return out


def escape_step(steps, vals, thresh=WIN_THRESH):
    sm = ema(vals)
    idx = np.where(sm > thresh)[0]
    return steps[idx[0]] if len(idx) else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="/tmp/h30M")
    ap.add_argument("--out", default="outputs/figs/horizon30M.png")
    args = ap.parse_args()

    fig, axes = plt.subplots(2, 3, figsize=(15, 8), sharex=True, sharey=True)
    table = []
    for ax, md in zip(axes.flat, HORIZONS):
        for seed in (0, 1):
            d = os.path.join(args.root, f"impala_acqm_h30M_md{md:04d}_seed{seed}")
            steps, vals = curve(d)
            if steps is None:
                continue
            x = steps / 1e6
            c = SEED_COLOR[seed]
            ax.plot(x, vals, color=c, alpha=0.18, lw=0.6)
            ax.plot(x, ema(vals), color=c, lw=2.2, label=f"seed {seed}")
            es = escape_step(steps, vals)
            table.append((md, seed, es, vals[-5:].mean()))
        ax.axhline(WIN_THRESH, ls=":", c="gray", lw=1)
        ax.set_title(f"max_decisions = {md}", fontsize=11)
        ax.grid(alpha=0.25)
        ax.legend(fontsize=8, loc="center right")
    for ax in axes[:, 0]:
        ax.set_ylabel("episode return")
    for ax in axes[1, :]:
        ax.set_xlabel("env steps (M)")
    fig.suptitle("analogen_cavequest_medium — IMPALA+LSTM — 30M — horizon sweep (N=1)",
                 fontsize=14)
    plt.tight_layout(rect=[0, 0, 1, 0.97])
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    plt.savefig(args.out, dpi=120)
    print("wrote", args.out)
    print("\n  md  seed  escape_step  final_return")
    for md, seed, es, fr in table:
        es_s = "NEVER" if es is None else f"{es/1e6:5.1f}M"
        print(f"  {md:4d}  {seed:4d}  {es_s:>10s}  {fr:11.0f}")


if __name__ == "__main__":
    main()
