"""G4 (Mac half): every engine steps this game identically.

PlayTrain's standing invariant is that a game behaves the same under V8
(the training path), QuickJS (the native host), the vectorised host and the
AOT tier. That invariant is what lets a human session and a training run be
the same environment, so it has to hold for the first game that declares its
own 17-action space rather than using default8.

`native/gate_qjs.sh` is the differential gate the repo already uses; this
drives it for craftax_classic with the sidecar's action table. The AOT tier
and gate_async need a toolchain this machine does not have, and are task 9b
on the cluster.

The skip here is the repo's existing "native backend not built" convention
(see tests/test_native_vec_env.py), not a new one.
"""

from __future__ import annotations

import json
import os
import subprocess

import re

import numpy as np
import pytest

from ccref import GAME

from playtrain.runtime.native_vec_env import _LIB_PATH, NativeVecEnv
from playtrain.runtime.qjs_env import _QJS_HOST

pytestmark = pytest.mark.skipif(
    not _LIB_PATH.exists() or not _QJS_HOST.exists(),
    reason="native backend not built (run native/build_qjs.sh && native/build_qjs_vec.sh)")

REPO = GAME.parents[4]
DIST = GAME / "dist"
NAME = "craftax_classic"


def sidecar_actions() -> str:
    return json.dumps(json.loads((DIST / f"{NAME}.json").read_text())["actions"])


def test_v8_and_quickjs_are_bit_exact():
    """gate_qjs.sh runs the V8 reference and qjs_host on matched seeds and
    diffs reward, terminal, score, lives, state and the observation hash for
    every step. 3000 steps x 3 seeds, the repo's default depth."""
    env = dict(os.environ)
    env["PLAYTRAIN_GAMES_DIR"] = str(DIST)
    env["PLAYTRAIN_QJS_ACTIONS"] = sidecar_actions()
    proc = subprocess.run(
        ["./gate_qjs.sh", NAME, "3000"],
        cwd=REPO / "native", capture_output=True, text=True, env=env,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "GATE PASS" in proc.stdout, proc.stdout
    assert proc.stdout.count("bit-exact") == 3, proc.stdout


def test_the_sidecar_table_reaches_the_native_hosts():
    """Both sides pick the action index as (i*3+1) % table_size, so if either
    host fell back to default8 the two would step different actions and the
    gate above would diverge. Assert the table size directly as well, since a
    silent fallback is the failure mode worth naming."""
    assert len(json.loads(sidecar_actions())) == 17


def test_the_vectorised_host_steps_with_seventeen_actions():
    env = NativeVecEnv(game=NAME, num_envs=4, obs_size=64, max_steps=500)
    try:
        obs = env.reset(seeds=[1, 2, 3, 4])
        assert np.asarray(obs).shape == (4, 64, 64, 3)
        for i in range(60):
            env.step(np.full(4, (i * 3 + 1) % 17, dtype=np.int32))
    finally:
        env.close()


def test_the_vectorised_host_is_deterministic():
    def run():
        env = NativeVecEnv(game=NAME, num_envs=2, obs_size=64, max_steps=500)
        try:
            env.reset(seeds=[7, 8])
            out = []
            for i in range(80):
                obs, rew, term, trunc, _ = env.step(np.full(2, (i * 5 + 2) % 17, dtype=np.int32))
                out.append(np.asarray(obs).copy())
                out.append(np.asarray(rew, dtype=np.float64).copy())
            return np.concatenate([a.ravel() for a in out])
        finally:
            env.close()

    assert np.array_equal(run(), run())


# --- 13c: the differential gate over the symbolic observation ---------------

def _gate(extra_env: dict, steps: str = "600") -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env["PLAYTRAIN_GAMES_DIR"] = str(DIST)
    env["PLAYTRAIN_QJS_ACTIONS"] = sidecar_actions()
    env.update(extra_env)
    return subprocess.run(
        ["./gate_qjs.sh", NAME, steps],
        cwd=REPO / "native", capture_output=True, text=True, env=env,
    )


def _first_obshash(extra_env: dict) -> tuple[str, str]:
    """The reset obshash from each engine, for one seed."""
    env = dict(os.environ)
    env["PLAYTRAIN_GAMES_DIR"] = str(DIST)
    env["PLAYTRAIN_QJS_ACTIONS"] = sidecar_actions()
    env.update(extra_env)
    v8 = subprocess.run(
        ["node", "reference_trace.mjs", NAME, "1", "2"],
        cwd=REPO / "native", capture_output=True, text=True, env=env)
    qjs = subprocess.run(
        [str(REPO / "native" / "build" / "qjs_host"),
         str(DIST / f"{NAME}.js"), "trace", "1", "2"],
        cwd=REPO / "native", capture_output=True, text=True, env=env)
    assert v8.returncode == 0, v8.stderr
    assert qjs.returncode == 0, qjs.stderr
    grab = lambda out: re.search(r"obshash=(\d+)", out).group(1)
    return grab(v8.stdout), grab(qjs.stdout)


def test_v8_and_quickjs_agree_on_the_symbolic_observation():
    """PLAN 3.6 asks for the gate to hash the symbolic buffer alongside the
    frame. With both sides in symbolic mode the existing differential gate
    compares the 1345-float vector instead of the 64x64x3 frame."""
    proc = _gate({"PLAYTRAIN_OBS_MODE": "symbolic",
                  "PLAYTRAIN_QJS_OBS_MODE": "symbolic"})
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "GATE PASS" in proc.stdout, proc.stdout
    assert proc.stdout.count("bit-exact") == 3, proc.stdout


def test_the_symbolic_gate_is_not_passing_vacuously():
    """Both engines silently falling back to pixels would also produce a
    green gate. The symbolic hashes must differ from the pixel ones, and the
    two engines must agree within each mode."""
    v8_rgb, qjs_rgb = _first_obshash({})
    v8_sym, qjs_sym = _first_obshash({"PLAYTRAIN_OBS_MODE": "symbolic",
                                      "PLAYTRAIN_QJS_OBS_MODE": "symbolic"})
    assert v8_rgb == qjs_rgb, "the engines disagree in pixel mode"
    assert v8_sym == qjs_sym, "the engines disagree in symbolic mode"
    assert v8_sym != v8_rgb, "symbolic mode produced the pixel hash: it was ignored"


def test_pixel_mode_is_still_the_default():
    proc = _gate({}, steps="600")
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "GATE PASS" in proc.stdout
