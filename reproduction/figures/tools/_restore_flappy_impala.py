"""Restore flappy_bird's IMPALA curves into the impala slot.

fix_flappy.py put the PPO runs into `curves` (the IMPALA slot) so the single-curve
figure would show the run that learned. Now that the figure plots both trainers,
the IMPALA slot must hold the actual IMPALA runs -- which flatline at 0.0, and that
contrast is the point.

Also prints the first values of each PPO curve, to check suspicious crossings.

usage: python restore_flappy_impala.py CURVES.json
"""
import json
import sys

from tensorboard.backend.event_processing.event_accumulator import EventAccumulator

IMPALA_RUNS = ["impala_34954405", "impala_35032848", "impala_35032851"]

path = sys.argv[1]
d = json.load(open(path))

d["curves"]["flappy_bird"] = []
for rd in IMPALA_RUNS:
    acc = EventAccumulator(f"outputs/{rd}/tb", size_guidance={"scalars": 0})
    acc.Reload()
    tags = [t for t in acc.Tags()["scalars"] if "return" in t.lower()]
    pref = ([t for t in tags if "ep_return_mean" in t]
            or [t for t in tags if "ep_return" in t] or tags)
    ev = acc.Scalars(pref[0])
    d["curves"]["flappy_bird"].append(dict(run=rd, tag=pref[0],
                                           step=[e.step for e in ev],
                                           value=[e.value for e in ev]))
    print(f"  restored {rd:<20} final={ev[-1].value:.2f}")

cfg = json.load(open(f"outputs/{IMPALA_RUNS[0]}/config.json"))
d["meta"]["flappy_bird"] = dict(trainer="impala", net=cfg.get("net"),
                                runs=IMPALA_RUNS)
d["chosen"]["flappy_bird"] = dict(steps=cfg.get("total_steps"), runs=IMPALA_RUNS)

print("\nfirst 3 logged values per PPO curve (checking early crossings):")
for g, cs in sorted(d.get("ppo_curves", {}).items()):
    for c in cs[:1]:
        head = [round(v, 2) for v in c["value"][:3]]
        steps = c["step"][:3]
        print(f"  {g:<13} {c['run']:<24} steps={steps} values={head}")

json.dump(d, open(path, "w"))
print("\nwrote", path)
