"""The paper's environment-layer throughput figure (throughput_all.pdf): vs ProcGen
(a) and ALE (b) on the left, PlayTrain backend ablation (c) on the right. FASRC
sapphire, single core, geomean, +/-1 SE.

Panels (a) and (b) are derived from the committed per-trial data in
results/env_throughput/ and cross-checked against the values as published (see
_EXPECTED_* below); the script fails loudly rather than silently redrawing a
different figure. Panel (c) reads the committed backend ladder.

    python tools/plot_throughput_all.py      # writes fig_throughput_all.{png,pdf}
"""
import json, math, statistics as st
from pathlib import Path
import matplotlib.pyplot as plt
import matplotlib.ticker as mtick
import matplotlib.gridspec as gridspec
import numpy as np

# PlayTrain-blue palette: blue hero vs orange (ProcGen) / red (ALE) baselines
C_PLAY, C_PROCGEN, C_ALE = "#3a78c2", "#e8913f", "#c23b34"    # PlayTrain / ProcGen / ALE
LADDER = ["#cdddf0", "#7aa9d8", "#2d5c8f"]                    # light->dark blue; top = QuickJS (PlayTrain)
INK, MUTE, GRID = "#1a1a1a", "#5f5f5f", "#e6e3dd"
plt.rcParams.update({"font.family": "DejaVu Sans"})
TRIALS = 7

DATA = Path(__file__).resolve().parents[1] / "results" / "env_throughput"

# The figure as published, kept as a checksum on the derivation below.
# (game, qjs_mean, qjs_std, base_mean, base_std)
_EXPECTED_PROCGEN = [
    ("plunder", 95442, 591, 36840, 482), ("bigfish", 74326, 463, 38698, 920),
    ("bossfight", 69191, 289, 14575, 1083), ("ninja", 64690, 156, 18028, 603),
    ("starpilot", 52337, 239, 34201, 292), ("leaper", 33411, 163, 24579, 3533),
    ("heist", 22012, 68, 24675, 1232), ("dodgeball", 17708, 60, 24395, 1161),
    ("jumper", 15278, 344, 15971, 718), ("maze", 15225, 41, 11918, 341),
    ("caveflyer", 14985, 34, 15993, 277), ("chaser", 14489, 43, 25781, 132),
    ("climber", 12065, 25, 23276, 970), ("fruitbot", 10814, 38, 14249, 87),
    ("coinrun", 9655, 14, 21476, 1791), ("miner", 6366, 9, 14331, 215),
]
_EXPECTED_ATARI = [
    ("pong", 167833, 2684, 11166, 37), ("seaquest", 65867, 799, 8846, 93),
    ("space_invaders", 50758, 350, 9109, 48), ("frostbite", 39610, 250, 4977, 22),
    ("breakout", 32206, 96, 3741, 23), ("asteroids", 48715, 196, 10462, 58),
    ("freeway", 83686, 569, 6337, 21), ("qbert", 11366, 21, 5484, 13),
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


PROCGEN = _rows("qjs_raw4.txt", "procgen4.json", _EXPECTED_PROCGEN)
ATARI = _rows("qjs_atari6_raw.txt", "ale_atari6.json", _EXPECTED_ATARI)
LAD = json.load(open(DATA / "backend_ladder_fasrc.json"))

def geo(xs):
    return math.exp(st.fmean(math.log(x) for x in xs))


def tag(fig, ax, s, dy=0.012):
    # figure-space placement so tags over panels of different heights (a vs c)
    # land at the SAME absolute top level; sits above the plot, right of the y-label.
    pos = ax.get_position()
    fig.text(pos.x0, pos.y1 + dy, s, ha="left", va="bottom", fontsize=14, color=INK)


def throughput_panel(ax, rows, base_label, base_color, rotate, show_ylabel=True):
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
           ecolor=MUTE, capsize=2.5, error_kw={"lw": 1.0})
    ax.bar(x + w/2 + 0.01, bj_all, w, yerr=be_all, label=base_label, color=base_color,
           ecolor=MUTE, capsize=2.5, error_kw={"lw": 1.0})
    if show_ylabel:
        ax.set_ylabel("environment SPS", fontsize=17)
    ax.set_xticks(x); ax.set_xticklabels(labels, rotation=rotate,
                                         ha="right" if rotate else "center", fontsize=13.5)
    ax.yaxis.set_major_formatter(mtick.FuncFormatter(lambda v, _: f"{v/1000:.0f}k"))
    for s in ("top", "right", "left"):
        ax.spines[s].set_visible(False)
    ax.spines["bottom"].set_color(MUTE)
    ax.tick_params(axis="y", labelsize=15, length=0, colors=INK)
    ax.tick_params(axis="x", length=0, colors=INK)
    ax.set_axisbelow(True); ax.yaxis.grid(True, color=GRID, lw=1)
    ax.legend(loc="upper right", ncol=1, frameon=False, fontsize=12)
    ax.margins(x=0.01)


