from __future__ import annotations

import argparse
import json
from pathlib import Path

from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import EvalCallback
from stable_baselines3.common.vec_env import DummyVecEnv, VecMonitor, VecTransposeImage

from .kazuki_gym_env import KazukiGymEnv


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train a minimal SB3 PPO agent on KazukiEnv")
    parser.add_argument("--config", type=Path, default=None)
    parser.add_argument("--total-timesteps", type=int, default=50_000)
    parser.add_argument("--max-steps", type=int, default=2_000)
    parser.add_argument("--frame-stack", type=int, default=4)
    parser.add_argument("--obs-size", type=int, default=84)
    parser.add_argument("--n-steps", type=int, default=256)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--learning-rate", type=float, default=2.5e-4)
    parser.add_argument("--gamma", type=float, default=0.99)
    parser.add_argument("--eval-freq", type=int, default=2_048)
    parser.add_argument("--n-eval-episodes", type=int, default=5)
    parser.add_argument("--log-dir", type=Path, default=Path("outputs/sb3/kazuki"))
    parser.add_argument("--save-path", type=Path, default=Path("outputs/models/kazuki_ppo"))
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


def make_env(*, frame_stack: int, obs_size: int, max_steps: int):
    return lambda: KazukiGymEnv(
        frame_stack=frame_stack,
        obs_size=obs_size,
        max_steps=max_steps,
    )


def main() -> None:
    args = apply_config(parse_args())
    args.save_path.parent.mkdir(parents=True, exist_ok=True)
    args.log_dir.mkdir(parents=True, exist_ok=True)

    env = DummyVecEnv(
        [make_env(frame_stack=args.frame_stack, obs_size=args.obs_size, max_steps=args.max_steps)]
    )
    env = VecMonitor(env, filename=str(args.log_dir / "train_monitor.csv"))
    env = VecTransposeImage(env)

    eval_env = DummyVecEnv(
        [make_env(frame_stack=args.frame_stack, obs_size=args.obs_size, max_steps=args.max_steps)]
    )
    eval_env = VecMonitor(eval_env, filename=str(args.log_dir / "eval_monitor.csv"))
    eval_env = VecTransposeImage(eval_env)

    model = PPO(
        "CnnPolicy",
        env,
        verbose=1,
        n_steps=args.n_steps,
        batch_size=args.batch_size,
        learning_rate=args.learning_rate,
        gamma=args.gamma,
        device="auto",
    )
    eval_callback = EvalCallback(
        eval_env,
        best_model_save_path=str(args.log_dir / "best_model"),
        log_path=str(args.log_dir / "eval"),
        eval_freq=args.eval_freq,
        n_eval_episodes=args.n_eval_episodes,
        deterministic=True,
        render=False,
    )

    model.learn(total_timesteps=args.total_timesteps, callback=eval_callback)
    model.save(str(args.save_path))
    env.close()
    eval_env.close()
    print(f"Saved model to {args.save_path}.zip")
    print(f"Train monitor: {args.log_dir / 'train_monitor.csv'}")
    print(f"Eval logs: {args.log_dir / 'eval'}")


if __name__ == "__main__":
    main()
