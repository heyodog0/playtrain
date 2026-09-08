from __future__ import annotations

import json
import mmap
import os
import shlex
import struct
import subprocess
import sys
import tempfile
from collections import deque
from pathlib import Path
from typing import Any

import gymnasium as gym
import numpy as np
from gymnasium import spaces


# Bundled example games that ship with the repo.
from playtrain._paths import asset as _asset, games_dir as _games_dir
from playtrain.runtime.action_space import (
    is_default, load_space_spec, quantize_box_actions)
DEFAULT_GAMES_DIR = _games_dir()

# Bundled JS runtime (game-worker.mjs + p5/ shim).
DEFAULT_RUNTIME_DIR = _asset("runtime")


def _resolve_runtime_dir(explicit: str | Path | None) -> Path:
    if explicit is not None:
        return Path(explicit).resolve()
    env_var = os.environ.get("PLAYTRAIN_RUNTIME")
    if env_var:
        return Path(env_var).resolve()
    return DEFAULT_RUNTIME_DIR


def _resolve_games_dir(explicit: str | Path | None) -> Path:
    if explicit is not None:
        return Path(explicit).resolve()
    env_var = os.environ.get("PLAYTRAIN_GAMES_DIR")
    if env_var:
        return Path(env_var).resolve()
    return DEFAULT_GAMES_DIR


