"""Library: 5-check ProcGen-style validation, parameterized over backend.

Used by PlayTrain's tools/validate.py and by sibling repos (e.g. the paper
repo) that want to run the same checks against their own catalogs. The CLI
wrapper is ~30 lines.

The 5 checks (per game):
  1. Gymnasium API compliance (check_env)
  2. Determinism (same seed + actions = same trajectory, with optional tolerance)
  3. Observation sanity (shape, dtype, range, non-degeneracy, frames change)
  4. Reward / terminal correctness (reward == score delta, terminal states)
  5. Step throughput (FPS)
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

import numpy as np

EnvFactory = Callable[..., Any]
TERMINAL_STATES = {"WIN", "EXIT", "GAMEOVER"}


def _random_action(rng: np.random.Generator, n_actions: int) -> int:
    return int(rng.integers(0, n_actions))


# ---------------------------------------------------------------------------
# Trajectory collection (used by determinism check)
# ---------------------------------------------------------------------------

def _collect_trajectory(env_factory: EnvFactory, game: str, seed: int,
                        num_steps: int, n_actions: int) -> dict:
    env = env_factory(game=game, max_steps=num_steps + 100)
    try:
        obs, info = env.reset(seed=seed)
        observations = [obs.copy()]
        rewards: list[float] = []
        terminated_flags: list[bool] = []
        truncated_flags: list[bool] = []
        infos: list[dict] = [info]

        rng = np.random.default_rng(seed)
        for _ in range(num_steps):
            obs, reward, terminated, truncated, info = env.step(_random_action(rng, n_actions))
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

def check_api_compliance(env_factory: EnvFactory, game: str) -> tuple[bool, str]:
    from gymnasium.utils.env_checker import check_env

    env = env_factory(game=game)
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

def check_determinism(env_factory: EnvFactory, game: str, *,
                      seed: int, num_steps: int, n_actions: int,
                      tolerance: float) -> tuple[bool, str]:
    """Run the same seed twice; compare trajectories.

    tolerance == 0 → strict byte-equality on obs.
    tolerance > 0  → allow mean abs diff per pixel up to `tolerance` (for backends
                     with rasterization jitter, e.g. Dawn/WebGPU).
    """
    traj_a = _collect_trajectory(env_factory, game, seed, num_steps, n_actions)
    traj_b = _collect_trajectory(env_factory, game, seed, num_steps, n_actions)

    if traj_a["steps"] != traj_b["steps"]:
        return False, f"step count mismatch: {traj_a['steps']} vs {traj_b['steps']}"

    steps = traj_a["steps"]
    max_obs_diff = 0.0
    for i in range(steps):
        a = traj_a["observations"][i + 1]
        b = traj_b["observations"][i + 1]

        if tolerance > 0:
            diff = float(np.abs(a.astype(np.int16) - b.astype(np.int16)).mean())
            max_obs_diff = max(max_obs_diff, diff)
            obs_ok = diff <= tolerance
        else:
            obs_ok = np.array_equal(a, b)
            diff = 0.0

        rew_match = traj_a["rewards"][i] == traj_b["rewards"][i]
        term_match = traj_a["terminated"][i] == traj_b["terminated"][i]
        trunc_match = traj_a["truncated"][i] == traj_b["truncated"][i]

        if not all([obs_ok, rew_match, term_match, trunc_match]):
            mismatches = []
            if not obs_ok: mismatches.append(f"obs(diff={diff:.2f})" if tolerance else "obs")
            if not rew_match: mismatches.append("reward")
            if not term_match: mismatches.append("terminated")
            if not trunc_match: mismatches.append("truncated")
            return False, f"diverge at step {i}: {', '.join(mismatches)}"

    mode = "strict" if tolerance == 0 else f"tol≤{tolerance}"
    suffix = f", max obs diff={max_obs_diff:.2f}" if tolerance > 0 else ""
    return True, f"{steps} steps deterministic ({mode}{suffix}, seed={seed})"


# ---------------------------------------------------------------------------
# Check 3: Observation sanity
# ---------------------------------------------------------------------------

def check_observation_sanity(env_factory: EnvFactory, game: str, *,
                             seed: int, n_actions: int,
                             expected_shape: tuple[int, int, int]) -> tuple[bool, str]:
    env = env_factory(game=game)
    try:
        obs, _ = env.reset(seed=seed)
        issues: list[str] = []

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
        rng = np.random.default_rng(seed)
        for _ in range(30):
            obs, _, terminated, truncated, _ = env.step(_random_action(rng, n_actions))
            if terminated or truncated:
                break
        if np.array_equal(initial_frame, obs):
            issues.append("observation unchanged after 30 steps")

        if issues:
            return False, "; ".join(issues)
        return True, f"shape={obs.shape} range=[{obs.min()},{obs.max()}] unique={np.unique(obs).size}"
    finally:
        env.close()


# ---------------------------------------------------------------------------
# Check 4: Reward and terminal correctness
# ---------------------------------------------------------------------------

def check_reward_terminal(env_factory: EnvFactory, game: str, *,
                          seed: int, n_actions: int) -> tuple[bool, str]:
    env = env_factory(game=game, max_steps=500)
    try:
        _, info = env.reset(seed=seed)
        if "score" not in info:
            return True, "skipped (game does not expose info['score'])"

        prev_score = info["score"]
        cumulative_reward = 0.0
        issues: list[str] = []
        step_count = 0
        terminated = False
        truncated = False

        rng = np.random.default_rng(seed)
        for i in range(500):
            _, reward, terminated, truncated, info = env.step(_random_action(rng, n_actions))
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

def check_throughput(env_factory: EnvFactory, game: str, *,
                     seed: int, n_actions: int,
                     bench_frames: int, warmup_frames: int) -> tuple[bool, str, float]:
    env = env_factory(game=game, max_steps=bench_frames + warmup_frames + 100)
    try:
        env.reset(seed=seed)
        rng = np.random.default_rng(seed)

        for _ in range(warmup_frames):
            _, _, terminated, truncated, _ = env.step(_random_action(rng, n_actions))
            if terminated or truncated:
                env.reset(seed=seed)

        start = time.perf_counter()
        steps = 0
        for _ in range(bench_frames):
            _, _, terminated, truncated, _ = env.step(_random_action(rng, n_actions))
            steps += 1
            if terminated or truncated:
                env.reset(seed=seed)
        elapsed = time.perf_counter() - start

        fps = steps / elapsed
        ms = (elapsed / steps) * 1000
        return True, f"{fps:.0f} FPS ({ms:.2f} ms/step)", fps
    finally:
        env.close()


# ---------------------------------------------------------------------------
# Driver: validate one game / many games
# ---------------------------------------------------------------------------

def validate_game(env_factory: EnvFactory, game: str, *,
                  seed: int, num_steps: int, n_actions: int,
                  expected_shape: tuple[int, int, int],
                  determinism_tolerance: float,
                  skip_throughput: bool,
                  bench_frames: int, warmup_frames: int) -> dict:
    print(f"\n{'=' * 50}\n  {game}\n{'=' * 50}")
    results: dict[str, dict] = {}

    checks = [
        ("API compliance",      lambda: check_api_compliance(env_factory, game),                                                                      "api_compliance"),
        ("Determinism",         lambda: check_determinism(env_factory, game, seed=seed, num_steps=num_steps, n_actions=n_actions, tolerance=determinism_tolerance), "determinism"),
        ("Observation sanity",  lambda: check_observation_sanity(env_factory, game, seed=seed, n_actions=n_actions, expected_shape=expected_shape),    "observation_sanity"),
        ("Reward / terminal",   lambda: check_reward_terminal(env_factory, game, seed=seed, n_actions=n_actions),                                      "reward_terminal"),
    ]
    total = len(checks) + (0 if skip_throughput else 1)
    for i, (label, fn, key) in enumerate(checks, 1):
        print(f"  {i}/{total} {label} ... ", end="", flush=True)
        try:
            passed, msg = fn()
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
            passed, msg, fps = check_throughput(env_factory, game, seed=seed, n_actions=n_actions,
                                                bench_frames=bench_frames, warmup_frames=warmup_frames)
        except Exception as exc:
            passed, msg, fps = False, str(exc)[:120], 0.0
        results["throughput"] = {"passed": passed, "message": msg, "fps": fps}
        print("PASS" if passed else "FAIL", f"-- {msg}")

    results["all_passed"] = all(r["passed"] for r in results.values())
    return results


def run_validation(*,
                   env_factory: EnvFactory,
                   games: list[str],
                   expected_shape: tuple[int, int, int],
                   n_actions: int,
                   seed: int = 42,
                   num_steps: int = 200,
                   bench_frames: int = 500,
                   warmup_frames: int = 50,
                   determinism_tolerance: float = 0.0,
                   skip_throughput: bool = False,
                   output_path: Path | None = None) -> int:
    """Run all 5 checks across `games`. Returns 0 if all pass, 1 otherwise."""
    all_results: dict[str, dict] = {
        game: validate_game(env_factory, game,
                            seed=seed, num_steps=num_steps, n_actions=n_actions,
                            expected_shape=expected_shape,
                            determinism_tolerance=determinism_tolerance,
                            skip_throughput=skip_throughput,
                            bench_frames=bench_frames, warmup_frames=warmup_frames)
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

    if output_path is not None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        summary = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "seed": seed,
            "num_steps": num_steps,
            "determinism_tolerance": determinism_tolerance,
            "games": all_results,
            "total_games": len(all_results),
            "total_passed": total_passed,
        }
        output_path.write_text(json.dumps(summary, indent=2, default=str) + "\n")
        print(f"\nResults saved to {output_path}")

    return 0 if total_passed == len(all_results) else 1


__all__ = [
    "run_validation",
    "validate_game",
    "check_api_compliance",
    "check_determinism",
    "check_observation_sanity",
    "check_reward_terminal",
    "check_throughput",
]
