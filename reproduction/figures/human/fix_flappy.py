"""flappy_bird: swap the IMPALA runs (final return 0.0 on all seeds) for the
PPO runs, which are the ones that learned. Re-extracts their curves and records
trainer/net per game so the wall-clock conversion can use the right throughput.

usage: python fix_flappy.py CURVES.json
"""
import json
import os
import sys

from tensorboard.backend.event_processing.event_accumulator import EventAccumulator

PPO_RUNS = ["pv_p_flappy_bird_s0", "pv_p_flappy_bird_s1", "pv_p_flappy_bird_s2"]

path = sys.argv[1]
d = json.load(open(path))

d["chosen"]["flappy_bird"] = dict(steps=None, runs=PPO_RUNS)
d["curves"]["flappy_bird"] = []
for rd in PPO_RUNS:
    tb = f"outputs/{rd}/tb"
    if not os.path.isdir(tb):
        print("!! missing tb:", rd)
        continue
    acc = EventAccumulator(tb, size_guidance={"scalars": 0})
    acc.Reload()
    tags = [t for t in acc.Tags()["scalars"] if "return" in t.lower()]
    pref = ([t for t in tags if "ep_return_mean" in t]
            or [t for t in tags if "ep_return" in t] or tags)
    if not pref:
        print(f"!! no return tag in {rd}: {tags[:8]}")
        continue
    ev = acc.Scalars(pref[0])
    d["curves"]["flappy_bird"].append(dict(run=rd, tag=pref[0],
                                           step=[e.step for e in ev],
                                           value=[e.value for e in ev]))
    print(f"  flappy_bird {rd:<24} {pref[0]:<22} {len(ev)} pts, "
          f"final={ev[-1].value:.2f}, last step={ev[-1].step:,}")

meta = {}
for g, info in d["chosen"].items():
    r0 = info["runs"][0]
    cfg = json.load(open(f"outputs/{r0}/config.json"))
    meta[g] = dict(trainer="ppo" if r0.startswith(("pv_p_", "ppo_")) else "impala",
                   net=cfg.get("net"), runs=info["runs"])
d["meta"] = meta

json.dump(d, open(path, "w"))
print("\ngame           trainer  net")
for g, m in meta.items():
    print(f"  {g:<13}{m['trainer']:<9}{m['net']}")
print("\nwrote", path)
