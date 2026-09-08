"""Add PPO curves alongside the IMPALA ones, per game.

PPO lives under two naming families with different encoders:
  ppo_impala_<game>_s{0,1,2}  -> IMPALA-CNN  (matches tab:hyperparams' PPO column)
  pv_p_<game>_s{0,1,2} / ppo_nature_<game>_s{0,1,2} -> Nature
Prefer IMPALA-CNN so the wall-clock conversion matches the IMPALA curve; fall
back to Nature where that is all that exists (flappy_bird).

usage: python add_ppo.py CURVES.json
"""
import glob
import json
import os
import sys

from tensorboard.backend.event_processing.event_accumulator import EventAccumulator

GAMES = ["asteroids", "vvvvvv", "breakout", "flappy_bird",
         "seaquest", "coinrun", "caveflyer", "plunder"]

found = {g: {} for g in GAMES}          # game -> net -> {seed: run}
for cj in glob.glob("outputs/*/config.json"):
    rd = os.path.dirname(cj)
    name = os.path.basename(rd)
    if not name.startswith(("pv_p_", "ppo_")):
        continue
    if any(x in name for x in ("failed", "partial", "probe", "multi", "_v4",
                               "dunk", "jungle", "_v2")):
        continue
    try:
        c = json.load(open(cj))
    except Exception:
        continue
    base = os.path.basename(str(c.get("game", ""))).replace(".js", "")
    if base not in found or "." in base:
        continue
    if not (os.path.exists(f"{rd}/final.pt") and os.path.isdir(f"{rd}/tb")):
        continue
    net = str(c.get("net") or "?")
    found[base].setdefault(net, {}).setdefault(c.get("seed", 0), name)

d = json.load(open(sys.argv[1]))
d.setdefault("ppo_curves", {})
d.setdefault("ppo_meta", {})

for g in GAMES:
    if not found[g]:
        print(f"  {g:<13} no PPO run")
        continue
    net = "impala" if "impala" in found[g] else sorted(found[g])[0]
    runs = [found[g][net][k] for k in sorted(found[g][net])]
    d["ppo_meta"][g] = dict(trainer="ppo", net=net, runs=runs)
    d["ppo_curves"][g] = []
    for rd in runs:
        acc = EventAccumulator(f"outputs/{rd}/tb", size_guidance={"scalars": 0})
        acc.Reload()
        tags = [t for t in acc.Tags()["scalars"] if "return" in t.lower()]
        pref = ([t for t in tags if "ep_return_mean" in t]
                or [t for t in tags if "ep_return" in t] or tags)
        if not pref:
            continue
        ev = acc.Scalars(pref[0])
        d["ppo_curves"][g].append(dict(run=rd, tag=pref[0],
                                       step=[e.step for e in ev],
                                       value=[e.value for e in ev]))
    fin = [c["value"][-1] for c in d["ppo_curves"][g]]
    print(f"  {g:<13} net={net:<7} {len(runs)} seed(s)  "
          f"final={[round(x, 1) for x in fin]}")

json.dump(d, open(sys.argv[1], "w"))
print("\nwrote", sys.argv[1])
