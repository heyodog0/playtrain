"""Two candidate encodings for participant spread, rendered side by side.

B1: each score / that game's MEDIAN, on a log2 axis. Median because the mean is
    distorted by the outliers the panel exists to show; log2 so 0.5x and 2x sit
    equally far from centre. Zeros are censored and drawn hollow at the edge.
B2: one number per game -- IQR / median -- as a bar. Compact and undistorted,
    but it loses shape, and flappy_bird's shape (bimodal) is the finding.

usage: python plot_spread.py STUDY_DATA_DIR OUT_DIR
"""
import glob
import json
import math
import os
import re
import statistics as st
import sys

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

matplotlib.rcParams.update({'font.size': 8, 'axes.labelsize': 8,
                            'xtick.labelsize': 7, 'ytick.labelsize': 7})
INK, BLUE = '#333333', '#1f77b4'
MIN_START = "2026-08-05T16:52:00Z"
NON_PARTICIPANT = re.compile(
    r'^(probe|playtest|debug|incident|deploycheck|readycheck|smoke|test|anon|final)', re.I)

human = {}
for f in sorted(glob.glob(os.path.join(sys.argv[1], '*.json'))):
    d = json.load(open(f))
    if (NON_PARTICIPANT.match(d.get('participantId', '')) or d.get('partial')
            or not d.get('finishedAt') or d.get('startedAt', '') < MIN_START):
        continue
    for b in d.get('blocks', []):
        g = b.get('game')
        if not g or b.get('practice'):
            continue
        sc = [e['score'] for e in b.get('episodes', []) if not e.get('discarded')]
        if sc:
            human.setdefault(g, []).append(st.mean(sc))

games = sorted(human, key=lambda g: -st.mean(human[g]))
OUT = sys.argv[2]


def iqr(v):
    v = sorted(v)
    n = len(v)
    q1 = st.median(v[:n // 2])
    q3 = st.median(v[(n + 1) // 2:])
    return q3 - q1


fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(7.2, 2.5),
                               gridspec_kw={'width_ratios': [1, 1]})

# ---- B1: median-normalised, log2 -----------------------------------------
order = list(reversed(games))
LOW = 2 ** -4.6                                  # where censored zeros sit
for y, g in enumerate(order):
    v = human[g]
    med = st.median(v)
    xs = [x / med for x in v]
    pos = [x for x in xs if x > 0]
    ax1.plot([min(pos), max(pos)], [y, y], color=INK, lw=0.7, alpha=0.3, zorder=2)
    ax1.plot(pos, [y] * len(pos), 'o', color=INK, ms=3.4, alpha=0.55,
             markeredgecolor='white', markeredgewidth=0.4, zorder=3)
    for _ in [x for x in xs if x == 0]:
        ax1.plot([LOW], [y], 'o', mfc='white', mec=INK, mew=0.9, ms=3.8, zorder=3)
ax1.axvline(1.0, color=INK, lw=1.0, ls='--', zorder=4)
ax1.set_xscale('log', base=2)
ax1.set_xlim(LOW * 0.75, 8)
ax1.set_xticks([0.25, 0.5, 1, 2, 4])
ax1.set_xticklabels(['0.25', '0.5', '1', '2', '4'])
ax1.set_yticks(range(len(order)))
ax1.set_yticklabels(order, fontsize=7)
ax1.set_xlabel('participant score $\\div$ game median  (log$_2$)', fontsize=7.5)
ax1.set_title('B1  median-normalised, log$_2$', fontsize=8, pad=3)
ax1.grid(axis='x', alpha=0.18, lw=0.5)
for sp in ('top', 'right', 'left'):
    ax1.spines[sp].set_visible(False)

# ---- B2: classic boxplot, same median-normalised log2 scale ---------------
data, zeros = [], []
for g in order:
    v = human[g]
    med = st.median(v)
    xs = [x / med for x in v]
    data.append([x for x in xs if x > 0])
    zeros.append(sum(1 for x in xs if x == 0))
bp = ax2.boxplot(data, vert=False, widths=0.55, whis=1.5, patch_artist=True,
                 medianprops=dict(color=INK, lw=1.2),
                 boxprops=dict(facecolor=BLUE, alpha=0.35, edgecolor=INK, lw=0.8),
                 whiskerprops=dict(color=INK, lw=0.8),
                 capprops=dict(color=INK, lw=0.8),
                 flierprops=dict(marker='o', ms=2.8, mfc=INK, mec='none', alpha=0.6))
for y, z in enumerate(zeros, start=1):
    for _ in range(z):
        ax2.plot([LOW], [y], 'o', mfc='white', mec=INK, mew=0.9, ms=3.8, zorder=4)
ax2.axvline(1.0, color=INK, lw=1.0, ls='--', zorder=1)
ax2.set_xscale('log', base=2)
ax2.set_xlim(LOW * 0.75, 8)
ax2.set_xticks([0.25, 0.5, 1, 2, 4])
ax2.set_xticklabels(['0.25', '0.5', '1', '2', '4'])
ax2.set_yticks(range(1, len(order) + 1))
ax2.set_yticklabels([])
ax2.set_xlabel('participant score $\\div$ game median  (log$_2$)', fontsize=7.5)
ax2.set_title('B2  boxplot, same scale', fontsize=8, pad=3)
ax2.grid(axis='x', alpha=0.18, lw=0.5)
for sp in ('top', 'right', 'left'):
    ax2.spines[sp].set_visible(False)

fig.tight_layout(pad=0.4, w_pad=1.4)
for ext in ('pdf', 'png'):
    fig.savefig(f'{OUT}/fig_spread_options.{ext}', bbox_inches='tight',
                dpi=200 if ext == 'png' else None)

print(f"{'game':<13}{'median':>8}{'min/med':>9}{'max/med':>9}{'IQR/med':>9}{'zeros':>7}")
for g in games:
    v = human[g]
    med = st.median(v)
    pos = [x for x in v if x > 0]
    print(f'{g:<13}{med:>8.2f}{min(pos)/med:>9.2f}{max(v)/med:>9.2f}'
          f'{iqr(v)/med:>9.2f}{sum(1 for x in v if x == 0):>7}')
