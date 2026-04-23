"""ProcGen-style multi-game PPO training.

Train a single CNN policy across multiple games simultaneously.
Each parallel env instance is permanently assigned one game.
On reset, the same game continues with a new procedural seed.

Usage:
    uv run python -m fast_games.train.multigame --all-games
    uv run python -m fast_games.train.multigame --games breakout flappy_bird mario
    uv run python -m fast_games.train.multigame --all-games --config configs/smoke_test.json
"""

from __future__ import annotations

import argparse
from pathlib import Path

from stable_baselines3 import PPO
from stable_baselines3.common.vec_env import VecMonitor, VecTransposeImage

from fast_games.env import list_available_games, make_multigame_vec_env
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

# ProcGen seed ranges
TRAIN_SEEDS = (0, 200)
TEST_SEEDS = (1000, 1100)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Multi-game ProcGen-style PPO training")

    # Game selection
    game_group = parser.add_mutually_exclusive_group(required=True)
    game_group.add_argument("--games", nargs="+", type=str, help="List of game names")
    game_group.add_argument("--all-games", action="store_true", help="Use all available games")

    parser.add_argument("--config", type=Path, default=None)

    # Environment
    parser.add_argument("--n-envs-per-game", type=int, default=1)
    parser.add_argument("--obs-size", type=int, default=64)
    parser.add_argument("--obs-mode", choices=["rgb", "gray"], default="rgb")
    parser.add_argument("--frame-stack", type=int, default=1)
    parser.add_argument("--max-steps", type=int, default=2000)

    # PPO hyperparameters (ProcGen paper defaults)
    parser.add_argument("--total-timesteps", type=int, default=25_000_000)
    parser.add_argument("--n-steps", type=int, default=256)
    parser.add_argument("--batch-size", type=int, default=2048)
    parser.add_argument("--learning-rate", type=float, default=5e-4)
    parser.add_argument("--gamma", type=float, default=0.999)
    parser.add_argument("--gae-lambda", type=float, default=0.95)
    parser.add_argument("--ent-coef", type=float, default=0.01)
    parser.add_argument("--clip-range", type=float, default=0.2)
    parser.add_argument("--n-epochs", type=int, default=3)

    # Eval
    parser.add_argument("--eval-freq", type=int, default=50_000)
    parser.add_argument("--n-eval-episodes", type=int, default=5)

    # Output
    parser.add_argument("--output-dir", type=Path, default=None)

    # Experiment tracking
    parser.add_argument("--use-wandb", action="store_true")
    parser.add_argument("--wandb-project", type=str, default="fast-llm-games")

    return parser.parse_args()


def main() -> None:
    args = apply_config(parse_args())

    games = list_available_games() if args.all_games else args.games
    n_total_envs = len(games) * args.n_envs_per_game

    args.output_dir = make_output_dir("multigame", "ppo", args.output_dir)

    config_snapshot = {
        "algorithm": "ppo",
        "mode": "multigame",
        "games": games,
        "n_games": len(games),
        "n_envs_per_game": args.n_envs_per_game,
        "n_total_envs": n_total_envs,
        "git_hash": get_git_hash(),
        "timestamp": common_timestamp(),
        "train_seed_range": list(TRAIN_SEEDS),
        "test_seed_range": list(TEST_SEEDS),
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
    write_config_snapshot(args.output_dir, config_snapshot)

    env_kwargs = dict(
        obs_size=args.obs_size,
        obs_mode=args.obs_mode,
        frame_stack=args.frame_stack,
        max_steps=args.max_steps,
    )

    # Training env: train seed range
    env = make_multigame_vec_env(
        games,
        n_envs_per_game=args.n_envs_per_game,
        seed_range=TRAIN_SEEDS,
        use_subproc=(n_total_envs > 1),
        **env_kwargs,
    )
    env = VecMonitor(env, filename=str(args.output_dir / "train_monitor"))
    env = VecTransposeImage(env)

    # Eval env: test seed range (held-out levels), 1 env per game
    eval_env = make_multigame_vec_env(
        games,
        n_envs_per_game=1,
        seed_range=TEST_SEEDS,
        use_subproc=False,
        **env_kwargs,
    )
    eval_env = VecMonitor(eval_env, filename=str(args.output_dir / "eval_monitor"))
    eval_env = VecTransposeImage(eval_env)

    callbacks = []
    wandb_cb = setup_wandb(
        enabled=args.use_wandb,
        project=args.wandb_project,
        config_snapshot=config_snapshot,
        tags=["ppo", "multigame", f"{len(games)}games"],
        run_name=f"ppo-multigame-{len(games)}g",
    )
    if wandb_cb is not None:
        callbacks.append(wandb_cb)
    callbacks.append(
        make_eval_callback(
            eval_env, args.output_dir,
            eval_freq=args.eval_freq, n_eval_episodes=args.n_eval_episodes,
            n_envs=n_total_envs,
        )
    )

    # Adjust batch_size to be divisible by n_total_envs * n_steps
    rollout_size = n_total_envs * args.n_steps
    batch_size = min(args.batch_size, rollout_size)

    model = PPO(
        "CnnPolicy",
        env,
        verbose=1,
        n_steps=args.n_steps,
        batch_size=batch_size,
        learning_rate=args.learning_rate,
        gamma=args.gamma,
        gae_lambda=args.gae_lambda,
        ent_coef=args.ent_coef,
        clip_range=args.clip_range,
        n_epochs=args.n_epochs,
        tensorboard_log=str(args.output_dir / "tb"),
        device="auto",
    )

    print(f"Multi-game PPO training")
    print(f"  Games ({len(games)}): {', '.join(games)}")
    print(f"  Envs: {n_total_envs} ({args.n_envs_per_game} per game)")
    print(f"  Total timesteps: {args.total_timesteps:,}")
    print(f"  Rollout size: {rollout_size}, batch_size: {batch_size}")
    print(f"  Train seeds: {TRAIN_SEEDS}, Test seeds: {TEST_SEEDS}")
    print(f"  Output: {args.output_dir}")

    model.learn(total_timesteps=args.total_timesteps, callback=callbacks)

    final_path = args.output_dir / "final_model"
    model.save(str(final_path))
    print(f"\nSaved final model to {final_path}.zip")

    env.close()
    eval_env.close()
    finish_wandb(args.use_wandb)


if __name__ == "__main__":
    main()
