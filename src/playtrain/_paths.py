"""Resolve repo-layout assets (runtime/, games, GAME_TEMPLATE.md) in both
install modes.

Editable/checkout installs resolve against the repository root, exactly as
before. Wheel installs (pip install git+... / PyPI) fall back to the copies
bundled under ``playtrain/_assets`` by the wheel build (see
[tool.hatch.build.targets.wheel].force-include in pyproject.toml).
"""
from __future__ import annotations

from pathlib import Path

_PKG_DIR = Path(__file__).resolve().parent
_ASSETS = _PKG_DIR / "_assets"


def repo_root() -> Path | None:
    """The checkout root, or None when running from an installed wheel."""
    root = _PKG_DIR.parents[1]  # src/playtrain -> repo root in a checkout
    if (root / "pyproject.toml").exists() and (root / "runtime").exists():
        return root
    return None


def asset(rel: str) -> Path:
    """Resolve ``rel`` (repo-root-relative) from checkout or bundled assets."""
    root = repo_root()
    if root is not None and (root / rel).exists():
        return root / rel
    bundled = _ASSETS / rel
    if bundled.exists():
        return bundled
    # Return the checkout-style path so callers produce a sensible error.
    return (root or _ASSETS) / rel


def games_dir() -> Path:
    """The default game catalog.

    ``examples/games/js`` — the curated set the runtime has always defaulted to.
    NOT ``games/js``: the two have diverged (9 files differ, e.g. breakout is
    ALE-aligned here and randomized there), so switching the default silently
    changes 9 environments. The full tree is bundled too and is reachable via
    ``$PLAYTRAIN_GAMES_DIR``, the ``games_dir=`` argument, or an explicit path.
    """
    return asset("examples/games/js")
