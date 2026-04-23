"""Kazuki environment validation suite.

Validates the headless KazukiGymEnv against Procgen-style criteria:
  1. Gymnasium API compliance (check_env)
  2. Determinism (same seed + actions → identical trajectories)
  3. Observation sanity (shape, dtype, range, non-degeneracy)
  4. Reward and terminal correctness

Generates visual proof artifacts under outputs/validation/.

Usage:
    uv run python -m fast_games.archive.validate_kazuki
"""

from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from fast_games.archive.kazuki_gym_env import KazukiGymEnv

SEED = 42
NUM_STEPS = 200
SAMPLE_INTERVAL = 10
GRID_COLS = 5
PADDING = 4
TERMINAL_STATES = {"WIN", "EXIT", "GAMEOVER"}
ACTION_NAMES = ["NOOP", "LEFT", "RIGHT", "JUMP", "LEFT_JUMP", "RIGHT_JUMP", "UP", "DOWN"]

OUTPUT_DIR = Path(__file__).resolve().parents[3] / "outputs" / "validation"


# ---------------------------------------------------------------------------
# Scripted policy (matches benchmarks/kazuki-compare.mjs actionForFrame)
# ---------------------------------------------------------------------------

# Actions: 0=NOOP 1=LEFT 2=RIGHT 3=JUMP 4=LEFT_JUMP 5=RIGHT_JUMP 6=UP 7=DOWN
def action_for_step(i: int) -> int:
    if i % 60 < 30:
        return 2  # RIGHT
    return 1  # LEFT


# ---------------------------------------------------------------------------
# Trajectory collection
# ---------------------------------------------------------------------------

def collect_trajectory(seed: int, num_steps: int) -> dict:
    env = KazukiGymEnv(max_steps=num_steps + 100)
    try:
        obs, info = env.reset(seed=seed)
        observations = [obs.copy()]
        actions: list[int] = []
        rewards: list[float] = []
        terminated_flags: list[bool] = []
        truncated_flags: list[bool] = []
        infos: list[dict] = [info]

        for i in range(num_steps):
            action = action_for_step(i)
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
# Image utilities (Pillow)
# ---------------------------------------------------------------------------

def frames_to_grid(frames: list[np.ndarray], cols: int) -> Image.Image:
    """Assemble a list of HxW uint8 arrays into a padded grid."""
    rows = (len(frames) + cols - 1) // cols
    h, w = frames[0].shape
    grid_w = cols * w + (cols + 1) * PADDING
    grid_h = rows * h + (rows + 1) * PADDING
    grid = Image.new("L", (grid_w, grid_h), color=40)
    for idx, frame in enumerate(frames):
        r, c = divmod(idx, cols)
        x = PADDING + c * (w + PADDING)
        y = PADDING + r * (h + PADDING)
        grid.paste(Image.fromarray(frame, "L"), (x, y))
    return grid


def labeled_grid(frames: list[np.ndarray], labels: list[str], cols: int) -> Image.Image:
    """Grid with a small label in the top-left of each cell."""
    grid = frames_to_grid(frames, cols).convert("RGB")
    draw = ImageDraw.Draw(grid)
    h, w = frames[0].shape
    for idx, label in enumerate(labels):
        r, c = divmod(idx, cols)
        x = PADDING + c * (w + PADDING) + 2
        y = PADDING + r * (h + PADDING) + 2
        draw.text((x, y), label, fill=(255, 200, 0))
    return grid


# ---------------------------------------------------------------------------
# Check 1: API compliance
# ---------------------------------------------------------------------------

def check_api_compliance() -> tuple[bool, str]:
    from gymnasium.utils.env_checker import check_env

    env = KazukiGymEnv()
    try:
        check_env(env.unwrapped, skip_render_check=True)
        return True, "gymnasium check_env passed"
    except Exception as exc:
        return False, f"check_env failed: {exc}"
    finally:
        env.close()


# ---------------------------------------------------------------------------
# Check 2: Determinism
# ---------------------------------------------------------------------------

