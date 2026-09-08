import glob, json
import numpy as np
from tensorboard.backend.event_processing.event_accumulator import EventAccumulator


def tail(tb):
    try:
        acc = EventAccumulator(tb, size_guidance={"scalars": 0})
        acc.Reload()
        tags = [t for t in acc.Tags()["scalars"] if "return" in t.lower()]
        if not tags:
            return None
        evs = acc.Scalars(tags[0])
        if len(evs) < 5:
            return None
        v = [e.value for e in evs]
        s = evs[-1].step
        return "first=%8.1f  last=%8.1f  at %5.1fM" % (
            float(np.mean(v[:10])), float(np.mean(v[-10:])), s / 1e6)
    except Exception:
        return None


for g in ["downwell_fresh", "jump_king", "vvvvvv"]:
    print("--- " + g)
    for cj in glob.glob("outputs/impala_*/config.json"):
        try:
            c = json.load(open(cj))
        except Exception:
            continue
        d = cj.rsplit("/", 1)[0]
        if c.get("game") == g:
            r = tail(d + "/tb")
            if r:
                print("  IMPALA s%s: %s" % (c.get("seed"), r))
    for s in range(3):
        r = tail("outputs/pv_p_%s_s%d/tb" % (g, s))
        if r:
            print("  PPO    s%d: %s" % (s, r))
