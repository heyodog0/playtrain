import json
ab = json.load(open("configs/pt_throughput/pt_pgab_bigfish_playtrain.json"))
sw = json.load(open("configs/pt_throughput/pt_bigfish_nature_fullnode.json"))
print("%-26s %-32s %s" % ("key", "A/B playtrain arm", "suite template"))
print("-" * 92)
for k in sorted(set(ab) | set(sw)):
    a, s = ab.get(k, "<absent>"), sw.get(k, "<absent>")
    if a != s:
        print("%-26s %-32s %s" % (k, a, s))
