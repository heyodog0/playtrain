"""NativeVecEnv — envpool-class vectorized backend for PlayTrain.

One process, N QuickJS+rasterizer envs, a native C++ thread pool
(``native/qjs/qjs_vec_host.cpp``, built as ``libqjs_vec``). Unlike
``PlayTrainVecEnv`` — which drives N Node subprocesses over pipes from a pure-Python
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

from playtrain._paths import asset as _asset, games_dir as _games_dir
from playtrain.runtime.aot_cache import resolve_lib
from playtrain.runtime.action_space import (
    action_names, has_analog, is_default, load_space_spec, packed_analog,
    packed_channels, packed_tables, quantize_box_actions)

_GAMES_DIR = _games_dir()


def _resolve_games_dir(games_dir: str | os.PathLike | None) -> Path:
    """Resolve the games directory: explicit arg > $PLAYTRAIN_GAMES_DIR > bundled.

    Matches PlayTrainEnv's resolution (runtime/env.py) so vec and non-vec agree —
    games can live anywhere (e.g. a consumer repo's games/js) via the env var,
    with no need to symlink them into playtrain's bundled examples dir.
    """
    if games_dir:
        return Path(games_dir)
    env_var = os.environ.get("PLAYTRAIN_GAMES_DIR")
    if env_var:
        return Path(env_var)
    return _GAMES_DIR


_LIBNAME = "libqjs_vec.dylib" if sys.platform == "darwin" else "libqjs_vec.so"
_LIB_PATH = _asset("native/build/" + _LIBNAME)


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
    lib.vec_reset_subset.restype = None
    lib.vec_reset_subset.argtypes = [P, P, P, ctypes.c_int, P]
    lib.vec_close.restype = None
    lib.vec_close.argtypes = [P]
    # Custom-action-space entry points, absent from pre-box builds of the .so.
    # Bind them only if present: the default8 path never calls them, so an old
    # binary keeps working for default-space games (A/B against archived .so's).
    try:
        lib.vec_set_actions.restype = ctypes.c_int
        lib.vec_set_actions.argtypes = [P, P, P, ctypes.c_int, ctypes.c_int]
        lib.vec_set_action_analog.restype = ctypes.c_int
        lib.vec_set_action_analog.argtypes = [P, P, P, P, P]
        lib.vec_set_input_map.restype = ctypes.c_int
        lib.vec_set_input_map.argtypes = [P, P, P, ctypes.c_int]
        lib.vec_step_q.restype = None
        lib.vec_step_q.argtypes = [P, P, P, P, P, P]
    except AttributeError:
        pass
    lib.vec_set_frame_skip.restype = None
    lib.vec_set_frame_skip.argtypes = [P, ctypes.c_int]
    lib.vec_set_render_skip.restype = None
    lib.vec_set_render_skip.argtypes = [P, ctypes.c_int]
    lib.vec_set_autoreset_seeds.restype = None
    lib.vec_set_autoreset_seeds.argtypes = [P, ctypes.c_int, P, ctypes.c_int,
                                            ctypes.c_uint64]
    lib.vec_set_group_mode.restype = None
    lib.vec_set_group_mode.argtypes = [P]
    lib.vec_wait_ids.restype = None
    lib.vec_wait_ids.argtypes = [P, P, ctypes.c_int]
    # async (envpool send/recv)
    lib.vec_create_async.restype = ctypes.c_void_p
    lib.vec_create_async.argtypes = [ctypes.c_char_p, ctypes.c_int, ctypes.c_int,
                                     ctypes.c_int, ctypes.c_int, ctypes.c_int]
    lib.vec_create_async_multi.restype = ctypes.c_void_p
    lib.vec_create_async_multi.argtypes = [ctypes.POINTER(ctypes.c_char_p), ctypes.c_int,
                                           ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int]
    lib.vec_async_setup.restype = None
    lib.vec_async_setup.argtypes = [P, P, P, P, P]
    lib.vec_async_reset.restype = None
    lib.vec_async_reset.argtypes = [P, P]
    lib.vec_send.restype = None
    lib.vec_send.argtypes = [P, P, P, ctypes.c_int]
    lib.vec_recv.restype = ctypes.c_int
    lib.vec_recv.argtypes = [P, ctypes.c_int, P]
    return lib


def _install_action_space(lib, h, action_space) -> dict:
    """Resolve ``action_space`` (name / .json path / action list / box dict /
    None) and install it on host ``h``. The host defaults to the frozen
    default8 table, so the default path makes no call. A box space installs a
    channel map instead (vec_set_input_map) and is stepped via vec_step_q.
    Returns the resolved spec dict (see load_space_spec)."""
    spec = load_space_spec(action_space)
    if spec["type"] == "box":
        kinds, args, n = packed_channels(spec["channels"])
        ok = lib.vec_set_input_map(
            h, kinds.ctypes.data_as(ctypes.c_void_p),
            args.ctypes.data_as(ctypes.c_void_p), n)
        if not ok:
            raise RuntimeError("vec_set_input_map rejected the channel map")
        return spec
    actions = spec["actions"]
    if not is_default(actions):
        held, press, n, max_held = packed_tables(actions)
        ok = lib.vec_set_actions(
            h, held.ctypes.data_as(ctypes.c_void_p),
            press.ctypes.data_as(ctypes.c_void_p), n, max_held)
        if not ok:
            raise RuntimeError("vec_set_actions rejected the action table")
        if has_analog(actions):
            qpointer, has_ptr, buttons, qaxes = packed_analog(actions)
            ok = lib.vec_set_action_analog(
                h, qpointer.ctypes.data_as(ctypes.c_void_p),
                has_ptr.ctypes.data_as(ctypes.c_void_p),
                buttons.ctypes.data_as(ctypes.c_void_p),
                qaxes.ctypes.data_as(ctypes.c_void_p))
            if not ok:
                raise RuntimeError("vec_set_action_analog rejected the analog table")
    return spec


class NativeVecEnv:
    def __init__(self, game: str = "bigfish", num_envs: int = 8, *,
                 obs_size: int = 64, max_steps: int = 2000, num_threads: int = 0,
                 autoreset: bool = False, frame_skip: int = 1,
                 render_skip: bool = False,
                 action_space: str | list | None = None,
                 games_dir: str | os.PathLike | None = None,
                 lib_path: str | os.PathLike | None = None):
        self.game = game
        self.num_envs = int(num_envs)
        self.obs_size = int(obs_size)
        self.max_steps = int(max_steps)  # counts FRAMES (game ticks), not steps
        self.autoreset = bool(autoreset)
        self.frame_skip = max(1, int(frame_skip))
        self._closed = False

        gdir = _resolve_games_dir(games_dir)
        game_path = game if game.endswith(".js") else str(gdir / f"{game}.js")
        if not Path(game_path).exists():
            raise FileNotFoundError(f"game not found: {game_path}")

        # No explicit lib: the engine-tier ladder (aot_cache: stock -> tier 1/2/3 by
        # what exists for this game; missing tiers build in the background).
        self._lib = _load_lib(Path(lib_path) if lib_path else resolve_lib(game_path))
        self._h = self._lib.vec_create(
            game_path.encode(), self.num_envs, self.obs_size,
            self.max_steps, int(num_threads), 1 if autoreset else 0)
        if not self._h:
            raise RuntimeError(f"vec_create failed for {game_path}")
        spec = _install_action_space(self._lib, self._h, action_space)
        if spec["type"] == "box":
            self.actions = None
            self.n_actions = None
            self.box_channels = list(spec["channels"])
            self.action_dim = len(self.box_channels)
            self.action_meanings = list(self.box_channels)
        else:
            self.actions = spec["actions"]
            self.n_actions = len(self.actions)
            self.box_channels = None
            self.action_meanings = list(action_names(self.actions))
        if self.frame_skip > 1:
            self._lib.vec_set_frame_skip(self._h, self.frame_skip)
        # Render-skip: draw calls no-oped on all but the final tick of each
        # skip. Bit-exact for every surfaced value ONLY under autoreset (an
        # episode ending mid-skip has a stale canvas, but SAME_STEP autoreset
        # replaces the obs with the fully-rendered reset frame).
        self.render_skip = bool(render_skip) and self.frame_skip > 1
        if self.render_skip:
            if not self.autoreset:
                raise ValueError("render_skip requires autoreset=True "
                                 "(terminal obs would be stale otherwise)")
            self._lib.vec_set_render_skip(self._h, 1)
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
        # Persistent action buffer + cached pointer. Re-creating a ctypes pointer
        # each step (via .ctypes.data_as) costs ~730 ns; copying actions into this
        # buffer and reusing the cached pointer is ~7x cheaper in the hot loop.
        self._act = np.zeros(self.num_envs, dtype=np.int32)
        self._act_p = self._act.ctypes.data_as(ctypes.c_void_p)
        if self.box_channels is not None:
            self._qact = np.zeros((self.num_envs, self.action_dim), dtype=np.uint16)
            self._qact_p = self._qact.ctypes.data_as(ctypes.c_void_p)

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
        if self.box_channels is not None:
            # Box path: float actions (num_envs, action_dim) -> uint16 wire
            # values (quantized Python-side, the producer end of the contract).
            self._qact[:] = quantize_box_actions(actions, self.box_channels)
            self._lib.vec_step_q(
                self._h, self._qact_p,
                self._obs_p, self._rew_p, self._term_p, self._trunc_p)
            return (self._obs, self._rew,
                    self._term.view(bool), self._trunc.view(bool), {})
        # Copy into the persistent int32 buffer and reuse its cached pointer
        # (avoids per-step ctypes pointer creation; raises on length mismatch).
        self._act[:] = actions
        if self._act.min() < 0 or self._act.max() >= self.n_actions:
            bad = self._act[(self._act < 0) | (self._act >= self.n_actions)]
            raise ValueError(f"action(s) out of range [0, {self.n_actions}): {bad}")
        self._lib.vec_step(
            self._h, self._act_p,
            self._obs_p, self._rew_p, self._term_p, self._trunc_p)
        # uint8 buffers hold only 0/1, so .view(bool) is a valid zero-copy view
        # (avoids a per-step allocation in the hot loop).
        return (self._obs, self._rew,
                self._term.view(bool), self._trunc.view(bool), {})

    def set_autoreset_seeds(self, mode: str, *, pool: Sequence[int] | None = None,
                            fixed_seed: int = 0, rng_seed: int = 0):
        """Configure how SAME_STEP autoreset picks each new episode's seed.

        mode="formula": legacy per-env formula (default host behavior).
        mode="fixed":   every autoreset uses ``fixed_seed`` (a consumer repo's
                        fixed_env_seed — memorize one instance).
        mode="pool":    uniform sample from ``pool`` via deterministic per-env
                        splitmix64 streams derived from ``rng_seed`` (a consumer repo's
                        train_pool / SeedSetWrapper — finite binding pool).
        """
        if mode == "formula":
            self._lib.vec_set_autoreset_seeds(self._h, 0, None, 0, 0)
        elif mode == "fixed":
            self._lib.vec_set_autoreset_seeds(self._h, 1, None, 0,
                                              int(fixed_seed) & 0xFFFFFFFF)
        elif mode == "pool":
            arr = np.ascontiguousarray(pool, dtype=np.int32)
            if arr.size == 0:
                raise ValueError("pool must be non-empty")
            self._pool_keepalive = arr  # host copies, but keep it anyway
            self._lib.vec_set_autoreset_seeds(
                self._h, 2, arr.ctypes.data_as(ctypes.c_void_p), arr.size,
                int(rng_seed) & 0xFFFFFFFFFFFFFFFF)
        else:
            raise ValueError(f"unknown mode {mode!r}")

    def reset_subset(self, ids, seeds):
        """Reset just the envs in ``ids`` (int32) with ``seeds`` (int32); their
        reset obs are written into the shared obs buffer at those indices. Used by
        NativeVectorEnv for Gymnasium autoreset with controlled per-env seeds."""
        ids = np.ascontiguousarray(ids, dtype=np.int32)
        seeds = np.ascontiguousarray(seeds, dtype=np.int32)
        self._lib.vec_reset_subset(
            self._h, ids.ctypes.data_as(ctypes.c_void_p),
            seeds.ctypes.data_as(ctypes.c_void_p), len(ids), self._obs_p)

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


class AsyncNativeVecEnv:
    """Async (envpool-style) interface to the native threadpool host.

    Instead of a synchronous ``step`` that waits for all N envs (barrier tail
    latency), you ``send`` actions and ``recv`` the first ``batch_size`` envs
    that finish. A slow env never stalls the batch — this recovers the last
    multiple on cheap-frame games, where the per-step sync barrier dominates.

    Typical loop::

        env = AsyncNativeVecEnv("bigfish", num_envs=32, batch_size=16)
        env.reset()
        env.send(np.arange(32), np.zeros(32, np.int32))   # prime all envs
        while True:
            ids, obs, rew, term, trunc = env.recv()       # first 16 ready
            acts = policy(obs)                            # obs = buffer[ids]
            env.send(ids, acts)                           # re-submit them

    ``recv`` returns a *gather* of the ready envs: ``ids`` (the env indices) and
    ``obs/rew/term/trunc`` sliced to those ids. Autoreset defaults on (a done env
    is reset in-place and keeps flowing), matching a throughput/eval loop.
    """

    def __init__(self, game: str | None = "bigfish", num_envs: int = 32, *,
                 games: Sequence[str] | None = None,
                 batch_size: int | None = None, obs_size: int = 64, max_steps: int = 2000,
                 num_threads: int = 0, autoreset: bool = True, frame_skip: int = 1,
                 action_space: str | list | None = None,
                 games_dir: str | os.PathLike | None = None, lib_path: str | os.PathLike | None = None):
        gdir = _resolve_games_dir(games_dir)

        def _resolve(g: str) -> str:
            p = g if g.endswith(".js") else str(gdir / f"{g}.js")
            if not Path(p).exists():
                raise FileNotFoundError(f"game not found: {p}")
            return p

        # `games` (one per env, a mixed pool) takes precedence over a single `game`.
        if games is not None:
            self.games = list(games)
            self.num_envs = len(self.games)
            self.game = None
        else:
            self.num_envs = int(num_envs)
            self.games = [game] * self.num_envs
            self.game = game
        if self.num_envs == 0:
            raise ValueError("need at least one env")
        self.batch_size = int(batch_size) if batch_size else self.num_envs
        if not (1 <= self.batch_size <= self.num_envs):
            raise ValueError(f"batch_size must be in [1, num_envs]; got {self.batch_size}")
        self.obs_size = int(obs_size)
        self._closed = False

        paths = [_resolve(g) for g in self.games]
        # a mixed pool has no single game unit: resolve_lib(None) -> tier 1
        self._lib = _load_lib(Path(lib_path) if lib_path else resolve_lib(None if games is not None else paths[0]))
        if games is not None:
            arr = (ctypes.c_char_p * self.num_envs)(*[p.encode() for p in paths])
            self._h = self._lib.vec_create_async_multi(
                arr, self.num_envs, self.obs_size,
                int(max_steps), int(num_threads), 1 if autoreset else 0)
        else:
            self._h = self._lib.vec_create_async(
                paths[0].encode(), self.num_envs, self.obs_size,
                int(max_steps), int(num_threads), 1 if autoreset else 0)
        if not self._h:
            raise RuntimeError("vec_create_async failed")
        spec = _install_action_space(self._lib, self._h, action_space)
        if spec["type"] == "box":
            raise ValueError("box action spaces are sync-only for now; "
                             "use NativeVecEnv (the async host has no vec_step_q path)")
        self.actions = spec["actions"]
        self.n_actions = len(self.actions)
        self.action_meanings = list(action_names(self.actions))
        self.frame_skip = max(1, int(frame_skip))
        if self.frame_skip > 1:
            self._lib.vec_set_frame_skip(self._h, self.frame_skip)
        self.num_threads = self._lib.vec_num_threads(self._h)

        self._obs = np.empty((self.num_envs, self.obs_size, self.obs_size, 3), dtype=np.uint8)
        self._rew = np.empty(self.num_envs, dtype=np.float32)
        self._term = np.empty(self.num_envs, dtype=np.uint8)
        self._trunc = np.empty(self.num_envs, dtype=np.uint8)
        self._ids = np.empty(self.batch_size, dtype=np.int32)
        self._lib.vec_async_setup(
            self._h, self._obs.ctypes.data_as(ctypes.c_void_p),
            self._rew.ctypes.data_as(ctypes.c_void_p),
            self._term.ctypes.data_as(ctypes.c_void_p),
            self._trunc.ctypes.data_as(ctypes.c_void_p))

    def reset(self, seeds: Sequence[int] | int | None = None):
        if seeds is None:
            seeds = np.arange(self.num_envs, dtype=np.int32)
        elif isinstance(seeds, int):
            seeds = np.full(self.num_envs, seeds, dtype=np.int32)
        else:
            seeds = np.ascontiguousarray(seeds, dtype=np.int32)
        self._lib.vec_async_reset(self._h, seeds.ctypes.data_as(ctypes.c_void_p))
        return self._obs

    # Same protocol as NativeVecEnv.set_autoreset_seeds (autoreset is default-ON
    # here, so the policy governs every episode after the first).
    set_autoreset_seeds = NativeVecEnv.set_autoreset_seeds

    def send(self, env_ids, actions):
        env_ids = np.ascontiguousarray(env_ids, dtype=np.int32)
        actions = np.ascontiguousarray(actions, dtype=np.int32)
        if actions.size and (actions.min() < 0 or actions.max() >= self.n_actions):
            bad = actions[(actions < 0) | (actions >= self.n_actions)]
            raise ValueError(f"action(s) out of range [0, {self.n_actions}): {bad}")
        n = env_ids.shape[0]
        self._lib.vec_send(self._h, env_ids.ctypes.data_as(ctypes.c_void_p),
                           actions.ctypes.data_as(ctypes.c_void_p), n)

    def recv(self):
        self._lib.vec_recv(self._h, self.batch_size, self._ids.ctypes.data_as(ctypes.c_void_p))
        ids = self._ids
        return (ids, self._obs[ids], self._rew[ids],
                self._term[ids].view(bool), self._trunc[ids].view(bool))

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


class PingPongVecEnv:
    """Two env GROUPS sharing one threadpool, for double-buffered sampling
    (Sample-Factory style): ``send(g, actions)`` dispatches group g's step and
    returns immediately — the pool steps those envs while the caller runs
    inference for the OTHER group — then ``wait(g)`` blocks until group g's
    outputs are complete. Ping-pong the two groups and the GPU/Python work
    hides behind env stepping (and vice versa).

    Group g = env indices [g*group_size, (g+1)*group_size); outputs are
    contiguous views into the shared buffers. Autoreset is always ON (this is
    a training-loop construct; it is also what makes render_skip valid).
    Per-env step semantics are identical to NativeVecEnv (same env_step).
    """

    def __init__(self, game: str, group_size: int, *, obs_size: int = 64,
                 max_steps: int = 2000, num_threads: int = 0,
                 frame_skip: int = 1, render_skip: bool = False,
                 action_space: str | list | None = None,
                 games_dir: str | os.PathLike | None = None,
                 lib_path: str | os.PathLike | None = None):
        self.group_size = int(group_size)
        self.num_envs = 2 * self.group_size
        self.obs_size = int(obs_size)
        self.frame_skip = max(1, int(frame_skip))
        self._closed = False

        gdir = _resolve_games_dir(games_dir)
        game_path = game if game.endswith(".js") else str(gdir / f"{game}.js")
        if not Path(game_path).exists():
            raise FileNotFoundError(f"game not found: {game_path}")

        self._lib = _load_lib(Path(lib_path) if lib_path else resolve_lib(game_path))
        self._h = self._lib.vec_create_async(
            game_path.encode(), self.num_envs, self.obs_size,
            int(max_steps), int(num_threads), 1)  # autoreset always on
        if not self._h:
            raise RuntimeError(f"vec_create_async failed for {game_path}")
        spec = _install_action_space(self._lib, self._h, action_space)
        if spec["type"] == "box":
            raise ValueError("box action spaces are sync-only for now; "
                             "use NativeVecEnv (the async host has no vec_step_q path)")
        self.actions = spec["actions"]
        self.n_actions = len(self.actions)
        self.action_meanings = list(action_names(self.actions))
        self._lib.vec_set_group_mode(self._h)
        if self.frame_skip > 1:
            self._lib.vec_set_frame_skip(self._h, self.frame_skip)
        self.render_skip = bool(render_skip) and self.frame_skip > 1
        if self.render_skip:
            self._lib.vec_set_render_skip(self._h, 1)
        self.num_threads = self._lib.vec_num_threads(self._h)

        N = self.num_envs
        self._obs = np.empty((N, self.obs_size, self.obs_size, 3), dtype=np.uint8)
        self._rew = np.empty(N, dtype=np.float32)
        self._term = np.empty(N, dtype=np.uint8)
        self._trunc = np.empty(N, dtype=np.uint8)
        self._lib.vec_async_setup(
            self._h, self._obs.ctypes.data_as(ctypes.c_void_p),
            self._rew.ctypes.data_as(ctypes.c_void_p),
            self._term.ctypes.data_as(ctypes.c_void_p),
            self._trunc.ctypes.data_as(ctypes.c_void_p))
        # persistent per-group id + action buffers with cached pointers
        B = self.group_size
        self._gids = [np.arange(0, B, dtype=np.int32),
                      np.arange(B, 2 * B, dtype=np.int32)]
        self._gids_p = [g.ctypes.data_as(ctypes.c_void_p) for g in self._gids]
        self._gact = [np.zeros(B, dtype=np.int32) for _ in range(2)]
        self._gact_p = [a.ctypes.data_as(ctypes.c_void_p) for a in self._gact]

    set_autoreset_seeds = NativeVecEnv.set_autoreset_seeds

    def reset(self, seeds: Sequence[int] | int | None = None):
        if seeds is None:
            seeds = np.arange(self.num_envs, dtype=np.int32)
        elif isinstance(seeds, int):
            seeds = np.full(self.num_envs, seeds, dtype=np.int32)
        else:
            seeds = np.ascontiguousarray(seeds, dtype=np.int32)
        self._lib.vec_async_reset(self._h, seeds.ctypes.data_as(ctypes.c_void_p))
        return self._obs

    def send(self, group: int, actions) -> None:
        """Dispatch group's step; returns immediately."""
        self._gact[group][:] = actions
        a = self._gact[group]
        if a.min() < 0 or a.max() >= self.n_actions:
            bad = a[(a < 0) | (a >= self.n_actions)]
            raise ValueError(f"action(s) out of range [0, {self.n_actions}): {bad}")
        self._lib.vec_send(self._h, self._gids_p[group],
                           self._gact_p[group], self.group_size)

    def wait(self, group: int):
        """Block until the group's step completes; returns contiguous VIEWS
        (obs, rew, term, trunc) — copy anything you retain past next send."""
        self._lib.vec_wait_ids(self._h, self._gids_p[group], self.group_size)
        B = self.group_size
        lo, hi = group * B, (group + 1) * B
        return (self._obs[lo:hi], self._rew[lo:hi],
                self._term[lo:hi].view(bool), self._trunc[lo:hi].view(bool))

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
