"""Train PPO on a single game using GameGymEnv.

Usage:
    uv run python -m fast_games.train.ppo --game breakout
    uv run python -m fast_games.train.ppo --game breakout --config configs/smoke_test.json
    uv run python -m fast_games.train.ppo --game breakout --use-wandb
"""

from __future__ import annotations

import argparse
from pathlib import Path

from stable_baselines3 import PPO
from stable_baselines3.common.vec_env import DummyVecEnv, SubprocVecEnv, VecMonitor, VecTransposeImage

from fast_games.env import GameGymEnv
from fast_games.policy import impala_policy_kwargs
from fast_games.train._common import (
    apply_config,
    common_timestamp,
    finish_wandb,
    get_git_hash,
    make_eval_callback,
    make_output_dir,
    save_vecnormalize,
    seed_everything,
    setup_wandb,
    wrap_vecnormalize_eval,
    wrap_vecnormalize_train,
    write_config_snapshot,
)


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

    # Architecture / normalization (paper-comparable defaults; flip off for ablations)
    parser.add_argument("--impala-cnn", dest="impala_cnn", action="store_true", default=True)
    parser.add_argument("--no-impala-cnn", dest="impala_cnn", action="store_false")
    parser.add_argument("--norm-reward", dest="norm_reward", action="store_true", default=True)
    parser.add_argument("--no-norm-reward", dest="norm_reward", action="store_false")

    # Reproducibility
    parser.add_argument("--seed", type=int, default=None)

    # Output
    parser.add_argument("--output-dir", type=Path, default=None)

    # Experiment tracking
    parser.add_argument("--use-wandb", action="store_true")
    parser.add_argument("--wandb-project", type=str, default="fast-llm-games")

    return parser.parse_args()


def make_env(game: str, **kwargs):
    def _init():
        return GameGymEnv(game=game, **kwargs)
    return _init


def main() -> None:
    args = apply_config(parse_args())
    args.output_dir = make_output_dir(args.game, "ppo", args.output_dir)
    seed_everything(args.seed)

    config_snapshot = {
        "algorithm": "ppo",
        "game": args.game,
        "git_hash": get_git_hash(),
        "timestamp": common_timestamp(),
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
        "impala_cnn": args.impala_cnn,
        "norm_reward": args.norm_reward,
        "seed": args.seed,
    }
    write_config_snapshot(args.output_dir, config_snapshot)

    env_kwargs = dict(
        obs_size=args.obs_size,
        obs_mode=args.obs_mode,
        frame_stack=args.frame_stack,
        max_steps=args.max_steps,
    )

    VecEnvClass = SubprocVecEnv if args.n_envs > 1 else DummyVecEnv
    env = VecEnvClass([make_env(args.game, **env_kwargs) for _ in range(args.n_envs)])
    env = VecMonitor(env, filename=str(args.output_dir / "train_monitor"))
    env = VecTransposeImage(env)
    env = wrap_vecnormalize_train(env, norm_reward=args.norm_reward, gamma=args.gamma)

    eval_env = DummyVecEnv([make_env(args.game, **env_kwargs)])
    eval_env = VecMonitor(eval_env, filename=str(args.output_dir / "eval_monitor"))
    eval_env = VecTransposeImage(eval_env)
    eval_env = wrap_vecnormalize_eval(eval_env, enabled=args.norm_reward, gamma=args.gamma)

    callbacks = []
    wandb_cb = setup_wandb(
        enabled=args.use_wandb,
        project=args.wandb_project,
        config_snapshot=config_snapshot,
        tags=["ppo", args.game],
        run_name=f"ppo-{args.game}",
    )
    if wandb_cb is not None:
        callbacks.append(wandb_cb)
    callbacks.append(
        make_eval_callback(
            eval_env, args.output_dir,
            eval_freq=args.eval_freq, n_eval_episodes=args.n_eval_episodes,
            n_envs=args.n_envs,
        )
    )

    policy_kwargs = impala_policy_kwargs() if args.impala_cnn else None
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
        policy_kwargs=policy_kwargs,
        seed=args.seed,
        tensorboard_log=str(args.output_dir / "tb"),
        device="auto",
    )

    print(f"Training PPO on {args.game} for {args.total_timesteps} timesteps")
    print(f"  n_envs={args.n_envs}, obs={args.obs_size}x{args.obs_size} {args.obs_mode}")
    print(f"  output: {args.output_dir}")

    model.learn(total_timesteps=args.total_timesteps, callback=callbacks)

    final_path = args.output_dir / "final_model"
    model.save(str(final_path))
    save_vecnormalize(env, args.output_dir)
    print(f"\nSaved final model to {final_path}.zip")
    print(f"Best model: {args.output_dir / 'best_model'}")

    env.close()
    eval_env.close()
    finish_wandb(args.use_wandb)


if __name__ == "__main__":
    main()
