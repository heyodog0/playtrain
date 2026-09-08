"""Measured training SPS for the variants + new games, from existing runs.
Groups by hardware (partition/node from the job log) since the pv runs used
the 2-GPU recipe on A100 or H100, not the full-node DDP2 config.
"""
import glob, json, os, re
import numpy as np
from tensorboard.backend.event_processing.event_accumulator import EventAccumulator

GAMES = ["breakout.multi", "qbert.v2", "flappy_bird.dunk2", "frostbite.jungle",
         "vvvvvv", "downwell_fresh", "jump_king",
         "breakout", "qbert", "flappy_bird", "frostbite"]


def run_sps(d):
    acc = EventAccumulator(f"{d}/tb", size_guidance={"scalars": 0})
    acc.Reload()
    tags = [t for t in acc.Tags()["scalars"] if "return" in t.lower()]
    evs = acc.Scalars(tags[0])
    steps = evs[-1].step - evs[0].step
    secs = evs[-1].wall_time - evs[0].wall_time
    return steps / secs if secs > 0 else float("nan")


def hw_of(jobid):
    p = f"logs/{jobid}.out"
    if os.path.exists(p):
        s = open(p, errors="ignore").read(20000)
        m = re.search(r"partition=(\S+)", s)
        if m:
            return {"kempner": "2xA100", "kempner_h100": "2xH100"}.get(m.group(1), m.group(1))
    return "?"


out = {}
for cj in glob.glob("outputs/impala_*/config.json"):
    try:
        c = json.load(open(cj))
    except Exception:
        continue
    d = cj.rsplit("/", 1)[0]
    g = c.get("game")
    if g in GAMES and c.get("total_steps") == 100000000 and os.path.exists(f"{d}/final.pt"):
        jobid = d.split("_")[-1]
        try:
            sps = run_sps(d)
        except Exception:
            continue
        out.setdefault((g, hw_of(jobid)), []).append(sps)

for (g, hw), v in sorted(out.items()):
    print(f"{g:20s} {hw:7s} IMPALA sps = {np.mean(v)/1000:7.1f}k  (n={len(v)})")