def check_determinism() -> tuple[bool, str, dict]:
    traj_a = collect_trajectory(SEED, NUM_STEPS)
    traj_b = collect_trajectory(SEED, NUM_STEPS)

    if traj_a["steps"] != traj_b["steps"]:
        return False, f"step count mismatch: {traj_a['steps']} vs {traj_b['steps']}", {}

    steps = traj_a["steps"]
    first_diverge = None

    for i in range(steps):
        obs_match = np.array_equal(traj_a["observations"][i + 1], traj_b["observations"][i + 1])
        rew_match = traj_a["rewards"][i] == traj_b["rewards"][i]
        term_match = traj_a["terminated"][i] == traj_b["terminated"][i]
        trunc_match = traj_a["truncated"][i] == traj_b["truncated"][i]
        info_a, info_b = traj_a["infos"][i + 1], traj_b["infos"][i + 1]
        score_match = info_a["score"] == info_b["score"]
        player_match = info_a["player"] == info_b["player"]

        if not all([obs_match, rew_match, term_match, trunc_match, score_match, player_match]):
            first_diverge = i
            break

    if first_diverge is not None:
        return False, f"trajectories diverge at step {first_diverge}", {}

    return True, f"{steps} steps deterministic (seed={SEED})", {
        "traj_a": traj_a,
        "traj_b": traj_b,
    }


# ---------------------------------------------------------------------------
# Check 3: Observation sanity
# ---------------------------------------------------------------------------

def check_observation_sanity() -> tuple[bool, str]:
    env = KazukiGymEnv()
    try:
        obs, _ = env.reset(seed=SEED)
        issues = []

        if obs.shape != (84, 84, 4):
            issues.append(f"shape {obs.shape} != (84,84,4)")
        if obs.dtype != np.uint8:
            issues.append(f"dtype {obs.dtype} != uint8")
        if obs.min() < 0 or obs.max() > 255:
            issues.append(f"range [{obs.min()}, {obs.max()}] outside [0,255]")
        if obs.max() == 0:
            issues.append("all-black observation after reset")
        if np.unique(obs).size < 10:
            issues.append(f"only {np.unique(obs).size} unique values (degenerate)")

        # Check frames change over time
        initial_frame = obs[:, :, -1].copy()
        for _ in range(30):
            obs, _, terminated, truncated, _ = env.step(2)  # RIGHT
            if terminated or truncated:
                break
        later_frame = obs[:, :, -1]
        if np.array_equal(initial_frame, later_frame):
            issues.append("observation unchanged after 30 steps")

        if issues:
            return False, "; ".join(issues)
        return True, f"shape={obs.shape} dtype={obs.dtype} range=[{obs.min()},{obs.max()}] unique={np.unique(obs).size}"
    finally:
        env.close()


# ---------------------------------------------------------------------------
# Check 4: Reward and terminal correctness
# ---------------------------------------------------------------------------

def check_reward_terminal() -> tuple[bool, str]:
    env = KazukiGymEnv(max_steps=300)
    try:
        _, info = env.reset(seed=SEED)
        prev_score = info["score"]
        cumulative_reward = 0.0
        issues = []
        step_count = 0

        for i in range(300):
            action = action_for_step(i)
            _, reward, terminated, truncated, info = env.step(action)
            step_count += 1

            expected_reward = info["score"] - prev_score
            if reward != expected_reward:
                issues.append(f"step {i}: reward {reward} != score delta {expected_reward}")
            cumulative_reward += reward
            prev_score = info["score"]

            if terminated:
                if info["gameState"] not in TERMINAL_STATES:
                    issues.append(f"step {i}: terminated but gameState={info['gameState']}")
                break

            if truncated:
                if info["gameState"] in TERMINAL_STATES:
                    issues.append(f"step {i}: truncated but gameState={info['gameState']} is terminal")
                break

        # Check cumulative reward consistency
        final_score = info["score"]
        initial_info_score = 0  # score resets to 0 on new episode
        expected_cumulative = final_score - initial_info_score
        if abs(cumulative_reward - expected_cumulative) > 1e-6:
            issues.append(f"cumulative reward {cumulative_reward} != final-initial score {expected_cumulative}")

        if issues:
            return False, "; ".join(issues[:3])
        status = "terminated" if terminated else ("truncated" if truncated else "running")
        return True, f"{step_count} steps, reward={cumulative_reward:.0f}, {status}, gameState={info['gameState']}"
    finally:
        env.close()


