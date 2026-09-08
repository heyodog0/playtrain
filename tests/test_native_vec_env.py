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

from playtrain.runtime.native_vec_env import AsyncNativeVecEnv, _LIB_PATH, NativeVecEnv
from playtrain.runtime.qjs_env import QuickJSEnv, _QJS_HOST

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
    from playtrain.runtime.native_vector_env import NativeVectorEnv
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
    from playtrain.runtime.native_vector_env import NativeVectorEnv
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


# ---------------------------------------------------------------------------
# frame_skip + autoreset seed policy (added for the a consumer repo IMPALA vec path)
# ---------------------------------------------------------------------------

def test_frame_skip_equals_k_single_steps():
    """One fs=K vec step == K fs=1 vec steps holding the action (no episode
    end in the horizon): identical obs, summed reward, same flags."""
    K, N, DECISIONS = 4, 3, 40
    seeds = np.array([7, 42, 1234][:N], dtype=np.int32)
    skip = NativeVecEnv("pong", num_envs=N, frame_skip=K,
                        max_steps=100000)
    base = NativeVecEnv("pong", num_envs=N, frame_skip=1,
                        max_steps=100000)
    try:
        so = skip.reset(seeds=seeds).copy()
        bo = base.reset(seeds=seeds).copy()
        assert np.array_equal(so, bo)
        rng = np.random.default_rng(3)
        for t in range(DECISIONS):
            acts = rng.integers(0, 8, size=N)
            o1, r1, te1, tr1, _ = skip.step(acts)
            rsum = np.zeros(N, dtype=np.float64)
            for _ in range(K):
                o2, r2, te2, tr2, _ = base.step(acts)
                rsum += r2.astype(np.float64)
            assert not te1.any() and not te2.any(), "test assumes no episode end"
            assert np.array_equal(o1, o2), f"obs mismatch at decision {t}"
            np.testing.assert_allclose(r1.astype(np.float64), rsum, atol=1e-6)
    finally:
        skip.close()
        base.close()


@pytest.mark.parametrize("game,frame_skip", [
    ("pong", 4),
    # A game that caches static content in a createGraphics layer. The layer
    # bindings exist in three places (p5-shim.mjs, qjs_host.cpp, qjs_vec_host.cpp)
    # and layers are allocated at the canvas DEVICE scale, so a mismatch between
    # any two backends shows up as shifted sub-device-pixel features rather than a
    # crash — exactly the silent-divergence class that the qbert stroke leak fell
    # into. This case was previously uncovered: the check only ever ran on pong,
    # which never calls createGraphics. The createGraphics game lives in a consumer
    # repo and is not in the shipped catalog, so only pong is parametrized here.
])
def test_frame_skip_matches_v8_production_path(game, frame_skip):
    """Cross-engine: NativeVecEnv(frame_skip=K) must match PlayTrainEnv
    (node/V8 + wasm rasterizer, the path a consumer repo models trained on) —
    same obs bytes, reward, and flags per decision."""
    from playtrain.runtime.env import PlayTrainEnv
    from playtrain.runtime.native_vec_env import _resolve_games_dir
    K, STEPS = frame_skip, 60
    seed = 42
    if not (_resolve_games_dir(None) / f"{game}.js").exists():
        pytest.skip(f"{game}.js not present (sync it in with `just sync-a consumer repo`)")
    vec = NativeVecEnv(game, num_envs=1, frame_skip=K,
                       max_steps=2000)
    try:
        v8 = PlayTrainEnv(game=game, frame_skip=K)
    except Exception as e:  # node runtime unavailable
        vec.close()
        pytest.skip(f"PlayTrainEnv unavailable: {e}")
    try:
        vo = vec.reset(seeds=np.array([seed], dtype=np.int32)).copy()
        no, _ = v8.reset(seed=seed)
        assert np.array_equal(vo[0], no), "reset obs mismatch vs V8"
        rng = np.random.default_rng(1)
        for t in range(STEPS):
            a = int(rng.integers(0, 8))
            o1, r1, te1, tr1, _ = vec.step(np.array([a], dtype=np.int32))
            o2, r2, te2, tr2, _ = v8.step(a)
            assert np.array_equal(o1[0], o2), f"obs mismatch vs V8 at t={t}"
            assert abs(float(r1[0]) - float(r2)) < 1e-9, f"reward mismatch t={t}"
            assert bool(te1[0]) == bool(te2) and bool(tr1[0]) == bool(tr2)
            if te2 or tr2:
                break  # autoreset conventions differ past done; stop here
    finally:
        vec.close()
        v8.close()


def test_autoreset_seed_pool_single_seed():
    """With a one-seed pool, every autoreset must land on exactly that seed:
    the post-done obs equals a fresh reset(seed) obs."""
    POOL_SEED = 555
    env = NativeVecEnv("bigfish", num_envs=2, autoreset=True, max_steps=6)
    ref = NativeVecEnv("bigfish", num_envs=2, autoreset=False)
    try:
        env.set_autoreset_seeds("pool", pool=[POOL_SEED], rng_seed=9)
        ref_obs = ref.reset(seeds=np.array([POOL_SEED, POOL_SEED],
                                           dtype=np.int32)).copy()
        env.reset(seeds=np.array([1, 2], dtype=np.int32))
        saw_done = False
        for _ in range(12):
            o, r, te, tr, _ = env.step(np.zeros(2, dtype=np.int32))
            done = te | tr
            for i in range(2):
                if done[i]:
                    saw_done = True
                    assert np.array_equal(o[i], ref_obs[i]), (
                        "autoreset obs != fresh reset(pool seed) obs")
        assert saw_done, "max_steps=6 should have truncated within 12 steps"
    finally:
        env.close()
        ref.close()


