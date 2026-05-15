"""DirectVecEnv: one Python process drives N Node workers via direct pipes + mmap.

Drop-in replacement for ``SubprocVecEnv([NodeGymEnv(g) for g in games])`` that
removes the per-env Python child process and the pickle round-trip. Each Node
worker writes its obs to its own mmap region (same as today's NodeGymEnv);
the parent reads obs zero-copy.

See docs/MULTI_ENV_RUNTIME.md §5.
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
from pathlib import Path
from typing import Any, Sequence

import numpy as np
from gymnasium import spaces

from .env import _resolve_games_dir, _resolve_runtime_dir


_HEADER_STRUCT = struct.Struct(">II")
_STEP_HEADER_STRUCT = struct.Struct(">fBBBBii")
_STEP_HEADER_SIZE = 16
_GS_NAMES = ("PLAYING", "WIN", "GAMEOVER", "EXIT")
_MMAP_SENTINEL = 0xFFFFFFFF


class _Worker:
    """One Node subprocess + its mmap region. Internal helper for NodeVecEnv."""

    __slots__ = ("idx", "game", "proc", "mmap", "mmap_file", "mmap_path",
                 "mmap_size", "stdout_fd", "_pending_stdout")

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
        self._pending_stdout = bytearray()

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
        # Read 8-byte outer header
        header = self._read_exact(8)
        meta_length, binary_length = _HEADER_STRUCT.unpack(header)
        if meta_length != _MMAP_SENTINEL:
            # Slow path — JSON message (e.g. an error)
            meta = self._read_exact(meta_length).decode("utf-8")
            extra = self._read_exact(binary_length) if binary_length else b""
            raise RuntimeError(f"worker {self.idx} ({self.game}): unexpected non-mmap response: {meta} {len(extra)}b")
        # mmap fast path: step header + obs already in shared region
        reward, term, trunc, gs_idx, lives, score, steps = _STEP_HEADER_STRUCT.unpack_from(self.mmap, 0)
        n_obs = binary_length if binary_length else (self.mmap_size - _STEP_HEADER_SIZE)
        obs = bytes(self.mmap[_STEP_HEADER_SIZE:_STEP_HEADER_SIZE + n_obs])
        return reward, term, trunc, gs_idx, lives, score, steps, obs

    def read_json_response(self) -> tuple[dict, bytes]:
        """Read a JSON-meta response (used for reset, ping, close)."""
        header = self._read_exact(8)
        meta_length, binary_length = _HEADER_STRUCT.unpack(header)
        if meta_length == _MMAP_SENTINEL:
            # Worker chose mmap fast path even for this response
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
                stderr = b""
                if self.proc.stderr is not None:
                    try:
                        stderr = self.proc.stderr.read().strip()
                    except Exception:
                        pass
                raise RuntimeError(
                    f"worker {self.idx} ({self.game}) exited unexpectedly. "
                    f"stderr={stderr.decode(errors='replace')[:400]}")
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


class NodeVecEnv:
    """Vectorized node-gym env. One Python process, N Node workers, mmap obs.

    API mirrors Gymnasium's VectorEnv at the level analogen's training loop uses
    (step / reset / close). Not a full ``gym.vector.VectorEnv`` subclass yet —
    the goal of this prototype is to bench it against SubprocVecEnv first.
    """

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
    ) -> None:
        self.games = list(games)
        self.num_envs = len(self.games)
        self.obs_size = obs_size
        self.obs_mode = obs_mode
        self.max_steps = max_steps
        self._closed = False

        games_root = _resolve_games_dir(games_dir)
        runtime_root = _resolve_runtime_dir(runtime_dir)
        worker_path = runtime_root / "p5" / "game-worker.mjs"
        if not worker_path.exists():
            raise FileNotFoundError(f"Runtime worker not found: {worker_path}")

        self._channels = 3 if obs_mode == "rgb" else 1
        self.action_space = spaces.Discrete(8)
        self.single_observation_space = spaces.Box(
            low=0, high=255,
            shape=(obs_size, obs_size, self._channels),
            dtype=np.uint8)
        self.observation_space = spaces.Box(
            low=0, high=255,
            shape=(self.num_envs, obs_size, obs_size, self._channels),
            dtype=np.uint8)

        node_flags = shlex.split(os.environ.get("NODE_GYM_NODE_FLAGS", ""))
        self.workers: list[_Worker] = []
        for idx, game in enumerate(self.games):
            game_path = games_root / f"{game}.js"
            if not game_path.exists():
                self._cleanup_partial()
                raise FileNotFoundError(f"Game not found: {game_path}")
            needs_matter = "Matter." in game_path.read_text()
            self.workers.append(_Worker(
                idx=idx, game=game, game_path=game_path, worker_path=worker_path,
                runtime_dir=runtime_root, obs_size=obs_size, obs_mode=obs_mode,
                needs_matter=needs_matter, node_bin=node_bin, node_flags=node_flags))

        # Ping each worker to ensure they're up before timing
        ping = b'{"cmd":"ping"}'
        for w in self.workers:
            w.write_request(ping)
            w.flush_stdin()
        for w in self.workers:
            w.read_json_response()

        # Pre-allocate batched obs buffer
        self._obs_buf = np.empty(
            (self.num_envs, obs_size, obs_size, self._channels), dtype=np.uint8)
        self._rewards = np.zeros(self.num_envs, dtype=np.float32)
        self._terms = np.zeros(self.num_envs, dtype=bool)
        self._truncs = np.zeros(self.num_envs, dtype=bool)
        # Pre-encoded step requests for action 0..7
        self._step_payloads = [
            json.dumps({"cmd": "step", "action": a}).encode("utf-8") for a in range(8)
        ]

    def _cleanup_partial(self) -> None:
        for w in getattr(self, "workers", []):
            try:
                w.close()
            except Exception:
                pass

    # -- Step / reset --

    def reset(self, *, seeds: Sequence[int | None] | None = None,
              max_steps: int | None = None) -> tuple[np.ndarray, list[dict]]:
        ms = max_steps if max_steps is not None else self.max_steps
        if seeds is None:
            seeds = [None] * self.num_envs
        if len(seeds) != self.num_envs:
            raise ValueError(
                f"seeds length {len(seeds)} != num_envs {self.num_envs}")
        # Issue all reset requests, flush all
        for w, s in zip(self.workers, seeds):
            payload = json.dumps({"cmd": "reset", "seed": s, "max_steps": ms}).encode("utf-8")
            w.write_request(payload)
        for w in self.workers:
            w.flush_stdin()
        # Read all responses
        infos = []
        for i, w in enumerate(self.workers):
            meta, obs_bytes = w.read_json_response()
            self._copy_obs_into_buf(i, obs_bytes)
            infos.append(meta.get("info", {}))
        return self._obs_buf.copy(), infos

    def step(self, actions: Sequence[int]) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, list[dict]]:
        # Phase 1: write all action requests (no flush yet — minimize syscalls)
        for w, a in zip(self.workers, actions):
            w.write_request(self._step_payloads[int(a) & 7])
        # Phase 2: flush all stdins (kicks off parallel work in N Node workers)
        for w in self.workers:
            w.flush_stdin()
        # Phase 3: drain N stdouts. Use select to pick up workers as they finish.
        infos = [None] * self.num_envs
        remaining = set(range(self.num_envs))
        fd_to_idx = {w.stdout_fd: i for i, w in enumerate(self.workers)}
        # Simple loop: select for ready FDs, read one full response from each
        while remaining:
            ready_fds, _, _ = select.select([self.workers[i].stdout_fd for i in remaining], [], [])
            for fd in ready_fds:
                i = fd_to_idx[fd]
                if i not in remaining:
                    continue
                w = self.workers[i]
                reward, term, trunc, gs_idx, lives, score, steps, obs_bytes = w.read_step_response()
                self._rewards[i] = reward
                self._terms[i] = bool(term)
                self._truncs[i] = bool(trunc)
                self._copy_obs_into_buf(i, obs_bytes)
                infos[i] = {
                    "score": score, "lives": lives,
                    "gameState": _GS_NAMES[gs_idx] if gs_idx < len(_GS_NAMES) else "UNKNOWN",
                    "episodeLength": steps,
                }
                remaining.discard(i)
        return self._obs_buf, self._rewards.copy(), self._terms.copy(), self._truncs.copy(), infos

    def _copy_obs_into_buf(self, i: int, raw: bytes) -> None:
        arr = np.frombuffer(raw, dtype=np.uint8)
        if self.obs_mode == "rgb":
            self._obs_buf[i] = arr.reshape(self.obs_size, self.obs_size, 3)
        else:
            self._obs_buf[i, ..., 0] = arr.reshape(self.obs_size, self.obs_size)

    def close(self) -> None:
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
