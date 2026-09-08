"""Plot ep_return_mean training curves: medium 2000-decision (25M) seeds vs the
10M horizon sweep (128/256/512 x 3 seeds). Reads each run's TB scalars.

Run from repo root on the cluster (where the run dirs live):
    uv run python tools/analysis/plot_medium_curves.py --out outputs/figs/medium_curves.png
"""
import argparse
import glob
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from tensorboard.backend.event_processing.event_accumulator import EventAccumulator


def curve(run_dir):
    evs = glob.glob(os.path.join(run_dir, "tb", "**", "events.*"), recursive=True)
    if not evs:
        return None, None
    ea = EventAccumulator(sorted(evs)[-1], size_guidance={"scalars": 0})
    ea.Reload()
    tag = next((t for t in ea.Tags()["scalars"]
                if "return" in t.lower() and "mean" in t.lower() and "eval" not in t.lower()), None)
    if not tag:
        return None, None
    xs = ea.Scalars(tag)
    return [s.step for s in xs], [s.value for s in xs]


MEDIUM = [("seed0 (23525671)", "outputs/impala_23525671"),
          ("seed1 (23525682)", "outputs/impala_23525682"),
          ("seed2 (23525683)", "outputs/impala_23525683")]
SWEEP = {128: ["23534183", "23534189", "23534192"],
         256: ["23534196", "23534197", "23534199"],
         512: ["23534201", "23534202", "23534203"]}
COLORS = {128: "tab:blue", 256: "tab:orange", 512: "tab:green"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="outputs/figs/medium_curves.png")
    args = ap.parse_args()

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(15, 6))
    for lab, d in MEDIUM:
        st, v = curve(d)
        if st:
            ax1.plot(st, v, label=lab, alpha=0.85)
    ax1.set_title("medium — 2000-decision horizon — 25M")
    ax1.axhline(2000, ls=":", c="gray", lw=1, label="door-farm plateau")
    ax1.set_xlabel("env steps"); ax1.set_ylabel("ep_return_mean")
    ax1.legend(fontsize=8); ax1.grid(alpha=0.3)

    for md, jids in SWEEP.items():
        for i, jid in enumerate(jids):
            st, v = curve(f"outputs/impala_{jid}")
            if st:
                ax2.plot(st, v, color=COLORS[md], alpha=0.6,
                         label=f"md{md}" if i == 0 else None)
    ax2.set_title("horizon sweep — 10M (128/256/512 x 3 seeds)")
    ax2.axhline(2000, ls=":", c="gray", lw=1)
    ax2.set_xlabel("env steps")
    ax2.legend(fontsize=8); ax2.grid(alpha=0.3)

    plt.tight_layout()
    plt.savefig(args.out, dpi=120)
    print("wrote", args.out)


if __name__ == "__main__":
    main()
