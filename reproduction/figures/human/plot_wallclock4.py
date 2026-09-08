"""Two-panel human figure.

(A) agent training vs 100 s of human play on a shared wall-clock axis, per game.
(B) how much participants differ, each score divided by that game's human mean so
    the eight spreads are comparable on one axis. Kept out of (A) because a raw
    range band covers whole panels on asteroids and breakout.

usage: python plot_wallclock4.py CURVES.json STUDY_DATA_DIR OUT_DIR
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
from matplotlib.lines import Line2D
from matplotlib.ticker import LogLocator, NullFormatter

matplotlib.rcParams.update({'font.size': 8, 'axes.labelsize': 8,
                            'xtick.labelsize': 7, 'ytick.labelsize': 7})

C_IMPALA, C_PPO, C_HUMAN = '#1f77b4', '#ff7f0e', '#333333'
SPS = {'impala': 348_000, 'nature': 980_000}
HUMAN_SECONDS = 100
NBINS = 70
MIN_START = "2026-08-05T16:52:00Z"
TCRIT = {1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365,
         8: 2.306, 9: 2.262, 10: 2.228, 12: 2.179, 15: 2.131, 19: 2.093,
         24: 2.064, 29: 2.045}
tcrit = lambda df: TCRIT.get(df, 1.96 if df > 29 else 2.045)
NON_PARTICIPANT = re.compile(
    r'^(probe|playtest|debug|incident|deploycheck|readycheck|smoke|test|anon|final)', re.I)

curves = json.load(open(sys.argv[1]))
DATA, OUT = sys.argv[2], sys.argv[3]

human = {}
for f in sorted(glob.glob(os.path.join(DATA, '*.json'))):
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


def band(runs):
    sps = st.median([r['sps'] for r in runs if r.get('sps')] or [SPS['impala']])
    top = max(r['step'][-1] for r in runs)
    per = []
    for r in runs:
        acc = [[] for _ in range(NBINS)]
        for s_, v in zip(r['step'], r['value']):
            acc[min(int(s_ / top * NBINS), NBINS - 1)].append(v)
        vals, last = [], None
        for bk in acc:
            if bk:
                last = sum(bk) / len(bk)
            vals.append(last)
        per.append(vals)
    xs, mean, lo, hi = [], [], [], []
    for i in range(NBINS):
        col = [p[i] for p in per if p[i] is not None]
        if col:
            xs.append((i + 0.5) * top / NBINS / sps)
            mean.append(sum(col) / len(col)); lo.append(min(col)); hi.append(max(col))
    return xs, mean, lo, hi


games = [g for g in curves['curves'] if g in human]
games.sort(key=lambda g: -st.mean(human[g]))

fig = plt.figure(figsize=(7.6, 2.9))
gs = fig.add_gridspec(2, 5, width_ratios=[1, 1, 1, 1, 2.05], hspace=0.55, wspace=0.38)

for i, g in enumerate(games):
    ax = fig.add_subplot(gs[i // 4, i % 4])
    hv = human[g]
    hm = st.mean(hv)
    hci = tcrit(len(hv) - 1) * st.stdev(hv) / math.sqrt(len(hv))
    ax.axhspan(hm - hci, hm + hci, color=C_HUMAN, alpha=0.13, lw=0, zorder=1)
    ax.axhline(hm, color=C_HUMAN, lw=1.1, ls='--', zorder=5)
    tops, bots, xmax, xmin = [hm + hci], [0.0], [0.0], []
    for key, mkey, col in (('curves', 'meta', C_IMPALA), ('ppo_curves', 'ppo_meta', C_PPO)):
        runs = curves.get(key, {}).get(g)
        if not runs:
            continue
        secs, mean, lo, hi = band(runs)
        if len(runs) > 1:
            ax.fill_between(secs, lo, hi, color=col, alpha=0.15, lw=0, zorder=2)
        ax.plot(secs, mean, color=col, lw=1.3, zorder=3)
        tops.append(max(hi)); bots.append(min(lo))
        xmax.append(max(secs)); xmin.append(min(x for x in secs if x > 0))
    ax.set_title(g, fontsize=7.5, pad=2)
    ax.set_xscale('log')
    ax.set_xlim(min(xmin) * 0.8 if xmin else 1, max(xmax) * 1.3)
    ax.set_ylim(min(0, min(bots)), max(tops) * 1.10)
    ax.xaxis.set_major_locator(LogLocator(base=10, numticks=4))
    ax.xaxis.set_minor_formatter(NullFormatter())
    ax.tick_params(axis='both', labelsize=6.5, pad=1.5)
    ax.grid(alpha=0.18, lw=0.5)
    for sp in ('top', 'right'):
        ax.spines[sp].set_visible(False)
    if i % 4 == 0:
        ax.set_ylabel('return', fontsize=7)


# ---- (B) participant spread: boxplot, each score / that game's median ------
# Median rather than mean: the mean is pulled by the outliers this panel exists
# to show. log2 so 0.5x and 2x sit equally far from centre.
axb = fig.add_subplot(gs[:, 4])
order = list(reversed(games))
LOW = 0.047        # off-scale glyph sits at the axis edge, clear of any whisker
data, zeros = [], []
for g in order:
    hv = human[g]
    med = st.median(hv)
    xs = [v / med for v in hv]
    data.append([x for x in xs if x > 0])
    zeros.append(sum(1 for x in xs if x == 0))
axb.boxplot(data, vert=False, widths=0.62, whis=1.5, patch_artist=True,
            medianprops=dict(color=C_HUMAN, lw=1.2),
            boxprops=dict(facecolor=C_IMPALA, alpha=0.30, edgecolor=C_HUMAN, lw=0.8),
            whiskerprops=dict(color=C_HUMAN, lw=0.8),
            capprops=dict(color=C_HUMAN, lw=0.8),
            flierprops=dict(marker='o', ms=2.6, mfc=C_HUMAN, mec='none', alpha=0.6))
for y, z in enumerate(zeros, start=1):
    for _ in range(z):
        # small hollow circle = participant scored zero, off the log axis
        axb.plot([LOW], [y], marker='o', mfc='white', mec=C_HUMAN, mew=0.8,
                 ms=2.8, ls='none', zorder=5, clip_on=False)
axb.axvline(1.0, color=C_HUMAN, lw=1.0, ls='--', zorder=1)
axb.set_xscale('log', base=2)
axb.set_xlim(0.043, 7.5)
axb.set_xticks([0.25, 1, 4])
axb.set_xticklabels(['0.25', '1', '4'])
axb.set_xticks([0.125, 0.5, 2], minor=True)
axb.xaxis.set_minor_formatter(NullFormatter())
axb.tick_params(axis='x', which='minor', length=2.5)
axb.set_yticks(range(1, len(order) + 1))
axb.set_yticklabels(order, fontsize=7)
axb.yaxis.tick_right()
axb.set_xlabel('participant score $\\div$ game median  (log$_2$)', fontsize=7)
axb.grid(axis='x', alpha=0.18, lw=0.5)
for sp in ('top', 'right', 'left'):
    axb.spines[sp].set_visible(False)
axb.tick_params(axis='y', length=0, pad=1)

# one centred x label for panel A, following fig:learning's lead
fig.text(0.36, 0.035, 'training wall-clock (s)', ha='center', fontsize=7.5)
fig.legend(handles=[Line2D([], [], color=C_IMPALA, lw=1.5, label='IMPALA'),
                    Line2D([], [], color=C_PPO, lw=1.5, label='PPO'),
                    Line2D([], [], color=C_HUMAN, lw=1.2, ls='--',
                           label='human (100 s of play)')],
           loc='upper center', ncol=3, frameon=False, fontsize=7.5,
           bbox_to_anchor=(0.40, 1.03))
fig.text(0.005, 0.985, 'A', fontsize=10, fontweight='bold', va='top')
fig.text(0.678, 0.985, 'B', fontsize=10, fontweight='bold', va='top')
fig.subplots_adjust(top=0.86, bottom=0.145, left=0.07, right=0.905)
for ext in ('pdf', 'png'):
    fig.savefig(f'{OUT}/fig_wide.{ext}', bbox_inches='tight',
                dpi=200 if ext == 'png' else None)

print(f"{'game':<13}{'human':>8}{'min/mean':>10}{'max/mean':>10}{'spread':>9}")
for g in games:
    hv = human[g]; m = st.mean(hv)
    print(f'{g:<13}{m:>8.1f}{min(hv)/m:>10.2f}{max(hv)/m:>10.2f}{max(hv)/max(min(hv),1e-9):>8.0f}x')
