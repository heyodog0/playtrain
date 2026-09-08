"""Dump episode-return curves from run tb/ dirs to one JSON.

Usage: python tools/extract_tb_curves.py OUT.json RUN_DIR [RUN_DIR ...]
Each RUN_DIR must contain tb/ (event files) and config.json.
"""
import json, sys, os
from tensorboard.backend.event_processing.event_accumulator import EventAccumulator

out_path, run_dirs = sys.argv[1], sys.argv[2:]
result = {}
for rd in run_dirs:
    tb = os.path.join(rd, "tb")
    if not os.path.isdir(tb):
        print("skip (no tb):", rd); continue
    acc = EventAccumulator(tb, size_guidance={"scalars": 0})
    acc.Reload()
    tags = acc.Tags()["scalars"]
    ret_tags = [t for t in tags if "return" in t.lower()]
    cfg = {}
    cfgp = os.path.join(rd, "config.json")
    if os.path.exists(cfgp):
        cfg = json.load(open(cfgp))
    entry = {"game": cfg.get("game"), "total_steps": cfg.get("total_steps"),
             "tags": tags, "series": {}}
    for t in ret_tags:
        evs = acc.Scalars(t)
        entry["series"][t] = [[e.step, e.value] for e in evs]
    result[os.path.basename(rd.rstrip("/"))] = entry
    n = {t: len(v) for t, v in entry["series"].items()}
    print(rd, "->", n)
json.dump(result, open(out_path, "w"))
print("wrote", out_path)
