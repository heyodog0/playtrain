"""Minimal PPO training probe over CuLE GPU envs (torch 2.x).

CuLE's own 2019 PPO example heap-faults under modern glibc (see handoff),
so this reimplements its exact training shape faithfully: NatureCNN on
4-stacked 84x84 gray frames, 32-step rollouts, 3 PPO epochs, minibatch
2048, Adam, fp32 eager. Reports steady-state agent-steps/s.
"""
import argparse, time
import torch, torch.nn as nn
from torchcule.atari import Env

p = argparse.ArgumentParser()
p.add_argument("--num-ales", type=int, default=4096)
p.add_argument("--num-steps", type=int, default=32)
p.add_argument("--ppo-epoch", type=int, default=3)
p.add_argument("--minibatch", type=int, default=2048)
p.add_argument("--seconds", type=float, default=120.0)
p.add_argument("--env-name", default="PongNoFrameskip-v4")
args = p.parse_args()

dev = torch.device("cuda:0")
N, T = args.num_ales, args.num_steps
env = Env(args.env_name, N, device=dev, color_mode="gray", repeat_prob=0.0,
          rescale=True, episodic_life=True, frameskip=4)
env.train()
obs = env.reset(initial_steps=400).squeeze(-1)  # (N,84,84) uint8
NA = env.action_space.n

class ActorCritic(nn.Module):
    def __init__(self, na):
        super().__init__()
        self.f = nn.Sequential(
            nn.Conv2d(4, 32, 8, 4), nn.ReLU(),
            nn.Conv2d(32, 64, 4, 2), nn.ReLU(),
            nn.Conv2d(64, 64, 3, 1), nn.ReLU(),
            nn.Flatten(), nn.Linear(64 * 7 * 7, 512), nn.ReLU())
        self.pi = nn.Linear(512, na)
        self.v = nn.Linear(512, 1)
    def forward(self, x):
        h = self.f(x)
        return self.pi(h), self.v(h).squeeze(-1)

model = ActorCritic(NA).to(dev)
opt = torch.optim.Adam(model.parameters(), lr=2.5e-4, eps=1e-5)

stack = torch.zeros(N, 4, 84, 84, device=dev)
stack[:, -1] = obs.float() / 255.0

s_obs = torch.zeros(T, N, 4, 84, 84, device=dev)
s_act = torch.zeros(T, N, dtype=torch.long, device=dev)
s_lp = torch.zeros(T, N, device=dev)
s_rew = torch.zeros(T, N, device=dev)
s_msk = torch.zeros(T, N, device=dev)
s_val = torch.zeros(T + 1, N, device=dev)

def rollout():
    global stack
    for t in range(T):
        with torch.no_grad():
            logits, v = model(stack)
        dist = torch.distributions.Categorical(logits=logits)
        a = dist.sample()
        o, r, d, info = env.step(a)
        o = o.squeeze(-1).float() / 255.0
        nd = (~d).float()
        stack = torch.cat([stack[:, 1:] * nd.view(N, 1, 1, 1), o.unsqueeze(1)], 1)
        s_obs[t].copy_(stack); s_act[t].copy_(a); s_lp[t].copy_(dist.log_prob(a))
        s_rew[t].copy_(torch.clamp(r.float(), -1, 1)); s_msk[t].copy_(nd); s_val[t].copy_(v)
    with torch.no_grad():
        _, s_val[T] = model(stack)

def update():
    adv = torch.zeros(T, N, device=dev)
    ret = s_val[T].clone()
    for t in reversed(range(T)):
        ret = s_rew[t] + 0.99 * s_msk[t] * ret
        adv[t] = ret - s_val[t]
    b_obs = s_obs.reshape(T * N, 4, 84, 84)
    b_act, b_lp = s_act.reshape(-1), s_lp.reshape(-1)
    b_ret, b_adv = (s_val[:T] + adv).reshape(-1), adv.reshape(-1)
    b_adv = (b_adv - b_adv.mean()) / (b_adv.std() + 1e-8)
    for _ in range(args.ppo_epoch):
        idx = torch.randperm(T * N, device=dev)
        for i in range(0, T * N, args.minibatch):
            j = idx[i:i + args.minibatch]
            logits, v = model(b_obs[j])
            dist = torch.distributions.Categorical(logits=logits)
            ratio = (dist.log_prob(b_act[j]) - b_lp[j]).exp()
            pl = -torch.min(ratio * b_adv[j],
                            ratio.clamp(0.9, 1.1) * b_adv[j]).mean()
            vl = 0.5 * (v - b_ret[j]).pow(2).mean()
            loss = pl + 0.5 * vl - 0.01 * dist.entropy().mean()
            opt.zero_grad(set_to_none=True); loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 0.5)
            opt.step()

for _ in range(3):  # warmup
    rollout(); update()
torch.cuda.synchronize()
t0 = time.time(); steps = 0
while time.time() - t0 < args.seconds:
    rollout(); update()
    steps += T * N
torch.cuda.synchronize()
dt = time.time() - t0
print(f"CULE TRAIN N={N}: {steps/dt:,.0f} agent-steps/s "
      f"({steps*4/dt:,.0f} env-frames/s at frameskip 4) [{dt:.0f}s]")
