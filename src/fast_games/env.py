"""Thin shim re-exporting node-gym, configured for this repo's games.

The actual env implementation lives in the `node-gym` package. This module
adapts it to fast-llm-games by pointing the games directory at our local
`games/js/` instead of node-gym's bundled examples, and keeps the historical
names (`GameGymEnv`, `make_multigame_vec_env`) so existing call sites don't
need to change.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from node_gym import NodeGymEnv, SeedRangeWrapper
from node_gym import list_available_games as _node_gym_list


GAMES_DIR = Path(__file__).resolve().parents[2] / "games" / "js"


class GameGymEnv(NodeGymEnv):
    """NodeGymEnv pinned to this repo's games/ directory."""

    def __init__(self, *, game: str, **kwargs: Any) -> None:
        kwargs.setdefault("games_dir", GAMES_DIR)
        super().__init__(game=game, **kwargs)


def list_available_games() -> list[str]:
    """Sorted game names available in this repo's games/js/."""
    return _node_gym_list(GAMES_DIR)


def make_multigame_vec_env(
    games: list[str],
    n_envs_per_game: int = 1,
    *,
    seed_range: tuple[int, int] | None = None,
    obs_size: int = 64,
    obs_mode: str = "rgb",
    frame_stack: int = 1,
    max_steps: int = 2000,
    use_subproc: bool = True,
) -> Any:
    """Create a VecEnv spanning multiple games. One env permanently plays one game."""
    from stable_baselines3.common.vec_env import DummyVecEnv, SubprocVecEnv

    env_fns = []
    for game in games:
        for _ in range(n_envs_per_game):
            def _make(g=game):
                env = GameGymEnv(
                    game=g,
                    obs_size=obs_size,
                    obs_mode=obs_mode,
                    frame_stack=frame_stack,
                    max_steps=max_steps,
                )
                if seed_range is not None:
                    env = SeedRangeWrapper(env, seed_range[0], seed_range[1])
                return env
            env_fns.append(_make)

    VecClass = SubprocVecEnv if (use_subproc and len(env_fns) > 1) else DummyVecEnv
    return VecClass(env_fns)


__all__ = [
    "GameGymEnv",
    "SeedRangeWrapper",
    "list_available_games",
    "make_multigame_vec_env",
    "GAMES_DIR",
]
