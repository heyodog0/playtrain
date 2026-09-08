"""What would the 24-game geomean be if the env-bound games were lifted?"""
import json, math
one = {}
for f in ("outputs/suite_opt_37667723.json", "outputs/suite_opt_37667727.json"):
    d = json.load(open(f))
    one.update({r["game"]: r["sps"] for r in (d.get("rows") or d) if r.get("sps", 0) > 0})

geo = lambda d: math.exp(sum(math.log(v) for v in d.values()) / len(d))
print(f"uniform one-node, {len(one)} games: geomean {geo(one):,.0f}\n")

slow = sorted(one.items(), key=lambda x: x[1])
print("the drag (slowest 8):")
for g, v in slow[:8]:
    print(f"   {g:16s} {v:>10,}")

CEIL = 1_060_000          # the learner-bound ceiling the fast games sit at
for n in (2, 4, 6, 8):
    lifted = dict(one)
    for g, _ in slow[:n]:
        lifted[g] = CEIL
    print(f"\nlift slowest {n} to the {CEIL:,} ceiling -> geomean {geo(lifted):,.0f}"
          f"  ({geo(lifted)/geo(one):.3f}x)")

need = 1_000_000
print(f"\nto clear {need:,} the geomean must rise {need/geo(one):.3f}x")
