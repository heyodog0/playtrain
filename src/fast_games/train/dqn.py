"""Train DQN on a single game using GameGymEnv.

DQN is a natural fit for Discrete(8) action spaces. Off-policy with
replay buffer — trades sample efficiency for memory usage.

Usage:
    uv run python -m fast_games.train.dqn --game breakout
    uv run python -m fast_games.train.dqn --game breakout --config configs/smoke_test.json
"""

from __future__ import annotations

import argparse
from pathlib import Path

from stable_baselines3 import DQN
from stable_baselines3.common.vec_env import DummyVecEnv, VecMonitor, VecTransposeImage

from fast_games.env import GameGymEnv
from fast_games.train._common import (
    apply_config,
    common_timestamp,
    finish_wandb,
    get_git_hash,
    make_eval_callback,
    make_output_dir,
    setup_wandb,
    write_config_snapshot,
)


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

    # Reproducibility
    parser.add_argument("--seed", type=int, default=None)

    # Output
    parser.add_argument("--output-dir", type=Path, default=None)

    # Experiment tracking
    parser.add_argument("--use-wandb", action="store_true")
    parser.add_argument("--wandb-project", type=str, default="fast-llm-games")

    return parser.parse_args()


def main() -> None:
    args = apply_config(parse_args())
    args.output_dir = make_output_dir(args.game, "dqn", args.output_dir)
    seed_everything(args.seed)

    config_snapshot = {
        "algorithm": "dqn",
        "game": args.game,
        "git_hash": get_git_hash(),
        "timestamp": common_timestamp(),
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
        "seed": args.seed,
    }
    write_config_snapshot(args.output_dir, config_snapshot)

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

    callbacks = []
    wandb_cb = setup_wandb(
        enabled=args.use_wandb,
        project=args.wandb_project,
        config_snapshot=config_snapshot,
        tags=["dqn", args.game],
        run_name=f"dqn-{args.game}",
    )
    if wandb_cb is not None:
        callbacks.append(wandb_cb)
    callbacks.append(
        make_eval_callback(
            eval_env, args.output_dir,
            eval_freq=args.eval_freq, n_eval_episodes=args.n_eval_episodes,
            n_envs=1,
        )
    )

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
        seed=args.seed,
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
    finish_wandb(args.use_wandb)


if __name__ == "__main__":
    main()
