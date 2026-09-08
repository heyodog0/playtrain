import json, glob, math, os
for f in sorted(glob.glob("outputs/sweep_w*_b256_*.json")):
    d = json.load(open(f))
    rows = d if isinstance(d, list) else (d.get("rows") or d.get("results") or d.get("games") or [])
    if not rows:
        print(os.path.basename(f), "-> unparsed:", str(d)[:150]); continue
    items = {}
    for r in rows:
        if isinstance(r, dict) and "game" in r and "sps" in r:
            items[r["game"]] = r["sps"]
    if not items:
        print(os.path.basename(f), "-> no game/sps:", str(rows)[:150]); continue
    g = math.exp(sum(math.log(v) for v in items.values()) / len(items))
    print("%-40s geomean %9s   %s" % (os.path.basename(f), f"{g:,.0f}",
          "  ".join(f"{k}={v:,}" for k, v in sorted(items.items()))))
