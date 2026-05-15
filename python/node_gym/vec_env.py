"""DirectVecEnv: one Python process drives N Node workers via direct pipes + mmap.

Drop-in vectorised env for ``node-gym`` games. Eliminates the per-env
Python child process and the obs pickle round-trip that
``stable_baselines3.common.vec_env.SubprocVecEnv`` pays. Each Node worker
writes its obs to its own mmap region (same as today's NodeGymEnv); the
parent reads obs zero-copy directly into a pre-allocated batch tensor.

Subclasses ``gymnasium.vector.VectorEnv`` (Gymnasium 1.0 API). Supports all
three Gymnasium 1.0 autoreset modes (``NEXT_STEP``, ``SAME_STEP``,
``DISABLED``), so it's usable with both Gymnasium 1.0 trainers (CleanRL,
recent ``gymnasium.utils``) and SB3-style trainers (which expect
``SAME_STEP`` semantics).

See ``docs/MULTI_ENV_RUNTIME.md`` §5 for design context, and benchmark
receipts in ``logs/directvec_*`` (FASRC jobs 12972050 and 12978195).
"""

from __future__ import annotations

import json
import mmap
import os
import select
import shlex
import struct
import subprocess
import tempfile
import threading
from pathlib import Path
from typing import Any, Iterable, Sequence

import numpy as np
import gymnasium as gym
from gymnasium import spaces
from gymnasium.vector import AutoresetMode, VectorEnv

from .env import _resolve_games_dir, _resolve_runtime_dir


_HEADER_STRUCT = struct.Struct(">II")
_STEP_HEADER_STRUCT = struct.Struct(">fBBBBii")
_STEP_HEADER_SIZE = 16
_GS_NAMES = ("PLAYING", "WIN", "GAMEOVER", "EXIT")
_MMAP_SENTINEL = 0xFFFFFFFF
_DEFAULT_N_ACTIONS = 8  # NodeGymEnv currently exposes Discrete(8) for all games


