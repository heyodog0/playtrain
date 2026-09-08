"""Measured PPO vs IMPALA throughput per game, read from each run's charts/sps.

Steady-state = median over the last half of logged points, so warmup and compile
are excluded. Runs happened on different nodes at different times, and the same
config varies up to 1.56x across kempner_h100 nodes, so treat cross-trainer
ratios as indicative rather than a controlled measurement.

usage: python sps_compare.py CURVES.json
"""
import json
import statistics as st
import sys

from tensorboard.backend.event_processing.event_accumulator import EventAccumulator

d = json.load(open(sys.argv[1]))


def sps(run):
    a = EventAccumulator(f"outputs/{run}/tb", size_guidance={"scalars": 0})
    a.Reload()
    if "charts/sps" not in a.Tags()["scalars"]:
        return None
    v = [e.value for e in a.Scalars("charts/sps")]
    v = [x for x in v if x > 0]
    if not v:
        return None
    return st.median(v[len(v) // 2:])


print(f"{'game':<13}{'trainer':<8}{'net':<8}{'median sps':>12}{'n runs':>8}")
agg = {}
for key, mkey, tag in (("curves", "meta", "impala"), ("ppo_curves", "ppo_meta", "ppo")):
    for g, runs in d.get(key, {}).items():
        net = d[mkey][g]["net"]
        vals = [s for s in (sps(r["run"]) for r in runs) if s]
        if not vals:
            continue
        m = st.median(vals)
        agg.setdefault(g, {})[tag] = (m, net)
        print(f"{g:<13}{tag:<8}{net:<8}{m:>12,.0f}{len(vals):>8}")

print(f"\n{'game':<13}{'IMPALA sps':>12}{'PPO sps':>12}{'PPO/IMPALA':>12}  nets")
ratios = []
for g, v in agg.items():
    if "impala" in v and "ppo" in v:
        r = v["ppo"][0] / v["impala"][0]
        ratios.append(r)
        print(f"{g:<13}{v['impala'][0]:>12,.0f}{v['ppo'][0]:>12,.0f}{r:>11.2f}x"
              f"  {v['impala'][1]}/{v['ppo'][1]}")
if ratios:
    print(f"\ngeometric mean PPO/IMPALA = "
          f"{st.geometric_mean(ratios):.2f}x  over {len(ratios)} games")
