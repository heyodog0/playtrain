"""PPO configs for the five panel-C games that have no pv_p_* runs.

Templated from configs/pv_p_plunder_s0.json -- only game, seed and log_dir
change, so these are comparable to the PPO curves already in panel C.
Writes outputs/_panelc/manifest_ppo.txt for the array job.
"""
import json, os

GAMES = ["bossfight", "chaser", "leaper", "ninja", "starpilot"]
SEEDS = (0, 1, 2)
TPL = "configs/pv_p_plunder_s0.json"

os.makedirs("outputs/_panelc", exist_ok=True)
base = json.load(open(TPL))
lines = []
for g in GAMES:
    for s in SEEDS:
        c = dict(base)
        c["game"] = g
        c["seed"] = s
        c["log_dir"] = f"outputs/pv_p_{g}_s{s}"
        p = f"configs/pv_p_{g}_s{s}.json"
        json.dump(c, open(p, "w"), indent=1)
        lines.append(f"ppo {p}")
open("outputs/_panelc/manifest_ppo.txt", "w").write("\n".join(lines) + "\n")
print(f"wrote {len(lines)} configs; total_timesteps={base['total_timesteps']:,}")
