from __future__ import annotations

import json
import struct
import subprocess
from collections import deque
from pathlib import Path
from typing import Any

import gymnasium as gym
import numpy as np
from gymnasium import spaces


# Games that require Matter.js physics engine
MATTER_GAMES = frozenset({"angry_birds", "suika"})


class GameGymEnv(gym.Env[np.ndarray, int]):
    """Gymnasium wrapper for any game in games/js/.

    Each instance spawns a Node.js worker subprocess running game-worker.mjs.
    Communication uses a binary IPC protocol over stdin/stdout.
    """

    metadata = {"render_modes": []}
    _HEADER_STRUCT = struct.Struct(">II")

    def __init__(
        self,
        *,
        game: str,
        obs_size: int = 64,
        obs_mode: str = "rgb",
        frame_stack: int = 1,
        max_steps: int = 2000,
        node_bin: str = "node",
    ) -> None:
        super().__init__()
        self.game = game
        self.obs_size = obs_size
        self.obs_mode = obs_mode
        self.frame_stack = frame_stack
        self.max_steps = max_steps
        self._closed = False

        self._repo_root = Path(__file__).resolve().parents[2]
        self._worker_path = self._repo_root / "envs" / "game-worker.mjs"
        self._game_path = self._repo_root / "games" / "js" / f"{game}.js"

        if not self._game_path.exists():
            raise FileNotFoundError(f"Game not found: {self._game_path}")

        needs_matter = game in MATTER_GAMES
        if not needs_matter:
            # Auto-detect Matter.js usage from source
            source = self._game_path.read_text()
            if "Matter." in source:
                needs_matter = True

        # Observation shape depends on mode and frame stacking
        if obs_mode == "rgb" and frame_stack == 1:
            self._channels = 3
        elif obs_mode == "rgb" and frame_stack > 1:
            self._channels = 3 * frame_stack
        else:
            # grayscale
            self._channels = frame_stack

        self.action_space = spaces.Discrete(8)
        self.observation_space = spaces.Box(
            low=0,
            high=255,
            shape=(obs_size, obs_size, self._channels),
            dtype=np.uint8,
        )

        self._frames: deque[np.ndarray] = deque(maxlen=frame_stack)

        # Build worker command
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
            cwd=self._repo_root,
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
                    f"Game worker ({self.game}) exited unexpectedly. stderr={stderr.decode(errors='replace')}"
                )
            chunks.append(chunk)
            remaining -= len(chunk)
        return b"".join(chunks)

    def _request(self, payload: dict[str, Any]) -> tuple[dict[str, Any], bytes]:
        if self._closed:
            raise RuntimeError("GameGymEnv is closed")
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
            # Stack RGB frames along channel dim: (H, W, 3*N)
            return np.concatenate(list(self._frames), axis=-1).astype(np.uint8, copy=False)
        # Grayscale: stack along last axis
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


# ---------------------------------------------------------------------------
# Seed range wrapper (ProcGen-style train/test split)
# ---------------------------------------------------------------------------

class SeedRangeWrapper(gym.Wrapper):
    """Force episode seeds into a fixed range.

    ProcGen convention:
      - Train seeds: 0-199  (200 procedural levels)
      - Test seeds:  1000-1099 (100 held-out levels)
    """

    def __init__(self, env: gym.Env, seed_low: int, seed_high: int) -> None:
        super().__init__(env)
        self._seed_low = seed_low
        self._seed_high = seed_high

    def reset(
        self, *, seed: int | None = None, options: dict[str, Any] | None = None
    ) -> tuple[np.ndarray, dict[str, Any]]:
        # Generate a seed within the range using the env's RNG
        forced_seed = int(self.np_random.integers(self._seed_low, self._seed_high))
        return self.env.reset(seed=forced_seed, options=options)


# ---------------------------------------------------------------------------
# Multi-game VecEnv factory
# ---------------------------------------------------------------------------

GAMES_DIR = Path(__file__).resolve().parents[2] / "games" / "js"


def list_available_games() -> list[str]:
    """Return sorted list of available game names."""
    return sorted(p.stem for p in GAMES_DIR.glob("*.js"))


def make_multigame_vec_env(
    games: list[str],
    n_envs_per_game: int = 1,
    *,
    seed_range: tuple[int, int] | None = None,
    obs_size: int = 64,
    obs_mode: str = "rgb",
    frame_stack: int = 1,
    max_steps: int = 2000,
    use_subproc: bool = True,
) -> Any:
    """Create a VecEnv spanning multiple games.

    Each env instance permanently plays one game. With n_envs_per_game=2 and
    14 games, this creates 28 parallel envs. The PPO rollout buffer collects
    experience from all games simultaneously.

    If seed_range is provided, wraps each env in SeedRangeWrapper to restrict
    episode seeds (for train/test generalization splits).
    """
    from stable_baselines3.common.vec_env import DummyVecEnv, SubprocVecEnv

    env_fns = []
    for game in games:
        for _ in range(n_envs_per_game):
            def _make(g=game):
                env = GameGymEnv(
                    game=g,
                    obs_size=obs_size,
                    obs_mode=obs_mode,
                    frame_stack=frame_stack,
                    max_steps=max_steps,
                )
                if seed_range is not None:
                    env = SeedRangeWrapper(env, seed_range[0], seed_range[1])
                return env
            env_fns.append(_make)

    VecClass = SubprocVecEnv if (use_subproc and len(env_fns) > 1) else DummyVecEnv
    return VecClass(env_fns)
