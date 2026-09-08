"""Kernel/phase profile of the IMPALA learner update — where do the 72ms go?

Companion to tools/bench_learner.py (same synthetic batches, same production
recipe: bf16 + torch.compile + channels_last + LSTM + pinned h2d). Two passes:

  1. PHASE pass — CUDA-event timing of the update's phases (h2d copy,
     model forward, V-trace + losses, backward, grad-clip + RMSprop step),
     compiled with the production mode (default max-autotune) so the total
     matches the measured ~177k frames/s ceiling. Per-phase sync each iter
     adds a little overhead; the split is what matters.

  2. KERNEL pass — torch.profiler top kernels by self-CUDA time, compiled
     with max-autotune-no-cudagraphs (same kernel mix, individually
     launched, so CUPTI attribution is clean), aggregated into crude
     categories (conv / gemm / fused-elementwise / optimizer / memcpy).

The question this answers: how much of the update is stage-1-ish conv +
activation traffic (reclaimable by a hand-fused persistent-CNN kernel) vs
LSTM/optimizer/other (not reclaimable by that kernel).

    uv run python tools/profile_learner.py --unroll 200 --batch 64 \
        --out outputs/profile_learner_T200.txt
"""
from __future__ import annotations

import argparse
import time
from pathlib import Path

import torch
from torch import nn

from playtrain_trainers.impala import losses, vtrace
from playtrain_trainers.impala.net import ImpalaNet


def make_batch(T, B, obs_shape, num_actions, pin: bool) -> dict:
    g = torch.Generator().manual_seed(0)
    batch = {
        "frame": torch.randint(0, 256, (T + 1, B, *obs_shape),
                               dtype=torch.uint8, generator=g),
        "reward": torch.randn(T + 1, B, generator=g),
        "done": torch.rand(T + 1, B, generator=g) < 0.0002,
        "episode_return": torch.randn(T + 1, B, generator=g),
        "episode_step": torch.randint(0, 1000, (T + 1, B), dtype=torch.int32,
                                      generator=g),
        "policy_logits": torch.randn(T + 1, B, num_actions, generator=g),
        "baseline": torch.randn(T + 1, B, generator=g),
        "last_action": torch.randint(0, num_actions, (T + 1, B),
                                     dtype=torch.int64, generator=g),
        "action": torch.randint(0, num_actions, (T + 1, B),
                                dtype=torch.int64, generator=g),
    }
    return {k: (v.pin_memory() if pin else v) for k, v in batch.items()}


def build(obs_shape, num_actions, use_lstm, compile_mode, device):
    model = ImpalaNet(obs_shape, num_actions, use_lstm=use_lstm,
                      channels_last=True).to(device)
    model = model.to(memory_format=torch.channels_last)
    if compile_mode:
        model = torch.compile(model, mode=compile_mode)
    opt = torch.optim.RMSprop(model.parameters(), lr=4.8e-4, momentum=0.0,
                              eps=0.01, alpha=0.99)
    return model, opt


def loss_from_outputs(batch, learner_outputs):
    """learn() body from the forward outputs to total_loss (abs_one clip)."""
    bootstrap_value = learner_outputs["baseline"][-1]
    batch = {k: t[1:] for k, t in batch.items()}
    learner_outputs = {k: t[:-1] for k, t in learner_outputs.items()}
    rewards = torch.clamp(batch["reward"], -1, 1)
    discounts = (~batch["done"]).float() * 0.99
    vt = vtrace.from_logits(
        behavior_policy_logits=batch["policy_logits"],
        target_policy_logits=learner_outputs["policy_logits"],
        actions=batch["action"],
        discounts=discounts,
        rewards=rewards,
        values=learner_outputs["baseline"],
        bootstrap_value=bootstrap_value,
    )
    pg_loss = losses.compute_policy_gradient_loss(
        learner_outputs["policy_logits"], batch["action"], vt.pg_advantages)
    baseline_loss = 0.5 * losses.compute_baseline_loss(
        vt.vs - learner_outputs["baseline"])
    entropy_loss = 0.0006 * losses.compute_entropy_loss(
        learner_outputs["policy_logits"])
    return pg_loss + baseline_loss + entropy_loss


def one_step(model, opt, host, init_state, device, autocast, phases=None):
    """One full learn-equivalent update. If `phases` is a list, CUDA events
    are recorded around each phase and (name, e0, e1) triples appended."""
    def mark():
        e = torch.cuda.Event(enable_timing=True)
        e.record()
        return e

    e0 = mark()
    batch = {k: v.to(device, non_blocking=True) for k, v in host.items()}
    e1 = mark()
    with autocast:
        outputs, _ = model(batch, tuple(t.clone() for t in init_state))
        e2 = mark()
        total_loss = loss_from_outputs(batch, outputs)
    e3 = mark()
    opt.zero_grad()
    total_loss.backward()
    e4 = mark()
    nn.utils.clip_grad_norm_(model.parameters(), 40.0)
    opt.step()
    e5 = mark()
    if phases is not None:
        torch.cuda.synchronize()
        for name, a, b in [("h2d", e0, e1), ("forward", e1, e2),
                           ("vtrace+loss", e2, e3), ("backward", e3, e4),
                           ("clip+optim", e4, e5)]:
            phases.append((name, a.elapsed_time(b)))


