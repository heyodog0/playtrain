"""Dataset catalog for the gym-gen benchmark.

Defines the canonical games shipped by this repo and the on-disk paths
where they live. Anything related to training baselines, ProcGen score
normalization, or experiment outputs lives in the consumer side (see
`gym_gen_experiments.baselines` in the paper repo).
"""

from __future__ import annotations

import json
from pathlib import Path


REPO_ROOT         = Path(__file__).resolve().parents[3]
GAMES_DIR         = REPO_ROOT / "games" / "js"
VARIANTS_REGISTRY = REPO_ROOT / "games" / "variants.json"


def variant_names() -> set[str]:
    """Names of games registered as prototype variants (games/variants.json).

    Variants are ordinary game files but are excluded from bulk ``--all`` runs so
    that experiments don't sweep half-baked prototypes. Promoting a variant drops
    it from the registry, making it first-class again. See playtrain.gen.variant.
    """
    if VARIANTS_REGISTRY.exists():
        try:
            return set(json.loads(VARIANTS_REGISTRY.read_text()).keys())
        except (json.JSONDecodeError, AttributeError):
            return set()
    return set()


# Canonical p5 game list — the games we ship with all 5 validation checks
# passing. Keep this in sync with games/js/*.js when adding new games to the
# paper sweep.
CANONICAL_GAMES: tuple[str, ...] = (
    "angry_birds",
    "asteroids",
    "bigfish",
    "bossfight",
    "breakout",
    "caveflyer",
    "chaser",
    "climber",
    "coinrun",
    "crossy_road",
    "dodgeball",
    "downwell",
    "flappy_bird",
    "freeway",
    "frostbite",
    "fruitbot",
    "heist",
    "jetpack_joyride",
    "jumper",
    "leaper",
    "mario",
    "maze",
    "miner",
    "ninja",
    "plunder",
    "sonic",
    "space_invaders",
    "starpilot",
    "suika",
    "vvvvvv",
)
