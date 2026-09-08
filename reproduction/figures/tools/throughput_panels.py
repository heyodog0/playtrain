"""Shared drawing code for the three environment-throughput panels.

Both the standalone figure (plot_throughput_all.py) and panel D of the main
composite (plot_main_composite.py) draw the same bars from the same committed
per-trial data; only the type scale differs, so the panel functions take an
`fs` scale factor rather than being duplicated.

Panels (a)/(b) are derived from results/env_throughput/ and cross-checked
against the values as published (see _EXPECTED_* below); loading fails loudly
rather than silently redrawing a different figure. Panel (c) reads the
committed backend ladder.
"""
import json, math, statistics as st
from pathlib import Path
import matplotlib.pyplot as plt
import matplotlib.ticker as mtick
import numpy as np

# PlayTrain-blue palette: blue hero vs orange (ProcGen) / red (ALE) baselines
C_PLAY, C_PROCGEN, C_ALE = "#3a78c2", "#e8913f", "#c23b34"
LADDER = ["#cdddf0", "#7aa9d8", "#2d5c8f"]   # light->dark blue; top = QuickJS
INK, MUTE, GRID = "#1a1a1a", "#5f5f5f", "#e6e3dd"
TRIALS = 7

DATA = Path(__file__).resolve().parents[1] / "results" / "env_throughput"

# The figure as published, kept as a checksum on the derivation below.
# (game, qjs_mean, qjs_std, base_mean, base_std)
_EXPECTED_PROCGEN = [
    ("plunder", 191069, 1407, 37563, 347), ("bigfish", 127317, 1548, 37442, 1956),
    ("bossfight", 123593, 850, 14977, 956), ("ninja", 126686, 2173, 18169, 572),
    ("starpilot", 94492, 633, 34836, 506), ("leaper", 66213, 807, 25999, 3074),
    ("heist", 57262, 354, 24587, 1691), ("dodgeball", 32103, 104, 25876, 1559),
    ("jumper", 24276, 198, 16104, 353), ("maze", 38656, 186, 12272, 926),
    ("caveflyer", 30952, 284, 16114, 553), ("chaser", 25890, 158, 26217, 149),
    ("climber", 16876, 55, 22841, 1775), ("fruitbot", 17534, 113, 14351, 41),
    ("coinrun", 22637, 123, 21951, 2780), ("miner", 23414, 242, 14454, 176),
]
_EXPECTED_ATARI = [
    ("pong", 477263, 4618, 11721, 92), ("seaquest", 115031, 654, 9297, 11),
    ("space_invaders", 95594, 832, 9628, 10), ("frostbite", 63039, 195, 5196, 28),
    ("breakout", 73634, 1632, 3896, 14), ("asteroids", 81601, 1581, 10997, 9),
    ("freeway", 193037, 2881, 6592, 70), ("qbert", 14706, 283, 5703, 14),
]


def _qjs(fname):
    """PlayTrain per-game mean and sample SD from the raw per-trial sweep lines."""
    trials = {}
    for line in (DATA / fname).read_text().split("\n"):
        if not line.strip():
            continue
        g, s = line.split()
        trials.setdefault(g, []).append(float(s))
    return {g: (st.fmean(v), st.stdev(v)) for g, v in trials.items()}


def _base(fname):
    """Baseline per-game mean and SD from a bench_compare.py JSON."""
    rows = json.load(open(DATA / fname))["results"]
    return {r["game"]: (r["fps_mean"], r["fps_std"]) for r in rows if "fps_mean" in r}


def _rows(qjs_file, base_file, expected):
    """Build (game, qjs_mean, qjs_std, base_mean, base_std) from data, then verify."""
    Q, B = _qjs(qjs_file), _base(base_file)
    rows, bad = [], []
    for game, eqm, eqs, ebm, ebs in expected:
        (qm, qs), (bm, bs) = Q[game], B[game]
        rows.append((game, qm, qs, bm, bs))
        for got, want, what in ((qm, eqm, "qjs mean"), (qs, eqs, "qjs sd"),
                                (bm, ebm, "base mean"), (bs, ebs, "base sd")):
            if abs(got - want) > 1.0:
                bad.append(f"{game} {what}: data {got:.1f} vs published {want}")
    if bad:
        raise SystemExit("committed data disagrees with the published figure:\n  "
                         + "\n  ".join(bad))
    return rows


def load():
    """(procgen rows, atari rows, backend ladder)."""
    return (_rows("qjs_raw4.txt", "procgen4.json", _EXPECTED_PROCGEN),
            _rows("qjs_atari6_raw.txt", "ale_atari6.json", _EXPECTED_ATARI),
            json.load(open(DATA / "backend_ladder_fasrc.json")))


def geo(xs):
    return math.exp(st.fmean(math.log(x) for x in xs))


