"""Dataset catalog for the gym-gen benchmark.

Defines the canonical games shipped by this repo and the on-disk paths
where they live. Anything related to training baselines, ProcGen score
normalization, or experiment outputs lives in the consumer side (see
`gym_gen_experiments.baselines` in the paper repo).
"""

from __future__ import annotations

from pathlib import Path


REPO_ROOT         = Path(__file__).resolve().parents[2]
GAMES_DIR         = REPO_ROOT / "games" / "js"
THREEJS_GAMES_DIR = REPO_ROOT / "games" / "threejs"


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