class _Worker:
    """One Node subprocess + its mmap region. Internal helper for NodeVecEnv."""

    __slots__ = ("idx", "game", "proc", "mmap", "mmap_file", "mmap_path",
                 "mmap_size", "stdout_fd", "_stderr_thread", "_stderr_buf",
                 "_stderr_lock")

    def __init__(self, *, idx: int, game: str, game_path: Path, worker_path: Path,
                 runtime_dir: Path, obs_size: int, obs_mode: str,
                 needs_matter: bool, node_bin: str, node_flags: list[str]) -> None:
        self.idx = idx
        self.game = game

        # mmap region: header + RGB obs (worst case)
        single_frame_bytes = obs_size * obs_size * 3
        self.mmap_size = _STEP_HEADER_SIZE + single_frame_bytes
        self.mmap_file = tempfile.NamedTemporaryFile(
            prefix=f"node_gym_p5_vec{idx}_{game}_", suffix=".bin", delete=False)
        self.mmap_path = Path(self.mmap_file.name)
        self.mmap_file.truncate(self.mmap_size)
        self.mmap_file.flush()
        self.mmap = mmap.mmap(self.mmap_file.fileno(), self.mmap_size,
                              access=mmap.ACCESS_READ)

        proc_env = os.environ.copy()
        proc_env["NODE_GYM_P5_MMAP_PATH"] = str(self.mmap_path)
        cmd = [node_bin, *node_flags, str(worker_path),
               "--game", str(game_path),
               "--obs-mode", obs_mode,
               "--obs-size", str(obs_size)]
        if needs_matter:
            cmd.append("--matter")
        self.proc = subprocess.Popen(
            cmd, cwd=runtime_dir,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=False, bufsize=0, env=proc_env)
        self.stdout_fd = self.proc.stdout.fileno()

        # Drain stderr in a background thread so writes >64KB don't block the
        # worker. Buffered so we can surface errors at close() or in exceptions.
        self._stderr_buf: list[bytes] = []
        self._stderr_lock = threading.Lock()
        self._stderr_thread = threading.Thread(
            target=self._drain_stderr, daemon=True,
            name=f"node-gym-stderr-{idx}-{game}")
        self._stderr_thread.start()

    def _drain_stderr(self) -> None:
        try:
            while True:
                chunk = self.proc.stderr.read(4096)
                if not chunk:
                    return
                with self._stderr_lock:
                    self._stderr_buf.append(chunk)
                    # Cap at ~256 KB to avoid unbounded growth on chatty workers.
                    total = sum(len(b) for b in self._stderr_buf)
                    if total > 262144:
                        # Drop oldest until under cap.
                        while total > 131072 and len(self._stderr_buf) > 1:
                            removed = self._stderr_buf.pop(0)
                            total -= len(removed)
        except Exception:
            return  # pipe closed, worker exited, etc.

    def stderr_text(self) -> str:
        with self._stderr_lock:
            return b"".join(self._stderr_buf).decode("utf-8", errors="replace")

    def write_request(self, payload_bytes: bytes) -> None:
        """Write a framed JSON request to stdin. Does NOT flush — caller batches."""
        header = _HEADER_STRUCT.pack(len(payload_bytes), 0)
        self.proc.stdin.write(header)
        self.proc.stdin.write(payload_bytes)

    def flush_stdin(self) -> None:
        self.proc.stdin.flush()

    def read_step_response(self) -> tuple[float, int, int, int, int, int, int, bytes]:
        """Read one step response (sentinel-fast-path) — blocks. Returns
        (reward, term, trunc, gs_idx, lives, score, steps, obs_bytes)."""
        header = self._read_exact(8)
        meta_length, binary_length = _HEADER_STRUCT.unpack(header)
        if meta_length != _MMAP_SENTINEL:
            meta = self._read_exact(meta_length).decode("utf-8")
            extra = self._read_exact(binary_length) if binary_length else b""
            raise RuntimeError(f"worker {self.idx} ({self.game}): unexpected non-mmap response: {meta} {len(extra)}b")
        reward, term, trunc, gs_idx, lives, score, steps = _STEP_HEADER_STRUCT.unpack_from(self.mmap, 0)
        n_obs = binary_length if binary_length else (self.mmap_size - _STEP_HEADER_SIZE)
        obs = bytes(self.mmap[_STEP_HEADER_SIZE:_STEP_HEADER_SIZE + n_obs])
        return reward, term, trunc, gs_idx, lives, score, steps, obs

    def read_json_response(self) -> tuple[dict, bytes]:
        """Read a JSON-meta response (used for reset, ping, close)."""
        header = self._read_exact(8)
        meta_length, binary_length = _HEADER_STRUCT.unpack(header)
        if meta_length == _MMAP_SENTINEL:
            n_obs = binary_length if binary_length else (self.mmap_size - _STEP_HEADER_SIZE)
            obs = bytes(self.mmap[_STEP_HEADER_SIZE:_STEP_HEADER_SIZE + n_obs])
            return {"_mmap": True}, obs
        meta = json.loads(self._read_exact(meta_length).decode("utf-8"))
        binary = self._read_exact(binary_length) if binary_length else b""
        if not meta.get("ok"):
            raise RuntimeError(f"worker {self.idx} ({self.game}): {meta.get('error', meta)}")
        return meta, binary

    def _read_exact(self, n: int) -> bytes:
        chunks = []
        remaining = n
        while remaining > 0:
            chunk = self.proc.stdout.read(remaining)
            if not chunk:
                stderr = self.stderr_text().strip()[:400]
                raise RuntimeError(
                    f"worker {self.idx} ({self.game}) exited unexpectedly. "
                    f"stderr={stderr}")
            chunks.append(chunk)
            remaining -= len(chunk)
        return b"".join(chunks)

    def close(self) -> None:
        try:
            payload = b'{"cmd":"close"}'
            self.write_request(payload)
            self.flush_stdin()
        except Exception:
            pass
        try:
            self.proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait(timeout=2)
        try:
            if self.mmap is not None:
                self.mmap.close()
        except Exception:
            pass
        try:
            if self.mmap_file is not None:
                self.mmap_file.close()
            if self.mmap_path is not None:
                self.mmap_path.unlink(missing_ok=True)
        except Exception:
            pass


def _coerce_autoreset(mode) -> AutoresetMode:
    """Accept AutoresetMode, str, or None and normalize."""
    if mode is None:
        return AutoresetMode.NEXT_STEP
    if isinstance(mode, AutoresetMode):
        return mode
    s = str(mode).lower().replace("-", "_")
    for m in AutoresetMode:
        if m.value.lower() == s or m.name.lower() == s:
            return m
    raise ValueError(
        f"Invalid autoreset_mode {mode!r}. "
        f"Expected AutoresetMode or one of {[m.value for m in AutoresetMode]}.")


