"""IMPALA final return, Nature vs IMPALA-CNN, on the 8 human-study games."""
import glob, statistics as st
from tensorboard.backend.event_processing.event_accumulator import EventAccumulator
GAMES = ["asteroids","vvvvvv","breakout","seaquest","coinrun","caveflyer","plunder","flappy_bird"]
HUMAN = {"asteroids":652.2,"vvvvvv":297.0,"breakout":242.2,"seaquest":142.5,
         "coinrun":79.0,"caveflyer":9.3,"plunder":5.3,"flappy_bird":4.0}

def final(d):
    fs = glob.glob(f"{d}/tb/**/events*", recursive=True) or glob.glob(f"{d}/tb/events*")
    if not fs: return None
    ea = EventAccumulator(sorted(fs)[-1]); ea.Reload()
    tags = ea.Tags().get("scalars", [])
    t = next((x for x in ("charts/ep_return_mean","episode_return") if x in tags), None)
    if not t: return None
    s = ea.Scalars(t)
    n = max(1, len(s)//20)
    return st.mean(x.value for x in s[-n:])

print("%-13s %8s | %10s %10s | %s" % ("game","human","nature","impalaCNN","crosses human?"))
print("-"*74)
for g in GAMES:
    nat = [v for v in (final(f"outputs/_rerun/rr_impala_{g}_s{s}") for s in (0,1,2)) if v is not None]
    icn = [v for v in (final(f"outputs/_rerun/rr_impalacnn_{g}_s{s}") for s in (0,1,2)) if v is not None]
    mn = st.mean(nat) if nat else float("nan")
    mi = st.mean(icn) if icn else float("nan")
    h = HUMAN[g]
    mark = ("nature " if mn >= h else "       ") + ("icnn" if mi >= h else "    ")
    print("%-13s %8.1f | %10.1f %10.1f | %s" % (g, h, mn, mi, mark))
