"""Appendix B — held-out evaluation of the 24 suite agents (fig_eval_dumbbell.{png,pdf}).

Greedy final checkpoint vs a random policy on the same held-out level seeds, one
dumbbell per game, sorted by normalized margin. Games where greedy fails to beat
random are drawn in red.

Standalone by design: plot_figX.py draws the same panel, but as panel C of a
three-panel figure whose other panels read TB dirs under `outputs/` on the
cluster. This reads only the committed eval JSON, so Appendix B builds from this
repo alone -- same contract as tools/plot_suite_grid.py for Appendix A.

Default source is eval_iddp_suite.json, the evaluation of the *same* runs that
Appendix A plots (ImpalaCNN, DDP2, 150M). eval_final_agents_b256.json evaluates a
different family (NatureCNN, batch 256) and disagrees on which games fail, so the
two must not be mixed; pass --evals to switch deliberately.

Drawn at final print size -- include at width=\\linewidth with no scaling.

    python tools/plot_eval_dumbbell.py [--evals results/eval_iddp_suite.json] [--out .]
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D

IMP_C, RANDOM_C, FAIL_C = "#1f77b4", "#9aa3ad", "#c44e52"
FS_LAB, FS_TICK, FS_GAME, FS_DELTA = 8.0, 6.5, 6.5, 6.0
FIGSIZE = (6.5, 4.6)


def rows_from(evals: dict) -> list[tuple[float, str, float, float]]:
    """(normalized margin, game, random, greedy), ascending -- worst at the bottom."""
    out = []
    for game, d in evals.items():
        g, r = d["greedy_return"], d["random_return"]
        norm = (g - r) / (abs(g) + abs(r) + 1e-9) if (g or r) else 0.0
        out.append((norm, game, r, g))
    out.sort()
    return out


def latex_table(rows) -> str:
    """Two side-by-side blocks of 12 games, alphabetical, for the appendix table."""
    games = sorted(rows, key=lambda t: t[1])
    half = (len(games) + 1) // 2
    lines = []
    for left, right in zip(games[:half], games[half:]):
        cells = []
        for _, game, r, g in (left, right):
            cells += [game.replace("_", r"\_"), f"{r:.1f}", f"{g:.1f}"]
        lines.append(" & ".join(cells) + r" \\")
    return "\n".join(lines)


def draw_margin(rows):
    """Normalized margin per game on a linear -1..1 axis.

    (greedy - random) / (|greedy| + |random|), the quantity the rows are already
    sorted by. Magnitudes are comparable across games, which the dumbbell's symlog
    axis cannot claim, at the price of showing no actual return values -- read those
    off the table instead.
    """
    fig, ax = plt.subplots(figsize=FIGSIZE)
    for y, (norm, game, r, g) in enumerate(rows):
        ax.barh(y, norm, height=0.62, color=IMP_C if norm > 0 else FAIL_C,
                zorder=2, linewidth=0)
        # Label outside the bar on its own side, so short bars stay readable.
        ha, dx = ("left", 3) if norm >= 0 else ("right", -3)
        ax.annotate(f"{norm:+.2f}", xy=(norm, y), xytext=(dx, 0),
                    textcoords="offset points", fontsize=FS_DELTA,
                    color="#666666", va="center", ha=ha)
    ax.set_yticks(range(len(rows)))
    ax.set_yticklabels([g.replace("_", " ") for _, g, _, _ in rows], fontsize=FS_GAME)
    ax.set_ylim(-0.7, len(rows) - 0.3)
    ax.set_xlim(-1.15, 1.15)
    ax.set_xticks([-1.0, -0.5, 0.0, 0.5, 1.0])
    ax.set_xlabel("normalized margin, greedy vs. random on 8 held-out level seeds",
                  fontsize=FS_LAB)
    ax.tick_params(axis="x", labelsize=FS_TICK)
    ax.tick_params(axis="y", length=0)  # left spine is hidden; stray ticks read as dashes
    ax.grid(axis="x", alpha=0.22, lw=0.5)
    ax.spines[["top", "right", "left"]].set_visible(False)
    ax.axvline(0, color="#888888", lw=0.6, alpha=0.7, zorder=3)
    ax.legend(handles=[
        Line2D([], [], marker="s", ls="", color=IMP_C, markersize=4,
               label="greedy $>$ random"),
        Line2D([], [], marker="s", ls="", color=FAIL_C, markersize=4,
               label=r"greedy $\leq$ random"),
    ], loc="lower right", fontsize=FS_LAB - 1, frameon=False,
        handletextpad=0.3, borderaxespad=0.3, labelspacing=0.25)
    fig.tight_layout()
    return fig


def draw_dumbbell(rows):
    """Both absolute returns per game, on a shared symlog axis."""
    fig, ax = plt.subplots(figsize=FIGSIZE)
    for y, (norm, game, r, g) in enumerate(rows):
        beats = g > r
        ax.plot([r, g], [y, y], lw=0.9, color="#cccccc", zorder=1)
        ax.scatter([r], [y], s=9, color=RANDOM_C, zorder=2)
        ax.scatter([g], [y], s=11, color=IMP_C if beats else FAIL_C, zorder=3)
        d = g - r
        label = "0" if d == 0 else f"{d:+,.0f}" if abs(d) >= 10 else f"{d:+.1f}"
        ax.annotate(label, xy=(1.0, y), xycoords=("axes fraction", "data"),
                    xytext=(3, 0), textcoords="offset points", fontsize=FS_DELTA,
                    color="#666666", va="center", ha="left")
    ax.set_yticks(range(len(rows)))
    ax.set_yticklabels([g.replace("_", " ") for _, g, _, _ in rows], fontsize=FS_GAME)
    ax.set_ylim(-0.8, len(rows) - 0.2)
    # symlog: the suite spans pong's -36 to seaquest's 733, and a linear axis would
    # collapse every ProcGen game (returns of order 1) onto the zero line.
    ax.set_xscale("symlog", linthresh=2)
    ax.set_xlabel("mean return over 8 held-out level seeds (symlog)", fontsize=FS_LAB)
    ax.tick_params(axis="x", labelsize=FS_TICK)
    ax.grid(axis="x", alpha=0.22, lw=0.5)
    ax.spines[["top", "right"]].set_visible(False)
    ax.axvline(0, color="#888888", lw=0.6, alpha=0.5)
    ax.legend(handles=[
        Line2D([], [], marker="o", ls="", color=RANDOM_C, markersize=3.5, label="random"),
        Line2D([], [], marker="o", ls="", color=IMP_C, markersize=4, label="greedy (final checkpoint)"),
        Line2D([], [], marker="o", ls="", color=FAIL_C, markersize=4, label=r"greedy $\leq$ random"),
    ], loc="lower right", fontsize=FS_LAB - 1, frameon=False,
        handletextpad=0.3, borderaxespad=0.3, labelspacing=0.25)

    fig.tight_layout(rect=(0, 0, 0.955, 1.0))  # room for the delta labels
    return fig


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--evals", default="results/eval_iddp_suite.json", type=Path)
    ap.add_argument("--out", default=".", type=Path)
    ap.add_argument("--style", choices=("dumbbell", "margin"), default="dumbbell",
                    help="dumbbell: both returns per game, symlog. "
                         "margin: normalized margin per game, linear.")
    args = ap.parse_args()

    rows = rows_from(json.load(open(args.evals)))
    fig = draw_margin(rows) if args.style == "margin" else draw_dumbbell(rows)

    stem = "fig_eval_margin" if args.style == "margin" else "fig_eval_dumbbell"
    args.out.mkdir(parents=True, exist_ok=True)
    for ext in ("png", "pdf"):
        # No bbox_inches="tight", so the saved width stays exactly the column width
        # and the type sizes above are the sizes that print.
        fig.savefig(args.out / f"{stem}.{ext}", dpi=200, facecolor="white")

    beat = sum(1 for _, _, r, g in rows if g > r)
    fails = sorted(game for _, game, r, g in rows if g <= r)
    print(f"wrote {args.out}/{stem}.png/.pdf")
    print(f"{beat}/{len(rows)} beat random; fails: {', '.join(fails)}")
    print("\n% table body (game & random & greedy, two blocks of 12):")
    print(latex_table(rows))
    print("\n% table body (game & random & greedy, two blocks of 12):")
    print(latex_table(rows))


if __name__ == "__main__":
    main()
