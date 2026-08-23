"""NativeVectorEnv — the native threadpool backend behind the Gymnasium 1.0
``VectorEnv`` API, a drop-in for ``SubprocVecEnv``/CleanRL vector envs.

Wraps :class:`~playtrain.runtime.native_vec_env.NativeVecEnv` (in-process C++ threadpool,
GIL released per batch) and adds the Gymnasium autoreset layer in Python, using
the host's per-env ``reset_subset`` so autoreset seeds are controlled and
reproducible and terminal observations are surfaced.

Supports all three Gymnasium 1.0 autoreset modes:

* ``NEXT_STEP`` (Gymnasium 1.0 default) — terminal obs returned this step; the
  env is reset before the *next* step.
* ``SAME_STEP`` (SB3-style) — terminal obs stashed in
  ``info["final_observation"]`` (+ ``info["_final_observation"]`` mask), reset obs
  returned this step.
* ``DISABLED`` — caller resets explicitly.

Mirrors ``PlayTrainVecEnv``'s seeding controls (``fixed_env_seed``, ``seed_pool``) so
the two backends are interchangeable in a trainer.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Sequence

import numpy as np
import gymnasium as gym
from gymnasium import spaces
from gymnasium.vector import AutoresetMode, VectorEnv

from .native_vec_env import NativeVecEnv



def _coerce_autoreset(mode) -> AutoresetMode:
    if mode is None:
        return AutoresetMode.NEXT_STEP
    if isinstance(mode, AutoresetMode):
        return mode
    s = str(mode).lower().replace("-", "_")
    for m in AutoresetMode:
        if m.value.lower() == s or m.name.lower() == s:
            return m
    raise ValueError(f"Invalid autoreset_mode {mode!r}")


class NativeVectorEnv(VectorEnv):
    metadata = {"render_modes": [], "autoreset_mode": AutoresetMode.NEXT_STEP}

    def __init__(
        self,
        game: str = "bigfish",
        num_envs: int = 8,
        *,
        obs_size: int = 64,
        max_steps: int = 2000,
        num_threads: int = 0,
        n_actions: int | None = None,
        action_space: str | list | None = None,
        autoreset_mode: AutoresetMode | str | None = AutoresetMode.NEXT_STEP,
        autoreset_seed: int | None = None,
        fixed_env_seed: int | None = None,
        seed_pool: Sequence[int] | None = None,
        games_dir: str | os.PathLike | None = None,
        lib_path: str | os.PathLike | None = None,
    ) -> None:
        # Underlying host does NO autoreset — we drive it in Python for controlled
        # seeds + final_observation. (Mixed-game pools are async-only for now; this
        # sync VectorEnv runs num_envs copies of one game, the standard trainer case.)
        self._env = NativeVecEnv(
            game, num_envs, obs_size=obs_size, max_steps=max_steps,
            num_threads=num_threads, autoreset=False, action_space=action_space,
            games_dir=games_dir, lib_path=lib_path)
        self.num_envs = self._env.num_envs
        self.obs_size = obs_size
        self.num_threads = self._env.num_threads
        # The host's installed table is authoritative; a legacy explicit
        # n_actions must agree with it.
        if self._env.n_actions is None:
            raise ValueError("NativeVectorEnv is Discrete-only; drive box "
                             "action spaces through NativeVecEnv directly")
        self.n_actions = self._env.n_actions
        if n_actions is not None and int(n_actions) != self.n_actions:
            raise ValueError(f"n_actions={n_actions} conflicts with the "
                             f"action space's {self.n_actions} actions")

        self.autoreset_mode = _coerce_autoreset(autoreset_mode)
        self._rng = np.random.default_rng(autoreset_seed)
        self.fixed_env_seed = fixed_env_seed
        self.seed_pool = list(seed_pool) if seed_pool is not None else None

        self.single_action_space = spaces.Discrete(self.n_actions)
        self.single_observation_space = spaces.Box(
            low=0, high=255, shape=(obs_size, obs_size, 3), dtype=np.uint8)
        self.action_space = gym.vector.utils.batch_space(self.single_action_space, self.num_envs)
        self.observation_space = gym.vector.utils.batch_space(self.single_observation_space, self.num_envs)
        self.metadata = {**self.metadata, "autoreset_mode": self.autoreset_mode}

        self._needs_reset = np.zeros(self.num_envs, dtype=bool)
        self._closed = False

    # -- seed drawing (mirrors PlayTrainVecEnv) --
    def _autoreset_seeds(self, n: int) -> np.ndarray:
        if self.fixed_env_seed is not None:
            return np.full(n, int(self.fixed_env_seed), dtype=np.int32)
        if self.seed_pool is not None:
            return self._rng.choice(self.seed_pool, size=n).astype(np.int32)
        return self._rng.integers(0, 2**31 - 1, size=n, dtype=np.int64).astype(np.int32)

    def reset(self, *, seed: int | list[int | None] | None = None,
              options: dict | None = None) -> tuple[np.ndarray, dict[str, Any]]:
        if isinstance(seed, int):
            rng = np.random.default_rng(seed)
            seeds = rng.integers(0, 2**31 - 1, size=self.num_envs, dtype=np.int64).astype(np.int32)
        elif seed is None:
            seeds = self._autoreset_seeds(self.num_envs)
        else:
            if len(seed) != self.num_envs:
                raise ValueError(f"seed length {len(seed)} != num_envs {self.num_envs}")
            seeds = np.array([s if s is not None else int(self._rng.integers(0, 2**31 - 1))
                              for s in seed], dtype=np.int32)
        obs = self._env.reset(seeds=seeds)
        self._needs_reset.fill(False)
        return obs.copy(), {}

    def step(self, actions) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, dict[str, Any]]:
        if self.autoreset_mode is AutoresetMode.NEXT_STEP:
            marked = np.flatnonzero(self._needs_reset)
            if marked.size:
                self._env.reset_subset(marked, self._autoreset_seeds(marked.size))
                self._needs_reset.fill(False)

        obs, rew, term, trunc, _ = self._env.step(actions)
        info: dict[str, Any] = {}

        if self.autoreset_mode is AutoresetMode.SAME_STEP:
            done = term | trunc
            done_idxs = np.flatnonzero(done)
            if done_idxs.size:
                final_obs = obs[done_idxs].copy()
                self._env.reset_subset(done_idxs, self._autoreset_seeds(done_idxs.size))
                fobs = np.zeros_like(obs)
                fmask = np.zeros(self.num_envs, dtype=bool)
                fobs[done_idxs] = final_obs
                fmask[done_idxs] = True
                info["final_observation"] = fobs
                info["_final_observation"] = fmask
        elif self.autoreset_mode is AutoresetMode.NEXT_STEP:
            self._needs_reset = term | trunc

        return obs, rew.copy(), term.copy(), trunc.copy(), info

    def close(self, **_kwargs) -> None:
        if self._closed:
            return
        self._closed = True
        self._env.close()

    def __del__(self):
        try:
            self.close()
        except Exception:
            pass