class PlayTrainEnv(gym.Env[np.ndarray, int]):
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
        overridable via the ``PLAYTRAIN_GAMES_DIR`` env var.
    runtime_dir:
        Directory containing ``game-worker.mjs`` and ``p5/`` shim. Defaults
        to the bundled ``runtime/``, overridable via ``PLAYTRAIN_RUNTIME``.
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
    action_space:
        Discrete action space: a name in ``runtime/action_spaces.json``, a path
        to a JSON action list, or the list itself. Default: ``default8``.
    """

    metadata = {"render_modes": []}
    _HEADER_STRUCT = struct.Struct(">II")
    # Binary step response — same format as the Three.js path.
    _STEP_HEADER_STRUCT = struct.Struct(">fBBBBii")
    _STEP_HEADER_SIZE = 16
    _GS_NAMES = ("PLAYING", "WIN", "GAMEOVER", "EXIT")
    _MMAP_SENTINEL = 0xFFFFFFFF

    def __init__(
        self,
        *,
        game: str,
        games_dir: str | Path | None = None,
        runtime_dir: str | Path | None = None,
        obs_size: int = 64,
        obs_mode: str = "rgb",
        frame_stack: int = 1,
        frame_skip: int = 1,
        max_steps: int = 2000,
        node_bin: str = "node",
        require_matter: bool | None = None,
        action_space: str | list | None = None,
    ) -> None:
        super().__init__()
        self.game = game
        self.obs_size = obs_size
        self.obs_mode = obs_mode
        self.frame_stack = frame_stack
        self.frame_skip = max(1, int(frame_skip))
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
                "Set PLAYTRAIN_RUNTIME or pass runtime_dir=."
            )

        if require_matter is None:
            needs_matter = "Matter." in self._game_path.read_text()
        else:
            needs_matter = require_matter

        if obs_mode == "rgb":
            self._channels = 3 * frame_stack
        else:
            self._channels = frame_stack

        # Action space: default8 unless a name / .json path / action list /
        # box dict is given (see playtrain.runtime.action_space). A non-default
        # table is forwarded to the worker as --action-space; a box space as
        # --input-map, stepped with quantized wire values via "stepq".
        spec = load_space_spec(action_space)
        if spec["type"] == "box":
            self._actions = None
            self._box_channels = spec["channels"]
            low = np.array([0.0 if c.startswith("pointer") else -1.0
                            for c in self._box_channels], dtype=np.float32)
            self.action_space = spaces.Box(low, np.ones(len(self._box_channels), np.float32))
        else:
            self._actions = spec["actions"]
            self._box_channels = None
            self.action_space = spaces.Discrete(len(self._actions))
        self.observation_space = spaces.Box(
            low=0,
            high=255,
            shape=(obs_size, obs_size, self._channels),
            dtype=np.uint8,
        )

        self._frames: deque[np.ndarray] = deque(maxlen=frame_stack)
        self._last_seed: int | None = None

        # mmap-shared obs file (same pattern as the Three.js env). Sized for
        # 16-byte step header + max possible single-frame obs (RGB).
        self._use_mmap = os.environ.get("PLAYTRAIN_P5_NO_MMAP") != "1"
        self._mmap = None
        self._mmap_file = None
        self._mmap_path = None
        single_frame_bytes = obs_size * obs_size * 3
        self._mmap_size = self._STEP_HEADER_SIZE + single_frame_bytes
        if self._use_mmap:
            self._mmap_file = tempfile.NamedTemporaryFile(
                prefix=f"playtrain_p5_{game}_",
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

        # PLAYTRAIN_NODE_FLAGS lets callers inject `node` flags (e.g.
        # "--cpu-prof --cpu-prof-dir=/abs/path"). Splice between binary
        # and script so the flags apply to the worker process itself.
        node_flags = shlex.split(os.environ.get("PLAYTRAIN_NODE_FLAGS", ""))
        cmd = [
            node_bin,
            *node_flags,
            str(self._worker_path),
            "--game", str(self._game_path),
            "--obs-mode", obs_mode,
            "--obs-size", str(obs_size),
            "--frame-skip", str(self.frame_skip),
        ]
        if self._box_channels is not None:
            cmd += ["--input-map", json.dumps(self._box_channels, separators=(",", ":"))]
        elif not is_default(self._actions):
            # Inline JSON array — argv carries it verbatim, no shell involved.
            cmd += ["--action-space", json.dumps(self._actions, separators=(",", ":"))]
        if needs_matter:
            cmd.append("--matter")

        proc_env = os.environ.copy()
        if self._mmap_path is not None:
            proc_env["PLAYTRAIN_P5_MMAP_PATH"] = str(self._mmap_path)

        self._proc = subprocess.Popen(
            cmd,
            cwd=self._runtime_dir,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=False,
            bufsize=0,
            env=proc_env,
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
            raise RuntimeError("PlayTrainEnv is closed")
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

        # Fastest path: mmap sentinel — worker wrote step header + obs into mmap.
        if meta_length == self._MMAP_SENTINEL:
            (reward, term, trunc, gs_idx, lives, score, steps) = self._STEP_HEADER_STRUCT.unpack_from(self._mmap, 0)
            n_obs = binary_length if binary_length else (self._mmap_size - self._STEP_HEADER_SIZE)
            obs = bytes(self._mmap[self._STEP_HEADER_SIZE:self._STEP_HEADER_SIZE + n_obs])
            return self._build_step_message(reward, term, trunc, gs_idx, lives, score, steps), obs

        # Fast path (no mmap): binary step header + obs in pipe.
        if meta_length == 0 and binary_length >= self._STEP_HEADER_SIZE:
            binary = self._read_exact(binary_length)
            (reward, term, trunc, gs_idx, lives, score, steps) = self._STEP_HEADER_STRUCT.unpack_from(binary, 0)
            obs = binary[self._STEP_HEADER_SIZE:]
            return self._build_step_message(reward, term, trunc, gs_idx, lives, score, steps), obs

        # Slow path (JSON) — used by reset/ping/close.
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

        self._last_seed = seed
        response, observation = self._request(
            {"cmd": "reset", "seed": seed, "max_steps": max_steps}
        )
        first_frame = self._decode_obs(observation)
        self._frames.clear()
        for _ in range(self.frame_stack):
            self._frames.append(first_frame.copy())
        return self._stacked_obs(), response["info"]

    def step(self, action) -> tuple[np.ndarray, float, bool, bool, dict[str, Any]]:
        if self._box_channels is not None:
            q = quantize_box_actions(np.asarray(action, dtype=np.float64), self._box_channels)
            response, observation = self._request({"cmd": "stepq", "q": q.tolist()})
            frame = self._decode_obs(observation)
            self._frames.append(frame)
            return (self._stacked_obs(), float(response["reward"]),
                    bool(response["terminated"]), bool(response["truncated"]),
                    response["info"])
        action = int(action)
        if not 0 <= action < self.action_space.n:
            raise ValueError(f"action {action} out of range [0, {self.action_space.n})")
        response, observation = self._request({"cmd": "step", "action": action})
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
        # After the worker acks `close` it calls process.exit(0). Wait for that
        # natural exit (V8's --cpu-prof flush happens here) before resorting to
        # signals. Without this, a SIGTERM races ahead of the profile flush and
        # the .cpuprofile file is never written.
        try:
            self._proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            self._proc.terminate()
            try:
                self._proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._proc.kill()
                self._proc.wait(timeout=5)
        # If the worker printed a profile summary to stderr (only when
        # PLAYTRAIN_P5_PROFILE=1), surface it so the caller can see it.
        if os.environ.get("PLAYTRAIN_P5_PROFILE") == "1" and self._proc.stderr is not None:
            try:
                tail = self._proc.stderr.read()
                if tail:
                    sys.stderr.write(tail.decode(errors="replace"))
            except Exception:
                pass
        # Tear down mmap + tmp file
        try:
            if getattr(self, "_mmap", None) is not None:
                self._mmap.close()
        except Exception:
            pass
        try:
            if getattr(self, "_mmap_file", None) is not None:
                self._mmap_file.close()
            if getattr(self, "_mmap_path", None) is not None:
                self._mmap_path.unlink(missing_ok=True)
        except Exception:
            pass
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