# ---------------------------------------------------------------------------
# Check 5: Step throughput
# ---------------------------------------------------------------------------

BENCH_FRAMES = 1000
WARMUP_FRAMES = 50

def check_throughput() -> tuple[bool, str]:
    env = KazukiGymEnv(max_steps=BENCH_FRAMES + WARMUP_FRAMES + 100)
    try:
        env.reset(seed=SEED)

        # Warmup — let JIT and caches settle
        for i in range(WARMUP_FRAMES):
            _, _, terminated, truncated, _ = env.step(action_for_step(i))
            if terminated or truncated:
                env.reset(seed=SEED)

        # Timed run
        start = time.perf_counter()
        steps = 0
        for i in range(BENCH_FRAMES):
            _, _, terminated, truncated, _ = env.step(action_for_step(i))
            steps += 1
            if terminated or truncated:
                env.reset(seed=SEED)
        elapsed = time.perf_counter() - start

        fps = steps / elapsed
        ms_per_step = (elapsed / steps) * 1000
        return True, f"{fps:.0f} FPS ({ms_per_step:.3f} ms/step, {steps} frames)"
    finally:
        env.close()


# ---------------------------------------------------------------------------
# Visual artifact generation
# ---------------------------------------------------------------------------

def generate_observation_grid(traj: dict) -> Path:
    """5x4 grid of frames sampled every SAMPLE_INTERVAL steps."""
    obs_list = traj["observations"]
    sample_indices = list(range(0, len(obs_list), SAMPLE_INTERVAL))[:GRID_COLS * 4]

    frames = [obs_list[i][:, :, -1] for i in sample_indices]
    labels = [f"t={i}" for i in sample_indices]

    img = labeled_grid(frames, labels, GRID_COLS)
    path = OUTPUT_DIR / "observation_grid.png"
    img.save(path)
    return path


def generate_determinism_proof(traj_a: dict, traj_b: dict) -> Path:
    """Three rows: run A, run B, absolute diff."""
    sample_indices = list(range(0, min(traj_a["steps"], traj_b["steps"]) + 1, SAMPLE_INTERVAL))[:GRID_COLS]

    frames_a = [traj_a["observations"][i][:, :, -1] for i in sample_indices]
    frames_b = [traj_b["observations"][i][:, :, -1] for i in sample_indices]
    frames_diff = [np.abs(a.astype(np.int16) - b.astype(np.int16)).astype(np.uint8) for a, b in zip(frames_a, frames_b)]

    all_frames = frames_a + frames_b + frames_diff
    labels_a = [f"A t={i}" for i in sample_indices]
    labels_b = [f"B t={i}" for i in sample_indices]
    labels_diff = [f"diff t={i}" for i in sample_indices]
    all_labels = labels_a + labels_b + labels_diff

    img = labeled_grid(all_frames, all_labels, len(sample_indices))
    path = OUTPUT_DIR / "determinism_proof.png"
    img.save(path)
    return path


