"""Re-render the v5/v7 generalization tables from the surviving eval CSVs.

The tables only encode *numbers* (per-seed greedy returns + win count), and those
numbers were persisted to outputs/unseen_seed_eval_*.csv -- which survived in git --
so the PNGs can be rebuilt with no checkpoint. Win cells (".. W") are shaded green;
the unseen columns collapse to the farming floor (the "memorizers, not generalizers"
headline). See outputs/notes/sessions/2026-06-06_session.md.

    python tools/recover_gen_tables.py
"""
import csv
from pathlib import Path
import matplotlib.pyplot as plt

WIN = "#bfe3c0"     # win cell
TRAIN = "#eef3f7"   # train column (light)
HEADER = "#0a8c7e"  # teal header, matches the curve figs


def render(csv_path, out_png, title):
    with open(csv_path) as f:
        rows = list(csv.reader(f))
    header, body = rows[0], rows[1:]
    ncols = len(header)

    # widen the checkpoint name column to fit the longest label
    name_w = max(len(r[0]) for r in [header] + body)
    w0 = max(0.18, min(0.42, name_w * 0.011))
    col_widths = [w0] + [(1 - w0) / (ncols - 1)] * (ncols - 1)

    fig, ax = plt.subplots(figsize=(0.95 * ncols + name_w * 0.10 + 1.0,
                                    0.5 * len(body) + 1.4))
    ax.axis("off")
    tbl = ax.table(cellText=body, colLabels=header, cellLoc="center", loc="center",
                   colWidths=col_widths)
    tbl.auto_set_font_size(False)
    tbl.set_fontsize(9)
    tbl.scale(1, 1.5)
    for (r, c), cell in tbl.get_celld().items():
        cell.set_edgecolor("white")
        if r == 0:  # header
            cell.set_facecolor(HEADER)
            cell.set_text_props(color="white", fontweight="bold")
            continue
        txt = cell.get_text().get_text()
        if c == 0:  # checkpoint name column, left-align
            cell.set_text_props(ha="left")
            cell.PAD = 0.04
        if "W" in txt:                       # a win cell
            cell.set_facecolor(WIN)
            cell.set_text_props(fontweight="bold")
        elif c == 1:                          # train column
            cell.set_facecolor(TRAIN)
        elif c == ncols - 1:                  # wins fraction column
            cell.set_facecolor(TRAIN)

    ax.set_title(title, fontsize=13, fontweight="bold", pad=12)
    fig.tight_layout()
    Path(out_png).parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_png, dpi=150, bbox_inches="tight")
    plt.close(fig)
    print("saved", out_png, f"({len(body)} rows)")


render("outputs/unseen_seed_eval_door6x6.csv",
       "outputs/figs/unseen_seed_table.png",
       "door_6x6 · greedy generalization to unseen seeds")

render("outputs/unseen_seed_eval_jun5_6.csv",
       "outputs/figs/unseen_jun5_6/v7_6x6_gen_table.png",
       "v7 6x6 · greedy generalization to unseen seeds")