def throughput_panel(ax, rows, base_label, base_color, rotate, fs=1.0,
                     show_ylabel=True, cap=None):
    rows = sorted(rows, key=lambda r: r[1], reverse=True)
    games = [r[0] for r in rows]
    se = TRIALS ** 0.5
    qj = [r[1] for r in rows]; qe = [r[2] / se for r in rows]
    bj = [r[3] for r in rows]; be = [r[4] / se for r in rows]
    labels = [g.replace("_", " ") for g in games] + ["mean"]
    qj_all, bj_all = qj + [geo(qj)], bj + [geo(bj)]
    qe_all, be_all = qe + [0], be + [0]
    x = np.arange(len(labels)); w = 0.4
    ax.bar(x - w/2 - 0.01, qj_all, w, yerr=qe_all, label="PlayTrain", color=C_PLAY,
           ecolor=MUTE, capsize=2.5 * fs, error_kw={"lw": 1.0 * fs})
    ax.bar(x + w/2 + 0.01, bj_all, w, yerr=be_all, label=base_label, color=base_color,
           ecolor=MUTE, capsize=2.5 * fs, error_kw={"lw": 1.0 * fs})
    if show_ylabel:
        ax.set_ylabel("environment SPS", fontsize=17 * fs)
    ax.set_xticks(x); ax.set_xticklabels(labels, rotation=rotate,
                                         ha="right" if rotate else "center",
                                         fontsize=13.5 * fs)
    ax.yaxis.set_major_formatter(mtick.FuncFormatter(lambda v, _: f"{v/1000:.0f}k"))
    for s in ("top", "right", "left"):
        ax.spines[s].set_visible(False)
    ax.spines["bottom"].set_color(MUTE)
    ax.tick_params(axis="y", labelsize=15 * fs, length=0, colors=INK)
    ax.tick_params(axis="x", length=0, colors=INK, pad=1.5)
    if cap:
        # One game (pong) is several times the next bar, which squashes the rest.
        # Clip the axis and cut the bar with a wavy break, keeping its value
        # readable rather than dropping the game or going log.
        ax.set_ylim(0, cap)
        for xi, v in zip(x - w/2 - 0.01, qj_all):
            if v > cap:
                y0, y1 = cap * 0.72, cap * 0.90
                ax.add_patch(plt.Rectangle((xi - 0.02, y0), w + 0.04, y1 - y0,
                                           facecolor="white", edgecolor="none",
                                           zorder=5, clip_on=False))
                xs = np.linspace(xi, xi + w, 120)
                amp = (y1 - y0) * 0.22
                for yc in (y0 + amp * 1.4, y1 - amp * 1.4):
                    ax.plot(xs, yc + amp * np.sin(2 * np.pi * 2 * (xs - xi) / w),
                            color=INK, lw=1.5 * fs, zorder=6, solid_capstyle="round")
                ax.text(xi + w / 2, cap * 0.995, f"{v/1000:.0f}k", ha="center",
                        va="bottom", fontsize=12 * fs, color=INK)
    ax.set_axisbelow(True); ax.yaxis.grid(True, color=GRID, lw=1)
    ax.legend(loc="upper right", ncol=1, frameon=False, fontsize=12 * fs,
              handlelength=1.4, borderaxespad=0.2, labelspacing=0.3)
    ax.margins(x=0.01)


def ladder_panel(ax, lad, fs=1.0, labels=None):
    keys = ["playwright", "v8", "quickjs"]
    # the compact (panel-D) column is too narrow for the full names; callers
    # there pass the short set
    labels = labels or ["Playwright", "Node.js\n/ V8", "QuickJS\n(PlayTrain)"]
    games = lad["games"]
    vals, lo, hi = [], [], []
    for k in keys:
        vs = [lad[k][g] for g in games]
        lg = [math.log(v) for v in vs]; mu = sum(lg)/len(lg)
        sd = (sum((z-mu)**2 for z in lg)/(len(lg)-1))**0.5
        gm = math.exp(mu); f = math.exp(sd/len(lg)**0.5)
        vals.append(gm); lo.append(gm-gm/f); hi.append(gm*f-gm)
    x = range(3)
    ax.bar(x, vals, width=0.64, color=LADDER, zorder=3, yerr=[lo, hi],
           ecolor="#3a3f44", capsize=5 * fs, error_kw={"lw": 1.4 * fs, "zorder": 4})
    ax.set_ylim(0, (vals[-1]+hi[-1]) * 1.12)
    ax.set_ylabel("environment SPS", fontsize=17 * fs)
    ax.yaxis.set_major_formatter(mtick.FuncFormatter(
        lambda v, _: f"{v/1000:.0f}k" if v >= 1000 else f"{v:.0f}"))
    ax.set_xticks(list(x)); ax.set_xticklabels(labels, fontsize=14 * fs, ha="center")
    for s in ("top", "right", "left"):
        ax.spines[s].set_visible(False)
    ax.spines["bottom"].set_color(MUTE)
    ax.tick_params(axis="y", labelsize=15 * fs, length=0, colors=INK)
    ax.tick_params(axis="x", length=0, colors=INK, pad=6 * fs)
    ax.set_axisbelow(True); ax.yaxis.grid(True, color=GRID, lw=1, zorder=0)
    ax.margins(x=0.10)
