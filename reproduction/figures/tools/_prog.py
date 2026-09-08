import glob, os, time
from tensorboard.backend.event_processing.event_accumulator import EventAccumulator
now = time.time()
for d in sorted(glob.glob("outputs/_rerun/rr_ppo_*")):
    if "_nature_" in d: continue
    fs = glob.glob(f"{d}/tb/**/events*", recursive=True) or glob.glob(f"{d}/tb/events*")
    if not fs: continue
    f = sorted(fs)[-1]
    age = (now - os.path.getmtime(f)) / 60
    try:
        ea = EventAccumulator(f); ea.Reload()
        tags = ea.Tags().get("scalars", [])
        t = next((x for x in ("charts/sps","charts/ep_return_mean") if x in tags), None)
        if not t: continue
        s = ea.Scalars(t)
        step = s[-1].step
        sps = ea.Scalars("charts/sps")[-1].value if "charts/sps" in tags else None
        eta = (100e6 - step) / sps / 60 if sps else None
        print("%-34s step=%11s  sps=%7s  %5.1f%%  eta=%5.0f min  (log %.0fm old)" % (
            os.path.basename(d), f"{step:,}", f"{int(sps):,}" if sps else "?",
            100*step/1e8, eta if eta else -1, age))
    except Exception as e:
        print(f"{os.path.basename(d)}: {e}")
