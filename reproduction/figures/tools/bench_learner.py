"""Learner-only / inference-only throughput benchmark for IMPALA.

Answers "what can the trainer consume, with no actors attached?" — the number
that decides how much batch/precision/compile work the 200k-SPS target needs.

Learner mode: synthetic (T+1, B) batches through the REAL learn() (V-trace,
RMSprop, grad clip), sweeping batch size x precision x torch.compile. Reports
learn steps/s and frames/s (= T*B per learn step). --h2d times the
pinned-CPU -> GPU copy as part of each step (models the real pipeline, where
rollouts arrive in CPU shared memory).

Inference mode: policy forward at rollout-batch sizes, eager vs CUDA graphs —
the number that sizes the vectorized-actor design.

    python tools/bench_learner.py --mode learner --batch-sizes 8,16,32,64
    python tools/bench_learner.py --mode inference --batch-sizes 64,128,256
    python tools/bench_learner.py --mode both --out outputs/bench_learner.json

Numbers to care about (H100): frames/s in learner mode >= the SPS target;
inference us/frame * target SPS << 1 GPU.
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import torch

from playtrain_trainers.impala.learn import learn
from playtrain_trainers.impala.net import ImpalaNet


def _device(spec: str) -> torch.device:
    if spec != "auto":
        return torch.device(spec)
    if torch.cuda.is_available():
        return torch.device("cuda")
    if torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


def _sync(device: torch.device) -> None:
    if device.type == "cuda":
        torch.cuda.synchronize()
    elif device.type == "mps":
        torch.mps.synchronize()


def make_batch(T: int, B: int, obs_shape, num_actions: int, device,
               pin: bool = False) -> dict:
    """Synthetic batch matching train._get_batch output: (T+1, B, ...)."""
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
        "action": torch.randint(0, num_actions, (T + 1, B), dtype=torch.int64,
                                generator=g),
    }
    if pin:
        return {k: v.pin_memory() for k, v in batch.items()}
    return {k: v.to(device) for k, v in batch.items()}


def bench_learner(device, obs_shape, num_actions, T, B, *, precision="fp32",
                  compile_model=False, compile_mode="default",
                  channels_last=False, use_lstm=False, h2d=False, iters=30,
                  warmup=8) -> dict:
    torch.manual_seed(0)
    if device.type == "cuda":
        # tf32 toggles are global; set per-config, restore after.
        torch.backends.cuda.matmul.allow_tf32 = precision in ("tf32", "bf16")
        torch.backends.cudnn.allow_tf32 = precision in ("tf32", "bf16")
    model = ImpalaNet(obs_shape, num_actions, use_lstm=use_lstm,
                      channels_last=channels_last).to(device)
    if channels_last:
        model = model.to(memory_format=torch.channels_last)
    if compile_model:
        model = torch.compile(model, mode=compile_mode)
    optimizer = torch.optim.RMSprop(model.parameters(), lr=4.8e-4,
                                    momentum=0.0, eps=0.01, alpha=0.99)
    host_batch = make_batch(T, B, obs_shape, num_actions, device,
                            pin=h2d and device.type == "cuda")
    init_state = (tuple(t.to(device) for t in model.initial_state(B))
                  if use_lstm else ())

    autocast = (
        torch.autocast(device_type=device.type, dtype=torch.bfloat16)
        if precision == "bf16"
        else torch.autocast(device_type=device.type, enabled=False)
    )

    def one_step():
        if h2d:
            batch = {k: v.to(device, non_blocking=True)
                     for k, v in host_batch.items()}
        else:
            batch = host_batch
        with autocast:
            learn(actor_model=None, learner_model=model, batch=batch,
                  initial_agent_state=tuple(t.clone() for t in init_state),
                  optimizer=optimizer, scheduler=None,
                  discounting=0.99, baseline_cost=0.5, entropy_cost=0.0006,
                  grad_norm_clipping=40.0, reward_clipping="abs_one")

    for _ in range(warmup):
        one_step()
    _sync(device)
    t0 = time.perf_counter()
    for _ in range(iters):
        one_step()
    _sync(device)
    dt = time.perf_counter() - t0
    steps_s = iters / dt
    return {
        "mode": "learner", "T": T, "B": B, "precision": precision,
        "use_lstm": use_lstm,
        "compile": compile_model, "compile_mode": compile_mode,
        "channels_last": channels_last, "h2d": h2d,
        "learn_steps_per_s": round(steps_s, 2),
        "frames_per_s": round(steps_s * T * B),
        "ms_per_learn": round(1000 * dt / iters, 2),
    }


def bench_inference(device, obs_shape, num_actions, B, *, cuda_graphs=False,
                    iters=200, warmup=20) -> dict:
    torch.manual_seed(0)
    model = ImpalaNet(obs_shape, num_actions).to(device)
    model.train()  # multinomial sampling — matches the rollout policy

    inputs = {
        "frame": torch.randint(0, 256, (1, B, *obs_shape), dtype=torch.uint8,
                               device=device),
        "reward": torch.randn(1, B, device=device),
        "done": torch.zeros(1, B, dtype=torch.bool, device=device),
        "last_action": torch.randint(0, num_actions, (1, B),
                                     dtype=torch.int64, device=device),
    }

    if cuda_graphs:
        if device.type != "cuda":
            return {"mode": "inference", "B": B, "cuda_graphs": True,
                    "skipped": f"no CUDA graphs on {device.type}"}
        # Warm up on a side stream, then capture one forward. Replay = one
        # kernel-graph launch instead of per-op Python dispatch.
        s = torch.cuda.Stream()
        s.wait_stream(torch.cuda.current_stream())
        with torch.cuda.stream(s), torch.no_grad():
            for _ in range(3):
                model(inputs, ())
        torch.cuda.current_stream().wait_stream(s)
        graph = torch.cuda.CUDAGraph()
        with torch.no_grad(), torch.cuda.graph(graph):
            static_out, _ = model(inputs, ())

        def one_step():
            graph.replay()
    else:
        def one_step():
            with torch.no_grad():
                model(inputs, ())

    for _ in range(warmup):
        one_step()
    _sync(device)
    t0 = time.perf_counter()
    for _ in range(iters):
        one_step()
    _sync(device)
    dt = time.perf_counter() - t0
    per_fwd_ms = 1000 * dt / iters
    return {
        "mode": "inference", "B": B, "cuda_graphs": cuda_graphs,
        "ms_per_forward": round(per_fwd_ms, 3),
        "frames_per_s": round(B * iters / dt),
    }


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--mode", choices=("learner", "inference", "both"),
                   default="both")
    p.add_argument("--device", default="auto")
    p.add_argument("--obs-shape", default="3,64,64")
    p.add_argument("--num-actions", type=int, default=8)
    p.add_argument("--unroll", type=int, default=80)
    p.add_argument("--batch-sizes", default="8,16,32,64")
    p.add_argument("--inference-batch-sizes", default="64,128,256")
    p.add_argument("--precision", default="fp32,tf32,bf16",
                   help="comma list; non-CUDA devices run fp32 only")
    p.add_argument("--compile", default="0,1",
                   help="comma list of 0/1 for torch.compile sweep")
    p.add_argument("--compile-modes", default="default",
                   help="comma list of torch.compile modes tried when "
                        "compile=1: default,reduce-overhead,max-autotune")
    p.add_argument("--channels-last", default="0",
                   help="comma list of 0/1: NHWC memory format sweep")
    p.add_argument("--use-lstm", action="store_true",
                   help="bench the LSTM learner (segment-wise unroll)")
    p.add_argument("--h2d", action="store_true",
                   help="include pinned-CPU->GPU batch copy in each learn step")
    p.add_argument("--iters", type=int, default=30)
    p.add_argument("--out", type=Path, default=None)
    args = p.parse_args()

    device = _device(args.device)
    obs_shape = tuple(int(x) for x in args.obs_shape.split(","))
    print(f"device={device} obs_shape={obs_shape} unroll={args.unroll}")

    precisions = args.precision.split(",")
    if device.type != "cuda":
        precisions = ["fp32"]
    compiles = [bool(int(x)) for x in args.compile.split(",")]

    cl_values = [bool(int(x)) for x in args.channels_last.split(",")]
    rows = []
    if args.mode in ("learner", "both"):
        for B in (int(x) for x in args.batch_sizes.split(",")):
            for prec in precisions:
                for comp in compiles:
                    modes = args.compile_modes.split(",") if comp else ["default"]
                    for cmode in modes:
                        for cl in cl_values:
                            try:
                                r = bench_learner(
                                    device, obs_shape, args.num_actions,
                                    args.unroll, B, precision=prec,
                                    compile_model=comp, compile_mode=cmode,
                                    channels_last=cl,
                                    use_lstm=args.use_lstm,
                                    h2d=args.h2d, iters=args.iters)
                            except Exception as e:  # noqa: BLE001
                                r = {"mode": "learner", "B": B,
                                     "precision": prec, "compile": comp,
                                     "compile_mode": cmode,
                                     "channels_last": cl,
                                     "error": repr(e)[:200]}
                            rows.append(r)
                            print(r, flush=True)
    if args.mode in ("inference", "both"):
        for B in (int(x) for x in args.inference_batch_sizes.split(",")):
            for graphs in (False, True):
                try:
                    r = bench_inference(device, obs_shape, args.num_actions,
                                        B, cuda_graphs=graphs)
                except Exception as e:  # noqa: BLE001
                    r = {"mode": "inference", "B": B, "cuda_graphs": graphs,
                         "error": repr(e)[:200]}
                rows.append(r)
                print(r)

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(
            {"device": str(device), "torch": torch.__version__, "rows": rows},
            indent=2))
        print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
