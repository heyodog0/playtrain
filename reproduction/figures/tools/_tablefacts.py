import json, math
one = {}
for f in ("outputs/suite_opt_37667723.json", "outputs/suite_opt_37667727.json"):
    d = json.load(open(f))
    one.update({r["game"]: r["sps"] for r in (d.get("rows") or d) if r.get("sps", 0) > 0})
geo = lambda d: math.exp(sum(math.log(v) for v in d.values()) / len(d))
PG = ["plunder","bigfish","bossfight","ninja","starpilot","heist","leaper","maze",
      "dodgeball","jumper","chaser","caveflyer","coinrun","fruitbot","climber","miner"]
print(f"24-game geomean      {geo(one):,.0f}")
print(f"16 ProcGen           {geo({k:v for k,v in one.items() if k in PG}):,.0f}")
print(f" 8 ALE               {geo({k:v for k,v in one.items() if k not in PG}):,.0f}")
for thr in (1_000_000, 1_100_000):
    n = sum(1 for v in one.values() if v >= thr)
    print(f"games >= {thr/1e6:.1f}M      {n} of {len(one)}")
print(f"fastest {max(one, key=one.get)} {max(one.values()):,}")
print(f"slowest {min(one, key=one.get)} {min(one.values()):,}")
print(f"breakout             {one.get('breakout'):,}")
