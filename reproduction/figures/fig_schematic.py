"""Draft replacement for the PlayTrain schematic.

Corrects the two things the current drawing gets wrong:
  - one QuickJS engine per *environment*, not per batch
  - one observation buffer whose halves belong to two env groups, rather
    than two buffers that swap roles (there is no swap arrow here)

usage: python fig_schematic.py OUT_DIR
"""
import sys

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyArrowPatch, FancyBboxPatch

OUT = sys.argv[1] if len(sys.argv) > 1 else '.'

INK   = '#222222'
BLUE  = ('#cfe0f5', '#3f76ad')      # trainer / group A
POOL  = ('#faeec6', '#c9a227')      # threadpool
ENVA  = ('#dcebf9', '#3f76ad')
ENVB  = ('#fadfc8', '#c4783a')
BUF   = ('#dceedb', '#4e8f4c')
INSET = ('#faf0e6', '#c4783a')
ARROW = '#5b8fc7'

fig, ax = plt.subplots(figsize=(9.2, 5.4))
ax.set_xlim(0, 100); ax.set_ylim(0, 100); ax.axis('off')


def box(x, y, w, h, fc, ec, r=1.6, lw=1.2, z=2):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle=f'round,pad=0,rounding_size={r}',
                                facecolor=fc, edgecolor=ec, linewidth=lw, zorder=z))


def txt(x, y, s, size=9, weight='normal', color=INK, z=4, ha='center', va='center'):
    ax.text(x, y, s, ha=ha, va=va, fontsize=size, fontweight=weight, color=color, zorder=z)


def arrow(x1, y1, x2, y2, color=ARROW, lw=2.2, z=3, style='-|>', mut=14):
    ax.add_patch(FancyArrowPatch((x1, y1), (x2, y2), arrowstyle=style, mutation_scale=mut,
                                 color=color, linewidth=lw, zorder=z,
                                 shrinkA=0, shrinkB=0))


# ---- trainer -------------------------------------------------------------
box(1, 62, 17, 20, *BLUE)
txt(9.5, 74, 'Trainer', size=13, weight='bold')
txt(9.5, 68.5, 'policy + learner', size=8, color='#41556b')

# ---- threadpool ----------------------------------------------------------
box(29, 50, 69, 42, *POOL)
txt(63.5, 88.5, 'C++ threadpool', size=11, weight='bold')
txt(63.5, 84.6, 'T worker threads; no two threads share an interpreter', size=7.4,
    color='#7a6412')

for gi, (gy, gcol, gname) in enumerate([(71.5, ENVA, 'group A'), (58.5, ENVB, 'group B')]):
    txt(33.0, gy + 5.0, gname, size=8, weight='bold', ha='left',
        color=gcol[1])
    for k in range(3):
        x = 43.5 + k * 18.0
        box(x, gy, 16, 10, *gcol, r=1.2, lw=1.0, z=3)
        txt(x + 8, gy + 6.4, 'QuickJS env', size=8, weight='bold', z=4)
        txt(x + 8, gy + 3.0, 'own p5 + rasterizer state', size=6.2, color='#4a4a4a', z=4)

# trainer -> pool, pool -> trainer
arrow(18.5, 76, 28.2, 76)
txt(23.3, 78.6, 'send(group,\nactions)', size=7, color='#41556b')

# ---- observation buffer --------------------------------------------------
box(29, 24, 69, 17, *BUF)
txt(63.5, 38.0, 'one shared observation buffer', size=9.5, weight='bold')
NC = 12
cw = 64.0 / NC
for i in range(NC):
    fc = ENVA[0] if i < NC // 2 else ENVB[0]
    ec = ENVA[1] if i < NC // 2 else ENVB[1]
    box(31.5 + i * cw, 29.6, cw - 0.7, 5.4, fc, ec, r=0.5, lw=0.8, z=3)
txt(47.0, 26.6, "group A's slots", size=7, color=ENVA[1])
txt(80.0, 26.6, "group B's slots", size=7, color=ENVB[1])

# envs write into their own slots
arrow(50, 49.6, 45, 35.4, color=ENVA[1], lw=1.6, mut=11)
arrow(90, 49.6, 86, 35.4, color=ENVB[1], lw=1.6, mut=11)
txt(63.5, 44.4, 'each env writes its own slot', size=7, color='#4a4a4a')

# buffer -> trainer (views, no copy)
ax.add_patch(FancyArrowPatch((28.6, 32.3), (9.5, 32.3), arrowstyle='-|>', mutation_scale=14,
                             color=ARROW, linewidth=2.2, zorder=3, shrinkA=0, shrinkB=0))
arrow(9.5, 32.3, 9.5, 61.4)
txt(16.0, 29.2, 'wait(group) $\\rightarrow$ views, no copy', size=7, color='#41556b')

# alternation note
txt(63.5, 53.4, "groups alternate: one steps while the other's frames are consumed",
    size=7.4, color='#7a6412')

# ---- inset: one env, one step -------------------------------------------
box(1, 3, 97, 17, *INSET)
txt(3.2, 17.0, 'one environment, one step', size=8, weight='bold', ha='left',
    color=INSET[1])
steps = ['load Game.js', 'run one draw()', 'p5 API layer\n(C++)', 'rasterize\n(Rust, integer,\nno anti-aliasing)']
for k, s in enumerate(steps):
    x = 4 + k * 23.5
    box(x, 5, 20, 9, '#ffffff', INSET[1], r=1.0, lw=1.0, z=3)
    txt(x + 10, 9.5, s, size=7.4, z=4)
    if k < 3:
        arrow(x + 20.4, 9.5, x + 23.1, 9.5, color=INSET[1], lw=1.6, mut=11)
# rasterize writes into a slot
arrow(92.5, 14.4, 92.5, 29.2, color=INSET[1], lw=1.6, mut=11, style='-|>')
txt(90.5, 21.8, 'straight into that slot', size=6.8, color=INSET[1], ha='right')

fig.savefig(f'{OUT}/fig_schematic_draft.png', dpi=200, bbox_inches='tight',
            facecolor='white')
fig.savefig(f'{OUT}/fig_schematic_draft.pdf', bbox_inches='tight', facecolor='white')
print('written')
