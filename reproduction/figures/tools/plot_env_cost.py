"""Environment cost: a price list, and where every game's step time goes.

Two panels, no panel titles -- the caption carries the reading.

(A) price of one operation, measured on probe environments that each vary a
    single quantity.
(B) every game as a full breakdown: the fixed per-step cost, each p5 primitive
    priced by (A) and counted by the host's per-binding counter, and everything
    else as the residual. B and C used to be separate panels showing the same
    bars twice -- once split by primitive, once split draw-vs-logic -- when one
    stack answers both.

usage: python plot_env_cost8.py PERCMD.json LOGIC.json GRID.json OUT
"""
from __future__ import annotations

import json
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

matplotlib.rcParams.update({"font.size": 8, "axes.labelsize": 8,
                            "xtick.labelsize": 7, "ytick.labelsize": 7,
                            "legend.fontsize": 6.4})

C_DRAW, C_LOGIC, C_BASE, INK = "#1f77b4", "#ff7f0e", "#bbbbbb", "#333333"
percmd = json.load(open(sys.argv[1]))
logic = json.load(open(sys.argv[2]))
grid = json.load(open(sys.argv[3]))
out = sys.argv[4]
t0 = grid["fit"]["t0_us"]
price = percmd["price_ns"]
rows = percmd["rows"]

fig = plt.figure(figsize=(7.2, 8.6))
gs = fig.add_gridspec(2, 1, height_ratios=[1.0, 2.5], hspace=0.30)
axA, axB = fig.add_subplot(gs[0]), fig.add_subplot(gs[1])

# ---- (A) price of one operation --------------------------------------------
SHORT = {"typed-array slot update": "typed-array slot",
         "object allocated per frame": "allocation",
         "entity object update": "entity update",
         "pairwise collision check": "collision check",
         "tile-grid cell scan": "grid cell scan"}
bars = [(f"{k}()", v, C_DRAW) for k, v in price.items() if v > 0]
bars.append(("3-vertex shape", percmd["shape_unit_ns"], C_DRAW))
bars += [(SHORT.get(f["label"], f["label"]), f["per_unit_ns"], C_LOGIC)
         for f in logic["fits"].values()]
bars.sort(key=lambda t: t[1])
y = np.arange(len(bars))
axA.barh(y, [b[1] for b in bars], color=[b[2] for b in bars], height=0.7, zorder=3)
axA.set_yticks(y); axA.set_yticklabels([b[0] for b in bars], fontsize=7)
for i, (_, v, _) in enumerate(bars):
    axA.annotate(f"{v:.0f}", (v, i), xytext=(3, 0), textcoords="offset points",
                 va="center", fontsize=6.4, color=INK)
axA.set_xlim(0, max(b[1] for b in bars) * 1.16)
axA.set_xlabel("nanoseconds per operation")


# ---- (B) every game, fully broken down -------------------------------------
PRIMS = ["quad", "ellipse", "triangle", "shape", "line", "rect", "circle",
         "image", "stroke", "fill", "background"]
SHADES = plt.get_cmap("tab20")
col = {p: SHADES(i % 20) for i, p in enumerate(PRIMS)}


def bill(r):
    b = {k: v * price.get(k, price["rect"]) / 1000 for k, v in r["per_cmd"].items()}
    ns_ = r["per_cmd"].get("endShape", 0)
    if ns_:
        vps = max(r["per_cmd"].get("vertex", 0) / ns_, 1)
        b["shape"] = ns_ * percmd["shape_unit_ns"] * vps / 3 / 1000
    return b


order = sorted(range(len(rows)), key=lambda i: rows[i]["us_per_step"])
names = [rows[i]["game"] for i in order]
tot = np.array([rows[i]["us_per_step"] for i in order])
yb = np.arange(len(order))
left = 100 * t0 / tot
axB.barh(yb, left, color=C_BASE, height=0.76, zorder=3, label="fixed per-step cost")
for prim in PRIMS:
    vals = np.array([100 * bill(rows[i]).get(prim, 0.0) / tot[k]
                     for k, i in enumerate(order)])
    if vals.max() <= 0.05:
        continue
    axB.barh(yb, vals, left=left, color=col[prim], height=0.76, zorder=3,
             label=("3-vertex shapes" if prim == "shape" else f"{prim}()"))
    left = left + vals
axB.barh(yb, np.maximum(100 - left, 0), left=left, color=C_LOGIC, height=0.76,
         zorder=3, label="everything else")
axB.set_yticks(yb)
axB.set_yticklabels([f"{n}   ({1e6 / t:,.0f}/s)" for n, t in zip(names, tot)],
                    fontsize=6.6)
axB.set_xlim(0, 100); axB.set_ylim(-0.7, len(order) - 0.3)
axB.set_xlabel("share of step time (%)")
axB.legend(frameon=False, ncol=5, fontsize=6.0, handlelength=1.0,
           loc="lower center", bbox_to_anchor=(0.5, 1.005))


for ax in (axA, axB):
    ax.grid(True, axis="x", lw=0.4, color="#dddddd", zorder=0)
    for s in ax.spines.values():
        s.set_linewidth(0.6)

for ext in ("pdf", "png"):
    fig.savefig(f"{out}.{ext}", bbox_inches="tight", dpi=200)
print(f"wrote {out}.pdf / .png")
