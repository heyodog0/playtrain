"""node-gym — headless Node.js game environments for Python Gymnasium.

Two backends:
  - p5.js / Matter.js / node-canvas — see NodeGymEnv (the original)
  - Three.js / WebGPU / Dawn         — see NodeGymThreeEnv (v2)
"""

from .env import NodeGymEnv, SeedRangeWrapper, list_available_games
from .three import NodeGymThreeEnv, list_available_threejs_games

__version__ = "0.2.0"

__all__ = [
    "NodeGymEnv",
    "NodeGymThreeEnv",
    "SeedRangeWrapper",
    "list_available_games",
    "list_available_threejs_games",
    "__version__",
]
