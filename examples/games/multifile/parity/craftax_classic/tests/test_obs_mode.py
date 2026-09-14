"""13b: obs_mode="symbolic" through the node host and PlayTrainEnv.

13a proved the game's 1345-float vector is bit-identical to the C. This is
the delivery half: the same vector has to reach a Gymnasium env unchanged,
with the rasterizer skipped entirely, and pixel mode has to be untouched.

The load-bearing test is the last one — it drives PlayTrainEnv and compares
what comes out of the env against the C driver's own observation, float for
float. Anything that quietly reshaped, rescaled or re-ordered the vector on
the way through the host would pass every other check here.
"""

from __future__ import annotations

import json
import struct

import numpy as np
import pytest

from ccref import DRIVER_ABSENT_REASON, GAME, have_driver
from ccref import run as crun
from jsrun import have_node

from playtrain.runtime import PlayTrainEnv
from playtrain.runtime.native_vec_env import _LIB_PATH, NativeVecEnv

pytestmark = pytest.mark.skipif(not have_node(), reason="node not on PATH")

TRACES = GAME / "traces"
NAME = "craftax_classic"
OBS_DIM = 1345


def test_the_env_reports_a_flat_float32_space():
    env = PlayTrainEnv(game=NAME, obs_mode="symbolic")
    try:
        assert env.observation_space.shape == (OBS_DIM,)
        assert env.observation_space.dtype == np.float32
        obs, _ = env.reset(seed=1)
        assert obs.shape == (OBS_DIM,)
        assert obs.dtype == np.float32
    finally:
        env.close()


def test_the_dimension_comes_from_the_sidecar():
    sidecar = json.loads((GAME / "dist" / f"{NAME}.json").read_text())
    assert sidecar["obs"]["symbolic"] == OBS_DIM
    env = PlayTrainEnv(game=NAME, obs_mode="symbolic")
    try:
        assert env.observation_space.shape[0] == sidecar["obs"]["symbolic"]
    finally:
        env.close()


def test_a_game_without_a_symbolic_declaration_is_refused():
    """Better a clear error at construction than a wrongly-shaped buffer."""
    with pytest.raises(ValueError, match="obs.symbolic"):
        PlayTrainEnv(game="pong", obs_mode="symbolic")


def test_pixel_mode_is_unchanged():
    env = PlayTrainEnv(game=NAME, obs_mode="rgb", obs_size=64)
    try:
        assert env.observation_space.shape == (64, 64, 3)
        obs, _ = env.reset(seed=1)
        assert obs.dtype == np.uint8 and obs.shape == (64, 64, 3)
    finally:
        env.close()


def test_the_vector_tracks_the_state():
    env = PlayTrainEnv(game=NAME, obs_mode="symbolic")
    try:
        obs, _ = env.reset(seed=3)
        moved = False
        for a in (4, 4, 2, 5, 3):
            nxt, _, _, _, _ = env.step(a)
            if not np.array_equal(obs, nxt):
                moved = True
            obs = nxt
        assert moved, "the observation never changed across five steps"
    finally:
        env.close()


def test_the_one_hot_block_channels_are_well_formed():
    """63 tiles x 21 channels: the 17 block channels are a one-hot, so each
    tile's block block sums to exactly 1."""
    env = PlayTrainEnv(game=NAME, obs_mode="symbolic")
    try:
        obs, _ = env.reset(seed=11)
    finally:
        env.close()
    for tile in range(63):
        base = tile * 21
        assert obs[base : base + 17].sum() == pytest.approx(1.0), f"tile {tile}"
        for k in range(17, 21):
            assert obs[base + k] in (0.0, 1.0)


