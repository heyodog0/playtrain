"""The efficiency figure: thread scaling as the hero, the bar panels around it.

  (a) thread scaling, all four arms, env-only (bench_vec_scaling_ab.sbatch runs
      both arms with --no-model: no learner, no inference)
  (b) the backend ladder, Playwright -> Node.js/V8 -> QuickJS, split by suite
  (c) per-core throughput vs the original ProcGen C++, 16 shared games
  (d) per-core throughput vs real ALE, its 8 games

Laid out 2x2, A | B over C | D, both rows on the same 17 / 9 split.

(b)-(d) are drawn by `throughput_panels.py`, the SAME module panel D of the main
composite uses -- not a reimplementation. That module derives its bars from the
committed per-trial data in `results/env_throughput/` and hard-fails if they
disagree with the figure as published, so the strip here is the published strip.
Its house style carries over to (a): no top/right/left spines, a muted bottom
rule, horizontal grid only, "environment SPS" on y, error bars at +/-1 SE.

Both rows use C's and D's bar counts (17 / 9) as width ratios, so bar width
comes out uniform across the two per-game panels.

Drawn at 11in wide with fs=1.0 and included at \\linewidth, i.e. halved on the
page, which is how fig_main_D is sized too.

usage:
  python tools/plot_env_efficiency.py --ab-results ../playtrain-trainers/results \\
      --pg-job 38145651 --ale-job 39032276 --out ../ICLR-.../figures
"""
from __future__ import annotations

import argparse
import glob
import json
import math
import os
import sys
from collections import defaultdict

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as mtick
import numpy as np
from matplotlib.gridspec import GridSpec

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from throughput_panels import (C_ALE, C_PLAY, C_PROCGEN, GRID, INK, LADDER,
                               MUTE, geo, load, throughput_panel)

PROCGEN16 = ("bigfish bossfight caveflyer chaser climber coinrun dodgeball "
             "fruitbot heist jumper leaper maze miner ninja plunder starpilot").split()
ALE8 = "asteroids breakout freeway frostbite pong qbert seaquest space_invaders".split()

# Hue keeps its panel-D meaning: blue is PlayTrain, orange the ProcGen baseline,
# red the ALE baseline. The two PlayTrain suites separate by shade within that
# blue, so no fifth colour enters the figure. C_PLAY is also what C and D use
# for their PlayTrain bars, so B's ProcGen group reads straight across to C;
# the ALE shade is darker than the ladder's old #2d5c8f, which was too close to
# tell apart in B's bars, without going to near-black.
C_PLAY_PG = C_PLAY
C_PLAY_ALE = "#1f4e79"


def geo_se(vals):
    """(geometric mean, multiplicative standard error) -- ladder_panel's."""
    lg = [math.log(v) for v in vals]
    mu = sum(lg) / len(lg)
    sd = (sum((z - mu) ** 2 for z in lg) / (len(lg) - 1)) ** 0.5
    return math.exp(mu), math.exp(sd / len(lg) ** 0.5)


def load_scaling(results_dir, job, expect):
    """(threads, PlayTrain geomean, baseline geomean) for one A/B suite."""
    def arm(prefix):
        per = defaultdict(dict)
        for f in sorted(glob.glob(os.path.join(results_dir,
                                               f"ab_{prefix}_*_{job}.json"))):
            game = os.path.basename(f)[len(f"ab_{prefix}_"):-len(f"_{job}.json")]
            for r in json.load(open(f)):
                per[r["workers"] * 5][game] = r["decisions_per_s"]
        return per
    pt, ep = arm("pt"), arm("ep")
    if not pt or not ep:
        raise SystemExit(f"missing arm for job {job}: pt={len(pt)} ep={len(ep)}")
    ts = sorted(set(pt) & set(ep))
    # A missing game silently rebases a geomean, so check the roster.
    missing = sorted(set(expect) - set(pt[ts[0]]))
    extra = sorted(set(pt[ts[0]]) - set(expect))
    if missing or extra:
        raise SystemExit(f"job {job} roster: missing={missing} unexpected={extra}")
    return ts, [geo(list(pt[t].values())) for t in ts], \
        [geo(list(ep[t].values())) for t in ts]


# seaborn "darkgrid": tinted axes face, white gridlines, no spines. Applied
# AFTER the panel functions, which set their own white-background styling.
FACE, GRIDW = "#eaeaf2", "#ffffff"


