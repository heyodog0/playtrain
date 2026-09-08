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


def name(g):
    return g.replace("_", "\\_")


half = len(rows) // 2
left, right = rows[:half], rows[half:]
print("\\begin{tabular}{@{}lrrr@{\\hskip 1.6em}lrrr@{}}")
print("\\toprule")
print("Game & Double & Single & Ratio & Game & Double & Single & Ratio \\\\")
print("\\midrule")
for (gl, dl, sl, rl), (gr, dr, sr, rr) in zip(left, right):
    print("%s & %s & %s & %.2f$\\times$ & %s & %s & %s & %.2f$\\times$ \\\\" % (
        name(gl), fmt(dl), fmt(sl), rl, name(gr), fmt(dr), fmt(sr), rr))
rs = np.array([r[3] for r in rows])
gd = np.exp(np.mean(np.log([r[1] for r in rows])))
gs = np.exp(np.mean(np.log([r[2] for r in rows])))
print("\\midrule")
print("geometric mean & %s & %s & \\textbf{%.2f}$\\times$ & "
      "\\multicolumn{4}{r@{}}{median %.2f$\\times$, range %.2f--%.2f$\\times$} \\\\" % (
          fmt(gd), fmt(gs), np.exp(np.log(rs).mean()),
          np.median(rs), rs.min(), rs.max()))
print("\\bottomrule")
print("\\end{tabular}")
