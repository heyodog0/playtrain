import json
R = "/n/holylabs/gershman_lab/Users/rtruong"
a = json.load(open(f"{R}/playtrain-trainers/configs/impala_fullnode_throughput.json"))
b = json.load(open("outputs/tpl_suite_icnn_37707781.json"))   # what I actually ran
print("%-24s %-34s %s" % ("key", "348k config", "my icnn run"))
print("-"*92)
for k in sorted(set(a) | set(b)):
    x, y = a.get(k, "<absent>"), b.get(k, "<absent>")
    if x != y:
        print("%-24s %-34s %s" % (k, str(x)[:33], str(y)[:33]))
