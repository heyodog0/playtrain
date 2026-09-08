from tensorboard.backend.event_processing.event_accumulator import EventAccumulator
import glob, numpy as np

MILES = [10e6, 25e6, 50e6, 75e6, 100e6]

def curve(d, tag="charts/ep_return_mean"):
    fs = glob.glob(f"{d}/tb/**/events*", recursive=True) + glob.glob(f"{d}/tb/events*")
    if not fs: return None
    ea = EventAccumulator(sorted(fs)[-1]); ea.Reload()
    if tag not in ea.Tags().get("scalars", []): return None
    s = ea.Scalars(tag)
    return (np.array([x.step for x in s], float), np.array([x.value for x in s], float))

def at(c, m, w=2e6):
    st, v = c
    sel = (st >= m - w) & (st <= m + w)
    return float(v[sel].mean()) if sel.any() else float("nan")

for g in ["breakout", "plunder", "flappy_bird"]:
    print(f"=== {g} (3-seed mean return at each budget) ===")
    print("%-12s %10s %10s %8s" % ("steps", "base(192)", "768envs", "ratio"))
    for m in MILES:
        bs, ns = [], []
        for seed in [0, 1, 2]:
            cb, cn = curve(f"outputs/pv_p_{g}_s{seed}"), curve(f"outputs/pv_p768_{g}_s{seed}")
            if cb is not None: bs.append(at(cb, m))
            if cn is not None and cn[0].max() > 9e7: ns.append(at(cn, m))
        if bs and ns:
            b, n = np.nanmean(bs), np.nanmean(ns)
            print("%-12s %10.1f %10.1f %8.3f" % (f"{m/1e6:.0f}M", b, n, n / b if b else float("nan")))
    print()
