"""Training-loop A/B harness: NodeVecEnv vs SubprocVecEnv under realistic PPO timing.

Pure env benchmarks are misleading because the trainer also does GPU work
(forward, backward, optimizer step) between rollouts — GPU time dilutes any
env-side win. This harness mimics PPO's training-loop shape:

  for update in 1..U:
      rollout n_steps × n_envs steps  (env.step in a tight loop)
      do K "GPU update" passes        (real torch CNN OR time.sleep model)

Aggregate SPS = (U × n_steps × n_envs) / wall_time. That's the number analogen's
log lines actually print.

Two modes:
  --gpu-mode torch  : real small IMPALA-shaped CNN, forward+backward+adam.
                      Requires torch in the venv. Use on FASRC GPU node.
  --gpu-mode sleep  : time.sleep(--gpu-sim-ms / 1000.0) per minibatch update.
                      Use on Mac to estimate the env-side win under a known
                      GPU-blocked timing assumption.

Both arms run the same gpu-update path; the only thing that changes between
arms is which VecEnv class is used. Autoreset is on by default in both arms,
mirroring SB3 + the production training pipeline.
"""

from __future__ import annotations

import argparse
import statistics
import sys
import time
from typing import Any

import numpy as np


# ---------------------------------------------------------------------------
# Lazy torch import + a small CNN that approximates analogen's IMPALA body.
# Kept tiny (~50k params) so it fits in a CPU run too, and so per-update time
# is dominated by the rollout, not the GPU. Tune via --gpu-mode and --batch-size.
# ---------------------------------------------------------------------------

def _build_torch_model(in_channels: int, n_actions: int, device: str):
    import torch
    import torch.nn as nn
    class Body(nn.Module):
        def __init__(self):
            super().__init__()
            self.conv = nn.Sequential(
                nn.Conv2d(in_channels, 16, 3, padding=1), nn.ReLU(),
                nn.MaxPool2d(2),
                nn.Conv2d(16, 32, 3, padding=1), nn.ReLU(),
                nn.MaxPool2d(2),
                nn.Conv2d(32, 32, 3, padding=1), nn.ReLU(),
                nn.MaxPool2d(2),
            )
            self.head = nn.Sequential(
                nn.Flatten(),
                nn.Linear(32 * 8 * 8, 128), nn.ReLU(),
                nn.Linear(128, n_actions + 1),  # policy logits + value
            )
        def forward(self, x):
            return self.head(self.conv(x))
    return Body().to(device)


def _gpu_update_torch(model, optimizer, obs_batch, *, batch_size: int,
                      n_mini_epochs: int, device: str) -> float:
    """Run a PPO-shaped GPU update on the rollout. Returns wall_s."""
    import torch
    t0 = time.perf_counter()
    obs_t = torch.from_numpy(obs_batch).to(device).float() / 255.0
    # (T, N, H, W, C) → (T*N, C, H, W)
    if obs_t.dim() == 5:
        T, N, H, W, C = obs_t.shape
        obs_t = obs_t.permute(0, 1, 4, 2, 3).reshape(T * N, C, H, W)
    n_total = obs_t.shape[0]
    rng = np.random.default_rng(0)
    for _ in range(n_mini_epochs):
        idx = rng.permutation(n_total)
        for start in range(0, n_total, batch_size):
            sel = idx[start:start + batch_size]
            x = obs_t[sel]
            out = model(x)
            # Fake PPO loss: clipped policy + value. Just need real autograd flow.
            loss = (out.pow(2).mean() + out.mean())
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            optimizer.step()
    return time.perf_counter() - t0


def _gpu_update_sleep(*, n_mini_epochs: int, gpu_sim_ms: float) -> float:
    """Simulated GPU update: sleep for gpu_sim_ms per epoch."""
    t0 = time.perf_counter()
    time.sleep((gpu_sim_ms / 1000.0) * n_mini_epochs)
    return time.perf_counter() - t0


# ---------------------------------------------------------------------------
# Rollout loop — identical for both arms; only the VecEnv differs.
# ---------------------------------------------------------------------------


