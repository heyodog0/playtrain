"""flappy_bird PPO slot must be the three pv_p seeds, not a mix that pulled in
ppo_flappy_bird_100M as 'seed 0'. Same family, same config, three seeds."""
import json, sys
from tensorboard.backend.event_processing.event_accumulator import EventAccumulator
RUNS = ["pv_p_flappy_bird_s0", "pv_p_flappy_bird_s1", "pv_p_flappy_bird_s2"]
path = sys.argv[1]
d = json.load(open(path))
d["ppo_curves"]["flappy_bird"] = []
for rd in RUNS:
    acc = EventAccumulator(f"outputs/{rd}/tb", size_guidance={"scalars": 0}); acc.Reload()
    tags = [t for t in acc.Tags()["scalars"] if "return" in t.lower()]
    pref = [t for t in tags if "ep_return_mean" in t] or tags
    ev = acc.Scalars(pref[0])
    d["ppo_curves"]["flappy_bird"].append(dict(run=rd, tag=pref[0],
        step=[e.step for e in ev], value=[e.value for e in ev]))
    print(f"  {rd:<24} {len(ev)} pts  final={ev[-1].value:.2f}")
cfg = json.load(open(f"outputs/{RUNS[0]}/config.json"))
d["ppo_meta"]["flappy_bird"] = dict(trainer="ppo", net=cfg.get("net"), runs=RUNS)
json.dump(d, open(path, "w")); print("wrote", path)
