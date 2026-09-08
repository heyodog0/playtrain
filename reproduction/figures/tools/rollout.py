"""Roll out a trained CleanRL ActorCritic checkpoint and (optionally) save GIFs.

Foundation for downstream visualizations (trajectory plots, action heatmaps,
side-by-side comparisons). Anything that needs trained-agent rollouts should
import `rollout_episodes` from this module rather than re-implement loading.

Usage:
    # quick stats on 20 random-seed episodes
    uv run python tools/rollout.py --ckpt outputs/ppo_12596508/final.pt --n 20

    # one GIF of the best episode out of 50 trials
    uv run python tools/rollout.py --ckpt outputs/ppo_12596508/final.pt --n 50 \\
        --gif outputs/figs/cross_run/v1_drops_best.gif

    # save every episode's GIF (sweep for the demo reel)
    uv run python tools/rollout.py --ckpt outputs/ppo_12596508/final.pt --n 10 \\
        --gif-dir outputs/figs/rollouts/v1_drops/

    # deterministic argmax instead of stochastic sampling
    uv run python tools/rollout.py --ckpt ... --n 5 --deterministic

    # override game (e.g. evaluate v1+drops weights on v2)
    uv run python tools/rollout.py --ckpt outputs/ppo_12596508/final.pt --n 20 \\
        --game analogen_nomemory_grid_v2
"""
from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
from PIL import Image

from playtrain.runtime import PlayTrainEnv
from playtrain_trainers.policy import ActorCritic


# Reward floor that counts as a "win". The grid games give +50000 + lives*10000
# on victory; any non-win episode-return is well under this.
WIN_THRESHOLD = 30_000


@dataclass
class EpisodeResult:
    seed: int
    total_return: float
    length: int
    terminated: bool
    truncated: bool
    won: bool
    frames: list[np.ndarray]  # (H, W, 3) uint8 per env step


def pick_device(spec: str = "auto") -> torch.device:
    if spec == "auto":
        if torch.cuda.is_available():
            return torch.device("cuda")
        if torch.backends.mps.is_available():
            return torch.device("mps")
        return torch.device("cpu")
    return torch.device(spec)


def load_policy(ckpt_path: Path, env: PlayTrainEnv, device: torch.device) -> ActorCritic:
    """Load a CleanRL ActorCritic checkpoint compatible with the given env."""
    H, W, C = env.observation_space.shape
    n_actions = int(env.action_space.n)
    model = ActorCritic(n_actions=n_actions, in_channels=C, input_hw=H).to(device)
    payload = torch.load(ckpt_path, map_location=device, weights_only=False)
    model.load_state_dict(payload["model"])
    model.eval()
    return model


def rollout_one(
    model: ActorCritic,
    env: PlayTrainEnv,
    seed: int,
    max_steps: int,
    device: torch.device,
    deterministic: bool,
) -> EpisodeResult:
    obs, _ = env.reset(seed=seed)
    frames: list[np.ndarray] = [_obs_to_rgb(obs, env)]
    total = 0.0
    terminated = truncated = False
    steps = 0

    for _ in range(max_steps):
        # Trainer feeds the policy as (B, C, H, W); env emits (H, W, C). Match the
        # trainer's permute so we hit the same conv weights. np.array(obs) forces
        # a writable copy — silences the from_numpy non-writable UserWarning.
        obs_t = torch.tensor(np.array(obs), device=device).permute(2, 0, 1).unsqueeze(0)
        with torch.no_grad():
            dist, _ = model(obs_t)
            action = int(dist.probs.argmax(dim=-1).item()) if deterministic \
                else int(dist.sample().item())
        obs, reward, terminated, truncated, _ = env.step(action)
        total += float(reward)
        steps += 1
        frames.append(_obs_to_rgb(obs, env))
        if terminated or truncated:
            break

    return EpisodeResult(
        seed=seed,
        total_return=total,
        length=steps,
        terminated=terminated,
        truncated=truncated,
        won=total > WIN_THRESHOLD,
        frames=frames,
    )


