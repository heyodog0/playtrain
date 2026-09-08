"""Appendix — learning curves for all 24 replica games, 3 seeds, three arms:
IMPALA x {IMPALA-CNN, Nature-CNN} plus PPO + Nature-CNN.

Successor to plot_suite_grid.py, which drew the single-seed 150M DDP2 run. This
reads the 100M suite (24 games x {Nature-CNN, IMPALA-CNN} x 3 seeds) from the
JSON dumped on the cluster, so it needs no TB tree here.

Bands are min/max over the three seeds, matching the main figure's convention;
the line is the seed mean. Type sizes and panel geometry are inherited from
plot_suite_grid.py verbatim, so this drops into the same \\linewidth slot.

    python tools/plot_suite_grid3.py --data _suite3_curves.json --out .
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import matplotlib.pyplot as plt
from matplotlib.ticker import MaxNLocator
import numpy as np

C_ICNN, C_NAT, C_PPO, C_PPOI, MUTE = "#1f77b4", "#e8913f", "#3aa17e", "#b07cc6", "#5f5f5f"
FS_TITLE, FS_LAB, FS_TICK = 7.0, 8.0, 5.5

GAMES_ALL = ["asteroids", "bigfish", "bossfight", "breakout", "caveflyer",
             "chaser", "climber", "coinrun", "dodgeball", "freeway",
             "frostbite", "fruitbot", "heist", "jumper", "leaper", "maze",
             "miner", "ninja", "plunder", "pong", "qbert", "seaquest",
             "space_invaders", "starpilot"]
NCOL, NROW = 6, 4
FIGSIZE = (6.5, 4.6)
XMAX = 100

# Note: maze, heist and freeway have no failure state, so nothing completes
# until every env has run the 2,000-frame horizon (6,144 * 2,000 = 12.3M env
# steps). Their means before that point average over wins alone. Drawn as-is
# by request; the caption carries the caveat.


def ema(y, span_frac=0.02):
    """plot_suite_grid.ema, verbatim."""
    alpha = min(0.3, 1.0 / max(1.0, span_frac * len(y)))
    out = np.empty_like(y)
    m = c = 0.0
    for i, val in enumerate(y):
        m = alpha * val + (1 - alpha) * m
        c = alpha + (1 - alpha) * c
        out[i] = m / c
    return out


def style_axis(ax, fs_tick=FS_TICK):
    ax.tick_params(labelsize=fs_tick)
    ax.grid(alpha=0.22, lw=0.5)
    ax.spines[["top", "right"]].set_visible(False)


def seed_band(seeds: dict, grid: np.ndarray, cut: float = 0.0):
    """Resample every seed onto a shared grid, then EMA each before aggregating.

    Smoothing before the min/max keeps the band from being driven by single-point
    spikes in one seed, which at 240 logged points is most of the raw spread.

    `cut` drops censored samples BEFORE the EMA. Masking afterwards would let the
    smoother carry the censored plateau across the boundary, so the curve would
    enter at the plateau value and decay toward the truth over the EMA's span.
    """
    curves = []
    for s in sorted(seeds):
        x = np.asarray(seeds[s]["x"], float) / 1e6
        y = np.asarray(seeds[s]["y"], float)
        if cut:
            keep = x >= cut
            x, y = x[keep], y[keep]
        if len(x) < 5:
            continue
        curves.append(np.interp(grid, x, ema(y), left=np.nan, right=np.nan))
    if not curves:
        return None
    a = np.vstack(curves)
    return np.nanmean(a, 0), np.nanmin(a, 0), np.nanmax(a, 0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="_suite4_curves.json", type=Path)
    ap.add_argument("--arms", default="all",
                    choices=["all", "trainers", "encoders", "impala", "ppo"],
                    help="all: 4 arms; trainers: ICNN both trainers; "
                         "encoders: IMPALA and PPO each at both encoders")
    ap.add_argument("--name", default="fig_suite_grid")
    ap.add_argument("--out", default=".", type=Path)
    args = ap.parse_args()

    rec = json.load(open(args.data))
    missing = [g for g in GAMES_ALL if g not in rec]
    if missing:
        raise SystemExit(f"no run found for: {', '.join(missing)}")

    grid = np.linspace(0, XMAX, 400)
    fig, axes = plt.subplots(NROW, NCOL, figsize=FIGSIZE)
    for i, game in enumerate(GAMES_ALL):
        ax = axes[i // NCOL][i % NCOL]
        flat = []
        # PPO cut=0.5M: before the first truncation wave (192 envs x 2,000
        # frames = 0.38M steps) only wins have completed, so every window is
        # wins-only regardless of size. Dropping the censored head is the fix;
        # no window length can include episodes that have not ended. IMPALA's
        # wave sits at 12.3M but its first log lands at 1.6M with returns
        # accumulating from step one, so its head is not pinned the same way.
        ALL = [("impala", C_ICNN, 0.0, "IMPALA + IMPALA-CNN"),
               ("nature", C_NAT, 0.0, "IMPALA + Nature-CNN"),
               ("ppo_impala", C_PPOI, 0.5, "PPO + IMPALA-CNN"),
               ("ppo_nature", C_PPO, 0.5, "PPO + Nature-CNN")]
        PICK = {"all": [0, 1, 2, 3], "trainers": [0, 2],
                "impala": [0, 1], "ppo": [2, 3],
                "encoders": [0, 1, 2, 3]}[args.arms]
        chosen = [ALL[i] for i in PICK]
        series = [(rec[game].get(k, {}), c, cut) for k, c, cut, _ in chosen]
        for seeds, colour, cut in series:
            got = seed_band(seeds, grid, cut=cut)
            if got is None:
                continue
            mean, lo, hi = got
            ax.fill_between(grid, lo, hi, color=colour, alpha=0.20, lw=0)
            ax.plot(grid, mean, lw=0.9, color=colour)
            flat.append(np.nanmax(hi) - np.nanmin(lo))
        ax.set_xlim(0, XMAX)
        ax.set_xticks([0, 50, 100])
        ax.yaxis.set_major_locator(MaxNLocator(nbins=3))
        if flat and max(flat) < 1e-9:
            ax.set_ylim(-0.05, 1.0)
            ax.text(0.5, 0.55, "no learning signal", ha="center", va="center",
                    transform=ax.transAxes, color=MUTE, fontsize=5.5,
                    style="italic")
        ax.set_title(game.replace("_", " "), fontsize=FS_TITLE, pad=2)
        ax.set_box_aspect(1.0)
        style_axis(ax)

    h = [plt.Line2D([], [], color=c, lw=1.4) for _, c, _, _ in chosen]
    fig.legend(h, [lab for _, _, _, lab in chosen], loc="upper center",
               bbox_to_anchor=(0.53, 1.0), ncol=len(chosen), frameon=False,
               fontsize=FS_LAB, handlelength=1.6, columnspacing=1.2)

    fig.tight_layout(h_pad=0.6, w_pad=0.4, rect=(0.030, 0.045, 1.0, 0.965))
    fig.text(0.53, 0.018, "env steps (M)", fontsize=FS_LAB, ha="center")
    fig.text(0.008, 0.5, "episode return", fontsize=FS_LAB, va="center",
             rotation="vertical")
    args.out.mkdir(parents=True, exist_ok=True)
    for ext in ("png", "pdf"):
        fig.savefig(args.out / f"{args.name}.{ext}", dpi=200, facecolor="white")
    print(f"wrote {args.out}/{args.name}.png/.pdf  "
          f"({len(GAMES_ALL)} games, 4 arms, band = min/max over 3 seeds)")


if __name__ == "__main__":
    main()
