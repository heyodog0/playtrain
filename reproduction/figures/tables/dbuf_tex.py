import glob, os
import json
_D = os.environ.get('T1A_DATA') or os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
import numpy as np

rows = []
for f in sorted(glob.glob(_D + "/dbuf_t3_44861569_*.json")):
    d = json.load(open(f))
    rows.append((d["games"], d["arms"]["a4"]["geomean_sps"],
                 d["arms"]["a3"]["geomean_sps"], d["a4_over_a3_geomean"]))
rows.sort(key=lambda r: -r[3])


def fmt(v):
    return "%.2fM" % (v / 1e6) if v >= 1e6 else "%dk" % round(v / 1e3)


for g, a4, a3, r in rows:
    print("\\texttt{%s} & %s & %s & %.2f$\\times$ \\\\" % (
        g.replace("_", "\\_"), fmt(a4), fmt(a3), r))
rs = np.array([r[3] for r in rows])
gd = np.exp(np.mean(np.log([r[1] for r in rows])))
gs = np.exp(np.mean(np.log([r[2] for r in rows])))
print("\\midrule")
print("geometric mean & %s & %s & \\textbf{%.2f}$\\times$ \\\\" % (
    fmt(gd), fmt(gs), np.exp(np.log(rs).mean())))
print("%% median %.3f  n=%d  range %.3f-%.3f  below 1.0: %s" % (
    np.median(rs), len(rs), rs.min(), rs.max(),
    ", ".join(r[0] for r in rows if r[3] < 1.0)))
