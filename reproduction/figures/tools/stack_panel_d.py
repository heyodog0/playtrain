"""Stack panel D under an already-rendered fig_main.png.

plot_main_composite.py draws all four panels, but A/B/C need the outputs/ tree
(TB runs, thumbnails, variant strips) that only exists on the cluster. Panel D
reads committed data, so off-cluster you can take the A/B/C raster as-is and
paste D under it -- same geometry, same code, identical result.

    python tools/stack_panel_d.py fig_main.png fig_main_D.png
"""
import sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from PIL import Image

from throughput_panels import (C_ALE, C_PROCGEN, INK, ladder_panel, load,
                               throughput_panel)

# must match plot_main_composite.py
FS_LAB, FS_PANEL, FS_D = 12.5, 21, 0.70
W, H_ABC = 13.6, 8.0
D_GAP, D_AX, D_LAB = 0.30, 1.70, 0.62
D_BLOCK = D_GAP + D_AX + D_LAB
H = H_ABC + D_BLOCK

src, dst = sys.argv[1], sys.argv[2]
plt.rcParams.update({"font.family": "DejaVu Sans"})
fig = plt.figure(figsize=(W, H), facecolor="white")

ax_img = fig.add_axes([0, D_BLOCK / H, 1, H_ABC / H])
ax_img.imshow(np.asarray(Image.open(src)))
ax_img.axis("off")

gD = fig.add_gridspec(1, 3, width_ratios=[17, 9, 5], wspace=0.20,
                      left=0.055, right=0.99,
                      bottom=D_LAB / H, top=(D_LAB + D_AX) / H)
PROCGEN, ATARI, LAD = load()
ax_pg, ax_at, ax_ld = (fig.add_subplot(gD[0, i]) for i in range(3))
throughput_panel(ax_pg, PROCGEN, "ProcGen", C_PROCGEN, 40, fs=FS_D)
throughput_panel(ax_at, ATARI, "ALE", C_ALE, 30, fs=FS_D, show_ylabel=False)
ladder_panel(ax_ld, LAD, fs=FS_D,
             labels=["Play-\nwright", "Node.js\n/ V8", "QuickJS\n(PlayTrain)"])
for ax, s in ((ax_pg, "(a)"), (ax_at, "(b)"), (ax_ld, "(c)")):
    fig.text(ax.get_position().x0, (D_LAB + D_AX) / H + 0.005, s,
             ha="left", va="bottom", fontsize=FS_LAB - 1.5, color=INK)
fig.text(0.024, (D_LAB + D_AX) / H + 0.015, "D", fontsize=FS_PANEL,
         fontweight="bold", va="bottom")

fig.savefig(dst, dpi=150, facecolor="white")
print("wrote", dst)