def _obs_to_rgb(obs: np.ndarray, env) -> np.ndarray:
    """Extract the latest single RGB frame from a (possibly stacked) obs.

    PlayTrainEnv exposes `frame_stack` and `obs_mode`. MiniGrid / other gymnasium
    envs don't — they emit a single RGB frame directly, so fall through.
    """
    if not hasattr(env, "frame_stack") or not hasattr(env, "obs_mode"):
        return obs  # already (H, W, 3) for gymnasium pipelines
    if env.frame_stack == 1 and env.obs_mode == "rgb":
        return obs  # (H, W, 3)
    # Frame-stacked rgb: last 3 channels are the most recent frame.
    if env.obs_mode == "rgb":
        return obs[..., -3:]
    # Grayscale variants: tile to 3 channels for visualization.
    last = obs[..., -1] if obs.ndim == 3 else obs
    return np.stack([last] * 3, axis=-1)


def save_gif(frames: list[np.ndarray], out_path: Path, scale: int, fps: int) -> None:
    """Write frames as a GIF or MP4 (routed by file extension).

    Long episodes (>~50 frames of low-variance gameplay) silently truncate
    when written as GIF — every GIF backend we tried (PIL direct, imageio
    v2.mimsave, imageio v3.imwrite, with/without subrectangles/palettesize)
    saved only ~24-56 frames of a 2000-step rollout. The root cause is
    PIL's GIF encoder, which all of imageio's GIF paths route through.

    The robust fix is to write MP4 via ffmpeg. Pass --gif foo.mp4 (or
    --gif-dir with .mp4 suffix in the filenames) to get a complete video.
    The .gif path is kept for short clips and back-compat.
    """
    import imageio.v2 as iio
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if scale != 1:
        scaled = []
        for f in frames:
            img = Image.fromarray(f, mode="RGB").resize(
                (f.shape[1] * scale, f.shape[0] * scale), Image.NEAREST)
            scaled.append(np.asarray(img))
        frames = scaled
    if str(out_path).lower().endswith(".mp4"):
        # ffmpeg via imageio-ffmpeg. macro_block_size=1 lets us write odd
        # resolutions (default rounds to multiples of 16).
        iio.mimsave(out_path, frames, fps=fps, macro_block_size=1, codec="libx264",
                    quality=8)
    else:
        iio.mimsave(out_path, frames, duration=1.0 / fps, loop=0)
        if len(frames) > 50:
            print(f"[rollout] WARNING: GIF backend may truncate {len(frames)} "
                  f"frames. Use --gif {out_path.with_suffix('.mp4')} for full video.")


def rollout_episodes(
    ckpt_path: Path,
    *,
    game: str | None = None,
    seeds: list[int] | None = None,
    n_episodes: int = 10,
    max_steps: int = 2000,
    deterministic: bool = False,
    device_spec: str = "auto",
) -> tuple[list[EpisodeResult], PlayTrainEnv]:
    """Library entry point. Returns (results, env). Caller owns env.close()."""
    payload = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    src_cfg = payload.get("config", {})
    if game is None:
        game = src_cfg.get("game")
    if game is None:
        raise ValueError("checkpoint has no 'game' in config; pass --game")

    device = pick_device(device_spec)
    obs_size = int(src_cfg.get("obs_size", 64)) if isinstance(src_cfg, dict) else 64
    # Dispatch by env_backend in the checkpoint config. Defaults to node_gym
    # for back-compat with older checkpoints that didn't set this field.
    backend = src_cfg.get("env_backend", "playtrain") if isinstance(src_cfg, dict) else "playtrain"
    if backend == "minigrid":
        from analogen.minigrid_env import make_minigrid_env
        env = make_minigrid_env(game, seed=0)
    else:
        env = PlayTrainEnv(game=game, max_steps=max_steps, obs_size=obs_size)
    model = load_policy(ckpt_path, env, device)
    print(f"[rollout] ckpt={ckpt_path} game={game} device={device} "
          f"obs={env.observation_space.shape} actions={env.action_space.n}")

    if seeds is None:
        rng = np.random.default_rng(0)
        seeds = [int(s) for s in rng.integers(0, 1_000_000, size=n_episodes)]

    results: list[EpisodeResult] = []
    for i, s in enumerate(seeds):
        r = rollout_one(model, env, s, max_steps, device, deterministic)
        results.append(r)
        verdict = "WIN" if r.won else ("DIED" if r.terminated else "TIMEOUT")
        print(f"  ep {i+1}/{len(seeds)}  seed={s:>7}  return={r.total_return:>9.0f}  "
              f"len={r.length:>5}  {verdict}")

    return results, env


