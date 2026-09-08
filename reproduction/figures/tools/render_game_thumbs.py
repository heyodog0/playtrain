"""One 256px thumbnail per panel-A game, played by its trained IMPALA policy
(greedy) so the frame shows mid-episode play, not a start screen.
Writes outputs/game_thumbs/<game>.png
"""
import glob, json, os
import numpy as np
import torch
from PIL import Image
from playtrain.runtime.env import PlayTrainEnv

GAMES = ["asteroids", "bigfish", "bossfight", "breakout", "caveflyer",
         "chaser", "climber", "coinrun", "dodgeball", "freeway",
         "frostbite", "fruitbot", "heist", "jumper", "leaper", "maze",
         "miner", "ninja", "plunder", "pong", "qbert", "seaquest",
         "space_invaders", "starpilot"]
CAPTURE_T = 150
SEED = 7
os.makedirs("outputs/game_thumbs", exist_ok=True)


def find_impala_ckpt(game):
    best = None
    for cj in glob.glob("outputs/impala_*/config.json"):
        try:
            c = json.load(open(cj))
        except Exception:
            continue
        d = cj.rsplit("/", 1)[0]
        if c.get("game") == game and os.path.exists(f"{d}/final.pt"):
            if best is None or d > best[0]:
                best = (d, c)
    return best


def make_impala_agent(run_dir, cfg):
    from playtrain_trainers.impala.net import ImpalaNet
    from playtrain_trainers.impala.environment import _format_frame
    model = ImpalaNet(cfg["obs_shape"], cfg["num_actions"],
                      features_dim=cfg["features_dim"], use_lstm=cfg["use_lstm"],
                      use_popart=cfg.get("use_popart", False), net=cfg["net"])
    ckpt = torch.load(f"{run_dir}/final.pt", map_location="cpu", weights_only=False)
    model.load_state_dict(ckpt["model_state_dict"])
    model.eval()
    state = [model.initial_state(batch_size=1)]
    last = [0]

    @torch.no_grad()
    def act(obs):
        inputs = {"frame": _format_frame(obs, True),
                  "reward": torch.zeros(1, 1),
                  "done": torch.zeros(1, 1, dtype=torch.bool),
                  "last_action": torch.tensor([[last[0]]], dtype=torch.int64)}
        out, state[0] = model(inputs, state[0])
        a = int(out["policy_logits"].view(-1).argmax())
        last[0] = a
        return a
    return act


for game in GAMES:
    agent, src = None, "random"
    hit = find_impala_ckpt(game)
    if hit:
        agent = make_impala_agent(*hit)
        src = f"IMPALA:{hit[0]}"
    if agent is None:
        import random as _r
        rr = _r.Random(SEED)
        agent = lambda obs: rr.randrange(8)

    e64 = PlayTrainEnv(game=game, frame_skip=1, frame_stack=1, obs_size=64)
    e256 = PlayTrainEnv(game=game, frame_skip=1, frame_stack=1, obs_size=256)
    o64, _ = e64.reset(seed=SEED)
    o256, _ = e256.reset(seed=SEED)
    for t in range(CAPTURE_T + 1):
        if t == CAPTURE_T:
            Image.fromarray(np.asarray(o256, dtype=np.uint8)).save(
                f"outputs/game_thumbs/{game}.png")
            break
        a = agent(o64)
        o64, r, term, trunc, _ = e64.step(a)
        o256, _, _, _, _ = e256.step(a)
        if term or trunc:
            o64, _ = e64.reset(seed=SEED + 1)
            o256, _ = e256.reset(seed=SEED + 1)
    e64.close(); e256.close()
    print(f"{game}: {src}")
print("done -> outputs/game_thumbs/")
