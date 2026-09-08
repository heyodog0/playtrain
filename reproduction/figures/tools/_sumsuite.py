import json, glob, os
for f in sorted(glob.glob("outputs/suite_icnn_ddp2_*.json") + glob.glob("outputs/suite_nat_ddp2_*.json")
                + glob.glob("outputs/suite_icnn_*.json")):
    if "ddp2" not in f and "icnn" not in f:
        continue
    try:
        d = json.load(open(f))
    except Exception:
        continue
    print("%-42s geomean=%9s  ok=%2d/%-2d  failed=%s" % (
        os.path.basename(f), f"{d.get('geomean_sps',0):,}",
        d.get("games_ok", 0), d.get("games_total", 0), d.get("games_failed", "n/a")))
