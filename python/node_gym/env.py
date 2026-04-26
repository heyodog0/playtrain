from __future__ import annotations

import json
import os
import struct
import subprocess
from collections import deque
from pathlib import Path
from typing import Any

import gymnasium as gym
import numpy as np
from gymnasium import spaces


# Bundled example games that ship with the repo.
DEFAULT_GAMES_DIR = Path(__file__).resolve().parents[2] / "examples" / "games" / "js"

# Bundled JS runtime (game-worker.mjs + p5/ shim).
DEFAULT_RUNTIME_DIR = Path(__file__).resolve().parents[2] / "runtime"


def _resolve_runtime_dir(explicit: str | Path | None) -> Path:
    if explicit is not None:
        return Path(explicit).resolve()
    env_var = os.environ.get("NODE_GYM_RUNTIME")
    if env_var:
        return Path(env_var).resolve()
    return DEFAULT_RUNTIME_DIR


def _resolve_games_dir(explicit: str | Path | None) -> Path:
    if explicit is not None:
        return Path(explicit).resolve()
    env_var = os.environ.get("NODE_GYM_GAMES_DIR")
    if env_var:
        return Path(env_var).resolve()
    return DEFAULT_GAMES_DIR


class NodeGymEnv(gym.Env[np.ndarray, int]):
    """Gymnasium env that runs a JS game headlessly in a Node.js subprocess.

    Each instance spawns one ``node`` worker that loads the target JS game,
    drives it via a custom p5.js / Matter.js shim on top of node-canvas, and
    streams pixel observations back over a binary stdin/stdout protocol.

    Parameters
    ----------
    game:
        Game name. Resolved as ``{games_dir}/{game}.js``.
    games_dir:
        Directory containing JS game files. Defaults to bundled examples,
        overridable via the ``NODE_GYM_GAMES_DIR`` env var.
    runtime_dir:
        Directory containing ``game-worker.mjs`` and ``p5/`` shim. Defaults
        to the bundled ``runtime/``, overridable via ``NODE_GYM_RUNTIME``.
    obs_size:
        Side length of the square observation. Default 64.
    obs_mode:
        ``"rgb"`` (default) or ``"grayscale"``.
    frame_stack:
        Number of consecutive frames to stack along the channel axis.
    max_steps:
        Episode truncation horizon.
    node_bin:
        Path to the node executable (default ``"node"``).
    require_matter:
        Force-enable Matter.js. Auto-detected from the game source when ``None``.
    """

    metadata = {"render_modes": []}
    _HEADER_STRUCT = struct.Struct(">II")

    def __init__(
        self,
        *,
        game: str,
        games_dir: str | Path | None = None,
        runtime_dir: str | Path | None = None,
        obs_size: int = 64,
        obs_mode: str = "rgb",
        frame_stack: int = 1,
        max_steps: int = 2000,
        node_bin: str = "node",
        require_matter: bool | None = None,
    ) -> None:
        super().__init__()
        self.game = game
        self.obs_size = obs_size
        self.obs_mode = obs_mode
        self.frame_stack = frame_stack
        self.max_steps = max_steps
        self._closed = False

        self._games_dir = _resolve_games_dir(games_dir)
        self._runtime_dir = _resolve_runtime_dir(runtime_dir)
        self._worker_path = self._runtime_dir / "p5" / "game-worker.mjs"
        self._game_path = self._games_dir / f"{game}.js"

        if not self._game_path.exists():
            raise FileNotFoundError(f"Game not found: {self._game_path}")
        if not self._worker_path.exists():
            raise FileNotFoundError(
                f"Runtime worker not found: {self._worker_path}. "
                "Set NODE_GYM_RUNTIME or pass runtime_dir=."
            )

        if require_matter is None:
            needs_matter = "Matter." in self._game_path.read_text()
        else:
            needs_matter = require_matter

        if obs_mode == "rgb":
            self._channels = 3 * frame_stack
        else:
            self._channels = frame_stack

        self.action_space = spaces.Discrete(8)
        self.observation_space = spaces.Box(
            low=0,
            high=255,
            shape=(obs_size, obs_size, self._channels),
            dtype=np.uint8,
        )

        self._frames: deque[np.ndarray] = deque(maxlen=frame_stack)

        cmd = [
            node_bin,
            str(self._worker_path),
            "--game", str(self._game_path),
            "--obs-mode", obs_mode,
            "--obs-size", str(obs_size),
        ]
        if needs_matter:
            cmd.append("--matter")

        self._proc = subprocess.Popen(
            cmd,
            cwd=self._runtime_dir,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=False,
            bufsize=0,
        )

        self._request({"cmd": "ping"})

    # -- IPC helpers --

    def _read_exact(self, size: int) -> bytes:
        if self._proc.stdout is None:
            raise RuntimeError("Game worker stdout is unavailable")
        chunks: list[bytes] = []
        remaining = size
        while remaining > 0:
            chunk = self._proc.stdout.read(remaining)
            if not chunk:
                stderr = b""
                if self._proc.stderr is not None:
                    stderr = self._proc.stderr.read().strip()
                raise RuntimeError(
                    f"Game worker ({self.game}) exited unexpectedly. "
                    f"stderr={stderr.decode(errors='replace')}"
                )
            chunks.append(chunk)
            remaining -= len(chunk)
        return b"".join(chunks)

    def _request(self, payload: dict[str, Any]) -> tuple[dict[str, Any], bytes]:
        if self._closed:
            raise RuntimeError("NodeGymEnv is closed")
        if self._proc.stdin is None:
            raise RuntimeError("Game worker stdin is unavailable")

        meta = json.dumps(payload).encode("utf-8")
        header = self._HEADER_STRUCT.pack(len(meta), 0)
        self._proc.stdin.write(header)
        self._proc.stdin.write(meta)
        self._proc.stdin.flush()

        meta_length, binary_length = self._HEADER_STRUCT.unpack(
            self._read_exact(self._HEADER_STRUCT.size)
        )
        message = json.loads(self._read_exact(meta_length).decode("utf-8"))
        binary = self._read_exact(binary_length) if binary_length else b""
        if not message.get("ok"):
            raise RuntimeError(message.get("error", f"Unknown game worker error ({self.game})"))
        return message, binary

    # -- Observation handling --

    def _decode_obs(self, raw: bytes) -> np.ndarray:
        obs = np.frombuffer(raw, dtype=np.uint8)
        if self.obs_mode == "rgb":
            return obs.reshape(self.obs_size, self.obs_size, 3)
        return obs.reshape(self.obs_size, self.obs_size)

    def _stacked_obs(self) -> np.ndarray:
        if self.obs_mode == "rgb" and self.frame_stack == 1:
            return list(self._frames)[0]
        if self.obs_mode == "rgb":
            return np.concatenate(list(self._frames), axis=-1).astype(np.uint8, copy=False)
        return np.stack(list(self._frames), axis=-1).astype(np.uint8, copy=False)

    # -- Gymnasium interface --

    def reset(
        self,
        *,
        seed: int | None = None,
        options: dict[str, Any] | None = None,
    ) -> tuple[np.ndarray, dict[str, Any]]:
        super().reset(seed=seed)
        max_steps = self.max_steps
        if options and "max_steps" in options:
            max_steps = int(options["max_steps"])

        response, observation = self._request(
            {"cmd": "reset", "seed": seed, "max_steps": max_steps}
        )
        first_frame = self._decode_obs(observation)
        self._frames.clear()
        for _ in range(self.frame_stack):
            self._frames.append(first_frame.copy())
        return self._stacked_obs(), response["info"]

    def step(self, action: int) -> tuple[np.ndarray, float, bool, bool, dict[str, Any]]:
        response, observation = self._request({"cmd": "step", "action": int(action)})
        frame = self._decode_obs(observation)
        self._frames.append(frame)
        return (
            self._stacked_obs(),
            float(response["reward"]),
            bool(response["terminated"]),
            bool(response["truncated"]),
            response["info"],
        )

    def close(self) -> None:
        if self._closed:
            return
        try:
            self._request({"cmd": "close"})
        except Exception:
            pass
        if self._proc.poll() is None:
            self._proc.terminate()
            try:
                self._proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._proc.kill()
                self._proc.wait(timeout=5)
        self._closed = True

    def __del__(self) -> None:
        self.close()


class SeedRangeWrapper(gym.Wrapper):
    """Force episode seeds into a fixed range (e.g. ProcGen-style train/test split)."""

    def __init__(self, env: gym.Env, seed_low: int, seed_high: int) -> None:
        super().__init__(env)
        self._seed_low = seed_low
        self._seed_high = seed_high

    def reset(
        self, *, seed: int | None = None, options: dict[str, Any] | None = None
    ) -> tuple[np.ndarray, dict[str, Any]]:
        forced_seed = int(self.np_random.integers(self._seed_low, self._seed_high))
        return self.env.reset(seed=forced_seed, options=options)


def list_available_games(games_dir: str | Path | None = None) -> list[str]:
    """Return sorted game names in ``games_dir`` (defaults to bundled examples)."""
    return sorted(p.stem for p in _resolve_games_dir(games_dir).glob("*.js"))