CATEGORIES = [
    ("conv", ("conv", "cudnn", "implicit_gemm", "winograd", "wgrad", "dgrad")),
    ("gemm/matmul", ("gemm", "cutlass", "nvjet", "_mm_", "matmul", "mm_")),
    ("lstm-ish", ("lstm", "rnn", "sigmoid", "tanh")),
    ("optimizer/clip", ("multi_tensor", "foreach", "rmsprop", "norm")),
    ("memcpy", ("memcpy", "memset")),
]


def categorize(name: str) -> str:
    low = name.lower()
    for cat, keys in CATEGORIES:
        if any(k in low for k in keys):
            return cat
    return "fused-elementwise/other"


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--unroll", type=int, default=200)
    p.add_argument("--batch", type=int, default=64)
    p.add_argument("--obs", type=int, default=64)
    p.add_argument("--num-actions", type=int, default=8)
    p.add_argument("--no-lstm", action="store_true")
    p.add_argument("--compile-mode", default="max-autotune")
    p.add_argument("--iters", type=int, default=20)
    p.add_argument("--warmup", type=int, default=8)
    p.add_argument("--skip-kernels", action="store_true",
                   help="phase pass only (saves the second compile)")
    p.add_argument("--out", type=Path, default=None)
    args = p.parse_args()

    device = torch.device("cuda")
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True
    obs_shape = (3, args.obs, args.obs)
    T, B = args.unroll, args.batch
    use_lstm = not args.no_lstm
    host = make_batch(T, B, obs_shape, args.num_actions, pin=True)
    autocast = torch.autocast(device_type="cuda", dtype=torch.bfloat16)
    lines = [f"profile_learner T={T} B={B} obs={args.obs} lstm={use_lstm} "
             f"bf16+{args.compile_mode}+channels_last, "
             f"{torch.cuda.get_device_name(0)}, torch={torch.__version__}"]

    # ---- pass 1: phase decomposition (production compile mode) ----
    model, opt = build(obs_shape, args.num_actions, use_lstm,
                       args.compile_mode, device)
    init_state = (tuple(t.to(device) for t in model.initial_state(B))
                  if use_lstm else ())
    t0 = time.perf_counter()
    for _ in range(args.warmup):
        one_step(model, opt, host, init_state, device, autocast)
    torch.cuda.synchronize()
    lines.append(f"[phase pass] warmup+compile {time.perf_counter()-t0:.0f}s")

    phases: list[tuple[str, float]] = []
    t0 = time.perf_counter()
    for _ in range(args.iters):
        one_step(model, opt, host, init_state, device, autocast, phases)
    wall_ms = 1000 * (time.perf_counter() - t0) / args.iters
    agg: dict[str, float] = {}
    for name, ms in phases:
        agg[name] = agg.get(name, 0.0) + ms / args.iters
    total = sum(agg.values())
    lines.append(f"[phase pass] {wall_ms:.1f} ms/step wall (incl per-phase "
                 f"sync) -> {round(T*B/wall_ms*1000):,} frames/s")
    for name, ms in agg.items():
        lines.append(f"  {name:<12} {ms:7.2f} ms  {100*ms/total:5.1f}%")

    # ---- pass 2: kernel table (no-cudagraphs for clean attribution) ----
    if not args.skip_kernels:
        kmode = ("max-autotune-no-cudagraphs"
                 if "max-autotune" in args.compile_mode else args.compile_mode)
        model2, opt2 = build(obs_shape, args.num_actions, use_lstm, kmode,
                             device)
        t0 = time.perf_counter()
        for _ in range(args.warmup):
            one_step(model2, opt2, host, init_state, device, autocast)
        torch.cuda.synchronize()
        lines.append(f"[kernel pass] compile({kmode}) "
                     f"{time.perf_counter()-t0:.0f}s")
        from torch.profiler import ProfilerActivity, profile
        with profile(activities=[ProfilerActivity.CPU, ProfilerActivity.CUDA],
                     record_shapes=False) as prof:
            for _ in range(6):
                one_step(model2, opt2, host, init_state, device, autocast)
            torch.cuda.synchronize()
        evs = [e for e in prof.key_averages()
               if e.self_device_time_total > 0 and e.device_time_total > 0]
        cats: dict[str, float] = {}
        ktotal = sum(e.self_device_time_total for e in evs) / 1000 / 6
        for e in evs:
            c = categorize(e.key)
            cats[c] = cats.get(c, 0.0) + e.self_device_time_total / 1000 / 6
        lines.append(f"[kernel pass] {ktotal:.1f} ms/step of GPU kernel time; "
                     "by category:")
        for c, ms in sorted(cats.items(), key=lambda kv: -kv[1]):
            lines.append(f"  {c:<24} {ms:7.2f} ms  {100*ms/ktotal:5.1f}%")
        lines.append("[kernel pass] top 30 kernels by self CUDA time "
                     "(ms/step):")
        for e in sorted(evs, key=lambda e: -e.self_device_time_total)[:30]:
            ms = e.self_device_time_total / 1000 / 6
            lines.append(f"  {ms:8.3f} ms  x{e.count // 6:<4} "
                         f"{e.key[:110]}")

    report = "\n".join(lines)
    print(report, flush=True)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(report + "\n")
        print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
