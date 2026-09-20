"""T0: libtwin_vec builds and speaks the vec_* ABI Python binds: NativeVecEnv(lib_path=...) on the blank twin resets,
steps with the right shapes, truncates at max_steps and closes; twin_host prints reference_trace-shaped lines."""
import os
import re

import numpy as np

from conftest import LIB, PARITY, ensure_built, twin_host

BRIX = PARITY / "chip8" / "dist" / "chip8_brix.js"


def test_blank_twin_through_native_vec_env():
    ensure_built()
    os.environ["TWIN_BLANK"] = "1"
    try:
        from playtrain.runtime import NativeVecEnv
        v = NativeVecEnv(game="chip8_brix", num_envs=4, num_threads=2, obs_size=64, max_steps=50, autoreset=True, lib_path=str(LIB))
        assert v.num_threads == 2
        v.reset([0, 1, 2, 3])
        truncs = 0
        for _ in range(120):
            out = v.step(np.zeros(4, dtype=np.int64))
            truncs += int(out[3].sum())
        v.close()
    finally:
        del os.environ["TWIN_BLANK"]
    assert out[0].shape == (4, 64, 64, 3) and out[0].dtype == np.uint8 and (out[0] == 0).all()
    assert out[1].shape == (4,) and float(np.abs(out[1]).sum()) == 0 and int(out[2].sum()) == 0
    assert truncs == 8, truncs          # 120 steps / max_steps 50 -> 2 truncations per env


def test_twin_host_trace_shape():
    proc = twin_host(str(BRIX), "trace", "1", "3", env={"TWIN_BLANK": "1"})
    assert proc.returncode == 0, proc.stdout + proc.stderr
    lines = proc.stdout.strip().split("\n")
    assert re.fullmatch(r"reset seed=1 score=0 lives=1 state=PLAYING obshash=\d+", lines[0]), lines[0]
    assert len(lines) == 4 and all(re.fullmatch(r"\d+ a=\d+ reward=0 term=0 trunc=0 score=0 lives=1 state=PLAYING obshash=\d+", l) for l in lines[1:]), lines


def test_family_without_twin_fails_loudly():
    proc = twin_host(str(BRIX), "trace", "1", "1")
    assert proc.returncode != 0 and "chip8 twin not built" in (proc.stdout + proc.stderr)
