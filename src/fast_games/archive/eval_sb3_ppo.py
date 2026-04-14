from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from stable_baselines3 import PPO

from .kazuki_gym_env import KazukiGymEnv


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate a trained SB3 PPO Kazuki model")
    parser.add_argument("--model-path", type=Path, required=True)
    parser.add_argument("--episodes", type=int, default=5)
    parser.add_argument("--max-steps", type=int, default=2000)
    parser.add_argument("--frame-stack", type=int, default=4)
    parser.add_argument("--obs-size", type=int, default=84)
    parser.add_argument("--output", type=Path, default=Path("outputs/evals/kazuki_eval_latest.json"))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)

    env = KazukiGymEnv(
        frame_stack=args.frame_stack,
        obs_size=args.obs_size,
        max_steps=args.max_steps,
    )
    model = PPO.load(str(args.model_path))

    episode_returns: list[float] = []
    episode_lengths: list[int] = []

    for episode_idx in range(args.episodes):
        obs, info = env.reset(seed=episode_idx)
        done = False
        truncated = False
        episode_return = 0.0
        episode_length = 0

        while not done and not truncated:
            action, _ = model.predict(obs, deterministic=True)
            obs, reward, done, truncated, info = env.step(int(action))
            episode_return += reward
            episode_length += 1

        episode_returns.append(episode_return)
        episode_lengths.append(episode_length)
        print(
            f"episode={episode_idx} return={episode_return:.2f} length={episode_length} final_state={info['gameState']} score={info['score']}"
        )

    summary = {
        "episodes": args.episodes,
        "model_path": str(args.model_path),
        "mean_return": float(np.mean(episode_returns)),
        "std_return": float(np.std(episode_returns)),
        "mean_length": float(np.mean(episode_lengths)),
        "returns": episode_returns,
        "lengths": episode_lengths,
    }
    args.output.write_text(json.dumps(summary, indent=2) + "\n")
    print(f"Saved eval summary to {args.output}")

    env.close()


if __name__ == "__main__":
    main()
