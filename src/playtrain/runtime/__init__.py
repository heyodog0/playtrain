"""PlayTrain — headless p5.js game environments for Python Gymnasium.

Backends:
  - QuickJS + native rasterizer  — QuickJSEnv (**the default**): runs game JS as-is
    on an embedded engine + native rasterizer; 100% coverage, deterministic, fastest.
    This is the canonical training/eval engine, aliased as ``GameEnv``. Built by
    ``just install`` (native/build_qjs.sh); requires the native host.
  - envpool-class vectorized      — NativeVecEnv / AsyncNativeVecEnv (in-process C++
    threadpool over QuickJS), built by native/build_qjs_vec.sh.
  - Node.js p5.js / node-canvas   — PlayTrainEnv (portable fallback, no native build).

Prefer ``GameEnv`` (QuickJS) unless you specifically need the pure-Node backend.
"""

from .action_space import load_action_space
from .env import PlayTrainEnv, SeedRangeWrapper, list_available_games
from .vec_env import PlayTrainVecEnv

# QuickJS + native rasterizer is the canonical default backend.
from .qjs_env import QuickJSEnv
GameEnv = QuickJSEnv

# envpool-class vectorized backend (in-process C++ threadpool over QuickJS).
from .native_vec_env import AsyncNativeVecEnv, NativeVecEnv
from .native_vector_env import NativeVectorEnv  # Gymnasium VectorEnv wrapper

__version__ = "0.2.0"

__all__ = [
    "QuickJSEnv",
    "GameEnv",
    "NativeVecEnv",
    "AsyncNativeVecEnv",
    "NativeVectorEnv",
    "PlayTrainEnv",
    "PlayTrainVecEnv",
    "SeedRangeWrapper",
    "list_available_games",
    "load_action_space",
    "__version__",
]
