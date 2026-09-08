"""Render greedy-argmax rollout GIFs for a list of env seeds, on a (possibly
variant) env, reproducing the eval faithfully (frame_skip + max_decisions cap).

Used to inspect cavequest_easy N=300 failure modes: point it at a finesweep run
dir, a visual condition's env, and the failing seeds (from the per_seed eval).
Agent-view (64px) upscaled for visibility — this is exactly what the policy sees.

Usage:
  uv run python tools/render_failure_rollouts.py \
      --run-dir outputs/impala_cavequest_finesweep_rand_N300_s0 \
      --game analogen_cavequest_easy_recolor \
      --seeds 158 181 182 --max-decisions 200 --scale 4 \
      --out-dir outputs/figs/n300_failures/recolor_s0 --tag recolor_s0
"""
from __future__ import annotations
import argparse, sys
from pathlib import Path

import numpy as np
import imageio.v2 as imageio
import torch

_REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_REPO / "tools"))
from make_run_card import load_policy, find_checkpoint, rollout_one  # noqa: E402
from playtrain.runtime import PlayTrainEnv  # noqa: E402

from analogen import bindings_8x8 as B  # noqa: E402


def keyvid(seed: int) -> int:
    tool = B.role_binding(seed)["tool"]
    return next(int(v) for v, r in tool.items() if r == "BLUE_KEY")


def upscale(frames, scale):
    if scale <= 1:
        return frames
    return [np.kron(f, np.ones((scale, scale, 1), dtype=f.dtype)) for f in frames]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--run-dir", type=Path, required=True)
    p.add_argument("--game", required=True, help="env to render on (variant ok)")
    p.add_argument("--seeds", type=int, nargs="+", required=True)
    p.add_argument("--max-decisions", type=int, default=200)
    p.add_argument("--frame-skip", type=int, default=7)
    p.add_argument("--scale", type=int, default=4)
    p.add_argument("--fps", type=int, default=12)
    p.add_argument("--out-dir", type=Path, required=True)
    p.add_argument("--tag", default="fail")
    p.add_argument("--temperature", type=float, default=None,
                   help="decoding temperature: None/0 = greedy argmax, >0 = "
                        "sample from softmax(logits/T). T=0.5 is the cqhe peak.")
    args = p.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)
    device = torch.device("cpu")
    env = PlayTrainEnv(game=args.game, max_steps=args.max_decisions * args.frame_skip,
                     frame_skip=args.frame_skip)
    try:
        ckpt = find_checkpoint(args.run_dir)
        policy = load_policy(ckpt, env, device)
        print(f"loaded {policy.method} lstm={policy.use_lstm} on {args.game}")
        rows = []
        for seed in args.seeds:
            ep = rollout_one(policy, env, seed=seed, device=device,
                             deterministic=(args.temperature is None or args.temperature <= 0),
                             temperature=args.temperature,
                             max_steps=args.max_decisions)
            kv = keyvid(seed)
            outcome = "WIN" if ep["won"] else "fail"
            name = f"{args.tag}_seed{seed}_key{kv}_{outcome}_ret{int(ep['total_return'])}_len{ep['length']}.gif"
            frames = upscale(ep["frames"], args.scale)
            imageio.mimsave(args.out_dir / name, frames, fps=args.fps)
            rows.append((seed, kv, ep["total_return"], ep["length"], ep["won"]))
            print(f"  seed={seed} key=id{kv} ret={ep['total_return']:.0f} "
                  f"len={ep['length']} won={ep['won']} -> {name}")
    finally:
        env.close()
    nwin = sum(1 for r in rows if r[4])
    print(f"DONE {len(rows)} rollouts ({nwin} unexpectedly WON) -> {args.out_dir}")


if __name__ == "__main__":
    main()
