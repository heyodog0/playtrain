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
print("game              double(a4)   single(a3)   ratio")
for g, a4, a3, r in rows:
    print("%-16s %11s %12s   %5.3f" % (g, format(int(a4), ","), format(int(a3), ","), r))
rs = np.array([r[3] for r in rows])
print("\nn=%d  geomean=%.4f  median=%.3f  min=%.3f (%s)  max=%.3f (%s)" % (
    len(rs), np.exp(np.log(rs).mean()), np.median(rs),
    rs.min(), rows[-1][0], rs.max(), rows[0][0]))
print("arm geomeans: double=%s  single=%s" % (
    format(int(np.exp(np.mean(np.log([r[1] for r in rows])))), ","),
    format(int(np.exp(np.mean(np.log([r[2] for r in rows])))), ",")))
print("below 1.0: %s" % [r[0] for r in rows if r[3] < 1.0])