class NodeVecEnv(VectorEnv):
    """Vectorised node-gym env. One Python process, N Node workers, mmap obs.

    Subclasses ``gymnasium.vector.VectorEnv`` (Gymnasium 1.0 API). Drop-in for
    ``SubprocVecEnv([NodeGymEnv(g) for g in games])`` with significantly lower
    coordination overhead (FASRC bench: +71% aggregate sps for grid_v4 N=8;
    training-loop A/B: +13.8% trainer sps under realistic GPU-blocked timing).

    Parameters
    ----------
    games : sequence of str
        Game names to run, one per env. ``len(games) == num_envs``.
    games_dir, runtime_dir : path-like, optional
        Override the bundled game/runtime locations. Defaults follow the
        ``NODE_GYM_GAMES_DIR`` / ``NODE_GYM_RUNTIME`` env vars (same as
        ``NodeGymEnv``).
    obs_size : int
        Square observation side length (default 64).
    obs_mode : ``"rgb"`` or ``"grayscale"``
        Pixel mode (default ``"rgb"``).
    max_steps : int
        Episode truncation horizon passed to each worker (default 2000).
    node_bin : str
        Path to the node executable (default ``"node"``).
    autoreset_mode : ``AutoresetMode``, str, or None
        Gymnasium 1.0 autoreset mode. Default ``NEXT_STEP``: terminal obs is
        returned this step, the env is reset before the *next* step (the next
        step's action is discarded). ``SAME_STEP``: SB3-compatible — terminal
        obs is stashed in ``info["final_observation"]``, reset obs is returned
        in this step. ``DISABLED``: caller handles all resets explicitly.
    autoreset_seed : int or None
        Seed for the internal RNG used to draw per-env reset seeds during
        autoreset. Set for reproducible autoreset trajectories.
    n_actions : int
        Size of the discrete action space. Defaults to 8 (matches NodeGymEnv).

    Notes
    -----
    The returned ``observations`` array is a view into a pre-allocated internal
    buffer. If you need to retain observations across calls (e.g. building a
    rollout buffer), copy them explicitly. Standard PPO trainers that
    immediately convert obs into a torch tensor on each step are unaffected.
    """

    metadata = {"render_modes": [], "autoreset_mode": AutoresetMode.NEXT_STEP}

    def __init__(
        self,
        *,
        games: Sequence[str],
        games_dir: str | Path | None = None,
        runtime_dir: str | Path | None = None,
        obs_size: int = 64,
        obs_mode: str = "rgb",
        max_steps: int = 2000,
        node_bin: str = "node",
        autoreset_mode: AutoresetMode | str | None = AutoresetMode.NEXT_STEP,
        autoreset_seed: int | None = None,
        n_actions: int = _DEFAULT_N_ACTIONS,
    ) -> None:
        self.games = list(games)
        self.num_envs = len(self.games)
        if self.num_envs == 0:
            raise ValueError("games must be non-empty")
        self.obs_size = obs_size
        self.obs_mode = obs_mode
        self.max_steps = max_steps
        self.autoreset_mode = _coerce_autoreset(autoreset_mode)
        self._autoreset_rng = np.random.default_rng(autoreset_seed)
        self.n_actions = int(n_actions)
        if self.n_actions <= 0:
            raise ValueError(f"n_actions must be > 0, got {n_actions}")
        self._closed = False

        games_root = _resolve_games_dir(games_dir)
        runtime_root = _resolve_runtime_dir(runtime_dir)
        worker_path = runtime_root / "p5" / "game-worker.mjs"
        if not worker_path.exists():
            raise FileNotFoundError(f"Runtime worker not found: {worker_path}")

        self._channels = 3 if obs_mode == "rgb" else 1

        # Gymnasium 1.0 VectorEnv expects single_*_space and *_space.
        self.single_action_space = spaces.Discrete(self.n_actions)
        self.single_observation_space = spaces.Box(
            low=0, high=255,
            shape=(obs_size, obs_size, self._channels),
            dtype=np.uint8)
        # VectorEnv auto-derives action_space and observation_space if we set
        # the single_* attrs and num_envs, but set explicitly for clarity.
        self.action_space = gym.vector.utils.batch_space(
            self.single_action_space, self.num_envs)
        self.observation_space = gym.vector.utils.batch_space(
            self.single_observation_space, self.num_envs)

        node_flags = shlex.split(os.environ.get("NODE_GYM_NODE_FLAGS", ""))
        self.workers: list[_Worker] = []
        try:
            for idx, game in enumerate(self.games):
                game_path = games_root / f"{game}.js"
                if not game_path.exists():
                    raise FileNotFoundError(f"Game not found: {game_path}")
                needs_matter = "Matter." in game_path.read_text()
                self.workers.append(_Worker(
                    idx=idx, game=game, game_path=game_path, worker_path=worker_path,
                    runtime_dir=runtime_root, obs_size=obs_size, obs_mode=obs_mode,
                    needs_matter=needs_matter, node_bin=node_bin, node_flags=node_flags))

            # Ping each worker to ensure they're up before timing.
            ping = b'{"cmd":"ping"}'
            for w in self.workers:
                w.write_request(ping)
                w.flush_stdin()
            for w in self.workers:
                w.read_json_response()
        except Exception:
            self._cleanup_partial()
            raise

        # Pre-allocate batched obs buffer.
        self._obs_buf = np.empty(
            (self.num_envs, obs_size, obs_size, self._channels), dtype=np.uint8)
        self._rewards = np.zeros(self.num_envs, dtype=np.float32)
        self._terms = np.zeros(self.num_envs, dtype=bool)
        self._truncs = np.zeros(self.num_envs, dtype=bool)
        # Pre-encoded step requests for all valid actions (size = n_actions).
        self._step_payloads = [
            json.dumps({"cmd": "step", "action": a}).encode("utf-8")
            for a in range(self.n_actions)
        ]
        # NEXT_STEP autoreset bookkeeping: which envs need a reset before
        # processing the next action.
        self._needs_reset = np.zeros(self.num_envs, dtype=bool)

        # Set metadata to reflect actual mode (subclass override).
        self.metadata = {**self.metadata, "autoreset_mode": self.autoreset_mode}

    def _cleanup_partial(self) -> None:
        for w in getattr(self, "workers", []):
            try:
                w.close()
            except Exception:
                pass

    # -- Step / reset --

    def reset(
        self,
        *,
        seed: int | list[int | None] | None = None,
        options: dict | None = None,
    ) -> tuple[np.ndarray, dict[str, Any]]:
        """Reset all envs. ``seed`` may be a single int (split per env), a list
        of length ``num_envs``, or None.

        Returns ``(obs, info)`` where obs has shape ``(num_envs, H, W, C)`` and
        info is a ``dict`` (Gymnasium 1.0 vectorised info shape; empty by
        default — workers don't emit per-step info keys today).
        """
        if isinstance(seed, int):
            # Single seed: derive per-env seeds deterministically.
            rng = np.random.default_rng(seed)
            seeds = [int(rng.integers(0, 2**31 - 1)) for _ in range(self.num_envs)]
        elif seed is None:
            seeds = [None] * self.num_envs
        else:
            if len(seed) != self.num_envs:
                raise ValueError(
                    f"seed length {len(seed)} != num_envs {self.num_envs}")
            seeds = list(seed)
        max_steps = self.max_steps
        if options and "max_steps" in options:
            max_steps = int(options["max_steps"])

        # Issue all reset requests in parallel.
        for w, s in zip(self.workers, seeds):
            payload = json.dumps(
                {"cmd": "reset", "seed": s, "max_steps": max_steps}
            ).encode("utf-8")
            w.write_request(payload)
        for w in self.workers:
            w.flush_stdin()
        for i, w in enumerate(self.workers):
            _meta, obs_bytes = w.read_json_response()
            self._copy_obs_into_buf(i, obs_bytes)
        self._needs_reset.fill(False)
        return self._obs_buf.copy(), {}

    def step(
        self, actions
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, dict[str, Any]]:
        """Step all envs. ``actions`` may be a sequence or ``np.ndarray`` of
        length ``num_envs``. Returns
        ``(obs, rewards, terminations, truncations, info)`` per Gymnasium 1.0.
        """
        actions = np.asarray(actions)
        if actions.shape[0] != self.num_envs:
            raise ValueError(
                f"actions length {actions.shape[0]} != num_envs {self.num_envs}")
        # Validate actions up front (faster than indexing into _step_payloads
        # and producing IndexError later).
        amin, amax = int(actions.min()), int(actions.max())
        if amin < 0 or amax >= self.n_actions:
            raise ValueError(
                f"actions out of range [0, {self.n_actions - 1}]: "
                f"min={amin}, max={amax}")

        # NEXT_STEP autoreset: reset envs that terminated last step BEFORE
        # processing this step's action. Per Gymnasium 1.0 spec, the action
        # for those envs is ignored.
        if self.autoreset_mode is AutoresetMode.NEXT_STEP:
            self._do_autoreset_for_marked()

        # Phase 1: write all action requests.
        for w, a in zip(self.workers, actions):
            w.write_request(self._step_payloads[int(a)])
        # Phase 2: flush all stdins.
        for w in self.workers:
            w.flush_stdin()
        # Phase 3: drain stdouts via select.
        remaining = set(range(self.num_envs))
        fd_to_idx = {w.stdout_fd: i for i, w in enumerate(self.workers)}
        while remaining:
            ready_fds, _, _ = select.select(
                [self.workers[i].stdout_fd for i in remaining], [], [])
            for fd in ready_fds:
                i = fd_to_idx[fd]
                if i not in remaining:
                    continue
                w = self.workers[i]
                reward, term, trunc, _gs, _l, _s, _steps, obs_bytes = w.read_step_response()
                self._rewards[i] = reward
                self._terms[i] = bool(term)
                self._truncs[i] = bool(trunc)
                self._copy_obs_into_buf(i, obs_bytes)
                remaining.discard(i)

        info: dict[str, Any] = {}

        if self.autoreset_mode is AutoresetMode.SAME_STEP:
            # SB3-compatible: substitute reset obs for terminated envs in this
            # step's return. Stash terminal obs in info["final_observation"]
            # with mask info["_final_observation"].
            done_mask = self._terms | self._truncs
            done_idxs = np.flatnonzero(done_mask)
            if done_idxs.size:
                final_obs = np.empty_like(self._obs_buf)
                final_mask = np.zeros(self.num_envs, dtype=bool)
                for i in done_idxs:
                    final_obs[i] = self._obs_buf[i]
                    final_mask[i] = True
                self._reset_envs(done_idxs.tolist())
                info["final_observation"] = final_obs
                info["_final_observation"] = final_mask
        elif self.autoreset_mode is AutoresetMode.NEXT_STEP:
            # Mark envs that terminated this step for reset on the NEXT step.
            np.logical_or(self._terms, self._truncs, out=self._needs_reset)
        # AutoresetMode.DISABLED: caller resets explicitly.

        return (self._obs_buf, self._rewards.copy(),
                self._terms.copy(), self._truncs.copy(), info)

    def _do_autoreset_for_marked(self) -> None:
        idxs = np.flatnonzero(self._needs_reset).tolist()
        if not idxs:
            return
        self._reset_envs(idxs)
        self._needs_reset.fill(False)

    def _reset_envs(self, indices: list[int]) -> None:
        """Reset the given envs in parallel and copy obs into _obs_buf."""
        if not indices:
            return
        max_steps = self.max_steps
        for i in indices:
            seed = int(self._autoreset_rng.integers(0, 2**31 - 1))
            payload = json.dumps(
                {"cmd": "reset", "seed": seed, "max_steps": max_steps}
            ).encode("utf-8")
            self.workers[i].write_request(payload)
        for i in indices:
            self.workers[i].flush_stdin()
        pending = set(indices)
        fd_to_idx = {self.workers[i].stdout_fd: i for i in indices}
        while pending:
            ready_fds, _, _ = select.select(
                [self.workers[i].stdout_fd for i in pending], [], [])
            for fd in ready_fds:
                i = fd_to_idx.get(fd)
                if i is None or i not in pending:
                    continue
                _meta, obs_bytes = self.workers[i].read_json_response()
                self._copy_obs_into_buf(i, obs_bytes)
                pending.discard(i)

    def _copy_obs_into_buf(self, i: int, raw: bytes) -> None:
        arr = np.frombuffer(raw, dtype=np.uint8)
        if self.obs_mode == "rgb":
            self._obs_buf[i] = arr.reshape(self.obs_size, self.obs_size, 3)
        else:
            self._obs_buf[i, ..., 0] = arr.reshape(self.obs_size, self.obs_size)

    def close(self, **_kwargs) -> None:
        if self._closed:
            return
        self._closed = True
        for w in self.workers:
            try:
                w.close()
            except Exception:
                pass

    def __del__(self) -> None:
        try:
            self.close()
        except Exception:
            pass
