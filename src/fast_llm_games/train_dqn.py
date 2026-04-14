"""Train DQN on a single game using GameGymEnv.

DQN is a natural fit for Discrete(8) action spaces. Off-policy with
replay buffer — trades sample efficiency for memory usage.

Usage:
    uv run python -m fast_llm_games.train_dqn --game breakout
    uv run python -m fast_llm_games.train_dqn --game breakout --config configs/smoke_test.json
"""

from __future__ import annotations

import argparse
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from stable_baselines3 import DQN
from stable_baselines3.common.callbacks import EvalCallback
from stable_baselines3.common.vec_env import DummyVecEnv, VecMonitor, VecTransposeImage

from .game_gym_env import GameGymEnv


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train DQN on a game")
    parser.add_argument("--game", type=str, required=True)
    parser.add_argument("--config", type=Path, default=None)

    # Environment
    parser.add_argument("--obs-size", type=int, default=64)
    parser.add_argument("--obs-mode", choices=["rgb", "gray"], default="rgb")
    parser.add_argument("--frame-stack", type=int, default=1)
    parser.add_argument("--max-steps", type=int, default=2000)

    # DQN hyperparameters
    parser.add_argument("--total-timesteps", type=int, default=1_000_000)
    parser.add_argument("--learning-rate", type=float, default=1e-4)
    parser.add_argument("--buffer-size", type=int, default=100_000)
    parser.add_argument("--learning-starts", type=int, default=10_000)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--gamma", type=float, default=0.99)
    parser.add_argument("--target-update-interval", type=int, default=1000)
    parser.add_argument("--train-freq", type=int, default=4)
    parser.add_argument("--exploration-fraction", type=float, default=0.1)
    parser.add_argument("--exploration-final-eps", type=float, default=0.01)

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


def main() -> None:
    args = apply_config(parse_args())

    if args.output_dir is None:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        args.output_dir = Path(f"outputs/experiments/{args.game}/dqn/{timestamp}")
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
        "algorithm": "dqn",
        "game": args.game,
        "git_hash": git_hash,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "obs_size": args.obs_size,
        "obs_mode": args.obs_mode,
        "frame_stack": args.frame_stack,
        "max_steps": args.max_steps,
        "total_timesteps": args.total_timesteps,
        "learning_rate": args.learning_rate,
        "buffer_size": args.buffer_size,
        "learning_starts": args.learning_starts,
        "batch_size": args.batch_size,
        "gamma": args.gamma,
        "target_update_interval": args.target_update_interval,
        "train_freq": args.train_freq,
        "exploration_fraction": args.exploration_fraction,
        "exploration_final_eps": args.exploration_final_eps,
    }
    (args.output_dir / "config.json").write_text(json.dumps(config_snapshot, indent=2) + "\n")

    env_kwargs = dict(
        obs_size=args.obs_size,
        obs_mode=args.obs_mode,
        frame_stack=args.frame_stack,
        max_steps=args.max_steps,
    )

    # DQN uses a single env (off-policy, replay buffer handles sample reuse)
    env = DummyVecEnv([lambda: GameGymEnv(game=args.game, **env_kwargs)])
    env = VecMonitor(env, filename=str(args.output_dir / "train_monitor"))
    env = VecTransposeImage(env)

    eval_env = DummyVecEnv([lambda: GameGymEnv(game=args.game, **env_kwargs)])
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
                tags=["dqn", args.game],
                name=f"dqn-{args.game}",
                sync_tensorboard=True,
            )
            callbacks.append(WandbCallback(verbose=0))
        except ImportError:
            print("wandb not installed, skipping. Install: uv pip install wandb")

    eval_callback = EvalCallback(
        eval_env,
        best_model_save_path=str(args.output_dir / "best_model"),
        log_path=str(args.output_dir / "eval"),
        eval_freq=args.eval_freq,
        n_eval_episodes=args.n_eval_episodes,
        deterministic=True,
        render=False,
    )
    callbacks.append(eval_callback)

    model = DQN(
        "CnnPolicy",
        env,
        verbose=1,
        learning_rate=args.learning_rate,
        buffer_size=args.buffer_size,
        learning_starts=args.learning_starts,
        batch_size=args.batch_size,
        gamma=args.gamma,
        target_update_interval=args.target_update_interval,
        train_freq=args.train_freq,
        exploration_fraction=args.exploration_fraction,
        exploration_final_eps=args.exploration_final_eps,
        tensorboard_log=str(args.output_dir / "tb"),
        device="auto",
    )

    print(f"Training DQN on {args.game} for {args.total_timesteps} timesteps")
    print(f"  buffer_size={args.buffer_size}, learning_starts={args.learning_starts}")
    print(f"  output: {args.output_dir}")

    model.learn(total_timesteps=args.total_timesteps, callback=callbacks)

    final_path = args.output_dir / "final_model"
    model.save(str(final_path))
    print(f"\nSaved final model to {final_path}.zip")

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
