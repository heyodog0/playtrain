"""Validate all games against ProcGen-style criteria.

Runs 5 checks on each game:
  1. Gymnasium API compliance (check_env)
  2. Determinism (same seed + actions = identical trajectories)
  3. Observation sanity (shape, dtype, range, non-degeneracy)
  4. Reward and terminal correctness
  5. Step throughput (FPS)

Usage:
    uv run python -m fast_games.validate.validate --all
    uv run python -m fast_games.validate.validate --game breakout
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from fast_games.env import GameGymEnv

SEED = 42
NUM_STEPS = 200
GAMES_DIR = Path(__file__).resolve().parents[3] / "games" / "js"
OUTPUT_DIR = Path(__file__).resolve().parents[3] / "outputs" / "validation"


def list_games() -> list[str]:
    return sorted(p.stem for p in GAMES_DIR.glob("*.js"))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate games against ProcGen-style criteria")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--game", type=str, help="Single game to validate")
    group.add_argument("--all", action="store_true", help="Validate all games")
    parser.add_argument("--skip-throughput", action="store_true", help="Skip throughput benchmark")
    return parser.parse_args()


# ---------------------------------------------------------------------------
# Random policy for better coverage than fixed LEFT/RIGHT
# ---------------------------------------------------------------------------

def random_action(rng: np.random.Generator) -> int:
    return int(rng.integers(0, 8))


# ---------------------------------------------------------------------------
# Trajectory collection
# ---------------------------------------------------------------------------

def collect_trajectory(game: str, seed: int, num_steps: int) -> dict:
    env = GameGymEnv(game=game, max_steps=num_steps + 100)
    try:
        obs, info = env.reset(seed=seed)
        observations = [obs.copy()]
        actions: list[int] = []
        rewards: list[float] = []
        terminated_flags: list[bool] = []
        truncated_flags: list[bool] = []
        infos: list[dict] = [info]

        # Use seeded RNG for reproducible random actions
        rng = np.random.default_rng(seed)
        for i in range(num_steps):
            action = random_action(rng)
            obs, reward, terminated, truncated, info = env.step(action)
            actions.append(action)
            observations.append(obs.copy())
            rewards.append(reward)
            terminated_flags.append(terminated)
            truncated_flags.append(truncated)
            infos.append(info)
            if terminated or truncated:
                break

        return {
            "observations": observations,
            "actions": actions,
            "rewards": rewards,
            "terminated": terminated_flags,
            "truncated": truncated_flags,
            "infos": infos,
            "steps": len(rewards),
        }
    finally:
        env.close()


# ---------------------------------------------------------------------------
# Check 1: API compliance
# ---------------------------------------------------------------------------

def check_api_compliance(game: str) -> tuple[bool, str]:
    from gymnasium.utils.env_checker import check_env

    env = GameGymEnv(game=game)
    try:
        check_env(env.unwrapped, skip_render_check=True)
        return True, "check_env passed"
    except Exception as exc:
        return False, f"check_env failed: {exc}"
    finally:
        env.close()


# ---------------------------------------------------------------------------
# Check 2: Determinism
# ---------------------------------------------------------------------------

def check_determinism(game: str) -> tuple[bool, str]:
    traj_a = collect_trajectory(game, SEED, NUM_STEPS)
    traj_b = collect_trajectory(game, SEED, NUM_STEPS)

    if traj_a["steps"] != traj_b["steps"]:
        return False, f"step count mismatch: {traj_a['steps']} vs {traj_b['steps']}"

    steps = traj_a["steps"]
    for i in range(steps):
        obs_match = np.array_equal(traj_a["observations"][i + 1], traj_b["observations"][i + 1])
        rew_match = traj_a["rewards"][i] == traj_b["rewards"][i]
        term_match = traj_a["terminated"][i] == traj_b["terminated"][i]
        trunc_match = traj_a["truncated"][i] == traj_b["truncated"][i]
        score_match = traj_a["infos"][i + 1]["score"] == traj_b["infos"][i + 1]["score"]

        if not all([obs_match, rew_match, term_match, trunc_match, score_match]):
            mismatches = []
            if not obs_match:
                mismatches.append("obs")
            if not rew_match:
                mismatches.append("reward")
            if not term_match:
                mismatches.append("terminated")
            if not trunc_match:
                mismatches.append("truncated")
            if not score_match:
                mismatches.append("score")
            return False, f"diverge at step {i}: {', '.join(mismatches)}"

    return True, f"{steps} steps deterministic (seed={SEED})"


# ---------------------------------------------------------------------------
# Check 3: Observation sanity
# ---------------------------------------------------------------------------

def check_observation_sanity(game: str) -> tuple[bool, str]:
    env = GameGymEnv(game=game)
    try:
        obs, _ = env.reset(seed=SEED)
        issues = []

        expected_shape = (64, 64, 3)
        if obs.shape != expected_shape:
            issues.append(f"shape {obs.shape} != {expected_shape}")
        if obs.dtype != np.uint8:
            issues.append(f"dtype {obs.dtype} != uint8")
        if obs.min() < 0 or obs.max() > 255:
            issues.append(f"range [{obs.min()}, {obs.max()}] outside [0,255]")
        if obs.max() == 0:
            issues.append("all-black observation after reset")
        if np.unique(obs).size < 5:
            issues.append(f"only {np.unique(obs).size} unique values (degenerate)")

        # Check frames change over time (across all channels — single-channel
        # checks miss blue-on-black scenes whose red channel is constant)
        initial_frame = obs.copy()
        rng = np.random.default_rng(SEED)
        for _ in range(30):
            obs, _, terminated, truncated, _ = env.step(random_action(rng))
            if terminated or truncated:
                break
        if np.array_equal(initial_frame, obs):
            issues.append("observation unchanged after 30 steps")

        if issues:
            return False, "; ".join(issues)
        return True, f"shape={obs.shape} dtype={obs.dtype} range=[{obs.min()},{obs.max()}] unique={np.unique(obs).size}"
    finally:
        env.close()


# ---------------------------------------------------------------------------
# Check 4: Reward and terminal correctness
# ---------------------------------------------------------------------------

TERMINAL_STATES = {"WIN", "EXIT", "GAMEOVER"}


def check_reward_terminal(game: str) -> tuple[bool, str]:
    env = GameGymEnv(game=game, max_steps=500)
    try:
        _, info = env.reset(seed=SEED)
        prev_score = info["score"]
        cumulative_reward = 0.0
        issues = []
        step_count = 0
        terminated = False
        truncated = False

        rng = np.random.default_rng(SEED)
        for i in range(500):
            _, reward, terminated, truncated, info = env.step(random_action(rng))
            step_count += 1

            expected_reward = info["score"] - prev_score
            if reward != expected_reward:
                issues.append(f"step {i}: reward {reward} != score delta {expected_reward}")
                if len(issues) >= 3:
                    break
            cumulative_reward += reward
            prev_score = info["score"]

            if terminated:
                if info["gameState"] not in TERMINAL_STATES:
                    issues.append(f"step {i}: terminated but gameState={info['gameState']}")
                break
            if truncated:
                break

        if issues:
            return False, "; ".join(issues[:3])
        status = "terminated" if terminated else ("truncated" if truncated else "running")
        return True, f"{step_count} steps, reward={cumulative_reward:.0f}, {status}"
    finally:
        env.close()


# ---------------------------------------------------------------------------
# Check 5: Throughput
# ---------------------------------------------------------------------------

BENCH_FRAMES = 500
WARMUP_FRAMES = 50


def check_throughput(game: str) -> tuple[bool, str, float]:
    env = GameGymEnv(game=game, max_steps=BENCH_FRAMES + WARMUP_FRAMES + 100)
    try:
        env.reset(seed=SEED)
        rng = np.random.default_rng(SEED)

        for _ in range(WARMUP_FRAMES):
            _, _, terminated, truncated, _ = env.step(random_action(rng))
            if terminated or truncated:
                env.reset(seed=SEED)

        start = time.perf_counter()
        steps = 0
        for _ in range(BENCH_FRAMES):
            _, _, terminated, truncated, _ = env.step(random_action(rng))
            steps += 1
            if terminated or truncated:
                env.reset(seed=SEED)
        elapsed = time.perf_counter() - start

        fps = steps / elapsed
        ms = (elapsed / steps) * 1000
        return True, f"{fps:.0f} FPS ({ms:.2f} ms/step)", fps
    finally:
        env.close()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def validate_game(game: str, skip_throughput: bool = False) -> dict:
    results = {}

    print(f"\n{'=' * 50}")
    print(f"  {game}")
    print(f"{'=' * 50}")

    # Check 1
    print("  1/5 API compliance ... ", end="", flush=True)
    try:
        passed, msg = check_api_compliance(game)
    except Exception as exc:
        passed, msg = False, str(exc)[:100]
    results["api_compliance"] = {"passed": passed, "message": msg}
    print("PASS" if passed else "FAIL", f"-- {msg}")

    # Check 2
    print("  2/5 Determinism ... ", end="", flush=True)
    try:
        passed, msg = check_determinism(game)
    except Exception as exc:
        passed, msg = False, str(exc)[:100]
    results["determinism"] = {"passed": passed, "message": msg}
    print("PASS" if passed else "FAIL", f"-- {msg}")

    # Check 3
    print("  3/5 Observation sanity ... ", end="", flush=True)
    try:
        passed, msg = check_observation_sanity(game)
    except Exception as exc:
        passed, msg = False, str(exc)[:100]
    results["observation_sanity"] = {"passed": passed, "message": msg}
    print("PASS" if passed else "FAIL", f"-- {msg}")

    # Check 4
    print("  4/5 Reward / terminal ... ", end="", flush=True)
    try:
        passed, msg = check_reward_terminal(game)
    except Exception as exc:
        passed, msg = False, str(exc)[:100]
    results["reward_terminal"] = {"passed": passed, "message": msg}
    print("PASS" if passed else "FAIL", f"-- {msg}")

    # Check 5
    fps = 0.0
    if not skip_throughput:
        print("  5/5 Throughput ... ", end="", flush=True)
        try:
            passed, msg, fps = check_throughput(game)
        except Exception as exc:
            passed, msg = False, str(exc)[:100]
        results["throughput"] = {"passed": passed, "message": msg, "fps": fps}
        print("PASS" if passed else "FAIL", f"-- {msg}")
    else:
        results["throughput"] = {"passed": True, "message": "skipped", "fps": 0}
        print("  5/5 Throughput ... SKIP")

    all_passed = all(r["passed"] for r in results.values())
    results["all_passed"] = all_passed
    return results


def main() -> int:
    args = parse_args()
    games = [args.game] if args.game else list_games()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    all_results: dict[str, dict] = {}

    for game in games:
        all_results[game] = validate_game(game, skip_throughput=args.skip_throughput)

    # Summary table
    print(f"\n{'=' * 70}")
    print(f"{'Game':<20} {'API':>4} {'DET':>4} {'OBS':>4} {'REW':>4} {'FPS':>8} {'ALL':>5}")
    print(f"{'-' * 70}")
    total_passed = 0
    for game, r in all_results.items():
        api = "ok" if r["api_compliance"]["passed"] else "FAIL"
        det = "ok" if r["determinism"]["passed"] else "FAIL"
        obs = "ok" if r["observation_sanity"]["passed"] else "FAIL"
        rew = "ok" if r["reward_terminal"]["passed"] else "FAIL"
        fps_val = r["throughput"].get("fps", 0)
        fps_str = f"{fps_val:.0f}" if fps_val else "skip"
        all_ok = "PASS" if r["all_passed"] else "FAIL"
        if r["all_passed"]:
            total_passed += 1
        print(f"{game:<20} {api:>4} {det:>4} {obs:>4} {rew:>4} {fps_str:>8} {all_ok:>5}")
    print(f"{'-' * 70}")
    print(f"Total: {total_passed}/{len(all_results)} games passed all checks")
    print(f"{'=' * 70}")

    # Save results
    summary_path = OUTPUT_DIR / "summary.json"
    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "seed": SEED,
        "num_steps": NUM_STEPS,
        "games": all_results,
        "total_games": len(all_results),
        "total_passed": total_passed,
    }
    summary_path.write_text(json.dumps(summary, indent=2, default=str) + "\n")
    print(f"\nResults saved to {summary_path}")

    return 0 if total_passed == len(all_results) else 1


if __name__ == "__main__":
    sys.exit(main())
