"""Tests for NativeVecEnv (the envpool-class native threadpool backend,
native/qjs/qjs_vec_host.cpp).

The load-bearing test is bit-exactness: each env in the vectorized threadpool
host must produce byte-identical obs / reward / termination to the single-env
``QuickJSEnv`` (which drives ``qjs_host serve``) for the same game + seed +
action sequence. This is what makes the fast parallel backend a drop-in for the
verified single-env one.

Skipped automatically if the shared lib isn't built (native/build_qjs_vec.sh).
"""
from __future__ import annotations

import numpy as np
import pytest

from node_gym.native_vec_env import AsyncNativeVecEnv, _LIB_PATH, NativeVecEnv
from node_gym.qjs_env import QuickJSEnv, _QJS_HOST

pytestmark = pytest.mark.skipif(
    not _LIB_PATH.exists() or not _QJS_HOST.exists(),
    reason="native backend not built (run native/build_qjs.sh && native/build_qjs_vec.sh)")

GAMES = ["bigfish", "coinrun", "miner"]


@pytest.mark.parametrize("game", GAMES)
def test_bit_exact_vs_single_env(game):
    N, STEPS = 4, 200
    seeds = np.array([7, 42, 1234, 99999][:N], dtype=np.int32)

    vec = NativeVecEnv(game, num_envs=N, autoreset=False)
    singles = [QuickJSEnv(game) for _ in range(N)]
    try:
        vobs = vec.reset(seeds=seeds).copy()
        for i in range(N):
            so, _ = singles[i].reset(seed=int(seeds[i]))
            assert np.array_equal(vobs[i], so), f"{game}: reset obs mismatch env {i}"

        rng = np.random.default_rng(0)
        for t in range(STEPS):
            acts = rng.integers(0, 8, size=N)
            vo, vr, vte, vtr, _ = vec.step(acts)
            for i in range(N):
                so, sr, ste, str_, _ = singles[i].step(int(acts[i]))
                assert np.array_equal(vo[i], so), f"{game}: obs mismatch t={t} env={i}"
                assert abs(float(vr[i]) - float(sr)) < 1e-9, f"{game}: reward mismatch t={t} env={i}"
                assert bool(vte[i]) == bool(ste), f"{game}: term mismatch t={t} env={i}"
                assert bool(vtr[i]) == bool(str_), f"{game}: trunc mismatch t={t} env={i}"
    finally:
        vec.close()
        for s in singles:
            s.close()


def test_shapes_and_dtypes():
    env = NativeVecEnv("bigfish", num_envs=3)
    try:
        obs = env.reset()
        assert obs.shape == (3, 64, 64, 3) and obs.dtype == np.uint8
        o, r, te, tr, info = env.step(np.zeros(3, dtype=np.int32))
        assert o.shape == (3, 64, 64, 3)
        assert r.shape == (3,) and r.dtype == np.float32
        assert te.shape == (3,) and te.dtype == bool
        assert tr.shape == (3,) and tr.dtype == bool
    finally:
        env.close()


def test_num_threads_capped_to_envs():
    env = NativeVecEnv("coinrun", num_envs=2, num_threads=8)
    try:
        assert env.num_threads == 2  # T is capped at num_envs
    finally:
        env.close()


# ---------------------------------------------------------------------------
# Async (envpool send/recv) backend
# ---------------------------------------------------------------------------


def test_async_send_recv_roundtrip():
    env = AsyncNativeVecEnv("bigfish", num_envs=8, batch_size=4, autoreset=True)
    try:
        obs = env.reset()
        assert obs.shape == (8, 64, 64, 3)
        env.send(np.arange(8, dtype=np.int32), np.zeros(8, dtype=np.int32))
        seen = set()
        for _ in range(20):  # 20 recvs of 4 = 80 env-steps; every env id must appear
            ids, o, r, te, tr = env.recv()
            assert ids.shape == (4,) and o.shape == (4, 64, 64, 3)
            assert r.shape == (4,) and te.dtype == bool and tr.dtype == bool
            assert set(ids.tolist()) <= set(range(8))
            seen |= set(ids.tolist())
            env.send(ids, np.zeros(len(ids), dtype=np.int32))
        assert seen == set(range(8))  # all envs cycled, no deadlock/starvation
    finally:
        env.close()


def test_async_heterogeneous_pool():
    # A mixed pool (different game per env) — the scenario async is built for.
    pool = ["bigfish", "coinrun", "miner", "maze"]
    env = AsyncNativeVecEnv(games=pool, batch_size=2, autoreset=True)
    try:
        assert env.num_envs == 4
        obs = env.reset()
        assert obs.shape == (4, 64, 64, 3)
        env.send(np.arange(4, dtype=np.int32), np.zeros(4, dtype=np.int32))
        ids, o, r, te, tr = env.recv()
        assert o.shape == (2, 64, 64, 3)
    finally:
        env.close()


# ---------------------------------------------------------------------------
# Gymnasium VectorEnv wrapper
# ---------------------------------------------------------------------------


def test_vectorenv_api_conformance():
    from gymnasium.vector import AutoresetMode, VectorEnv
    from node_gym.native_vector_env import NativeVectorEnv
    env = NativeVectorEnv("coinrun", num_envs=4, autoreset_seed=0)
    try:
        assert isinstance(env, VectorEnv)
        assert env.num_envs == 4
        assert env.observation_space.shape == (4, 64, 64, 3)
        assert env.metadata["autoreset_mode"] == AutoresetMode.NEXT_STEP
        obs, info = env.reset(seed=42)
        assert obs.shape == (4, 64, 64, 3) and obs.dtype == np.uint8
        for _ in range(50):
            o, r, term, trunc, info = env.step(env.action_space.sample())
            assert o.shape == (4, 64, 64, 3)
            assert r.shape == (4,) and term.shape == (4,) and trunc.shape == (4,)
    finally:
        env.close()


def test_vectorenv_same_step_final_observation():
    from node_gym.native_vector_env import NativeVectorEnv
    # SAME_STEP (SB3-style): a terminal step must surface final_observation.
    env = NativeVectorEnv("bigfish", num_envs=4, autoreset_mode="same_step",
                          max_steps=8, autoreset_seed=0)  # tiny horizon -> truncations
    try:
        env.reset(seed=1)
        saw_final = False
        for _ in range(40):
            o, r, term, trunc, info = env.step(env.action_space.sample())
            if "final_observation" in info:
                saw_final = True
                assert info["_final_observation"].shape == (4,)
                assert (term | trunc)[info["_final_observation"]].all()
        assert saw_final, "max_steps=8 should have produced truncations with final_observation"
    finally:
        env.close()
