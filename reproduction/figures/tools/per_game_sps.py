"""Per-game training throughput from the DDP2 suite runs' TB wall-times.

SPS = steps between first and last scalar events / elapsed wall seconds
(steady-state: excludes the compile window before the first event).
Emits a LaTeX table body.
"""
import json
import numpy as np
from tensorboard.backend.event_processing.event_accumulator import EventAccumulator

evals = json.load(open("outputs/eval_iddp_suite.json"))
rows = []
for game, info in sorted(evals.items()):
    d = info["run"]
    try:
        acc = EventAccumulator(f"{d}/tb", size_guidance={"scalars": 0})
        acc.Reload()
        tags = [t for t in acc.Tags()["scalars"] if "return" in t.lower()]
        evs = acc.Scalars(tags[0])
        steps = evs[-1].step - evs[0].step
        secs = evs[-1].wall_time - evs[0].wall_time
        sps = steps / secs
        mins = evs[-1].step / sps / 60.0
        rows.append((game, sps, mins))
        print(f"{game:16s} {sps/1000:7.0f}k SPS   {mins:5.1f} min for {evs[-1].step/1e6:.0f}M")
    except Exception as e:
        print(f"{game}: FAILED {e}")

sps_all = np.array([r[1] for r in rows])
print(f"\ngeomean: {np.exp(np.mean(np.log(sps_all)))/1000:.0f}k   "
      f"min: {sps_all.min()/1000:.0f}k ({rows[int(np.argmin(sps_all))][0]})   "
      f"max: {sps_all.max()/1000:.0f}k ({rows[int(np.argmax(sps_all))][0]})")

print("\n---- LaTeX ----")
half = (len(rows) + 1) // 2
for i in range(half):
    l = rows[i]
    r = rows[i + half] if i + half < len(rows) else None
    left = f"{l[0].replace('_', ' ')} & {l[1]/1000:.0f}k & {l[2]:.1f}"
    right = f"{r[0].replace('_', ' ')} & {r[1]/1000:.0f}k & {r[2]:.1f}" if r else "& &"
    print(f"{left} & {right} \\\\")
