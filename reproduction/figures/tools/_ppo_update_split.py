"""Where PPO's update time goes: minibatch fwd+bwd vs GAE vs buffer handling.

Replicates train_ppo_clean.py's update shapes exactly -- n_envs=192,
n_steps=128 (batch 24,576), n_epochs=3, n_minibatches=8 -> 24 fwd+bwd passes
of 3,072. fp32, no compile (the trainer's PPO path measured slower with both).

usage: python ppo_update_split.py [n_updates]
"""
import sys, time
import numpy as np
import torch
from playtrain_trainers.policy import ActorCritic

N_ENVS, N_STEPS, N_EPOCHS, N_MB = 192, 128, 3, 8
BATCH = N_ENVS * N_STEPS
MB = BATCH // N_MB
REPS = int(sys.argv[1]) if len(sys.argv) > 1 else 6
dev = torch.device("cuda")

model = ActorCritic(n_actions=8, in_channels=3, input_hw=64, net="nature").to(dev)
opt = torch.optim.Adam(model.parameters(), lr=2.5e-4)

b_obs = torch.randint(0, 255, (BATCH, 64, 64, 3), dtype=torch.uint8, device=dev)
b_act = torch.randint(0, 8, (BATCH,), device=dev)
b_logp = torch.randn(BATCH, device=dev)
b_adv = torch.randn(BATCH, device=dev)
b_ret = torch.randn(BATCH, device=dev)
rew = torch.randn(N_STEPS, N_ENVS, device=dev)
val = torch.randn(N_STEPS, N_ENVS, device=dev)
done = torch.zeros(N_STEPS, N_ENVS, device=dev)

def gae():
    adv = torch.zeros_like(rew)
    last = torch.zeros(N_ENVS, device=dev)
    for t in reversed(range(N_STEPS)):
        nextv = val[t + 1] if t + 1 < N_STEPS else torch.zeros(N_ENVS, device=dev)
        delta = rew[t] + 0.99 * nextv * (1 - done[t]) - val[t]
        last = delta + 0.99 * 0.95 * (1 - done[t]) * last
        adv[t] = last
    return adv

t_gae = t_mb = t_idx = 0.0
for r in range(REPS + 1):
    if r == 1:
        torch.cuda.synchronize(); t_gae = t_mb = t_idx = 0.0
    torch.cuda.synchronize(); a = time.perf_counter()
    gae()
    torch.cuda.synchronize(); b = time.perf_counter()

    idx = np.arange(BATCH)
    for _ in range(N_EPOCHS):
        np.random.shuffle(idx)
        for s in range(0, BATCH, MB):
            c0 = time.perf_counter()
            mb = torch.as_tensor(idx[s:s + MB], dtype=torch.long, device=dev)
            x = b_obs[mb].permute(0, 3, 1, 2).float().div_(255.0)
            torch.cuda.synchronize(); c1 = time.perf_counter()
            dist, v = model.forward(x)
            lp = dist.log_prob(b_act[mb])
            ratio = (lp - b_logp[mb]).exp()
            adv = (b_adv[mb] - b_adv[mb].mean()) / (b_adv[mb].std() + 1e-8)
            pg = torch.max(-adv * ratio,
                           -adv * ratio.clamp(0.8, 1.2)).mean()
            vloss = 0.5 * ((v.squeeze(-1) - b_ret[mb]) ** 2).mean()
            loss = pg + 0.5 * vloss - 0.01 * dist.entropy().mean()
            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 0.5)
            opt.step()
            torch.cuda.synchronize(); c2 = time.perf_counter()
            if r > 0:
                t_idx += c1 - c0
                t_mb += c2 - c1
    if r > 0:
        t_gae += b - a

tot = t_gae + t_mb + t_idx
per = tot / REPS
print(f"per update ({N_EPOCHS} epochs x {N_MB} minibatches of {MB:,}):")
print(f"  gather+preprocess : {t_idx/REPS:7.4f}s ({100*t_idx/tot:5.1f}%)")
print(f"  fwd+bwd+step      : {t_mb/REPS:7.4f}s ({100*t_mb/tot:5.1f}%)")
print(f"  GAE               : {t_gae/REPS:7.4f}s ({100*t_gae/tot:5.1f}%)")
print(f"  update total      : {per:7.4f}s  -> {BATCH/per:,.0f} agent-steps/s if update alone")