def summarize(results: list[EpisodeResult]) -> None:
    n = len(results)
    if n == 0:
        print("[rollout] no episodes")
        return
    rets = np.array([r.total_return for r in results])
    lens = np.array([r.length for r in results])
    wins = sum(r.won for r in results)
    print(f"\n[rollout] {n} episodes")
    print(f"  win rate:  {wins}/{n} = {wins/n:.0%}")
    print(f"  return:    mean={rets.mean():.0f}  median={np.median(rets):.0f}  "
          f"min={rets.min():.0f}  max={rets.max():.0f}")
    print(f"  length:    mean={lens.mean():.0f}  median={np.median(lens):.0f}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ckpt", required=True, type=Path,
                    help="Path to .pt or dir containing final.pt")
    ap.add_argument("--game", default=None,
                    help="Override game name from checkpoint config")
    ap.add_argument("--n", "--n-episodes", dest="n_episodes", type=int, default=10)
    ap.add_argument("--seeds", default=None,
                    help="Comma-separated env seeds (overrides --n)")
    ap.add_argument("--fixed-seed", type=int, default=None,
                    help="Use this seed for ALL episodes (sanity / determinism check)")
    ap.add_argument("--max-steps", type=int, default=2000)
    ap.add_argument("--deterministic", action="store_true",
                    help="argmax actions instead of sampling")
    ap.add_argument("--device", default="auto")

    ap.add_argument("--gif", type=Path, default=None,
                    help="Save the BEST episode (highest return) to this path")
    ap.add_argument("--gif-dir", type=Path, default=None,
                    help="Save EVERY episode as a separate GIF in this dir")
    ap.add_argument("--scale", type=int, default=4,
                    help="Nearest-neighbor upscale factor for GIF (default 4 -> 256px)")
    ap.add_argument("--fps", type=int, default=15,
                    help="GIF playback fps (default 15)")
    ap.add_argument("--save-json", type=Path, default=None,
                    help="Write per-episode summary (no frames) to this JSON")
    args = ap.parse_args()

    if args.ckpt.is_dir():
        args.ckpt = args.ckpt / "final.pt"

    if args.seeds is not None:
        seeds = [int(s) for s in args.seeds.split(",")]
    elif args.fixed_seed is not None:
        seeds = [args.fixed_seed] * args.n_episodes
    else:
        seeds = None

    results, env = rollout_episodes(
        args.ckpt,
        game=args.game,
        seeds=seeds,
        n_episodes=args.n_episodes,
        max_steps=args.max_steps,
        deterministic=args.deterministic,
        device_spec=args.device,
    )
    try:
        summarize(results)

        if args.gif is not None:
            best = max(results, key=lambda r: r.total_return)
            print(f"\n[rollout] saving best episode (seed={best.seed}, "
                  f"return={best.total_return:.0f}) -> {args.gif}")
            save_gif(best.frames, args.gif, scale=args.scale, fps=args.fps)

        if args.gif_dir is not None:
            print(f"\n[rollout] saving {len(results)} episodes -> {args.gif_dir}/")
            for i, r in enumerate(results):
                tag = "win" if r.won else ("died" if r.terminated else "to")
                fname = f"ep{i:02d}_seed{r.seed}_ret{int(r.total_return)}_{tag}.gif"
                save_gif(r.frames, args.gif_dir / fname,
                         scale=args.scale, fps=args.fps)

        if args.save_json is not None:
            payload = [
                {"seed": r.seed, "return": r.total_return, "length": r.length,
                 "terminated": r.terminated, "truncated": r.truncated, "won": r.won}
                for r in results
            ]
            args.save_json.parent.mkdir(parents=True, exist_ok=True)
            args.save_json.write_text(json.dumps(payload, indent=2))
            print(f"[rollout] wrote {args.save_json}")
    finally:
        env.close()


if __name__ == "__main__":
    main()
