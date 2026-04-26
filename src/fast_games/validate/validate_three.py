"""Validate all Three.js games against ProcGen-style criteria.

Mirror of validate.py for the Three.js (ThreeGameGymEnv) backend.

Differences from p5:
  - Observation is (84, 84, 3), action_space is Discrete(15).
  - Determinism uses a small mean-abs-diff tolerance — Dawn/WebGPU rasterization
    can vary by ~1 LSB in some games. Override with --strict-determinism.
  - Reward/terminal check is skipped if the game does not expose info['score'].

Usage:
    uv run fast-games-validate-three --all
    uv run fast-games-validate-three --game ball_roller
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from fast_games.env import ThreeGameGymEnv, list_available_threejs_games

SEED = 42
NUM_STEPS = 200
OBS_SIZE = 84
ACTION_N = 15
DETERMINISM_TOLERANCE = 1.0  # mean abs diff per pixel allowed for Dawn jitter
OUTPUT_DIR = Path(__file__).resolve().parents[3] / "outputs" / "validation_three"
TERMINAL_STATES = {"WIN", "EXIT", "GAMEOVER"}
BENCH_FRAMES = 200
WARMUP_FRAMES = 30


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate three.js games against ProcGen-style criteria")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--game", type=str, help="Single game to validate")
    group.add_argument("--all", action="store_true", help="Validate all bundled three.js games")
    parser.add_argument("--skip-throughput", action="store_true", help="Skip throughput benchmark")
    parser.add_argument("--strict-determinism", action="store_true",
                        help="Require byte-exact obs match (default: tolerate ≤1 mean LSB diff)")
    parser.add_argument("--no-save", action="store_true", help="Don't write summary.json")
    return parser.parse_args()


def random_action(rng: np.random.Generator) -> int:
    return int(rng.integers(0, ACTION_N))


# ---------------------------------------------------------------------------
# Trajectory collection
# ---------------------------------------------------------------------------

def collect_trajectory(game: str, seed: int, num_steps: int) -> dict:
    env = ThreeGameGymEnv(game=game, max_steps=num_steps + 100)
    try:
        obs, info = env.reset(seed=seed)
        observations = [obs.copy()]
        rewards: list[float] = []
        terminated_flags: list[bool] = []
        truncated_flags: list[bool] = []
        infos: list[dict] = [info]

        rng = np.random.default_rng(seed)
        for _ in range(num_steps):
            obs, reward, terminated, truncated, info = env.step(random_action(rng))
            observations.append(obs.copy())
            rewards.append(reward)
            terminated_flags.append(terminated)
            truncated_flags.append(truncated)
            infos.append(info)
            if terminated or truncated:
                break

        return {
            "observations": observations,
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

    env = ThreeGameGymEnv(game=game)
    try:
        check_env(env.unwrapped, skip_render_check=True)
        return True, "check_env passed"
    except Exception as exc:
        return False, f"check_env failed: {exc}"
    finally:
        env.close()


# ---------------------------------------------------------------------------
# Check 2: Determinism (with tolerance for Dawn rasterization jitter)
# ---------------------------------------------------------------------------

def check_determinism(game: str, strict: bool) -> tuple[bool, str]:
    traj_a = collect_trajectory(game, SEED, NUM_STEPS)
    traj_b = collect_trajectory(game, SEED, NUM_STEPS)

    if traj_a["steps"] != traj_b["steps"]:
        return False, f"step count mismatch: {traj_a['steps']} vs {traj_b['steps']}"

    steps = traj_a["steps"]
    max_obs_diff = 0.0
    for i in range(steps):
        a = traj_a["observations"][i + 1].astype(np.int16)
        b = traj_b["observations"][i + 1].astype(np.int16)
        diff = float(np.abs(a - b).mean())
        max_obs_diff = max(max_obs_diff, diff)

        rew_match = traj_a["rewards"][i] == traj_b["rewards"][i]
        term_match = traj_a["terminated"][i] == traj_b["terminated"][i]
        trunc_match = traj_a["truncated"][i] == traj_b["truncated"][i]

        if strict:
            obs_ok = np.array_equal(traj_a["observations"][i + 1], traj_b["observations"][i + 1])
        else:
            obs_ok = diff <= DETERMINISM_TOLERANCE

        if not all([obs_ok, rew_match, term_match, trunc_match]):
            mismatches = []
            if not obs_ok: mismatches.append(f"obs(diff={diff:.2f})")
            if not rew_match: mismatches.append("reward")
            if not term_match: mismatches.append("terminated")
            if not trunc_match: mismatches.append("truncated")
            return False, f"diverge at step {i}: {', '.join(mismatches)}"

    mode = "strict" if strict else f"tol≤{DETERMINISM_TOLERANCE}"
    return True, f"{steps} steps deterministic ({mode}, max obs diff={max_obs_diff:.2f}, seed={SEED})"


# ---------------------------------------------------------------------------
# Check 3: Observation sanity
# ---------------------------------------------------------------------------

def check_observation_sanity(game: str) -> tuple[bool, str]:
    env = ThreeGameGymEnv(game=game)
    try:
        obs, _ = env.reset(seed=SEED)
        issues = []

        expected_shape = (OBS_SIZE, OBS_SIZE, 3)
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

def check_reward_terminal(game: str) -> tuple[bool, str]:
    env = ThreeGameGymEnv(game=game, max_steps=500)
    try:
        _, info = env.reset(seed=SEED)
        if "score" not in info:
            return True, "skipped (game does not expose info['score'])"

        prev_score = info["score"]
        cumulative_reward = 0.0
        issues: list[str] = []
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
                if info.get("gameState") not in TERMINAL_STATES:
                    issues.append(f"step {i}: terminated but gameState={info.get('gameState')}")
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

def check_throughput(game: str) -> tuple[bool, str, float]:
    env = ThreeGameGymEnv(game=game, max_steps=BENCH_FRAMES + WARMUP_FRAMES + 100)
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
# Driver
# ---------------------------------------------------------------------------

def validate_game(game: str, skip_throughput: bool, strict_determinism: bool) -> dict:
    print(f"\n{'=' * 50}\n  {game}\n{'=' * 50}")
    results: dict[str, dict] = {}

    checks = [
        ("API compliance",      lambda g: check_api_compliance(g),                       "api_compliance"),
        ("Determinism",         lambda g: check_determinism(g, strict_determinism),      "determinism"),
        ("Observation sanity",  lambda g: check_observation_sanity(g),                   "observation_sanity"),
        ("Reward / terminal",   lambda g: check_reward_terminal(g),                      "reward_terminal"),
    ]
    total = len(checks) + (0 if skip_throughput else 1)
    for i, (label, fn, key) in enumerate(checks, 1):
        print(f"  {i}/{total} {label} ... ", end="", flush=True)
        try:
            passed, msg = fn(game)
        except Exception as exc:
            passed, msg = False, str(exc)[:120]
        results[key] = {"passed": passed, "message": msg}
        print("PASS" if passed else "FAIL", f"-- {msg}")

    if skip_throughput:
        results["throughput"] = {"passed": True, "message": "skipped", "fps": 0.0}
        print(f"  {len(checks) + 1}/{len(checks) + 1} Throughput ... SKIP")
    else:
        print(f"  {total}/{total} Throughput ... ", end="", flush=True)
        try:
            passed, msg, fps = check_throughput(game)
        except Exception as exc:
            passed, msg, fps = False, str(exc)[:120], 0.0
        results["throughput"] = {"passed": passed, "message": msg, "fps": fps}
        print("PASS" if passed else "FAIL", f"-- {msg}")

    results["all_passed"] = all(r["passed"] for r in results.values())
    return results


def main() -> int:
    args = parse_args()
    games = [args.game] if args.game else list_available_threejs_games()
    all_results: dict[str, dict] = {
        game: validate_game(game, args.skip_throughput, args.strict_determinism)
        for game in games
    }

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

    if not args.no_save:
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        summary_path = OUTPUT_DIR / "summary.json"
        summary = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "seed": SEED,
            "num_steps": NUM_STEPS,
            "determinism_tolerance": None if args.strict_determinism else DETERMINISM_TOLERANCE,
            "games": all_results,
            "total_games": len(all_results),
            "total_passed": total_passed,
        }
        summary_path.write_text(json.dumps(summary, indent=2, default=str) + "\n")
        print(f"\nResults saved to {summary_path}")

    return 0 if total_passed == len(all_results) else 1


if __name__ == "__main__":
    sys.exit(main())