def collect_rollout(venv, *, n_envs: int, n_steps: int, action_rng) -> tuple[np.ndarray, float]:
    """Run n_steps of stepping on venv. Returns (rollout_obs, wall_s).
    rollout_obs is shape (n_steps, n_envs, H, W, C) for the GPU update.
    """
    H = W = 64
    C = 3
    obs_buf = np.empty((n_steps, n_envs, H, W, C), dtype=np.uint8)
    t0 = time.perf_counter()
    for t in range(n_steps):
        acts = action_rng.integers(0, 8, size=n_envs).tolist()
        obs, _, _, _, _ = venv.step(acts)
        # The NodeVecEnv reuses an internal buffer; copy is required.
        # SubprocVecEnv returns a freshly-stacked array — copy is cheap there.
        obs_buf[t] = obs
    return obs_buf, time.perf_counter() - t0


def run_trainloop(arm_label: str, venv, *, n_envs: int, n_steps: int,
                  n_updates: int, gpu_mode: str, gpu_sim_ms: float,
                  batch_size: int, n_mini_epochs: int, device: str) -> dict:
    print(f"\n[{arm_label}] training loop: "
          f"n_envs={n_envs} n_steps={n_steps} n_updates={n_updates} "
          f"gpu_mode={gpu_mode}")

    # Reset
    seeds = [i for i in range(n_envs)]
    if hasattr(venv, "reset"):
        # NodeVecEnv expects seeds kw; HandRolledSubprocVecEnv expects positional.
        try:
            venv.reset(seed=seeds)
        except TypeError:
            venv.reset(seeds)

    # Optional torch setup
    model = None
    optimizer = None
    if gpu_mode == "torch":
        import torch
        model = _build_torch_model(in_channels=3, n_actions=8, device=device)
        optimizer = torch.optim.Adam(model.parameters(), lr=2.5e-4)

    action_rng = np.random.default_rng(0)

    # Warmup: one rollout + update (catches first-pass cuda compile, etc.)
    warm_obs, _ = collect_rollout(venv, n_envs=n_envs, n_steps=n_steps,
                                  action_rng=action_rng)
    if gpu_mode == "torch":
        _gpu_update_torch(model, optimizer, warm_obs, batch_size=batch_size,
                          n_mini_epochs=n_mini_epochs, device=device)
    else:
        _gpu_update_sleep(n_mini_epochs=n_mini_epochs, gpu_sim_ms=gpu_sim_ms)

    # Measured loop
    env_walls: list[float] = []
    gpu_walls: list[float] = []
    t_start = time.perf_counter()
    for u in range(n_updates):
        obs_batch, env_wall = collect_rollout(
            venv, n_envs=n_envs, n_steps=n_steps, action_rng=action_rng)
        env_walls.append(env_wall)
        if gpu_mode == "torch":
            gpu_wall = _gpu_update_torch(
                model, optimizer, obs_batch,
                batch_size=batch_size, n_mini_epochs=n_mini_epochs, device=device)
        else:
            gpu_wall = _gpu_update_sleep(
                n_mini_epochs=n_mini_epochs, gpu_sim_ms=gpu_sim_ms)
        gpu_walls.append(gpu_wall)
    wall_total = time.perf_counter() - t_start

    total_env_steps = n_updates * n_steps * n_envs
    agg_sps = total_env_steps / wall_total
    mean_env_s = statistics.fmean(env_walls)
    mean_gpu_s = statistics.fmean(gpu_walls)
    return {
        "arm": arm_label,
        "n_envs": n_envs, "n_steps": n_steps, "n_updates": n_updates,
        "aggregate_sps": agg_sps,
        "wall_total_s": wall_total,
        "mean_env_s": mean_env_s,
        "mean_gpu_s": mean_gpu_s,
        "env_pct": 100.0 * sum(env_walls) / wall_total,
        "gpu_pct": 100.0 * sum(gpu_walls) / wall_total,
    }


