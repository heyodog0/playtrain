import json, sys
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt

rows = sorted(json.load(open(sys.argv[1])), key=lambda r: r['workers'])
w = [r['workers'] for r in rows]
d = [r['decisions_per_s'] / 1e6 for r in rows]
thr = rows[0].get('env_threads', 5) + 1
ideal = [d[0] * x / w[0] for x in w]

fig, ax = plt.subplots(figsize=(4.4, 2.7))
ax.plot(w, ideal, '--', color='0.65', lw=1.2, label='ideal linear', zorder=1)
ax.plot(w, d, 'o-', color='#1f77b4', lw=1.8, ms=5, label='measured', zorder=3)
ax.axvline(92 // thr, color='0.55', lw=0.9, ls='-.', zorder=2)
ax.set_xlabel('workers')
ax.set_ylabel('env-steps/s (millions)')
ax.set_xticks([1, 4, 8, 12, 16])
ax.set_xlim(0, 17); ax.set_ylim(0, max(d) * 1.1)
ax.grid(alpha=0.2, lw=0.5)
for s in ('top', 'right'): ax.spines[s].set_visible(False)
ax.legend(frameon=False, fontsize=8, loc='upper left')
fig.tight_layout(pad=0.3)
fig.savefig(sys.argv[2], bbox_inches='tight')
print('wrote', sys.argv[2])