def generate_frame_stack(traj: dict) -> Path:
    """Show all 4 channels of one stacked observation."""
    # Pick a mid-episode observation
    mid = min(60, len(traj["observations"]) - 1)
    obs = traj["observations"][mid]

    frames = [obs[:, :, c] for c in range(obs.shape[2])]
    labels = ["t-3", "t-2", "t-1", "t"]

    img = labeled_grid(frames, labels, 4)
    path = OUTPUT_DIR / "frame_stack.png"
    img.save(path)
    return path


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    results: dict[str, dict] = {}
    all_passed = True
    artifacts: list[str] = []

    checks = [
        ("api_compliance", "API compliance (check_env)", check_api_compliance),
        ("determinism", "Determinism", None),
        ("observation_sanity", "Observation sanity", check_observation_sanity),
        ("reward_terminal", "Reward / terminal correctness", check_reward_terminal),
    ]

    # --- Check 1: API compliance ---
    print("Check 1/5: API compliance ... ", end="", flush=True)
    passed, msg = check_api_compliance()
    results["api_compliance"] = {"passed": passed, "message": msg}
    print("PASS" if passed else "FAIL", f"— {msg}")
    if not passed:
        all_passed = False

    # --- Check 2: Determinism (also produces trajectories for visuals) ---
    print("Check 2/5: Determinism ... ", end="", flush=True)
    passed, msg, det_data = check_determinism()
    results["determinism"] = {"passed": passed, "message": msg}
    print("PASS" if passed else "FAIL", f"— {msg}")
    if not passed:
        all_passed = False

    # --- Check 3: Observation sanity ---
    print("Check 3/5: Observation sanity ... ", end="", flush=True)
    passed, msg = check_observation_sanity()
    results["observation_sanity"] = {"passed": passed, "message": msg}
    print("PASS" if passed else "FAIL", f"— {msg}")
    if not passed:
        all_passed = False

    # --- Check 4: Reward / terminal ---
    print("Check 4/5: Reward / terminal ... ", end="", flush=True)
    passed, msg = check_reward_terminal()
    results["reward_terminal"] = {"passed": passed, "message": msg}
    print("PASS" if passed else "FAIL", f"— {msg}")
    if not passed:
        all_passed = False

    # --- Check 5: Throughput ---
    print("Check 5/5: Step throughput ... ", end="", flush=True)
    passed, msg = check_throughput()
    results["throughput"] = {"passed": passed, "message": msg}
    print("PASS" if passed else "FAIL", f"— {msg}")
    if not passed:
        all_passed = False

    # --- Visual artifacts ---
    print("\nGenerating visual artifacts ...")
    if det_data:
        traj = det_data["traj_a"]

        path = generate_observation_grid(traj)
        artifacts.append(str(path))
        print(f"  {path}")

        path = generate_determinism_proof(det_data["traj_a"], det_data["traj_b"])
        artifacts.append(str(path))
        print(f"  {path}")

        path = generate_frame_stack(traj)
        artifacts.append(str(path))
        print(f"  {path}")
    else:
        print("  (skipped — determinism check failed, no trajectories)")

    # --- Build trajectory log ---
    trajectory_log = None
    if det_data:
        traj = det_data["traj_a"]
        trajectory_log = []
        for i in range(traj["steps"]):
            info = traj["infos"][i + 1]
            entry: dict = {"step": i, "action": ACTION_NAMES[traj["actions"][i]]}
            entry["player"] = info.get("player")
            entry["score"] = info["score"]
            entry["reward"] = traj["rewards"][i]
            entry["gameState"] = info["gameState"]
            trajectory_log.append(entry)

    # --- Write JSON results ---
    json_path = OUTPUT_DIR / "validation_results.json"
    json_payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "seed": SEED,
        "num_steps": NUM_STEPS,
        "results": results,
        "trajectory": trajectory_log,
        "artifacts": artifacts,
        "all_passed": all_passed,
    }
    json_path.write_text(json.dumps(json_payload, indent=2) + "\n")
    artifacts.append(str(json_path))
    print(f"  {json_path}")

    # --- Summary ---
    print("\n" + "=" * 50)
    total = len(results)
    passed_count = sum(1 for r in results.values() if r["passed"])
    print(f"{'ALL CHECKS PASSED' if all_passed else 'SOME CHECKS FAILED'} ({passed_count}/{total})")
    print("=" * 50)

    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(main())
