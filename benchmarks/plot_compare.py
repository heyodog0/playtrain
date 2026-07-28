"""Minimalistic grouped-bar throughput plots from bench_compare.py JSONs.

Generates:
  outputs/compare/mac_atari.{png,pdf}        PlayTrain vs ALE   (Apple Silicon)
  outputs/compare/sapphire_atari.{png,pdf}   PlayTrain vs ALE   (x86 Sapphire)
  outputs/compare/sapphire_procgen.{png,pdf} PlayTrain vs procgen (x86 Sapphire)

No title, no prose annotations; large labels.
"""
from __future__ import annotations
import json, statistics
from pathlib import Path
import numpy as np
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter

BASE = Path(__file__).resolve().parents[1] / "outputs" / "compare"

# validated categorical pair (CVD dE 89.6, PASS)
C_PLAY, C_BASE = "#2f6fb2", "#d8873b"
INK, MUTE, GRID = "#1a1a1a", "#5f5f5f", "#e6e3dd"

plt.rcParams.update({"font.family": "DejaVu Sans"})


def load(path):
    d = json.loads(Path(path).read_text())
    return {r["game"]: r for r in d["results"] if "fps_median" in r}


def plot_grouped(node, base, base_label, out, *, figsize, values=False,
                 rotate=0, ylab="environment steps / sec", order=None):
    order = order or sorted(node, key=lambda g: node[g]["fps_median"], reverse=True)
    pm = statistics.fmean(node[g]["fps_median"] for g in order)
    bm = statistics.fmean(base[g]["fps_median"] for g in order)
    node = {**node, "mean": {"fps_median": pm, "fps_std": 0.0}}
    base = {**base, "mean": {"fps_median": bm, "fps_std": 0.0}}
    games = order + ["mean"]

    x = np.arange(len(games)); w = 0.40
    pj = [node[g]["fps_median"] for g in games]; pe = [node[g]["fps_std"] for g in games]
    bj = [base[g]["fps_median"] for g in games]; be = [base[g]["fps_std"] for g in games]

    fig, ax = plt.subplots(figsize=figsize)
    b1 = ax.bar(x - w/2 - 0.01, pj, w, yerr=pe, label="PlayTrain",
                color=C_PLAY, ecolor=MUTE, capsize=3, error_kw={"lw": 1.2})
    b2 = ax.bar(x + w/2 + 0.01, bj, w, yerr=be, label=base_label,
                color=C_BASE, ecolor=MUTE, capsize=3, error_kw={"lw": 1.2})

    if values:
        head = max(pj + bj) * 0.02
        for bars, vals, errs in ((b1, pj, pe), (b2, bj, be)):
            for rect, v, e in zip(bars, vals, errs):
                ax.text(rect.get_x() + rect.get_width()/2, v + e + head,
                        f"{v/1000:.0f}k", ha="center", va="bottom",
                        fontsize=13, color=INK)

    ax.set_xticks(x)
    ax.set_xticklabels([g.replace("_", "\n") for g in games],
                       fontsize=15, rotation=rotate,
                       ha="right" if rotate else "center")
    ax.set_ylabel(ylab, fontsize=17)
    ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v/1000:.0f}k"))
    ax.tick_params(axis="y", labelsize=15, length=0, colors=MUTE)
    ax.tick_params(axis="x", length=0, colors=INK)
    ax.grid(axis="y", color=GRID, lw=1.0, zorder=0); ax.set_axisbelow(True)
    for s in ("top", "right", "left"): ax.spines[s].set_visible(False)
    ax.spines["bottom"].set_color(MUTE)
    ax.axvline(len(order) - 0.5, color=GRID, lw=1.4, ls=(0, (3, 3)), zorder=0)
    ax.legend(frameon=False, fontsize=16, loc="lower center",
              bbox_to_anchor=(0.5, 1.0), ncol=2,
              handlelength=1.2, columnspacing=1.6)
    ax.margins(y=0.12)
    fig.tight_layout()
    for ext in ("png", "pdf"):
        fig.savefig(BASE / f"{out}.{ext}", dpi=200, bbox_inches="tight", facecolor="white")
    print(f"wrote {out}  (PlayTrain {pm:.0f} vs {base_label} {bm:.0f}, ratio {pm/bm:.2f}x)")


# fixed x-order so both Atari plots line up
ATARI_ORDER = ["space_invaders", "freeway", "frostbite", "asteroids", "breakout"]
# Mac Atari
plot_grouped(load(BASE/"mac/node_atari.json"), load(BASE/"mac/ale_atari.json"),
             "ALE", "mac_atari", figsize=(8, 4.2), order=ATARI_ORDER)
# Sapphire Atari
plot_grouped(load(BASE/"sapphire/node_atari.json"), load(BASE/"sapphire/ale_atari.json"),
             "ALE", "sapphire_atari", figsize=(8, 4.2), order=ATARI_ORDER)
# Sapphire ProcGen (16 games -> wide, rotated labels, no per-bar values)
plot_grouped(load(BASE/"sapphire/node_procgen.json"), load(BASE/"sapphire/procgen_procgen.json"),
             "ProcGen", "sapphire_procgen", figsize=(15, 4.6), values=False, rotate=40)
