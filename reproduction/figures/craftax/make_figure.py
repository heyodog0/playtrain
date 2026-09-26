"""fig:craftax_views, step 2: the 2x4 grid, top-down vs first-person at four steps.

Reads frames/{craftax_classic,craftax_fp}_scripted_s2.npy (from collect_frames.py,
seed 2). The steps were picked by eye from that episode; a different seed needs
new ones.

    uv run --no-project --with matplotlib --with numpy python make_figure.py FRAMES_DIR OUT_STEM
"""
import sys, numpy as np, matplotlib
matplotlib.use("pdf")
import matplotlib.pyplot as plt
frames, out = sys.argv[1], sys.argv[2]
T = (1, 121, 157, 255)
COLS = ["Step 1", "Step 121", "Step 157 (dusk)", "Step 255 (night)"]
ROWS = [("craftax_classic", "Top-down\n(Craftax-Classic)"), ("craftax_fp", "First-person")]
plt.rcParams.update({"font.family": "serif", "font.serif": ["Times New Roman", "Times", "STIXGeneral"],
                     "mathtext.fontset": "stix", "font.size": 9, "pdf.fonttype": 42})
fig, axes = plt.subplots(2, 4, figsize=(5.5, 2.95), gridspec_kw=dict(wspace=0.04, hspace=0.06))
for r, (g, label) in enumerate(ROWS):
    a = np.load(f"{frames}/{g}_scripted_s2.npy")
    for c, t in enumerate(T):
        ax = axes[r, c]
        ax.imshow(a[t].repeat(8, 0).repeat(8, 1), interpolation="none")
        ax.set_xticks([]); ax.set_yticks([])
        for s in ax.spines.values(): s.set_linewidth(0.5)
        if r == 0: ax.set_title(COLS[c], fontsize=9, pad=3)
        if c == 0: ax.set_ylabel(label, fontsize=9, labelpad=4)
fig.savefig(f"{out}.pdf", bbox_inches="tight", pad_inches=0.02)
fig.savefig(f"{out}.png", bbox_inches="tight", pad_inches=0.02, dpi=300)
