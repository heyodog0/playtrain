"""How much can double-buffering PPO's rollout actually buy?

PPO's rollout (train_ppo_clean.py:658) is strictly serial: model.act() then
venv.step(), repeatedly. Overlapping them can hide at most the SMALLER of the
two phases, so the ceiling is set by their ratio -- no implementation needed to
find it.

Replicates the trainer's own construction: NativeVecEnv at cfg.n_envs, the same
ActorCritic, same obs size, no grad, autocast off (the trainer's PPO path is
fp32 -- compile/bf16 measured slower).

usage: python ppo_phase_split.py GAME [n_envs] [n_steps]
"""
import sys
import time

import numpy as np
import torch

from playtrain.runtime.native_vec_env import NativeVecEnv
from playtrain_trainers.policy import ActorCritic

GAME = sys.argv[1] if len(sys.argv) > 1 else "bigfish"
N_ENVS = int(sys.argv[2]) if len(sys.argv) > 2 else 192
N_STEPS = int(sys.argv[3]) if len(sys.argv) > 3 else 600
OBS = 64
GAMES_DIR = "../playtrain/examples/games/js"

dev = torch.device("cuda" if torch.cuda.is_available() else "cpu")
nv = NativeVecEnv(game=GAME, num_envs=N_ENVS, obs_size=OBS, max_steps=2000,
                  num_threads=0, autoreset=True, frame_skip=1,
                  render_skip=False, games_dir=GAMES_DIR)
obs = nv.reset()
model = ActorCritic(n_actions=8, in_channels=3, input_hw=OBS, net="nature").to(dev)
model.eval()

t_infer = t_step = 0.0
warm = 100
for i in range(N_STEPS + warm):
    if i == warm:                      # discard warm-up, then time
        torch.cuda.synchronize() if dev.type == "cuda" else None
        t_infer = t_step = 0.0

    t0 = time.perf_counter()
    with torch.no_grad():
        x = torch.from_numpy(np.ascontiguousarray(obs)).to(dev, non_blocking=True)
        x = x.permute(0, 3, 1, 2).float().div_(255.0)
        action, _, _ = model.act(x)
    a = action.cpu().numpy().astype(np.int32)
    if dev.type == "cuda":
        torch.cuda.synchronize()
    t1 = time.perf_counter()

    obs = nv.step(a)[0]   # (obs, rew, term, trunc, info)
    t2 = time.perf_counter()

    if i >= warm:
        t_infer += t1 - t0
        t_step += t2 - t1

nv.close()
tot = t_infer + t_step
sps = N_ENVS * N_STEPS / tot
print(f"game={GAME}  n_envs={N_ENVS}  steps={N_STEPS}")
print(f"  inference : {t_infer:7.2f}s  ({100*t_infer/tot:5.1f}%)")
print(f"  env step  : {t_step:7.2f}s  ({100*t_step/tot:5.1f}%)")
print(f"  serial    : {sps:>10,.0f} agent-steps/s")
# perfect overlap: wall-clock becomes max(phase), not sum
best = N_ENVS * N_STEPS / max(t_infer, t_step)
print(f"  overlapped: {best:>10,.0f}  (ceiling, {best/sps:.2f}x)")
