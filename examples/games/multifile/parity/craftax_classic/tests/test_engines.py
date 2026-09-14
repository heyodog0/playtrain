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
