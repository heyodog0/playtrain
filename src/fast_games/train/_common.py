"""Shared boilerplate for training entry points (ppo, dqn, multigame).

Pure plumbing: argparse-config merging, output-dir setup, git-hash capture,
config snapshot writing, W&B init/teardown, eval-callback construction.
No algorithm-specific logic lives here.
"""

from __future__ import annotations

import argparse
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from stable_baselines3.common.callbacks import EvalCallback


def apply_config(args: argparse.Namespace) -> argparse.Namespace:
    """Override CLI defaults with values from `args.config` (JSON file).

    Keys in the JSON use either underscores or hyphens; both map to the
    matching argparse attribute. Path-typed defaults are coerced back to Path.
    Unknown keys are silently ignored so configs can be shared across scripts.
    """
    if getattr(args, "config", None) is None:
        return args
    config = json.loads(Path(args.config).read_text())
    for key, value in config.items():
        attr = key.replace("-", "_")
        if hasattr(args, attr):
            current = getattr(args, attr)
            if isinstance(current, Path):
                setattr(args, attr, Path(value))
            else:
                setattr(args, attr, value)
    return args


def get_git_hash() -> str:
    """Return short HEAD hash, or 'unknown' outside a git checkout."""
    try:
        return (
            subprocess.check_output(
                ["git", "rev-parse", "HEAD"], stderr=subprocess.DEVNULL
            )
            .decode()
            .strip()[:8]
        )
    except Exception:
        return "unknown"


def make_output_dir(scope: str, algo: str, explicit: Path | None = None) -> Path:
    """Return (and create) `outputs/experiments/{scope}/{algo}/{ts}/` unless overridden."""
    if explicit is not None:
        out = Path(explicit)
    else:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        out = Path(f"outputs/experiments/{scope}/{algo}/{timestamp}")
    out.mkdir(parents=True, exist_ok=True)
    return out


def write_config_snapshot(output_dir: Path, snapshot: dict[str, Any]) -> None:
    """Persist the run config as `config.json` inside `output_dir`."""
    (output_dir / "config.json").write_text(json.dumps(snapshot, indent=2) + "\n")


def setup_wandb(
    *,
    enabled: bool,
    project: str,
    config_snapshot: dict[str, Any],
    tags: list[str],
    run_name: str,
):
    """Initialize W&B and return its SB3 callback, or None if disabled / unavailable."""
    if not enabled:
        return None
    try:
        import wandb
        from wandb.integration.sb3 import WandbCallback
    except ImportError:
        print("wandb not installed, skipping W&B logging. Install: uv pip install wandb")
        return None

    wandb.init(
        project=project,
        config=config_snapshot,
        tags=tags,
        name=run_name,
        sync_tensorboard=True,
    )
    return WandbCallback(verbose=0)


def make_eval_callback(
    eval_env,
    output_dir: Path,
    *,
    eval_freq: int,
    n_eval_episodes: int,
    n_envs: int = 1,
) -> EvalCallback:
    """Standard EvalCallback writing best_model/, eval/ logs into output_dir."""
    return EvalCallback(
        eval_env,
        best_model_save_path=str(output_dir / "best_model"),
        log_path=str(output_dir / "eval"),
        eval_freq=max(eval_freq // max(n_envs, 1), 1),
        n_eval_episodes=n_eval_episodes,
        deterministic=True,
        render=False,
    )


def finish_wandb(enabled: bool) -> None:
    """Flush W&B run if it was started; no-op otherwise."""
    if not enabled:
        return
    try:
        import wandb

        wandb.finish()
    except Exception:
        pass


def common_timestamp() -> str:
    """UTC ISO timestamp for config snapshots."""
    return datetime.now(timezone.utc).isoformat()
