"""Variant-figure frame strips, rendered from TRAINED policies.

For each game: load the best available checkpoint (IMPALA final.pt from the
matrix; PPO for the flappy pair, which IMPALA cannot learn), roll it greedily
on a 64px env (what the policy saw in training), and replay the identical
action sequence on a synchronized 256px twin for display frames. The engine
is deterministic given (seed, actions), so the twin's states match exactly.
3 frames per game, spaced to show clear progression.
"""
import glob, json, os
import numpy as np
import torch
from PIL import Image
from playtrain.runtime.env import PlayTrainEnv

GAMES = ["breakout", "breakout.multi", "qbert", "qbert.v2",
         "flappy_bird", "flappy_bird.dunk2", "frostbite", "frostbite.jungle"]
PPO_OVERRIDE = {  # flappy family: IMPALA never learns it (sparse reward)
    "flappy_bird": ["outputs/pv_p_flappy_bird_s0", "outputs/ppo_flappy_probe"],
    "flappy_bird.dunk2": ["outputs/pv_p_flappy_bird_dunk2_s0", "outputs/ppo_dunk2_150M"],
}
CAPTURE = [30, 240, 480]
SEED = 7
os.makedirs("outputs/variant_strips", exist_ok=True)


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


def make_ppo_agent(run_dir):
    from playtrain_trainers.policy import ActorCritic
    ckpt = torch.load(f"{run_dir}/final.pt", map_location="cpu", weights_only=False)
    cfg = ckpt.get("config", {})
    model = ActorCritic(n_actions=8, in_channels=3, input_hw=cfg.get("obs_size", 64),
                        net=cfg.get("net", "nature"))
    model.load_state_dict(ckpt["model"])
    model.eval()
    @torch.no_grad()
    def act(obs):
        x = torch.from_numpy(np.asarray(obs)).permute(2, 0, 1).unsqueeze(0)
        dist, _ = model.forward(x)
        return int(dist.logits.view(-1).argmax())
    return act


for game in GAMES:
    agent = None
    src = "random"
    if game in PPO_OVERRIDE:
        for d in PPO_OVERRIDE[game]:
            if os.path.exists(f"{d}/final.pt"):
                agent = make_ppo_agent(d); src = f"PPO:{d}"; break
    else:
        hit = find_impala_ckpt(game)
        if hit:
            agent = make_impala_agent(*hit); src = f"IMPALA:{hit[0]}"
    if agent is None:
        import random as _r
        rng = _r.Random(SEED)
        agent = lambda obs: rng.randrange(8)

    e64 = PlayTrainEnv(game=game, frame_skip=1, frame_stack=1, obs_size=64)
    e256 = PlayTrainEnv(game=game, frame_skip=1, frame_stack=1, obs_size=256)
    o64, _ = e64.reset(seed=SEED)
    o256, _ = e256.reset(seed=SEED)
    ep = 0
    for t in range(max(CAPTURE) + 1):
        if t in CAPTURE:
            Image.fromarray(np.asarray(o256, dtype=np.uint8)).save(
                f"outputs/variant_strips/{game.replace('.', '_')}_f{t:03d}.png")
        a = agent(o64)
        o64, r, term, trunc, _ = e64.step(a)
        o256, _, t2, tr2, _ = e256.step(a)
        if term or trunc:
            ep += 1
            o64, _ = e64.reset(seed=SEED + ep)
            o256, _ = e256.reset(seed=SEED + ep)
    e64.close(); e256.close()
    print(f"{game}: {src}")
