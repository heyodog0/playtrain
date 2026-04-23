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

    # Architecture / normalization (paper-comparable defaults; flip off for ablations)
    parser.add_argument("--impala-cnn", dest="impala_cnn", action="store_true", default=True)
    parser.add_argument("--no-impala-cnn", dest="impala_cnn", action="store_false")
    parser.add_argument("--norm-reward", dest="norm_reward", action="store_true", default=True)
    parser.add_argument("--no-norm-reward", dest="norm_reward", action="store_false")

    # Reproducibility
    parser.add_argument("--seed", type=int, default=None)

    # Dual eval (train-set + test-set)
    parser.add_argument("--dual-eval", dest="dual_eval", action="store_true", default=True,
                        help="Evaluate on both train and test seed ranges (default: on)")
    parser.add_argument("--no-dual-eval", dest="dual_eval", action="store_false")

    # Output
    parser.add_argument("--output-dir", type=Path, default=None)

    # Experiment tracking
    parser.add_argument("--use-wandb", action="store_true")
    parser.add_argument("--wandb-project", type=str, default="fast-llm-games")

    return parser.parse_args()


def main() -> None:
    args = apply_config(parse_args())
    seed_everything(args.seed)

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
        "impala_cnn": args.impala_cnn,
        "norm_reward": args.norm_reward,
        "dual_eval": args.dual_eval,
        "seed": args.seed,
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
    env = wrap_vecnormalize_train(env, norm_reward=args.norm_reward, gamma=args.gamma)

    # Eval env (test): held-out seed range, 1 env per game — raw rewards
    eval_test = make_multigame_vec_env(
        games,
        n_envs_per_game=1,
        seed_range=TEST_SEEDS,
        use_subproc=False,
        **env_kwargs,
    )
    eval_test = VecMonitor(eval_test, filename=str(args.output_dir / "eval_test_monitor"))
    eval_test = VecTransposeImage(eval_test)
    eval_test = wrap_vecnormalize_eval(eval_test, enabled=args.norm_reward, gamma=args.gamma)

    # Eval env (train): same seed range as training rollouts — Fig 4 generalization gap
    eval_train = None
    if args.dual_eval:
        eval_train = make_multigame_vec_env(
            games,
            n_envs_per_game=1,
            seed_range=TRAIN_SEEDS,
            use_subproc=False,
            **env_kwargs,
        )
        eval_train = VecMonitor(eval_train, filename=str(args.output_dir / "eval_train_monitor"))
        eval_train = VecTransposeImage(eval_train)
        eval_train = wrap_vecnormalize_eval(eval_train, enabled=args.norm_reward, gamma=args.gamma)

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
    # Test-set eval: writes best_model/, eval/ (held-out seeds — the headline metric)
    callbacks.append(
        make_eval_callback(
            eval_test, args.output_dir,
            eval_freq=args.eval_freq, n_eval_episodes=args.n_eval_episodes,
            n_envs=n_total_envs,
        )
    )
    # Train-set eval: writes eval_train/ — for the train/test generalization gap (Fig 4)
    if eval_train is not None:
        from stable_baselines3.common.callbacks import EvalCallback
        callbacks.append(
            EvalCallback(
                eval_train,
                best_model_save_path=None,
                log_path=str(args.output_dir / "eval_train"),
                eval_freq=max(args.eval_freq // max(n_total_envs, 1), 1),
                n_eval_episodes=args.n_eval_episodes,
                deterministic=True,
                render=False,
            )
        )

    # Adjust batch_size to be divisible by n_total_envs * n_steps
    rollout_size = n_total_envs * args.n_steps
    batch_size = min(args.batch_size, rollout_size)

    policy_kwargs = impala_policy_kwargs() if args.impala_cnn else None
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
        policy_kwargs=policy_kwargs,
        seed=args.seed,
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
    save_vecnormalize(env, args.output_dir)
    print(f"\nSaved final model to {final_path}.zip")

    env.close()
    eval_test.close()
    if eval_train is not None:
        eval_train.close()
    finish_wandb(args.use_wandb)


if __name__ == "__main__":
    main()
