"""How fast can PPO go WITHOUT changing the algorithm?

Data reuse is held fixed at 3 epochs x 24,576 transitions -- the thing that
makes PPO sample-efficient -- and only engineering knobs move:

  update  : fp32 vs bf16 autocast, channels_last on/off, n_minibatches 8 vs 4
            (4 = same samples, same epochs, half the kernel launches)
  rollout : forward batch 192 / 384 / 768 (the per-step cost looked
            launch-bound, not compute-bound: 3.75ms for a batch-192 Nature CNN)

Prints the best update and rollout times found and the end-to-end projection.
"""
import itertools, time
import torch
from playtrain_trainers.policy import ActorCritic

BATCH, EPOCHS = 192 * 128, 3
dev = torch.device("cuda")


def build(chlast):
    m = ActorCritic(n_actions=8, in_channels=3, input_hw=64, net="nature").to(dev)
    if chlast:
        m = m.to(memory_format=torch.channels_last)
    return m, torch.optim.Adam(m.parameters(), lr=2.5e-4)


def time_update(bf16, chlast, n_mb, reps=4):
    model, opt = build(chlast)
    mb = BATCH // n_mb
    obs = torch.randint(0, 255, (BATCH, 64, 64, 3), dtype=torch.uint8, device=dev)
    act = torch.randint(0, 8, (BATCH,), device=dev)
    tgt = torch.randn(BATCH, device=dev)
    ctx = (torch.autocast("cuda", torch.bfloat16) if bf16
           else torch.autocast("cuda", enabled=False))
    t = 0.0
    for r in range(reps + 1):
        torch.cuda.synchronize(); t0 = time.perf_counter()
        for _ in range(EPOCHS):
            for s in range(0, BATCH, mb):
                sl = slice(s, s + mb)
                x = obs[sl].permute(0, 3, 1, 2).float().div_(255.0)
                if chlast:
                    x = x.contiguous(memory_format=torch.channels_last)
                with ctx:
                    dist, v = model.forward(x)
                    loss = (-dist.log_prob(act[sl]).mean()
                            + 0.5 * ((v.squeeze(-1) - tgt[sl]) ** 2).mean())
                opt.zero_grad(set_to_none=True)
                loss.backward()
                opt.step()
        torch.cuda.synchronize()
        if r:
            t += time.perf_counter() - t0
    return t / reps


def time_rollout_infer(nb, chlast, total=24576, reps=3):
    model, _ = build(chlast)
    model.eval()
    obs = torch.randint(0, 255, (nb, 64, 64, 3), dtype=torch.uint8, device=dev)
    steps = total // nb
    t = 0.0
    for r in range(reps + 1):
        torch.cuda.synchronize(); t0 = time.perf_counter()
        with torch.no_grad():
            for _ in range(steps):
                x = obs.permute(0, 3, 1, 2).float().div_(255.0)
                if chlast:
                    x = x.contiguous(memory_format=torch.channels_last)
                model.act(x)
        torch.cuda.synchronize()
        if r:
            t += time.perf_counter() - t0
    return t / reps


print("UPDATE (3 epochs x 24,576, data reuse unchanged)")
best_u = None
for bf16, chlast, n_mb in itertools.product((False, True), (False, True), (8, 4)):
    s = time_update(bf16, chlast, n_mb)
    tag = f"bf16={int(bf16)} chlast={int(chlast)} n_mb={n_mb}"
    print(f"  {tag:32s} {s:7.4f}s")
    if best_u is None or s < best_u[0]:
        best_u = (s, tag)

print("\nROLLOUT inference for 24,576 transitions")
best_r = None
for nb in (192, 384, 768):
    for chlast in (False, True):
        s = time_rollout_infer(nb, chlast)
        tag = f"n_envs={nb} chlast={int(chlast)}"
        print(f"  {tag:32s} {s:7.4f}s")
        if best_r is None or s < best_r[0]:
            best_r = (s, tag)

BASE_U, BASE_RI, BASE_ENV, BASE_OTHER = 0.1479, 0.48, 0.18, 0.048   # breakout, measured
base_tot = BASE_U + BASE_RI + BASE_ENV + BASE_OTHER
print(f"\nbreakout baseline  {24576/base_tot:>9,.0f} sps  (measured 73,016)")
new_tot = best_u[0] + best_r[0] + BASE_ENV + BASE_OTHER
print(f"best knobs         {24576/new_tot:>9,.0f} sps   update[{best_u[1]}] rollout[{best_r[1]}]")
ov = best_u[0] + max(best_r[0], BASE_ENV) + BASE_OTHER
print(f"  + double buffer  {24576/ov:>9,.0f} sps")
print(f"update-only ceiling{24576/best_u[0]:>9,.0f} sps")
