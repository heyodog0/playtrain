"""Redesigned Fig 4A preview: thread scaling under the adopted (adv) binary.
All curves same-node (holy8a24307): PT = adv_anchor 43780731; EP documented-best
= ep_best_sweep 43779854 (replicated within 1% by 44113007); EP as-shipped =
matrix sync1 curve (HANDOFF-2026-09-01 section 2). House style of
plot_env_efficiency.py / throughput_panels.py."""
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as mtick

C_PLAY, C_PROCGEN, C_ALE = "#3a78c2", "#e8913f", "#c23b34"
INK, MUTE, GRID = "#1a1a1a", "#5f5f5f", "#e6e3dd"
plt.rcParams.update({"font.family": "DejaVu Sans"})

T = [10, 20, 40, 80]
DATA = {
 "procgen": {
   "PlayTrain":                [453493, 909788, 1812814, 3642545],
   "EnvPool (documented best)":[355451, 587070,  931786, 1413748],
   "EnvPool (as shipped)":     [178217, 278042,  417106,  468997],
   "base": C_PROCGEN, "title": "vs ProcGen (16 games)"},
 "ale": {
   "PlayTrain":                [918228, 1827240, 3645279, 7355750],
   "EnvPool (documented best)":[ 45662,   89285,  177869,  350601],
   "EnvPool (as shipped)":     [ 38478,   73884,  141421,  238829],
   "base": C_ALE, "title": "vs ALE (8 games)"},
}

fig, axes = plt.subplots(1, 2, figsize=(11, 4.4))
for ax, key in zip(axes, ("procgen", "ale")):
    d = DATA[key]; bc = d["base"]
    ax.plot(T, d["PlayTrain"], "-o", color=C_PLAY, lw=2.4, ms=6, zorder=5,
            label="PlayTrain")
    ax.plot(T, d["EnvPool (documented best)"], "-s", color=bc, lw=2.2, ms=5.5,
            zorder=4, label="EnvPool (documented best)")
    ax.plot(T, d["EnvPool (as shipped)"], "--^", color=bc, lw=1.8, ms=5.5,
            mfc="white", zorder=3, label="EnvPool (as shipped)")
    r = d["PlayTrain"][-1] / d["EnvPool (documented best)"][-1]
    ax.annotate(f"{r:.2f}x" if r < 10 else f"{r:.1f}x",
                xy=(T[-1], d["PlayTrain"][-1]),
                xytext=(-8, 6), textcoords="offset points",
                ha="right", fontsize=12, color=INK, fontweight="bold")
    ax.set_title(d["title"], fontsize=13, color=INK, pad=8)
    ax.set_xlabel("env threads", fontsize=12)
    ax.set_xscale("log", base=2); ax.set_xticks(T)
    ax.xaxis.set_major_formatter(mtick.FuncFormatter(lambda v, _: f"{v:.0f}"))
    ax.set_ylim(0, None)
    ax.yaxis.set_major_formatter(mtick.FuncFormatter(
        lambda v, _: f"{v/1e6:.1f}M" if v >= 1e6 else (f"{v/1000:.0f}k" if v >= 1000 else f"{v:.0f}")))
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    for s in ("left", "bottom"):
        ax.spines[s].set_color(MUTE)
    ax.tick_params(axis="both", labelsize=11, length=0, colors=INK)
    ax.set_axisbelow(True); ax.yaxis.grid(True, color=GRID, lw=1)
    ax.legend(loc="upper left", frameon=False, fontsize=10.5,
              handlelength=1.8, labelspacing=0.35)
axes[0].set_ylabel("environment SPS", fontsize=13)
fig.suptitle("Fig 4A preview — adv binary, all curves same node (holy8a24307)",
             fontsize=11, color=MUTE, y=1.002)
fig.tight_layout()
for ext in ("png", "pdf"):
    fig.savefig(f"fig4a_adv_preview.{ext}", dpi=200, bbox_inches="tight", facecolor="white")
print("wrote fig4a_adv_preview.png/.pdf")