def fmt(r: dict) -> str:
    return (f"  {r['arm']:<22}  "
            f"agg {r['aggregate_sps']:6.0f} sps  "
            f"wall {r['wall_total_s']:5.2f}s  "
            f"env {r['mean_env_s']*1000:6.1f} ms ({r['env_pct']:4.1f}%)  "
            f"gpu {r['mean_gpu_s']*1000:6.1f} ms ({r['gpu_pct']:4.1f}%)")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--n-envs", type=int, default=8)
    p.add_argument("--n-steps", type=int, default=128)
    p.add_argument("--n-updates", type=int, default=20)
    p.add_argument("--game", default="flappy_bird")
    p.add_argument("--obs-size", type=int, default=64)
    p.add_argument("--gpu-mode", choices=["torch", "sleep"], default="sleep",
                   help="'torch' for real CNN update; 'sleep' for time-modeled.")
    p.add_argument("--gpu-sim-ms", type=float, default=40.0,
                   help="(sleep mode) ms per minibatch epoch — model GPU compute.")
    p.add_argument("--batch-size", type=int, default=256,
                   help="(torch mode) minibatch size for PPO updates.")
    p.add_argument("--n-mini-epochs", type=int, default=4,
                   help="Minibatch epochs per update (PPO usually 4).")
    p.add_argument("--device", default="cuda",
                   help="(torch mode) cpu/cuda. Auto-falls-back to cpu if no cuda.")
    p.add_argument("--skip-subproc", action="store_true")
    p.add_argument("--skip-direct", action="store_true")
    p.add_argument("--summary-tsv", default=None,
                   help="If set, append summary rows to this TSV path.")
    args = p.parse_args()

    if args.gpu_mode == "torch":
        try:
            import torch
        except ImportError:
            print("ERROR: --gpu-mode torch but torch not installed. "
                  "Use --gpu-mode sleep or install torch.")
            return 2
        if args.device == "cuda" and not torch.cuda.is_available():
            print("NOTE: cuda requested but not available; falling back to cpu")
            args.device = "cpu"

    games = [args.game] * args.n_envs
    results: list[dict] = []

    print(f"\n=== Training-loop A/B: n_envs={args.n_envs} n_steps={args.n_steps} "
          f"n_updates={args.n_updates} game={args.game} "
          f"gpu_mode={args.gpu_mode} ===")

    if not args.skip_subproc:
        from node_gym._subproc_vec_env import HandRolledSubprocVecEnv
        venv = HandRolledSubprocVecEnv(games=games, obs_size=args.obs_size,
                                       autoreset=True, autoreset_seed=42)
        try:
            r = run_trainloop("SubprocVecEnv", venv,
                              n_envs=args.n_envs, n_steps=args.n_steps,
                              n_updates=args.n_updates, gpu_mode=args.gpu_mode,
                              gpu_sim_ms=args.gpu_sim_ms,
                              batch_size=args.batch_size,
                              n_mini_epochs=args.n_mini_epochs,
                              device=args.device)
            results.append(r)
            print(fmt(r))
        finally:
            venv.close()

    if not args.skip_direct:
        from node_gym import NodeVecEnv
        venv = NodeVecEnv(games=games, obs_size=args.obs_size,
                          autoreset_mode="same_step", autoreset_seed=42)
        try:
            r = run_trainloop("NodeVecEnv", venv,
                              n_envs=args.n_envs, n_steps=args.n_steps,
                              n_updates=args.n_updates, gpu_mode=args.gpu_mode,
                              gpu_sim_ms=args.gpu_sim_ms,
                              batch_size=args.batch_size,
                              n_mini_epochs=args.n_mini_epochs,
                              device=args.device)
            results.append(r)
            print(fmt(r))
        finally:
            venv.close()

    if len(results) == 2:
        sub, direct = results
        delta_sps = direct["aggregate_sps"] - sub["aggregate_sps"]
        delta_pct = 100.0 * delta_sps / sub["aggregate_sps"]
        print(f"\n  Δ aggregate sps : {delta_sps:+8.0f}  ({delta_pct:+5.1f}%)")
        print(f"  → NodeVecEnv {'wins' if delta_sps > 0 else 'loses'} "
              f"by {abs(delta_pct):.1f}% in real training-loop sps")

    if args.summary_tsv:
        # Append in TSV form for cross-job aggregation
        import os
        new_file = not os.path.exists(args.summary_tsv)
        with open(args.summary_tsv, "a") as f:
            if new_file:
                f.write("game\tn_envs\tn_steps\tn_updates\tgpu_mode\tarm\t"
                        "agg_sps\tmean_env_ms\tmean_gpu_ms\twall_s\n")
            for r in results:
                f.write(f"{args.game}\t{r['n_envs']}\t{r['n_steps']}\t"
                        f"{r['n_updates']}\t{args.gpu_mode}\t{r['arm']}\t"
                        f"{r['aggregate_sps']:.0f}\t"
                        f"{r['mean_env_s']*1000:.2f}\t"
                        f"{r['mean_gpu_s']*1000:.2f}\t"
                        f"{r['wall_total_s']:.2f}\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())
