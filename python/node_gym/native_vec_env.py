"""NativeVecEnv — envpool-class vectorized backend for node-gym.

One process, N QuickJS+rasterizer envs, a native C++ thread pool
(``native/qjs/qjs_vec_host.cpp``, built as ``libqjs_vec``). Unlike
``NodeVecEnv`` — which drives N Node subprocesses over pipes from a pure-Python
lockstep loop under the GIL — this class calls a single batched ``vec_step``
through ctypes. ctypes releases the GIL for the duration of the C call, so the
whole batch steps in parallel across the pool with **no Python in the hot loop,
no subprocess, and no pipe** — the same architecture envpool uses.

Each env owns its own JSContext + rasterizer state + p5 shim state and is pinned
to one worker thread, so per-env step semantics are byte-identical to the
single-env ``QuickJSEnv`` (verified bit-exact).

Observations are written directly into a pre-allocated ``(N, H, W, 3)`` uint8
buffer; ``step``/``reset`` return a view into it (copy if you need to retain it).
"""
from __future__ import annotations

import ctypes
import os
import sys
from pathlib import Path
from typing import Sequence

import numpy as np

_ROOT = Path(__file__).resolve().parents[2]
_GAMES_DIR = _ROOT / "examples" / "games" / "js"
_LIBNAME = "libqjs_vec.dylib" if sys.platform == "darwin" else "libqjs_vec.so"
_LIB_PATH = _ROOT / "native" / "build" / _LIBNAME

_ACTIONS = ("NOOP", "LEFT", "RIGHT", "UP", "DOWN", "D", "LEFT_D", "RIGHT_D")


def _load_lib(path: Path) -> ctypes.CDLL:
    if not path.exists():
        raise FileNotFoundError(
            f"{path} not built. Run native/build_qjs_vec.sh (and build_qjs.sh once first).")
    lib = ctypes.CDLL(str(path))
    lib.vec_create.restype = ctypes.c_void_p
    lib.vec_create.argtypes = [ctypes.c_char_p, ctypes.c_int, ctypes.c_int,
                               ctypes.c_int, ctypes.c_int, ctypes.c_int]
    lib.vec_obs_bytes.restype = ctypes.c_int
    lib.vec_obs_bytes.argtypes = [ctypes.c_void_p]
    lib.vec_num_threads.restype = ctypes.c_int
    lib.vec_num_threads.argtypes = [ctypes.c_void_p]
    P = ctypes.c_void_p
    lib.vec_reset.restype = None
    lib.vec_reset.argtypes = [P, P, P]
    lib.vec_step.restype = None
    lib.vec_step.argtypes = [P, P, P, P, P, P]
    lib.vec_close.restype = None
    lib.vec_close.argtypes = [P]
    return lib


class NativeVecEnv:
    def __init__(self, game: str = "bigfish", num_envs: int = 8, *,
                 obs_size: int = 64, max_steps: int = 2000, num_threads: int = 0,
                 autoreset: bool = False, games_dir: str | os.PathLike | None = None,
                 lib_path: str | os.PathLike | None = None):
        self.game = game
        self.num_envs = int(num_envs)
        self.obs_size = int(obs_size)
        self.max_steps = int(max_steps)
        self.autoreset = bool(autoreset)
        self._closed = False

        gdir = Path(games_dir) if games_dir else _GAMES_DIR
        game_path = game if game.endswith(".js") else str(gdir / f"{game}.js")
        if not Path(game_path).exists():
            raise FileNotFoundError(f"game not found: {game_path}")

        self._lib = _load_lib(Path(lib_path) if lib_path else _LIB_PATH)
        self._h = self._lib.vec_create(
            game_path.encode(), self.num_envs, self.obs_size,
            self.max_steps, int(num_threads), 1 if autoreset else 0)
        if not self._h:
            raise RuntimeError(f"vec_create failed for {game_path}")
        self.num_threads = self._lib.vec_num_threads(self._h)

        # pre-allocated batch buffers (contiguous, C-order)
        self._obs = np.empty((self.num_envs, self.obs_size, self.obs_size, 3), dtype=np.uint8)
        self._rew = np.empty(self.num_envs, dtype=np.float32)
        self._term = np.empty(self.num_envs, dtype=np.uint8)
        self._trunc = np.empty(self.num_envs, dtype=np.uint8)
        self._obs_p = self._obs.ctypes.data_as(ctypes.c_void_p)
        self._rew_p = self._rew.ctypes.data_as(ctypes.c_void_p)
        self._term_p = self._term.ctypes.data_as(ctypes.c_void_p)
        self._trunc_p = self._trunc.ctypes.data_as(ctypes.c_void_p)

    def reset(self, seeds: Sequence[int] | int | None = None):
        if seeds is None:
            seeds = np.arange(self.num_envs, dtype=np.int32)
        elif isinstance(seeds, int):
            seeds = np.full(self.num_envs, seeds, dtype=np.int32)
        else:
            seeds = np.ascontiguousarray(seeds, dtype=np.int32)
        if seeds.shape[0] != self.num_envs:
            raise ValueError(f"seeds length {seeds.shape[0]} != num_envs {self.num_envs}")
        self._lib.vec_reset(self._h, seeds.ctypes.data_as(ctypes.c_void_p), self._obs_p)
        return self._obs

    def step(self, actions):
        actions = np.ascontiguousarray(actions, dtype=np.int32)
        if actions.shape[0] != self.num_envs:
            raise ValueError(f"actions length {actions.shape[0]} != num_envs {self.num_envs}")
        self._lib.vec_step(
            self._h, actions.ctypes.data_as(ctypes.c_void_p),
            self._obs_p, self._rew_p, self._term_p, self._trunc_p)
        # uint8 buffers hold only 0/1, so .view(bool) is a valid zero-copy view
        # (avoids a per-step allocation in the hot loop).
        return (self._obs, self._rew,
                self._term.view(bool), self._trunc.view(bool), {})

    def close(self):
        if self._closed:
            return
        self._closed = True
        if getattr(self, "_h", None):
            self._lib.vec_close(self._h)
            self._h = None

    def __del__(self):
        try:
            self.close()
        except Exception:
            pass