def ladder_panel(ax):
    keys = ["playwright", "v8", "quickjs"]
    labels = ["Playwright", "Node.js\n/ V8", "QuickJS\n(PlayTrain)"]
    games = LAD["games"]
    vals, lo, hi = [], [], []
    for k in keys:
        vs = [LAD[k][g] for g in games]
        lg = [math.log(v) for v in vs]; mu = sum(lg)/len(lg)
        sd = (sum((z-mu)**2 for z in lg)/(len(lg)-1))**0.5
        gm = math.exp(mu); f = math.exp(sd/len(lg)**0.5)
        vals.append(gm); lo.append(gm-gm/f); hi.append(gm*f-gm)
    x = range(3)
    ax.bar(x, vals, width=0.64, color=LADDER, zorder=3, yerr=[lo, hi],
           ecolor="#3a3f44", capsize=5, error_kw={"lw": 1.4, "zorder": 4})
    ax.set_ylim(0, (vals[-1]+hi[-1]) * 1.12)
    ax.set_ylabel("environment SPS", fontsize=17)
    ax.yaxis.set_major_formatter(mtick.FuncFormatter(lambda v, _: f"{v/1000:.0f}k" if v >= 1000 else f"{v:.0f}"))
    ax.set_xticks(list(x)); ax.set_xticklabels(labels, fontsize=14, rotation=0, ha="center")
    for s in ("top", "right", "left"):
        ax.spines[s].set_visible(False)
    ax.spines["bottom"].set_color(MUTE)
    ax.tick_params(axis="y", labelsize=15, length=0, colors=INK)
    ax.tick_params(axis="x", length=0, colors=INK, pad=6)
    ax.set_axisbelow(True); ax.yaxis.grid(True, color=GRID, lw=1, zorder=0)
    ax.margins(x=0.10)


def scaling_panel(ax):  # UNUSED: the published figure is 3 panels.
    raise NotImplementedError(
        'scaling_panel needs the legacy node-gym scaling JSONs, which are not \n'
        'committed here; the published figure does not include this panel.')
    # noqa: original body retained below for reference
    CAP = 98   # drop C=112 (a 3% dip on the Atari curve is measurement noise); cap display
    def series(d, key_):
        cs_ = [c for c in d["cores"] if c <= CAP]
        ys_ = [y for c, y in zip(d["cores"], d[key_]) if c <= CAP]
        return cs_, ys_
    # PlayTrain (ProcGen suite) — blue solid; ProcGen — orange
    ax.plot(*series(SCALE_PG, "playtrain"), "-o", color=C_PLAY, lw=2.2, ms=5, zorder=5,
            label="PlayTrain (PG)")
    ax.plot(*series(SCALE_PG, "baseline"), "-s", color=C_PROCGEN, lw=2.0, ms=4.5, zorder=4,
            label="ProcGen")
    # PlayTrain (Atari suite) — blue dashed; ALE — red
    ax.plot(*series(SCALE_AT, "playtrain"), "--o", color=C_PLAY, lw=2.2, ms=5,
            mfc="white", zorder=5, label="PlayTrain (Atari)")
    ax.plot(*series(SCALE_AT, "baseline"), "-^", color=C_ALE, lw=2.0, ms=5,
            zorder=4, label="ALE")
    ax.set_xlabel("worker threads (cores)", fontsize=15)
    ax.set_ylabel("aggregate SPS", fontsize=17)
    xticks = [1, 28, 56, 84, 98]     # clean, non-colliding labels on linear x
    ax.set_xticks(xticks); ax.set_xticklabels([str(c) for c in xticks], fontsize=13.5)
    ax.set_xlim(-2, CAP * 1.03); ax.set_ylim(0, None)
    ax.yaxis.set_major_formatter(mtick.FuncFormatter(
        lambda v, _: f"{v/1e6:.1f}M" if v >= 1e6 else (f"{v/1000:.0f}k" if v >= 1000 else f"{v:.0f}")))
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    for s in ("left", "bottom"):
        ax.spines[s].set_color(MUTE)
    ax.tick_params(axis="both", labelsize=13, length=0, colors=INK)
    ax.set_axisbelow(True); ax.yaxis.grid(True, color=GRID, lw=1)
    ax.legend(loc="upper left", frameon=False, fontsize=11, handlelength=1.8, labelspacing=0.35)


fig = plt.figure(figsize=(16.5, 7.0))
gs = gridspec.GridSpec(2, 2, width_ratios=[2.3, 1.0], height_ratios=[1, 1],
                       hspace=0.6, wspace=0.24, figure=fig)
ax_pg = fig.add_subplot(gs[0, 0])
ax_at = fig.add_subplot(gs[1, 0])
ax_ld = fig.add_subplot(gs[:, 1])

throughput_panel(ax_pg, PROCGEN, "ProcGen", C_PROCGEN, 40)
throughput_panel(ax_at, ATARI, "ALE", C_ALE, 30)
ladder_panel(ax_ld)
tag(fig, ax_pg, "(a)"); tag(fig, ax_at, "(b)"); tag(fig, ax_ld, "(c)")

for ext in ("png", "pdf"):
    fig.savefig(f"fig_throughput_all.{ext}", dpi=200, bbox_inches="tight", facecolor="white")
print("wrote fig_throughput_all.png/.pdf")
