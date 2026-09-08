"""Attach each run's own measured steady-state sps to the curves JSON, so the
wall-clock axis uses the throughput that run actually achieved rather than a
per-encoder value borrowed from tab:train-throughput."""
import json, statistics as st, sys
from tensorboard.backend.event_processing.event_accumulator import EventAccumulator
path = sys.argv[1]; d = json.load(open(path))
for key in ("curves", "ppo_curves"):
    for g, runs in d.get(key, {}).items():
        for r in runs:
            a = EventAccumulator(f"outputs/{r['run']}/tb", size_guidance={"scalars": 0})
            a.Reload()
            if "charts/sps" not in a.Tags()["scalars"]:
                r["sps"] = None; continue
            v = [e.value for e in a.Scalars("charts/sps") if e.value > 0]
            r["sps"] = st.median(v[len(v)//2:]) if v else None
            print(f"  {key:<11}{g:<13}{r['run']:<24}{r['sps']:>10,.0f}")
json.dump(d, open(path, "w")); print("wrote", path)
