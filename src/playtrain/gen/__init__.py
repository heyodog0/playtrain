"""gym-gen — LLM-driven RL environment generation + validation harness.

This package owns the canonical game catalog and the validation harness.
Runtime / Gymnasium env classes live in the `playtrain.runtime` package.
"""

from .constants import CANONICAL_GAMES, GAMES_DIR

__all__ = [
    "CANONICAL_GAMES",
    "GAMES_DIR",
]
