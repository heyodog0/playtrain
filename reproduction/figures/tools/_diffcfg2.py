import json
R = "/n/holylabs/gershman_lab/Users/rtruong"
ab = json.load(open(f"{R}/playtrain-trainers/configs/pt_throughput/pt_pgab_bigfish_playtrain.json"))
sw = json.load(open(f"{R}/analogen-jaxbench/configs/pt_throughput/pt_bigfish_nature_fullnode.json"))
print("%-26s %-34s %s" % ("key", "A/B playtrain arm", "suite template (headline)"))
print("-" * 96)
for k in sorted(set(ab) | set(sw)):
    a, s = ab.get(k, "<absent>"), sw.get(k, "<absent>")
    if a != s:
        print("%-26s %-34s %s" % (k, a, s))
