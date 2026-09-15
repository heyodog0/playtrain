"""T5: every engine renders the first-person frame identically.

PlayTrain's standing invariant is that a game behaves the same under V8 (the
training path), QuickJS (the native host) and the vectorised host. For this
variant the invariant carries more weight than usual, because the frame is now
produced by floating-point code: `rs_voxel_view` casts a ray per pixel, and
the two engines reach it by different routes — QuickJS calls the Rust compiled
natively, V8 calls the same Rust compiled to wasm32. Anything that leaked a
platform-dependent float into the ray march would show up here as a diverging
observation hash.

`native/gate_qjs.sh` is the repo's differential gate: it runs both engines on
matched seeds and diffs reward, terminal, score, lives, state and the
observation hash at every step. If it ever fails, find the leak — do not add a
tolerance. The plan's section 6 rule is that native and wasm32 are byte-
identical, full stop.

The skip is the repo's existing "native backend not built" convention.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path

import numpy as np
import pytest

from playtrain.runtime.native_vec_env import _LIB_PATH, NativeVecEnv
from playtrain.runtime.qjs_env import _QJS_HOST

pytestmark = pytest.mark.skipif(
    not _LIB_PATH.exists() or not _QJS_HOST.exists(),
    reason="native backend not built (run native/build_qjs.sh && native/build_qjs_vec.sh)")

HERE = Path(__file__).resolve().parent
GAME_DIR = HERE.parent
REPO = GAME_DIR.parents[4]
DIST = GAME_DIR / "dist"
NAME = "craftax_fp"
CLASSIC_DIST = REPO / "examples" / "games" / "multifile" / "parity" / "craftax_classic" / "dist"


def sidecar_actions() -> str:
    return json.dumps(json.loads((DIST / f"{NAME}.json").read_text())["actions"])


def _gate(extra_env: dict, steps: str = "3000") -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env["PLAYTRAIN_GAMES_DIR"] = str(DIST)
    env["PLAYTRAIN_QJS_ACTIONS"] = sidecar_actions()
    env.pop("PLAYTRAIN_RASTERIZER", None)
    env.update(extra_env)
    return subprocess.run(
        ["./gate_qjs.sh", NAME, steps],
        cwd=REPO / "native", capture_output=True, text=True, env=env,
    )


def test_v8_and_quickjs_are_bit_exact():
    """3000 steps x 3 seeds, the repo's default depth. The observation here is
    the raycast frame, so this is also the cross-target check on the voxel
    primitive over a real trajectory rather than a handful of golden scenes."""
    proc = _gate({})
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "GATE PASS" in proc.stdout, proc.stdout
    assert proc.stdout.count("bit-exact") == 3, proc.stdout


def test_the_sidecar_table_reaches_the_native_hosts():
    """Both sides pick the action as (i*3+1) % table_size, so a silent fallback
    to the default 8-action space on either side would make the gate diverge.
    Assert the size directly too, since that fallback is the failure mode worth
    naming."""
    assert len(json.loads(sidecar_actions())) == 17


def _first_obshash(games_dir: Path, name: str, extra_env: dict) -> tuple[str, str]:
    env = dict(os.environ)
    env["PLAYTRAIN_GAMES_DIR"] = str(games_dir)
    env["PLAYTRAIN_QJS_ACTIONS"] = json.dumps(
        json.loads((games_dir / f"{name}.json").read_text())["actions"])
    env.pop("PLAYTRAIN_RASTERIZER", None)
    env.update(extra_env)
    v8 = subprocess.run(
        ["node", "reference_trace.mjs", name, "1", "2"],
        cwd=REPO / "native", capture_output=True, text=True, env=env)
    qjs = subprocess.run(
        [str(REPO / "native" / "build" / "qjs_host"),
         str(games_dir / f"{name}.js"), "trace", "1", "2"],
        cwd=REPO / "native", capture_output=True, text=True, env=env)
    assert v8.returncode == 0, v8.stderr
    assert qjs.returncode == 0, qjs.stderr
    grab = lambda out: re.search(r"obshash=(\d+)", out).group(1)
    return grab(v8.stdout), grab(qjs.stdout)


def test_the_gate_is_looking_at_the_first_person_frame():
    """Anti-vacuity, and specific to this variant: the gate would be just as
    green if craftax_fp somehow rendered craftax_classic's top-down frame. The
    two games share a seed and their dynamics are identical by T4, so the only
    thing that can make their observation hashes differ is the renderer."""
    fp_v8, fp_qjs = _first_obshash(DIST, NAME, {})
    cl_v8, cl_qjs = _first_obshash(CLASSIC_DIST, "craftax_classic", {})
    assert fp_v8 == fp_qjs, "the engines disagree on the first-person frame"
    assert cl_v8 == cl_qjs, "the engines disagree on the classic frame"
    assert fp_v8 != cl_v8, "craftax_fp produced craftax_classic's frame"


def test_v8_and_quickjs_agree_on_the_symbolic_observation():
    """The variant reuses 85_obs_symbolic.js, so symbolic mode must still work
    and must still agree across engines."""
    proc = _gate({"PLAYTRAIN_OBS_MODE": "symbolic",
                  "PLAYTRAIN_QJS_OBS_MODE": "symbolic"}, steps="600")
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "GATE PASS" in proc.stdout, proc.stdout
    assert proc.stdout.count("bit-exact") == 3, proc.stdout


def test_the_symbolic_gate_is_not_passing_vacuously():
    """Both engines silently falling back to pixels would also be green."""
    v8_rgb, qjs_rgb = _first_obshash(DIST, NAME, {})
    v8_sym, qjs_sym = _first_obshash(DIST, NAME, {"PLAYTRAIN_OBS_MODE": "symbolic",
                                                  "PLAYTRAIN_QJS_OBS_MODE": "symbolic"})
    assert v8_rgb == qjs_rgb, "the engines disagree in pixel mode"
    assert v8_sym == qjs_sym, "the engines disagree in symbolic mode"
    assert v8_sym != v8_rgb, "symbolic mode produced the pixel hash: it was ignored"


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
    """The voxel primitive keeps a depth buffer on the canvas and staging
    buffers on the per-env rasterizer state. If either were shared between
    envs instead of per-env, a multi-env run would not repeat."""
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


def test_the_vectorised_host_matches_the_single_env_frame():
    """Two envs in one process must render what one env in its own process
    renders — the sharp end of 'state is per-env', and the thing that would
    break first if the depth buffer leaked between them."""
    from playtrain.runtime import PlayTrainEnv

    single = PlayTrainEnv(game=NAME, games_dir=str(DIST), obs_size=64, obs_mode="rgb")
    try:
        want, _ = single.reset(seed=7)
        for i in range(20):
            want = single.step((i * 5 + 2) % 17)[0]
    finally:
        single.close()

    vec = NativeVecEnv(game=NAME, num_envs=2, obs_size=64, max_steps=500)
    try:
        vec.reset(seeds=[7, 8])
        for i in range(20):
            obs = vec.step(np.full(2, (i * 5 + 2) % 17, dtype=np.int32))[0]
        got = np.asarray(obs)[0]
    finally:
        vec.close()

    assert np.array_equal(got, want), "vectorised host and single env disagree"
