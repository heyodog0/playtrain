from __future__ import annotations

import base64
import json
import subprocess
from collections import deque
from pathlib import Path
from typing import Any

import gymnasium as gym
import numpy as np
from gymnasium import spaces


class KazukiGymEnv(gym.Env[np.ndarray, int]):
    metadata = {"render_modes": []}

    def __init__(
        self,
        *,
        frame_stack: int = 4,
        obs_size: int = 84,
        max_steps: int = 2000,
        node_bin: str = "node",
    ) -> None:
        super().__init__()
        self.frame_stack = frame_stack
        self.obs_size = obs_size
        self.max_steps = max_steps
        self._repo_root = Path(__file__).resolve().parents[2]
        self._worker_path = self._repo_root / "envs" / "kazuki-worker.mjs"
        self._frames: deque[np.ndarray] = deque(maxlen=frame_stack)
        self._closed = False

        self.action_space = spaces.Discrete(8)
        self.observation_space = spaces.Box(
            low=0,
            high=255,
            shape=(obs_size, obs_size, frame_stack),
            dtype=np.uint8,
        )

        self._proc = subprocess.Popen(
            [node_bin, str(self._worker_path)],
            cwd=self._repo_root,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )

        # Establish the protocol early so failures are obvious.
        self._request({"cmd": "ping"})

    def _request(self, payload: dict[str, Any]) -> dict[str, Any]:
        if self._closed:
            raise RuntimeError("KazukiGymEnv is closed")
        if self._proc.stdin is None or self._proc.stdout is None:
            raise RuntimeError("Kazuki worker stdio is unavailable")

        self._proc.stdin.write(json.dumps(payload) + "\n")
        self._proc.stdin.flush()

        line = self._proc.stdout.readline()
        if not line:
            stderr = ""
            if self._proc.stderr is not None:
                stderr = self._proc.stderr.read().strip()
            raise RuntimeError(f"Kazuki worker exited unexpectedly. stderr={stderr}")

        message = json.loads(line)
        if not message.get("ok"):
            raise RuntimeError(message.get("error", "Unknown Kazuki worker error"))
        return message

    def _decode_obs(self, obs_b64: str) -> np.ndarray:
        raw = base64.b64decode(obs_b64)
        obs = np.frombuffer(raw, dtype=np.uint8)
        return obs.reshape(self.obs_size, self.obs_size)

    def _stacked_obs(self) -> np.ndarray:
        return np.stack(list(self._frames), axis=-1).astype(np.uint8, copy=False)

    def reset(self, *, seed: int | None = None, options: dict[str, Any] | None = None) -> tuple[np.ndarray, dict[str, Any]]:
        super().reset(seed=seed)
        max_steps = self.max_steps
        if options and "max_steps" in options:
            max_steps = int(options["max_steps"])

        response = self._request(
            {
                "cmd": "reset",
                "seed": seed,
                "max_steps": max_steps,
            }
        )
        first_frame = self._decode_obs(response["obs_b64"])
        self._frames.clear()
        for _ in range(self.frame_stack):
            self._frames.append(first_frame.copy())
        return self._stacked_obs(), response["info"]

    def step(self, action: int) -> tuple[np.ndarray, float, bool, bool, dict[str, Any]]:
        response = self._request({"cmd": "step", "action": int(action)})
        frame = self._decode_obs(response["obs_b64"])
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
