"""Three.js (WebGPU/Dawn) Gymnasium env for node-gym.

Parallel to ``NodeGymEnv`` (the p5 path) but spawns ``runtime/three/game-worker.mjs``
which renders the game via Three.js + Dawn WebGPU instead of p5/node-canvas.

Same binary IPC protocol; same reset/step contract; different action space
(Discrete(15) — see THREE_GAME_TEMPLATE.md) and different render backend.
"""

from __future__ import annotations

import json
import mmap
import os
import struct
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import gymnasium as gym
import numpy as np
from gymnasium import spaces


# Bundled Three.js example games.
DEFAULT_THREEJS_GAMES_DIR = Path(__file__).resolve().parents[2] / "examples" / "games" / "threejs"

# Bundled JS runtime (game-worker.mjs + three/ shim + game-env.mjs).
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
    env_var = os.environ.get("NODE_GYM_THREEJS_GAMES_DIR")
    if env_var:
        return Path(env_var).resolve()
    return DEFAULT_THREEJS_GAMES_DIR


class NodeGymThreeEnv(gym.Env[np.ndarray, int]):
    """Gymnasium env that runs a Three.js (WebGPU/Dawn) game in a Node subprocess.

    Each instance spawns one ``node`` worker that loads the target JS game
    (using the v2 contract: setup/update/render/resetGame/getGameState),
    drives it via Three.js's WebGPURenderer running on Dawn, and streams
    pixel observations back over a binary stdin/stdout protocol.

    Parameters
    ----------
    game:
        Game name. Resolved as ``{games_dir}/{game}.js``.
    games_dir:
        Directory containing JS game files. Defaults to bundled examples,
        overridable via the ``NODE_GYM_THREEJS_GAMES_DIR`` env var.
    runtime_dir:
        Directory containing ``three/game-worker.mjs``. Defaults to the
        bundled ``runtime/``, overridable via ``NODE_GYM_RUNTIME``.
    obs_size:
        Side length of the square observation. Default 84 (matches the
        bench/tester historic default; the v2 contract obs is 64).
    max_steps:
        Episode truncation horizon.
    node_bin:
        Path to the node executable (default ``"node"``).
    """

    metadata = {"render_modes": []}
    _HEADER_STRUCT = struct.Struct(">II")
    # Binary step header layout (matches sendBinaryStep in game-worker.mjs):
    #   bytes  0..3: float32 BE reward
    #   byte   4   : terminated (0/1)
    #   byte   5   : truncated  (0/1)
    #   byte   6   : gameState index (0=PLAYING 1=WIN 2=GAMEOVER 3=EXIT)
    #   byte   7   : lives (clamp 0-255)
    #   bytes  8..11: int32 BE score
    #   bytes 12..15: int32 BE episodeLength (steps)
    _STEP_HEADER_STRUCT = struct.Struct(">fBBBBii")
    _STEP_HEADER_SIZE = 16
    _GS_NAMES = ("PLAYING", "WIN", "GAMEOVER", "EXIT")
    # Sentinel meta_length value (impossible JSON length) signaling that the
    # worker wrote obs to the mmap file instead of the pipe. binary_length
    # is unused on this path.
    _MMAP_SENTINEL = 0xFFFFFFFF

    def __init__(
        self,
        *,
        game: str,
        games_dir: str | Path | None = None,
        runtime_dir: str | Path | None = None,
        obs_size: int = 84,
        max_steps: int = 2000,
        node_bin: str = "node",
        obs_quantize_bits: int = 7,
    ) -> None:
        super().__init__()
        self.game = game
        self.obs_size = obs_size
        self.max_steps = max_steps
        self._closed = False
        self._last_seed: int | None = None
        # Quantize obs to N bits/channel by zeroing low bits. Default 7-bit
        # kills ~1-LSB Dawn/WebGPU rasterization jitter while staying visually
        # identical. Set to 8 to disable.
        if not (1 <= obs_quantize_bits <= 8):
            raise ValueError(f"obs_quantize_bits must be in [1, 8], got {obs_quantize_bits}")
        self._obs_quantize_mask = (
            np.uint8((0xFF << (8 - obs_quantize_bits)) & 0xFF) if obs_quantize_bits < 8 else None
        )

        self._games_dir = _resolve_games_dir(games_dir)
        self._runtime_dir = _resolve_runtime_dir(runtime_dir)
        self._worker_path = self._runtime_dir / "three" / "game-worker.mjs"
        self._game_path = self._games_dir / f"{game}.js"

        if not self._game_path.exists():
            raise FileNotFoundError(f"Three.js game not found: {self._game_path}")
        if not self._worker_path.exists():
            raise FileNotFoundError(
                f"Three.js worker not found: {self._worker_path}. "
                "Set NODE_GYM_RUNTIME or pass runtime_dir=."
            )

        # Discrete(15) — see THREE_GAME_TEMPLATE.md
        self.action_space = spaces.Discrete(15)
        self.observation_space = spaces.Box(
            low=0, high=255,
            shape=(obs_size, obs_size, 3),
            dtype=np.uint8,
        )

        # mmap-based obs transfer can be disabled via env var for
        # benchmarking the slower pipe-only path.
        self._use_mmap = os.environ.get("NODE_GYM_THREE_NO_MMAP") != "1"

        # Create a mmap'd file for zero-copy obs transfer. Sized for
        # 16-byte step header + obs bytes (RGB uint8). Both processes open
        # the same file; the kernel page cache makes Node's writes visible
        # to Python's mmap immediately. Pipe carries only the sync signal.
        self._mmap_size = self._STEP_HEADER_SIZE + obs_size * obs_size * 3
        self._mmap = None
        self._mmap_file = None
        self._mmap_path = None
        if self._use_mmap:
            self._mmap_file = tempfile.NamedTemporaryFile(
                prefix=f"node_gym_three_{game}_",
                suffix=".bin",
                delete=False,
            )
            self._mmap_path = Path(self._mmap_file.name)
            self._mmap_file.truncate(self._mmap_size)
            self._mmap_file.flush()
            self._mmap = mmap.mmap(
                self._mmap_file.fileno(),
                self._mmap_size,
                access=mmap.ACCESS_READ,
            )

        # Discrete(15) — see THREE_GAME_TEMPLATE.md
        self.action_space = spaces.Discrete(15)
        self.observation_space = spaces.Box(
            low=0, high=255,
            shape=(obs_size, obs_size, 3),
            dtype=np.uint8,
        )

        # Pass the obs size and mmap path through the env so the worker
        # picks them up at startup.
        env = os.environ.copy()
        env["NODE_GYM_THREE_OBS_SIZE"] = str(obs_size)
        if self._mmap_path is not None:
            env["NODE_GYM_THREE_MMAP_PATH"] = str(self._mmap_path)
        # NODE_GYM_THREE_FORCE_JSON is honored by the worker (bench helper).
        # We pass it through if set on the parent.

        cmd = [
            node_bin,
            str(self._worker_path),
            "--game", str(self._game_path),
            "--obs-size", str(obs_size),
        ]

        self._proc = subprocess.Popen(
            cmd,
            cwd=self._runtime_dir,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=False,
            bufsize=0,
            env=env,
        )

        self._request({"cmd": "ping"})

    def _read_exact(self, size: int) -> bytes:
        if self._proc.stdout is None:
            raise RuntimeError("Three.js worker stdout is unavailable")
        chunks: list[bytes] = []
        remaining = size
        while remaining > 0:
            chunk = self._proc.stdout.read(remaining)
            if not chunk:
                stderr = b""
                if self._proc.stderr is not None:
                    stderr = self._proc.stderr.read().strip()
                raise RuntimeError(
                    f"Three.js worker ({self.game}) exited unexpectedly. "
                    f"stderr={stderr.decode(errors='replace')}"
                )
            chunks.append(chunk)
            remaining -= len(chunk)
        return b"".join(chunks)

    def _build_step_message(self, reward, term, trunc, gs_idx, lives, score, steps) -> dict:
        return {
            "ok": True,
            "reward": reward,
            "terminated": bool(term),
            "truncated": bool(trunc),
            "info": {
                "score": score,
                "lives": lives,
                "gameState": self._GS_NAMES[gs_idx] if gs_idx < len(self._GS_NAMES) else "UNKNOWN",
                "episodeLength": steps,
                "seed": self._last_seed,
            },
        }

    def _request(self, payload: dict[str, Any]) -> tuple[dict[str, Any], bytes]:
        if self._closed:
            raise RuntimeError("NodeGymThreeEnv is closed")
        if self._proc.stdin is None:
            raise RuntimeError("Three.js worker stdin is unavailable")

        meta = json.dumps(payload).encode("utf-8")
        header = self._HEADER_STRUCT.pack(len(meta), 0)
        self._proc.stdin.write(header)
        self._proc.stdin.write(meta)
        self._proc.stdin.flush()

        meta_length, binary_length = self._HEADER_STRUCT.unpack(
            self._read_exact(self._HEADER_STRUCT.size)
        )
        # Fastest path: mmap sentinel — worker wrote step header + obs into
        # the shared mmap file. Pipe just carried the sync header above.
        if meta_length == self._MMAP_SENTINEL:
            (reward, term, trunc, gs_idx, lives, score, steps) = self._STEP_HEADER_STRUCT.unpack_from(self._mmap, 0)
            # Slice obs bytes out of mmap. Copy because the next step
            # overwrites these bytes in-place.
            obs = bytes(self._mmap[self._STEP_HEADER_SIZE:self._STEP_HEADER_SIZE + binary_length]) if binary_length else \
                  bytes(self._mmap[self._STEP_HEADER_SIZE:self._mmap_size])
            return self._build_step_message(reward, term, trunc, gs_idx, lives, score, steps), obs

        # Fast path (no mmap): meta_length=0, obs travels through the pipe.
        if meta_length == 0 and binary_length >= self._STEP_HEADER_SIZE:
            binary = self._read_exact(binary_length)
            (reward, term, trunc, gs_idx, lives, score, steps) = self._STEP_HEADER_STRUCT.unpack_from(binary, 0)
            obs = binary[self._STEP_HEADER_SIZE:]
            return self._build_step_message(reward, term, trunc, gs_idx, lives, score, steps), obs

        # Slow path: JSON-parse meta (used for ping/reset/close).
        message = json.loads(self._read_exact(meta_length).decode("utf-8"))
        binary = self._read_exact(binary_length) if binary_length else b""
        if not message.get("ok"):
            raise RuntimeError(message.get("error", f"Unknown three worker error ({self.game})"))
        return message, binary

    def _decode_obs(self, raw: bytes) -> np.ndarray:
        obs = np.frombuffer(raw, dtype=np.uint8).reshape(self.obs_size, self.obs_size, 3)
        if self._obs_quantize_mask is not None:
            obs = obs & self._obs_quantize_mask
        return obs

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
        self._last_seed = seed
        response, observation = self._request(
            {"cmd": "reset", "seed": seed, "max_steps": max_steps}
        )
        return self._decode_obs(observation), response["info"]

    def step(self, action: int) -> tuple[np.ndarray, float, bool, bool, dict[str, Any]]:
        response, observation = self._request({"cmd": "step", "action": int(action)})
        return (
            self._decode_obs(observation),
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
        # Tear down mmap + tmp file
        try:
            if hasattr(self, "_mmap") and self._mmap is not None:
                self._mmap.close()
        except Exception:
            pass
        try:
            if hasattr(self, "_mmap_file") and self._mmap_file is not None:
                self._mmap_file.close()
            if hasattr(self, "_mmap_path") and self._mmap_path is not None:
                self._mmap_path.unlink(missing_ok=True)
        except Exception:
            pass
        self._closed = True

    def __del__(self) -> None:
        self.close()


def list_available_threejs_games(games_dir: str | Path | None = None) -> list[str]:
    """Sorted Three.js game names available in ``games_dir`` (default: bundled)."""
    return sorted(p.stem for p in _resolve_games_dir(games_dir).glob("*.js"))
