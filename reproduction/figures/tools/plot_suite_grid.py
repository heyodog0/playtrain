"""Appendix A — learning curves for all 24 replica games (fig_suite_grid.{png,pdf}).

The full-suite companion to the main learning figure's eight-panel block: every
game in the ProcGen-16 + Atari-8 replica suite, from the DDP2 full-node runs
(ImpalaCNN + V-trace, batch 256, 150M steps, one seed per game).

Loader and smoothing are shared with plot_main_composite.py on purpose, so a curve
here is the same curve as in the main figure, drawn smaller.

Styling follows the main figure's curve block: square panels, one shared label per
axis, EMA only. `--random-rule` adds the random policy's held-out return as a dashed
rule per panel; it is off by default because random-vs-greedy is Appendix B's figure.

Single seed per game, so there are no bands here — the main figure's shaded regions
are min/max over three seeds, which the DDP2 suite runs do not have.

    python tools/plot_suite_grid.py [--data results/suite_tb] [--out .] [--random-rule]
"""
from __future__ import annotations

import argparse
import glob
import json
from pathlib import Path

import matplotlib.pyplot as plt
from matplotlib.ticker import MaxNLocator
import numpy as np
from tensorboard.backend.event_processing.event_accumulator import EventAccumulator

IMP_C = "#1f77b4"
MUTE = "#5f5f5f"
# Axis treatment follows plot_main_composite.py's panel C, but the type is sized
# for THIS figure's print scale, not copied from it. The composite is drawn 15in
# wide and shrunk to a 6.5in column, so its 12.5pt titles land at ~5pt; drawing
# this grid at final size instead means the numbers here are the points the reader
# actually sees. Include at width=\linewidth with no scaling or they are wrong.
FS_TITLE, FS_LAB, FS_TICK = 7.0, 8.0, 5.5

GAMES_ALL = ["asteroids", "bigfish", "bossfight", "breakout", "caveflyer",
             "chaser", "climber", "coinrun", "dodgeball", "freeway",
             "frostbite", "fruitbot", "heist", "jumper", "leaper", "maze",
             "miner", "ninja", "plunder", "pong", "qbert", "seaquest",
             "space_invaders", "starpilot"]

# 6x4 landscape at ICLR's 6.5in column width: ~1in square panels in half a page,
# the composite's shape for 24 items. Drawn at final size so the small type above
# is legible; a 4x6 portrait version fills a whole page if more room is wanted.
NCOL, NROW = 6, 4
FIGSIZE = (6.5, 4.6)


def load_tb(tb_dir, min_step=1e6):
    """Same reader as plot_main_composite.load_tb."""
    try:
        acc = EventAccumulator(str(tb_dir), size_guidance={"scalars": 0})
        acc.Reload()
        tag = [t for t in acc.Tags()["scalars"] if "return" in t.lower()][0]
        evs = [e for e in acc.Scalars(tag) if e.step >= min_step]
        if len(evs) < 5:
            return None
        return (np.array([e.step for e in evs], float),
                np.array([e.value for e in evs], float))
    except Exception:
        return None


def ema(y, span_frac=0.02):
    """Same smoothing as plot_main_composite.ema."""
    alpha = min(0.3, 1.0 / max(1.0, span_frac * len(y)))
    out = np.empty_like(y)
    m = c = 0.0
    for i, val in enumerate(y):
        m = alpha * val + (1 - alpha) * m
        c = alpha + (1 - alpha) * c
        out[i] = m / c
    return out


def style_axis(ax, fs_tick=FS_TICK):
    """plot_main_composite.style_axis, verbatim."""
    ax.tick_params(labelsize=fs_tick)
    ax.grid(alpha=0.22, lw=0.5)
    ax.spines[["top", "right"]].set_visible(False)


def index_runs(data_dir: Path) -> dict[str, Path]:
    """game -> run dir, read from each run's own config.json (not from the path)."""
    runs = {}
    for cfg_path in sorted(glob.glob(str(data_dir / "*" / "config.json"))):
        cfg = json.load(open(cfg_path))
        runs.setdefault(cfg["game"], Path(cfg_path).parent)
    return runs


def random_returns(results_dir: Path) -> dict[str, float]:
    f = results_dir / "eval_iddp_suite.json"
    if not f.exists():
        return {}
    return {g: info["random_return"] for g, info in json.load(open(f)).items()
            if "random_return" in info}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="results/suite_tb", type=Path)
    ap.add_argument("--out", default=".", type=Path)
    ap.add_argument("--random-rule", action="store_true",
                    help="draw the random policy's held-out return as a dashed "
                         "rule per panel (off by default: random vs greedy is "
                         "Appendix B's figure)")
    args = ap.parse_args()

    runs = index_runs(args.data)
    rand = random_returns(args.data.parent)
    missing = [g for g in GAMES_ALL if g not in runs]
    if missing:
        raise SystemExit(f"no run found for: {', '.join(missing)}")

    fig, axes = plt.subplots(NROW, NCOL, figsize=FIGSIZE)
    for i, game in enumerate(GAMES_ALL):
        ax = axes[i // NCOL][i % NCOL]
        curve = load_tb(runs[game] / "tb")
        if curve is None:
            ax.text(0.5, 0.5, "no data", ha="center", va="center",
                    transform=ax.transAxes, color=MUTE, fontsize=7.5)
        else:
            x, y = curve
            xm = x / 1e6
            ax.plot(xm, ema(y), lw=0.9, color=IMP_C)
            if args.random_rule and game in rand:
                ax.axhline(rand[game], color=MUTE, lw=0.8, ls=(0, (4, 3)),
                           zorder=1, alpha=0.8)
            ax.set_xlim(0, 150)
            ax.set_xticks([0, 75, 150])
            # 1.5in panels cannot carry matplotlib's default tick count.
            ax.yaxis.set_major_locator(MaxNLocator(nbins=3))
            # A curve that never leaves zero would auto-scale to a meaningless
            # +/-0.04 window and read as a broken axis; say what it is instead.
            if np.ptp(y) < 1e-9:
                ax.set_ylim(-0.05, 1.0)
                ax.text(0.5, 0.55, "no learning signal", ha="center", va="center",
                        transform=ax.transAxes, color=MUTE, fontsize=5.5,
                        style="italic")

        ax.set_title(game.replace("_", " "), fontsize=FS_TITLE, pad=2)
        ax.set_box_aspect(1.0)
        style_axis(ax)

    # One shared label per axis, as in the composite, instead of repeating them.
    fig.tight_layout(h_pad=0.6, w_pad=0.4, rect=(0.030, 0.035, 1.0, 1.0))
    fig.text(0.53, 0.008, "env steps (M)", fontsize=FS_LAB, ha="center")
    fig.text(0.008, 0.5, "episode return", fontsize=FS_LAB, va="center",
             rotation="vertical")
    args.out.mkdir(parents=True, exist_ok=True)
    for ext in ("png", "pdf"):
        # No bbox_inches="tight": it would crop to some width other than 6.5in,
        # LaTeX would scale back up to \linewidth, and the type sizes above would
        # no longer be the sizes that print.
        fig.savefig(args.out / f"fig_suite_grid.{ext}", dpi=200,
                    facecolor="white")
    print(f"wrote {args.out}/fig_suite_grid.png/.pdf  "
          f"({len(GAMES_ALL)} games, dashed rule = random policy where recorded)")


if __name__ == "__main__":
    main()
