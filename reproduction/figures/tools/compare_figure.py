"""Compare a redrawn figure with the file the paper includes.

Pixel by pixel first (PDFs rasterized at 150 dpi). When pixels differ on a PDF,
compare the plotted paths themselves: the same paths in the same order, with
the same colours and widths, each within 1.5 pt of the paper's (bounding box,
since matplotlib's path simplification can drop a point when the layout shifts).
That separates a different curve from a shift of the whole layout.

    python tools/compare_figure.py REDRAWN PAPER_FILE
"""
import sys
import numpy as np


def raster(path):
    if path.endswith(".pdf"):
        import pymupdf
        pix = pymupdf.open(path)[0].get_pixmap(dpi=150)
        return np.frombuffer(pix.samples, np.uint8).reshape(pix.h, pix.w, pix.n)[..., :3].astype(int)
    from PIL import Image
    return np.asarray(Image.open(path).convert("RGB")).astype(int)


def paths(path):
    import pymupdf
    out = []
    for d in pymupdf.open(path)[0].get_drawings():
        pts = [(p.x, p.y) for it in d["items"] if it[0] == "l" for p in (it[1], it[2])]
        if pts:
            out.append((d.get("color"), d.get("width"), np.array(pts)))
    return out


new_f, paper_f = sys.argv[1], sys.argv[2]
name = paper_f.rsplit("/", 1)[-1]
new, paper = raster(new_f), raster(paper_f)
if new.shape == paper.shape:
    d = np.abs(new - paper).sum(-1)
    n, strong = int((d > 0).sum()), int((d > 60).sum())
    print(f"    vs paper {name}: {n} of {d.size} pixels differ ({strong} visibly)")
    if strong == 0:
        sys.exit(0)
else:
    print(f"    vs paper {name}: size differs ({paper.shape[1]}x{paper.shape[0]} vs {new.shape[1]}x{new.shape[0]})")
if not new_f.endswith(".pdf"):
    sys.exit(1)
A, B = paths(new_f), paths(paper_f)
same = len(A) == len(B) and all(ca == cb and wa == wb for (ca, wa, _), (cb, wb, _) in zip(A, B))
off = 0.0
for (_, _, pa), (_, _, pb) in zip(A, B):
    box = lambda q: np.array([q[:, 0].min(), q[:, 1].min(), q[:, 0].max(), q[:, 1].max()])
    off = max(off, float(np.abs(box(pa) - box(pb)).max()))
print(f"    plotted paths: {len(A)} vs {len(B)}, same colours/widths: {same}, "
      f"largest shift {off:.2f} pt")
sys.exit(0 if same and off <= 1.5 else 1)
