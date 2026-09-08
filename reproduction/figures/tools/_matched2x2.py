"""1-learner vs 2-learner Nature, compared ONLY on games both measured."""
import ast, json, math, re

def rows_from_json(f):
    d = json.load(open(f))
    return {r["game"]: r["sps"] for r in (d.get("rows") or d) if r.get("sps", 0) > 0}

def rows_from_log(f):
    out = {}
    for l in open(f):
        l = l.strip()
        if l.startswith("{") and "'game'" in l:
            try:
                d = ast.literal_eval(l)
                if d.get("sps", 0) > 0:
                    out[d["game"]] = d["sps"]
            except Exception:
                pass
    return out

one = {}
for f in ("outputs/suite_opt_37667723.json", "outputs/suite_opt_37667727.json"):
    one.update(rows_from_json(f))
two = rows_from_log("logs/nat_ddp2_37717890.out")
two.update(rows_from_log("logs/nat_ddp2_37717892.out"))

def geo(d):
    return math.exp(sum(math.log(v) for v in d.values()) / len(d))

common = sorted(set(one) & set(two))
print(f"games measured under BOTH topologies: {len(common)}\n")
print("%-16s %12s %12s %8s" % ("game", "1 learner", "2 learners", "ratio"))
print("-" * 52)
for g in sorted(common, key=lambda g: two[g] / one[g]):
    print("%-16s %12s %12s %8.3f" % (g, f"{one[g]:,}", f"{two[g]:,}", two[g] / one[g]))
o, t = {g: one[g] for g in common}, {g: two[g] for g in common}
print("-" * 52)
print("%-16s %12s %12s %8.3f" % ("GEOMEAN", f"{geo(o):,.0f}", f"{geo(t):,.0f}", geo(t) / geo(o)))
