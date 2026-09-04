# E0 summary table from out/e0_<job>/buckets_{fut,fork}_<game>.txt
#   python e0_summary.py <outd> <games...>
import re, sys, os
outd, games = sys.argv[1], sys.argv[2:]
def load(a, g):
    p = f"{outd}/buckets_{a}_{g}.txt"
    if not os.path.exists(p): return {}, {}
    B, F, sec = {}, {}, None
    for line in open(p):
        if line.startswith("== buckets"): sec = "b"; continue
        if line.startswith("== opcode families"): sec = "f"; continue
        if line.startswith("=="): sec = None; continue
        m = re.match(r"\s+(.+?)\s+([\d.]+)%\s+([\d.]+)%", line)
        if sec == "b" and m: B[m.group(1).strip()] = float(m.group(2))
        m2 = re.match(r"\s+([\d.]+)%\s+(.+)$", line)
        if sec == "f" and m2: F[m2.group(2).strip()] = float(m2.group(1))
    return B, F
order = ["AOT residual", "interp dispatch", "vec host spin", "property access", "refcount/free", "arith slow paths", "conversions", "strict_eq/str-cmp",
         "call machinery", "array ops", "gc/alloc", "atoms/strings", "math (fm/libm)", "rasterizer", "p5/host/blit", "other"]
for a in ("fut", "fork"):
    data = {g: load(a, g) for g in games}
    print(f"\n{a}: % of .so samples")
    print("%-20s" % "bucket" + "".join("%10s" % g[:9] for g in games))
    for b in order:
        row = [data[g][0].get(b, 0.0) for g in games]
        if any(row): print("%-20s" % b + "".join("%10.1f" % v for v in row))
    if a == "fut":
        print("%-20s" % "-- opcode families")
        fams = sorted({k for g in games for k in data[g][1]})
        for f in fams:
            print("%-20s" % f[:20] + "".join("%10.1f" % data[g][1].get(f, 0.0) for g in games))
