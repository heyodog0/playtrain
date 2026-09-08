"""Save a GIF of every WINNING held-out episode, per architecture, into
outputs/figs/v1p9_wins/{lstm,ff}/, labeled by seed + key cell + length."""
import json, sys
from pathlib import Path
import numpy as np, imageio.v2 as imageio
sys.path.insert(0, "tools"); sys.path.insert(0, "src")
from make_run_card import find_checkpoint, load_policy, rollout_one
from rollout import pick_device
from playtrain.runtime import PlayTrainEnv
from analogen.bindings import mulberry32, shuffle_in_place
from analogen.generalization import eval_pool, WIN_RETURN_THRESHOLD

GAME = "analogen_cavequest_easy"
TOOL = [6, 7, 12, 14, 17, 18]; START = (0, 5); DOOR_ROW = 2
RUNS = {
    "lstm": "outputs/impala_cavequest_finesweep_N08",
    "ff":   "outputs/impala_cavequest_ff_nsweep_N016",
}
device = pick_device("auto")
heldout = eval_pool(scan=50000, eval_per_binding=1, game=GAME)

def sword_cell(seed):
    rand = mulberry32(seed)
    roles = ["HAT", "BLUE_KEY", "BOOTS", "SWORD", "ARMOR", "SWORD"]; shuffle_in_place(roles, rand)
    if rand() > 0.5: pass
    cands = [(c, r) for r in range(6) for c in range(2)
             if not (abs(c) <= 1 and abs(r - 5) <= 1) and r != DOOR_ROW]
    shuffle_in_place(cands, rand); stack = list(cands[:6]); pl = {}
    for vid in TOOL: pl[vid] = stack.pop()
    return pl[12]

def up(fr, k=6): return [np.repeat(np.repeat(f, k, 0), k, 1) for f in fr]

for arch, run in RUNS.items():
    cfg = json.loads((Path(run) / "config.json").read_text())
    env = PlayTrainEnv(game=GAME, max_steps=cfg.get("max_steps", 2000),
                     frame_skip=int(cfg.get("frame_skip", 7)))
    pol = load_policy(find_checkpoint(Path(run)), env, device, cfg)
    d = Path(f"outputs/figs/cavequest_wins/{arch}"); d.mkdir(parents=True, exist_ok=True)
    wins = 0
    for s in heldout:
        ep = rollout_one(pol, env, seed=s, device=device, deterministic=True)
        if ep["total_return"] < WIN_RETURN_THRESHOLD:
            continue
        wins += 1
        cell = sword_cell(s)
        loc = "FARtop" if cell[1] == 0 else ("near" if cell[1] == 3 else "mid")
        g = d / f"{arch}_seed{s}_key{cell[0]}-{cell[1]}_{loc}_len{ep['length']:03d}.gif"
        imageio.mimsave(g, up(ep["frames"]), fps=10, loop=0)
    env.close()
    print(f"{arch}: saved {wins} win GIFs -> {d}/")
