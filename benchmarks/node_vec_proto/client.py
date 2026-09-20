"""Python side of node_vec_proto: spawn master.mjs, write N actions per step, read the slab from an mmap file."""
from __future__ import annotations

import json
import mmap
import struct
import subprocess
import tempfile
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


class NodeVecProto:
    def __init__(self, game_path: str, n: int, obs_mode: str = "rgb", obs_size: int = 64, max_steps: int = 1000):
        side = json.loads(Path(game_path).with_suffix(".json").read_text())
        self.n, self.obs_mode = n, obs_mode
        self.sym_dim = int(side["obs"]["symbolic"]) if obs_mode == "symbolic" else 0
        self.obs_bytes = self.sym_dim * 4 if obs_mode == "symbolic" else obs_size * obs_size * 3
        self.obs_off = -(-6 * n // 8) * 8
        size = self.obs_off + self.obs_bytes * n
        self.f = tempfile.NamedTemporaryFile(prefix="nodevec_", suffix=".bin", delete=False); self.f.truncate(size); self.f.flush()
        self.mm = mmap.mmap(self.f.fileno(), size, access=mmap.ACCESS_READ)
        cmd = ["node", str(HERE / "master.mjs"), "--game", game_path, "--n", str(n), "--obs-mode", obs_mode, "--obs-size", str(obs_size),
               "--max-steps", str(max_steps), "--mmap", self.f.name, "--sym-dim", str(self.sym_dim)]
        self.p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        self._act = np.zeros(n, dtype=np.int32)

    def _roundtrip(self, cmd: int, vals: np.ndarray) -> None:
        self.p.stdin.write(struct.pack("<i", cmd) + vals.astype("<i4").tobytes()); self.p.stdin.flush()
        hdr = self.p.stdout.read(8)
        if len(hdr) < 8: raise RuntimeError("master exited")

    def reset(self, seeds):
        self._roundtrip(1, np.asarray(seeds, dtype=np.int32)); return self.obs()

    def step(self, actions):
        self._roundtrip(0, np.asarray(actions, dtype=np.int32))
        n = self.n
        rew = np.frombuffer(self.mm, dtype=np.float32, count=n, offset=0)
        term = np.frombuffer(self.mm, dtype=np.uint8, count=n, offset=4 * n)
        trunc = np.frombuffer(self.mm, dtype=np.uint8, count=n, offset=5 * n)
        return self.obs(), rew, term, trunc

    def obs(self):
        n = self.n
        if self.obs_mode == "symbolic":
            return np.frombuffer(self.mm, dtype=np.float32, count=n * self.sym_dim, offset=self.obs_off).reshape(n, self.sym_dim)
        return np.frombuffer(self.mm, dtype=np.uint8, count=n * self.obs_bytes, offset=self.obs_off).reshape(n, -1, 3)

    def close(self):
        try: self.p.stdin.write(struct.pack("<i", 2) + b"\0" * (4 * self.n)); self.p.stdin.flush()
        except Exception: pass
        self.p.wait(timeout=10); self.f.close()          # the mmap is left to GC: numpy views may still reference it


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--game", default=str(ROOT / "examples/games/multifile/parity/puzzlescript/dist/ps_sokoban_basic.js"))
    ap.add_argument("--n", type=int, nargs="*", default=[1, 8, 16])
    ap.add_argument("--obs-mode", default="rgb")
    ap.add_argument("--steps", type=int, default=500)
    a = ap.parse_args()
    for n in a.n:
        v = NodeVecProto(a.game, n, a.obs_mode)
        v.reset(np.arange(n)); rng = np.random.default_rng(0)
        for _ in range(20): v.step(rng.integers(0, 6, size=n))
        t = time.perf_counter()
        for _ in range(a.steps): o, r, te, tr = v.step(rng.integers(0, 6, size=n))
        dt = time.perf_counter() - t
        print(f"{Path(a.game).stem} {a.obs_mode} n={n}: {n * a.steps / dt:,.0f} steps/s  ({dt / a.steps * 1e6:.0f} us/batch)  obs {o.shape} nonzero {int((o != 0).sum())}", flush=True)
        v.close()