def darkgrid(ax, xgrid=True):
    ax.set_facecolor(FACE)
    for sp in ax.spines.values():
        sp.set_visible(False)
    ax.grid(False)
    ax.set_axisbelow(True)
    ax.yaxis.grid(True, color=GRIDW, lw=1.1)
    # categorical bars: a vertical rule between every game reads as clutter.
    # grid(False) must be called with NO style kwargs -- matplotlib forces
    # visible=True whenever any kwarg is passed, so grid(False, color=...)
    # silently turns the gridlines ON.
    if xgrid:
        ax.xaxis.grid(True, color=GRIDW, lw=1.1)
    else:
        ax.xaxis.grid(False)


def scaling_panel(ax, t, pg_pt, pg_epb, pg_eps, al_pt, al_epb, al_eps, fs=1.0):
    """Panel (a), two-EnvPool-arm design (HANDOFF-2026-09-01 §4): per suite,
    EnvPool appears as-shipped (sync1; dashed, open markers) AND documented-best
    (async + NUMA shards + thread_affinity_offset, bs-tuned; solid squares)."""
    for y, c, m, ls, lab, mfc in (
            (al_pt, C_PLAY_ALE, "o", "-", "PlayTrain, 8 ALE", None),
            (pg_pt, C_PLAY_PG, "o", "-", "PlayTrain, 16 ProcGen", None),
            (pg_epb, C_PROCGEN, "s", "-", "ProcGen (EnvPool, documented best)", None),
            (pg_eps, C_PROCGEN, "^", "--", "ProcGen (EnvPool, as shipped)", "white"),
            (al_epb, C_ALE, "s", "-", "ALE (EnvPool, documented best)", None),
            (al_eps, C_ALE, "^", "--", "ALE (EnvPool, as shipped)", "white")):
        ax.plot(t, y, lw=2.0 * fs, color=c, marker=m, ms=7.5 * fs, ls=ls,
                label=lab, zorder=3, mfc=mfc or c)
    ax.set_xlabel("threads", fontsize=17 * fs)
    ax.set_ylabel("environment SPS", fontsize=17 * fs)
    # start at the first measured point: nothing was run below 5 threads, so
    # the stretch from 0 up to it was empty axis. Ticks are the sampled counts.
    span = max(t) - min(t)
    ax.set_xlim(min(t) - span * 0.03, max(t) + span * 0.03)
    ax.set_xticks(t)
    # 1.12 puts the 80-thread marker on the axis top edge; the extra headroom
    # keeps it clear of it
    ax.set_ylim(0, max(al_pt) * 1.20)
    # "0M" at the origin reads as a rounded quantity rather than as zero
    ax.yaxis.set_major_formatter(mtick.FuncFormatter(
        lambda v, _: "0" if v == 0 else f"{v/1e6:.0f}M"))
    for s in ("top", "right", "left"):
        ax.spines[s].set_visible(False)
    ax.spines["bottom"].set_color(MUTE)
    ax.tick_params(axis="y", labelsize=15 * fs, length=0, colors=INK, pad=6)
    ax.tick_params(axis="x", labelsize=15 * fs, length=0, colors=INK, pad=8)
    ax.set_axisbelow(True)
    ax.yaxis.grid(True, color=GRID, lw=1)
    ax.legend(loc="upper left", frameon=False, fontsize=10.5 * fs, handlelength=1.7,
              borderaxespad=0.2, labelspacing=0.28)


