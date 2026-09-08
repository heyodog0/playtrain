"""Human-study figures.

usage: python plot_human.py <study-data-dir> <out-dir>
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

matplotlib.rcParams.update({
    'font.size': 9, 'axes.labelsize': 9,
    'xtick.labelsize': 8, 'ytick.labelsize': 8,
})

BLUE, INK = '#1f77b4', '#333333'
CAP_FRAMES = 2000
# study-stats.mjs TCRIT table and fallback, replicated so numbers match
TCRIT = {1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365,
         8: 2.306, 9: 2.262, 10: 2.228, 12: 2.179, 15: 2.131, 19: 2.093,
         24: 2.064, 29: 2.045}
tcrit = lambda df: TCRIT.get(df, 1.96 if df > 29 else 2.045)
# flappy_bird rules changed in 65cbe24 (deployed 2026-08-05T16:52:00Z); sessions before
# it played a different game, so only post-update participants are included.
MIN_START = "2026-08-05T16:52:00Z"
NON_PARTICIPANT = re.compile(
    r'^(probe|playtest|debug|incident|deploycheck|readycheck|smoke|test|anon|final)', re.I)

by_game = {}
for f in sorted(glob.glob(os.path.join(sys.argv[1], '*.json'))):
    d = json.load(open(f))
    pid = d.get('participantId', '')
    if (NON_PARTICIPANT.match(pid) or d.get('partial')
            or not d.get('finishedAt') or d.get('startedAt', '') < MIN_START):
        continue
    for b in d.get('blocks', []):
        g = b.get('game')
        if not g or b.get('practice'):
            continue
        sc = [e['score'] for e in b.get('episodes', []) if not e.get('discarded')]
        if sc:
            by_game.setdefault(g, []).append(sc)

stats = {}
for g, rows in by_game.items():
    means = [st.mean(s) for s in rows]
    n = len(means)
    sd = st.stdev(means) if n > 1 else 0.0
    fs, ls = [], []
    for s in rows:
        if len(s) < 3:
            continue
        k = max(1, len(s) // 3)
        fs.append(st.mean(s[:k]))
        ls.append(st.mean(s[-k:]))
    first, last = (st.mean(fs), st.mean(ls)) if fs else (None, None)
    stats[g] = dict(n=n, mean=st.mean(means), ci=tcrit(n - 1) * sd / math.sqrt(n),
                    means=sorted(means), first=first, last=last,
                    pct=(100 * (last - first) / first) if first else None,
                    n3=len(fs))

OUT = sys.argv[2]

# ---- figure 1: per-game baseline, one dot per participant -------------------
games = sorted(stats, key=lambda g: -stats[g]['mean'])
fig, axes = plt.subplots(2, 4, figsize=(7.0, 3.5))
for ax, g in zip(axes.flat, games):
    s = stats[g]
    v, n, m, ci = s['means'], s['n'], s['mean'], s['ci']
    ax.axhspan(m - ci, m + ci, color=INK, alpha=0.10, lw=0, zorder=1)
    ax.axhline(m, color=INK, lw=1.1, zorder=2)
    ax.plot(range(1, n + 1), v, 'o', color=BLUE, ms=4.5, alpha=0.85,
            markeredgecolor='white', markeredgewidth=0.6, zorder=3)
    ax.set_title(f'{g}  ' + r'$\bar{x}$=' + f'{m:.3g}', fontsize=8.5, pad=3)
    ax.set_xlim(0.2, n + 0.8)
    ax.set_xticks([])
    ax.set_ylim(min(0, min(v)) - 0.03 * max(v), max(v) * 1.10)
    ax.grid(axis='y', alpha=0.18, lw=0.5)
    for sp in ('top', 'right', 'bottom'):
        ax.spines[sp].set_visible(False)
for ax in list(axes.flat)[len(games):]:
    ax.set_visible(False)
for r in (0, 1):
    axes[r][0].set_ylabel('score')
for c in range(4):
    axes[1][c].set_xlabel('participants, ranked', fontsize=7.5, labelpad=1)
fig.tight_layout(pad=0.4, w_pad=1.0, h_pad=1.1)
for ext in ('pdf', 'png'):
    fig.savefig(f'{OUT}/fig_human_baseline.{ext}', bbox_inches='tight',
                dpi=200 if ext == 'png' else None)
plt.close(fig)

# ---- figure 2: within-block change -----------------------------------------
order = sorted((g for g in stats if stats[g]['pct'] is not None),
               key=lambda g: stats[g]['pct'])
fig, ax = plt.subplots(figsize=(5.0, 2.8))
ys = range(len(order))
vals = [stats[g]['pct'] for g in order]
ax.barh(list(ys), vals, height=0.62, color=BLUE, alpha=0.9, zorder=3)
ax.axvline(0, color=INK, lw=0.9, zorder=4)
for y, g in zip(ys, order):
    s = stats[g]
    ax.text(s['pct'] + max(vals) * 0.015, y,
            f"{s['first']:.3g}$\\rightarrow${s['last']:.3g}",
            va='center', ha='left', fontsize=7, color='0.35')
ax.set_yticks(list(ys))
ax.set_yticklabels(order)
ax.set_xlabel('change in score, first third of rounds to last (%)')
ax.set_xlim(min(0, min(vals)) - 12, max(vals) * 1.30)
ax.grid(axis='x', alpha=0.18, lw=0.5)
for sp in ('top', 'right', 'left'):
    ax.spines[sp].set_visible(False)
fig.tight_layout(pad=0.4)
for ext in ('pdf', 'png'):
    fig.savefig(f'{OUT}/fig_human_learning.{ext}', bbox_inches='tight',
                dpi=200 if ext == 'png' else None)

print(f"{'game':<14}{'n':>3}{'mean':>9}{'CI':>8}{'first':>8}{'last':>8}{'chg':>7}")
for g in games:
    s = stats[g]
    print(f"{g:<14}{s['n']:>3}{s['mean']:>9.3g}{s['ci']:>8.3g}"
          f"{s['first']:>8.3g}{s['last']:>8.3g}{s['pct']:>6.0f}%")
