import glob, json
from tensorboard.backend.event_processing.event_accumulator import EventAccumulator

P = "outputs/_suite3_curves.json"
rec = json.load(open(P))

def curve(d):
    fs = sorted(glob.glob(d + "/tb/**/events.out*", recursive=True))
    ea = EventAccumulator(fs[-1], size_guidance={"scalars": 0}); ea.Reload()
    tag = [t for t in ea.Tags()["scalars"] if "ep_return_mean" in t][0]
    ev = ea.Scalars(tag)
    return {"x": [e.step for e in ev], "y": [round(float(e.value), 4) for e in ev]}

for net, pre in (("impala", "icnn"), ("nature", "nat")):
    for s in (0, 1, 2):
        d = f"outputs/s3_{pre}_maze_s{s}"
        c = curve(d)
        old = rec["maze"][net][str(s)]
        rec["maze"][net][str(s)] = c
        print(f"{d:28s} n {len(old['x'])}->{len(c['x'])}  "
              f"max {max(old['y']):.2f}->{max(c['y']):.2f}  "
              f"final {old['y'][-1]:.2f}->{c['y'][-1]:.2f}")

json.dump(rec, open(P, "w"))
print("wrote", P)
