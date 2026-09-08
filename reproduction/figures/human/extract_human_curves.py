"""Pick IMPALA-encoder runs per human-study game and dump return curves.

Selection: among runs with final.pt + tb, group by total_steps and take the
group with the most distinct seeds (tie-break: larger budget). Writes curves
plus the chosen run list so the figure is auditable.

usage: python extract_human_curves.py OUT.json
"""
import collections
import glob
import json
import os
import sys

from tensorboard.backend.event_processing.event_accumulator import EventAccumulator

GAMES = ["asteroids", "vvvvvv", "breakout", "flappy_bird",
         "seaquest", "coinrun", "caveflyer", "plunder"]

cand = {g: [] for g in GAMES}
for cj in glob.glob("outputs/*/config.json"):
    rd, name = os.path.dirname(cj), os.path.basename(os.path.dirname(cj))
    if any(x in name for x in ("failed", "partial", "probe")):
        continue
    try:
        c = json.load(open(cj))
    except Exception:
        continue
    base = os.path.basename(str(c.get("game", ""))).replace(".js", "")
    if base not in cand or "." in base:
        continue
    if str(c.get("encoder") or c.get("net") or "?") != "impala":
        continue
    if not (os.path.exists(f"{rd}/final.pt") and os.path.isdir(f"{rd}/tb")):
        continue
    cand[base].append((name, c.get("seed", 0),
                       c.get("total_steps") or c.get("steps") or 0))

chosen = {}
for g in GAMES:
    by_budget = collections.defaultdict(dict)      # steps -> seed -> run
    for name, seed, steps in cand[g]:
        by_budget[steps].setdefault(seed, name)
    if not by_budget:
        continue
    steps = max(by_budget, key=lambda s: (len(by_budget[s]), s))
    chosen[g] = dict(steps=steps,
                     runs=[by_budget[steps][k] for k in sorted(by_budget[steps])])

out = {"chosen": chosen, "curves": {}}
for g, info in chosen.items():
    out["curves"][g] = []
    for rd in info["runs"]:
        acc = EventAccumulator(f"outputs/{rd}/tb", size_guidance={"scalars": 0})
        acc.Reload()
        tags = [t for t in acc.Tags()["scalars"] if "return" in t.lower()]
        pref = ([t for t in tags if "ep_return_mean" in t]
                or [t for t in tags if "ep_return" in t] or tags)
        if not pref:
            print(f"  !! no return tag in {rd}: {tags[:6]}")
            continue
        ev = acc.Scalars(pref[0])
        out["curves"][g].append(dict(run=rd, tag=pref[0],
                                     step=[e.step for e in ev],
                                     value=[e.value for e in ev]))
        print(f"  {g:<12} {rd:<22} {pref[0]:<24} {len(ev)} points, "
              f"final={ev[-1].value:.1f}")

json.dump(out, open(sys.argv[1], "w"))
print("\nwrote", sys.argv[1])
for g in GAMES:
    if g in chosen:
        print(f"  {g:<13} {len(chosen[g]['runs'])} seed(s) @ {chosen[g]['steps']:,} steps")
    else:
        print(f"  {g:<13} NONE")
