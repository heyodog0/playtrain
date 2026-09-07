"""QuickJSEnv — Gymnasium env that runs a game's JavaScript UNCHANGED on the
embedded QuickJS + native rasterizer backend (native/qjs/qjs_host).

This is the canonical training/eval engine: it runs every generated game as-is
(100% coverage, no transpiler), calls the native rasterizer directly, and is
deterministic + reproducible. On x86 it benches ~1.5x ProcGen per core.

Protocol (native/qjs/qjs_host.cpp `serve` mode):
  request  (5 bytes): [cmd:u8][arg:i32le]   cmd 0=reset(seed) 1=step(action) 2=close
                      cmd 3=step_q, followed by n_channels u16le wire values
                      (box action spaces; see playtrain.runtime.action_space)
  response: [reward:f64][term:u8][trunc:u8][gs:u8][score:f64][lives:f64] + obs(H*W*3)
"""
from __future__ import annotations

import os
import struct
import subprocess
from pathlib import Path
from typing import Any

import gymnasium as gym
import numpy as np
from gymnasium import spaces

import json

from playtrain._paths import asset as _asset, games_dir as _games_dir, repo_root as _repo_root
from playtrain.runtime.action_space import (
    action_names, as_json, is_default, load_space_spec, quantize_box_actions)
_ROOT = _repo_root() or Path(__file__).resolve().parents[3]
_QJS_HOST = _asset("native/build/qjs_host")
_GAMES_DIR = _games_dir()
_GS_NAMES = ("PLAYING", "WIN", "GAMEOVER", "EXIT", "UNKNOWN")
_HDR = struct.Struct("<d")  # reward; rest read by offset


def list_available_games() -> list[str]:
    return sorted(p.stem for p in _GAMES_DIR.glob("*.js"))


class QuickJSEnv(gym.Env):
    metadata = {"render_modes": []}

    def __init__(self, game: str = "bigfish", obs_size: int = 64, max_steps: int = 2000,
                 host_path: str | os.PathLike | None = None,
                 action_space: str | list | None = None):
        super().__init__()
        self.game = game
        self.obs_size = obs_size
        self.max_steps = max_steps
        self._host = Path(host_path) if host_path else _QJS_HOST
        if not self._host.exists():
            raise FileNotFoundError(f"qjs_host not built at {self._host}. Run native/build_qjs.sh")
        game_path = game if game.endswith(".js") else str(_GAMES_DIR / f"{game}.js")
        if not Path(game_path).exists():
            raise FileNotFoundError(f"game not found: {game_path}")

        # Action space: default8 unless a name / .json path / action list /
        # box dict is given (see playtrain.runtime.action_space). A box space
        # exposes gym.spaces.Box over the channels; actions are quantized to
        # uint16 wire values Python-side and stepped via serve cmd 3.
        spec = load_space_spec(action_space)
        self._obs_bytes = obs_size * obs_size * 3
        self.observation_space = spaces.Box(0, 255, (obs_size, obs_size, 3), np.uint8)
        proc_env = None
        if spec["type"] == "box":
            self._box_channels = spec["channels"]
            self._actions = None
            self._action_names = list(self._box_channels)
            low = np.array([0.0 if c.startswith("pointer") else -1.0
                            for c in self._box_channels], dtype=np.float32)
            self.action_space = spaces.Box(low, np.ones(len(self._box_channels), np.float32))
            proc_env = os.environ.copy()
            proc_env["PLAYTRAIN_QJS_INPUT_MAP"] = json.dumps(self._box_channels)
        else:
            self._box_channels = None
            self._actions = spec["actions"]
            self._action_names = list(action_names(self._actions))
            self.action_space = spaces.Discrete(len(self._actions))
            # A non-default table reaches qjs_host as a JSON table in its
            # environment; the default path spawns with an untouched environment.
            if not is_default(self._actions):
                proc_env = os.environ.copy()
                proc_env["PLAYTRAIN_QJS_ACTIONS"] = as_json(self._actions)
        self._proc = subprocess.Popen(
            [str(self._host), game_path, "serve"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0,
            env=proc_env,
        )
        self._closed = False
        self._last_seed: int | None = None

    def _read_exact(self, n: int) -> bytes:
        out = bytearray()
        while len(out) < n:
            chunk = self._proc.stdout.read(n - len(out))
            if not chunk:
                err = self._proc.stderr.read().decode(errors="replace")
                raise RuntimeError(f"qjs_host ({self.game}) exited. stderr={err}")
            out += chunk
        return bytes(out)

    def _rpc(self, cmd: int, arg: int, payload: bytes = b""):
        self._proc.stdin.write(bytes([cmd]) + struct.pack("<i", arg) + payload)
        self._proc.stdin.flush()
        hdr = self._read_exact(27)
        reward = struct.unpack_from("<d", hdr, 0)[0]
        term, trunc, gs = hdr[8], hdr[9], hdr[10]
        score = struct.unpack_from("<d", hdr, 11)[0]
        lives = struct.unpack_from("<d", hdr, 19)[0]
        obs = np.frombuffer(self._read_exact(self._obs_bytes), np.uint8).reshape(
            self.obs_size, self.obs_size, 3)
        info = {"score": score, "lives": lives,
                "gameState": _GS_NAMES[gs] if gs < len(_GS_NAMES) else "UNKNOWN",
                "seed": self._last_seed, "actionMeanings": self._action_names}
        return reward, bool(term), bool(trunc), info, obs

    def reset(self, *, seed: int | None = None, options: dict[str, Any] | None = None):
        super().reset(seed=seed)
        if seed is None:
            seed = int(self.np_random.integers(0, 2**31 - 1))
        self._last_seed = seed
        _, _, _, info, obs = self._rpc(0, int(seed) & 0x7FFFFFFF)
        return obs, info

    def step(self, action):
        if self._box_channels is not None:
            # Box path: quantize to uint16 wire values (the producer side of
            # the wire contract) and step via serve cmd 3.
            q = quantize_box_actions(np.asarray(action, dtype=np.float64), self._box_channels)
            reward, term, trunc, info, obs = self._rpc(3, 0, q.astype("<u2").tobytes())
            return obs, float(reward), term, trunc, info
        action = int(action)
        if not 0 <= action < self.action_space.n:
            raise ValueError(f"action {action} out of range [0, {self.action_space.n})")
        reward, term, trunc, info, obs = self._rpc(1, action)
        return obs, float(reward), term, trunc, info

    def close(self):
        if self._closed:
            return
        self._closed = True
        try:
            self._proc.stdin.write(bytes([2]) + struct.pack("<i", 0))
            self._proc.stdin.flush()
            self._proc.wait(timeout=2)
        except Exception:
            self._proc.terminate()
