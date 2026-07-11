"""Paper-style throughput figures (geometric-mean group).

Matches tools/plot_qjs_procgen.py: blue PlayTrain / orange baseline,
"environment steps / sec", k-ticks, dashed separator before the aggregate,
per-game error bars (+/-1 SD). Aggregate bar is the GEOMETRIC mean.

    python plot_throughput.py     # writes the two standalone figures AND the
                                  # combined stacked figure to CWD

Data: FASRC sapphire (Xeon 8480+), 1 core, 7 trials/game, 1 step = 1 frame.
  ProcGen  sweep4 (holy8a32607)   QuickJS 64^2  vs ProcGen 64^2
  Atari    sweep6 (holy8a32603)   QuickJS 64^2  vs ALE native 210x160
"""
import math, statistics as st
import matplotlib.pyplot as plt
import matplotlib.ticker as mtick
import numpy as np

C_PLAY = "#1f77b4"                 # PlayTrain (both panels)
C_PROCGEN, C_ALE = "#ff7f0e", "#d62728"   # ProcGen orange / ALE red
INK, MUTE, GRID = "#1a1a1a", "#5f5f5f", "#e6e3dd"
plt.rcParams.update({"font.family": "DejaVu Sans"})

# (game, qjs_mean, qjs_std, base_mean, base_std)
PROCGEN = [
    ("plunder", 95442, 591, 36840, 482), ("bigfish", 74326, 463, 38698, 920),
    ("bossfight", 69191, 289, 14575, 1083), ("ninja", 64690, 156, 18028, 603),
    ("starpilot", 52337, 239, 34201, 292), ("leaper", 33411, 163, 24579, 3533),
    ("heist", 22012, 68, 24675, 1232), ("dodgeball", 17708, 60, 24395, 1161),
    ("jumper", 15278, 344, 15971, 718), ("maze", 15225, 41, 11918, 341),
    ("caveflyer", 14985, 34, 15993, 277), ("chaser", 14489, 43, 25781, 132),
    ("climber", 12065, 25, 23276, 970), ("fruitbot", 10814, 38, 14249, 87),
    ("coinrun", 9655, 14, 21476, 1791), ("miner", 6366, 9, 14331, 215),
]
ATARI = [
    ("pong", 167833, 2684, 11166, 37), ("seaquest", 65867, 799, 8846, 93),
    ("space_invaders", 50758, 350, 9109, 48), ("frostbite", 39610, 250, 4977, 22),
    ("breakout", 32206, 96, 3741, 23), ("asteroids", 48715, 196, 10462, 58),
    ("freeway", 83686, 569, 6337, 21), ("qbert", 11366, 21, 5484, 13),
]


def geo(xs):
    return math.exp(st.fmean(math.log(x) for x in xs))


def panel(ax, rows, base_label, base_color, rotate):
    rows = sorted(rows, key=lambda r: r[1], reverse=True)
    games = [r[0] for r in rows]
    qj = [r[1] for r in rows]; qe = [r[2] for r in rows]
    bj = [r[3] for r in rows]; be = [r[4] for r in rows]
    gq, gb = geo(qj), geo(bj)

    labels = [g.replace("_", " ") for g in games] + ["mean"]
    qj_all, bj_all = qj + [gq], bj + [gb]
    qe_all, be_all = qe + [0], be + [0]
    x = np.arange(len(labels)); w = 0.4

    ax.bar(x - w/2 - 0.01, qj_all, w, yerr=qe_all, label="PlayTrain",
           color=C_PLAY, ecolor=MUTE, capsize=3, error_kw={"lw": 1.2})
    ax.bar(x + w/2 + 0.01, bj_all, w, yerr=be_all, label=base_label,
           color=base_color, ecolor=MUTE, capsize=3, error_kw={"lw": 1.2})

    ax.set_ylabel("environment steps / sec", fontsize=16)
    ax.set_xticks(x)
    ax.set_xticklabels(labels, rotation=rotate, ha="right" if rotate else "center", fontsize=12.5)
    ax.yaxis.set_major_formatter(mtick.FuncFormatter(lambda v, _: f"{v/1000:.0f}k"))
    ax.tick_params(axis="y", labelsize=14, length=0, colors=MUTE)
    ax.tick_params(axis="x", length=0, colors=INK)
    for s in ("top", "right", "left"):
        ax.spines[s].set_visible(False)
    ax.spines["bottom"].set_color(MUTE)
    ax.set_axisbelow(True); ax.yaxis.grid(True, color=GRID, lw=1)
    ax.set_ylim(top=max(qj_all + bj_all) * 1.08)
    ax.legend(loc="upper center", ncol=2, frameon=False, fontsize=14,
              bbox_to_anchor=(0.5, 1.11))
    ax.margins(x=0.01)
    return gq, gb


def standalone(rows, base_label, base_color, out, figsize, rotate):
    fig, ax = plt.subplots(figsize=figsize)
    gq, gb = panel(ax, rows, base_label, base_color, rotate)
    for ext in ("png", "pdf"):
        fig.savefig(f"{out}.{ext}", dpi=200, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print(f"wrote {out} | PlayTrain {gq:.0f}  {base_label} {gb:.0f} = {gq/gb:.2f}x")


def combined(out):
    fig, (ax1, ax2) = plt.subplots(
        2, 1, figsize=(15, 9),
        gridspec_kw={"height_ratios": [1, 1], "hspace": 0.5})
    panel(ax1, PROCGEN, "ProcGen", C_PROCGEN, 40)
    panel(ax2, ATARI, "ALE", C_ALE, 30)
    for ext in ("png", "pdf"):
        fig.savefig(f"{out}.{ext}", dpi=200, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print(f"wrote {out}.png/.pdf (combined stacked)")


if __name__ == "__main__":
    standalone(PROCGEN, "ProcGen", C_PROCGEN, "fig_throughput_procgen", (15, 4.6), 40)
    standalone(ATARI, "ALE", C_ALE, "fig_throughput_atari", (11, 4.6), 30)
    combined("fig_throughput_combined")
