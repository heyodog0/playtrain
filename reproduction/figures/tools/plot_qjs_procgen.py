"""Grouped-bar throughput figure: PlayTrain (QuickJS backend) vs ProcGen, per
game + mean, matching the paper's sapphire_procgen style.

    python tools/plot_qjs_procgen.py <qjs.json> <procgen.json> <out_basename>

Both JSONs are bench_compare format: {"results":[{"game","fps_median","fps_std"}]}.
"""
import json, statistics, sys
from pathlib import Path
import matplotlib.pyplot as plt
import matplotlib.ticker as mtick
import numpy as np

C_PLAY, C_BASE = "#1f77b4", "#ff7f0e"      # blue / orange — CVD-safe pair (paper scheme)
INK, MUTE, GRID = "#1a1a1a", "#5f5f5f", "#e6e3dd"

def load(p):
    d = json.loads(Path(p).read_text())
    return {r["game"]: r for r in d["results"] if "fps_median" in r}

qjs, pg, out = load(sys.argv[1]), load(sys.argv[2]), sys.argv[3]
games = sorted(set(qjs) & set(pg), key=lambda g: qjs[g]["fps_median"], reverse=True)

pm = statistics.fmean(qjs[g]["fps_median"] for g in games)
bm = statistics.fmean(pg[g]["fps_median"] for g in games)
order = games + ["mean"]
qjs = {**qjs, "mean": {"fps_median": pm, "fps_std": 0.0}}
pg  = {**pg,  "mean": {"fps_median": bm, "fps_std": 0.0}}

pj = [qjs[g]["fps_median"] for g in order]; pe = [qjs[g].get("fps_std", 0) for g in order]
bj = [pg[g]["fps_median"] for g in order];  be = [pg[g].get("fps_std", 0) for g in order]
x = np.arange(len(order)); w = 0.4

fig, ax = plt.subplots(figsize=(15, 4.6))
ax.bar(x - w/2 - 0.01, pj, w, yerr=pe, label="PlayTrain", color=C_PLAY, ecolor=MUTE, capsize=3, error_kw={"lw": 1.2})
ax.bar(x + w/2 + 0.01, bj, w, yerr=be, label="ProcGen",   color=C_BASE, ecolor=MUTE, capsize=3, error_kw={"lw": 1.2})

ax.set_ylabel("environment steps / sec", fontsize=17)
ax.set_xticks(x); ax.set_xticklabels(order, rotation=40, ha="right", fontsize=13)
ax.yaxis.set_major_formatter(mtick.FuncFormatter(lambda v, _: f"{v/1000:.0f}k"))
ax.tick_params(axis="y", labelsize=15, length=0, colors=MUTE)
ax.tick_params(axis="x", length=0, colors=INK)
for s in ("top", "right", "left"): ax.spines[s].set_visible(False)
ax.spines["bottom"].set_color(MUTE)
ax.set_axisbelow(True); ax.yaxis.grid(True, color=GRID, lw=1)
ax.axvline(len(games) - 0.5, color=GRID, lw=1.4, ls=(0, (3, 3)), zorder=0)
ax.legend(loc="upper center", ncol=2, frameon=False, fontsize=15, bbox_to_anchor=(0.5, 1.12))
ax.margins(x=0.01)

for ext in ("png", "pdf"):
    fig.savefig(f"{out}.{ext}", dpi=200, bbox_inches="tight", facecolor="white")
print(f"wrote {out}.png / .pdf  |  PlayTrain mean {pm:.0f}  ProcGen mean {bm:.0f}  ({pm/bm:.2f}x)")
