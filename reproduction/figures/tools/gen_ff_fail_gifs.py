"""Save FF (N=16) FAILING held-out rollouts for specific seeds, into
outputs/figs/cavequest_wins/ff_fails/ -- same boards the LSTM wins, for contrast."""
import json, sys
from pathlib import Path
import numpy as np, imageio.v2 as imageio
sys.path.insert(0, "tools"); sys.path.insert(0, "src")
from make_run_card import find_checkpoint, load_policy, rollout_one
from rollout import pick_device
from playtrain.runtime import PlayTrainEnv
from analogen.bindings import mulberry32, shuffle_in_place

GAME = "analogen_cavequest_easy"
TOOL = [6, 7, 12, 14, 17, 18]; DOOR_ROW = 2
RUN = "outputs/impala_cavequest_ff_nsweep_N016"
SEEDS = [1703, 767]
device = pick_device("auto")

def sword_cell(seed):
    rand = mulberry32(seed)
    roles = ["HAT", "BLUE_KEY", "BOOTS", "SWORD", "ARMOR", "SWORD"]; shuffle_in_place(roles, rand)
    rand()
    cands = [(c, r) for r in range(6) for c in range(2)
             if not (abs(c) <= 1 and abs(r - 5) <= 1) and r != DOOR_ROW]
    shuffle_in_place(cands, rand); stack = list(cands[:6]); pl = {}
    for vid in TOOL: pl[vid] = stack.pop()
    return pl[12]

def up(fr, k=6): return [np.repeat(np.repeat(f, k, 0), k, 1) for f in fr]

cfg = json.loads((Path(RUN) / "config.json").read_text())
env = PlayTrainEnv(game=GAME, max_steps=cfg.get("max_steps", 2000),
                 frame_skip=int(cfg.get("frame_skip", 7)))
pol = load_policy(find_checkpoint(Path(RUN)), env, device, cfg)
d = Path("outputs/figs/cavequest_wins/ff_fails"); d.mkdir(parents=True, exist_ok=True)
for s in SEEDS:
    ep = rollout_one(pol, env, seed=s, device=device, deterministic=True)
    cell = sword_cell(s)
    loc = "FARtop" if cell[1] == 0 else ("near" if cell[1] == 3 else "mid")
    g = d / f"ff_seed{s}_key{cell[0]}-{cell[1]}_{loc}_FAIL_len{ep['length']:03d}.gif"
    imageio.mimsave(g, up(ep["frames"]), fps=10, loop=0)
    print(f"seed {s}: return {ep['total_return']:.0f} len {ep['length']} -> {g}")
env.close()
