"""node-gym — headless game environments for Python Gymnasium.

Backends:
  - QuickJS + native rasterizer   — QuickJSEnv (DEFAULT: runs game JS as-is on an
    embedded engine + native rasterizer; 100% coverage, deterministic, ~1.5x
    ProcGen/core). This is the canonical training/eval engine. Aliased as GameEnv.
  - Node.js p5.js / node-canvas   — NodeGymEnv (original V8 backend)
  - Three.js / WebGPU / Dawn      — NodeGymThreeEnv (v2)
"""

from .env import NodeGymEnv, SeedRangeWrapper, list_available_games
from .three import NodeGymThreeEnv, list_available_threejs_games
from .vec_env import NodeVecEnv

try:
    from .qjs_env import QuickJSEnv
    # Canonical default backend.
    GameEnv = QuickJSEnv
except Exception:  # qjs_host not built yet — fall back to the Node backend.
    QuickJSEnv = None
    GameEnv = NodeGymEnv

__version__ = "0.2.0"

__all__ = [
    "QuickJSEnv",
    "GameEnv",
    "NodeGymEnv",
    "NodeGymThreeEnv",
    "NodeVecEnv",
    "SeedRangeWrapper",
    "list_available_games",
    "list_available_threejs_games",
    "__version__",
]
