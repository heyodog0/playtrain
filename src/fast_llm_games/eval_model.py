"""Evaluate a trained model on a game with train/test seed separation.

ProcGen-style evaluation:
  - Train seeds: 0-199 (levels the agent trained on)
  - Test seeds: 1000-1099 (held-out levels for generalization)

Usage:
    uv run python -m fast_llm_games.eval_model --game breakout --model outputs/experiments/breakout/ppo/.../final_model.zip
    uv run python -m fast_llm_games.eval_model --game breakout --model path/to/model.zip --mode test
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from stable_baselines3 import PPO, DQN
from stable_baselines3.common.vec_env import DummyVecEnv, VecMonitor, VecTransposeImage

from .game_gym_env import GameGymEnv

TRAIN_SEEDS = range(0, 200)
TEST_SEEDS = range(1000, 1100)

ALGO_MAP = {"ppo": PPO, "dqn": DQN}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate a trained model")
    parser.add_argument("--game", type=str, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--algorithm", choices=list(ALGO_MAP.keys()), default="ppo")
    parser.add_argument("--mode", choices=["train", "test", "both"], default="both")
    parser.add_argument("--episodes", type=int, default=50)
    parser.add_argument("--obs-size", type=int, default=64)
    parser.add_argument("--obs-mode", choices=["rgb", "gray"], default="rgb")
    parser.add_argument("--frame-stack", type=int, default=1)
    parser.add_argument("--max-steps", type=int, default=2000)
    parser.add_argument("--output", type=Path, default=None)
    return parser.parse_args()


def evaluate_seeds(
    model,
    game: str,
    seeds: list[int],
    *,
    obs_size: int,
    obs_mode: str,
    frame_stack: int,
    max_steps: int,
) -> dict:
    returns = []
    lengths = []

    for seed in seeds:
        env = GameGymEnv(
            game=game, obs_size=obs_size, obs_mode=obs_mode,
            frame_stack=frame_stack, max_steps=max_steps,
        )
        vec_env = DummyVecEnv([lambda: env])
        vec_env = VecTransposeImage(vec_env)

        obs = vec_env.reset()
        # Manually reset with specific seed
        raw_obs, info = env.reset(seed=seed)
        obs = vec_env.observation(np.expand_dims(
            np.transpose(raw_obs, (2, 0, 1)), axis=0
        )) if False else None

        # Simpler: use the raw env directly
        vec_env.close()

        env = GameGymEnv(
            game=game, obs_size=obs_size, obs_mode=obs_mode,
            frame_stack=frame_stack, max_steps=max_steps,
        )
        obs, info = env.reset(seed=seed)
        # Transpose for CNN policy: (H, W, C) -> (C, H, W)
        obs_t = np.transpose(obs, (2, 0, 1))

        episode_return = 0.0
        steps = 0
        while True:
            action, _ = model.predict(obs_t[np.newaxis], deterministic=True)
            obs, reward, terminated, truncated, info = env.step(int(action[0]))
            obs_t = np.transpose(obs, (2, 0, 1))
            episode_return += reward
            steps += 1
            if terminated or truncated:
                break

        returns.append(episode_return)
        lengths.append(steps)
        env.close()

    returns_arr = np.array(returns)
    lengths_arr = np.array(lengths)
    return {
        "episodes": len(seeds),
        "mean_return": float(returns_arr.mean()),
        "std_return": float(returns_arr.std()),
        "min_return": float(returns_arr.min()),
        "max_return": float(returns_arr.max()),
        "median_return": float(np.median(returns_arr)),
        "mean_length": float(lengths_arr.mean()),
        "per_episode": [
            {"seed": s, "return": float(r), "length": int(l)}
            for s, r, l in zip(seeds, returns, lengths)
        ],
    }


def main() -> None:
    args = parse_args()

    AlgoClass = ALGO_MAP[args.algorithm]
    model = AlgoClass.load(str(args.model))
    print(f"Loaded {args.algorithm.upper()} model from {args.model}")

    results = {"game": args.game, "model": str(args.model), "algorithm": args.algorithm}
    eval_kwargs = dict(
        obs_size=args.obs_size, obs_mode=args.obs_mode,
        frame_stack=args.frame_stack, max_steps=args.max_steps,
    )

    if args.mode in ("train", "both"):
        seeds = list(TRAIN_SEEDS[:args.episodes])
        print(f"\nEvaluating on {len(seeds)} train seeds...")
        train_results = evaluate_seeds(model, args.game, seeds, **eval_kwargs)
        results["train"] = train_results
        print(f"  Train: mean={train_results['mean_return']:.1f} +/- {train_results['std_return']:.1f}")

    if args.mode in ("test", "both"):
        seeds = list(TEST_SEEDS[:args.episodes])
        print(f"\nEvaluating on {len(seeds)} test seeds...")
        test_results = evaluate_seeds(model, args.game, seeds, **eval_kwargs)
        results["test"] = test_results
        print(f"  Test:  mean={test_results['mean_return']:.1f} +/- {test_results['std_return']:.1f}")

    if args.mode == "both" and "train" in results and "test" in results:
        gap = results["train"]["mean_return"] - results["test"]["mean_return"]
        print(f"\n  Generalization gap: {gap:.1f}")
        results["generalization_gap"] = gap

    results["timestamp"] = datetime.now(timezone.utc).isoformat()

    # Save results
    if args.output is None:
        args.output = args.model.parent / f"eval_{args.mode}.json"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(results, indent=2) + "\n")
    print(f"\nSaved to {args.output}")


if __name__ == "__main__":
    main()