def ladder_suite_panel(ax, lad, fs=1.0):
    """Panel (b): the backend ladder, each stage split by suite.

    ladder_panel in throughput_panels draws one bar per stage over all 24
    games. Splitting each stage into its 16 ProcGen and 8 ALE replicas costs
    nothing in data and shows where the stages differ: the two suites are
    within 12% of each other under a browser and under Node, and only diverge
    once the native rasterizer is under them.

    Suite hues are panel A's, so mid-blue is the 16 ProcGen replicas and dark
    blue the 8 ALE ones in both panels.
    """
    stages = (("playwright", "Playwright"), ("v8", "Node.js / V8"),
              ("quickjs", "QuickJS\n(PlayTrain)"))
    suites = ((PROCGEN16, "PlayTrain, 16 ProcGen", C_PLAY_PG),
              (ALE8, "PlayTrain, 8 ALE", C_PLAY_ALE))
    x = np.arange(len(stages))
    w = 0.34
    top = []
    for i, (roster, label, colour) in enumerate(suites):
        vals, lo, hi = [], [], []
        for key, _ in stages:
            gm, err = geo_se([lad[key][g] for g in roster])
            vals.append(gm); top.append(gm * err)
            lo.append(gm - gm / err)
            hi.append(gm * err - gm)
        off = (i - 0.5) * (w + 0.02)
        bars = ax.bar(x + off, vals, w, yerr=[lo, hi], label=label,
                      color=colour, zorder=3, ecolor=MUTE, capsize=3.5 * fs,
                      error_kw={"lw": 1.1 * fs, "zorder": 4})
        # Playwright's bars are ~1% of full scale and read as hairlines, so
        # every bar carries its value; anchored above the cap, not the bar
        for bar, v, up in zip(bars, vals, hi):
            ax.annotate(f"{v:,.0f}", (bar.get_x() + bar.get_width() / 2, v + up),
                        xytext=(0, 5), textcoords="offset points", ha="center",
                        fontsize=10.5, color=INK)
    ax.set_xticks(x)
    ax.set_xticklabels([lab for _, lab in stages], fontsize=13.5)
    # the ALE arm's cap reaches 63k and its value label sits above that
    ax.set_ylim(0, max(top) * 1.14)
    ax.yaxis.set_major_formatter(mtick.FuncFormatter(lambda v, _: f"{v/1000:.0f}k"))
    for sp in ("top", "right", "left"):
        ax.spines[sp].set_visible(False)
    ax.spines["bottom"].set_color(MUTE)
    ax.tick_params(axis="y", labelsize=15 * fs, length=0, colors=INK)
    ax.tick_params(axis="x", length=0, colors=INK)
    ax.set_axisbelow(True)
    ax.yaxis.grid(True, color=GRID, lw=1)
    ax.legend(loc="upper left", frameon=False, fontsize=13.5, handlelength=1.4,
              borderaxespad=0.2, labelspacing=0.3)
    ax.margins(x=0.06)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ab-results", default="")
    ap.add_argument("--pg-job", default="")
    ap.add_argument("--ale-job", default="")
    ap.add_argument("--out", default="figures")
    ap.add_argument("--name", default="fig_env_efficiency")
    ap.add_argument("--fs", type=float, default=0.84,
                    help="type scale for the bar panels. Above the composite's "
                         "FS_D of 0.70: this figure gets a full \\linewidth to "
                         "itself, where panel D shared one with three others.")
    ap.add_argument("--hero-fs", type=float, default=0.92,
                    help="type scale for (a). Slightly above the bar panels' "
                         "0.70, which keeps A's type close to theirs while "
                         "leaving its four-arm legend legible; it ran at 0.95 "
                         "when A spanned the full canvas width.")
    args = ap.parse_args()
    fs, hero_fs = args.fs, args.hero_fs

    PROCGEN, ATARI, LAD = load()          # verifies against the published figure
    # Two-arm panel-A data, all same node (holy8a24307), geomeans:
    #   PT (adv)        : adv_anchor 43780731 (HANDOFF-2026-09-01 §11, main)
    #   EP documented best: ep_best_sweep 43779854 (replicated <1% by 44113007)
    #   EP as shipped   : matrix sync1 curve (HANDOFF-2026-09-01 §2)
    t = [10, 20, 40, 80]
    pg_pt  = [453493, 909788, 1812814, 3642545]
    pg_epb = [355451, 587070,  931786, 1413748]
    pg_eps = [178217, 278042,  417106,  468997]
    al_pt  = [918228, 1827240, 3645279, 7355750]
    al_epb = [ 45662,   89285,  177869,  350601]
    al_eps = [ 38478,   73884,  141421,  238829]

    # 2x2: A | B on top, C | D beneath. Both rows share the
    # 17 / 9 width ratios (C's and D's bar counts), so the four panels sit in
    # two aligned columns and A is no longer full-canvas wide.
    # Canvas width and FS_D = 0.70 are still panel D's, from
    # plot_main_composite.py, so the bar panels land at the same size on the
    # page as panel D does, ~4.8pt for a label at \linewidth.
    # D_TOPPAD is the strip above the top row that its A/B letters sit in, and
    # at 0.42 the letters ran into the canvas edge. Taking the difference out
    # of GAP moves the top row down toward C/D and leaves H unchanged.
    # D_LAB is the band the rotated game names occupy; it has to grow with fs,
    # or the longest of them ("space invaders") runs off the bottom edge
    W, D_AX, D_LAB, D_TOPPAD = 13.6, 1.90, 0.95, 0.66
    HERO_AX, HERO_LAB, GAP = 2.30, 0.52, 0.61
    H = D_TOPPAD + HERO_AX + HERO_LAB + GAP + D_AX + D_LAB
    fig = plt.figure(figsize=(W, H))

    d_bottom = D_LAB / H
    d_top = d_bottom + D_AX / H
    hero_bottom = d_top + (GAP + HERO_LAB) / H
    hero_top = 1.0 - D_TOPPAD / H

    # 17 / 9 are C's and D's bar counts, which is what makes bar width uniform
    # across them; 15 / 11 gives B room for its step annotations at the cost of
    # C's bars running ~12% narrower than D's
    COLS = dict(width_ratios=[15, 11], wspace=0.16, left=0.075, right=0.99)
    gs_top = fig.add_gridspec(1, 2, top=hero_top, bottom=hero_bottom, **COLS)
    ax_sc = fig.add_subplot(gs_top[0, 0])
    ax_ld = fig.add_subplot(gs_top[0, 1])
    scaling_panel(ax_sc, t, pg_pt, pg_epb, pg_eps, al_pt, al_epb, al_eps, fs=hero_fs)

    gD = fig.add_gridspec(1, 2, top=d_top, bottom=d_bottom, **COLS)
    ax_pg = fig.add_subplot(gD[0, 0])
    ax_at = fig.add_subplot(gD[0, 1])
    throughput_panel(ax_pg, PROCGEN, "ProcGen", C_PROCGEN, 40, fs=fs)
    throughput_panel(ax_at, ATARI, "ALE", C_ALE, 30, fs=fs, show_ylabel=False)
    ladder_suite_panel(ax_ld, LAD, fs=fs)
    # one legend size across all three, so nothing in A reads a tier larger
    for ax, size in ((ax_sc, 13.5), (ax_pg, 13.5), (ax_at, 13.5)):
        for txt in ax.get_legend().get_texts():
            txt.set_fontsize(size)

    darkgrid(ax_sc, xgrid=True)
    for ax in (ax_pg, ax_at, ax_ld):
        darkgrid(ax, xgrid=False)
        # throughput_panels sets x pad=1.5, which is tight once the spines are
        # gone and there is no rule to separate label from plot. This is the one
        # place the strip departs from panel D's styling.
        ax.tick_params(axis="x", pad=4)
        ax.tick_params(axis="y", pad=4)

    # Bold capitals, matching the composite's A/B/C. Reading order is across
    # then down: A and B on the top row, C and D on the bottom.
    fig.canvas.draw()
    for ax, letter in ((ax_sc, "A"), (ax_ld, "B"), (ax_pg, "C"), (ax_at, "D")):
        pos = ax.get_position()
        # absolute lift, not a figure fraction, so the gap does not change when
        # the canvas height does
        fig.text(pos.x0, pos.y1 + 0.16 / H, letter, ha="left",
                 va="bottom", fontsize=21, fontweight="bold", color=INK)

    print(f"(a) at {t[-1]} threads vs documented best: ProcGen "
          f"{pg_pt[-1]/pg_epb[-1]:.2f}x, ALE {al_pt[-1]/al_epb[-1]:.2f}x; "
          f"vs as shipped: {pg_pt[-1]/pg_eps[-1]:.2f}x / {al_pt[-1]/al_eps[-1]:.2f}x")
    print(f"(b) per-core ProcGen "
          f"{geo([r[1] for r in PROCGEN])/geo([r[3] for r in PROCGEN]):.2f}x  "
          f"wins {sum(r[1] > r[3] for r in PROCGEN)}/16")
    print(f"(c) per-core ALE     "
          f"{geo([r[1] for r in ATARI])/geo([r[3] for r in ATARI]):.2f}x  "
          f"wins {sum(r[1] > r[3] for r in ATARI)}/8")

    os.makedirs(args.out, exist_ok=True)
    for ext in ("pdf", "png"):
        fig.savefig(f"{args.out}/{args.name}.{ext}", dpi=200, facecolor="white")
    print(f"\nwrote {args.out}/{args.name}.pdf / .png")


if __name__ == "__main__":
    main()