def test_autoreset_seed_fixed():
    """mode='fixed' behaves like a one-seed pool."""
    FIXED = 4242
    env = NativeVecEnv("bigfish", num_envs=1, autoreset=True, max_steps=5)
    ref = NativeVecEnv("bigfish", num_envs=1, autoreset=False)
    try:
        env.set_autoreset_seeds("fixed", fixed_seed=FIXED)
        ref_obs = ref.reset(seeds=np.array([FIXED], dtype=np.int32)).copy()
        env.reset(seeds=np.array([3], dtype=np.int32))
        for _ in range(6):
            o, r, te, tr, _ = env.step(np.zeros(1, dtype=np.int32))
            if (te | tr)[0]:
                assert np.array_equal(o[0], ref_obs[0])
                return
        raise AssertionError("no done within 6 steps at max_steps=5")
    finally:
        env.close()
        ref.close()


def test_render_skip_is_invisible():
    """render_skip must change NOTHING observable: obs, reward, term, trunc
    identical to a non-skipping env across many steps INCLUDING episode ends
    (tiny max_steps forces truncations mid-run, exercising the autoreset
    overwrite path)."""
    K, N, STEPS = 7, 4, 300
    seeds = np.array([7, 42, 1234, 99999], dtype=np.int32)
    kw = dict(num_envs=N, frame_skip=K, autoreset=True, max_steps=140)
    ref = NativeVecEnv("pong", render_skip=False, **kw)
    fast = NativeVecEnv("pong", render_skip=True, **kw)
    try:
        o1 = ref.reset(seeds=seeds).copy()
        o2 = fast.reset(seeds=seeds).copy()
        assert np.array_equal(o1, o2)
        rng = np.random.default_rng(0)
        saw_done = False
        for t in range(STEPS):
            acts = rng.integers(0, 8, size=N).astype(np.int32)
            a1 = ref.step(acts)
            a2 = fast.step(acts)
            assert np.array_equal(a1[0], a2[0]), f"obs mismatch t={t}"
            np.testing.assert_array_equal(a1[1], a2[1])
            assert (a1[2] == a2[2]).all() and (a1[3] == a2[3]).all()
            saw_done = saw_done or bool((a1[2] | a1[3]).any())
        assert saw_done, "test must exercise autoreset boundaries"
    finally:
        ref.close()
        fast.close()


def test_render_skip_requires_autoreset():
    import pytest as _pytest
    with _pytest.raises(ValueError):
        NativeVecEnv("bigfish", num_envs=1, frame_skip=4, render_skip=True,
                     autoreset=False)


def test_pingpong_bit_exact_vs_sync():
    """PingPongVecEnv (group send/wait on the async host) must produce the
    same per-env trajectories as the sync NativeVecEnv for identical
    seeds+actions — including autoreset boundaries and render_skip."""
    from playtrain.runtime.native_vec_env import PingPongVecEnv
    B, STEPS, K = 3, 200, 7
    seeds = np.array([7, 42, 1234, 9, 11, 13], dtype=np.int32)  # 2B envs
    sync = NativeVecEnv("pong", num_envs=2 * B,
                        autoreset=True, frame_skip=K, render_skip=True,
                        max_steps=280)
    pp = PingPongVecEnv("pong", group_size=B,
                        frame_skip=K, render_skip=True, max_steps=280)
    try:
        o_sync = sync.reset(seeds=seeds).copy()
        o_pp = pp.reset(seeds=seeds).copy()
        assert np.array_equal(o_sync, o_pp)
        rng = np.random.default_rng(5)
        acts = rng.integers(0, 8, size=(STEPS, 2 * B)).astype(np.int32)
        # sync: step all 2B together. ping-pong: send group 0, then group 1,
        # wait each — same per-env action sequence.
        saw_done = False
        for t in range(STEPS):
            so, sr, ste, str_ = sync.step(acts[t])[:4]
            pp.send(0, acts[t, :B])
            pp.send(1, acts[t, B:])
            po0, pr0, pte0, ptr0 = pp.wait(0)
            po1, pr1, pte1, ptr1 = pp.wait(1)
            assert np.array_equal(so[:B], po0) and np.array_equal(so[B:], po1), f"obs t={t}"
            np.testing.assert_array_equal(sr[:B], pr0)
            np.testing.assert_array_equal(sr[B:], pr1)
            assert (ste[:B] == pte0).all() and (ste[B:] == pte1).all()
            assert (str_[:B] == ptr0).all() and (str_[B:] == ptr1).all()
            saw_done = saw_done or bool(ste.any() or str_.any())
        assert saw_done
    finally:
        sync.close()
        pp.close()
