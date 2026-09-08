from tensorboard.backend.event_processing.event_accumulator import EventAccumulator
import glob, math, numpy as np

def final_ret(d, tag="charts/ep_return_mean", frac=0.05):
    fs = glob.glob(f"{d}/tb/**/events*", recursive=True) + glob.glob(f"{d}/tb/events*")
    if not fs: return None, None
    ea = EventAccumulator(sorted(fs)[-1]); ea.Reload()
    if tag not in ea.Tags().get("scalars", []): return None, None
    s = ea.Scalars(tag)
    if not s: return None, None
    n = max(1, int(len(s) * frac))
    return float(np.mean([x.value for x in s[-n:]])), s[-1].step

print("%-12s %-8s %12s %12s %8s" % ("game", "seed", "baseline(192)", "768envs", "ratio"))
print("-" * 60)
allr = []
for g in ["breakout", "plunder", "flappy_bird"]:
    gb, gn = [], []
    for seed in [0, 1, 2]:
        b, bs = final_ret(f"outputs/pv_p_{g}_s{seed}")
        n, ns = final_ret(f"outputs/pv_p768_{g}_s{seed}")
        ok = (b is not None and n is not None and ns and ns > 9e7)
        r = (n / b) if (ok and b) else None
        print("%-12s %-8s %12s %12s %8s" % (
            g, seed,
            f"{b:,.1f}" if b else "-",
            f"{n:,.1f}" if n else "-",
            f"{r:.3f}" if r else ("incomplete" if n else "-")))
        if ok: gb.append(b); gn.append(n)
    if gb:
        mb, mn = float(np.mean(gb)), float(np.mean(gn))
        print("%-12s %-8s %12s %12s %8s  <- 3-seed mean" % (
            g, "MEAN", f"{mb:,.1f}", f"{mn:,.1f}", f"{mn/mb:.3f}"))
        allr.append(mn / mb)
    print()
if allr:
    print("geomean of per-game mean ratios: %.3f" % math.exp(sum(map(math.log, allr)) / len(allr)))
