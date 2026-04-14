"""Train PPO on a single game using GameGymEnv.

Usage:
    uv run python -m fast_games.train.ppo --game breakout
    uv run python -m fast_games.train.ppo --game breakout --config configs/smoke_test.json
    uv run python -m fast_games.train.ppo --game breakout --use-wandb
"""

from __future__ import annotations

import argparse
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import EvalCallback
from stable_baselines3.common.vec_env import DummyVecEnv, SubprocVecEnv, VecMonitor, VecTransposeImage

from fast_games.env import GameGymEnv


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train PPO on a game")
    parser.add_argument("--game", type=str, required=True)
    parser.add_argument("--config", type=Path, default=None)

    # Environment
    parser.add_argument("--n-envs", type=int, default=4)
    parser.add_argument("--obs-size", type=int, default=64)
    parser.add_argument("--obs-mode", choices=["rgb", "gray"], default="rgb")
    parser.add_argument("--frame-stack", type=int, default=1)
    parser.add_argument("--max-steps", type=int, default=2000)

    # PPO hyperparameters
    parser.add_argument("--total-timesteps", type=int, default=1_000_000)
    parser.add_argument("--n-steps", type=int, default=256)
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--learning-rate", type=float, default=2.5e-4)
    parser.add_argument("--gamma", type=float, default=0.99)
    parser.add_argument("--gae-lambda", type=float, default=0.95)
    parser.add_argument("--ent-coef", type=float, default=0.01)
    parser.add_argument("--clip-range", type=float, default=0.2)
    parser.add_argument("--n-epochs", type=int, default=3)

    # Eval
    parser.add_argument("--eval-freq", type=int, default=10_000)
    parser.add_argument("--n-eval-episodes", type=int, default=5)

    # Output
    parser.add_argument("--output-dir", type=Path, default=None)

    # Experiment tracking
    parser.add_argument("--use-wandb", action="store_true")
    parser.add_argument("--wandb-project", type=str, default="fast-llm-games")

    return parser.parse_args()


def apply_config(args: argparse.Namespace) -> argparse.Namespace:
    if args.config is None:
        return args
    config = json.loads(args.config.read_text())
    for key, value in config.items():
        attr = key.replace("-", "_")
        if hasattr(args, attr):
            current = getattr(args, attr)
            if isinstance(current, Path):
                setattr(args, attr, Path(value))
            else:
                setattr(args, attr, value)
    return args


def make_env(game: str, **kwargs):
    def _init():
        return GameGymEnv(game=game, **kwargs)
    return _init


def main() -> None:
    args = apply_config(parse_args())

    # Output directory
    if args.output_dir is None:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        args.output_dir = Path(f"outputs/experiments/{args.game}/ppo/{timestamp}")
    args.output_dir.mkdir(parents=True, exist_ok=True)

    # Save config
    git_hash = "unknown"
    try:
        git_hash = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], stderr=subprocess.DEVNULL
        ).decode().strip()[:8]
    except Exception:
        pass

    config_snapshot = {
        "algorithm": "ppo",
        "game": args.game,
        "git_hash": git_hash,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "n_envs": args.n_envs,
        "obs_size": args.obs_size,
        "obs_mode": args.obs_mode,
        "frame_stack": args.frame_stack,
        "max_steps": args.max_steps,
        "total_timesteps": args.total_timesteps,
        "n_steps": args.n_steps,
        "batch_size": args.batch_size,
        "learning_rate": args.learning_rate,
        "gamma": args.gamma,
        "gae_lambda": args.gae_lambda,
        "ent_coef": args.ent_coef,
        "clip_range": args.clip_range,
        "n_epochs": args.n_epochs,
    }
    (args.output_dir / "config.json").write_text(json.dumps(config_snapshot, indent=2) + "\n")

    # Environment factory kwargs
    env_kwargs = dict(
        obs_size=args.obs_size,
        obs_mode=args.obs_mode,
        frame_stack=args.frame_stack,
        max_steps=args.max_steps,
    )

    # Create vectorized envs
    VecEnvClass = SubprocVecEnv if args.n_envs > 1 else DummyVecEnv
    env = VecEnvClass([make_env(args.game, **env_kwargs) for _ in range(args.n_envs)])
    env = VecMonitor(env, filename=str(args.output_dir / "train_monitor"))
    env = VecTransposeImage(env)

    eval_env = DummyVecEnv([make_env(args.game, **env_kwargs)])
    eval_env = VecMonitor(eval_env, filename=str(args.output_dir / "eval_monitor"))
    eval_env = VecTransposeImage(eval_env)

    # W&B
    callbacks = []
    if args.use_wandb:
        try:
            import wandb
            from wandb.integration.sb3 import WandbCallback

            wandb.init(
                project=args.wandb_project,
                config=config_snapshot,
                tags=["ppo", args.game],
                name=f"ppo-{args.game}",
                sync_tensorboard=True,
            )
            callbacks.append(WandbCallback(verbose=0))
        except ImportError:
            print("wandb not installed, skipping W&B logging. Install: uv pip install wandb")

    # Eval callback
    eval_callback = EvalCallback(
        eval_env,
        best_model_save_path=str(args.output_dir / "best_model"),
        log_path=str(args.output_dir / "eval"),
        eval_freq=max(args.eval_freq // args.n_envs, 1),
        n_eval_episodes=args.n_eval_episodes,
        deterministic=True,
        render=False,
    )
    callbacks.append(eval_callback)

    # Train
    model = PPO(
        "CnnPolicy",
        env,
        verbose=1,
        n_steps=args.n_steps,
        batch_size=args.batch_size,
        learning_rate=args.learning_rate,
        gamma=args.gamma,
        gae_lambda=args.gae_lambda,
        ent_coef=args.ent_coef,
        clip_range=args.clip_range,
        n_epochs=args.n_epochs,
        tensorboard_log=str(args.output_dir / "tb"),
        device="auto",
    )

    print(f"Training PPO on {args.game} for {args.total_timesteps} timesteps")
    print(f"  n_envs={args.n_envs}, obs={args.obs_size}x{args.obs_size} {args.obs_mode}")
    print(f"  output: {args.output_dir}")

    model.learn(total_timesteps=args.total_timesteps, callback=callbacks)

    # Save final model
    final_path = args.output_dir / "final_model"
    model.save(str(final_path))
    print(f"\nSaved final model to {final_path}.zip")
    print(f"Best model: {args.output_dir / 'best_model'}")

    env.close()
    eval_env.close()

    if args.use_wandb:
        try:
            import wandb
            wandb.finish()
        except Exception:
            pass


if __name__ == "__main__":
    main()
