"""Attribute a game's non-drawing time to its own JS functions.

The residual in the cost figure -- "everything else" -- could not be broken down
because game logic never crosses an API boundary, QuickJS cannot report which
function is executing, and games have no clock (millis() is faked from
frameCount so replay stays bit-exact).

All three dissolve if the JS only reports WHICH function it is entering and C++
does the timing: no time value ever enters the interpreter, so control flow
cannot depend on it and determinism is preserved. The game's own top-level
functions are wrapped by appending a block at the end of the file -- the game's
code is not edited, so nothing can be broken by a bad rewrite.

usage: uv run python tools/prof_game.py qbert.v2
"""
from __future__ import annotations

import ctypes
import re
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, 'tools')
from playtrain.runtime.native_vec_env import NativeVecEnv  # noqa: E402

GAMES = Path('../playtrain/examples/games/js')
PROBE = Path('../playtrain/examples/games/probe')
# setup/resetGame run once, not per step; draw is the whole frame so it would
# just double-count everything inside it.
SKIP = {"setup", "resetGame", "mulberry32", "draw"}


def make_profiled(game: str) -> tuple[str, list[str]]:
    src = (GAMES / f"{game}.js").read_text()
    names = [m.group(1) for m in re.finditer(r'^function\s+(\w+)\s*\(', src, re.M)]
    names = [n for n in names if n not in SKIP][:60]
    wrap = ["\n// ---- appended by tools/prof_game.py ----",
            f"const __pn = {names!r};".replace("'", '"'),
            "__pn.forEach(function(n, i) {",
            "  var f = globalThis[n];",
            "  if (typeof f !== 'function') return;",
            "  globalThis[n] = function() {",
            "    __pe(i);",
            "    try { return f.apply(this, arguments); } finally { __px(i); }",
            "  };",
            "});"]
    out = f"prof_{game.replace('.', '_')}"
    (PROBE / f"{out}.js").write_text(src + "\n".join(wrap) + "\n")
    return out, names


def main() -> int:
    game = sys.argv[1]
    prof_game, names = make_profiled(game)
    env = NativeVecEnv(prof_game, num_envs=1, obs_size=64, max_steps=100000,
                       num_threads=1, autoreset=True, frame_skip=1,
                       render_skip=False, games_dir=str(PROBE))
    lib = env._lib
    for fn, res, arg in (("vec_set_prof", None, [ctypes.c_int]),
                         ("vec_prof_reset", None, []),
                         ("vec_prof_ns", ctypes.c_ulonglong, [ctypes.c_int]),
                         ("vec_prof_calls", ctypes.c_ulonglong, [ctypes.c_int])):
        getattr(lib, fn).restype = res
        getattr(lib, fn).argtypes = arg
    rng = np.random.default_rng(0)
    env.reset(seeds=np.zeros(1, dtype=np.int32))
    acts = rng.integers(0, 8, size=(64, 1), dtype=np.int32)
    for i in range(30):
        env.step(acts[i % 64])

    STEPS = 2000
    lib.vec_prof_reset(); lib.vec_set_prof(1)
    t0 = time.perf_counter()
    for i in range(STEPS):
        env.step(acts[i % 64])
    wall = (time.perf_counter() - t0) / STEPS * 1e6
    lib.vec_set_prof(0)

    print(f"{game}: {wall:.1f} us per step measured with profiling ON\n")
    print(f"{'function':<22}{'us/step':>9}{'calls/step':>12}{'% of step':>11}")
    tot = 0.0
    for i, n in enumerate(names):
        us = lib.vec_prof_ns(i) / STEPS / 1000
        calls = lib.vec_prof_calls(i) / STEPS
        if us < 0.05:
            continue
        tot += us
        print(f"{n:<22}{us:9.1f}{calls:12.1f}{100 * us / wall:10.0f}%")
    print(f"{'(sum, may nest)':<22}{tot:9.1f}{'':12}{100 * tot / wall:10.0f}%")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
