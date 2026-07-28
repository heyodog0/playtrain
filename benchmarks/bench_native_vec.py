"""Aggregate-throughput benchmark for the native threadpool backend
(``NativeVecEnv`` / ``native/qjs/qjs_vec_host.cpp``) — the envpool-class
coordinator.

For each game at ``--n`` envs it reports, side by side:

  single      one qjs_host env, pure C ``bench`` (no coordinator at all)
  ceiling     N independent qjs_host processes, sustained — the embarrassingly-
              parallel hardware ceiling (what ProcGen/ALE-style sharding gets)
  native-vec  in-process C++ threadpool, batched step via ctypes (GIL released)
  py-coord    a Python lockstep loop over N ``qjs_host serve`` subprocesses
              (same fast backend as native-vec, but coordinated from Python) —
              the apples-to-apples stand-in for today's ``PlayTrainVecEnv``

``eff`` is native-vec / ceiling: how close the coordinator gets to the hardware
ceiling. On a homogeneous x86 server pass ``--threads`` = core count; on Apple
Silicon the default (perf-core count) is best.

    uv run python benchmarks/bench_native_vec.py --n 10
    uv run python benchmarks/bench_native_vec.py --games coinrun miner --n 8 --threads 8
"""
from __future__ import annotations

import argparse
import json
import select
import struct
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

from playtrain.runtime.native_vec_env import NativeVecEnv

_ROOT = Path(__file__).resolve().parents[1]
_HOST = _ROOT / "native" / "build" / "qjs_host"
_GAMES = _ROOT / "examples" / "games" / "js"
_OBS = 64
_FB = _OBS * _OBS * 3
_DEFAULT_GAMES = ["plunder", "bigfish", "starpilot", "leaper", "coinrun", "maze", "miner"]


def single_sps(game: str, steps: int = 40000) -> float:
    out = subprocess.run([str(_HOST), str(_GAMES / f"{game}.js"), "bench", "1", str(steps)],
                         capture_output=True, text=True).stdout
    return float(out.split("= ")[1].split(" ")[0])


def ceiling_sps(game: str, n: int, steps: int = 200000) -> float:
    js = str(_GAMES / f"{game}.js")
    procs = [subprocess.Popen([str(_HOST), js, "bench", str(42 + i), str(steps)],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) for i in range(n)]
    t = time.perf_counter()
    for p in procs:
        p.wait()
    return n * steps / (time.perf_counter() - t)


def native_sps(game: str, n: int, threads: int, steps: int = 4000, trials: int = 3) -> float:
    env = NativeVecEnv(game, num_envs=n, autoreset=True, num_threads=threads)
    env.reset(seeds=np.arange(n, dtype=np.int32))
    acts = np.ones(n, dtype=np.int32)
    for _ in range(50):
        env.step(acts)
    best = 0.0
    for _ in range(trials):
        t = time.perf_counter()
        for _ in range(steps):
            env.step(acts)
        best = max(best, n * steps / (time.perf_counter() - t))
    env.close()
    return best


class _SubprocCoord:
    """Python lockstep coordinator over N qjs_host serve subprocesses."""

    def __init__(self, game: str, n: int):
        self.n = n
        js = str(_GAMES / f"{game}.js")
        self.procs = [subprocess.Popen([str(_HOST), js, "serve"], stdin=subprocess.PIPE,
                      stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=0) for _ in range(n)]
        self.fds = [p.stdout.fileno() for p in self.procs]
        self.fd_to_i = {fd: i for i, fd in enumerate(self.fds)}
        self.resp = 27 + _FB

    def _read_exact(self, p, k):
        buf = bytearray()
        while len(buf) < k:
            c = p.stdout.read(k - len(buf))
            if not c:
                raise RuntimeError("worker died")
            buf += c

    def reset(self, seeds):
        for p, s in zip(self.procs, seeds):
            p.stdin.write(bytes([0]) + struct.pack("<i", int(s) & 0x7FFFFFFF))
        for p in self.procs:
            p.stdin.flush()
        for p in self.procs:
            self._read_exact(p, self.resp)

    def step(self, actions):
        for p, a in zip(self.procs, actions):
            p.stdin.write(bytes([1]) + struct.pack("<i", int(a)))
        for p in self.procs:
            p.stdin.flush()
        remaining = set(range(self.n))
        while remaining:
            ready, _, _ = select.select([self.fds[i] for i in remaining], [], [])
            for fd in ready:
                i = self.fd_to_i[fd]
                if i in remaining:
                    self._read_exact(self.procs[i], self.resp)
                    remaining.discard(i)

    def close(self):
        for p in self.procs:
            try:
                p.stdin.write(bytes([2]) + struct.pack("<i", 0)); p.stdin.flush()
                p.wait(timeout=2)
            except Exception:
                p.kill()


def pycoord_sps(game: str, n: int, steps: int = 2000, trials: int = 3) -> float:
    c = _SubprocCoord(game, n)
    c.reset(list(range(n)))
    acts = [1] * n
    for _ in range(50):
        c.step(acts)
    best = 0.0
    for _ in range(trials):
        t = time.perf_counter()
        for _ in range(steps):
            c.step(acts)
        best = max(best, n * steps / (time.perf_counter() - t))
    c.close()
    return best


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--games", nargs="+", default=_DEFAULT_GAMES)
    ap.add_argument("--n", type=int, default=10, help="num envs (default 10)")
    ap.add_argument("--threads", type=int, default=0, help="worker threads (0 = perf-core default)")
    ap.add_argument("--out", type=str, default=str(_ROOT / "outputs" / "compare" / "native_vec_bench.json"))
    args = ap.parse_args()
    N = args.n

    print(f"{'game':<11}{'single':>9}{'ceiling':>11}{'native':>10}{'eff':>6}"
          f"{'native@2N':>11}{'py-coord':>11}{'nat/py':>8}")
    rows = []
    for g in args.games:
        s = single_sps(g)
        ceil = ceiling_sps(g, N)
        nat = native_sps(g, N, args.threads)
        nat2 = native_sps(g, 2 * N, args.threads)
        py = pycoord_sps(g, N)
        rows.append(dict(game=g, single=s, ceiling=ceil, native=nat, native_2n=nat2,
                         pycoord=py, eff_vs_ceiling=nat / ceil, native_over_py=nat / py))
        print(f"{g:<11}{s:>9,.0f}{ceil:>11,.0f}{nat:>10,.0f}{nat/ceil*100:>5.0f}%"
              f"{nat2:>11,.0f}{py:>11,.0f}{nat/py:>7.2f}x")

    geo_eff = float(np.exp(np.mean([np.log(r["eff_vs_ceiling"]) for r in rows])))
    geo_np = float(np.exp(np.mean([np.log(r["native_over_py"]) for r in rows])))
    print(f"\ngeomean eff vs ceiling: {geo_eff*100:.0f}%   geomean native/py: {geo_np:.2f}x")

    outp = Path(args.out)
    outp.parent.mkdir(parents=True, exist_ok=True)
    json.dump({"n": N, "threads": args.threads, "rows": rows,
               "geo_eff_vs_ceiling": geo_eff, "geo_native_over_py": geo_np}, open(outp, "w"), indent=2)
    print(f"saved {outp}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