@pytest.mark.skipif(not have_driver(), reason=DRIVER_ABSENT_REASON)
def test_the_env_delivers_the_c_observation_bit_for_bit(tmp_path):
    """End to end: a fixed action sequence through PlayTrainEnv, compared
    against `cc_ref obs` for the same seed, float for float.

    THE ONE-NOOP OFFSET. GameEnv.reset() calls resetGame(seed) and then a free
    tick(), and a p5 game's draw() both advances and renders — so the game has
    already taken one step, with no keys held, by the time the first
    env.step() runs. That is PlayTrain's convention for every catalog game,
    not something this port introduced, but it means a PlayTrain episode is
    the C's episode with a NOOP prepended. So the C is driven here with
    [NOOP] + actions, and env.reset()'s observation is compared against the
    C's state after that NOOP.

    Do not "fix" this by dropping the offset from the test: the offset is
    real, and it is declared in the manifest's not_matched list.
    """
    seed = 7
    actions = bytes((i * 5 + 2) % 17 for i in range(120))
    path = tmp_path / "actions.bin"
    path.write_bytes(bytes([0]) + actions)          # the reset tick's NOOP

    blob = crun("obs", str(seed), str(path))
    assert blob[:4] == b"CCO1"
    dim, _ = struct.unpack("<II", blob[4:12])
    rec = 1 + dim * 4
    body = blob[12:]
    c_steps = [np.frombuffer(body[i * rec + 1 : (i + 1) * rec], dtype=np.float32)
               for i in range(len(body) // rec)]

    env = PlayTrainEnv(game=NAME, obs_mode="symbolic", max_steps=10000)
    try:
        obs, _ = env.reset(seed=seed)
        assert np.array_equal(obs, c_steps[0]), (
            "the reset observation is not the C's state after one NOOP; "
            "the free-tick offset has changed"
        )
        for i, a in enumerate(actions):
            obs, _, terminated, truncated, _ = env.step(int(a))
            want = c_steps[i + 1]
            if not np.array_equal(obs, want):
                bad = int(np.flatnonzero(obs != want)[0])
                pytest.fail(
                    f"step {i + 1}: obs[{bad}] env {obs[bad]!r} vs C {want[bad]!r}"
                )
            if terminated or truncated:
                break
    finally:
        env.close()


def test_the_one_noop_offset_is_declared():
    """A trajectory offset by a step is exactly what not_matched is for."""
    sidecar = json.loads((GAME / "dist" / f"{NAME}.json").read_text())
    joined = " ".join(sidecar["reference"]["not_matched"]).lower()
    assert "noop" in joined and "reset" in joined, sidecar["reference"]["not_matched"]


# --- 13c: the vectorised C++ host ------------------------------------------

native = pytest.mark.skipif(
    not _LIB_PATH.exists(),
    reason="native backend not built (run native/build_qjs_vec.sh)")


@native
def test_the_vec_host_reports_a_float32_vector():
    env = NativeVecEnv(game=NAME, num_envs=3, obs_mode="symbolic", max_steps=500)
    try:
        obs = np.asarray(env.reset(seeds=[1, 2, 3]))
        assert obs.shape == (3, OBS_DIM)
        assert obs.dtype == np.float32
    finally:
        env.close()


@native
def test_the_vec_host_still_does_pixels_by_default():
    env = NativeVecEnv(game=NAME, num_envs=2, obs_size=64, max_steps=500)
    try:
        obs = np.asarray(env.reset(seeds=[1, 2]))
        assert obs.shape == (2, 64, 64, 3)
        assert obs.dtype == np.uint8
    finally:
        env.close()


@native
def test_the_vec_host_refuses_a_game_with_no_symbolic_declaration():
    with pytest.raises((ValueError, RuntimeError)):
        NativeVecEnv(game="pong", num_envs=2, obs_mode="symbolic")


@native
def test_the_vec_host_vector_is_well_formed_and_moves():
    env = NativeVecEnv(game=NAME, num_envs=2, obs_mode="symbolic", max_steps=500)
    try:
        # The host reuses one output slab, so every sample must be copied
        # before the next step — comparing two views of it always says
        # "unchanged", which is how this test first fooled me.
        first = np.asarray(env.reset(seeds=[5, 6])).copy()
        later = np.asarray(env.step(np.full(2, 5, dtype=np.int32))[0]).copy()
        assert not np.array_equal(first, later)
        for row in (first, later):
            for tile in range(63):
                assert row[0, tile * 21 : tile * 21 + 17].sum() == pytest.approx(1.0)
    finally:
        env.close()


@native
@pytest.mark.skipif(not have_driver(), reason=DRIVER_ABSENT_REASON)
def test_the_vec_host_matches_the_c_bit_for_bit(tmp_path):
    """The same end-to-end check as the node host, through the C++ one.

    Same one-NOOP reset offset: the vec host's env_reset ticks draw() once
    before the first step, exactly as the node host does.
    """
    seed = 4
    actions = bytes((i * 3 + 1) % 17 for i in range(80))
    path = tmp_path / "a.bin"
    path.write_bytes(bytes([0]) + actions)

    blob = crun("obs", str(seed), str(path))
    dim, _ = struct.unpack("<II", blob[4:12])
    rec = 1 + dim * 4
    body = blob[12:]
    c_steps = [np.frombuffer(body[i * rec + 1 : (i + 1) * rec], dtype=np.float32)
               for i in range(len(body) // rec)]

    env = NativeVecEnv(game=NAME, num_envs=1, obs_mode="symbolic", max_steps=10000)
    try:
        obs = np.asarray(env.reset(seeds=[seed])).copy()
        assert np.array_equal(obs[0], c_steps[0]), "reset observation differs"
        for i, a in enumerate(actions):
            out = env.step(np.full(1, int(a), dtype=np.int32))
            obs = np.asarray(out[0]).copy()
            term, trunc = np.asarray(out[2]), np.asarray(out[3])
            want = c_steps[i + 1]
            if not np.array_equal(obs[0], want):
                bad = int(np.flatnonzero(obs[0] != want)[0])
                pytest.fail(
                    f"step {i + 1}: obs[{bad}] host {obs[0][bad]!r} vs C {want[bad]!r}"
                )
            if term[0] or trunc[0]:
                break
    finally:
        env.close()
