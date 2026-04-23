"""Compatibility shim for archived modules.

The actual sources now live at `<repo>/archive/fast_games/`. Extending this
subpackage's `__path__` lets legacy imports such as

    from fast_games.archive.kazuki_gym_env import KazukiGymEnv

continue to resolve without any caller changes.
"""

from pathlib import Path

__path__.append(str(Path(__file__).resolve().parents[3] / "archive" / "fast_games"))
